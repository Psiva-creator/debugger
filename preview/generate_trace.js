const { parse } = require('../src/parser.js');
const { start } = require('../src/engine/executor.js');
const fs = require('fs');
const path = require('path');

const src = process.argv[2] || 'let x = 1; { let x = 2; }';
console.log('Generating trace for source:', src);
const parsed = parse(src);
if (parsed.errors && parsed.errors.length) {
  console.error('Parser errors:', parsed.errors);
  process.exit(1);
}
const state = start(parsed.ast, { maxSteps: 10000 });
while (state.status === 'running') state.step();

const out = {
  src: src,
  ast: parsed.ast,
  trace: state.trace
};

const target = path.join(__dirname, 'trace.json');
fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', target, 'events:', state.trace.length, 'status:', state.status);
