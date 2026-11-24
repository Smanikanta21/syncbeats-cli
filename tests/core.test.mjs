import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { delay } from './fixture.mjs';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'syncbeats-core-'));
process.env.XDG_CONFIG_HOME = temp; process.env.SYNCBEATS_CACHE_DIR = temp;
const { AudioEngine } = await import('../src/core/audioEngine.js');
const { SyncEngine } = await import('../src/core/syncEngine.js');
const { PARAM_TABLE, selectClockOffset, adaptiveParameters } = await import('../src/core/syncParameters.js');
const { getMusicFiles } = await import('../src/utils/fileHandler.js');
test.after(() => fs.rm(temp, { recursive: true, force: true }));
const fakeAudio = () => ({ calls: [], startupLatencyMs: 100, actual: null, play(file, position) { this.calls.push({ file, position, time: Date.now() }); }, getPosition() { return this.actual; }, pause() {}, stop() {} });

test('future scheduling respects epoch and resumes at the intended position', async () => {
  const audio = fakeAudio(), engine = new SyncEngine({ audio }); const atEpoch = Date.now() + 100;
  engine.schedule({ startEpoch: atEpoch - 30000, atEpoch, fromPosition: 30 }, 'file');
  assert.equal(audio.calls.length, 0); await delay(130);
  assert.equal(audio.calls.length, 1); assert.ok(audio.calls[0].time >= atEpoch - 1);
  assert.ok(audio.calls[0].position >= 30 && audio.calls[0].position < 30.1); engine.stop();
});
test('pause cancels a pending start and preserves seconds', async () => {
  const audio = fakeAudio(), engine = new SyncEngine({ audio });
  engine.schedule({ startEpoch: Date.now() + 60, atEpoch: Date.now() + 60 }, 'file');
  engine.pause(15); await delay(90); assert.equal(audio.calls.length, 0); assert.equal(engine.getExpectedPositionSec(), 15); engine.stop();
});
test('clock adjustment during scheduling cannot start audio early', async () => {
  const audio = fakeAudio(), engine = new SyncEngine({ audio }); const atEpoch = Date.now() + 80;
  engine.schedule({ startEpoch: atEpoch, atEpoch }, 'file'); engine.setClockOffset(-50, 10);
  await delay(90); assert.equal(audio.calls.length, 0); await delay(70); assert.equal(audio.calls.length, 1); engine.stop();
});
test('drift is measured and hard seek compensates observed decoder latency', () => {
  let now = 30000; const audio = fakeAudio(), engine = new SyncEngine({ audio, now: () => now });
  engine.state = 'playing'; engine.startEpoch = 0; engine.trackFile = 'file'; engine.setClockOffset(0, 10);
  audio.actual = 29.5; let info; engine.on('drift', value => info = value); engine.checkDrift();
  assert.equal(info.driftMs, -500); assert.equal(info.tier, 'correcting'); assert.equal(audio.calls[0].position, 30.1);
  engine.checkDrift(); assert.equal(audio.calls.length, 1);
  now += 2000; audio.actual = 32; engine.checkDrift(); assert.equal(info.tier, 'synced'); engine.stop();
});
test('unknown playback clock is never labeled synced', () => {
  const engine = new SyncEngine({ audio: fakeAudio() }); engine.state = 'playing';
  let info; engine.on('drift', value => info = value); engine.checkDrift(); assert.equal(info.tier, 'measuring'); assert.equal(info.driftMs, null); engine.stop();
});
test('NTP discards delayed/outlier samples and retains a clock through noisy bursts', () => {
  assert.equal(selectClockOffset([{ offset: 20, rtt: 10 }, { offset: 21, rtt: 12 }, { offset: 999, rtt: 500 }], 150), 20);
  assert.equal(selectClockOffset([{ offset: 999, rtt: 500 }], 150), null);
  assert.equal(selectClockOffset([{ offset: 20, rtt: 500 }], 150, true), 20);
  assert.equal(selectClockOffset([{ offset: NaN, rtt: 10 }, { offset: 3, rtt: -1 }], 150), null);
  const good = { ...PARAM_TABLE.good }; const poor = adaptiveParameters([{ offset: 0, rtt: 300 }], good);
  assert.equal(poor.quality, 'poor'); assert.ok(poor.params.hardSeek > good.hardSeek);
});
test('FFplay clock parsing handles split chunks, stale clocks and replaced process exits', async () => {
  const file = path.join(temp, 'audio.m4a'); await fs.writeFile(file, 'fixture');
  let now = 0; const children = [];
  const audio = new AudioEngine({ now: () => now, spawnProcess: () => {
    const child = new EventEmitter(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', null, 'SIGKILL'); children.push(child); return child;
  } });
  let ended = 0; audio.on('ended', () => ended++);
  audio.play(file, 10); now = 100; children[0].stderr.write(' 10.'); children[0].stderr.write('00 M-A: 0.000\r');
  now = 200; assert.equal(audio.getPosition(), 10.1); assert.equal(audio.startupLatencyMs, 100);
  audio.play(file, 20); children[0].emit('close', 0); assert.equal(audio.isPlaying, true); assert.equal(ended, 0);
  children[1].stderr.write('20.00 M-A: 0.000\r'); children[1].emit('close', 0); assert.equal(ended, 1);
  audio.play(file); children[2].stderr.write('0.10 M-A: 0.000\r'); now += 2500; assert.equal(audio.getPosition(), null); audio.stop();
});
test('missing, invalid and unspawnable audio report errors instead of ended', async () => {
  const audio = new AudioEngine(); let error, ended = 0; audio.on('error', value => error = value); audio.on('ended', () => ended++);
  audio.play(path.join(temp, 'missing')); assert.match(error.message, /missing/); assert.equal(ended, 0);
  const file = path.join(temp, 'invalid.m4a'); await fs.writeFile(file, 'bad audio'); let child;
  const mocked = new AudioEngine({ spawnProcess: () => { child = new EventEmitter(); child.stderr = new PassThrough(); child.kill = () => {}; return child; } });
  mocked.on('error', value => error = value); mocked.on('ended', () => ended++);
  mocked.play(file); child.stderr.write('Invalid data found\n'); child.emit('close', 0); assert.match(error.message, /Invalid/); assert.equal(ended, 0);
  mocked.play(file); child.emit('error', Object.assign(new Error(), { code: 'ENOENT' })); assert.match(error.message, /FFplay is missing/);
});
test('pause/resume starts a new process at the measured paused position', async () => {
  const file = path.join(temp, 'resume.m4a'); await fs.writeFile(file, 'fixture'); const children = []; let now = 0; const args = [];
  const audio = new AudioEngine({ now: () => now, spawnProcess: (_, values) => { args.push(values); const child = new EventEmitter(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', null, 'SIGKILL'); children.push(child); return child; } });
  audio.play(file); children[0].stderr.write('3.00 M-A: 0.000\r'); now = 100; audio.pause(); audio.resume(); assert.equal(args.length, 2); assert.ok(args[1].includes('3.1')); audio.stop();
});
test('local scanner includes AAC and ignores unrelated files', async () => {
  const dir = path.join(temp, 'music'); await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'track.m4a'), 'audio'); await fs.writeFile(path.join(dir, 'notes.txt'), 'text');
  assert.deepEqual((await getMusicFiles(dir)).map(file => file.filename), ['track.m4a']);
});
