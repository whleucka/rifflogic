// Chord selector UI: root + quality dropdowns, category filter, diagram, strum button

import { NOTE_NAMES, NOTE_DISPLAY } from '../music/notes.js';
import { CHORD_VOICINGS, QUALITY_NAMES, getChordVoicings, chordToFretboardMap } from '../music/chords.js';
import { events, CHORD_SELECT, CHORD_CLEAR, CHORD_NOTE_ON, CHORD_NOTE_OFF } from '../events.js';
import { renderChordDiagram } from './chord-diagram.js';
import { strumChord } from '../audio/strum.js';

export function renderChordSelector(container) {
  const group = document.createElement('div');
  group.className = 'control-group chord-selector-group';
  group.innerHTML = '<h3>Chords</h3>';

  // --- Top row: selects + buttons ---
  const row = document.createElement('div');
  row.className = 'chord-selector-row';

  // Root select
  const rootSelect = document.createElement('select');
  rootSelect.className = 'scale-select';
  rootSelect.innerHTML = '<option value="">Root</option>';
  NOTE_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = NOTE_DISPLAY[i];
    rootSelect.appendChild(opt);
  });

  // Quality select
  const qualitySelect = document.createElement('select');
  qualitySelect.className = 'scale-select';
  qualitySelect.innerHTML = '<option value="">Type</option>';
  for (const [key, label] of Object.entries(QUALITY_NAMES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    qualitySelect.appendChild(opt);
  }

  // Strum buttons
  const strumDownBtn = document.createElement('button');
  strumDownBtn.className = 'toggle-btn';
  strumDownBtn.textContent = 'Strum ↓';
  strumDownBtn.addEventListener('click', () => {
    if (currentVoicing) strumChord(currentVoicing, 'down');
  });

  const strumUpBtn = document.createElement('button');
  strumUpBtn.className = 'toggle-btn';
  strumUpBtn.textContent = 'Strum ↑';
  strumUpBtn.addEventListener('click', () => {
    if (currentVoicing) strumChord(currentVoicing, 'up');
  });

  // Clear
  const clearBtn = document.createElement('button');
  clearBtn.className = 'toggle-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    rootSelect.value = '';
    qualitySelect.value = '';
    currentVoicing = null;
    matchingVoicings = [];
    voicingIndex = 0;
    renderChordDiagram(null, diagramContainer);
    updateNav();
    events.emit(CHORD_CLEAR);
  });

  row.appendChild(rootSelect);
  row.appendChild(qualitySelect);
  row.appendChild(strumDownBtn);
  row.appendChild(strumUpBtn);
  row.appendChild(clearBtn);
  group.appendChild(row);

  // --- Category filter ---
  const catRow = document.createElement('div');
  catRow.className = 'caged-row';

  const catLabel = document.createElement('span');
  catLabel.className = 'caged-label';
  catLabel.textContent = 'Filter:';
  catRow.appendChild(catLabel);

  let activeCategory = null;
  const categories = [
    { key: null, label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'barre', label: 'Barre' },
    { key: 'jazz', label: 'Jazz' },
  ];

  const catBtns = categories.map(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'caged-btn' + (key === null ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      activeCategory = key;
      catBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateSelection();
    });
    catRow.appendChild(btn);
    return btn;
  });

  group.appendChild(catRow);

  // --- Voicing nav + diagram ---
  const bottomRow = document.createElement('div');
  bottomRow.className = 'chord-bottom-row';

  const navWrap = document.createElement('div');
  navWrap.className = 'chord-voicing-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'caged-btn';
  prevBtn.textContent = '◀';
  prevBtn.addEventListener('click', () => {
    if (matchingVoicings.length <= 1) return;
    voicingIndex = (voicingIndex - 1 + matchingVoicings.length) % matchingVoicings.length;
    selectVoicing(matchingVoicings[voicingIndex]);
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'caged-btn';
  nextBtn.textContent = '▶';
  nextBtn.addEventListener('click', () => {
    if (matchingVoicings.length <= 1) return;
    voicingIndex = (voicingIndex + 1) % matchingVoicings.length;
    selectVoicing(matchingVoicings[voicingIndex]);
  });

  const navLabel = document.createElement('span');
  navLabel.className = 'chord-nav-label';

  navWrap.appendChild(prevBtn);
  navWrap.appendChild(navLabel);
  navWrap.appendChild(nextBtn);

  const diagramContainer = document.createElement('div');
  diagramContainer.className = 'chord-diagram-container';

  bottomRow.appendChild(diagramContainer);
  bottomRow.appendChild(navWrap);
  group.appendChild(bottomRow);

  container.appendChild(group);

  // --- State ---
  let currentVoicing = null;
  let matchingVoicings = [];
  let voicingIndex = 0;

  rootSelect.addEventListener('change', updateSelection);
  qualitySelect.addEventListener('change', updateSelection);

  function updateSelection() {
    const root = rootSelect.value;
    const quality = qualitySelect.value;

    if (!root || !quality) {
      matchingVoicings = [];
      voicingIndex = 0;
      currentVoicing = null;
      renderChordDiagram(null, diagramContainer);
      updateNav();
      return;
    }

    let voicings = getChordVoicings(root, quality);
    if (activeCategory) {
      voicings = voicings.filter(v => v.category === activeCategory);
    }

    matchingVoicings = voicings;
    voicingIndex = 0;

    if (voicings.length > 0) {
      selectVoicing(voicings[0]);
    } else {
      currentVoicing = null;
      renderChordDiagram(null, diagramContainer);
      events.emit(CHORD_CLEAR);
    }
    updateNav();
  }

  function selectVoicing(voicing) {
    currentVoicing = voicing;
    renderChordDiagram(voicing, diagramContainer);
    updateNav();

    const fretboardMap = chordToFretboardMap(voicing);
    events.emit(CHORD_SELECT, { voicing, fretboardMap });
  }

  function updateNav() {
    if (matchingVoicings.length <= 1) {
      navWrap.style.display = 'none';
    } else {
      navWrap.style.display = 'flex';
      navLabel.textContent = `${voicingIndex + 1} / ${matchingVoicings.length}`;
    }
  }
}
