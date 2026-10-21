import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Plays sentences through EdgeSpeechProvider the way useTTSController does
// (speak current, then offer the next 5 for prefetch) against a fake route,
// counting the requests that would each open one Edge connection.
function setup({ throttleFirst = 0 } = {}) {
  const exports = {};
  const requests = [];
  let throttled = throttleFirst;
  class Audio {
    constructor(src) { this.src = src; this.readyState = 4; this.duration = 0; }
    load() {}
    pause() {}
  }
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body.texts ? body.texts.length : 1);
    if (throttled > 0) {
      throttled--;
      return new Response(JSON.stringify({ error: 'HTTP 429', throttled: true }), { status: 429, headers: { 'Retry-After': '0' } });
    }
    if (body.texts) {
      return new Response(JSON.stringify({ audios: body.texts.map((t) => Buffer.from(t).toString('base64')) }));
    }
    return new Response(body.text);
  };
  const code = ts.transpileModule(fs.readFileSync('lib/tts/EdgeSpeechProvider.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const modules = {
    './iosAudio': {
      getSharedAudioElement: () => null,
      // "Play" the clip instantly: fire onended on the next tick.
      playAudioElement: (audio) => { setTimeout(() => audio.onended?.(), 0); return Promise.resolve(); },
    },
  };
  vm.runInNewContext(code, {
    exports, require: (name) => modules[name], fetch, Response, Audio, Blob, URL, atob,
    AbortController, setTimeout, clearTimeout, queueMicrotask, Math, Date, Error, Uint8Array,
    console: { log() {}, warn() {} },
  });
  const provider = new exports.EdgeSpeechProvider();
  return { provider, requests };
}

const options = { rate: 1, pitch: 1, volume: 1, voiceName: 'en-US-AvaNeural' };

function playChapter(provider, sentences, statuses = []) {
  return new Promise((resolve, reject) => {
    let index = 0;
    const next = () => {
      if (index >= sentences.length) return resolve();
      provider.speak(sentences[index], options, {
        onEnd: () => { index++; next(); },
        onError: reject,
        onStatus: (s) => statuses.push(s),
      });
      for (let i = 1; i <= 5 && index + i < sentences.length; i++) provider.prefetch(sentences[index + i], options);
    };
    next();
  });
}

test('50 sentences use far fewer requests than one per sentence', async () => {
  const { provider, requests } = setup();
  const sentences = Array.from({ length: 50 }, (_, i) => `Sentence number ${i}.`);
  await playChapter(provider, sentences);
  console.info(`50 sentences -> ${requests.length} requests (batch sizes: ${requests.join(',')})`);
  assert.ok(requests.length <= 15, `expected <= 15 requests, got ${requests.length}`);
});

test('a rate limit is retried on the same sentence and shows busy status', async () => {
  const { provider, requests } = setup({ throttleFirst: 2 });
  const statuses = [];
  const sentences = ['First.', 'Second.', 'Third.'];
  await playChapter(provider, sentences, statuses);
  assert.ok(requests.length >= 3);
  assert.equal(statuses[0], 'busy');
  assert.equal(statuses.at(-1), null);
});
