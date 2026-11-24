import http from 'node:http';
import { randomBytes } from 'node:crypto';
import open from 'open';
import { APP_URL } from './config.js';
import { authService } from './authService.js';
export function browserLogin({ auth = authService, openBrowser = open, appUrl = APP_URL, signal, timeoutMs = 120000, onUrl } = {}) {
  return new Promise((resolve, reject) => {
    const callback = `/callback/${randomBytes(24).toString('hex')}`;
    let timer, settled = false, accepting = false;
    const finish = (error, data) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      server.close();
      if (error) server.closeAllConnections(); else server.closeIdleConnections();
      error ? reject(error) : resolve(data);
    };
    const abort = () => finish(new Error('Browser sign-in was cancelled.'));
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      if (req.method !== 'GET' || url.pathname !== callback || accepting || settled) { res.writeHead(404); res.end('Not found'); return; }
      const token = url.searchParams.get('token');
      if (!token || token.length > 12000) { res.writeHead(400); res.end('No valid sign-in token received. Try again.'); return; }
      accepting = true;
      try {
        const data = await auth._request('/auth/me', { headers: { Authorization: `Bearer ${token}` }, signal });
        if (settled || signal?.aborted) return;
        if (!data.user) throw new Error('No profile was returned.');
        auth.saveSession({ token: data.token || token, user: data.user });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Signed in to SyncBeats. Close this window and return to your terminal.</p>');
        finish(null, data);
      } catch (error) { res.writeHead(401); res.end('Sign-in could not be verified. Return to your terminal.'); finish(error); }
    });
    server.on('error', error => finish(error));
    if (signal?.aborted) { finish(new Error('Browser sign-in was cancelled.')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    server.listen(0, '127.0.0.1', async () => {
      const loginUrl = new URL('/login', appUrl);
      loginUrl.searchParams.set('returnTo', `http://localhost:${server.address().port}${callback}`);
      timer = setTimeout(() => finish(new Error('Browser sign-in timed out. Retry or use email login.')), timeoutMs);
      try { onUrl?.(loginUrl.href); await openBrowser(loginUrl.href); } catch (error) { finish(error); }
    });
  });
}
