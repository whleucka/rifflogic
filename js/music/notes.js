// Note names, MIDI math, frequency computation

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Friendly names for display (using sharps)
export const NOTE_DISPLAY = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/**
 * MIDI number to frequency: 440 * 2^((midi - 69) / 12)
 */
export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * MIDI number to note name
 */
export function midiToNoteName(midi) {
  return NOTE_NAMES[midi % 12];
}

/**
 * MIDI number to display name (with unicode sharp)
 */
export function midiToDisplayName(midi) {
  return NOTE_DISPLAY[midi % 12];
}

/**
 * MIDI number to octave
 */
export function midiToOctave(midi) {
  return Math.floor(midi / 12) - 1;
}

/**
 * Get full note info from string MIDI base + fret
 */
export function getNoteInfo(baseMidi, fret) {
  const midi = baseMidi + fret;
  return {
    midi,
    name: midiToNoteName(midi),
    display: midiToDisplayName(midi),
    octave: midiToOctave(midi),
    frequency: midiToFrequency(midi),
  };
}
