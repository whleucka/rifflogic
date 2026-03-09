// AudioContext management, master gain, compressor

import { AUDIO } from '../config.js';

let ctx = null;
let masterGain = null;
let compressor = null;

/**
 * Lazily initialize AudioContext on first user gesture (Chrome autoplay policy).
 */
export function getAudioContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master compressor to prevent clipping
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    compressor.connect(ctx.destination);

    // Master gain
    masterGain = ctx.createGain();
    masterGain.gain.value = AUDIO.masterGain;
    masterGain.connect(compressor);
  }

  // Resume if suspended (happens after tab goes idle)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  return ctx;
}

export function getMasterOutput() {
  getAudioContext();
  return masterGain;
}

export function setMasterVolume(value) {
  if (masterGain) {
    masterGain.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
  }
}
