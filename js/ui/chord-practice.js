// Chord progression practice with metronome

import { COMMON_PROGRESSIONS, getVoicingByName, chordToFretboardMap } from '../music/chords.js';
import { METRONOME } from '../config.js';
import { Metronome } from '../audio/metronome.js';
import { strumChord } from '../audio/strum.js';
import { events, CHORD_SELECT, CHORD_CLEAR, METRONOME_TICK } from '../events.js';

export function renderChordPractice(container) {
  const group = document.createElement('div');
  group.className = 'control-group chord-practice-group';
  group.innerHTML = '<h3>Chord Practice</h3>';

  // --- Settings row ---
  const settingsRow = document.createElement('div');
  settingsRow.className = 'practice-settings-row';

  // Progression select
  const progSelect = document.createElement('select');
  progSelect.className = 'scale-select';
  progSelect.innerHTML = '<option value="">Progression</option>';
  COMMON_PROGRESSIONS.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    progSelect.appendChild(opt);
  });

  // BPM
  const bpmWrap = document.createElement('div');
  bpmWrap.className = 'bpm-control';
  const bpmLabel = document.createElement('label');
  bpmLabel.textContent = 'BPM';
  const bpmInput = document.createElement('input');
  bpmInput.type = 'range';
  bpmInput.min = METRONOME.minBpm;
  bpmInput.max = METRONOME.maxBpm;
  bpmInput.value = METRONOME.defaultBpm;
  const bpmValue = document.createElement('span');
  bpmValue.className = 'bpm-value';
  bpmValue.textContent = METRONOME.defaultBpm;
  bpmInput.addEventListener('input', () => {
    bpmValue.textContent = bpmInput.value;
    if (metronome.running) {
      metronome.setBpm(parseInt(bpmInput.value));
    }
  });
  bpmWrap.appendChild(bpmLabel);
  bpmWrap.appendChild(bpmInput);
  bpmWrap.appendChild(bpmValue);

  // Beats per chord
  const bpcWrap = document.createElement('div');
  bpcWrap.className = 'bpc-control';
  const bpcLabel = document.createElement('span');
  bpcLabel.className = 'caged-label';
  bpcLabel.textContent = 'Beats/chord:';
  bpcWrap.appendChild(bpcLabel);

  let beatsPerChord = 4;
  const bpcOptions = [1, 2, 4];
  const bpcBtns = bpcOptions.map(n => {
    const btn = document.createElement('button');
    btn.className = 'caged-btn' + (n === 4 ? ' active' : '');
    btn.textContent = n;
    btn.addEventListener('click', () => {
      beatsPerChord = n;
      bpcBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    bpcWrap.appendChild(btn);
    return btn;
  });

  // Auto-strum toggle
  const autoStrumBtn = document.createElement('button');
  autoStrumBtn.className = 'toggle-btn';
  autoStrumBtn.textContent = 'Auto-Strum';
  let autoStrum = false;
  autoStrumBtn.addEventListener('click', () => {
    autoStrum = !autoStrum;
    autoStrumBtn.classList.toggle('active', autoStrum);
  });

  // Start/Stop
  const startBtn = document.createElement('button');
  startBtn.className = 'toggle-btn practice-start-btn';
  startBtn.textContent = 'Start';

  settingsRow.appendChild(progSelect);
  settingsRow.appendChild(bpmWrap);
  settingsRow.appendChild(bpcWrap);
  settingsRow.appendChild(autoStrumBtn);
  settingsRow.appendChild(startBtn);
  group.appendChild(settingsRow);

  // --- Progression display ---
  const progDisplay = document.createElement('div');
  progDisplay.className = 'progression-display';
  group.appendChild(progDisplay);

  // --- Beat indicator ---
  const beatDisplay = document.createElement('div');
  beatDisplay.className = 'beat-display';
  group.appendChild(beatDisplay);

  container.appendChild(group);

  // --- State ---
  const metronome = new Metronome();
  let running = false;
  let chordElements = [];
  let currentChordIndex = 0;
  let beatInChord = 0;
  let progression = null;

  startBtn.addEventListener('click', () => {
    if (running) {
      stop();
    } else {
      start();
    }
  });

  function start() {
    const progIdx = progSelect.value;
    if (progIdx === '') return;

    progression = COMMON_PROGRESSIONS[parseInt(progIdx)];
    currentChordIndex = 0;
    beatInChord = 0;

    // Build progression display
    buildProgDisplay();
    buildBeatDisplay();
    highlightChord(0);
    highlightBeat(0);

    // Show first chord on fretboard
    emitChord(0);
    if (autoStrum) strumCurrentChord();

    running = true;
    startBtn.textContent = 'Stop';
    startBtn.classList.add('active');

    metronome.start(parseInt(bpmInput.value), 4);
  }

  function stop() {
    metronome.stop();
    running = false;
    startBtn.textContent = 'Start';
    startBtn.classList.remove('active');
    events.emit(CHORD_CLEAR);
  }

  function buildProgDisplay() {
    progDisplay.innerHTML = '';
    chordElements = progression.chords.map((name, i) => {
      const el = document.createElement('span');
      el.className = 'progression-chord';
      el.textContent = name;
      progDisplay.appendChild(el);
      return el;
    });
  }

  let beatElements = [];
  function buildBeatDisplay() {
    beatDisplay.innerHTML = '';
    beatElements = [];
    for (let i = 0; i < beatsPerChord; i++) {
      const dot = document.createElement('span');
      dot.className = 'beat-dot';
      beatDisplay.appendChild(dot);
      beatElements.push(dot);
    }
  }

  function highlightChord(index) {
    chordElements.forEach((el, i) => {
      el.classList.toggle('current', i === index);
      el.classList.toggle('next', i === (index + 1) % progression.chords.length);
    });
  }

  function highlightBeat(beat) {
    beatElements.forEach((el, i) => {
      el.classList.toggle('active', i === beat);
    });
  }

  function emitChord(index) {
    const name = progression.chords[index];
    const voicing = getVoicingByName(name);
    if (voicing) {
      const fretboardMap = chordToFretboardMap(voicing);
      events.emit(CHORD_SELECT, { voicing, fretboardMap });
    }
  }

  function strumCurrentChord() {
    const name = progression.chords[currentChordIndex];
    const voicing = getVoicingByName(name);
    if (voicing) strumChord(voicing, 'down');
  }

  // Handle metronome ticks
  events.on(METRONOME_TICK, ({ beat }) => {
    if (!running) return;

    highlightBeat(beatInChord);
    beatInChord++;

    if (beatInChord >= beatsPerChord) {
      beatInChord = 0;
      currentChordIndex = (currentChordIndex + 1) % progression.chords.length;
      highlightChord(currentChordIndex);
      emitChord(currentChordIndex);
      if (autoStrum) strumCurrentChord();
    }
  });
}
