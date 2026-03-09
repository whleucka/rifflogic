// Guitar configuration constants

export const TUNING = [
  { string: 6, note: 'E', octave: 2, midi: 40 },  // Low E
  { string: 5, note: 'A', octave: 2, midi: 45 },
  { string: 4, note: 'D', octave: 3, midi: 50 },
  { string: 3, note: 'G', octave: 3, midi: 55 },
  { string: 2, note: 'B', octave: 3, midi: 59 },
  { string: 1, note: 'E', octave: 4, midi: 64 },  // High E
];

export const FRET_COUNT = 22;

// SVG dimensions
export const LAYOUT = {
  width: 1200,
  height: 200,
  paddingLeft: 50,   // Space for open string labels
  paddingRight: 20,
  paddingTop: 30,
  paddingBottom: 30,
  nutWidth: 8,
  scaleLength: 1100, // Used for fret spacing calculation
};

// String visual thickness (low E to high E)
export const STRING_WIDTHS = [4, 3.2, 2.6, 2, 1.6, 1.2];

// Fret marker positions
export const FRET_MARKERS = [3, 5, 7, 9, 12, 15, 17, 19, 21];
export const DOUBLE_MARKERS = [12];

// Note circle radius
export const NOTE_RADIUS = 10;

// Audio
export const AUDIO = {
  masterGain: 0.5,
  attack: 0.005,
  decay: 0.1,
  sustain: 0.3,
  release: 0.3,
  filterBase: 2000,
  // Thicker strings get lower filter cutoff
  filterPerString: [1200, 1500, 1800, 2200, 2600, 3000],
};

// Strum
export const STRUM = {
  downDelay: 22,    // ms between strings for downstroke
  upDelay: 20,      // ms between strings for upstroke
  velocity: 0.6,    // gain multiplier for strummed notes
};

// Metronome
export const METRONOME = {
  defaultBpm: 80,
  minBpm: 40,
  maxBpm: 220,
  clickFreqHigh: 1200,
  clickFreqLow: 800,
  clickDuration: 0.03,
  clickGain: 0.3,
  lookaheadMs: 100,
  scheduleIntervalMs: 25,
};
