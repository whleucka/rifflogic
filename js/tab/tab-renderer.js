// Canvas-based scrolling tab renderer
// Uses dual-canvas layering: static tab content + overlay for note highlights/loop markers
// Smooth playback cursor uses a GPU-composited DOM element (zero canvas redraws per frame)
// Delegates layout to tab-layout.js and static drawing to tab-drawing.js

import { computeLayout } from './tab-layout.js';
import { renderStaticContent } from './tab-drawing.js';
import { TAB_CONSTANTS } from './tab-constants.js';
import { events, TAB_POSITION } from '../events.js';

export class TabRenderer {
  constructor(container) {
    this.container = container;

    // Static canvas (tab content: staff lines, notes, annotations)
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tab-canvas';
    this.ctx = this.canvas.getContext('2d');

    // Overlay canvas (note highlights, loop markers — redrawn only on beat/loop change)
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'tab-canvas tab-canvas-overlay';
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    // DOM cursor element (GPU-composited, moved via transform — zero paint cost)
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'tab-smooth-cursor';

    this.wrap = document.createElement('div');
    this.wrap.className = 'tab-canvas-wrap';
    this.wrap.appendChild(this.canvas);
    this.wrap.appendChild(this.overlayCanvas);
    this.wrap.appendChild(this.cursorEl);
    container.appendChild(this.wrap);

    this.track = null;
    this.beatPositions = [];
    this.systems = [];
    this.totalWidth = 0;
    this.totalHeight = 0;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;
    this.checkpointIndices = new Set(); // beat indices that have sync checkpoints

    // Playing state (true while setCursorSmooth is being called)
    this._playing = false;

    // Smooth cursor state
    this._lastHighlightIndex = -1;
    this._lastScrollSystem = null;
    this._lastMasterBarIndex = -1;
    this._lastHighlightPos = null;
    this._needsFullOverlayRedraw = true;

    // Cached theme colors
    this._colors = null;

    // Resize handling
    this._resizeTimeout = null;
    this._onResize = () => {
      clearTimeout(this._resizeTimeout);
      this._resizeTimeout = setTimeout(() => {
        if (this.track) {
          this._refreshColors();
          this._doLayout();
          this._renderStatic();
          this._needsFullOverlayRedraw = true;
          this._renderOverlay();
        }
      }, 200);
    };
    window.addEventListener('resize', this._onResize);

    // Click handler
    this._onCanvasClickHandler = null;
    this._wasDrag = false;
    this._clickListener = (e) => {
      if (this._wasDrag) {
        this._wasDrag = false;
        return; // Suppress click after drag
      }
      if (this._onCanvasClickHandler) this._onCanvasClickHandler(e);
    };
    this.overlayCanvas.addEventListener('click', this._clickListener);

    // Drag-to-select loop (Songsterr-style)
    this._dragState = null; // { startMeasureIdx, currentMeasureIdx, startX, startY }
    this._onDragSelectHandler = null;
    this._DRAG_THRESHOLD = 8; // pixels before drag activates

    this._mousedownListener = (e) => {
      if (this._playing || !this.track) return;
      const { canvasX, canvasY } = this._eventToCanvas(e);
      const measureIdx = this._getMeasureIndexAtPoint(canvasX, canvasY);
      if (measureIdx < 0) return;
      this._dragState = {
        startMeasureIdx: measureIdx,
        currentMeasureIdx: measureIdx,
        startX: e.clientX,
        startY: e.clientY,
        activated: false,
      };
    };

    // Auto-scroll during drag
    this._autoScrollRafId = null;
    this._AUTO_SCROLL_ZONE = 60; // pixels from edge to trigger scroll
    this._AUTO_SCROLL_SPEED = 8; // pixels per frame

    this._startAutoScroll = (e) => {
      if (this._autoScrollRafId) return;
      const tick = () => {
        if (!this._dragState || !this._dragState.activated) {
          this._stopAutoScroll();
          return;
        }
        const wrapRect = this.wrap.getBoundingClientRect();
        const mouseY = this._dragState._lastClientY;
        const distFromTop = mouseY - wrapRect.top;
        const distFromBottom = wrapRect.bottom - mouseY;

        let scrollDelta = 0;
        if (distFromTop < this._AUTO_SCROLL_ZONE) {
          scrollDelta = -this._AUTO_SCROLL_SPEED * (1 - distFromTop / this._AUTO_SCROLL_ZONE);
        } else if (distFromBottom < this._AUTO_SCROLL_ZONE) {
          scrollDelta = this._AUTO_SCROLL_SPEED * (1 - distFromBottom / this._AUTO_SCROLL_ZONE);
        }

        if (scrollDelta !== 0) {
          this.wrap.scrollTop += scrollDelta;
          // Re-evaluate measure under cursor after scroll
          this._updateDragMeasure();
        }
        this._autoScrollRafId = requestAnimationFrame(tick);
      };
      this._autoScrollRafId = requestAnimationFrame(tick);
    };

    this._stopAutoScroll = () => {
      if (this._autoScrollRafId) {
        cancelAnimationFrame(this._autoScrollRafId);
        this._autoScrollRafId = null;
      }
    };

    this._updateDragMeasure = () => {
      if (!this._dragState || !this._dragState.activated) return;
      // Re-use _eventToCanvas with stored mouse position — getBoundingClientRect
      // updates as the wrap scrolls, so canvas coords stay correct
      const { canvasX, canvasY } = this._eventToCanvas({
        clientX: this._dragState._lastClientX,
        clientY: this._dragState._lastClientY,
      });
      const measureIdx = this._getMeasureIndexAtPoint(canvasX, canvasY);
      if (measureIdx >= 0 && measureIdx !== this._dragState.currentMeasureIdx) {
        this._dragState.currentMeasureIdx = measureIdx;
        this._needsFullOverlayRedraw = true;
        this._renderOverlay();
      }
    };

    this._mousemoveForDragListener = (e) => {
      if (!this._dragState || !this.track) return;

      // Check drag threshold
      if (!this._dragState.activated) {
        const dx = e.clientX - this._dragState.startX;
        const dy = e.clientY - this._dragState.startY;
        if (Math.abs(dx) < this._DRAG_THRESHOLD && Math.abs(dy) < this._DRAG_THRESHOLD) return;
        this._dragState.activated = true;
        this.overlayCanvas.classList.add('dragging');
        this._startAutoScroll();
      }

      // Track mouse position for auto-scroll
      this._dragState._lastClientX = e.clientX;
      this._dragState._lastClientY = e.clientY;

      const { canvasX, canvasY } = this._eventToCanvas(e);
      const measureIdx = this._getMeasureIndexAtPoint(canvasX, canvasY);
      if (measureIdx < 0) return;
      if (measureIdx !== this._dragState.currentMeasureIdx) {
        this._dragState.currentMeasureIdx = measureIdx;
        this._needsFullOverlayRedraw = true;
        this._renderOverlay();
      }
    };

    this._mouseupListener = (e) => {
      if (!this._dragState) return;
      const state = this._dragState;
      this._dragState = null;
      this._stopAutoScroll();

      this.overlayCanvas.classList.remove('dragging');

      if (!state.activated) return; // Was just a click, not a drag

      this._wasDrag = true;
      this._needsFullOverlayRedraw = true;
      this._renderOverlay();

      const start = Math.min(state.startMeasureIdx, state.currentMeasureIdx);
      const end = Math.max(state.startMeasureIdx, state.currentMeasureIdx);

      if (this._onDragSelectHandler) {
        this._onDragSelectHandler(start, end);
      }
    };

    this.overlayCanvas.addEventListener('mousedown', this._mousedownListener);
    document.addEventListener('mousemove', this._mousemoveForDragListener);
    document.addEventListener('mouseup', this._mouseupListener);

    // Hover cursor state
    this._hoverIndex = -1;
    this._moveListener = (e) => {
      if (!this.track || this._playing) return;
      if (this._dragState && this._dragState.activated) return; // Don't hover during drag
      const rect = this.overlayCanvas.getBoundingClientRect();
      const scaleX = this.overlayCanvas.width / rect.width;
      const scaleY = this.overlayCanvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      const index = this.getIndexAtPoint(canvasX, canvasY);
      if (index !== this._hoverIndex) {
        this._hoverIndex = index;
        this._needsFullOverlayRedraw = true;
        this._renderOverlay();
      }
    };
    this._leaveListener = () => {
      if (this._hoverIndex >= 0) {
        this._hoverIndex = -1;
        this._needsFullOverlayRedraw = true;
        this._renderOverlay();
      }
    };
    this.overlayCanvas.addEventListener('mousemove', this._moveListener);
    this.overlayCanvas.addEventListener('mouseleave', this._leaveListener);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.overlayCanvas.removeEventListener('click', this._clickListener);
    this.overlayCanvas.removeEventListener('mousedown', this._mousedownListener);
    document.removeEventListener('mousemove', this._mousemoveForDragListener);
    document.removeEventListener('mouseup', this._mouseupListener);
    this.overlayCanvas.removeEventListener('mousemove', this._moveListener);
    this.overlayCanvas.removeEventListener('mouseleave', this._leaveListener);
    this._stopAutoScroll();
    clearTimeout(this._resizeTimeout);
    this.wrap.remove();
  }

  setMeasuresPerLine(n) {
    TAB_CONSTANTS.measuresPerLine = n;
    TAB_CONSTANTS.maxMeasuresPerLine = n + 1;
    if (this.track) {
      this._doLayout();
      this._renderStatic();
      this._needsFullOverlayRedraw = true;
      this._renderOverlay();
    }
  }

  setData(trackData) {
    this.track = trackData;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;
    this._lastHighlightIndex = -1;
    this._lastScrollSystem = null;
    // Cache system reference on each measure for O(1) lookup
    this._cacheSystemRefs();

    this._refreshColors();
    this._doLayout();
    this._cacheSystemRefs(); // re-cache after layout
    this._renderStatic();
    this._needsFullOverlayRedraw = true;
    this._renderOverlay();
    this.cursorEl.style.display = 'none';
  }

  /** Discrete beat-based cursor (used when not playing) */
  setCursor(index) {
    if (this.cursorIndex === index) return;
    this.cursorIndex = index;
    this.cursorEl.style.display = 'none';
    this._needsFullOverlayRedraw = true;
    this._renderOverlay();
    this._scrollToCursor();
  }

  /**
   * Smooth time-based cursor — sweeps continuously across measures.
   * Only updates a DOM element transform (GPU-composited, no canvas redraw).
   * Redraws overlay canvas only when the beat changes (for note highlighting).
   * @param {number} playbackTime - current time in the timeline's time space (seconds)
   */
  setCursorSmooth(playbackTime) {
    if (!this.track || !this.track.measures) return;
    this._playing = true;
    if (this._hoverIndex >= 0) this._hoverIndex = -1;

    const measures = this.track.measures;
    const timeline = this.track.timeline;
    const C = TAB_CONSTANTS;

    // Binary search for the measure containing this time
    const measure = this._findMeasureAtTime(playbackTime);
    if (!measure) return;

    // Find current beat index for note highlighting
    let beatIdx = 0;
    for (let i = measure.beatIndices.length - 1; i >= 0; i--) {
      const bi = measure.beatIndices[i];
      if (timeline[bi] && timeline[bi].time <= playbackTime + 0.001) {
        beatIdx = bi;
        break;
      }
    }

    // Progress within measure (0 to 1)
    const progress = Math.max(0, Math.min(1,
      (playbackTime - measure.startTime) / (measure.endTime - measure.startTime)
    ));

    // Compute cursor X from measure's rendered position
    const hasTimeSig = measure._hasTimeSig;
    const leftPad = C.measurePadding + (hasTimeSig ? C.timeSigPadLeft + C.timeSigWidth : 0);
    const innerWidth = measure._renderedWidth - leftPad - C.measurePadding;
    const x = measure._renderedX + leftPad + progress * innerWidth;

    // Get system from cached ref
    const system = measure._system;
    if (!system) return;

    // Position the DOM cursor (GPU-composited — no canvas redraw)
    const top = system.y + C.marginTop - C.cursorOverhang;
    const height = system.height - C.marginTop - C.marginBottom + 2 * C.cursorOverhang;
    this.cursorEl.style.display = 'block';
    this.cursorEl.style.transform = `translate(${x}px, ${top}px)`;
    this.cursorEl.style.height = `${height}px`;

    // Only redraw overlay when beat changes (note highlighting)
    if (beatIdx !== this._lastHighlightIndex) {
      this._lastHighlightIndex = beatIdx;
      this.cursorIndex = beatIdx;
      this._renderOverlay();
    }

    // Update bar counter when measure changes
    if (measure.masterBarIndex !== this._lastMasterBarIndex) {
      this._lastMasterBarIndex = measure.masterBarIndex;
      events.emit(TAB_POSITION, {
        masterBarIndex: measure.masterBarIndex,
        totalBars: measures.length,
      });
    }

    // Only scroll when system changes
    if (system !== this._lastScrollSystem) {
      this._lastScrollSystem = system;
      const wrapHeight = this.wrap.clientHeight;
      const scrollY = this.wrap.scrollTop;
      if (system.y < scrollY + C.scrollPaddingTop || system.y > scrollY + wrapHeight - C.scrollPaddingBottom) {
        this.wrap.scrollTo({ top: Math.max(0, system.y - C.scrollTargetOffset), behavior: 'smooth' });
      }
    }
  }

  clearCursor() {
    this._playing = false;
    this.cursorIndex = -1;
    this._lastHighlightIndex = -1;
    this._lastScrollSystem = null;
    this._lastMasterBarIndex = -1;
    this.cursorEl.style.display = 'none';
    this._needsFullOverlayRedraw = true;
    this._renderOverlay();
  }

  setLoop(a, b) {
    this.loopA = a;
    this.loopB = b;
    this._needsFullOverlayRedraw = true;
    this._renderOverlay();
  }

  /**
   * Set which beat indices have sync checkpoints.
   * @param {Set<number>|Array<number>} indices
   */
  setCheckpoints(indices) {
    this.checkpointIndices = indices instanceof Set ? indices : new Set(indices);
    this._needsFullOverlayRedraw = true;
    this._renderOverlay();
  }

  getIndexAtPoint(canvasX, canvasY) {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.beatPositions.length; i++) {
      const pos = this.beatPositions[i];
      if (!pos) continue;
      const dx = pos.x - canvasX;
      const dy = (pos.y + pos.systemHeight / 2) - canvasY;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }

  onCanvasClick(handler) {
    this._onCanvasClickHandler = (e) => {
      const { canvasX, canvasY } = this._eventToCanvas(e);
      const index = this.getIndexAtPoint(canvasX, canvasY);
      handler(index, { shiftKey: e.shiftKey });
    };
  }

  /**
   * Register a callback for drag-to-select loop (Songsterr-style).
   * @param {Function} handler - (startMeasureIdx, endMeasureIdx) => void
   */
  onDragSelect(handler) {
    this._onDragSelectHandler = handler;
  }

  _eventToCanvas(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    const scaleX = this.overlayCanvas.width / rect.width;
    const scaleY = this.overlayCanvas.height / rect.height;
    return {
      canvasX: (e.clientX - rect.left) * scaleX,
      canvasY: (e.clientY - rect.top) * scaleY,
    };
  }

  /**
   * Find which measure index contains a canvas point.
   * @returns {number} measure index in track.measures, or -1
   */
  _getMeasureIndexAtPoint(canvasX, canvasY) {
    if (!this.track || !this.track.measures) return -1;
    const measures = this.track.measures;

    for (let i = 0; i < measures.length; i++) {
      const m = measures[i];
      if (m._renderedX == null || !m._system) continue;
      const system = m._system;

      // Check Y range (system bounds)
      if (canvasY < system.y || canvasY > system.y + system.height) continue;
      // Check X range (measure bounds)
      if (canvasX >= m._renderedX && canvasX < m._renderedX + m._renderedWidth) {
        return i;
      }
    }
    return -1;
  }

  // --- System ref caching ---

  _cacheSystemRefs() {
    if (!this.systems || !this.track) return;
    for (const system of this.systems) {
      for (const measure of system.measures) {
        measure._system = system;
      }
    }
  }

  // --- Color caching ---

  _refreshColors() {
    const style = getComputedStyle(document.documentElement);
    this._colors = {
      bg: style.getPropertyValue('--bg-primary').trim() || '#24283b',
      line: style.getPropertyValue('--fb-fret-wire').trim() || '#565f89',
      text: style.getPropertyValue('--text-primary').trim() || '#c0caf5',
      muted: style.getPropertyValue('--text-muted').trim() || '#565f89',
      cursor: style.getPropertyValue('--accent-gold').trim() || '#e0af68',
      blue: style.getPropertyValue('--accent-blue').trim() || '#7aa2f7',
      red: style.getPropertyValue('--accent-red').trim() || '#f7768e',
      gold: style.getPropertyValue('--accent-gold').trim() || '#e0af68',
      section: style.getPropertyValue('--accent-green').trim() || '#9ece6a',
      fontMono: style.getPropertyValue('--font-mono').trim() || 'monospace',
    };
  }

  // --- Layout (delegates to tab-layout.js) ---

  _doLayout() {
    if (!this.track) return;

    const containerWidth = this.wrap.clientWidth || 1000;

    const result = computeLayout(
      this.track,
      containerWidth,
    );

    this.beatPositions = result.beatPositions;
    this.systems = result.systems;
    this.totalWidth = result.totalWidth;
    this.totalHeight = result.totalHeight;

    // Size both canvases identically
    const dpr = window.devicePixelRatio || 1;
    for (const cvs of [this.canvas, this.overlayCanvas]) {
      cvs.width = this.totalWidth * dpr;
      cvs.height = this.totalHeight * dpr;
      cvs.style.width = this.totalWidth + 'px';
      cvs.style.height = this.totalHeight + 'px';
      cvs.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // --- Static rendering (delegates to tab-drawing.js) ---

  _renderStatic() {
    if (!this.track || this.systems.length === 0 || !this._colors) return;
    renderStaticContent(
      this.ctx,
      this._colors,
      this.track,
      this.systems,
      this.beatPositions,
      this.totalWidth,
      this.totalHeight,
    );
  }

  // --- Overlay rendering (note highlights + loop markers, NOT the smooth cursor) ---

  _renderOverlay() {
    const ctx = this.overlayCtx;
    const c = this._colors;
    if (!c) return;

    // Full redraw when loop/markers change, or when a loop region is active
    // (incremental clearRect would erase the loop highlight underneath)
    const hasLoopRegion = this.loopA !== null && this.loopB !== null;
    if (this._needsFullOverlayRedraw || hasLoopRegion) {
      ctx.clearRect(0, 0, this.totalWidth, this.totalHeight);
      this._drawLoopRegion(ctx, c);
      this._drawDragPreview(ctx, c);
      this._drawCheckpointMarkers(ctx);
      this._drawHoverCursor(ctx, c);
      this._drawCursor(ctx, c);
      this._drawLoopMarkers(ctx, c);
      this._needsFullOverlayRedraw = false;
    } else {
      // Incremental: only clear and redraw the note highlight area
      this._drawCursorIncremental(ctx, c);
    }
  }

  _drawCursorIncremental(ctx, c) {
    const C = TAB_CONSTANTS;
    
    // Clear previous highlight area
    if (this._lastHighlightPos) {
      const p = this._lastHighlightPos;
      ctx.clearRect(p.x - 20, p.staffY - 10, 40, p.systemHeight + 20);
    }
    
    // Draw new highlight
    if (this.cursorIndex >= 0 && this._playing) {
      this._highlightCursorNotes();
      // Cache position for next clear
      this._lastHighlightPos = this.beatPositions[this.cursorIndex];
    }
  }

  _drawHoverCursor(ctx, c) {
    if (this._hoverIndex < 0 || this._hoverIndex === this.cursorIndex) return;
    // Only show hover when not playing
    if (this._playing) return;

    const pos = this.beatPositions[this._hoverIndex];
    if (!pos) return;
    const system = this.systems.find(s => s.y === pos.y);
    if (!system) return;

    const top = system.y + TAB_CONSTANTS.marginTop - TAB_CONSTANTS.cursorOverhang;
    const bottom = system.y + system.height - TAB_CONSTANTS.marginBottom + TAB_CONSTANTS.cursorOverhang;

    // Background highlight
    ctx.fillStyle = c.cursor;
    ctx.globalAlpha = 0.1;
    ctx.fillRect(pos.x - 12, top, 24, bottom - top);

    // Cursor line
    ctx.strokeStyle = c.cursor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(pos.x, top);
    ctx.lineTo(pos.x, bottom);
    ctx.stroke();

    // Small triangle markers
    ctx.fillStyle = c.cursor;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(pos.x - 4, top);
    ctx.lineTo(pos.x + 4, top);
    ctx.lineTo(pos.x, top + 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pos.x - 4, bottom);
    ctx.lineTo(pos.x + 4, bottom);
    ctx.lineTo(pos.x, bottom - 6);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  _drawCursor(ctx, c) {
    if (this.cursorIndex < 0) return;

    // During playback, note highlights are handled by _drawCursorIncremental
    if (this._playing) return;

    // Fallback: discrete beat-based canvas cursor (when not playing)
    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;
    const system = this.systems.find(s => s.y === pos.y);
    if (!system) return;

    const top = system.y + TAB_CONSTANTS.marginTop - TAB_CONSTANTS.cursorOverhang;
    const bottom = system.y + system.height - TAB_CONSTANTS.marginBottom + TAB_CONSTANTS.cursorOverhang;

    // Subtle background highlight
    ctx.fillStyle = c.cursor;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(pos.x - 12, top, 24, bottom - top);

    // Cursor line
    ctx.strokeStyle = c.cursor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(pos.x, top);
    ctx.lineTo(pos.x, bottom);
    ctx.stroke();

    // Top/Bottom triangle markers
    ctx.fillStyle = c.cursor;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(pos.x - 6, top);
    ctx.lineTo(pos.x + 6, top);
    ctx.lineTo(pos.x, top + 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pos.x - 6, bottom);
    ctx.lineTo(pos.x + 6, bottom);
    ctx.lineTo(pos.x, bottom - 8);
    ctx.fill();

    ctx.globalAlpha = 1;
    this._highlightCursorNotes();
  }

  _highlightCursorNotes() {
    if (this.cursorIndex < 0 || !this.track) return;
    const ctx = this.overlayCtx;
    const c = this._colors;
    const { stringCount, timeline } = this.track;
    const event = timeline[this.cursorIndex];
    if (!event) return;

    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;
    const staffY = pos.staffY;

    ctx.save();
    ctx.shadowColor = c.bg;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    for (const note of event.notes) {
      if (note.tieDestination) continue;
      if (note.string < 0 || note.string >= stringCount) continue;

      const x = pos.x;
      const y = staffY + (stringCount - 1 - note.string) * TAB_CONSTANTS.lineSpacing;

      ctx.fillStyle = c.cursor;
      ctx.font = `bold ${TAB_CONSTANTS.fontSize + 1}px ${c.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (note.muted) ctx.fillText('X', x, y);
      else ctx.fillText(note.fret, x, y);
    }
    ctx.restore();
  }

  /**
   * Draw the filled highlight region for the active loop.
   * Covers entire measures from loopA to loopB, spanning multiple systems if needed.
   */
  _drawLoopRegion(ctx, c) {
    if (this.loopA === null || this.loopB === null) return;
    if (!this.track || !this.track.measures) return;

    const measures = this.track.measures;
    const C = TAB_CONSTANTS;

    // Find measure indices containing the loop points
    let startMIdx = -1, endMIdx = -1;
    for (let i = 0; i < measures.length; i++) {
      const m = measures[i];
      if (startMIdx < 0 && m.beatIndices.includes(this.loopA)) startMIdx = i;
      if (m.beatIndices.includes(this.loopB)) endMIdx = i;
    }
    if (startMIdx < 0 || endMIdx < 0) return;

    this._drawMeasureRegion(ctx, c, startMIdx, endMIdx, 0.07);
  }

  /**
   * Draw the drag-in-progress preview highlight.
   */
  _drawDragPreview(ctx, c) {
    if (!this._dragState || !this._dragState.activated) return;
    if (!this.track || !this.track.measures) return;

    const start = Math.min(this._dragState.startMeasureIdx, this._dragState.currentMeasureIdx);
    const end = Math.max(this._dragState.startMeasureIdx, this._dragState.currentMeasureIdx);

    this._drawMeasureRegion(ctx, c, start, end, 0.12);
  }

  /**
   * Draw a highlighted region covering measures from startIdx to endIdx.
   * Handles multi-system spans.
   */
  _drawMeasureRegion(ctx, c, startIdx, endIdx, alpha) {
    if (!this.track || !this.track.measures) return;
    const measures = this.track.measures;
    const C = TAB_CONSTANTS;

    ctx.fillStyle = c.blue;
    ctx.globalAlpha = alpha;

    // Group consecutive measures by system for efficient drawing
    let currentSystem = null;
    let regionX = 0;
    let regionW = 0;

    for (let i = startIdx; i <= endIdx; i++) {
      const m = measures[i];
      if (!m || !m._system) continue;

      if (m._system !== currentSystem) {
        // Flush previous system region
        if (currentSystem) {
          const top = currentSystem.y + C.marginTop - C.cursorOverhang;
          const bottom = currentSystem.y + currentSystem.height - C.marginBottom + C.cursorOverhang;
          ctx.fillRect(regionX, top, regionW, bottom - top);
        }
        currentSystem = m._system;
        regionX = m._renderedX;
        regionW = m._renderedWidth;
      } else {
        regionW = (m._renderedX + m._renderedWidth) - regionX;
      }
    }

    // Flush last system region
    if (currentSystem) {
      const top = currentSystem.y + C.marginTop - C.cursorOverhang;
      const bottom = currentSystem.y + currentSystem.height - C.marginBottom + C.cursorOverhang;
      ctx.fillRect(regionX, top, regionW, bottom - top);
    }

    ctx.globalAlpha = 1;

    // Draw boundary lines at the edges of the region
    const startM = measures[startIdx];
    const endM = measures[endIdx];
    if (startM && startM._system) {
      const sTop = startM._system.y + C.marginTop - C.cursorOverhang;
      const sBot = startM._system.y + startM._system.height - C.marginBottom + C.cursorOverhang;
      ctx.strokeStyle = c.blue;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(startM._renderedX, sTop);
      ctx.lineTo(startM._renderedX, sBot);
      ctx.stroke();
    }
    if (endM && endM._system) {
      const eTop = endM._system.y + C.marginTop - C.cursorOverhang;
      const eBot = endM._system.y + endM._system.height - C.marginBottom + C.cursorOverhang;
      const endX = endM._renderedX + endM._renderedWidth;
      ctx.strokeStyle = c.blue;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(endX, eTop);
      ctx.lineTo(endX, eBot);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawLoopMarkers(ctx, c) {
    if (this.loopA !== null) this._drawLoopMarker(ctx, this.beatPositions[this.loopA], 'A', c.blue);
    if (this.loopB !== null) this._drawLoopMarker(ctx, this.beatPositions[this.loopB], 'B', c.red);
  }

  _drawCheckpointMarkers(ctx) {
    if (this.checkpointIndices.size === 0) return;
    const C = TAB_CONSTANTS;

    for (const idx of this.checkpointIndices) {
      const pos = this.beatPositions[idx];
      if (!pos) continue;

      const top = pos.y + C.marginTop - C.cursorOverhang - 2;
      const size = 4;

      // Small diamond marker
      ctx.fillStyle = '#f59e0b'; // amber
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(pos.x, top - size);
      ctx.lineTo(pos.x + size, top);
      ctx.lineTo(pos.x, top + size);
      ctx.lineTo(pos.x - size, top);
      ctx.closePath();
      ctx.fill();

      // Thin vertical tick line
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(pos.x, top + size);
      ctx.lineTo(pos.x, pos.y + pos.systemHeight - C.marginBottom + C.cursorOverhang);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }
  }

  _drawLoopMarker(ctx, pos, label, color) {
    if (!pos) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = TAB_CONSTANTS.loopMarkerWidth;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y + TAB_CONSTANTS.marginTop - TAB_CONSTANTS.cursorOverhang);
    ctx.lineTo(pos.x, pos.y + pos.systemHeight - TAB_CONSTANTS.marginBottom + TAB_CONSTANTS.cursorOverhang);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${TAB_CONSTANTS.loopMarkerFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, pos.x, pos.y + pos.systemHeight + TAB_CONSTANTS.loopMarkerBottomOffset);
  }

  // --- Scrolling ---

  _scrollToCursor() {
    if (this.cursorIndex < 0) return;
    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;

    const wrapHeight = this.wrap.clientHeight;
    const scrollY = this.wrap.scrollTop;
    if (pos.y < scrollY + TAB_CONSTANTS.scrollPaddingTop || pos.y > scrollY + wrapHeight - TAB_CONSTANTS.scrollPaddingBottom) {
      this.wrap.scrollTo({ top: Math.max(0, pos.y - TAB_CONSTANTS.scrollTargetOffset), behavior: 'smooth' });
    }
  }

  /**
   * Binary search to find the measure containing a given time.
   * O(log n) instead of O(n).
   */
  _findMeasureAtTime(time) {
    const measures = this.track.measures;
    if (!measures || measures.length === 0) return null;

    let lo = 0;
    let hi = measures.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const m = measures[mid];

      if (time < m.startTime - 0.001) {
        hi = mid - 1;
      } else if (time > m.endTime + 0.001) {
        lo = mid + 1;
      } else {
        // Found it
        return m;
      }
    }

    // Clamp to last measure if past end
    if (lo >= measures.length) {
      return measures[measures.length - 1];
    }

    return null;
  }
}
