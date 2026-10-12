import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function setup() {
  const audios = [];
  const events = [];
  const exports = {};
  class Audio {
    calls = 0;
    attributes = {};
    play() { this.calls++; return this.result?.() ?? Promise.resolve(); }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const code = ts.transpileModule(fs.readFileSync('lib/tts/iosAudio.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Audio: class extends Audio { constructor() { super(); audios.push(this); } },
    navigator: { userAgent: 'iPhone', maxTouchPoints: 1 },
    window: { dispatchEvent: (event) => events.push(event.detail) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    Error, DOMException, Uint8Array, DataView, btoa,
  });
  return { api: exports, audios, events, Audio };
}

test('unlock invokes play synchronously with a valid nonempty WAV', async () => {
  const { api, audios } = setup();
  api.unlockSharedAudioElement();
  assert.equal(audios[0].calls, 1);
  const clip = Buffer.from(audios[0].src.split(',')[1], 'base64');
  assert.equal(clip.toString('ascii', 0, 4), 'RIFF');
  assert.equal(clip.readUInt32LE(40), clip.length - 44);
  assert.ok(clip.length > 44);
  await Promise.resolve();
  api.unlockSharedAudioElement();
  assert.equal(audios[0].calls, 1);
});

test('blocked playback waits for a synchronous tap retry on the same clip', async () => {
  const { api, Audio, events } = setup();
  const audio = new Audio();
  audio.src = 'blob:ready-clip';
  audio.result = () => Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
  const pending = api.playAudioElement(audio);
  await Promise.resolve();
  assert.equal(events.at(-1), true);
  audio.result = () => Promise.resolve();
  assert.equal(api.retryPendingAudio(), true);
  assert.equal(audio.calls, 2);
  assert.equal(audio.src, 'blob:ready-clip');
  await pending;
  assert.equal(events.at(-1), false);
  assert.equal(api.retryPendingAudio(), false);
});

test('stopping a blocked clip cancels the pending retry', async () => {
  const { api, Audio } = setup();
  const audio = new Audio();
  const controller = new AbortController();
  audio.result = () => Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
  const pending = api.playAudioElement(audio, controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(api.retryPendingAudio(), false);
});

test('other playback errors still propagate normally', async () => {
  const { api, Audio } = setup();
  const audio = new Audio();
  audio.result = () => Promise.reject(new Error('Decode failed'));
  await assert.rejects(api.playAudioElement(audio), /Decode failed/);
  assert.equal(api.retryPendingAudio(), false);
});

test('WebKit-style errors without Error inheritance can request a tap', async () => {
  const { api, Audio } = setup();
  const audio = new Audio();
  audio.result = () => Promise.reject({ name: 'NotAllowedError' });
  const pending = api.playAudioElement(audio);
  await Promise.resolve();
  audio.result = () => Promise.resolve();
  assert.equal(api.retryPendingAudio(), true);
  await pending;
});
