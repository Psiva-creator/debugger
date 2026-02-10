# Project Checkpoint

## Completed (MVP Phase 1)

1. **Parser (`src/parser.js`)**
   - Tokenizer + recursive-descent parser
   - Produces deterministic AST for minimal imperative subset
   - Supports: `let`/`const`, assignments, expressions, if/else, while, for, blocks
   - Safe for untrusted input; no eval, no host access
   - All nodes have id, type, start, end, loc metadata

2. **Execution Engine (`src/engine/executor.js`)**
   - Explicit-stack interpreter (no JS recursion)
   - ExecutionState: scopes, bindings, frame stack, eval stack, trace
   - Core API: `start(ast, options)` → returns state; `state.step()` → emits one Event
   - Fully implemented node types: Program, BlockStatement, VariableDeclaration, ExpressionStatement, AssignmentStatement, Literal, Identifier, BinaryExpression (all operators: +, -, *, /, %, <, >, <=, >=, ==, !=, ===, !==, &&, ||)
   - Safety limits: maxSteps (10000), maxScopeDepth (100), maxTraceLength (50000)

3. **Event Model**
   - 13 event types (enter/exit-statement, eval-literal/identifier/binary, assign, branch, enter/exit-scope, loop-iteration, error, halt)
   - Every atomic operation recorded with step#, nodeId, scopeId, and contextual fields
   - Deterministic: same AST + options → same event sequence

## NOT in v1 (intentionally deferred)

- Control flow: if/while/for (stubs present, error on encounter)
- UnaryExpression (!, -, +) — partial stub
- Functions, closures, higher-order constructs
- Objects, arrays, property access
- Exceptions (try/catch/throw)
- Async, timers, promises
- Compound assignment (+=, -=), ++, --
- Template literals, destructuring, spread/rest
- Full ES6+ features

## Current Next Steps

1. **Complete control flow** (if/while/for handlers in executor.js)
2. **Write integration tests** (parser + executor end-to-end)
3. **Implement animator/visualizer** (consume Events, render state changes)
4. **UI shell** (editor integration, project workspace)

## Key Constraints & Decisions

- **Deterministic only**: same input → identical trace every time
- **No host API access**: interpreter runs sandboxed (main thread or Worker safe)
- **Value model**: primitives only (number, string, boolean, null) in v1
- **Explicit scoping**: lexical, block-scoped; no hoisting
- **Loop-local scope**: `for (let i ...)` creates scope for `i`
- **Frame-based architecture**: makes pause/resume, replay, stepping trivial
- **Event-driven**: animator consumes Events, not step callbacks
