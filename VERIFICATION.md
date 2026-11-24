# CLI fix verification

Verified locally on 24 November 2026 for version 1.0.1.

The audit blockers were repaired in this standalone repository:

| Area | Result |
| --- | --- |
| Backend configuration | Defaults to the current `https://api.syncbeats.in` endpoint; its health response was HTTP 200. Proxy base paths also have a matching Socket.IO path. |
| Distribution | The npm artifact contains `dist/index.js`. A production-only installation started the actual terminal UI, and help/version commands worked. |
| Playback commands | Play/pause/next/previous, repeat and queue jump use the current backend event contract. |
| Audio loading | Playback consumes the downloaded path; YouTube metadata is normalized; concurrent callers share a complete file; failed streams clean up temporary files. |
| Scheduling/sync | Future starts wait for the server epoch, pause cancels pending starts, NTP samples are filtered, and drift uses FFplay's observed media clock. Decoder launch latency is used during correction. |
| Room recovery | Reconnect rejoins the room and cached snapshots redeclare readiness. Participant string payloads, approval state and room errors are handled. |
| Authentication | Signup waits for email verification; transient server failures preserve sessions; Enter submits once; shortcuts do not insert text; OTP reset and validated loopback handoff are exercised. |
| Shutdown | The packed player quit through Q with exit code 0 and restored the alternate screen/cursor. Ctrl+C cleanup also passed. Startup no longer invokes Git or installs packages in the background. |

## Checks performed

- **32 regression tests passed, zero skipped**, including a real AAC decode through FFplay with SDL's dummy audio driver, on Node 22.23.5.
- The preceding 31-test suite also passed on Node 26.13.0 before the additional browser-cancellation regression was added.
- Build and npm packing passed. The packed artifact was installed with production dependencies into a temporary directory and exercised in a real terminal.
- `npm audit --audit-level=moderate` reported **zero vulnerabilities** after removing unused Babel/nodemon dependencies.
- `git diff --check` passed.
- A GitHub Actions workflow runs these checks on Node 22 with FFmpeg installed.

The fixtures follow the current SyncBeats REST/Socket.IO contract and use fake local accounts. They do not exercise real email sending or mutate production rooms.

## Remaining manual checks

Physical speaker alignment below 25ms is not certified. FFplay process/device latency and real networks require two-device testing. Real Google consent, email/OTP delivery and live YouTube extraction were not completed with a real account. Browser handoff requires the web login page to complete the token callback; an existing authenticated browser session can redirect to the hub, so email login remains available. Other operating systems have not been tested locally.

Run `npm test` to repeat the regression suite; see the README for configuration and package usage.

## Queue cursor follow-up

The cursor now focuses automatically on arrow-key input, keeps its row visible through scrolling/resizing, and preserves selection by track ID across queue changes. Queue snapshots are copied into React state so event updates redraw immediately. M toggles focus; playback shortcuts remain available while focused. Three UI regressions reproduce and verify these paths. The complete 35-test suite passed on Node 22 with no skips.
