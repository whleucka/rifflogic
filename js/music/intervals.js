// Scale and chord formulas (seed data for future phases)

export const SCALES = {
  major:            [0, 2, 4, 5, 7, 9, 11],
  minor:            [0, 2, 3, 5, 7, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues:            [0, 3, 5, 6, 7, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  harmonic_minor:   [0, 2, 3, 5, 7, 8, 11],
};

export const CHORDS = {
  major:  [0, 4, 7],
  minor:  [0, 3, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
  dom7:   [0, 4, 7, 10],
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
};
