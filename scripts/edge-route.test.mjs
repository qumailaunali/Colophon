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
