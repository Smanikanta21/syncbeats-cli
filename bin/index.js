#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`SyncBeats terminal player

Usage: syncbeats [--help | --version]

Requires Node.js 22+ and FFplay (install FFmpeg).
Set SYNCBEATS_SERVER_URL to use another backend.
Set SYNCBEATS_CACHE_DIR to choose an audio cache directory.
Start without arguments to sign in, join a room and play music.`);
} else if (args.length) {
  console.error('Unknown option. Run syncbeats --help.'); process.exitCode = 1;
} else {
  await import('../dist/index.js');
}
