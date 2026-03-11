// Entry point — wires all modules together

import { renderFretboard } from './fretboard/fretboard-svg.js';
import { setupInteraction } from './fretboard/fretboard-interaction.js';
import { renderControls } from './ui/controls.js';
import { renderScaleSelector } from './ui/scale-selector.js';
import { renderChordSelector } from './ui/chord-selector.js';
import { renderChordPractice } from './ui/chord-practice.js';
import { renderTabViewer } from './ui/tab-controls.js';
import { renderToolbar, VIEW_CHANGE, setActiveView } from './ui/toolbar.js';
import { events, TUNING_CHANGE } from './events.js';
import * as settings from './settings.js';

function init() {
  // Toolbar
  renderToolbar(document.getElementById('toolbar'));

  // Fretboard (always visible)
  const fretboardContainer = document.getElementById('fretboard-container');
  let { svg, noteElements } = renderFretboard();
  fretboardContainer.appendChild(svg);
  setupInteraction(svg, noteElements);

  // Listen for tuning changes and re-render fretboard
  events.on(TUNING_CHANGE, ({ tuning }) => {
    // Remove old fretboard
    fretboardContainer.innerHTML = '';
    
    // Render new fretboard with updated tuning
    const result = renderFretboard(tuning);
    svg = result.svg;
    noteElements = result.noteElements;
    
    fretboardContainer.appendChild(svg);
    setupInteraction(svg, noteElements);
  });

  // --- View: Scales ---
  const scalesView = document.createElement('div');
  scalesView.id = 'view-scales';
  scalesView.className = 'view-panel';
  renderScaleSelector(scalesView);
  // Settings (note highlights, volume, show-all) go in scales view
  renderControls(scalesView);

  // --- View: Chords ---
  const chordsView = document.createElement('div');
  chordsView.id = 'view-chords';
  chordsView.className = 'view-panel';
  renderChordSelector(chordsView);
  renderChordPractice(chordsView);

  // --- View: Tab Viewer ---
  const tabsView = document.createElement('div');
  tabsView.id = 'view-tabs';
  tabsView.className = 'view-panel';

  // Tab container sits inside its view
  const tabContainer = document.getElementById('tab-container');
  tabsView.appendChild(tabContainer);
  renderTabViewer(tabContainer);

  // Add all views to controls container
  const controlsContainer = document.getElementById('controls-container');
  controlsContainer.appendChild(scalesView);
  controlsContainer.appendChild(chordsView);
  controlsContainer.appendChild(tabsView);

  // --- View switching ---
  events.on(VIEW_CHANGE, ({ view }) => {
    scalesView.classList.toggle('hidden', view !== 'scales');
    chordsView.classList.toggle('hidden', view !== 'chords');
    tabsView.classList.toggle('hidden', view !== 'tabs');
    settings.set('view', view);
  });

  // Restore saved view
  const savedView = settings.get('view');
  if (savedView && savedView !== 'scales') {
    setActiveView(savedView);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
