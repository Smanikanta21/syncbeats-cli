# SyncBeats CLI

A terminal client for [SyncBeats](https://www.syncbeats.in). Sign in, join a room, search YouTube, manage the shared queue, and play downloaded audio with FFplay.

## Requirements

- Node.js 22 or newer
- FFmpeg, including the `ffplay` command
- A SyncBeats account and a connection to its backend

On macOS:

```bash
brew install ffmpeg
```

On Debian/Ubuntu:

```bash
sudo apt install ffmpeg
```

## Run from source

```bash
git clone https://github.com/Smanikanta21/syncbeats-cli.git
cd syncbeats-cli
npm ci
npm start
```

Dependency installation builds the terminal bundle. For development:

```bash
npm run dev
```

The CLI uses `https://api.syncbeats.in` by default. For a local server:

```bash
SYNCBEATS_SERVER_URL=http://localhost:4000 npm start
```

The base URL can include an HTTP proxy prefix, such as `https://www.syncbeats.in/api`; Socket.IO will use `/api/socket.io` on that origin.

## Sign in and choose a room

Use Tab/Shift+Tab or Enter to move through fields; Enter on the last field submits once.

- Ctrl+T switches between login and signup. Signup requires the email verification link before login.
- Ctrl+F starts an emailed OTP password reset.
- Ctrl+G opens browser sign-in, including Google sign-in when offered by the web app. Finish login in that browser window; Esc cancels the terminal handoff. The loopback callback has a random address and verifies the returned token before saving it.
- If the web app redirects an already authenticated browser away from its login page, use terminal email login or retry browser sign-in in a browser session that shows the login form.
- A temporary server error preserves your saved session and offers Retry.

Enter a room code, or leave it empty to use your own existing/server-assigned room. Room errors and private-room approval status appear in the terminal.

## Player controls

| Key | Action |
| --- | --- |
| Space | Play / pause |
| N / P | Next / previous track |
| R | Cycle repeat: off, all, track |
| Up / Down | Focus the queue and move its cursor |
| M | Toggle queue focus; Enter plays the selected track |
| S | Search; arrows select a result, Enter enqueues |
| Esc | Leave search/queue mode |
| B | Choose another room |
| Q / Ctrl+C | Quit and restore the terminal |

The queue scrolls to keep its cursor visible and preserves the selected track when rows are reordered or removed. Playback shortcuts remain available while the queue is focused.

Commands round-trip through the backend. Offline controls are rejected rather than buffered. After reconnecting, the client rejoins the room and redeclares readiness for cached audio.

## Audio and synchronization

Audio downloads share in-flight work and become available through an atomic rename only after the stream completes. Playback uses the downloader's returned path for uploaded files and metadata-bearing YouTube URLs. Cached audio lives in the operating system's cache directory, not the shell's current working directory.

The client uses NTP bursts, RTT filtering and adaptive parameters ported from the web client. Scheduled playback waits for the server epoch; late arrivals seek to the current timeline. FFplay's reported media clock supplies the measured drift. Hard seeks use observed decoder launch latency and a cooldown; playback speed stays at 1.0.

FFplay process startup and the audio device affect timing. This implementation measures/corrects drift; **physical multi-device alignment below 25ms has not been certified**. Real speaker/network testing is still required. An unknown audio clock is shown as measuring rather than synced.

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `SYNCBEATS_SERVER_URL` | Backend HTTP base URL |
| `SYNCBEATS_APP_URL` | Web login origin for browser handoff |
| `SYNCBEATS_CACHE_DIR` | Audio cache root |
| `XDG_CONFIG_HOME` | Configstore root for device/session storage |
| `XDG_CACHE_HOME` | Cache root on systems honoring XDG paths |

There is no background Git updater. Update deliberately:

```bash
git pull --ff-only
npm ci
```

## Verification and packaging

```bash
npm test
npm run build
npm audit
npm pack
```

The regression suite exercises the actual CLI against local HTTP/Socket.IO fixtures, terminal input, scheduled/paused playback, download failures, reconnects, browser callback validation, and the npm artifact. It uses fake local accounts and sends no live emails. The real AAC decoder test uses SDL's dummy audio driver and is skipped if FFmpeg/FFplay are absent.

`npm pack` includes the compiled `dist/index.js`. A Git installation runs the prepare build; a packed installation runs the already compiled bundle. Help/version commands work without opening the terminal UI:

```bash
syncbeats --help
syncbeats --version
```

Live Google consent, email delivery, real YouTube extraction, physical speaker timing, and other operating systems still need manual verification. See [VERIFICATION.md](VERIFICATION.md) for the fix record.
