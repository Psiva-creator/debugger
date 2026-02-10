// Minimal test runner for parser and executor (no external frameworks)
// Run with: node tests/run_tests.js

const { parse } = require('../src/parser.js');
const { start } = require('../src/engine/executor.js');


function assert(cond, message) {
  if (!cond) throw new Error(message || 'Assertion failed');
}

function deepFind(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) {
      for (const el of v) {
        const r = deepFind(el, predicate);
        if (r) return r;
      }
    } else if (typeof v === 'object' && v !== null) {
      const r = deepFind(v, predicate);
      if (r) return r;
    }
  }
  return null;
}

// Helper: run the executor to completion and collect events
function runExecutor(ast, options) {
  const state = start(ast, options || { maxSteps: 10000 });
  while (state.status === 'running') {
    state.step();
  }
  return { state: state, events: state.trace };
}

// Simplify events for comparisons and determinism checks
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
    if (typeof e.reason !== 'undefined') o.reason = e.reason;
    return o;
  });
}

function compareEvents(actualEvents, expectedEvents) {
  const a = simplifyEvents(actualEvents);
  assert(a.length === expectedEvents.length, `Event count mismatch: got ${a.length}, expected ${expectedEvents.length}`);
  for (let i = 0; i < expectedEvents.length; i++) {
    const exp = expectedEvents[i];
    const act = a[i];
    for (const k in exp) {
      assert(act[k] === exp[k], `Event ${i}: expected ${k}=${JSON.stringify(exp[k])}, got ${JSON.stringify(act[k])}`);
    }
  }
}

const tests = [];

// 1) Variable declaration
tests.push({
  name: 'VariableDeclaration simple',
  src: 'let x = 5;',
  astChecks: (res) => {
    assert(!res.errors || res.errors.length === 0, 'Parser errors: ' + JSON.stringify(res.errors));
    const prog = res.ast;
    assert(prog.type === 'Program', 'Root not Program');
    const vd = prog.body[0];
    assert(vd.type === 'VariableDeclaration', 'Expected VariableDeclaration');
    assert(vd.kind === 'let', 'Expected kind let');
    assert(vd.declarations && vd.declarations[0].id.name === 'x', 'Expected declared id x');
    assert(vd.declarations[0].init && vd.declarations[0].init.type === 'Literal' && vd.declarations[0].init.value === 5, 'Expected init literal 5');
  },
  expectedEvents: [
    { type: 'enter-statement', nodeType: 'Program' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'eval-literal', value: 5 },
    { type: 'assign', name: 'x', newValue: 5 },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'exit-statement', nodeType: 'Program' },
    { type: 'halt' }
  ]
});

// 2) Assignment after declaration
tests.push({
  name: 'Assignment after declaration',
  src: 'let x; x = 7;',
  astChecks: (res) => {
    assert(!res.errors || res.errors.length === 0, 'Parser errors');
    const prog = res.ast;
    assert(prog.body.length === 2, 'Should have two statements');
    assert(prog.body[0].type === 'VariableDeclaration', 'First is var decl');
    assert(prog.body[1].type === 'AssignmentStatement', 'Second is assignment');
  },
  expectedEvents: [
    { type: 'enter-statement', nodeType: 'Program' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'enter-statement', nodeType: 'AssignmentStatement' },
    { type: 'eval-literal', value: 7 },
    { type: 'assign', name: 'x', newValue: 7 },
    { type: 'exit-statement', nodeType: 'AssignmentStatement' },
    { type: 'exit-statement', nodeType: 'Program' },
    { type: 'halt' }
  ]
});

// 3) Binary expression evaluation
tests.push({
  name: 'Binary expression',
  src: 'let y = 1 + 2;',
  astChecks: (res) => {
    const vd = res.ast.body[0];
    assert(vd.type === 'VariableDeclaration');
    const init = vd.declarations[0].init;
    assert(init.type === 'BinaryExpression' && init.operator === '+', 'Expected binary +');
  },
  expectedEvents: [
    { type: 'enter-statement', nodeType: 'Program' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'eval-literal', value: 1 },
    { type: 'eval-literal', value: 2 },
    { type: 'eval-binary', operator: '+', value: 3 },
    { type: 'assign', name: 'y', newValue: 3 },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'exit-statement', nodeType: 'Program' },
    { type: 'halt' }
  ]
});

// 4) Identifier lookup
tests.push({
  name: 'Identifier lookup',
  src: 'let x = 2; let z = x;',
  astChecks: (res) => {
    assert(res.ast.body.length === 2);
    const vd1 = res.ast.body[0];
    const vd2 = res.ast.body[1];
    assert(vd1.declarations[0].id.name === 'x');
    assert(vd2.declarations[0].id.name === 'z');
  },
  expectedEvents: [
    { type: 'enter-statement', nodeType: 'Program' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'eval-literal', value: 2 },
    { type: 'assign', name: 'x', newValue: 2 },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'eval-identifier', name: 'x', value: 2 },
    { type: 'assign', name: 'z', newValue: 2 },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'exit-statement', nodeType: 'Program' },
    { type: 'halt' }
  ]
});

// 5) Scope shadowing
tests.push({
  name: 'Scope shadowing',
  src: 'let x = 1; { let x = 2; }',
  astChecks: (res) => {
    assert(res.ast.body.length === 2);
    assert(res.ast.body[1].type === 'BlockStatement');
  },
  expectedEvents: [
    { type: 'enter-statement', nodeType: 'Program' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'eval-literal', value: 1 },
    { type: 'assign', name: 'x', newValue: 1 },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'enter-statement', nodeType: 'BlockStatement' },
    { type: 'enter-scope', reason: 'block' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'eval-literal', value: 2 },
    { type: 'assign', name: 'x', newValue: 2 },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'exit-statement', nodeType: 'BlockStatement' },
    { type: 'exit-scope' },
    { type: 'exit-statement', nodeType: 'Program' },
    { type: 'halt' }
  ],
  postChecks: (res, run) => {
    // After execution, outer binding x should still be 1
    const state = run.state;
    const found = state.findBinding('x');
    assert(found && found.binding.value === 1, 'Outer binding x should remain 1');
  }
});

// 6) Error: undefined variable
tests.push({
  name: 'Error undefined variable',
  src: 'x = 1;',
  astChecks: (res) => {
    assert(res.ast.body.length === 1);
  },
  expectedEvents: [
    { type: 'enter-statement', nodeType: 'Program' },
    { type: 'enter-statement', nodeType: 'AssignmentStatement' },
    { type: 'eval-literal', value: 1 },
    { type: 'error', code: 'undeclared-var' }
  ],
  expectError: true
});

// 7) Error: const reassignment
tests.push({
  name: 'Error const reassignment',
  src: 'const c = 1; c = 2;',
  astChecks: (res) => {
    assert(res.ast.body.length === 2);
  },
  expectedEvents: [
    { type: 'enter-statement', nodeType: 'Program' },
    { type: 'enter-statement', nodeType: 'VariableDeclaration' },
    { type: 'eval-literal', value: 1 },
    { type: 'assign', name: 'c', newValue: 1 },
    { type: 'exit-statement', nodeType: 'VariableDeclaration' },
    { type: 'enter-statement', nodeType: 'AssignmentStatement' },
    { type: 'eval-literal', value: 2 },
    { type: 'error', code: 'const-reassign' }
  ],
  expectError: true
});

// Runner
(async function runAll() {
  let passed = 0;
  for (const t of tests) {
    try {
      console.log('--- Test:', t.name);
      const parsed = parse(t.src);
      t.astChecks(parsed);

      // Run executor twice for determinism
      const run1 = runExecutor(parsed.ast, { maxSteps: 1000 });
      const run2 = runExecutor(parsed.ast, { maxSteps: 1000 });

      // Basic event comparison
      compareEvents(run1.events, t.expectedEvents);
      compareEvents(run2.events, t.expectedEvents);

      // Determinism: runs must be identical
      const j1 = JSON.stringify(simplifyEvents(run1.events));
      const j2 = JSON.stringify(simplifyEvents(run2.events));
      assert(j1 === j2, 'Determinism check failed: runs differ');

      if (t.postChecks) t.postChecks(parsed, run1);

      if (t.expectError) {
        assert(run1.state.status === 'error', 'Expected state.status===error');
      }

      console.log('PASS');
      passed++;
    } catch (err) {
      console.error('FAIL:', t.name);
      console.error(err && err.stack ? err.stack : err);
    }
  }
  console.log('\nTests passed:', passed, '/', tests.length);
  process.exit(passed === tests.length ? 0 : 1);
})();
