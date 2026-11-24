import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { build } from 'esbuild';
import { render, cleanup } from 'ink-testing-library';
import { fixture, delay, waitFor } from './fixture.mjs';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'syncbeats-ui-'));
process.env.XDG_CONFIG_HOME = temp; process.env.SYNCBEATS_CACHE_DIR = temp;
const service = await fixture(); process.env.SYNCBEATS_SERVER_URL = service.url;
const cache = path.resolve('node_modules/.cache/syncbeats-ui-tests.mjs');
await build({ stdin: { contents: "export {LoginScreen} from './src/ui/LoginScreen.js'; export {App} from './src/ui/App.js'; export {PlayerScreen} from './src/ui/PlayerScreen.js'; export {authService} from './src/core/authService.js';", resolveDir: process.cwd() }, outfile: cache, bundle: true, platform: 'node', format: 'esm', packages: 'external', loader: { '.js': 'jsx' } });
const { LoginScreen, App, PlayerScreen, authService } = await import(cache);
test.after(async () => { cleanup(); await service.close(); await fs.rm(temp, { recursive: true, force: true }); await fs.rm(cache, { force: true }); });
const send = async (screen, text) => { screen.stdin.write(text); await delay(40); };
test('Enter moves fields and submits email login exactly once', async () => {
  authService.logout(); let completed = 0;
  const screen = render(React.createElement(LoginScreen, { onLoginSuccess: () => completed++ })); await delay(30);
  await send(screen, 'fixture@example.invalid'); await send(screen, '\r');
  assert.equal(service.state.requests.filter(r => r.route === '/auth/login').length, 0);
  await send(screen, 'fixture-password'); await send(screen, '\r');
  await waitFor(() => completed === 1);
  assert.equal(service.state.requests.filter(r => r.route === '/auth/login').length, 1);
  screen.unmount();
});
test('signup requires verification and shortcuts do not alter typed values', async () => {
  authService.logout(); let completed = 0;
  const screen = render(React.createElement(LoginScreen, { onLoginSuccess: () => completed++ })); await delay(30);
  await send(screen, '\x14'); await send(screen, 'Fixture'); await send(screen, '\r');
  await send(screen, 'signup@example.invalid'); await send(screen, '\r');
  await send(screen, 'fixture-password'); await send(screen, '\r');
  await waitFor(() => screen.lastFrame()?.includes('verify your account'));
  const request = service.state.requests.find(r => r.route === '/auth/register');
  assert.equal(request.body.name, 'Fixture'); assert.equal(request.body.email, 'signup@example.invalid');
  assert.equal(completed, 0); assert.equal(authService.getToken(), undefined); screen.unmount();
});
test('forgot-password shortcut and OTP reset preserve fields and sign in once', async () => {
  let completed = 0;
  const screen = render(React.createElement(LoginScreen, { onLoginSuccess: () => completed++ })); await delay(30);
  await send(screen, '\x06'); await send(screen, 'reset@example.invalid'); await send(screen, '\r');
  await waitFor(() => screen.lastFrame()?.includes('Reset Password'));
  await send(screen, '000000'); await send(screen, '\t'); await send(screen, 'fixture-password'); await send(screen, '\r');
  await waitFor(() => completed === 1);
  const request = service.state.requests.find(r => r.route === '/auth/password/forgot');
  assert.equal(request.body.email, 'reset@example.invalid'); assert.equal(service.state.requests.filter(r => r.route === '/auth/password/reset').length, 1); screen.unmount();
});
test('startup retains login on server failure and offers a working retry', async () => {
  authService.setToken('fixture-token'); service.state.meStatus = 500;
  const screen = render(React.createElement(App)); await waitFor(() => screen.lastFrame()?.includes('[R] Retry'));
  assert.equal(authService.getToken(), 'fixture-token');
  service.state.meStatus = 200; await send(screen, 'r'); await waitFor(() => screen.lastFrame()?.includes('Join a Room')); screen.unmount();
});


test('queue arrows focus and select a row without requiring M first', async () => {
  authService.setToken('fixture-token');
  service.state.snapshot.queue = [
    { id: 'queue-first', title: 'First cursor track', isCurrent: true },
    { id: 'queue-second', title: 'Second cursor track' },
    { id: 'queue-third', title: 'Third cursor track' },
  ];
  const screen = render(React.createElement(PlayerScreen, { roomId: '123456' }));
  try {
    await waitFor(() => screen.lastFrame()?.includes('First cursor track'));
    await send(screen, '\x1b[B');
    assert.match(screen.lastFrame(), /> 2\. Second cursor track/);
    await send(screen, '\r');
    await waitFor(() => service.state.actions.some(action => action.event === 'playback:jumpTo' && action.payload.trackId === 'queue-second'));
  } finally { screen.unmount(); }
});

test('queue selection follows its track through updates and remains visible in long queues', async () => {
  authService.setToken('fixture-token');
  service.state.snapshot.queue = Array.from({ length: 30 }, (_, index) => ({ id: `queue-${index}`, title: `Cursor track ${String(index).padStart(2, '0')}` }));
  const screen = render(React.createElement(PlayerScreen, { roomId: '123456' }));
  try {
    await waitFor(() => screen.lastFrame()?.includes('Cursor track 00'));
    await send(screen, 'm');
    for (let i = 0; i < 15; i++) await send(screen, '\x1b[B');
    assert.match(screen.lastFrame(), /> 16\. Cursor track 15/);
    assert.ok(screen.lastFrame().split('\n').findIndex(line => line.includes('> 16. Cursor track 15')) < 24, 'cursor must stay on screen in a 24-row terminal');
    screen.stdout.rows = 26; screen.stdout.emit('resize'); await delay(40);
    assert.match(screen.lastFrame(), /> 16\. Cursor track 15/);
    assert.ok(!screen.lastFrame().includes('Cursor track 00'), 'queue should scroll around its cursor');
    const peer = service.state.peers.at(-1);
    peer.emit('room:queueChanged', { queue: [...service.state.snapshot.queue].reverse() });
    await waitFor(() => screen.lastFrame()?.includes('> 15. Cursor track 15'));
    peer.emit('room:queueChanged', { queue: [{ id: 'remaining', title: 'Remaining cursor track' }] });
    await waitFor(() => screen.lastFrame()?.includes('> 1. Remaining cursor track'));
    await send(screen, '\r');
    await waitFor(() => service.state.actions.some(action => action.event === 'playback:jumpTo' && action.payload.trackId === 'remaining'));
  } finally { screen.unmount(); }
});

test('queue focus toggles with M and does not swallow playback shortcuts', async () => {
  authService.setToken('fixture-token');
  service.state.snapshot.queue = [{ id: 'shortcut-track', title: 'Shortcut cursor track' }];
  const screen = render(React.createElement(PlayerScreen, { roomId: '123456' }));
  try {
    await waitFor(() => screen.lastFrame()?.includes('Shortcut cursor track'));
    await send(screen, 'm'); assert.match(screen.lastFrame(), /> 1\. Shortcut cursor track/);
    await send(screen, ' ');
    await waitFor(() => service.state.actions.some(action => action.event === 'playback:play'));
    await send(screen, 'm'); assert.ok(!screen.lastFrame().includes('> 1. Shortcut cursor track'));
  } finally { screen.unmount(); }
});
