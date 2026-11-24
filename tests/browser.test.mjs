import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { delay } from './fixture.mjs';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'syncbeats-browser-')); process.env.XDG_CONFIG_HOME = temp;
const { browserLogin } = await import('../src/core/browserAuth.js');
test.after(() => fs.rm(temp, { recursive: true, force: true }));
test('loopback handoff validates token before persisting and uses a random callback', async () => {
  let saved, callback, observed;
  const auth = { _request: async (_, options) => { observed = options.headers.Authorization; return { user: { id: 'fixture' }, token: 'refreshed' }; }, saveSession: data => saved = data };
  const promise = browserLogin({ auth, openBrowser: async url => {
    callback = new URL(url).searchParams.get('returnTo'); assert.match(callback, /\/callback\/[a-f0-9]{48}$/);
    const response = await fetch(callback + '?token=fixture-token'); assert.equal(response.status, 200); await response.text();
  } });
  await promise; assert.equal(observed, 'Bearer fixture-token'); assert.equal(saved.token, 'refreshed');
  await assert.rejects(fetch(callback));
});
test('invalid callback token cannot create a session', async () => {
  let saved = false;
  const auth = { _request: async () => { throw new Error('Invalid token'); }, saveSession: () => saved = true };
  await assert.rejects(browserLogin({ auth, openBrowser: async url => {
    const callback = new URL(url).searchParams.get('returnTo'); await fetch(callback + '?token=bad-token');
  } }), /Invalid token/); assert.equal(saved, false);
});
test('browser timeout, cancellation and open failures close the loopback server', async () => {
  const controller = new AbortController(); let callback;
  const run = browserLogin({ signal: controller.signal, openBrowser: async url => { callback = new URL(url).searchParams.get('returnTo'); controller.abort(); } });
  await assert.rejects(run, /cancelled/); await assert.rejects(fetch(callback));
  await assert.rejects(browserLogin({ openBrowser: async () => {}, timeoutMs: 25 }), /timed out/);
  await assert.rejects(browserLogin({ openBrowser: async () => { throw new Error('No browser'); } }), /No browser/);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(browserLogin({ signal: cancelled.signal }), /cancelled/);
});

test('cancelling during token verification cannot persist a late session', async () => {
  const controller = new AbortController(); let saved = false, release;
  const auth = { _request: () => new Promise(resolve => release = resolve), saveSession: () => saved = true };
  const pending = browserLogin({ auth, signal: controller.signal, openBrowser: async url => {
    const callback = new URL(url).searchParams.get('returnTo');
    fetch(callback + '?token=fixture-token').catch(() => {});
    while (!release) await delay(5);
    controller.abort(); release({ user: { id: 'fixture' }, token: 'fixture-token' });
  } });
  await assert.rejects(pending, /cancelled/); await delay(20); assert.equal(saved, false);
});
