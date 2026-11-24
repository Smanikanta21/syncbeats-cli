import os from 'node:os';
import path from 'node:path';

const base = new URL(process.env.SYNCBEATS_SERVER_URL || 'https://api.syncbeats.in');
if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) {
  throw new Error('SYNCBEATS_SERVER_URL must be an HTTP(S) URL without credentials.');
}
base.search = ''; base.hash = '';
export const SERVER_URL = base.href.replace(/\/+$/, '');
export const SOCKET_URL = base.origin;
export const SOCKET_PATH = `${base.pathname.replace(/\/+$/, '')}/socket.io`;
export const APP_URL = (process.env.SYNCBEATS_APP_URL || 'https://www.syncbeats.in').replace(/\/+$/, '');
export const CACHE_DIR = path.resolve(process.env.SYNCBEATS_CACHE_DIR || path.join(
  process.env.XDG_CACHE_HOME || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches') : path.join(os.homedir(), '.cache')),
  'syncbeats-terminal',
));
export function serverUrl(endpoint) { return `${SERVER_URL}/${endpoint.replace(/^\/+/, '')}`; }
