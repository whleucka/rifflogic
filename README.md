# RiffLogic
<img width="1190" height="1060" alt="image" src="https://github.com/user-attachments/assets/cb43216a-9b5b-4707-bc7c-b64c36eda7fe" />


> Work in progress

Guitar practice tool. Scales, chords, and a Guitar Pro tab viewer with multi-track playback.

Built with vanilla JS, Web Audio API, and FluidSynth (WASM).

## Features

- **Scale & mode explorer**: all major/minor modes, pentatonics, blues, etc. Interactive fretboard with note highlighting
- **Chord practice**: chord library with fingering diagrams, strum playback
- **Guitar Pro tab viewer**: load .gp5/.gp6/.gp7 files, rendered to canvas with notation
- **Multi-track playback**: plays all tracks with GM-accurate voices via FluidSynth (WASM), track mixer with solo/mute
- **YouTube backing tracks**: search and sync YouTube audio with tab playback, per-song offset saved automatically, sync checkpoints for drift correction
- **Tempo control**: adjustable playback speed, metronome with click track
- **Loop mode**: A/B loop points for practicing sections
- **Multiple voice types**: Karplus-Strong, acoustic, clean electric, overdriven, muted (FluidSynth GM patches)
- **Fullscreen tab viewer**: distraction-free mode with floating HUD controls
- **Fretboard overlay**: live fretboard visualization during tab playback

## Soundfont

Multi-track playback uses the SGM-V2.01 General MIDI soundfont. Download the [SF2 file](https://archive.org/download/SGM-V2.01/SGM-V2.01.sf2) and place it at `assets/SGM-V2.01.sf2`. It's ~247MB and cached in IndexedDB after first load.

## Guitar Pro tabs

Load any `.gp` file from the tab viewer. You can find tabs at:

- [Songsterr](https://www.songsterr.com/)
- [Ultimate Guitar](https://www.ultimate-guitar.com/)

## Running

Serve the project root with any static file server. The YouTube integration requires the proxy:

```bash
cd server && npm install && node server/index.js
```

Needs `yt-dlp` installed for YouTube audio streaming.

## Architecture

```
js/
  audio/          # Web Audio, FluidSynth WASM, Karplus-Strong fallback, YouTube sync
  music/          # Theory: notes, chords, scales, intervals
  fretboard/      # SVG fretboard rendering + interaction
  tab/            # GP parser, layout engine, canvas renderer, playback
  ui/             # Controls, selectors, toolbar, tab mixer/transport
lib/              # jszip, FluidSynth WASM, js-synthesizer
server/           # Express proxy for yt-dlp (search, stream, cache)
assets/           # SGM-V2.01.sf2 soundfont (247MB)
```

### Audio pipeline

```
Karplus-Strong (fallback) ─┐
FluidSynth (WASM/SF2)     ─┤
Drum Voice                ─┼─> Master Gain ─> Compressor ─> Output
Metronome Click           ─┤
YouTube Audio Element     ─┘
```

### Tab viewer

GP files (.gp5/.gp6/.gp7) are unzipped in-browser (jszip), parsed from GPIF XML, and rendered to a canvas. The layout engine dynamically groups measures into systems based on content width, with proportional beat spacing and minimum note distance enforcement.

Notation supported: hammer-on/pull-off arcs, slides (shift/legato/in/out), bends, natural harmonics, vibrato (Songsterr-style zigzag), palm muting, tuplet brackets, ties, pick strokes, rhythm stems with beaming.

## Dev journal

Lessons learned, rabbit holes, and things worth remembering.

### FluidSynth + SGM-V2.01.sf2

The SF2 file is 247MB. Loading it into FluidSynth WASM is expensive. We lazy-load it and cache in IndexedDB so subsequent loads skip the network fetch. Even so, initial parse time in WASM is noticeable.

The `ScriptProcessorNode` bridge between FluidSynth and Web Audio is a known bottleneck. Buffer size is 8192 samples. Smaller values cause glitches, larger values add latency (I think...) There's no good answer here until AudioWorklet integration is solid. The worklet file exists (`js-synthesizer.worklet.js`) but reliability varies across browsers.

Tried multiple soundfonts before settling on SGM-V2.01. Most GM soundfonts are either too large (500MB+) or sound terrible for guitar. SGM-V2.01 is a reasonable compromise = decent acoustic/electric guitar patches, full GM coverage for multi-track playback, and the file size is manageable with caching.

Karplus-Strong is the default voice and sounds surprisingly good for single-note lines. FluidSynth kicks in when you need accurate GM program changes across tracks (e.g., clean vs. overdriven guitar, bass, keys).

### YouTube sync

This was the biggest time sink. The goal: play a YouTube backing track synchronized with the tab scrolling/playback.

**The proxy approach**: Browser can't fetch YouTube audio directly (CORS). The server uses `yt-dlp` to grab audio, caches it locally (500MB cap, 24h TTL), and streams it back with range request support for seeking.

**The dual clock problem**: The tab player originally used `AudioContext.currentTime` to drive its scheduler and cursor. The YouTube audio runs on `HTMLAudioElement`, which has its own independent clock. These two clocks drift apart over time. Even small rate differences compound, and by a couple minutes into a song the cursor and audio are noticeably out of sync.

The fix was to flip the clock hierarchy. In YouTube mode, the tab player reads its time directly from `audioElement.currentTime` instead of `AudioContext.currentTime`. This is done through an external clock function that the player calls for all timing decisions (cursor position, beat scheduling). One clock, zero drift.

**Recording tempo vs tab tempo**: Even after fixing the clock drift, the cursor still runs ahead of the audio. The tab assumes a fixed tempo (e.g. 104 BPM) but real recordings don't hold a perfectly steady tempo. Bands speed up and slow down slightly throughout a song. Over 40+ bars these micro-variations accumulate and the theoretical beat positions in the tab diverge from where the beats actually land in the recording.

There is no automatic solution to this. We tried several approaches to detect and correct drift programmatically, but none worked reliably across different songs and recordings. The problem is fundamentally that the tab's tempo map doesn't match the recording's actual tempo.

**Sync checkpoints**: The solution is manual user correction through checkpoints. When the user notices drift during playback, they pause, press `C`, and click where in the tab the audio actually was. This records a mapping: "this beat in the tab = this position in the YouTube audio." On subsequent plays, the external clock uses piecewise linear interpolation between checkpoints to warp the tab's timeline to match the recording. More checkpoints = tighter sync. Checkpoints are saved to localStorage per song/video combo.

The checkpoint system works because it doesn't touch the YouTube audio at all. The audio plays at a constant rate. Only the tab cursor speed is adjusted between checkpoints to stay aligned. The user effectively builds a custom tempo map that matches the real recording.

**What didn't work**:
- Trying to use the YouTube IFrame API for audio: too much latency, no precise time control
- Attempting to sync via `requestAnimationFrame` polling: jittery, especially under CPU load
- Periodically seeking the YouTube audio element to correct drift: causes audible glitches (pops, stutters) every few seconds
- Auto-detecting drift from audio analysis: the fundamental issue is tempo variation in the recording, not clock drift. No amount of analysis can predict where the next beat will land in a live recording

**Search ranking**: YouTube search results are re-ranked to prioritize official channels (VEVO, Topic) and penalize live recordings, covers, and remixes. The user still picks from a list, but studio album tracks float to the top.

**Keyboard shortcuts for checkpoints**:
- `C` (while paused with YouTube active): enter checkpoint mode, then click on the tab where the audio is
- `Shift+C`: clear all checkpoints for the current song
- `Escape`: cancel checkpoint mode without placing one

Checkpoints are shown on the score as small amber diamond markers.

### GP file parsing

Guitar Pro files are ZIP archives containing GPIF XML. The format is mostly undocumented. We reverse-engineered the structure by comparing output against Songsterr and other GP viewers.

Key gotchas:
- **Vibrato encoding**: Can appear as `<Property name="Vibrato">` inside `<Properties>` OR as a direct `<Vibrato>Slight|Wide</Vibrato>` child element on `<Note>`. Some files use one, some use the other, some use both. You have to check both.
- **Slide flags are a bitmask**: `1`=shift slide, `2`=legato slide, `4`=slide out down, `8`=slide out up, `16`=slide in from below, `32`=slide in from above. The parser originally treated it as a boolean.
- **Tuplet rendering**: Triplet brackets belong below the staff (near rhythm stems), not above. HOPO chains inside tuplets (e.g., 11-12-11) look best as a single spanning arc from first to last note, not individual per-note arcs.
- **Tied notes across systems**: Ties that cross system breaks need special handling: arc to the end of the current system, then a continuation arc at the start of the next.

### CPU / performance

Canvas rendering with 200+ measures, each with multiple voices and annotations, gets heavy. Key optimizations:
- Static canvas (staff lines, notes, annotations) is rendered once and cached
- Overlay canvas handles the playback cursor and is redrawn incrementally
- Layout computation is pure math (no DOM) (runs once on load/resize)
- FluidSynth scheduling uses a 150ms lookahead window to batch note events

Still-open issue: very dense passages (32nd note runs) with lots of annotations can cause visible frame drops during playback, especially on lower-end machines.

### Note spacing

Purely time-proportional spacing looks wrong when short and long notes are adjacent (e.g., a 16th note followed by a half note). The layout engine uses a weighted approach with a power curve (`beatFrac^1.1`) to compress subdivisions slightly, plus a hard minimum pixel distance between consecutive beats to prevent overlap.
