import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

function client(outcomes) {
  const filename = path.resolve('node_modules/msedge-tts/dist/MsEdgeTTS.js');
  const originalRequire = createRequire(filename);
  const exports = {};
  const sockets = [];
  class Socket {
    OPEN = 1;
    readyState = 1;
    handlers = {};
    terminated = false;
    constructor(url, options) {
      this.url = new URL(url);
      this.options = options;
      const outcome = outcomes[sockets.length];
      sockets.push(this);
      queueMicrotask(() => {
        if (outcome === 101) this.onopen();
        else this.handlers['unexpected-response']({}, {
          statusCode: outcome,
          headers: { date: 'Mon, 12 Oct 2026 12:05:00 GMT' },
          resume() {},
        });
      });
    }
    on(type, handler) { this.handlers[type] = handler; }
    send(_data, done) { done(); }
    terminate() { this.terminated = true; this.onerror({ message: 'closed' }); }
    close() {}
  }
  class Clock extends Date { static now() { return Date.parse('Mon, 12 Oct 2026 12:00:00 GMT'); } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports, require: (name) => name === 'isomorphic-ws' ? Socket : originalRequire(name),
    crypto: webcrypto, TextEncoder, Date: Clock, console,
  });
  return { tts: new exports.MsEdgeTTS(), cls: exports.MsEdgeTTS, sockets };
}

test('working primary connection is preserved', async () => {
  const { tts, sockets } = client([101]);
  await tts.setMetadata('en-US-AvaNeural', 'audio-24khz-48kbitrate-mono-mp3');
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url.hostname, 'speech.platform.bing.com');
  assert.match(sockets[0].options.headers.Cookie, /^muid=[A-F0-9]{32};$/);
  assert.equal(sockets[0].options.handshakeTimeout, 10000);
});

test('403 corrects clock and tries alternate endpoint exactly once', async () => {
  const { tts, sockets, cls } = client([403, 101]);
  await tts.setMetadata('en-US-AvaNeural', 'audio-24khz-48kbitrate-mono-mp3');
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].terminated, true);
  assert.equal(cls.clockSkewMs, 300000);
  assert.equal(sockets[1].url.hostname, 'api.msedgeservices.com');
  assert.ok(sockets[1].url.searchParams.has('Ocp-Apim-Subscription-Key'));
  assert.match(sockets[1].url.searchParams.get('ConnectionId'), /^[a-f0-9]{32}$/);
  assert.notEqual(sockets[0].url.searchParams.get('Sec-MS-GEC'), sockets[1].url.searchParams.get('Sec-MS-GEC'));
});

test('persistent 403 does not loop', async () => {
  const { tts, sockets } = client([403, 403]);
  await assert.rejects(tts.setMetadata('en-US-AvaNeural', 'audio-24khz-48kbitrate-mono-mp3'), /HTTP 403/);
  assert.equal(sockets.length, 2);
});

test('429 is surfaced without retrying and increasing request pressure', async () => {
  const { tts, sockets } = client([429]);
  await assert.rejects(tts.setMetadata('en-US-AvaNeural', 'audio-24khz-48kbitrate-mono-mp3'), /HTTP 429/);
  assert.equal(sockets.length, 1);
});
