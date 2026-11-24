import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { fixture, memoryConfig, delay, waitFor } from './fixture.mjs';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'syncbeats-api-'));
process.env.XDG_CONFIG_HOME = temp; process.env.SYNCBEATS_CACHE_DIR = temp;
const service = await fixture('/api'); process.env.SYNCBEATS_SERVER_URL = service.url;
const { AuthService } = await import('../src/core/authService.js');
const { TrackDownloader, trackSource } = await import('../src/core/trackDownloader.js');
const { SyncEngine } = await import('../src/core/syncEngine.js');
const { SyncBeatsClient } = await import('../src/core/syncBeatsClient.js');
const auth = new AuthService(memoryConfig());
class FakeAudio extends EventEmitter { calls = []; isPlaying = false; actual = null; startupLatencyMs = 0; play(file, seek) { this.calls.push({ file, seek }); this.isPlaying = true; } pause() { this.isPlaying = false; } stop() { this.isPlaying = false; } getPosition() { return this.actual; } }
const audio = new FakeAudio(), sync = new SyncEngine({ audio }), downloader = new TrackDownloader(path.join(temp, 'music'));
const client = new SyncBeatsClient({ auth, audio, sync, downloader }); const errors = []; client.on('clientError', error => errors.push(error));
test.after(async () => { client.disconnect(); await service.close(); await fs.rm(temp, { recursive: true, force: true }); });
test('login, registration and OTP contracts; session survives 500 and expires on 401', async () => {
  await auth.login('fixture@example.invalid', 'fixture-password'); assert.equal(auth.getToken(), 'fixture-token');
  await auth.getMe(); assert.equal(auth.getToken(), 'refreshed-token');
  service.state.meStatus = 500; await assert.rejects(auth.getMe(), /failure/); assert.equal(auth.getToken(), 'refreshed-token');
  service.state.meStatus = 401; assert.equal(await auth.getMe(), null); assert.equal(auth.getToken(), undefined);
  service.state.meStatus = 200;
  assert.deepEqual(await auth.register('Fixture', 'fixture@example.invalid', 'fixture-password'), { ok: true }); assert.equal(auth.getToken(), undefined);
  await auth.forgotPassword('fixture@example.invalid'); await auth.verifyResetOtp('fixture@example.invalid', '000000'); await auth.resetPasswordWithOtp('fixture@example.invalid', '000000', 'fixture-password');
  await auth.login('fixture@example.invalid', 'fixture-password');
});
test('room creation surfaces errors and default selection uses server-assigned room', async () => {
  service.state.roomExists = false; service.state.failCreate = true;
  await assert.rejects(client.createRoom('123456'), /conflict/);
  service.state.failCreate = false; assert.equal((await client.createRoom('123456')).roomId, '123456');
  service.state.rooms = []; assert.equal(await client.getDefaultRoom(), '123456');
  service.state.rooms = [{ id: '123456' }]; assert.equal(await client.getDefaultRoom(), '123456');
});
test('prefixed HTTP base uses default socket namespace and /api/socket.io', async () => {
  client.joinRoom('123456'); await waitFor(() => client.roomState?.roomId === '123456');
  assert.equal(client.socket.nsp, '/'); assert.equal(client.socket.io.opts.path, '/api/socket.io');
  await waitFor(() => sync.clockReady); assert.ok(Number.isFinite(sync.clockOffset));
});
test('search/enqueue and all playback controls use current backend names', async () => {
  const tracks = await client.searchTracks('A & B'); await client.enqueueTrack(tracks[0]);
  const before = service.state.actions.length;
  for (const action of ['play', 'pause', 'next', 'prev']) client.sendControls(action);
  client.toggleRepeat(); client.jumpToQueueItem('queue-id'); await delay(50);
  assert.deepEqual(service.state.actions.slice(before).filter(a => a.event !== 'sync:stats').map(a => a.event),
    ['playback:play', 'playback:pause', 'playback:next', 'playback:prev', 'room:toggleRepeat', 'playback:jumpTo']);
});
test('concurrent downloads share a complete file and cache reuse makes no request', async () => {
  const route = '/files/slow.m4a'; const first = downloader.download(route, '123456'); await delay(30);
  const second = downloader.download(route, '123456'); assert.equal(first, second);
  const [a, b] = await Promise.all([first, second]); assert.equal(a, b); assert.equal((await fs.stat(a)).size, 1024);
  const count = service.state.requests.length; assert.equal(await downloader.download(route, '123456'), a); assert.equal(service.state.requests.length, count);
  assert.equal((await fs.readdir(downloader.directory)).some(name => name.endsWith('.part')), false);
});
test('failed audio responses and interrupted streams leave no poisoned cache', async () => {
  await assert.rejects(downloader.download('/files/error.mp3', '123456'), /502/);
  await assert.rejects(downloader.download('/files/broken.mp3', '123456'));
  assert.equal((await fs.readdir(downloader.directory)).some(name => name.endsWith('.part')), false);
  assert.equal(downloader.downloading.size, 0);
});
test('YouTube metadata normalizes to the same clean video ID', () => {
  const source = trackSource('youtube:abcdefghijk?thumb=https://cover.invalid/x&pid=playlist', '123456');
  assert.equal(source.id, 'youtube-abcdefghijk'); assert.ok(source.url.endsWith('videoId=abcdefghijk'));
  assert.equal(trackSource('youtube:abcdefghijk', '123456').id, source.id);
});
test('uploaded playback uses downloaded path; pause preserves backend units', async () => {
  const peer = service.state.peers.at(-1); const count = audio.calls.length;
  peer.emit('playback:schedule', { roomId: '123456', trackUrl: '/files/upload.mp3', startEpoch: Date.now(), atEpoch: Date.now(), fromPosition: 0 });
  await waitFor(() => audio.calls.length > count); assert.equal((await fs.stat(audio.calls.at(-1).file)).size, 1024); assert.ok(audio.calls.at(-1).file.endsWith('.mp3'));
  peer.emit('playback:pause', { roomId: '123456', pauseOffset: 15 }); await waitFor(() => sync.state === 'paused'); assert.equal(sync.pauseOffset, 15);
  peer.emit('room:snapshot', { ...service.state.snapshot, trackUrl: '/files/upload.mp3', pauseOffset: 30 });
  await waitFor(() => sync.pauseOffset === 30); assert.equal(sync.getExpectedPositionSec(), 30);
});
test('pause during download cancels pending playback', async () => {
  const peer = service.state.peers.at(-1), count = audio.calls.length;
  peer.emit('playback:schedule', { roomId: '123456', trackUrl: 'youtube:slowtrack01', startEpoch: Date.now(), atEpoch: Date.now(), fromPosition: 0 });
  await delay(30); peer.emit('playback:pause', { roomId: '123456', pauseOffset: 0 }); await delay(200);
  assert.equal(audio.calls.length, count); assert.equal(sync.state, 'paused');
});
test('participant departure strings and duplicate joins converge', async () => {
  const peer = service.state.peers.at(-1); peer.emit('room:participantJoined', { socketId: 'alice', displayName: 'Alice' }); await delay(20);
  assert.equal(client.roomState.participants.filter(p => p.socketId === 'alice').length, 1);
  peer.emit('room:participantLeft', 'alice'); await delay(20); assert.equal(client.roomState.participants.length, 0);
});
test('reconnect rejoins and cached snapshots redeclare readiness', async () => {
  service.state.snapshot.trackUrl = '/files/upload.mp3'; service.state.snapshot.pauseOffset = 30;
  const before = service.state.actions.filter(a => a.event === 'room:join').length;
  client.socket.io.engine.close(); await waitFor(() => service.state.actions.filter(a => a.event === 'room:join').length > before);
  await waitFor(() => client.loaded?.file); assert.equal(sync.pauseOffset, 30);
  assert.ok(service.state.actions.some(a => a.event === 'room:clientReady' && a.payload.trackUrl === '/files/upload.mp3'));
});
test('private approval, room errors and offline controls reach the UI', async () => {
  const statuses = []; client.on('connectionStatus', status => statuses.push(status)); const peer = service.state.peers.at(-1);
  peer.emit('room:joinPendingApproval', { roomId: '123456' }); peer.emit('room:joinDenied'); peer.emit('error', { message: 'Fixture room error' }); await delay(30);
  assert.ok(statuses.includes('awaiting approval')); assert.ok(errors.some(e => e.message === 'Fixture room error'));
  client.socket.disconnect(); const count = service.state.actions.filter(a => a.event === 'playback:next').length; client.sendControls('next'); await delay(20); assert.equal(service.state.actions.filter(a => a.event === 'playback:next').length, count); assert.match(errors.at(-1).message, /connected/);
});
