// Scale computation: map scale formulas onto the fretboard

import { SCALES } from './intervals.js';
import { NOTE_NAMES } from './notes.js';
import { TUNING, FRET_COUNT } from '../config.js';

/**
 * Display names for scales
 */
export const SCALE_DISPLAY_NAMES = {
  major:            'Major (Ionian)',
  minor:            'Natural Minor (Aeolian)',
  pentatonic_major: 'Major Pentatonic',
  pentatonic_minor: 'Minor Pentatonic',
  blues:            'Blues',
  dorian:           'Dorian',
  mixolydian:       'Mixolydian',
  harmonic_minor:   'Harmonic Minor',
};

/**
 * Degree labels for scale tones (1-indexed)
 */
export const DEGREE_LABELS = ['R', '2', '3', '4', '5', '6', '7'];

/**
 * CAGED position fret ranges for major scale.
 * Each position spans ~4-5 frets. Defined as [minFret, maxFret] per shape.
 * These shift based on root note.
 */
const CAGED_SHAPES = {
  C: { baseFret: 0, span: [0, 3] },
  A: { baseFret: 3, span: [2, 5] },
  G: { baseFret: 5, span: [4, 8] },
  E: { baseFret: 7, span: [7, 10] },
  D: { baseFret: 10, span: [9, 13] },
};

/**
 * Compute all fretboard positions that belong to a scale.
 * @param {string} rootName - e.g. 'C', 'F#'
 * @param {string} scaleKey - key in SCALES object
 * @returns {Map} key "string-fret" → { degree, isRoot }
 */
export function computeScaleMap(rootName, scaleKey) {
  const formula = SCALES[scaleKey];
  if (!formula) return new Map();

  const rootIndex = NOTE_NAMES.indexOf(rootName);
  if (rootIndex === -1) return new Map();

  // Build set of MIDI pitch classes in the scale
  const scalePCs = new Set(formula.map(interval => (rootIndex + interval) % 12));

  const result = new Map();

  for (let s = 0; s < 6; s++) {
    const baseMidi = TUNING[s].midi;
    for (let f = 0; f <= FRET_COUNT; f++) {
      const midi = baseMidi + f;
      const pc = midi % 12;
      if (scalePCs.has(pc)) {
        const isRoot = pc === rootIndex;
        // Compute degree index
        const interval = (pc - rootIndex + 12) % 12;
        const degreeIdx = formula.indexOf(interval);
        result.set(`${s}-${f}`, {
          degree: degreeIdx,
          isRoot,
          interval,
        });
      }
    }
  }

  return result;
}

/**
 * Get CAGED position names in order.
 */
export function getCAGEDPositions() {
  return ['C', 'A', 'G', 'E', 'D'];
}

/**
 * Filter a scale map to a CAGED position's fret range.
 * @param {Map} scaleMap - full scale map from computeScaleMap
 * @param {string} rootName - root note name
 * @param {string} position - 'C', 'A', 'G', 'E', or 'D'
 * @returns {Map} filtered scale map
 */
export function filterCAGEDPosition(scaleMap, rootName, position) {
  const shape = CAGED_SHAPES[position];
  if (!shape) return scaleMap;

  const rootIndex = NOTE_NAMES.indexOf(rootName);
  // Shift: C major starts at fret 0, other roots shift up
  // The offset is the semitone distance from C
  const offset = (rootIndex - 0 + 12) % 12;
  const minFret = shape.span[0] + offset;
  const maxFret = shape.span[1] + offset;

  const filtered = new Map();
  for (const [key, value] of scaleMap) {
    const fret = parseInt(key.split('-')[1]);
    if (fret >= minFret && fret <= maxFret) {
      filtered.set(key, value);
    }
  }

  return filtered;
}
