import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { AudioEngine } from '../src/core/audioEngine.js';
const available = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffplay', ['-version']).status === 0;
test('real FFplay decodes AAC, reports a media clock and completes successfully', { skip: !available, timeout: 10000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'syncbeats-audio-')), file = path.join(temp, 'silent.m4a');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1', '-c:a', 'aac', file]);
  assert.equal(generated.status, 0); const previous = process.env.SDL_AUDIODRIVER; process.env.SDL_AUDIODRIVER = 'dummy';
  const audio = new AudioEngine(); let samples = 0; audio.on('position', () => samples++);
  try { const finished = once(audio, 'ended'); audio.play(file); await finished; assert.ok(samples > 0); assert.ok(audio.startupLatencyMs > 0); }
  finally { audio.stop(); if (previous == null) delete process.env.SDL_AUDIODRIVER; else process.env.SDL_AUDIODRIVER = previous; await fs.rm(temp, { recursive: true, force: true }); }
});
