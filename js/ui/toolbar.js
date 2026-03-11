// Top bar with app title + tab navigation

import { events } from '../events.js';

export const VIEW_CHANGE = 'ui:view-change';

const VIEWS = [
  { id: 'scales', label: 'Scales' },
  { id: 'chords', label: 'Chords' },
  { id: 'tabs', label: 'Tab Viewer' },
];

// Module-level reference for setActiveView
let toolbarButtons = [];
let currentActiveView = 'scales';

export function renderToolbar(container) {
  const inner = document.createElement('div');
  inner.className = 'toolbar-inner';

  const title = document.createElement('span');
  title.className = 'toolbar-title';
  title.textContent = 'RiffLogic';

  const nav = document.createElement('nav');
  nav.className = 'toolbar-nav';

  toolbarButtons = VIEWS.map(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'toolbar-tab' + (id === currentActiveView ? ' active' : '');
    btn.textContent = label;
    btn.dataset.view = id;
    btn.addEventListener('click', () => {
      setActiveView(id);
    });
    nav.appendChild(btn);
    return btn;
  });

  inner.appendChild(title);
  inner.appendChild(nav);
  container.appendChild(inner);

  // Emit initial view
  requestAnimationFrame(() => {
    events.emit(VIEW_CHANGE, { view: currentActiveView });
  });
}

/**
 * Programmatically set the active view
 * @param {string} viewId - 'scales', 'chords', or 'tabs'
 */
export function setActiveView(viewId) {
  if (!VIEWS.some(v => v.id === viewId)) return;
  
  currentActiveView = viewId;
  toolbarButtons.forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  events.emit(VIEW_CHANGE, { view: viewId });
}
