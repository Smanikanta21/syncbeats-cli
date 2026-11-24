import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';

export class AudioEngine extends EventEmitter {
  constructor({ spawnProcess = spawn, now = () => performance.now() } = {}) {
    super(); this.spawnProcess = spawnProcess; this.now = now;
    this.process = null; this.isPlaying = false; this.currentFile = null;
    this.positionSample = null; this.pausedPosition = 0; this.startupLatencyMs = 0;
  }
  play(filePath, seekSecs = 0) {
    this.stop();
    try { const file = statSync(filePath); if (!file.isFile() || !file.size) throw new Error(); }
    catch { this.reportError(new Error('The audio file is missing or empty. Download it again.')); return; }
    this.currentFile = filePath; this.pausedPosition = Math.max(0, seekSecs);
    const args = ['-nodisp', '-autoexit', '-stats', '-loglevel', 'error'];
    if (seekSecs > 0) args.push('-ss', String(seekSecs));
    args.push(filePath);
    const child = this.spawnProcess('ffplay', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.process = child; this.isPlaying = true;
    const spawnedAt = this.now();
    let hadPosition = false; let diagnostic = ''; let pending = '';
    child.stderr?.on('data', chunk => {
      if (this.process !== child) return;
      pending += chunk.toString();
      const lines = pending.split(/[\r\n]/); pending = lines.pop().slice(-4096);
      for (const line of lines) {
        const match = line.match(/^\s*(-?\d+(?:\.\d+)?)\s+(?:M-A|A-V|M-V):/);
        if (match) {
          const position = Math.max(0, Number(match[1])), observedAt = this.now();
          if (!hadPosition) {
            const latency = Math.max(0, observedAt - spawnedAt - (position - seekSecs) * 1000);
            this.startupLatencyMs = this.startupLatencyMs ? this.startupLatencyMs * .65 + latency * .35 : latency;
          }
          hadPosition = true; this.positionSample = { position, observedAt };
          this.emit('position', { position, observedAt });
        } else if (line.trim() && !/M-A:|A-V:|M-V:|fd=|\x1b\[2K/.test(line)) diagnostic = (diagnostic + line + '\n').slice(-2048);
      }
    });
    child.once('error', error => {
      if (this.process !== child) return;
      this.process = null; this.isPlaying = false;
      this.reportError(new Error(error.code === 'ENOENT' ? 'FFplay is missing. Install FFmpeg to play audio.' : 'Could not start audio playback.'));
    });
    child.once('close', (code, signal) => {
      if (this.process !== child) return;
      this.process = null; this.isPlaying = false;
      if (code === 0 && !signal && hadPosition && !diagnostic.trim() && !pending.trim()) this.emit('ended');
      else this.reportError(new Error(diagnostic.trim() || pending.trim() || 'FFplay could not decode or play this audio file.'));
    });
  }
  reportError(error) {
    this.isPlaying = false;
    if (this.listenerCount('error')) this.emit('error', error); else console.error(error.message);
  }
  getPosition() {
    const sample = this.positionSample;
    if (!sample || !this.isPlaying || this.now() - sample.observedAt > 2000) return null;
    return sample.position + Math.max(0, this.now() - sample.observedAt) / 1000;
  }
  pause() {
    const file = this.currentFile, position = this.getPosition() ?? this.pausedPosition;
    this.stop(); this.currentFile = file; this.pausedPosition = position;
  }
  resume() { if (this.currentFile && !this.isPlaying) this.play(this.currentFile, this.pausedPosition); }
  stop() {
    const child = this.process;
    this.process = null; this.isPlaying = false; this.positionSample = null; this.currentFile = null;
    if (child) child.kill('SIGKILL');
  }
}
export const audioEngine = new AudioEngine();
