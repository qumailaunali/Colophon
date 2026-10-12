# Edge speech connection recovery

The `/api/tts/edge` route connects to Microsoft from Vercel. It does not forward the browser's User-Agent to Microsoft, so a WebSocket handshake 403 occurs upstream before Safari receives audio. The reported Mac/iPhone-only pattern has not been reproduced on Vercel; Windows/Android success must be checked against the same deployment, voice, account, and sentence.

## Changes

- Keep `msedge-tts` at 2.0.7 and preserve its primary Bing speech endpoint. On HTTP 403 only, correct the time-based token using the response Date header when available and try the alternate Microsoft Edge endpoint once. No automatic retry on 429, and no retry loop if both endpoints refuse the connection.
- Match the maintained client's 143.0.3650.75 protocol version, compact connection IDs, language/cache headers, and random MUID cookie. This cookie is sent by the Vercel server to Microsoft; it does not change app login cookies.
- Limit each WebSocket handshake to 10 seconds. Limit the route's speech work to 30 seconds and close the connection on stream completion, stream failure, cancellation, or timeout. Native Node-to-Web stream conversion forwards cancellation/errors and applies backpressure.
- Persist the dependency changes in `patches/msedge-tts+2.0.7.patch`, applied by `postinstall` with `patch-package --error-on-fail`. Keep `patch-package` in production dependencies so installs that omit devDependencies can still apply the fix. Do not deploy with install scripts disabled without applying the patch explicitly.

Sources: [maintained Edge client protocol headers](https://github.com/rany2/edge-tts/blob/master/src/edge_tts/constants.py), [clock-skew and MUID handling](https://github.com/rany2/edge-tts/blob/master/src/edge_tts/drm.py), [alternate endpoint in upstream release 7.2.3](https://github.com/rany2/edge-tts/blob/7.2.3/src/edge_tts/constants.py).

## Verification

`node --test scripts/edge-protocol.test.mjs scripts/edge-route.test.mjs scripts/ios-audio.test.mjs scripts/client-errors.test.mjs` tests primary success, bounded fallback, clock correction, persistent refusals, no 429 retry, server connection cleanup, cancellation, and the earlier audio/reporting changes.

`npm run build` passed TypeScript and the browser audit, with zero incompatible syntax occurrences. Targeted ESLint passed for the changed route and protocol/probe tests. `npm run postinstall` applied the dependency patch successfully.

The live baseline probe reproduced the user's 403. The alternate endpoint accepted a handshake in one diagnostic request; subsequent checks encountered HTTP 429 and intermittent DNS failures. Complete audio synthesis has **not** been verified in this environment. Automated protocol tests use mock sockets and cannot establish Microsoft's availability from a Vercel region.

## Deployment checks

1. Redeploy through the project's normal Vercel workflow. Confirm build logs show `msedge-tts@2.0.7` patched successfully. This task did not deploy the app.
2. On Mac Safari, old/current iPhone Safari, Windows, and Android, use the same new deployment URL and Edge voice. Open a book and play the same short sentence. Check pause/resume, sentence changes, chapter advance, and Safari's Tap to play fallback.
3. If `/api/tts/edge` returns 502, check Vercel's `[Edge TTS] Synthesis failed` logs. HTTP 403 on both endpoints is a server/service restriction rather than an audio-element failure; HTTP 429 means rate limiting. Do not hammer either endpoint with repeated retries.
4. If Microsoft still refuses Vercel's requests, use the app's existing Azure provider with valid Azure credentials, or investigate availability from the deployed region. This change does not guarantee that either consumer endpoint will accept every hosting IP.

For a fixed, non-private live test from a server with network access, run `node scripts/check-edge-tts.mjs`. It sends only a hard-coded test sentence and reports the number of MP3 bytes returned; it does not read `.env.local` or book contents.
