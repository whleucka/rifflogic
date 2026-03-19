// Tab transport controls: play/pause/stop, tempo, loop, metronome

import { buildButton, buildSlider } from './dom-helpers.js';
import * as settings from '../settings.js';

const SEEK_STEP = 5; // beats to skip on arrow key press

/**
 * Create transport control elements and wire up their logic.
 * @param {object} deps - { player, renderer, getTrackData }
 * @returns {object} - { elements, state, actions }
 */
export function createTransport(deps) {
  const { player, renderer, getTrackData } = deps;

  // --- Play / Stop buttons ---
  const playBtn = buildButton('\u25B6 Play', 'toggle-btn', { disabled: true });
  const stopBtn = buildButton('\u25A0 Stop', 'toggle-btn', { disabled: true });

  // --- Tempo slider --- load saved value
  const savedTempo = settings.get('tempo');
  const { wrap: tempoWrap, slider: tempoSlider, valueSpan: tempoValue } = buildSlider({
    className: 'bpm-control',
    label: 'Speed',
    min: 25,
    max: 150,
    value: savedTempo,
    valueText: savedTempo + '%',
  });

  // Apply saved tempo on creation
  player.setTempoScale(savedTempo / 100);

  // --- Loop controls ---
  const loopLabel = document.createElement('span');
  loopLabel.className = 'caged-label';
  loopLabel.textContent = 'Loop:';

  const loopStatus = document.createElement('span');
  loopStatus.className = 'loop-status';
  loopStatus.textContent = 'Off';

  const loopClearBtn = buildButton('\u2715', 'caged-btn', { title: 'Clear loop', disabled: true });

  const loopWrap = document.createElement('div');
  loopWrap.className = 'tab-loop-controls';
  loopWrap.appendChild(loopLabel);
  loopWrap.appendChild(loopStatus);
  loopWrap.appendChild(loopClearBtn);

  // --- Metronome toggle ---
  const metroBtn = buildButton('\u23F1', 'caged-btn', { title: 'Toggle Metronome', disabled: true });

  // --- State ---
  let loopStartMeasure = null;
  let loopEndMeasure = null;

  // --- Actions ---

  function togglePlayPause() {
    const trackData = getTrackData();
    if (!trackData || trackData.timeline.length === 0) return;

    if (player.state === 'playing') {
      player.pause();
      playBtn.textContent = '\u25B6 Play';
    } else if (player.state === 'paused') {
      player.resume();
      playBtn.textContent = '\u23F8 Pause';
    } else {
      // Start from loop start if a loop is active, otherwise from current position
      const startIdx = player.loopA !== null ? player.loopA : player.currentIndex;
      player.play(startIdx);
      playBtn.textContent = '\u23F8 Pause';
    }
  }

  function doStop() {
    player.stop();
    playBtn.textContent = '\u25B6 Play';
    renderer.clearCursor();
    const trackData = getTrackData();
    return trackData ? `Bar 1 / ${trackData.measures.length}` : '';
  }

  function seekRelative(delta) {
    if (!player.timeline || player.timeline.length === 0) return;
    const newIndex = Math.max(0, Math.min(player.currentIndex + delta, player.timeline.length - 1));
    player.seekTo(newIndex);
    renderer.setCursor(newIndex);
  }

  function clearLoop() {
    loopStartMeasure = null;
    loopEndMeasure = null;
    loopStatus.textContent = 'Off';
    player.setLoop(null, null);
    renderer.setLoop(null, null);
  }

  /**
   * Set loop by measure range (from drag-to-select).
   * @param {number} startMeasureIdx - index in track.measures
   * @param {number} endMeasureIdx - index in track.measures
   */
  function setLoopByMeasures(startMeasureIdx, endMeasureIdx) {
    const trackData = getTrackData();
    if (!trackData) return;

    const measures = trackData.measures;
    if (!measures || startMeasureIdx < 0 || endMeasureIdx >= measures.length) return;

    const startMeasure = measures[startMeasureIdx];
    const endMeasure = measures[endMeasureIdx];
    if (!startMeasure || !endMeasure) return;

    // First beat of start measure, last beat of end measure
    const loopA = startMeasure.beatIndices[0];
    const loopB = endMeasure.beatIndices[endMeasure.beatIndices.length - 1];

    loopStartMeasure = startMeasureIdx;
    loopEndMeasure = endMeasureIdx;

    // Update status display
    if (startMeasureIdx === endMeasureIdx) {
      loopStatus.textContent = `Bar ${startMeasure.masterBarIndex + 1}`;
    } else {
      loopStatus.textContent = `Bar ${startMeasure.masterBarIndex + 1}–${endMeasure.masterBarIndex + 1}`;
    }

    player.setLoop(loopA, loopB);
    renderer.setLoop(loopA, loopB);

    // Seek to loop start so cursor shows the selection
    if (player.state !== 'playing') {
      player.seekTo(loopA);
      renderer.setCursor(loopA);
    }
  }

  function handleCanvasClick(index) {
    if (player.state !== 'playing') {
      player.seekTo(index);
      renderer.setCursor(index);
    }
  }

  function resetLoopState() {
    loopStartMeasure = null;
    loopEndMeasure = null;
    loopStatus.textContent = 'Off';
  }

  function enableControls() {
    playBtn.disabled = false;
    stopBtn.disabled = false;
    loopClearBtn.disabled = false;
    metroBtn.disabled = false;
  }

  function onPlaybackStopped() {
    playBtn.textContent = '\u25B6 Play';
  }

  // --- Wire up event listeners ---

  playBtn.addEventListener('click', togglePlayPause);
  stopBtn.addEventListener('click', () => doStop());

  tempoSlider.addEventListener('input', () => {
    const pct = parseInt(tempoSlider.value);
    tempoValue.textContent = pct + '%';
    player.setTempoScale(pct / 100);
    settings.set('tempo', pct);
  });

  loopClearBtn.addEventListener('click', clearLoop);

  metroBtn.addEventListener('click', () => {
    const enabled = !player.metronomeEnabled;
    player.setMetronomeEnabled(enabled);
    metroBtn.classList.toggle('active', enabled);
  });

  // --- Wire up drag-to-select on renderer ---
  renderer.onDragSelect((startMeasureIdx, endMeasureIdx) => {
    setLoopByMeasures(startMeasureIdx, endMeasureIdx);
  });

  return {
    elements: { playBtn, stopBtn, tempoWrap, loopWrap, metroBtn },
    actions: {
      togglePlayPause,
      doStop,
      seekRelative,
      handleCanvasClick,
      resetLoopState,
      enableControls,
      onPlaybackStopped,
      clearLoop,
      setLoopByMeasures,
    },
    SEEK_STEP,
  };
}
