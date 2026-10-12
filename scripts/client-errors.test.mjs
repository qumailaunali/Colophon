import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function endpoint() {
  const exports = {};
  const logs = [];
  const code = ts.transpileModule(fs.readFileSync('app/api/client-errors/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: () => ({ NextResponse: Response }),
    process: { env: {} }, URL, TextDecoder,
    console: { error: (...args) => logs.push(args) },
  });
  return { post: exports.POST, logs };
}
function request(body, origin = 'https://reader.example') {
  return new Request('https://reader.example/api/client-errors', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body,
  });
}

test('same-origin reports log bounded fields and return no content', async () => {
  const { post, logs } = endpoint();
  const response = await post(request(JSON.stringify({ message: 'x'.repeat(2000), stack: '', userAgent: 'Safari' })));
  assert.equal(response.status, 204);
  assert.equal(JSON.parse(logs[0][1]).message.length, 1000);
});
test('cross-origin, invalid JSON, and oversized reports are rejected', async () => {
  const { post, logs } = endpoint();
  assert.equal((await post(request('{}', 'https://other.example'))).status, 403);
  assert.equal((await post(request('invalid'))).status, 400);
  assert.equal((await post(request('x'.repeat(17000)))).status, 413);
  assert.equal(logs.length, 0);
});
