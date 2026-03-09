// Tempered-scale fret spacing math

import { FRET_COUNT, LAYOUT } from '../config.js';

/**
 * Calculate fret positions using the equal temperament formula:
 * distance = scaleLength - (scaleLength / 2^(fret/12))
 *
 * Returns array of { fret, x } from fret 0 (nut) to FRET_COUNT.
 * x values are normalized to fit within the available SVG width.
 */
export function computeFretPositions() {
  const { scaleLength, paddingLeft, paddingRight, width, nutWidth } = LAYOUT;
  const availableWidth = width - paddingLeft - paddingRight - nutWidth;

  // Raw positions from temperament formula
  const raw = [];
  for (let f = 0; f <= FRET_COUNT; f++) {
    raw.push(scaleLength - scaleLength / Math.pow(2, f / 12));
  }

  // Scale to fit available width
  const maxRaw = raw[raw.length - 1];
  const positions = raw.map((r, f) => ({
    fret: f,
    x: paddingLeft + nutWidth + (r / maxRaw) * availableWidth,
  }));

  return positions;
}

/**
 * Get the X midpoint between two frets (for placing note circles).
 */
export function fretMidX(fretPositions, fret) {
  if (fret === 0) {
    // Open string: position left of nut
    return LAYOUT.paddingLeft - 15;
  }
  const left = fretPositions[fret - 1].x;
  const right = fretPositions[fret].x;
  return (left + right) / 2;
}

/**
 * Compute Y positions for each string.
 * String 0 = low E at bottom, String 5 = high E at top.
 * Reversed so high e is visually on top (player's perspective).
 */
export function computeStringPositions() {
  const { paddingTop, paddingBottom, height } = LAYOUT;
  const playArea = height - paddingTop - paddingBottom;
  const spacing = playArea / 5; // 5 gaps for 6 strings

  return Array.from({ length: 6 }, (_, i) => ({
    string: i,
    y: paddingTop + (5 - i) * spacing,
  }));
}
