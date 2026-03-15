// Tab viewer — orchestrates file loading, transport, mixer, and keyboard shortcuts

import { TabRenderer } from '../tab/tab-renderer.js';
import { TabPlayer } from '../tab/tab-player.js';
import { setVoiceType, VOICE_TYPES, isYouTubeVoice, getYouTubeVideoId } from '../audio/synth-voice.js';
import { initFluidSynth, isFluidReady, isFluidLoading, assignChannels, fluidSetVoiceProgram, fluidRestoreOriginalPrograms } from '../audio/fluid-synth.js';
import {
  searchYouTube, isProxyAvailable, loadYouTubeAudio, playYouTube,
  pauseYouTube, stopYouTube, seekYouTube, setYouTubePlaybackRate,
  isYouTubeReady, unloadYouTube, getCurrentVideoId, getYouTubeTime
} from '../audio/youtube-audio.js';
import { autoSync, cancelAnalysis } from '../audio/audio-analysis.js';
import { events, TAB_LOADED, TAB_BEAT_ON, TAB_POSITION, TAB_STOP, TUNING_CHANGE } from '../events.js';
import { VIEW_CHANGE, setActiveView } from './toolbar.js';
import { buildSelect, buildButton, buildSlider } from './dom-helpers.js';
import { createFileLoader } from './tab-file-loader.js';
import { createTransport } from './tab-transport.js';
import { createMixer } from './tab-mixer.js';
import { midiToNoteName } from '../music/notes.js';

export function renderTabViewer(container) {
  const group = document.createElement('div');
  group.className = 'tab-viewer-group';

  // --- Core instances ---
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'tab-canvas-container';

  const renderer = new TabRenderer(canvasContainer);
  const player = new TabPlayer();

  // --- State ---
  let score = null;
  let allTrackData = [];
  let selectedTrackIndex = null;
  let youtubeVoiceActive = false; // Track if YouTube backing is selected
  let isFocusedMode = false; // Whether we're in the "tabs-focused" mode

  // --- HUD Management State ---
  let hudTimeout = null;
  let lastMouseMove = 0;
  let lastPlayerState = 'stopped';
  const MOUSE_THROTTLE = 100; // ms
  const HUD_HIDE_DELAY = 2500; // ms

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'control-group tab-header';

  // --- Mixer ---
  const mixer = createMixer({
    player,
    onTrackSelect: (trackIndex) => {
      player.stop();
      selectTrack(trackIndex);
    },
  });

  // --- Floating UI elements (for tabs-focused mode) ---
  const exitBtn = document.createElement('button');
  exitBtn.className = 'tab-exit-btn';
  exitBtn.textContent = '← Exit';
  exitBtn.title = 'Exit tab viewer (Esc)';

  const hudToggle = document.createElement('button');
  hudToggle.className = 'tab-hud-toggle';
  hudToggle.innerHTML = '♪ Fretboard';
  hudToggle.title = 'Toggle fretboard overlay';

  // Fretboard overlay container
  const fretboardOverlay = document.createElement('div');
  fretboardOverlay.className = 'fretboard-overlay';

  // --- Row 1: File + Track + Mixer + Voice + Offset ---
  const row1 = document.createElement('div');
  row1.className = 'tab-controls-row';

  const fileLoader = createFileLoader({
    onFileLoaded: handleFileLoaded,
  });

  const trackSelect = buildSelect({
    className: 'toggle-btn tab-track-select',
    placeholder: 'Track',
    disabled: true,
  });

  const voiceSelect = buildSelect({
    className: 'toggle-btn tab-voice-select',
    options: [
      { value: VOICE_TYPES.KARPLUS, label: 'Default Synth' },
      { value: VOICE_TYPES.ACOUSTIC, label: 'Acoustic Guitar' },
      { value: VOICE_TYPES.ELECTRIC_CLEAN, label: 'Electric Clean' },
      { value: VOICE_TYPES.ELECTRIC_MUTED, label: 'Electric Muted' },
      { value: VOICE_TYPES.OVERDRIVEN, label: 'Overdriven' },
      { value: VOICE_TYPES.DISTORTION, label: 'Distortion' },
    ],
  });

  // YouTube sync offset control (hidden by default)
  const { wrap: ytOffsetWrap, slider: ytOffsetSlider, valueSpan: ytOffsetValue, resetBtn: ytOffsetReset } = buildSlider({
    className: 'yt-offset-control',
    label: 'YT Offset',
    min: -30,
    max: 60,
    value: 0,
    step: 0.1,
    valueText: '0.0s',
    showReset: true,
  });
  ytOffsetWrap.style.display = 'none';
  
  // Auto-sync button
  const autoSyncBtn = buildButton('Auto', 'toggle-btn auto-sync-btn', {
    title: 'Automatically detect sync offset',
  });
  autoSyncBtn.style.display = 'none';
  
  let youtubeOffset = 0; // seconds to delay YouTube audio start
  let isAutoSyncing = false; // Track if auto-sync is in progress

  // YouTube reset button
  if (ytOffsetReset) {
    ytOffsetReset.addEventListener('click', () => {
      youtubeOffset = 0;
      ytOffsetSlider.value = "0";
      ytOffsetValue.textContent = "0.0s";
      _saveYtOffset();
      
      // If playing, re-sync scheduler to new offset mapping
      if (player.state === 'playing' && isYouTubeReady()) {
        _clearYtDelayTimeout();
        const currentTime = player.getPlaybackTime();
        if (currentTime >= 0) {
          player.resyncToTime(currentTime);
        }
      }
    });
  }

  row1.appendChild(fileLoader.fileBtn);
  row1.appendChild(fileLoader.fileInput);
  row1.appendChild(trackSelect);
  row1.appendChild(mixer.mixerToggle); // Mixer button moved to row1
  row1.appendChild(voiceSelect);
  row1.appendChild(ytOffsetWrap);
  row1.appendChild(autoSyncBtn);
  header.appendChild(row1);

  // --- Row 2: Transport ---
  const transport = createTransport({
    player,
    renderer,
    getTrackData: () => allTrackData.find(t => t.trackIndex === selectedTrackIndex),
  });

  const row2 = document.createElement('div');
  row2.className = 'tab-controls-row tab-controls-row-transport';
  row2.appendChild(transport.elements.playBtn);
  row2.appendChild(transport.elements.stopBtn);
  row2.appendChild(transport.elements.tempoWrap);
  row2.appendChild(transport.elements.loopWrap);
  row2.appendChild(transport.elements.metroBtn);
  header.appendChild(row2);

  // --- Row 3: Position ---
  const posDisplay = document.createElement('span');
  posDisplay.className = 'tab-position';
  posDisplay.textContent = '';

  const songInfo = document.createElement('span');
  songInfo.className = 'tab-song-info';
  songInfo.style.display = 'none'; // Hidden until a file is loaded
  songInfo.textContent = '';

  const infoRow = document.createElement('div');
  infoRow.className = 'tab-info-row';
  infoRow.appendChild(posDisplay);
  header.appendChild(infoRow);

  // --- Mixer panel ---
  header.appendChild(mixer.mixerWrap);

  // --- Assemble DOM ---
  group.appendChild(header);
  group.appendChild(canvasContainer);
  container.appendChild(group);

  // Floating UI elements (appended to body for fixed positioning)
  document.body.appendChild(exitBtn);
  document.body.appendChild(hudToggle);
  document.body.appendChild(fretboardOverlay);

  // --- Event wiring ---

  // GM program numbers for voice types (General MIDI)
  const VOICE_GM_PROGRAMS = {
    [VOICE_TYPES.ACOUSTIC]: 25,            // Acoustic Guitar (steel)
    [VOICE_TYPES.ELECTRIC_CLEAN]: 27,      // Electric Guitar (clean)
    [VOICE_TYPES.ELECTRIC_MUTED]: 28,      // Electric Guitar (muted)
    [VOICE_TYPES.OVERDRIVEN]: 29,          // Overdriven Guitar
    [VOICE_TYPES.DISTORTION]: 30,          // Distortion Guitar
  };

  voiceSelect.addEventListener('change', async () => {
    voiceSelect.disabled = true;
    const selectedOption = voiceSelect.options[voiceSelect.selectedIndex];
    const oldLabel = selectedOption.textContent;
    selectedOption.textContent = 'Loading...';

    const voice = voiceSelect.value;

    // Check if YouTube backing track selected
    if (isYouTubeVoice(voice)) {
      const videoId = getYouTubeVideoId(voice);
      youtubeVoiceActive = true;
      
      // Mute all synth audio when using YouTube backing
      player.setSynthMuted(true);
      
      try {
        await loadYouTubeAudio(videoId);
        songInfo.textContent = `${score.title} — ${score.artist} — YouTube ready`;
        
        // Load saved offset and checkpoints for this song/video
        _loadYtOffset();
        _loadCheckpoints();
      } catch (err) {
        console.error('Failed to load YouTube audio:', err);
        songInfo.textContent = `${score.title} — ${score.artist} — YouTube failed`;
        // Re-enable synth on failure
        player.setSynthMuted(false);
        youtubeVoiceActive = false;
      }
    } else {
      // Standard synth voice
      youtubeVoiceActive = false;
      player.setSynthMuted(false);
      unloadYouTube();
      
      // Reset UI offset display when leaving YouTube voice
      _loadYtOffset();
      checkpoints = [];

      if (voice === VOICE_TYPES.KARPLUS) {
        // "Default Synth" — bypass FluidSynth, use Karplus-Strong for tab playback
        fluidSetVoiceProgram(null);
      } else if (VOICE_GM_PROGRAMS[voice] !== undefined) {
        // Soundfont voice — use FluidSynth with the matching GM program
        fluidSetVoiceProgram(VOICE_GM_PROGRAMS[voice]);
        // Ensure channels are assigned when switching to FluidSynth
        _assignFluidChannels();
      }

      // Also update synth-voice.js (for fretboard click playback)
      await setVoiceType(voice);
    }

    selectedOption.textContent = oldLabel;
    voiceSelect.disabled = false;

    // Show/hide YouTube offset control, auto-sync button, and clear checkpoints
    ytOffsetWrap.style.display = youtubeVoiceActive ? '' : 'none';
    autoSyncBtn.style.display = youtubeVoiceActive ? '' : 'none';

    // Update player callbacks based on YouTube state
    _updateYouTubeCallbacks();
  });

  // YouTube offset slider - adjusts in real-time during playback
  ytOffsetSlider.addEventListener('input', () => {
    youtubeOffset = parseFloat(ytOffsetSlider.value);
    ytOffsetValue.textContent = `${youtubeOffset.toFixed(1)}s`;
    
    // Save to localStorage when offset changes
    _saveYtOffset();
    
    // If playing, re-sync the tab cursor to the new offset mapping.
    // The YouTube audio position doesn't change — only the mapping between
    // YouTube time and tab time shifts. Re-sync the scheduler index so it
    // matches the new timeline position.
    if (player.state === 'playing' && isYouTubeReady()) {
      _clearYtDelayTimeout();
      const currentTime = player.getPlaybackTime();
      if (currentTime >= 0) {
        // Re-sync scheduler index to match new timeline position
        player.resyncToTime(currentTime);
      }
    }
  });

  // Track delayed YouTube start for negative offsets
  let ytDelayTimeout = null;

  function _clearYtDelayTimeout() {
    if (ytDelayTimeout) {
      clearTimeout(ytDelayTimeout);
      ytDelayTimeout = null;
    }
  }

  // Auto-sync button click handler
  autoSyncBtn.addEventListener('click', async () => {
    if (isAutoSyncing) {
      // Cancel in-progress analysis
      cancelAnalysis();
      isAutoSyncing = false;
      autoSyncBtn.textContent = 'Auto';
      autoSyncBtn.classList.remove('active');
      return;
    }
    
    if (!isYouTubeReady() || !player.timeline) {
      console.warn('[AutoSync] YouTube not ready or no tab loaded');
      return;
    }
    
    const videoId = getCurrentVideoId();
    if (!videoId) return;
    
    isAutoSyncing = true;
    autoSyncBtn.classList.add('active');
    const originalText = autoSyncBtn.textContent;
    
    try {
      const audioUrl = `/api/youtube/stream/${videoId}`;
      
      const result = await autoSync(audioUrl, player.timeline, ({ stage, progress }) => {
        // Update button text with progress
        if (stage === 'tab') {
          autoSyncBtn.textContent = 'Tab...';
        } else if (stage === 'youtube') {
          autoSyncBtn.textContent = `YT ${Math.round(progress * 100)}%`;
        } else if (stage === 'correlate') {
          autoSyncBtn.textContent = 'Sync...';
        }
      });
      
      if (result.confidence > 0.1) {
        // Apply the detected offset
        youtubeOffset = result.offset;
        ytOffsetSlider.value = youtubeOffset;
        ytOffsetValue.textContent = `${youtubeOffset.toFixed(1)}s`;
        _saveYtOffset();
        
        // Flash success
        autoSyncBtn.textContent = `${result.offset.toFixed(1)}s`;
        autoSyncBtn.classList.add('success');
        setTimeout(() => {
          autoSyncBtn.classList.remove('success');
          autoSyncBtn.textContent = originalText;
        }, 2000);
        
        console.log(`[AutoSync] Applied offset: ${result.offset.toFixed(2)}s (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
        
        // If playing, re-sync scheduler to new offset mapping
        if (player.state === 'playing' && isYouTubeReady()) {
          _clearYtDelayTimeout();
          const currentTime = player.getPlaybackTime();
          if (currentTime >= 0) {
            player.resyncToTime(currentTime);
          }
        }
      } else {
        // Low confidence - show warning
        autoSyncBtn.textContent = 'N/A';
        autoSyncBtn.classList.add('warning');
        setTimeout(() => {
          autoSyncBtn.classList.remove('warning');
          autoSyncBtn.textContent = originalText;
        }, 2000);
        console.warn('[AutoSync] Low confidence result, offset not applied');
      }
    } catch (err) {
      console.error('[AutoSync] Failed:', err);
      autoSyncBtn.textContent = 'Err';
      autoSyncBtn.classList.add('error');
      setTimeout(() => {
        autoSyncBtn.classList.remove('error');
        autoSyncBtn.textContent = originalText;
      }, 2000);
    } finally {
      isAutoSyncing = false;
      autoSyncBtn.classList.remove('active');
    }
  });

  function _startDelayTimer(delaySeconds) {
    const delayMs = delaySeconds * 1000 / player.tempoScale;
    ytDelayTimeout = setTimeout(() => {
      if (player.state === 'playing') {
        playYouTube(0);
      }
    }, delayMs);
  }

  /**
   * Reverse mapping: tab timeline time → YouTube time.
   * Inverse of _ytTimeToTabTime, using the same checkpoint list.
   */
  function _tabTimeToYtTime(tabTime) {
    const cps = [{ tabTime: 0, ytTime: youtubeOffset }, ...checkpoints];

    // Before first checkpoint
    if (tabTime <= cps[0].tabTime) {
      return tabTime + cps[0].ytTime;
    }

    // Between checkpoints: interpolate
    for (let i = 0; i < cps.length - 1; i++) {
      if (tabTime <= cps[i + 1].tabTime) {
        const fraction = (tabTime - cps[i].tabTime) / (cps[i + 1].tabTime - cps[i].tabTime);
        return cps[i].ytTime + fraction * (cps[i + 1].ytTime - cps[i].ytTime);
      }
    }

    // After last checkpoint: extrapolate 1:1
    const last = cps[cps.length - 1];
    return last.ytTime + (tabTime - last.tabTime);
  }

  /**
   * Set up or clear YouTube audio sync callbacks on the player.
   */
  function _updateYouTubeCallbacks() {
    if (youtubeVoiceActive && isYouTubeReady()) {
      // Set the external clock using checkpoint-aware interpolation.
      // YouTube's audioElement is the single source of truth for timing.
      _updateExternalClock();

      player.setExternalAudioCallbacks({
        onPlay: (startTime) => {
          _clearYtDelayTimeout();
          setYouTubePlaybackRate(player.tempoScale);
          
          // Use checkpoint-aware mapping to find the YouTube position
          const ytTime = _tabTimeToYtTime(startTime);
          
          console.log(`[YT Sync] onPlay: tabTime=${startTime.toFixed(2)}, ytTime=${ytTime.toFixed(2)}, checkpoints=${checkpoints.length}`);
          
          if (ytTime >= 0) {
            seekYouTube(ytTime);
            playYouTube(ytTime);
          } else {
            // YouTube shouldn't start yet - delay it
            const delayMs = Math.abs(ytTime) * 1000 / player.tempoScale;
            console.log(`[YT Sync] Delaying YouTube start by ${delayMs.toFixed(0)}ms`);
            ytDelayTimeout = setTimeout(() => {
              if (player.state === 'playing') {
                playYouTube(0);
              }
            }, delayMs);
          }
        },
        onPause: () => {
          _clearYtDelayTimeout();
          pauseYouTube();
        },
        onStop: () => {
          _clearYtDelayTimeout();
          stopYouTube();
        },
        onSeek: (time) => {
          _clearYtDelayTimeout();
          const ytTime = _tabTimeToYtTime(time);
          
          if (ytTime >= 0) {
            seekYouTube(ytTime);
          } else {
            pauseYouTube();
            const delayMs = Math.abs(ytTime) * 1000 / player.tempoScale;
            if (player.state === 'playing') {
              ytDelayTimeout = setTimeout(() => {
                if (player.state === 'playing') {
                  playYouTube(0);
                }
              }, delayMs);
            }
          }
        },
        onTempoChange: (scale) => {
          setYouTubePlaybackRate(scale);
        },
      });
    } else {
      player.setExternalClock(null);
      player.clearExternalAudioCallbacks();
    }
  }

  trackSelect.addEventListener('change', () => {
    const idx = parseInt(trackSelect.value);
    if (!isNaN(idx)) {
      player.stop();
      selectTrack(idx);
    }
  });

  // --- Tabs-focused mode ---
  let fretboardVisible = false;

  // Reference to original fretboard container
  const originalFretboardContainer = document.getElementById('fretboard-container');

  function moveFretboardToOverlay() {
    // Clear overlay first
    fretboardOverlay.innerHTML = '';
    // Move current fretboard SVG to overlay
    const svg = originalFretboardContainer.querySelector('.fretboard-svg');
    if (svg) {
      fretboardOverlay.appendChild(svg);
    }
  }

  function moveFretboardBack() {
    // Move fretboard from overlay back to container
    const svg = fretboardOverlay.querySelector('.fretboard-svg');
    if (svg) {
      originalFretboardContainer.appendChild(svg);
    }
  }

  function enterFocusedMode() {
    isFocusedMode = true;
    showHud();
    document.body.classList.add('tabs-focused');
    window.dispatchEvent(new Event('resize'));
    moveFretboardToOverlay();
  }

  function exitFocusedMode() {
    if (!isFocusedMode) return;
    isFocusedMode = false;
    fretboardVisible = false;
    showHud();
    document.body.classList.remove('tabs-focused');
    fretboardOverlay.classList.remove('visible');
    hudToggle.classList.remove('active');
    moveFretboardBack();
    window.dispatchEvent(new Event('resize'));
    // Switch back to scales view
    setActiveView('scales');
  }

  // When tuning changes while in focused mode, move the new fretboard to overlay
  events.on(TUNING_CHANGE, () => {
    if (isFocusedMode) {
      // Small delay to let main.js create the new fretboard first
      setTimeout(moveFretboardToOverlay, 10);
    }
  });

  function toggleFretboard() {
    fretboardVisible = !fretboardVisible;
    fretboardOverlay.classList.toggle('visible', fretboardVisible);
    hudToggle.classList.toggle('active', fretboardVisible);
  }

  exitBtn.addEventListener('click', exitFocusedMode);
  hudToggle.addEventListener('click', toggleFretboard);

  // Auto-enter focused mode when tabs view is shown
  events.on(VIEW_CHANGE, ({ view }) => {
    if (view === 'tabs') {
      enterFocusedMode();
    } else {
      exitFocusedMode();
    }
  });

  // --- YouTube sync checkpoints ---
  // Checkpoints map tab timeline positions to YouTube audio positions.
  // The user places them when drift occurs: pause, press C, click where
  // the audio actually is in the tab. On subsequent plays, the external
  // clock interpolates between checkpoints to warp the tab's timeline
  // to match the recording's actual tempo variations.
  let checkpointMode = false;
  let checkpoints = []; // [{ tabTime, ytTime }] sorted by tabTime
  let checkpointYtTime = 0; // YouTube time captured when checkpoint mode entered

  function _getCheckpointKey() {
    if (!score || !youtubeVoiceActive) return null;
    const videoId = getYouTubeVideoId(voiceSelect.value);
    if (!videoId) return null;
    return `yt-checkpoints:${score.artist}:${score.title}:${videoId}`;
  }

  function _saveCheckpoints() {
    const key = _getCheckpointKey();
    if (key) {
      localStorage.setItem(key, JSON.stringify(checkpoints));
      console.log(`[Checkpoints] Saved ${checkpoints.length} checkpoints for ${key}`);
    }
  }

  function _loadCheckpoints() {
    const key = _getCheckpointKey();
    if (key) {
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          checkpoints = JSON.parse(saved);
          console.log(`[Checkpoints] Loaded ${checkpoints.length} checkpoints for ${key}`);
        } catch (e) {
          checkpoints = [];
        }
      } else {
        checkpoints = [];
      }
    } else {
      checkpoints = [];
    }
    _updateExternalClock();
    _syncCheckpointMarkers();
  }

  function _clearCheckpoints() {
    checkpoints = [];
    const key = _getCheckpointKey();
    if (key) localStorage.removeItem(key);
    _updateExternalClock();
    _syncCheckpointMarkers();
    console.log('[Checkpoints] Cleared');
  }

  function _addCheckpoint(tabTime, ytTime) {
    // Remove any existing checkpoint close to this tabTime (within 1s)
    checkpoints = checkpoints.filter(cp => Math.abs(cp.tabTime - tabTime) > 1.0);
    checkpoints.push({ tabTime, ytTime });
    checkpoints.sort((a, b) => a.tabTime - b.tabTime);
    _saveCheckpoints();
    _updateExternalClock();
    _syncCheckpointMarkers();
  }

  /**
   * Update the renderer's checkpoint markers to match current checkpoints.
   * Converts tabTime values to beat indices using binary search.
   */
  function _syncCheckpointMarkers() {
    if (!player.timeline) {
      renderer.setCheckpoints([]);
      return;
    }
    const indices = new Set();
    for (const cp of checkpoints) {
      // Find the closest beat index at this tabTime
      const idx = _findBeatIndexAtTime(cp.tabTime);
      if (idx >= 0) indices.add(idx);
    }
    renderer.setCheckpoints(indices);
  }

  function _findBeatIndexAtTime(time) {
    const tl = player.timeline;
    if (!tl || tl.length === 0) return -1;
    // Binary search for insertion point
    let lo = 0, hi = tl.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (tl[mid].time < time) lo = mid + 1;
      else hi = mid - 1;
    }
    // lo is the first index >= time. Pick the closest of lo and lo-1.
    if (lo >= tl.length) return tl.length - 1;
    if (lo === 0) return 0;
    const diffLo = Math.abs(tl[lo].time - time);
    const diffPrev = Math.abs(tl[lo - 1].time - time);
    return diffPrev <= diffLo ? lo - 1 : lo;
  }

  /**
   * Piecewise linear interpolation: given YouTube audio time, return tab timeline time.
   * Uses the offset as an implicit first checkpoint (tabTime=0, ytTime=offset).
   * Between checkpoints, linearly interpolates to account for tempo variation.
   */
  function _ytTimeToTabTime(currentYtTime) {
    // Build the effective checkpoint list: offset + user checkpoints
    const cps = [{ tabTime: 0, ytTime: youtubeOffset }, ...checkpoints];

    // Before first checkpoint
    if (currentYtTime <= cps[0].ytTime) {
      return currentYtTime - cps[0].ytTime; // may be negative (before tab starts)
    }

    // Between checkpoints: interpolate
    for (let i = 0; i < cps.length - 1; i++) {
      if (currentYtTime <= cps[i + 1].ytTime) {
        const fraction = (currentYtTime - cps[i].ytTime) / (cps[i + 1].ytTime - cps[i].ytTime);
        return cps[i].tabTime + fraction * (cps[i + 1].tabTime - cps[i].tabTime);
      }
    }

    // After last checkpoint: extrapolate using the tab's native tempo
    // (i.e. 1:1 mapping from the last checkpoint onward)
    const last = cps[cps.length - 1];
    return last.tabTime + (currentYtTime - last.ytTime);
  }

  /**
   * Update the external clock function based on current checkpoints.
   */
  function _updateExternalClock() {
    if (youtubeVoiceActive && isYouTubeReady()) {
      player.setExternalClock(() => {
        const ytTime = getYouTubeTime();
        if (ytTime < 0) return -1;
        return _ytTimeToTabTime(ytTime);
      });
    }
  }

  function _enterCheckpointMode() {
    if (!youtubeVoiceActive || !isYouTubeReady()) return;
    if (player.state !== 'paused') return;

    // Capture the YouTube time at the moment the user enters checkpoint mode
    checkpointYtTime = getYouTubeTime();
    if (checkpointYtTime < 0) return;

    checkpointMode = true;
    renderer.overlayCanvas.style.cursor = 'crosshair';
    songInfo.textContent = 'Click where the audio is in the tab...';
    console.log(`[Checkpoints] Mode entered — ytTime=${checkpointYtTime.toFixed(2)}s`);
  }

  function _exitCheckpointMode() {
    checkpointMode = false;
    renderer.overlayCanvas.style.cursor = '';
    if (score) {
      songInfo.textContent = `${score.title} — ${score.artist}`;
    }
  }

  function _handleCheckpointClick(index) {
    if (!checkpointMode) return false;

    // The user clicked beat `index` — get its tab timeline time
    const event = player.timeline[index];
    if (!event) {
      _exitCheckpointMode();
      return true;
    }

    const tabTime = event.time;
    _addCheckpoint(tabTime, checkpointYtTime);

    console.log(`[Checkpoints] Added: tabTime=${tabTime.toFixed(2)}s ↔ ytTime=${checkpointYtTime.toFixed(2)}s (${checkpoints.length} total)`);

    // Brief visual feedback
    const prevText = songInfo.textContent;
    songInfo.textContent = `Checkpoint set (${checkpoints.length} total)`;
    setTimeout(() => {
      if (score) songInfo.textContent = `${score.title} — ${score.artist}`;
    }, 1500);

    _exitCheckpointMode();

    // Seek to the clicked position and resume
    player.resyncToTime(tabTime);
    player.seekTo(index);
    renderer.setCursor(index);
    transport.actions.togglePlayPause(); // resume

    return true; // consumed the click
  }

  renderer.onCanvasClick((index) => {
    if (_handleCheckpointClick(index)) return;
    transport.actions.handleCanvasClick(index);
  });

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    if (!container.offsetParent) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        transport.actions.togglePlayPause();
        break;
      case 'ArrowRight':
        e.preventDefault();
        transport.actions.seekRelative(transport.SEEK_STEP);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        transport.actions.seekRelative(-transport.SEEK_STEP);
        break;
      case 'Escape':
        e.preventDefault();
        if (checkpointMode) {
          _exitCheckpointMode();
        } else if (isFocusedMode) {
          exitFocusedMode();
        } else {
          posDisplay.textContent = transport.actions.doStop();
        }
        break;
      case 'KeyF':
        // Toggle fretboard with 'F' key
        if (isFocusedMode) {
          e.preventDefault();
          toggleFretboard();
        }
        break;
      case 'KeyC':
        if (youtubeVoiceActive && e.shiftKey) {
          // Shift+C: Clear all checkpoints for this song
          e.preventDefault();
          _clearCheckpoints();
          songInfo.textContent = 'Checkpoints cleared';
          setTimeout(() => {
            if (score) songInfo.textContent = `${score.title} — ${score.artist}`;
          }, 1500);
        } else if (youtubeVoiceActive && player.state === 'paused') {
          // C: Enter checkpoint mode
          e.preventDefault();
          _enterCheckpointMode();
        }
        break;
    }
  });

  // --- Event bus: visual sync ---
  // Smooth cursor loop — continuously interpolates cursor position from audio clock
  let cursorRafId = null;

  function startSmoothCursor() {
    if (cursorRafId) return;
    const tick = () => {
      const t = player.getPlaybackTime();
      if (t >= 0) renderer.setCursorSmooth(t);
      cursorRafId = requestAnimationFrame(tick);
    };
    cursorRafId = requestAnimationFrame(tick);
  }

  function stopSmoothCursor() {
    if (cursorRafId) {
      cancelAnimationFrame(cursorRafId);
      cursorRafId = null;
    }
    renderer._playing = false;
  }

  function hideHud() {
    document.body.classList.add('hud-hidden');
    header.classList.add('hud-hidden');
    exitBtn.style.opacity = '0';
    hudToggle.style.opacity = '0';
  }

  function showHud() {
    document.body.classList.remove('hud-hidden');
    header.classList.remove('hud-hidden');
    exitBtn.style.opacity = '';
    hudToggle.style.opacity = '';
  }

  events.on(TAB_BEAT_ON, () => {
    // Start smooth cursor on first beat of playback
    startSmoothCursor();
    
    // Auto-hide HUD during playback only if mouse hasn't moved recently
    const now = Date.now();
    if (isFocusedMode && player.state === 'playing' && (now - lastMouseMove > HUD_HIDE_DELAY)) {
      hideHud();
    }
  });

  events.on(TAB_STOP, () => {
    stopSmoothCursor();
    renderer.clearCursor();
    transport.actions.onPlaybackStopped();
    // Show HUD when playback stops
    if (isFocusedMode) {
      clearTimeout(hudTimeout);
      showHud();
    }
  });

  // Watch for player state changes (pause, etc.)
  setInterval(() => {
    const currentState = player.state;
    if (currentState !== lastPlayerState) {
      lastPlayerState = currentState;
      if (currentState === 'paused') {
        stopSmoothCursor();
        renderer.cursorEl.style.display = 'none';
        renderer._needsFullOverlayRedraw = true;
        renderer._renderOverlay();
      }
      if (currentState !== 'playing' && isFocusedMode) {
        // Show HUD immediately
        clearTimeout(hudTimeout);
        showHud();
      }
    }
  }, 100);
  
  document.addEventListener('mousemove', () => {
    if (!isFocusedMode) return;
    
    const now = Date.now();
    if (now - lastMouseMove < MOUSE_THROTTLE) return;
    lastMouseMove = now;
    
    showHud();
    clearTimeout(hudTimeout);
    
    // During playback, set a timeout to hide the HUD again after some inactivity
    if (player.state === 'playing') {
      hudTimeout = setTimeout(() => {
        if (player.state === 'playing' && isFocusedMode) {
          hideHud();
        }
      }, HUD_HIDE_DELAY);
    }
  });

  events.on(TAB_POSITION, ({ masterBarIndex, totalBars }) => {
    posDisplay.textContent = `Bar ${masterBarIndex + 1} / ${totalBars}`;
  });

  // --- Internal helpers ---

  function handleFileLoaded(loadedScore, loadedTrackData) {
    score = loadedScore;
    allTrackData = loadedTrackData;

    // Scroll to top of the page when a new file is loaded
    window.scrollTo(0, 0);

    // Reset to default synth voice when loading a new file
    youtubeVoiceActive = false;
    player.setSynthMuted(false);
    unloadYouTube();
    voiceSelect.value = VOICE_TYPES.KARPLUS;
    fluidSetVoiceProgram(null);
    ytOffsetWrap.style.display = 'none';
    autoSyncBtn.style.display = 'none';
    _updateYouTubeCallbacks();

    songInfo.textContent = `${score.title} \u2014 ${score.artist}`;

    // Populate track selector (filter out drums)
    trackSelect.innerHTML = '';
    score.tracks.forEach((t, i) => {
      if (t.isDrum) return;
      if (!allTrackData.find(td => td.trackIndex === i)) return;
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = t.name;
      trackSelect.appendChild(opt);
    });

    trackSelect.disabled = false;
    transport.actions.enableControls();

    mixer.buildMixer(score, allTrackData, selectedTrackIndex, trackSelect);

    if (trackSelect.options.length > 0) {
      trackSelect.selectedIndex = 0;
      const firstTrackIdx = parseInt(trackSelect.value);
      initPlayer(firstTrackIdx);
      selectTrack(firstTrackIdx);
    }

    events.emit(TAB_LOADED, { score });

    // Initialize FluidSynth lazily on first file load
    _ensureFluidSynth();

    // Search YouTube for backing tracks (async, updates dropdown when ready)
    _searchYouTubeBacking();
  }

  /**
   * Search YouTube for backing tracks matching the current song.
   * Results are added to the voice selector asynchronously.
   */
  async function _searchYouTubeBacking() {
    if (!score || !score.artist || !score.title) return;

    // Check if proxy server is available
    const proxyUp = await isProxyAvailable();
    if (!proxyUp) {
      console.log('[YouTube] Proxy server not available');
      return;
    }

    // Remove any existing YouTube options
    _clearYouTubeOptions();

    // Add separator
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = '── YouTube Backing ──';
    separator.className = 'youtube-separator';
    voiceSelect.appendChild(separator);

    // Add loading placeholder
    const loadingOpt = document.createElement('option');
    loadingOpt.disabled = true;
    loadingOpt.textContent = 'Searching...';
    loadingOpt.className = 'youtube-loading';
    voiceSelect.appendChild(loadingOpt);

    // Save original placeholder and show searching status on the select itself
    const originalPlaceholder = voiceSelect.options[0].textContent;
    if (!youtubeVoiceActive) {
      voiceSelect.options[0].textContent = 'Searching YouTube...';
    }

    try {
      const results = await searchYouTube(score.artist, score.title, 5);
      
      // Restore placeholder
      voiceSelect.options[0].textContent = originalPlaceholder;
      
      // Remove loading placeholder
      const loading = voiceSelect.querySelector('.youtube-loading');
      if (loading) loading.remove();

      if (results.length === 0) {
        const noResults = document.createElement('option');
        noResults.disabled = true;
        noResults.textContent = 'No results found';
        voiceSelect.appendChild(noResults);
        return;
      }

      // Add YouTube results
      for (const result of results) {
        const opt = document.createElement('option');
        opt.value = `${VOICE_TYPES.YOUTUBE_PREFIX}${result.id}`;
        opt.className = 'youtube-option';
        
        // Format: "Title (Channel) - 3:45"
        const duration = _formatDuration(result.duration);
        const title = result.title.length > 40 
          ? result.title.slice(0, 37) + '...' 
          : result.title;
        opt.textContent = `${title} (${duration})`;
        opt.title = `${result.title}\n${result.channel}`;
        
        voiceSelect.appendChild(opt);
      }

      console.log(`[YouTube] Found ${results.length} results for "${score.artist} - ${score.title}"`);
    } catch (err) {
      console.error('[YouTube] Search failed:', err);
      const loading = voiceSelect.querySelector('.youtube-loading');
      if (loading) {
        loading.textContent = 'Search failed';
      }
    } finally {
      // Ensure placeholder is restored if it was changed
      if (voiceSelect.options[0]) {
        voiceSelect.options[0].textContent = originalPlaceholder;
      }
    }
  }

  function _clearYouTubeOptions() {
    // Remove all YouTube-related options
    const toRemove = voiceSelect.querySelectorAll('.youtube-separator, .youtube-loading, .youtube-option');
    toRemove.forEach(opt => opt.remove());
  }

  function _formatDuration(seconds) {
    if (!seconds) return '??:??';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  async function _ensureFluidSynth() {
    if (isFluidReady() || isFluidLoading()) {
      // Already loaded or loading — just assign channels
      if (isFluidReady()) _assignFluidChannels();
      return;
    }

    songInfo.textContent += ' \u2014 Loading SoundFont...';

    try {
      await initFluidSynth((loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        songInfo.textContent = `${score.title} \u2014 ${score.artist} \u2014 SoundFont ${pct}%`;
      });
      songInfo.textContent = `${score.title} \u2014 ${score.artist}`;
      _assignFluidChannels();
    } catch (err) {
      console.warn('FluidSynth unavailable, using fallback synth:', err.message);
      songInfo.textContent = `${score.title} \u2014 ${score.artist}`;
    }
  }

  function _assignFluidChannels() {
    if (!isFluidReady() || !score || allTrackData.length === 0) return;
    assignChannels(allTrackData.map(td => ({
      trackIndex: td.trackIndex,
      isDrum: td.isDrum,
      midiProgram: score.tracks[td.trackIndex].midiProgram,
      midiBank: score.tracks[td.trackIndex].midiBank,
    })));
  }

  function initPlayer(primaryTrackIndex) {
    const primaryIdx = allTrackData.findIndex(t => t.trackIndex === primaryTrackIndex);
    if (primaryIdx < 0) return;

    player.setTracks(
      allTrackData.map(t => ({
        timeline: t.timeline,
        measures: t.measures,
        isDrum: t.isDrum,
        tuning: t.tuning,
      })),
      primaryIdx,
    );
  }

  function selectTrack(trackIndex) {
    if (!score) return;
    selectedTrackIndex = trackIndex;

    const trackDataIdx = allTrackData.findIndex(t => t.trackIndex === trackIndex);
    if (trackDataIdx < 0) return;

    const trackData = allTrackData[trackDataIdx];
    posDisplay.textContent = `Bar 1 / ${trackData.measures.length}`;
    transport.actions.resetLoopState();

    player.setPrimary(trackDataIdx);
    updateRenderer();
    mixer.updateMixerUI(allTrackData, selectedTrackIndex);
    _syncCheckpointMarkers();
  }

  function updateRenderer() {
    if (!score || selectedTrackIndex === null) return;
    const td = allTrackData.find(t => t.trackIndex === selectedTrackIndex);
    if (!td) return;

    const track = score.tracks[td.trackIndex];
    renderer.setData({
      timeline: td.timeline,
      measures: td.measures,
      stringCount: track.stringCount,
      title: score.title,
      artist: score.artist,
      name: track.name,
      tuning: td.tuning,
    });

    // Emit tuning change for fretboard update
    if (td.tuning && td.tuning.length === 6) {
      const tuningName = td.tuning.map(midi => midiToNoteName(midi)).join(' ');
      events.emit(TUNING_CHANGE, {
        tuning: td.tuning,
        name: tuningName,
        source: 'tab'
      });
    }
  }

  // --- Persistence helpers ---

  function _getSaveKey() {
    if (!score || !youtubeVoiceActive) return null;
    const videoId = getYouTubeVideoId(voiceSelect.value);
    if (!videoId) return null;
    // Key based on title, artist and videoId for uniqueness
    return `yt-offset:${score.artist}:${score.title}:${videoId}`;
  }

  function _saveYtOffset() {
    const key = _getSaveKey();
    if (key) {
      localStorage.setItem(key, youtubeOffset.toString());
      console.log(`[YouTube] Saved offset for ${key}: ${youtubeOffset.toFixed(2)}s`);
    }
  }

  function _loadYtOffset() {
    const key = _getSaveKey();
    if (key) {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        youtubeOffset = parseFloat(saved);
        ytOffsetSlider.value = youtubeOffset;
        ytOffsetValue.textContent = `${youtubeOffset.toFixed(1)}s`;
        console.log(`[YouTube] Loaded offset for ${key}: ${youtubeOffset.toFixed(2)}s`);
      } else {
        // Default to 0 if no saved offset
        youtubeOffset = 0;
        ytOffsetSlider.value = 0;
        ytOffsetValue.textContent = "0.0s";
        console.log(`[YouTube] No saved offset for ${key}, using 0.0s`);
      }
    } else {
      // If not a YouTube voice, ensure offset is reset for UI consistency
      youtubeOffset = 0;
      ytOffsetSlider.value = 0;
      ytOffsetValue.textContent = "0.0s";
    }
  }
}
