// Top bar with app title + tab navigation

import { events } from '../events.js';

export const VIEW_CHANGE = 'ui:view-change';

const VIEWS = [
  { id: 'scales', label: 'Scales' },
  { id: 'chords', label: 'Chords' },
  { id: 'tabs', label: 'Tab Viewer' },
];

export function renderToolbar(container) {
  const title = document.createElement('span');
  title.className = 'toolbar-title';
  title.textContent = 'Guitar';

  const nav = document.createElement('nav');
  nav.className = 'toolbar-nav';

  let activeView = 'scales';

  const buttons = VIEWS.map(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'toolbar-tab' + (id === activeView ? ' active' : '');
    btn.textContent = label;
    btn.dataset.view = id;
    btn.addEventListener('click', () => {
      activeView = id;
      buttons.forEach(b => b.classList.toggle('active', b.dataset.view === id));
      events.emit(VIEW_CHANGE, { view: id });
    });
    nav.appendChild(btn);
    return btn;
  });

  container.appendChild(title);
  container.appendChild(nav);

  // Emit initial view
  requestAnimationFrame(() => {
    events.emit(VIEW_CHANGE, { view: activeView });
  });
}
