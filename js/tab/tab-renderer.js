// Canvas-based scrolling tab renderer

const TAB = {
  lineSpacing: 16,
  beatSpacing: 32,
  measurePadding: 20,
  marginLeft: 50,
  marginTop: 40,
  marginBottom: 20,
  cursorWidth: 3,
  fontSize: 13,
  sectionFontSize: 11,
  minMeasureWidth: 120,
};

export class TabRenderer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tab-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.wrap = document.createElement('div');
    this.wrap.className = 'tab-canvas-wrap';
    this.wrap.appendChild(this.canvas);
    container.appendChild(this.wrap);

    this.timeline = null;
    this.measures = null;
    this.stringCount = 6;
    this.beatXPositions = [];
    this.measureXPositions = [];
    this.totalWidth = 0;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    // Click handler for loop setting
    this.canvas.addEventListener('click', (e) => {
      if (this._onCanvasClick) this._onCanvasClick(e);
    });
  }

  /**
   * Set tab data and render.
   */
  setData(timeline, measures, stringCount = 6) {
    this.timeline = timeline;
    this.measures = measures;
    this.stringCount = stringCount;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    this._computeLayout();
    this._render();
  }

  /**
   * Move cursor to a timeline index.
   */
  setCursor(index) {
    if (this.cursorIndex === index) return;
    this.cursorIndex = index;
    this._render();
    this._scrollToCursor();
  }

  clearCursor() {
    this.cursorIndex = -1;
    this._render();
  }

  setLoop(a, b) {
    this.loopA = a;
    this.loopB = b;
    this._render();
  }

  /**
   * Get timeline index from canvas click X position.
   */
  getIndexAtX(canvasX) {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.beatXPositions.length; i++) {
      const dist = Math.abs(this.beatXPositions[i] - canvasX);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }

  onCanvasClick(handler) {
    this._onCanvasClick = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const index = this.getIndexAtX(canvasX);
      handler(index);
    };
  }

  _computeLayout() {
    if (!this.timeline || !this.measures) return;

    const beatXs = [];
    const measureXs = [];
    let x = TAB.marginLeft;

    for (const measure of this.measures) {
      measureXs.push(x);

      const numBeats = measure.beatIndices.length || 1;
      const measureWidth = Math.max(
        TAB.minMeasureWidth,
        numBeats * TAB.beatSpacing + TAB.measurePadding * 2
      );

      for (let i = 0; i < measure.beatIndices.length; i++) {
        const beatX = x + TAB.measurePadding + i * (measureWidth - TAB.measurePadding * 2) / Math.max(numBeats, 1);
        beatXs[measure.beatIndices[i]] = beatX;
      }

      x += measureWidth;
    }

    this.beatXPositions = beatXs;
    this.measureXPositions = measureXs;
    this.totalWidth = x + TAB.marginLeft;

    const staffHeight = (this.stringCount - 1) * TAB.lineSpacing;
    const totalHeight = TAB.marginTop + staffHeight + TAB.marginBottom;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.totalWidth * dpr;
    this.canvas.height = totalHeight * dpr;
    this.canvas.style.width = this.totalWidth + 'px';
    this.canvas.style.height = totalHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _render() {
    const ctx = this.ctx;
    const { stringCount, timeline, measures } = this;
    if (!timeline || !measures) return;

    const staffHeight = (stringCount - 1) * TAB.lineSpacing;
    const totalHeight = TAB.marginTop + staffHeight + TAB.marginBottom;

    // Get theme colors from CSS
    const style = getComputedStyle(document.documentElement);
    const bgColor = style.getPropertyValue('--bg-primary').trim() || '#24283b';
    const lineColor = style.getPropertyValue('--fb-fret-wire').trim() || '#565f89';
    const textColor = style.getPropertyValue('--text-primary').trim() || '#c0caf5';
    const mutedColor = style.getPropertyValue('--text-muted').trim() || '#565f89';
    const cursorColor = style.getPropertyValue('--accent-gold').trim() || '#e0af68';
    const accentBlue = style.getPropertyValue('--accent-blue').trim() || '#7aa2f7';
    const accentRed = style.getPropertyValue('--accent-red').trim() || '#f7768e';
    const sectionColor = style.getPropertyValue('--accent-green').trim() || '#9ece6a';
    const surfaceColor = style.getPropertyValue('--bg-surface').trim() || '#292e42';

    // Clear
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, this.totalWidth, totalHeight);

    // Loop region highlight
    if (this.loopA !== null && this.loopB !== null) {
      const ax = this.beatXPositions[this.loopA] || 0;
      const bx = this.beatXPositions[this.loopB] || 0;
      ctx.fillStyle = 'rgba(122, 162, 247, 0.08)';
      ctx.fillRect(ax - 5, 0, bx - ax + 10, totalHeight);
    }

    // Tab lines — top line = high e (string 5), bottom line = low E (string 0)
    // Standard tab: highest-pitched string at top
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.5;
    for (let s = 0; s < stringCount; s++) {
      const y = TAB.marginTop + s * TAB.lineSpacing;
      ctx.beginPath();
      ctx.moveTo(TAB.marginLeft - 10, y);
      ctx.lineTo(this.totalWidth - TAB.marginLeft + 10, y);
      ctx.stroke();
    }

    // TAB clef label
    ctx.fillStyle = mutedColor;
    ctx.font = `bold 11px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
    ctx.textAlign = 'center';
    const midY = TAB.marginTop + staffHeight / 2;
    ctx.fillText('T', 20, midY - 7);
    ctx.fillText('A', 20, midY + 3);
    ctx.fillText('B', 20, midY + 13);

    // Measure barlines + section labels
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    for (let m = 0; m < measures.length; m++) {
      const x = this.measureXPositions[m];
      ctx.beginPath();
      ctx.moveTo(x, TAB.marginTop);
      ctx.lineTo(x, TAB.marginTop + staffHeight);
      ctx.stroke();

      // Section label
      if (measures[m].section) {
        const label = measures[m].section.text || measures[m].section.letter;
        if (label) {
          ctx.fillStyle = sectionColor;
          ctx.font = `bold ${TAB.sectionFontSize}px ${style.getPropertyValue('--font-main').trim() || 'sans-serif'}`;
          ctx.textAlign = 'left';
          ctx.fillText(label, x + 4, TAB.marginTop - 10);
        }
      }

      // Bar number
      ctx.fillStyle = mutedColor;
      ctx.font = `9px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
      ctx.textAlign = 'left';
      ctx.fillText(m + 1, x + 3, TAB.marginTop - 3);
    }

    // Final barline
    if (this.measureXPositions.length > 0) {
      const lastX = this.totalWidth - TAB.marginLeft;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lastX, TAB.marginTop);
      ctx.lineTo(lastX, TAB.marginTop + staffHeight);
      ctx.stroke();
    }

    // Fret numbers
    ctx.font = `bold ${TAB.fontSize}px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < timeline.length; i++) {
      const event = timeline[i];
      const x = this.beatXPositions[i];
      if (x === undefined) continue;

      for (const note of event.notes) {
        if (note.tieDestination) continue; // Don't redraw tied notes
        if (note.string < 0 || note.string >= stringCount) continue;

        // String 5 (high e) at top (y=0), string 0 (low E) at bottom
        const y = TAB.marginTop + (stringCount - 1 - note.string) * TAB.lineSpacing;

        // Background to cover the tab line
        const textW = note.fret >= 10 ? 16 : 10;
        ctx.fillStyle = bgColor;
        ctx.fillRect(x - textW / 2 - 1, y - 7, textW + 2, 14);

        // Fret number
        const isCursor = i === this.cursorIndex;
        ctx.fillStyle = isCursor ? cursorColor : textColor;
        ctx.fillText(note.fret, x, y);
      }

      // Rest marker
      if (event.notes.length === 0 && !event.isRest) {
        // Empty beat, skip
      }
    }

    // Cursor line
    if (this.cursorIndex >= 0 && this.cursorIndex < this.beatXPositions.length) {
      const cx = this.beatXPositions[this.cursorIndex];
      if (cx !== undefined) {
        ctx.strokeStyle = cursorColor;
        ctx.lineWidth = TAB.cursorWidth;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(cx, TAB.marginTop - 5);
        ctx.lineTo(cx, TAB.marginTop + staffHeight + 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Loop markers
    if (this.loopA !== null && this.beatXPositions[this.loopA] !== undefined) {
      this._drawLoopMarker(this.beatXPositions[this.loopA], 'A', accentBlue, staffHeight);
    }
    if (this.loopB !== null && this.beatXPositions[this.loopB] !== undefined) {
      this._drawLoopMarker(this.beatXPositions[this.loopB], 'B', accentRed, staffHeight);
    }
  }

  _drawLoopMarker(x, label, color, staffHeight) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, TAB.marginTop - 5);
    ctx.lineTo(x, TAB.marginTop + staffHeight + 5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, TAB.marginTop + staffHeight + 15);
  }

  _scrollToCursor() {
    if (this.cursorIndex < 0) return;
    const cx = this.beatXPositions[this.cursorIndex];
    if (cx === undefined) return;

    const wrapWidth = this.wrap.clientWidth;
    const targetScroll = cx - wrapWidth / 2;
    this.wrap.scrollLeft = Math.max(0, targetScroll);
  }
}
