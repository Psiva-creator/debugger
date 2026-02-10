// Development helper: Manual debugging script
// Not part of the test suite - for development use only

const { parse } = require('../src/parser.js');
const { start } = require('../src/engine/executor.js');

function runExecutor(ast, options) {
  const state = start(ast, options || { maxSteps: 10000 });
  while (state.status === 'running') state.step();
  return { state, events: state.trace };
}

function simplifyEvents(events) {
  return events.map(e => {
    const o = { type: e.type };
    if (e.nodeType) o.nodeType = e.nodeType;
    if (typeof e.value !== 'undefined') o.value = e.value;
    if (typeof e.name !== 'undefined') o.name = e.name;
    if (typeof e.newValue !== 'undefined') o.newValue = e.newValue;
    if (typeof e.operator !== 'undefined') o.operator = e.operator;
    if (typeof e.code !== 'undefined') o.code = e.code;
    if (typeof e.testValue !== 'undefined') o.testValue = e.testValue;
    if (typeof e.direction !== 'undefined') o.direction = e.direction;
    return o;
  });
}

const src = 'let x = 5;';
console.log('Source:', src);
const parsed = parse(src);
console.log('AST root:', parsed.ast.type);
const out = runExecutor(parsed.ast, { maxSteps: 1000 });
console.log('Status:', out.state.status);
console.log('Events:');
console.log(JSON.stringify(simplifyEvents(out.events), null, 2));
