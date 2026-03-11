// Guitar app server - serves frontend + YouTube audio proxy
// Run: npm install && npm start

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { createReadStream, existsSync, mkdirSync, unlinkSync, readdirSync, statSync, promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CACHE_DIR = join(__dirname, '.cache');
const MAX_CACHE_SIZE_MB = 500;
const MAX_CACHE_AGE_HOURS = 24;

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(PROJECT_ROOT));

const PORT = process.env.PORT || 3333;

/**
 * Search YouTube for videos matching query
 * GET /api/youtube/search?q=nirvana+come+as+you+are+lyric+video&limit=5
 */
app.get('/api/youtube/search', async (req, res) => {
  const query = req.query.q;
  const limit = Math.min(parseInt(req.query.limit) || 5, 10);

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter: q' });
  }

  try {
    const results = await ytSearch(query, limit);
    res.json({ results });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

/**
 * Get audio stream URL for a video (direct URL, no proxy)
 * GET /api/youtube/audio-url/:videoId
 */
app.get('/api/youtube/audio-url/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  try {
    const audioUrl = await getAudioUrl(videoId);
    res.json({ url: audioUrl, videoId });
  } catch (err) {
    console.error('Audio URL error:', err.message);
    res.status(500).json({ error: 'Failed to get audio URL', details: err.message });
  }
});

/**
 * Stream audio through server with proper range request support
 * GET /api/youtube/stream/:videoId
 */
app.get('/api/youtube/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  const cachedFile = join(CACHE_DIR, `${videoId}.mp3`);

  // Download if not cached
  if (!existsSync(cachedFile)) {
    console.log(`[DOWNLOAD] ${videoId}`);
    try {
      await downloadAudio(videoId, cachedFile);
      cleanupCache();
    } catch (err) {
      console.error('Download error:', err.message);
      return res.status(500).json({ error: 'Failed to download audio', details: err.message });
    }
  } else {
    console.log(`[CACHE HIT] ${videoId}`);
  }

  // Get file stats
  const stat = await fsp.stat(cachedFile);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Handle range request for seeking
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    console.log(`[RANGE] ${videoId}: bytes ${start}-${end}/${fileSize}`);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
    });

    createReadStream(cachedFile, { start, end }).pipe(res);
  } else {
    // Full file request
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    });

    createReadStream(cachedFile).pipe(res);
  }
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'youtube-proxy' });
});

// --- yt-dlp helpers ---

function ytSearch(query, limit) {
  return new Promise((resolve, reject) => {
    const args = [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
    ];

    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }

      try {
        // Each line is a JSON object
        const results = stdout
          .trim()
          .split('\n')
          .filter(line => line)
          .map(line => {
            const data = JSON.parse(line);
            return {
              id: data.id,
              title: data.title,
              channel: data.channel || data.uploader,
              duration: data.duration,
              thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${data.id}/mqdefault.jpg`,
            };
          });
        resolve(results);
      } catch (e) {
        reject(new Error('Failed to parse search results'));
      }
    });
  });
}

function getAudioUrl(videoId) {
  return new Promise((resolve, reject) => {
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      '-f', 'bestaudio',
      '-g', // Get URL only
      '--no-warnings',
    ];

    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
      resolve(stdout.trim());
    });
  });
}

function downloadAudio(videoId, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      '-f', 'bestaudio/best', // Fallback to best if bestaudio unavailable
      '-x', // Extract audio
      '--audio-format', 'mp3', // More compatible than opus
      '--audio-quality', '0',
      '-o', outputPath.replace('.mp3', '.%(ext)s'),
      '--no-warnings',
    ];

    const proc = spawn('yt-dlp', args);
    let stderr = '';

    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
      resolve();
    });
  });
}

function cleanupCache() {
  try {
    const files = readdirSync(CACHE_DIR)
      .map(name => {
        const path = join(CACHE_DIR, name);
        const stat = statSync(path);
        return { name, path, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    // Remove old files
    const maxAge = MAX_CACHE_AGE_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    
    let totalSize = 0;
    for (const file of files) {
      const age = now - file.mtime.getTime();
      
      if (age > maxAge) {
        console.log(`[CACHE] Removing old: ${file.name}`);
        unlinkSync(file.path);
        continue;
      }

      totalSize += file.size;

      // Remove if over size limit (keep newest)
      if (totalSize > MAX_CACHE_SIZE_MB * 1024 * 1024) {
        console.log(`[CACHE] Removing for size: ${file.name}`);
        unlinkSync(file.path);
      }
    }
  } catch (err) {
    console.error('Cache cleanup error:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`YouTube proxy server running on http://localhost:${PORT}`);
  console.log(`Cache directory: ${CACHE_DIR}`);
});
