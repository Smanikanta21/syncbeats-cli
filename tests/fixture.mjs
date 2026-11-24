import http from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitFor(check, timeout = 4000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for fixture outcome'); await delay(10); }
}
export function memoryConfig() {
  const data = new Map(); return { get: key => data.get(key), set: (key, value) => data.set(key, value), delete: key => data.delete(key) };
}
export async function fixture(prefix = '') {
  const state = { requests: [], actions: [], peers: [], meStatus: 200, failCreate: false, roomExists: true, rooms: [{ id: '123456' }] };
  state.snapshot = { roomId: '123456', roomInstanceId: 'fixture-instance', state: 'PAUSED', isPlaying: false, trackUrl: null, startEpoch: null, pauseOffset: 0, participants: [{ socketId: 'alice', displayName: 'Alice' }], queue: [], repeatMode: 'off' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); const route = url.pathname.slice(prefix.length);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    state.requests.push({ method: req.method, route, body, query: url.search, authorization: req.headers.authorization });
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const user = { id: 'fixture-user', name: 'Fixture', email: 'fixture@example.invalid' };
    if (route === '/health') return json(200, { status: 'ok' });
    if (route === '/auth/login') return json(200, { token: 'fixture-token', user });
    if (route === '/auth/register') return json(201, { ok: true });
    if (route === '/auth/me') return json(state.meStatus, state.meStatus === 200 ? { token: 'refreshed-token', user } : { error: 'Fixture authentication failure' });
    if (route.startsWith('/auth/password/')) return json(200, { ok: true });
    if (route === '/rooms/mine') return json(200, { rooms: state.rooms });
    if (route === '/rooms/default') return json(200, { roomId: '123456' });
    if (route === '/rooms') { state.roomExists = !state.failCreate; return json(state.failCreate ? 409 : 201, state.failCreate ? { error: 'Room conflict' } : { roomId: body.roomId }); }
    if (route === '/rooms/123456') return json(state.roomExists ? 200 : 404, state.roomExists ? { roomId: '123456' } : { error: 'Not found' });
    if (route.endsWith('/youtube-search')) return json(200, [{ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Fixture audio' }]);
    if (route.endsWith('/enqueue-youtube')) return json(200, { ok: true });
    if (route.startsWith('/files/') || route.endsWith('/yt-proxy')) {
      if (route.includes('error')) return json(502, { error: 'Upstream unavailable' });
      const bytes = Buffer.alloc(1024, 42);
      res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Content-Length': bytes.length });
      if (route.includes('broken')) { res.write(bytes.subarray(0, 128)); setTimeout(() => res.destroy(), 30); return; }
      if (route.includes('slow') || url.searchParams.get('videoId') === 'slowtrack01') {
        res.write(bytes.subarray(0, 128)); setTimeout(() => res.end(bytes.subarray(128)), 150); return;
      }
      res.end(bytes); return;
    }
    json(404, { error: 'Not found' });
  });
  const io = new Server(server, { path: prefix + '/socket.io' });
  io.on('connection', socket => {
    state.peers.push(socket);
    socket.onAny((event, payload) => state.actions.push({ event, payload }));
    socket.on('room:join', payload => socket.emit('room:snapshot', { ...state.snapshot, roomId: payload.roomId }));
    socket.on('sync:ping', ({ t0, seq }) => socket.emit('sync:pong', { t0, seq, t1: Date.now(), t2: Date.now() }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { state, server, io, url: `http://127.0.0.1:${server.address().port}${prefix}`, close: () => new Promise(resolve => io.close(resolve)) };
}
