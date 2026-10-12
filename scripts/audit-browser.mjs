import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Parse real syntax: text searches also match comments and feature-detection strings.
const roots = process.argv.slice(2);
if (!roots.length) roots.push('app', 'components', 'lib', 'public', '.next/static');
if (roots.includes('.next/static') && !fs.existsSync('.next/BUILD_ID')) {
  throw new Error('Run a successful production build before auditing .next/static.');
}
let failures = 0;
let files = 0;
function scan(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  files++;
  function visit(node) {
    let feature;
    if (ts.isClassStaticBlockDeclaration(node)) feature = 'class static block';
    if (ts.isRegularExpressionLiteral(node)) {
      const literal = node.text;
      const end = literal.lastIndexOf('/');
      const pattern = literal.slice(1, end);
      if (pattern.includes('(?<=') || pattern.includes('(?<!')) feature = 'regex lookbehind';
      if (literal.slice(end + 1).includes('v')) feature = 'regex v flag';
    }
    if (feature) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      console.error(`${file}:${line + 1}: ${feature}`);
      failures++;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
function walk(root) {
  if (!fs.existsSync(root)) throw new Error(`Missing audit input: ${root}`);
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isDirectory()) walk(file);
    else if (/\.(?:[cm]?js|tsx?)$/.test(file)) scan(file);
  }
}
roots.forEach(walk);
console.log(`Audited ${files} files; ${failures} incompatible syntax occurrences.`);
process.exitCode = failures ? 1 : 0;
