// Karplus-Strong plucked string synthesis
// Pre-computed waveform buffer — no real-time feedback loops

import { getAudioContext, getMasterOutput } from './audio-engine.js';

/**
 * Pre-compute a Karplus-Strong plucked string waveform into an AudioBuffer.
 *
 * Algorithm:
 * 1. Fill a short delay line (length = sampleRate / frequency) with white noise
 * 2. Iterate: each output sample = average of two adjacent delay-line values * decay
 * 3. This naturally produces a pitched, decaying plucked-string tone
 *
 * @param {AudioContext} ctx
 * @param {number} frequency - Target pitch in Hz
 * @param {number} duration - Buffer length in seconds
 * @param {number} damping - Per-sample decay factor (0.99-1.0), lower = duller/shorter
 * @param {number} brightness - Blend between averaged (0) and raw (1) feedback
 * @returns {AudioBuffer}
 */
function generateKarplusBuffer(ctx, frequency, duration, damping, brightness) {
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.ceil(sampleRate * duration);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Delay line length determines pitch
  const period = Math.round(sampleRate / frequency);
  if (period < 2) {
    // Frequency too high for this sample rate, fill with silence
    return buffer;
  }

  // Initialize delay line with white noise (the "pluck" excitation)
  const delayLine = new Float32Array(period);
  for (let i = 0; i < period; i++) {
    delayLine[i] = Math.random() * 2 - 1;
  }

  // Generate samples using the Karplus-Strong averaging filter
  let readPos = 0;
  for (let i = 0; i < totalSamples; i++) {
    const curr = delayLine[readPos];
    const next = delayLine[(readPos + 1) % period];

    // Output the current sample
    data[i] = curr;

    // Karplus-Strong averaging filter: blend between pure average and raw sample
    // brightness=0 gives classic KS (mellow), brightness=1 bypasses averaging (harsh)
    const averaged = (curr + next) * 0.5;
    const filtered = averaged * (1 - brightness) + curr * brightness;

    // Write back with decay
    delayLine[readPos] = filtered * damping;

    readPos = (readPos + 1) % period;
  }

  return buffer;
}

// Cache buffers for recently used frequencies to avoid recomputation
const bufferCache = new Map();
const MAX_CACHE_SIZE = 60;

function getCachedBuffer(ctx, frequency, duration, damping, brightness) {
  // Round frequency to nearest Hz for cache key
  const key = `${Math.round(frequency)}-${duration.toFixed(2)}-${damping.toFixed(4)}-${brightness.toFixed(2)}`;

  if (bufferCache.has(key)) {
    return bufferCache.get(key);
  }

  const buffer = generateKarplusBuffer(ctx, frequency, duration, damping, brightness);

  // Evict oldest entries if cache is full
  if (bufferCache.size >= MAX_CACHE_SIZE) {
    const firstKey = bufferCache.keys().next().value;
    bufferCache.delete(firstKey);
  }

  bufferCache.set(key, buffer);
  return buffer;
}

/**
 * Play a Karplus-Strong plucked string note.
 * @param {number} frequency - Note frequency in Hz
 * @param {number} stringIndex - 0 (low E) to 5 (high E) for tonal variation
 * @param {number} startTime - AudioContext scheduled time (null = now)
 * @param {number} gainMult - Gain multiplier (0-1)
 */
export function playNote(frequency, stringIndex = 3, startTime = null, gainMult = 1) {
  const ctx = getAudioContext();
  const output = getMasterOutput();
  const now = startTime || ctx.currentTime;

  // Clamp frequency to valid range
  const freq = Math.max(20, Math.min(frequency, 8000));

  // Per-string parameters: lower strings are duller and sustain longer
  // damping: closer to 1 = longer sustain, lower = faster decay
  const dampingValues =    [0.9965, 0.9960, 0.9955, 0.9948, 0.9940, 0.9930];
  const brightnessValues = [0.05,   0.08,   0.12,   0.18,   0.22,   0.28];
  const durationValues =   [2.5,    2.2,    2.0,    1.8,    1.6,    1.4];

  const idx = Math.max(0, Math.min(5, stringIndex));
  const damping = dampingValues[idx];
  const brightness = brightnessValues[idx];
  const duration = durationValues[idx];

  // Generate or retrieve the plucked string buffer
  const buffer = getCachedBuffer(ctx, freq, duration, damping, brightness);

  // --- Playback chain: buffer → body filter → gain envelope → output ---
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Body resonance (subtle guitar-body warmth)
  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 220;
  body.Q.value = 0.7;
  body.gain.value = 2;

  // Slight high-shelf cut to tame harshness
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 4000;
  shelf.gain.value = -3;

  // Output gain
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.55 * gainMult, now);
  // Gentle fade at the tail end to avoid clicks
  env.gain.setValueAtTime(0.55 * gainMult, now + duration * 0.85);
  env.gain.linearRampToValueAtTime(0, now + duration);

  source.connect(body);
  body.connect(shelf);
  shelf.connect(env);
  env.connect(output);

  source.start(now);
  source.stop(now + duration);

  // Cleanup
  source.onended = () => {
    source.disconnect();
    body.disconnect();
    shelf.disconnect();
    env.disconnect();
  };
}
