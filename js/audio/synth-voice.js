// Oscillator + filter + ADSR envelope per note

import { AUDIO } from '../config.js';
import { getAudioContext, getMasterOutput } from './audio-engine.js';

/**
 * Play a single synthesized guitar note.
 * @param {number} frequency - Note frequency in Hz
 * @param {number} stringIndex - 0 (low E) to 5 (high E) for filter variation
 */
export function playNote(frequency, stringIndex = 3, startTime = null, gainMult = 1) {
  const ctx = getAudioContext();
  const output = getMasterOutput();
  const now = startTime || ctx.currentTime;

  // Oscillator — sawtooth for guitar-like harmonics
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = frequency;

  // Lowpass filter — thicker strings get lower cutoff
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = AUDIO.filterPerString[stringIndex] || AUDIO.filterBase;
  filter.Q.value = 1;

  // Gain node for ADSR envelope
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);

  // Attack
  env.gain.linearRampToValueAtTime(0.8 * gainMult, now + AUDIO.attack);
  // Decay to sustain
  env.gain.linearRampToValueAtTime(AUDIO.sustain * gainMult, now + AUDIO.attack + AUDIO.decay);
  // Sustain hold
  const sustainEnd = now + 0.8;
  env.gain.setValueAtTime(AUDIO.sustain * gainMult, sustainEnd);
  // Release
  env.gain.linearRampToValueAtTime(0, sustainEnd + AUDIO.release);

  // Connect: osc → filter → envelope → master
  osc.connect(filter);
  filter.connect(env);
  env.connect(output);

  osc.start(now);
  osc.stop(sustainEnd + AUDIO.release + 0.05);

  // Cleanup
  osc.onended = () => {
    osc.disconnect();
    filter.disconnect();
    env.disconnect();
  };
}
