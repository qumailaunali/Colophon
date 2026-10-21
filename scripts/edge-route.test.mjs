import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Readable, PassThrough } from 'node:stream';
import { setImmediate as immediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

function route(fail = false) {
  const exports = {};
  const instances = [];
  class TTS {
    closed = 0;
    stream = new PassThrough();
    constructor() { instances.push(this); }
    async setMetadata() { if (fail) throw new Error('HTTP 403'); }
    toStream() { return { audioStream: this.stream }; }
    close() { this.closed++; }
  }
  const code = ts.transpileModule(fs.readFileSync('app/api/tts/edge/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const modules = {
    'next/server': { NextResponse: Response },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test' } } }) } }) },
    'msedge-tts': { MsEdgeTTS: TTS, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' } },
    dns: { default: { setDefaultResultOrder() {} } },
    'node:stream': { Readable },
  };
  vm.runInNewContext(code, { exports, require: (name) => modules[name], Response, console: { error() {} }, setTimeout, clearTimeout, Error });
  const request = (signal) => new Request('https://reader.example/api/tts/edge', {
    method: 'POST', body: JSON.stringify({ text: 'Test sentence.' }), signal,
  });
  return { post: exports.POST, request, instances };
}

test('completed MP3 stream closes the upstream connection', async () => {
  const { post, request, instances } = route();
  const response = await post(request());
  const body = response.arrayBuffer();
  instances[0].stream.end(Buffer.from('test mp3'));
  assert.equal(Buffer.from(await body).toString(), 'test mp3');
  assert.equal(instances[0].closed, 1);
});

test('browser cancellation closes the upstream connection', async () => {
  const { post, request, instances } = route();
  const response = await post(request());
  await response.body.cancel();
  await immediate();
  assert.equal(instances[0].closed, 1);
});

test('connection failure returns JSON and closes the connection', async () => {
  const { post, request, instances } = route(true);
  const response = await post(request());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /HTTP 403/);
  assert.equal(instances[0].closed, 1);
});

function batchRoute({ failAt = -1, error = 'Edge TTS WebSocket handshake failed (HTTP 429)', handshakeFails = false } = {}) {
  const exports = {};
  const instances = [];
  class TTS {
    closed = 0;
    handshakes = 0;
    texts = [];
    constructor() { instances.push(this); }
    async setMetadata() { this.handshakes++; if (handshakeFails) throw new Error(error); }
    toStream(text) {
      const i = this.texts.push(text) - 1;
      const stream = new PassThrough();
      setImmediate(() => i === failAt ? stream.destroy(new Error(error)) : stream.end(Buffer.from(`mp3:${text}`)));
      return { audioStream: stream };
    }
    close() { this.closed++; }
  }
  const code = ts.transpileModule(fs.readFileSync('app/api/tts/edge/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const modules = {
    'next/server': { NextResponse: Response },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test' } } }) } }) },
    'msedge-tts': { MsEdgeTTS: TTS, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' } },
    dns: { default: { setDefaultResultOrder() {} } },
    'node:stream': { Readable },
  };
  vm.runInNewContext(code, { exports, require: (name) => modules[name], Response, Buffer, console: { error() {} }, setTimeout, clearTimeout, Error });
  const request = (body) => new Request('https://reader.example/api/tts/edge', { method: 'POST', body: JSON.stringify(body) });
  return { post: exports.POST, request, instances };
}

test('batch synthesizes every text over one connection', async () => {
  const { post, request, instances } = batchRoute();
  const response = await post(request({ texts: ['One.', 'Two.', 'Three.'] }));
  assert.equal(response.status, 200);
  const { audios } = await response.json();
  assert.deepEqual(audios.map((a) => Buffer.from(a, 'base64').toString()), ['mp3:One.', 'mp3:Two.', 'mp3:Three.']);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].handshakes, 1);
  assert.equal(instances[0].closed, 1);
});

test('batch keeps finished audio when a later sentence fails', async () => {
  const { post, request, instances } = batchRoute({ failAt: 1, error: 'socket closed' });
  const { audios } = await (await post(request({ texts: ['One.', 'Two.', 'Three.'] }))).json();
  assert.equal(Buffer.from(audios[0], 'base64').toString(), 'mp3:One.');
  assert.equal(audios[1], null);
  assert.equal(audios[2], null);
  assert.equal(instances[0].closed, 1);
});

test('rate-limited handshake returns 429 instead of 502', async () => {
  const { post, request, instances } = batchRoute({ handshakeFails: true });
  const batch = await post(request({ texts: ['One.'] }));
  assert.equal(batch.status, 429);
  assert.equal((await batch.json()).throttled, true);
  const single = await post(request({ text: 'One.' }));
  assert.equal(single.status, 429);
  assert.ok(instances.every((i) => i.closed === 1));
});

test('batch rejects more than 5 texts', async () => {
  const { post, request } = batchRoute();
  const response = await post(request({ texts: ['a', 'b', 'c', 'd', 'e', 'f'] }));
  assert.equal(response.status, 400);
});
