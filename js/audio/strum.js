// Strum simulation — staggered note onset across strings

import { TUNING, STRUM } from '../config.js';
import { midiToFrequency } from '../music/notes.js';
import { getAudioContext } from './audio-engine.js';
import { playNote } from './synth-voice.js';
import { events, CHORD_NOTE_ON, CHORD_NOTE_OFF } from '../events.js';

/**
 * Strum a chord voicing.
 * @param {object} voicing - chord voicing with frets array
 * @param {'down'|'up'} direction
 */
export function strumChord(voicing, direction = 'down') {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const delay = (direction === 'down' ? STRUM.downDelay : STRUM.upDelay) / 1000;

  // String order: down = low E first, up = high E first
  const order = direction === 'down' ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0];

  let strumIdx = 0;
  for (const s of order) {
    const fret = voicing.frets[s];
    if (fret === -1) continue;

    const midi = TUNING[s].midi + fret;
    const freq = midiToFrequency(midi);
    const onset = now + strumIdx * delay;

    playNote(freq, s, onset, STRUM.velocity);

    // Visual feedback (setTimeout is fine for visuals)
    const key = `${s}-${fret}`;
    const visualDelay = strumIdx * STRUM.downDelay;
    setTimeout(() => {
      events.emit(CHORD_NOTE_ON, { key, string: s, fret });
    }, visualDelay);

    strumIdx++;
  }

  // Clear visual highlights after sustain
  const totalDuration = strumIdx * STRUM.downDelay + 600;
  setTimeout(() => {
    events.emit(CHORD_NOTE_OFF);
  }, totalDuration);
}
