# Safari 16 compatibility

This app targets Safari and iOS Safari 16.0+, Chrome 111, Edge 111, and Firefox 111. Next.js 16 itself officially supports Safari 16.4+; targeting an older browser and passing a syntax audit does not establish real-device support.

## Audit findings and changes

| File or package | Finding | Action |
| --- | --- | --- |
| Next.js client error boundary, `next/dist/client/components/error-boundary.js` | Baseline production chunk `3yiddnbtmgj46.js` contained a class static initialization block, which Safari 16.1 cannot parse. | Added Safari/iOS 16.0 Browserslist targets. The resulting Turbopack output has no static blocks. |
| `package.json`, installed Next.js build implementation | Next.js 16.2.10 reads Browserslist via `getSupportedBrowsers` and passes `browserslistQuery` into Turbopack. | Retained Turbopack. Actual dependency output was verified, rather than assuming all node_modules are transformed. No `transpilePackages` entries are needed by the audited output. |
| `app`, `components`, `lib`, `public`, production JS | No regex lookbehind or regex `v` literals found; static blocks disappear with the target change. | Added `npm run audit:browser` and automatic `postbuild` syntax auditing using the TypeScript parser. Comments and feature-detection strings are not mistaken for executable syntax. |
| Production legacy polyfill chunk `0cz1d0mv5g_q7.js` | Text hits for `Map.groupBy` and `Promise.withResolvers` are Next.js's existing polyfill implementations/feature checks, not unguarded app requirements. | No additional runtime polyfill imports. |
| Next.js's bundled React DOM | Production output contains `startViewTransition`, which Safari 16 lacks. | No app ViewTransition components are used. React invokes this path only for view-transition work, and its implementation catches unsupported API failures and runs ordinary mutation/layout callbacks. No polyfill needed. |
| `instrumentation-client.ts`, `core-js` | Audited app and shipped client dependencies have no missing Safari 16 runtime APIs requiring new polyfills. | Installed core-js as requested, but import none of it. This file initializes error reporting before app interaction. Add only specific `core-js/actual/...` imports if future audits identify a need. |
| `components/Sidebar/Sidebar.tsx` | Storage reads/writes could throw when storage is blocked. | Guarded both operations; sidebar state still works without persistence. InstallPrompt's sessionStorage access was already guarded. |
| `lib/tts/iosAudio.ts`, Edge/Azure providers, TTS controller, reader page | Empty silent WAV and optimistic unlock flag; async audio fetch can lose user activation. | Prime a valid silent clip on tap, record unlock success, retain a blocked fetched clip, and retry its exact audio element synchronously from a visible Tap to play button. Stop/unmount cancels pending retry. Added playsinline to audio elements. No AudioContext exists in the app. |
| Reader ambient music and dictionary pronunciation | Ambient playback errors were console-only; pronunciation already starts on tap with speech fallback. | Visible music retry on failure and inline audio attributes. Successful playback UI is unchanged. |
| Upload modal, EPUB parser, Supabase Storage | Only EPUB uploads exist, processed sequentially through JSZip and sent as File/Blob to Supabase. No image/photo upload endpoint or HEIC conversion pipeline exists. | Preserved EPUB-only accept/type behavior. HEIC/HEIF are not books and should not be accepted here. Supabase owns server MIME/size restrictions; bucket configuration was not accessed or changed. Large compressed books may exceed a phone's memory during decompression. |
| Supabase SSR/auth | Host-only first-party cookies with path `/` and default SameSite=Lax; no custom Secure or domain setting. Password login and email OTP are used; no OAuth/iframe/third-party-cookie flow is implemented. | Retained cookie/auth configuration. With user approval, let the exact `/auth/confirm` path reach its handler before a session exists. Use HTTPS in production; verify actual Set-Cookie headers and deployment URLs on device. |
| CSS, root layout | No Tailwind, native Popover/View Transitions/dialog usage, CSS nesting, @property, color-mix, @starting-style, or text-wrap:balance found in app/output. `dvh`, safe-area env, and the used layout features work on the target. | No speculative CSS rewrites. Existing viewport-fit=cover, notch insets, prefixed backdrop filters, and iOS input font-size >=16px are retained. Intl.Segmenter is feature-detected with a fallback. |
| `lib/clientErrors.ts`, `/api/client-errors`, proxy matcher | Device errors were difficult to inspect without Safari remote debugging. | Report global errors/unhandled rejections to server logs in production and console in development. Reporting works before login. Deduplicate and cap at 10/page; endpoint accepts same-origin JSON only, limits bodies to 16KiB and reports to 100/minute per server instance. Common URL queries, database URLs, and JWTs are scrubbed client-side. Arbitrary error text cannot be guaranteed free of sensitive data. |

## Reporting controls

Search hosting/server logs for `[client-error]`. This is server logging, not a persistent database or an error dashboard. Rate limits are per process and reset on restart; they are not a distributed abuse-control system.

Set `NEXT_PUBLIC_CLIENT_ERROR_REPORTING=false` and rebuild to disable the browser reporter. Set `CLIENT_ERROR_REPORTING=false` on the server to make the endpoint discard reports. Neither setting changes authentication.

## Verification and limits

- `npm run build` passed, including TypeScript checking and the postbuild syntax audit: 93 files, zero incompatible syntax occurrences. A separate text search of production JS found no lookbehind or static blocks; CSS searches found no unsupported constructs listed above.
- `node --test scripts/ios-audio.test.mjs scripts/client-errors.test.mjs` passed all seven tests. Coverage includes a valid synchronous audio unlock, synchronous replay of a blocked ready clip, cancellation, normal error propagation, errors without Error inheritance, and error-endpoint validation/body limits. These mocks do not reproduce WebKit's media policy.
- `npm run lint` reports 51 errors and 13 warnings, matching linting the same files from committed HEAD: no additional failures. New instrumentation/reporting/audit/test files pass targeted ESLint. Existing failures include explicit-any types, state updates in effects, and two prefer-const errors. These unrelated failures were not suppressed or broadly refactored.
- No real iPhone/browser automation was available. Login cookies, actual media policy, phone memory limits, and layout still require device testing. Next.js's unsupported-browser limitation remains.

## Real-device checklist

Run on a real iOS 16.1.2 iPhone and a current iPhone, using the deployed HTTPS URL. Also smoke-test desktop Chrome, Firefox, and Safari.

1. Login/logout: sign in, reload, close/reopen Safari, log out, and repeat in private browsing. Confirm errors are shown when cookies are blocked. Verify a signup email link reaches `/auth/confirm` and returns to the same deployed host. Test Safari and the installed home-screen app independently.
2. Reading: open several EPUBs, move between chapters/pages, select text, search, highlight, bookmark, change font size, and reload to check saved progress.
3. Uploads: choose one and several EPUBs through Files/iCloud; retry the same file after a failure. Try a large legitimate EPUB and interrupt the network. Verify sequential progress, usable error messages, cover rendering, and Supabase size limits. Photos/HEIC should remain unavailable in this EPUB picker.
4. Audio: tap Play with an empty cache, pause/resume, select a sentence, advance chapters, and change providers. If blocked, tap the fallback and confirm the loaded clip plays. Stop or leave the book while fallback is pending. Test both Edge/Azure when configured, pronunciation, music, and returning from a backgrounded/locked phone. Background playback may be suspended by iOS.
5. Layout: portrait/landscape, browser toolbar expanded/collapsed, keyboard open, and home-screen mode. Check notch/home indicator, dialogs, reader controls, scrolling, and no input-focus zoom.
6. Reporting: trigger a deliberate test error in a test deployment and check `[client-error]` logs for message/stack/user agent; confirm disable switches stop reports. Do not paste credentials into test errors.

References: [Next.js browser support](https://nextjs.org/docs/app/guides/upgrading/version-16), [client instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client).
