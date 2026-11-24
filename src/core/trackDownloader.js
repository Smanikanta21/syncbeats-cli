import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import fetch from 'node-fetch';
import { EventEmitter } from 'node:events';
import { authService } from './authService.js';
import { CACHE_DIR, SERVER_URL, serverUrl } from './config.js';

export function trackSource(trackUrl, roomId) {
  if (typeof trackUrl !== 'string' || !trackUrl.trim()) throw new Error('This track has no audio URL.');
  const raw = trackUrl.trim();
  let videoId;
  if (raw.startsWith('youtube:')) {
    videoId = raw.slice(8).split(/[?&#]/)[0];
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new Error('This track has an invalid YouTube ID.');
    if (!roomId) throw new Error('Join a room before downloading this track.');
    return { id: `youtube-${videoId}`, url: serverUrl(`/rooms/${encodeURIComponent(roomId)}/yt-proxy?videoId=${videoId}`), extension: '.m4a' };
  }
  const url = new URL(raw.startsWith('http') ? raw : serverUrl(raw));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported audio URL.');
  if (url.pathname.endsWith('/yt-proxy')) {
    videoId = url.searchParams.get('videoId');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || '')) throw new Error('This track has an invalid YouTube ID.');
    return { id: `youtube-${videoId}`, url: url.href, extension: '.m4a' };
  }
  const ext = path.extname(url.pathname).toLowerCase();
  return {
    id: createHash('sha256').update(url.origin + url.pathname + url.search).digest('hex'), url: url.href,
    extension: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm', '.opus'].includes(ext) ? ext : '.audio',
  };
}
export class TrackDownloader extends EventEmitter {
  constructor(directory = path.join(CACHE_DIR, 'music')) {
    super(); this.directory = directory; this.downloading = new Map(); this.controllers = new Map();
  }
  download(trackUrl, roomId) {
    let source;
    try { source = trackSource(trackUrl, roomId); } catch (error) { return Promise.reject(error); }
    if (this.downloading.has(source.id)) return this.downloading.get(source.id);
    const promise = this._download(source).finally(() => { this.downloading.delete(source.id); this.controllers.delete(source.id); });
    this.downloading.set(source.id, promise); return promise;
  }
  async _download(source) {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const filePath = path.join(this.directory, source.id + source.extension);
    try {
      if ((await fs.promises.stat(filePath)).size > 0) { this.emit('ready', { trackId: source.id, filePath }); return filePath; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = `${filePath}.${randomUUID()}.part`;
    const controller = new AbortController(); this.controllers.set(source.id, controller);
    const timeout = setTimeout(() => controller.abort(), 120000);
    let downloadedBytes = 0; this.emit('progress', { trackId: source.id, progress: 0 });
    try {
      const headers = new URL(source.url).origin === new URL(SERVER_URL).origin && authService.getToken()
        ? { Authorization: `Bearer ${authService.getToken()}` } : {};
      const response = await fetch(source.url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`Could not download audio (HTTP ${response.status}).`);
      if (!response.body) throw new Error('The server returned no audio.');
      if (/^(text\/|application\/json)/i.test(response.headers.get('content-type') || '')) throw new Error('The server returned a page instead of audio.');
      const totalBytes = Number(response.headers.get('content-length')) || 0;
      response.body.on('data', chunk => {
        downloadedBytes += chunk.length;
        this.emit('progress', { trackId: source.id, progress: totalBytes ? Math.min(99, Math.floor(downloadedBytes / totalBytes * 100)) : null });
      });
      await pipeline(response.body, fs.createWriteStream(temporary, { flags: 'wx' }));
      if (!downloadedBytes || (totalBytes && downloadedBytes !== totalBytes)) throw new Error('The audio download was incomplete. Please retry.');
      await fs.promises.rename(temporary, filePath);
      this.emit('progress', { trackId: source.id, progress: 100 }); this.emit('ready', { trackId: source.id, filePath });
      return filePath;
    } catch (error) {
      await fs.promises.rm(temporary, { force: true });
      throw new Error(controller.signal.aborted ? 'Audio download was cancelled or timed out.' : error.message);
    } finally { clearTimeout(timeout); }
  }
  cancelAll() { for (const controller of this.controllers.values()) controller.abort(); }
}
export const trackDownloader = new TrackDownloader();
