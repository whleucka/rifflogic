// Chord voicing library and fretboard mapping

import { NOTE_NAMES } from './notes.js';
import { CHORDS } from './intervals.js';
import { TUNING } from '../config.js';

/**
 * Voicing format:
 *   name     - display name (e.g. "C", "Am7")
 *   root     - root note name
 *   quality  - key in CHORDS (e.g. "major", "min7")
 *   frets    - [lowE, A, D, G, B, highE], -1 = muted
 *   fingers  - finger numbers per string (0 = open/muted)
 *   baseFret - 1 = open position, >1 = shifted
 *   barre    - null or { fret, fromString, toString }
 *   category - 'open' | 'barre' | 'jazz'
 */

export const CHORD_VOICINGS = [
  // === Open chords ===
  { name: 'C',   root: 'C', quality: 'major', frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], baseFret: 1, barre: null, category: 'open' },
  { name: 'D',   root: 'D', quality: 'major', frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], baseFret: 1, barre: null, category: 'open' },
  { name: 'E',   root: 'E', quality: 'major', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], baseFret: 1, barre: null, category: 'open' },
  { name: 'G',   root: 'G', quality: 'major', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], baseFret: 1, barre: null, category: 'open' },
  { name: 'A',   root: 'A', quality: 'major', frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], baseFret: 1, barre: null, category: 'open' },

  { name: 'Am',  root: 'A', quality: 'minor', frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], baseFret: 1, barre: null, category: 'open' },
  { name: 'Dm',  root: 'D', quality: 'minor', frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], baseFret: 1, barre: null, category: 'open' },
  { name: 'Em',  root: 'E', quality: 'minor', frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], baseFret: 1, barre: null, category: 'open' },

  { name: 'C7',  root: 'C', quality: 'dom7', frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0], baseFret: 1, barre: null, category: 'open' },
  { name: 'D7',  root: 'D', quality: 'dom7', frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], baseFret: 1, barre: null, category: 'open' },
  { name: 'E7',  root: 'E', quality: 'dom7', frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0], baseFret: 1, barre: null, category: 'open' },
  { name: 'G7',  root: 'G', quality: 'dom7', frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1], baseFret: 1, barre: null, category: 'open' },
  { name: 'A7',  root: 'A', quality: 'dom7', frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], baseFret: 1, barre: null, category: 'open' },
  { name: 'B7',  root: 'B', quality: 'dom7', frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4], baseFret: 1, barre: null, category: 'open' },

  // === Barre chords ===
  { name: 'F',   root: 'F', quality: 'major', frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], baseFret: 1, barre: { fret: 1, fromString: 0, toString: 5 }, category: 'barre' },
  { name: 'Fm',  root: 'F', quality: 'minor', frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1], baseFret: 1, barre: { fret: 1, fromString: 0, toString: 5 }, category: 'barre' },
  { name: 'Bb',  root: 'A#', quality: 'major', frets: [-1, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1], baseFret: 1, barre: { fret: 1, fromString: 1, toString: 5 }, category: 'barre' },
  { name: 'Bbm', root: 'A#', quality: 'minor', frets: [-1, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1], baseFret: 1, barre: { fret: 1, fromString: 1, toString: 5 }, category: 'barre' },
  { name: 'Bm',  root: 'B', quality: 'minor', frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1], baseFret: 2, barre: { fret: 2, fromString: 1, toString: 5 }, category: 'barre' },
  { name: 'B',   root: 'B', quality: 'major', frets: [-1, 2, 4, 4, 4, 2], fingers: [0, 1, 2, 3, 4, 1], baseFret: 2, barre: { fret: 2, fromString: 1, toString: 5 }, category: 'barre' },
  { name: 'F#m', root: 'F#', quality: 'minor', frets: [2, 4, 4, 2, 2, 2], fingers: [1, 3, 4, 1, 1, 1], baseFret: 2, barre: { fret: 2, fromString: 0, toString: 5 }, category: 'barre' },
  { name: 'C#m', root: 'C#', quality: 'minor', frets: [-1, 4, 6, 6, 5, 4], fingers: [0, 1, 3, 4, 2, 1], baseFret: 4, barre: { fret: 4, fromString: 1, toString: 5 }, category: 'barre' },
  { name: 'Ab',  root: 'G#', quality: 'major', frets: [4, 6, 6, 5, 4, 4], fingers: [1, 3, 4, 2, 1, 1], baseFret: 4, barre: { fret: 4, fromString: 0, toString: 5 }, category: 'barre' },

  // === Jazz voicings ===
  { name: 'Cmaj7',  root: 'C', quality: 'maj7', frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Dm7',    root: 'D', quality: 'min7', frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Em7',    root: 'E', quality: 'min7', frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Fmaj7',  root: 'F', quality: 'maj7', frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Am7',    root: 'A', quality: 'min7', frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Gmaj7',  root: 'G', quality: 'maj7', frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Amaj7',  root: 'A', quality: 'maj7', frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Bm7',    root: 'B', quality: 'min7', frets: [-1, 2, 0, 2, 0, 2], fingers: [0, 1, 0, 2, 0, 3], baseFret: 1, barre: null, category: 'jazz' },
  { name: 'Bdim',   root: 'B', quality: 'dim', frets: [-1, 2, 3, 4, 3, -1], fingers: [0, 1, 2, 4, 3, 0], baseFret: 2, barre: null, category: 'jazz' },
];

// Quality display names
export const QUALITY_NAMES = {
  major: 'Major',
  minor: 'Minor',
  dom7:  '7',
  maj7:  'Maj7',
  min7:  'Min7',
  dim:   'Dim',
  aug:   'Aug',
};

/**
 * Get all voicings matching root and quality.
 */
export function getChordVoicings(rootName, quality) {
  return CHORD_VOICINGS.filter(v => v.root === rootName && v.quality === quality);
}

/**
 * Get voicings by category.
 */
export function getChordsByCategory(category) {
  return CHORD_VOICINGS.filter(v => v.category === category);
}

/**
 * Convert a voicing into a fretboard Map ("string-fret" → { degree, isRoot }).
 * Uses the chord formula from intervals.js to determine degrees.
 */
export function chordToFretboardMap(voicing) {
  const result = new Map();
  const formula = CHORDS[voicing.quality];
  const rootIndex = NOTE_NAMES.indexOf(voicing.root);
  if (rootIndex === -1 || !formula) return result;

  for (let s = 0; s < 6; s++) {
    const fret = voicing.frets[s];
    if (fret === -1) continue;

    const midi = TUNING[s].midi + fret;
    const pc = midi % 12;
    const interval = (pc - rootIndex + 12) % 12;
    const degreeIdx = formula.indexOf(interval);
    const isRoot = interval === 0;

    result.set(`${s}-${fret}`, {
      degree: degreeIdx >= 0 ? degreeIdx : 0,
      isRoot,
      interval,
    });
  }

  return result;
}

/**
 * Common chord progressions.
 */
export const COMMON_PROGRESSIONS = [
  { name: 'I-IV-V-I (C)',       chords: ['C', 'F', 'G', 'C'] },
  { name: 'I-V-vi-IV (G)',      chords: ['G', 'D', 'Em', 'C'] },
  { name: 'i-iv-v (Am)',        chords: ['Am', 'Dm', 'Em'] },
  { name: 'I-vi-IV-V (C)',      chords: ['C', 'Am', 'F', 'G'] },
  { name: 'ii-V-I (C)',         chords: ['Dm7', 'G7', 'Cmaj7'] },
  { name: 'I-IV-vi-V (G)',      chords: ['G', 'C', 'Em', 'D'] },
  { name: '12-Bar Blues (A)',    chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'] },
];

/**
 * Look up a voicing by display name.
 */
export function getVoicingByName(name) {
  return CHORD_VOICINGS.find(v => v.name === name) || null;
}
