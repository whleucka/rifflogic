// Audio analysis for YouTube/Tab synchronization
// Onset detection and cross-correlation for automatic offset calculation

import { getAudioContext } from './audio-engine.js';

// --- Constants ---
const FFT_SIZE = 2048;
const ANALYSIS_DURATION = 90; // Analyze first 90 seconds (covers most song intros)
const ONSET_THRESHOLD = 0.15; // Energy threshold for onset detection
const MIN_ONSET_INTERVAL = 0.05; // Minimum time between onsets (50ms)
const CORRELATION_SEARCH_RANGE = 60; // Search +/- 60 seconds for offset
const CORRELATION_RESOLUTION = 0.05; // 50ms resolution for correlation

// --- State ---
let analyser = null;
let analyserSource = null;
let isAnalyzing = false;

/**
 * Create and connect an AnalyserNode to the YouTube audio chain.
 * Call this after YouTube audio is loaded.
 * @param {MediaElementAudioSourceNode} sourceNode - The YouTube audio source node
 * @param {GainNode} gainNode - The gain node in the chain
 */
export function attachAnalyser(sourceNode, gainNode) {
  const ctx = getAudioContext();
  
  // Clean up existing analyser
  if (analyser) {
    analyser.disconnect();
  }
  
  analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.3;
  
  // Insert analyser into the chain: source -> analyser -> gain -> output
  // We need to reconnect the chain
  sourceNode.disconnect();
  sourceNode.connect(analyser);
  analyser.connect(gainNode);
  
  analyserSource = sourceNode;
  
  console.log('[AudioAnalysis] Analyser attached to YouTube audio');
}

/**
 * Detach the analyser node (cleanup).
 */
export function detachAnalyser() {
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
  analyserSource = null;
}

/**
 * Check if analyser is ready for analysis.
 */
export function isAnalyserReady() {
  return analyser !== null;
}

/**
 * Extract onset times from the tab timeline.
 * Onsets are times when notes start playing (excluding ties).
 * @param {Array} timeline - The tab player timeline
 * @returns {number[]} Array of onset times in seconds
 */
export function extractTabOnsets(timeline) {
  if (!timeline || timeline.length === 0) return [];
  
  const onsets = [];
  let lastOnsetTime = -MIN_ONSET_INTERVAL;
  
  for (const event of timeline) {
    // Skip if too close to last onset
    if (event.time - lastOnsetTime < MIN_ONSET_INTERVAL) continue;
    
    // Check if this beat has any non-tie notes
    const notes = event.notes || [];
    const hasNewNotes = notes.length > 0 && notes.some(note => !note.tieDestination);
    
    if (hasNewNotes) {
      onsets.push(event.time);
      lastOnsetTime = event.time;
    }
  }
  
  // Only return onsets within analysis duration
  return onsets.filter(t => t < ANALYSIS_DURATION);
}

/**
 * Detect onsets from YouTube audio using spectral flux.
 * This analyzes the audio in real-time-ish by seeking through it.
 * @param {HTMLAudioElement} audioElement - The YouTube audio element
 * @param {Function} onProgress - Progress callback (0-1)
 * @returns {Promise<number[]>} Array of onset times in seconds
 */
export async function detectYouTubeOnsets(audioElement, onProgress = () => {}) {
  if (!analyser) {
    throw new Error('Analyser not attached. Call attachAnalyser first.');
  }
  
  if (isAnalyzing) {
    throw new Error('Analysis already in progress');
  }
  
  isAnalyzing = true;
  
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  const onsets = [];
  let previousSpectrum = null;
  let lastOnsetTime = -MIN_ONSET_INTERVAL;
  
  // We'll analyze by playing the audio silently and capturing the spectrum
  // Save current state
  const wasPlaying = !audioElement.paused;
  const originalTime = audioElement.currentTime;
  const originalVolume = audioElement.volume;
  
  // Mute and seek to start
  audioElement.volume = 0;
  audioElement.currentTime = 0;
  
  const duration = Math.min(audioElement.duration || ANALYSIS_DURATION, ANALYSIS_DURATION);
  const stepTime = FFT_SIZE / sampleRate; // ~46ms per step at 44.1kHz
  
  try {
    // Wait for seek to complete
    await new Promise(resolve => {
      const onSeeked = () => {
        audioElement.removeEventListener('seeked', onSeeked);
        resolve();
      };
      audioElement.addEventListener('seeked', onSeeked);
    });
    
    // Play to start analysis
    await audioElement.play();
    
    // Analyze in chunks
    let currentTime = 0;
    
    while (currentTime < duration && isAnalyzing) {
      // Get current frequency data
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate spectral flux (change from previous frame)
      if (previousSpectrum) {
        let flux = 0;
        for (let i = 0; i < bufferLength; i++) {
          const diff = dataArray[i] - previousSpectrum[i];
          if (diff > 0) flux += diff; // Only positive flux (increases)
        }
        flux /= bufferLength * 255; // Normalize
        
        // Detect onset if flux exceeds threshold
        if (flux > ONSET_THRESHOLD && currentTime - lastOnsetTime >= MIN_ONSET_INTERVAL) {
          onsets.push(currentTime);
          lastOnsetTime = currentTime;
        }
      }
      
      // Store current spectrum for next iteration
      previousSpectrum = new Uint8Array(dataArray);
      
      // Wait for next frame
      await new Promise(resolve => setTimeout(resolve, stepTime * 1000));
      currentTime = audioElement.currentTime;
      
      // Report progress
      onProgress(currentTime / duration);
    }
    
  } finally {
    // Restore original state
    audioElement.pause();
    audioElement.currentTime = originalTime;
    audioElement.volume = originalVolume;
    
    if (wasPlaying) {
      await audioElement.play();
    }
    
    isAnalyzing = false;
  }
  
  console.log(`[AudioAnalysis] Detected ${onsets.length} onsets in YouTube audio`);
  return onsets;
}

/**
 * Detect onsets using offline analysis (faster, more accurate).
 * Requires fetching the audio buffer directly.
 * @param {string} audioUrl - URL to the audio file
 * @param {Function} onProgress - Progress callback (0-1)
 * @returns {Promise<number[]>} Array of onset times in seconds
 */
export async function detectOnsetsOffline(audioUrl, onProgress = () => {}) {
  const ctx = getAudioContext();
  
  onProgress(0);
  
  // Fetch the audio data
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  onProgress(0.2);
  
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  onProgress(0.4);
  
  const onsets = analyzeBufferOnsets(audioBuffer, (p) => onProgress(0.4 + p * 0.6));
  
  return onsets;
}

/**
 * Analyze an AudioBuffer for onsets using energy-based detection.
 * @param {AudioBuffer} buffer
 * @param {Function} onProgress
 * @returns {number[]} Onset times in seconds
 */
function analyzeBufferOnsets(buffer, onProgress = () => {}) {
  const sampleRate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0); // Use first channel
  
  // Limit analysis to first N seconds
  const maxSamples = Math.min(channelData.length, ANALYSIS_DURATION * sampleRate);
  
  const hopSize = 512; // ~11.6ms at 44.1kHz
  const frameSize = 2048;
  
  // First pass: compute all energies and diffs
  const energies = [];
  const diffData = []; // { time, diff, energy }
  
  for (let i = 0; i < maxSamples - frameSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < frameSize; j++) {
      energy += channelData[i + j] ** 2;
    }
    energy = Math.sqrt(energy / frameSize);
    energies.push(energy);
    
    if (energies.length > 1) {
      const diff = Math.max(0, energy - energies[energies.length - 2]);
      const time = (energies.length * hopSize) / sampleRate;
      diffData.push({ time, diff, energy });
    }
  }
  
  // Compute statistics for adaptive threshold
  const diffs = diffData.map(d => d.diff);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const stdDiff = Math.sqrt(diffs.reduce((a, b) => a + (b - meanDiff) ** 2, 0) / diffs.length);
  
  // Use slightly lower threshold to catch more onsets
  const adaptiveThreshold = meanDiff + 1.5 * stdDiff;
  
  // Also compute energy statistics to filter out quiet sections
  const meanEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
  const maxEnergy = Math.max(...energies);
  // Ignore onsets below 5% of max energy - this filters out background noise 
  // while keeping most intros. Also ensure it's at least above 10% of mean energy.
  const minEnergy = Math.max(maxEnergy * 0.05, meanEnergy * 0.1);
  
  console.log(`[AudioAnalysis] Energy: mean=${meanEnergy.toFixed(4)}, max=${maxEnergy.toFixed(4)}, minThreshold=${minEnergy.toFixed(4)}`);
  
  // Second pass: detect strong onsets only
  const onsets = [];
  let lastOnsetTime = -MIN_ONSET_INTERVAL;
  
  for (const d of diffData) {
    if (d.diff > adaptiveThreshold && 
        d.energy > minEnergy && 
        d.time - lastOnsetTime >= MIN_ONSET_INTERVAL) {
      onsets.push(d.time);
      lastOnsetTime = d.time;
    }
  }
  
  onProgress(1);
  
  console.log(`[AudioAnalysis] Onset threshold=${adaptiveThreshold.toFixed(4)}`);
  console.log(`[AudioAnalysis] Detected ${onsets.length} strong onsets`);
  
  return onsets;
}

/**
 * Find the optimal offset between tab onsets and YouTube onsets using cross-correlation.
 * @param {number[]} tabOnsets - Onset times from tab timeline
 * @param {number[]} ytOnsets - Onset times from YouTube audio
 * @returns {{ offset: number, confidence: number, debug: object }} Best offset and confidence score
 */
export function findOptimalOffset(tabOnsets, ytOnsets) {
  if (tabOnsets.length === 0 || ytOnsets.length === 0) {
    return { offset: 0, confidence: 0 };
  }
  
  console.log(`[AudioAnalysis] Correlating ${tabOnsets.length} tab onsets with ${ytOnsets.length} YouTube onsets`);
  console.log(`[AudioAnalysis] Tab onset range: ${tabOnsets[0].toFixed(2)}s - ${tabOnsets[tabOnsets.length-1].toFixed(2)}s`);
  console.log(`[AudioAnalysis] YT onset range: ${ytOnsets[0].toFixed(2)}s - ${ytOnsets[ytOnsets.length-1].toFixed(2)}s`);
  
  // Try different offsets and compute correlation score
  const minOffset = -CORRELATION_SEARCH_RANGE;
  const maxOffset = CORRELATION_SEARCH_RANGE;
  
  let bestOffset = 0;
  let bestScore = 0;
  const scores = [];
  
  for (let offset = minOffset; offset <= maxOffset; offset += CORRELATION_RESOLUTION) {
    const score = computeCorrelation(tabOnsets, ytOnsets, offset);
    scores.push({ offset, score });
    
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  
  // Refine around the best offset with finer resolution
  const fineMin = bestOffset - CORRELATION_RESOLUTION * 2;
  const fineMax = bestOffset + CORRELATION_RESOLUTION * 2;
  const fineStep = 0.01; // 10ms resolution
  
  for (let offset = fineMin; offset <= fineMax; offset += fineStep) {
    const score = computeCorrelation(tabOnsets, ytOnsets, offset);
    
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  
  // Sort candidates by score to find other peaks
  const sortedScores = [...scores].sort((a, b) => b.score - a.score);
  
  // Find second best peak that is far enough from the best offset
  let secondBestScore = 0;
  for (const s of sortedScores) {
    if (Math.abs(s.offset - bestOffset) > 1.0) { // 1 second gap
      secondBestScore = s.score;
      break;
    }
  }
  
  // Confidence is a combination of:
  // 1. How much better the best is than average (signal-to-noise)
  // 2. How much better the best is than the next best distinct peak
  // 3. Absolute match rate (higher = more likely correct)
  const avgScore = scores.reduce((a, b) => a + b.score, 0) / scores.length;
  const peakGap = secondBestScore > 0 ? (bestScore - secondBestScore) / secondBestScore : 1;
  const avgGap = avgScore > 0 ? (bestScore - avgScore) / avgScore : 0;
  
  const maxPossibleScore = tabOnsets.length; 
  const matchRate = bestScore / maxPossibleScore;
  
  // Rhythmic music (like Nirvana) often has peaks very close in score (echoes).
  // We use a non-linear scaling for peakGap and include matchRate as a booster.
  let confidence = Math.min(1, avgGap * 0.4) * (0.3 + 0.7 * Math.min(1, peakGap * 20));
  
  // Boost confidence if match rate is high (> 40%)
  if (matchRate > 0.4) {
    confidence = Math.min(1, confidence * 1.5);
  }
  
  // Log top 5 candidates to help debug
  const topCandidates = sortedScores.slice(0, 5);
  console.log(`[AudioAnalysis] Top 5 offset candidates:`);
  for (const s of topCandidates) {
    const rate = (s.score / maxPossibleScore * 100).toFixed(1);
    console.log(`  ${s.offset.toFixed(2)}s: score=${s.score.toFixed(1)} (${rate}%)`);
  }
  
  console.log(`[AudioAnalysis] Best offset: ${bestOffset.toFixed(2)}s`);
  console.log(`[AudioAnalysis] Score: ${bestScore.toFixed(1)} / ${maxPossibleScore} (${(matchRate * 100).toFixed(1)}% match rate)`);
  console.log(`[AudioAnalysis] Gap to next peak: ${(peakGap * 100).toFixed(1)}%`);
  console.log(`[AudioAnalysis] Confidence: ${(confidence * 100).toFixed(1)}%`);
  
  return { offset: bestOffset, confidence, matchRate };
}

/**
 * Compute correlation score for a given offset.
 * Score = sum of (1 / (1 + distance)) for each tab onset to nearest YouTube onset.
 * @param {number[]} tabOnsets
 * @param {number[]} ytOnsets
 * @param {number} offset - Offset where ytTime = tabTime + offset
 *                          Positive = YouTube has intro (seek ahead)
 *                          Negative = Tab has intro (delay YouTube start)
 * @returns {number} Correlation score
 */
function computeCorrelation(tabOnsets, ytOnsets, offset) {
  let score = 0;
  const tolerance = 0.1; // 100ms tolerance for matching
  
  for (const tabTime of tabOnsets) {
    // We want to find: at what YouTube time does this tab onset occur?
    // If offset is positive, YouTube is ahead (has intro we skip)
    // If offset is negative, tab is ahead (we delay YouTube)
    const ytTime = tabTime + offset;
    
    // Find nearest YouTube onset using binary search
    let lo = 0;
    let hi = ytOnsets.length - 1;
    
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ytOnsets[mid] < ytTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    
    // Check both lo and lo-1 for nearest
    let minDist = Infinity;
    if (lo < ytOnsets.length) {
      minDist = Math.abs(ytOnsets[lo] - ytTime);
    }
    if (lo > 0) {
      minDist = Math.min(minDist, Math.abs(ytOnsets[lo - 1] - ytTime));
    }
    
    // Score inversely proportional to distance
    if (minDist < tolerance) {
      score += 1 / (1 + minDist * 10);
    }
  }
  
  return score;
}

/**
 * Perform automatic sync analysis and return optimal offset.
 * This is the main entry point for the auto-sync feature.
 * @param {string} audioUrl - URL to YouTube audio stream
 * @param {Array} tabTimeline - The tab player timeline
 * @param {Function} onProgress - Progress callback with { stage, progress }
 * @returns {Promise<{ offset: number, confidence: number }>}
 */
export async function autoSync(audioUrl, tabTimeline, onProgress = () => {}) {
  // Stage 1: Extract tab onsets
  onProgress({ stage: 'tab', progress: 0 });
  const tabOnsets = extractTabOnsets(tabTimeline);
  onProgress({ stage: 'tab', progress: 1 });
  
  if (tabOnsets.length < 5) {
    console.warn('[AudioAnalysis] Too few tab onsets for reliable sync');
    return { offset: 0, confidence: 0 };
  }
  
  // Stage 2: Detect YouTube onsets via offline analysis
  onProgress({ stage: 'youtube', progress: 0 });
  let ytOnsets;
  try {
    ytOnsets = await detectOnsetsOffline(audioUrl, (p) => {
      onProgress({ stage: 'youtube', progress: p });
    });
  } catch (err) {
    console.error('[AudioAnalysis] Failed to analyze YouTube audio:', err);
    return { offset: 0, confidence: 0 };
  }
  
  if (ytOnsets.length < 5) {
    console.warn('[AudioAnalysis] Too few YouTube onsets detected');
    return { offset: 0, confidence: 0 };
  }
  
  // Stage 3: Find optimal offset via cross-correlation
  onProgress({ stage: 'correlate', progress: 0 });
  const result = findOptimalOffset(tabOnsets, ytOnsets);
  onProgress({ stage: 'correlate', progress: 1 });
  
  return result;
}

/**
 * Cancel any ongoing analysis.
 */
export function cancelAnalysis() {
  isAnalyzing = false;
}
