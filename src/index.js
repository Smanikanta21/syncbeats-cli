import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';
import { syncBeatsClient } from './core/syncBeatsClient.js';

process.stdout.write('\x1b[?1049h');
let cleaned = false;
const cleanup = () => {
  if (cleaned) return; cleaned = true;
  syncBeatsClient.disconnect();
  process.stdout.write('\x1b[?1049l\x1b[?25h');
};
process.once('exit', cleanup);
try {
  const { waitUntilExit, unmount } = render(<App />);
  const terminate = () => unmount();
  process.once('SIGTERM', terminate);
  await waitUntilExit();
  process.removeListener('SIGTERM', terminate);
} finally { cleanup(); }
