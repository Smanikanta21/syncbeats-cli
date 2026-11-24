import { io } from 'socket.io-client';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { authService } from './authService.js';
import { syncEngine } from './syncEngine.js';
import { trackDownloader, trackSource } from './trackDownloader.js';
import { audioEngine } from './audioEngine.js';
import { SOCKET_URL, SOCKET_PATH } from './config.js';
import { adaptiveParameters, selectClockOffset } from './syncParameters.js';

export class SyncBeatsClient extends EventEmitter {
  constructor({ auth = authService, sync = syncEngine, downloader = trackDownloader, audio = audioEngine, socketFactory = io } = {}) {
    super(); this.auth = auth; this.sync = sync; this.downloader = downloader; this.audio = audio; this.socketFactory = socketFactory;
    this.socket = null; this.roomState = null; this.roomId = null; this.loaded = null;
    this.generation = 0; this.pendingSchedule = null; this.activeSchedule = null; this.pingInterval = null;
    this.onAudioError = error => { this.sync.stop(); this.pendingSchedule = null; this.reportError(error); };
    this.onEnded = () => {
      if (this.roomState?.isPlaying) this.emitCommand('playback:ended', {
        trackUrl: this.roomState.trackUrl, playbackInstanceId: this.roomState.playbackInstanceId,
      });
      this.sync.stop();
    };
  }
  reportError(error) { this.emit('clientError', error instanceof Error ? error : new Error(error?.message || 'The room request failed.')); }
  connect() {
    if (this.socket) return;
    if (!this.auth.getToken()) throw new Error('Sign in before connecting to a room.');
    this.audio.on('error', this.onAudioError); this.audio.on('ended', this.onEnded);
    this.socket = this.socketFactory(SOCKET_URL, {
      autoConnect: false, path: SOCKET_PATH,
      auth: { token: this.auth.getToken() }, extraHeaders: { 'x-device-id': this.auth.deviceKey, 'x-client-device': 'SyncBeats CLI' },
      transports: ['websocket', 'polling'], tryAllTransports: true, timeout: 8000,
    });
    const socket = this.socket;
    socket.io.on('reconnect_attempt', () => { socket.auth = { token: this.auth.getToken() }; });
    socket.on('connect', () => {
      this.emit('connectionStatus', 'connected'); this.emit('connected');
      socket.emit('device:register', { deviceKey: this.auth.deviceKey });
      if (this.roomId) this._join();
      this._startNTP();
    });
    socket.on('disconnect', () => {
      this._stopNTP(); this.pendingSchedule = null; this.activeSchedule = null; this.generation++;
      this.sync.pause(this.sync.getExpectedPositionSec()); this.emit('connectionStatus', 'reconnecting');
    });
    socket.on('connect_error', error => { this.emit('connectionStatus', 'offline'); this.reportError(new Error(error.message || 'Could not connect to the room server.')); });
    socket.on('error', payload => this.reportError(payload));
    socket.on('room:joinPendingApproval', () => this.emit('connectionStatus', 'awaiting approval'));
    socket.on('room:joinApproved', () => this.emit('connectionStatus', 'connected'));
    socket.on('room:joinDenied', () => { this.emit('connectionStatus', 'join denied'); this.reportError(new Error('The host declined your join request. Choose another room.')); });
    socket.on('room:snapshot', snapshot => this._snapshot(snapshot));
    socket.on('room:stateChanged', snapshot => this._snapshot(snapshot));
    socket.on('room:trackSet', payload => {
      if (!this._forRoom(payload)) return;
      this._ensureTrack(payload.trackUrl).catch(error => this.reportError(error));
    });
    socket.on('playback:schedule', payload => {
      if (!this._forRoom(payload)) return;
      this.roomState = { ...this.roomState, ...payload, state: 'PLAYING', isPlaying: true };
      this.emit('roomState', this.roomState); this._schedule(payload);
    });
    socket.on('playback:pause', payload => {
      if (!this._forRoom(payload)) return;
      this.pendingSchedule = null; this.activeSchedule = null;
      const position = Number.isFinite(payload.positionMs) ? payload.positionMs / 1000
        : Number.isFinite(payload.pauseOffset) ? payload.pauseOffset : Number.isFinite(payload.position) ? payload.position / 1000 : 0;
      this.roomState = { ...this.roomState, state: 'PAUSED', isPlaying: false, startEpoch: null, pauseOffset: position };
      this.sync.pause(position); this.emit('buffering', false); this.emit('roomState', this.roomState);
    });
    socket.on('room:participantJoined', participant => {
      if (this.roomState) {
        this.roomState.participants = [...(this.roomState.participants || []).filter(p => p.socketId !== participant.socketId), participant];
        this.emit('roomState', this.roomState);
      }
    });
    socket.on('room:participantLeft', payload => {
      const socketId = typeof payload === 'string' ? payload : payload.socketId;
      if (this.roomState) { this.roomState.participants = (this.roomState.participants || []).filter(p => p.socketId !== socketId); this.emit('roomState', this.roomState); }
    });
    socket.on('room:queueChanged', payload => {
      if (!this.roomState || !this._forRoom(payload)) return;
      this.roomState.queue = Array.isArray(payload) ? payload : payload.queue || [];
      if (payload.repeatMode) this.roomState.repeatMode = payload.repeatMode;
      this.emit('roomState', this.roomState);
    });
    socket.on('room:reset', payload => {
      if (this._forRoom(payload)) { this.generation++; this.loaded = null; this.pendingSchedule = null; this.activeSchedule = null; this.sync.stop(); }
    });
    socket.connect();
  }
  _forRoom(payload) {
    return (!payload?.roomId || payload.roomId === this.roomId)
      && (!payload?.roomInstanceId || !this.roomState?.roomInstanceId || payload.roomInstanceId === this.roomState.roomInstanceId);
  }
  _snapshot(snapshot) {
    if (snapshot.roomId !== this.roomId) return;
    if (snapshot.roomInstanceId && snapshot.roomInstanceId !== this.roomState?.roomInstanceId) {
      this.generation++; this.loaded = null; this.pendingSchedule = null; this.activeSchedule = null; this.sync.stop();
    }
    this.roomState = snapshot; this.emit('roomState', snapshot);
    if (!snapshot.trackUrl) {
      this.generation++; this.pendingSchedule = null; this.activeSchedule = null; this.loaded = null; this.sync.stop(); this.emit('buffering', false); return;
    }
    if (snapshot.isPlaying || snapshot.state?.toUpperCase() === 'PLAYING') {
      this._schedule({ ...snapshot, atEpoch: snapshot.startEpoch + (snapshot.pauseOffset || 0) * 1000, fromPosition: snapshot.pauseOffset || 0 });
    } else {
      this.pendingSchedule = null; this.activeSchedule = null; this.sync.pause(snapshot.pauseOffset ?? (snapshot.position || 0) / 1000);
      this._ensureTrack(snapshot.trackUrl).catch(error => this.reportError(error));
    }
  }
  async createRoom(roomId) {
    try { return await this.auth._request(`/rooms/${encodeURIComponent(roomId)}`); }
    catch (error) { if (error.status !== 404) throw error; }
    return this.auth._request('/rooms', { method: 'POST', body: JSON.stringify({ roomId }) });
  }
  async getDefaultRoom() {
    const data = await this.auth._request('/rooms/mine');
    if (data.rooms?.length) return data.rooms[0].id;
    return (await this.auth._request('/rooms/default', { method: 'POST', body: '{}' })).roomId;
  }
  joinRoom(roomId) {
    if (typeof roomId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) throw new Error('Enter a valid room code.');
    if (this.roomId && this.roomId !== roomId && this.socket?.connected) this.socket.emit('room:leave', { roomId: this.roomId });
    this.generation++; this.pendingSchedule = null; this.activeSchedule = null; this.roomState = null; this.loaded = null; this.sync.stop();
    this.roomId = roomId;
    if (!this.socket) this.connect(); else if (this.socket.connected) this._join();
  }
  _join() { this.socket.emit('room:join', { roomId: this.roomId, displayName: this.auth.getUser()?.name || 'Terminal User', userId: this.auth.getUser()?.id, deviceId: this.auth.deviceKey, deviceName: 'SyncBeats CLI' }); }
  async searchTracks(query) {
    if (!this.roomId) throw new Error('Join a room before searching.');
    const data = await this.auth._request(`/rooms/${encodeURIComponent(this.roomId)}/youtube-search?q=${encodeURIComponent(query)}`);
    return Array.isArray(data) ? data : data.videos || [];
  }
  async enqueueTrack(video) {
    if (!this.roomId || !video?.url) throw new Error('Choose a valid search result.');
    return this.auth._request(`/rooms/${encodeURIComponent(this.roomId)}/enqueue-youtube`, {
      method: 'POST', body: JSON.stringify({ youtubeUrl: video.url, title: video.title }),
    });
  }
  emitCommand(event, payload = {}) {
    if (!this.socket?.connected || !this.roomId || !this.roomState) {
      this.reportError(new Error('Wait until you are connected to the room before using playback controls.')); return false;
    }
    this.socket.emit(event, { roomId: this.roomId, ...payload }); return true;
  }
  togglePlayPause() { this.emitCommand(this.roomState?.isPlaying ? 'playback:pause' : 'playback:play'); }
  sendControls(action) {
    if (['play', 'pause', 'next', 'prev'].includes(action)) this.emitCommand(`playback:${action}`);
  }
  jumpToQueueItem(trackId) { this.emitCommand('playback:jumpTo', { trackId }); }
  toggleRepeat() {
    const current = this.roomState?.repeatMode || 'off';
    this.emitCommand('room:toggleRepeat', { repeatMode: current === 'off' ? 'all' : current === 'all' ? 'track' : 'off' });
  }
  async _ensureTrack(trackUrl) {
    const identity = trackSource(trackUrl, this.roomId).id;
    if (this.loaded?.identity === identity && fs.existsSync(this.loaded.file)) {
      this.socket?.emit('room:clientReady', { roomId: this.roomId, trackUrl }); this.emit('buffering', false); return this.loaded.file;
    }
    if (this.loading?.identity === identity && this.loading.generation === this.generation) return this.loading.promise;
    const generation = ++this.generation;
    this.loaded = null; this.activeSchedule = null; this.sync.pause(this.roomState?.isPlaying ? 0 : this.roomState?.pauseOffset || 0); this.emit('buffering', true);
    const promise = this.downloader.download(trackUrl, this.roomId).then(file => {
      if (generation !== this.generation || !this.socket?.connected) return null;
      this.loaded = { identity, file };
      this.socket.emit('room:clientReady', { roomId: this.roomId, trackUrl });
      this.emit('buffering', false); return file;
    }).catch(error => {
      if (generation === this.generation) { this.emit('buffering', false); throw error; }
      return null;
    }).finally(() => { if (this.loading?.generation === generation) this.loading = null; });
    this.loading = { identity, generation, promise }; return promise;
  }
  _schedule(payload) {
    const trackUrl = payload.trackUrl || this.roomState?.trackUrl;
    const key = `${trackUrl}:${payload.playbackInstanceId || ''}:${payload.startEpoch}`;
    if (this.activeSchedule === key) return;
    this.pendingSchedule = { payload, key };
    this._ensureTrack(trackUrl).then(file => {
      if (!file || this.pendingSchedule?.key !== key || this.activeSchedule === key) return;
      this.sync.schedule(this.pendingSchedule.payload, file); this.activeSchedule = key; this.pendingSchedule = null;
    }).catch(error => this.reportError(error));
  }
  _startNTP() {
    this._stopNTP();
    let sequence = 0;
    const run = async () => {
      const samples = [];
      for (let i = 0; i < this.sync.params.samples && this.socket?.connected && this.ntpRun === run; i++) {
        const socket = this.socket, seq = ++sequence, t0 = Date.now();
        const sample = await new Promise(resolve => {
          const onPong = payload => {
            if (payload.seq !== seq || payload.t0 !== t0) return;
            clearTimeout(timeout); socket.off('sync:pong', onPong);
            const t3 = Date.now();
            resolve({ rtt: t3 - t0 - (payload.t2 - payload.t1), offset: ((payload.t1 - t0) + (payload.t2 - t3)) / 2 });
          };
          const timeout = setTimeout(() => { socket.off('sync:pong', onPong); resolve(null); }, 1000);
          socket.on('sync:pong', onPong); socket.emit('sync:ping', { t0, seq });
        });
        if (sample && Number.isFinite(sample.rtt) && sample.rtt >= 0 && Number.isFinite(sample.offset)) samples.push(sample);
        if (i + 1 < this.sync.params.samples) await new Promise(resolve => setTimeout(resolve, this.sync.params.pingGap));
      }
      if (!this.socket?.connected || this.ntpRun !== run) return;
      const offset = selectClockOffset(samples, this.sync.params.rttGate, !this.sync.clockReady);
      const stats = adaptiveParameters(samples, this.sync.params);
      if (offset != null) this.sync.setClockOffset(offset, stats.latency);
      this.sync.setParameters(stats.params);
      if (stats.latency != null && this.roomId) this.socket.emit('sync:stats', { roomId: this.roomId, latency: stats.latency, jitter: stats.jitter });
      this.pingInterval = setTimeout(run, this.sync.params.resync);
    };
    this.ntpRun = run; run().catch(error => this.reportError(error));
  }
  _stopNTP() { if (this.pingInterval) clearTimeout(this.pingInterval); this.pingInterval = null; this.ntpRun = null; }
  disconnect() {
    this._stopNTP(); this.generation++; this.pendingSchedule = null; this.activeSchedule = null; this.loaded = null;
    this.downloader.cancelAll(); this.audio.off('error', this.onAudioError); this.audio.off('ended', this.onEnded);
    this.socket?.removeAllListeners(); this.socket?.disconnect(); this.socket = null; this.sync.stop();
  }
}
export const syncBeatsClient = new SyncBeatsClient();
