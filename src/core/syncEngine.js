import { EventEmitter } from 'node:events';
import { audioEngine } from './audioEngine.js';
import { PARAM_TABLE } from './syncParameters.js';

export class SyncEngine extends EventEmitter {
  constructor({ audio = audioEngine, now = () => Date.now() } = {}) {
    super(); this.audio = audio; this.now = now;
    this.startEpoch = null; this.pauseOffset = 0; this.clockOffset = 0; this.clockReady = false;
    this.state = 'idle'; this.syncLatency = null; this.params = { ...PARAM_TABLE.good };
    this.scheduleTimer = null; this.driftCheckInterval = null; this.trackFile = null; this.lastCorrection = -Infinity;
    this.lastDriftTier = 'measuring';
  }
  setClockOffset(offset, latency) {
    if (!Number.isFinite(offset) || !Number.isFinite(latency) || latency < 0) return;
    this.clockOffset = offset; this.clockReady = true; this.syncLatency = latency;
    this.emit('stats', { latency, offset });
  }
  setParameters(params) { this.params = params; if (this.state === 'playing') this.startDriftCorrection(); }
  getServerNow() { return this.now() + this.clockOffset; }
  getExpectedPositionSec() {
    return this.startEpoch == null ? this.pauseOffset : Math.max(0, (this.getServerNow() - this.startEpoch) / 1000);
  }
  schedule(payload, filePath) {
    if (!Number.isFinite(payload.startEpoch)) throw new Error('The server returned an invalid playback timeline.');
    this.cancelSchedule(); this.stopDriftCorrection();
    this.startEpoch = payload.startEpoch; this.pauseOffset = Math.max(0, payload.fromPosition || 0); this.trackFile = filePath;
    this.state = 'scheduled'; this.emit('state', this.state);
    const atEpoch = Number.isFinite(payload.atEpoch) ? payload.atEpoch : this.getServerNow();
    const start = () => {
      const remaining = atEpoch - this.getServerNow();
      if (remaining > 1) { this.scheduleTimer = setTimeout(start, remaining); return; }
      this.scheduleTimer = null; this.state = 'playing'; this.lastCorrection = this.now();
      this.audio.play(filePath, this.getExpectedPositionSec());
      if (this.state !== 'playing') return;
      this.startDriftCorrection(); this.emit('state', this.state);
    };
    this.scheduleTimer = setTimeout(start, Math.max(0, atEpoch - this.getServerNow()));
  }
  pause(position = 0) {
    this.cancelSchedule(); this.stopDriftCorrection();
    this.state = 'paused'; this.pauseOffset = Math.max(0, Number.isFinite(position) ? position : 0); this.startEpoch = null;
    this.audio.pause(); this.emit('state', this.state);
    this.emit('drift', { tier: 'paused', expected: this.pauseOffset, actual: null, driftMs: null });
  }
  cancelSchedule() { if (this.scheduleTimer) clearTimeout(this.scheduleTimer); this.scheduleTimer = null; }
  checkDrift() {
    if (this.state !== 'playing') return;
    const expected = this.getExpectedPositionSec(), actual = this.audio.getPosition();
    if (actual == null || !this.clockReady) { this.emit('drift', { tier: 'measuring', expected, actual, driftMs: null }); return; }
    const driftMs = (actual - expected) * 1000;
    const correcting = Math.abs(driftMs) > this.params.hardSeek && this.now() - this.lastCorrection >= 1500;
    const tier = Math.abs(driftMs) <= this.params.hardSeek ? 'synced' : correcting ? 'correcting' : 'settling';
    this.lastDriftTier = tier; this.emit('drift', { tier, expected, actual, driftMs });
    if (correcting && this.trackFile) {
      this.lastCorrection = this.now();
      // A new decoder takes time to start. Compensate using observed FFplay launch latency.
      this.audio.play(this.trackFile, expected + Math.min(1000, this.audio.startupLatencyMs || 0) / 1000);
    }
  }
  startDriftCorrection() { this.stopDriftCorrection(); this.driftCheckInterval = setInterval(() => this.checkDrift(), this.params.driftInterval); }
  stopDriftCorrection() { if (this.driftCheckInterval) clearInterval(this.driftCheckInterval); this.driftCheckInterval = null; }
  stop() {
    this.cancelSchedule(); this.stopDriftCorrection(); this.audio.stop();
    this.state = 'idle'; this.startEpoch = null; this.pauseOffset = 0; this.trackFile = null; this.emit('state', this.state);
  }
}
export const syncEngine = new SyncEngine();
