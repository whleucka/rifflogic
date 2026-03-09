// Scale selector UI: root note + scale type dropdowns + CAGED position stepper

import { NOTE_NAMES, NOTE_DISPLAY, midiToFrequency } from '../music/notes.js';
import { SCALE_DISPLAY_NAMES, getCAGEDPositions, computeScaleMap, filterCAGEDPosition } from '../music/scales.js';
import { TUNING, FRET_COUNT } from '../config.js';
import { events, SCALE_SELECT, SCALE_CLEAR, CAGED_POSITION, SCALE_NOTE_ON, SCALE_NOTE_OFF } from '../events.js';
import { playNote } from '../audio/synth-voice.js';

export function renderScaleSelector(container) {
  const group = document.createElement('div');
  group.className = 'control-group scale-selector-group';
  group.innerHTML = '<h3>Scales &amp; Modes</h3>';

  const row = document.createElement('div');
  row.className = 'scale-selector-row';

  // Root note select
  const rootSelect = document.createElement('select');
  rootSelect.className = 'scale-select';
  rootSelect.innerHTML = '<option value="">Root</option>';
  NOTE_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = NOTE_DISPLAY[i];
    rootSelect.appendChild(opt);
  });

  // Scale type select
  const scaleSelect = document.createElement('select');
  scaleSelect.className = 'scale-select';
  scaleSelect.innerHTML = '<option value="">Scale</option>';
  for (const [key, label] of Object.entries(SCALE_DISPLAY_NAMES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    scaleSelect.appendChild(opt);
  }

  // Play button
  const playBtn = document.createElement('button');
  playBtn.className = 'toggle-btn play-scale-btn';
  playBtn.textContent = 'Play';
  let playTimeout = null;
  let isPlaying = false;

  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    const root = rootSelect.value;
    const scale = scaleSelect.value;
    if (!root || !scale) return;
    playScale(root, scale, cagedIndex === -1 ? null : positions[cagedIndex]);
  });

  function stopPlayback() {
    if (playTimeout) clearTimeout(playTimeout);
    playTimeout = null;
    isPlaying = false;
    playBtn.textContent = 'Play';
    playBtn.classList.remove('active');
    events.emit(SCALE_NOTE_OFF);
  }

  function playScale(root, scale, cagedPosition) {
    let scaleMap = computeScaleMap(root, scale);
    if (cagedPosition) {
      scaleMap = filterCAGEDPosition(scaleMap, root, cagedPosition);
    }

    // Collect unique notes sorted ascending by MIDI, pick one fret position each.
    // Walk strings low to high for a natural ascending run.
    const notesByMidi = new Map();
    for (const [key, info] of scaleMap) {
      const [s, f] = key.split('-').map(Number);
      const midi = TUNING[s].midi + f;
      if (!notesByMidi.has(midi) || s > notesByMidi.get(midi).s) {
        notesByMidi.set(midi, { s, f, midi, key, degree: info.degree, isRoot: info.isRoot });
      }
    }

    const sorted = [...notesByMidi.values()].sort((a, b) => a.midi - b.midi);
    if (sorted.length === 0) return;

    // Play ascending then descending (skip duplicate top note)
    const sequence = [...sorted, ...sorted.slice(0, -1).reverse()];

    isPlaying = true;
    playBtn.textContent = 'Stop';
    playBtn.classList.add('active');

    let i = 0;
    const tempo = 220; // ms per note

    function step() {
      if (i >= sequence.length || !isPlaying) {
        stopPlayback();
        return;
      }

      const note = sequence[i];
      const freq = midiToFrequency(note.midi);
      playNote(freq, note.s);
      events.emit(SCALE_NOTE_ON, { key: note.key, string: note.s, fret: note.f });

      // Turn off highlight after a short duration
      setTimeout(() => {
        events.emit(SCALE_NOTE_OFF, { key: note.key });
      }, tempo * 0.8);

      i++;
      playTimeout = setTimeout(step, tempo);
    }

    step();
  }

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'toggle-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    stopPlayback();
    rootSelect.value = '';
    scaleSelect.value = '';
    cagedIndex = -1;
    updateCAGEDDisplay();
    events.emit(SCALE_CLEAR);
  });

  const emitSelection = () => {
    const root = rootSelect.value;
    const scale = scaleSelect.value;
    if (root && scale) {
      cagedIndex = -1;
      updateCAGEDDisplay();
      events.emit(SCALE_SELECT, { root, scale });
    }
  };

  rootSelect.addEventListener('change', emitSelection);
  scaleSelect.addEventListener('change', emitSelection);

  row.appendChild(rootSelect);
  row.appendChild(scaleSelect);
  row.appendChild(playBtn);
  row.appendChild(clearBtn);
  group.appendChild(row);

  // --- CAGED position stepper ---
  const cagedRow = document.createElement('div');
  cagedRow.className = 'caged-row';

  const cagedLabel = document.createElement('span');
  cagedLabel.className = 'caged-label';
  cagedLabel.textContent = 'CAGED:';

  const positions = getCAGEDPositions();
  let cagedIndex = -1; // -1 = all positions

  const cagedBtns = positions.map((pos, i) => {
    const btn = document.createElement('button');
    btn.className = 'caged-btn';
    btn.textContent = pos;
    btn.addEventListener('click', () => {
      if (cagedIndex === i) {
        // Toggle off — show all
        cagedIndex = -1;
      } else {
        cagedIndex = i;
      }
      updateCAGEDDisplay();
      emitCAGED();
    });
    return btn;
  });

  const allBtn = document.createElement('button');
  allBtn.className = 'caged-btn active';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => {
    cagedIndex = -1;
    updateCAGEDDisplay();
    emitCAGED();
  });

  function updateCAGEDDisplay() {
    allBtn.classList.toggle('active', cagedIndex === -1);
    cagedBtns.forEach((btn, i) => {
      btn.classList.toggle('active', cagedIndex === i);
    });
  }

  function emitCAGED() {
    const root = rootSelect.value;
    const scale = scaleSelect.value;
    if (!root || !scale) return;
    events.emit(CAGED_POSITION, {
      root,
      scale,
      position: cagedIndex === -1 ? null : positions[cagedIndex],
    });
  }

  cagedRow.appendChild(cagedLabel);
  cagedRow.appendChild(allBtn);
  cagedBtns.forEach(btn => cagedRow.appendChild(btn));

  group.appendChild(cagedRow);
  container.appendChild(group);
}
