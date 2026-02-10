// Virtual Execution Engine for AST
// Explicit-stack based interpreter: no JS recursion, deterministic, safe
// Supports: Program, VariableDeclaration, ExpressionStatement, AssignmentStatement,
//           Literal, Identifier, BinaryExpression (+ only in v1)

(function () {
  'use strict';

  // ============================================================================
  // ExecutionState: describes the full state of a running program
  // ============================================================================
  function ExecutionState(options) {
    this.options = Object.assign({
      maxSteps: 10000,
      maxScopeDepth: 100,
      maxTraceLength: 50000
    }, options || {});

    this.stepCounter = 0;
    this.ipStack = []; // stack of frames (where we are in execution)
    this.evalStack = []; // stack for expression evaluation (intermdiates)
    this.scopeStack = []; // stack of scopes
    this.trace = []; // recorded events
    this.status = 'ready'; // 'ready' | 'running' | 'paused' | 'done' | 'error'
    this.lastError = null;
    this.stats = { stepsExecuted: 0, peakScopeDepth: 0 };

    // Initialize global scope (always present)
    this.globalScope = this.createScope(null);
    this.scopeStack.push(this.globalScope);
  }

  // ============================================================================
  // Scope and Binding Management
  // ============================================================================
  ExecutionState.prototype.createScope = function (parentScopeId) {
    const scope = {
      id: this.scopeStack.length, // scope id = depth in stack
      parentId: parentScopeId,
      bindings: new Map() // Map<name, Binding>
    };
    return scope;
  };

  ExecutionState.prototype.currentScope = function () {
    return this.scopeStack[this.scopeStack.length - 1];
  };

  ExecutionState.prototype.pushScope = function (reason) {
    if (this.scopeStack.length >= this.options.maxScopeDepth) {
      this.error('max-depth', 'Scope stack max depth exceeded');
      return;
    }
    const parent = this.currentScope();
    const newScope = this.createScope(parent.id);
    this.scopeStack.push(newScope);
    this.stats.peakScopeDepth = Math.max(this.stats.peakScopeDepth, this.scopeStack.length);
    this.emitEvent('enter-scope', {
      scopeId: newScope.id,
      parentScopeId: parent.id,
      reason: reason
    });
  };

  ExecutionState.prototype.popScope = function () {
    const scope = this.scopeStack.pop();
    this.emitEvent('exit-scope', {
      scopeId: scope.id,
      reason: 'block-exit'
    });
  };

  // Find a binding by name, walking scopeStack from top to bottom
  ExecutionState.prototype.findBinding = function (name) {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const binding = this.scopeStack[i].bindings.get(name);
      if (binding) return { binding, scopeId: this.scopeStack[i].id };
    }
    return null;
  };

  // Create a new binding in the current scope
  ExecutionState.prototype.declareBinding = function (name, kind, nodeId) {
    const scope = this.currentScope();
    if (scope.bindings.has(name)) {
      this.error('declare-conflict', 'Binding "' + name + '" already declared in this scope');
      return null;
    }
    const binding = {
      name: name,
      kind: kind, // 'let' | 'const'
      value: undefined,
      declaredAtNodeId: nodeId,
      initialized: false
    };
    scope.bindings.set(name, binding);
    return binding;
  };

  // Assign to an existing binding
  ExecutionState.prototype.assignBinding = function (name, newValue, nodeId) {
    const found = this.findBinding(name);
    if (!found) {
      this.error('undeclared-var', 'Undeclared variable: ' + name);
      return;
    }
    const binding = found.binding;

    // Check const reassignment
    if (binding.kind === 'const' && binding.initialized) {
      this.error('const-reassign', 'Cannot reassign const binding "' + name + '"');
      return;
    }

    const oldValue = binding.value;
    binding.value = newValue;
    binding.initialized = true;

    this.emitEvent('assign', {
      name: name,
      oldValue: oldValue,
      newValue: newValue,
      kind: binding.kind,
      bindingNodeId: binding.declaredAtNodeId,
      scopeId: found.scopeId
    });
  };

  // ============================================================================
  // Frame Stack Management
  // ============================================================================
  ExecutionState.prototype.pushFrame = function (nodeId, nodeType, stage) {
    const frame = {
      nodeId: nodeId,
      nodeType: nodeType,
      stage: stage,
      childIndex: 0,
      scopeId: this.currentScope().id
    };
    this.ipStack.push(frame);
    return frame;
  };

  ExecutionState.prototype.currentFrame = function () {
    return this.ipStack[this.ipStack.length - 1];
  };

  ExecutionState.prototype.popFrame = function () {
    return this.ipStack.pop();
  };

  // ============================================================================
  // Event Emission
  // ============================================================================
  ExecutionState.prototype.emitEvent = function (type, fields) {
    if (this.trace.length >= this.options.maxTraceLength) {
      this.error('trace-overflow', 'Trace buffer exceeded max length');
      return;
    }

    const event = Object.assign({
      type: type,
      step: this.stepCounter
    }, fields || {});

    this.trace.push(event);
  };

  ExecutionState.prototype.error = function (code, message) {
    this.status = 'error';
    this.lastError = { code: code, message: message };
    const frame = this.currentFrame();
    this.emitEvent('error', {
      nodeId: frame ? frame.nodeId : null,
      nodeType: frame ? frame.nodeType : null,
      scopeId: this.currentScope().id,
      code: code,
      message: message
    });
  };

  // ============================================================================
  // Main Interpreter Loop: step()
  // ============================================================================
  ExecutionState.prototype.step = function () {
    // Check limits
    if (this.stepCounter >= this.options.maxSteps) {
      this.error('max-steps', 'Execution step limit exceeded');
      return this.trace[this.trace.length - 1];
    }

    if (this.status !== 'running') {
      return null;
    }

    const frame = this.currentFrame();
    if (!frame) {
      // No more frames: execution done
      this.status = 'done';
      this.emitEvent('halt', { scopeId: this.currentScope().id });
      this.stepCounter++;
      return this.trace[this.trace.length - 1];
    }

    // Dispatch to node-specific handler
    let eventEmitted = false;
    switch (frame.nodeType) {
      case 'Program':
        eventEmitted = this.executeProgram(frame);
        break;
      case 'BlockStatement':
        eventEmitted = this.executeBlockStatement(frame);
        break;
      case 'VariableDeclaration':
        eventEmitted = this.executeVariableDeclaration(frame);
        break;
      case 'ExpressionStatement':
        eventEmitted = this.executeExpressionStatement(frame);
        break;
      case 'AssignmentStatement':
        eventEmitted = this.executeAssignmentStatement(frame);
        break;
      case 'Literal':
        eventEmitted = this.executeLiteral(frame);
        break;
      case 'Identifier':
        eventEmitted = this.executeIdentifier(frame);
        break;
      case 'BinaryExpression':
        eventEmitted = this.executeBinaryExpression(frame);
        break;
      case 'IfStatement':
        eventEmitted = this.executeIfStatement(frame);
        break;
      case 'WhileStatement':
        eventEmitted = this.executeWhileStatement(frame);
        break;
      case 'ForStatement':
        eventEmitted = this.executeForStatement(frame);
        break;
      default:
        this.error('unsupported-node', 'Unsupported node type: ' + frame.nodeType);
        eventEmitted = true;
    }

    if (eventEmitted) {
      this.stepCounter++;
    }
    return this.trace[this.trace.length - 1] || null;
  };

  // ============================================================================
  // Node Execution Handlers (v1 supported nodes)
  // ============================================================================

  // Program: just move through its body statements
  ExecutionState.prototype.executeProgram = function (frame) {
    if (frame.stage === 'evaluate-body') {
      const node = this.astNodeMap[frame.nodeId];
      if (!node.body || node.body.length === 0) {
        frame.stage = 'done';
        this.emitEvent('enter-statement', { nodeId: frame.nodeId, nodeType: 'Program', scopeId: this.currentScope().id });
        return true;
      }
      if (frame.childIndex === 0) {
        this.emitEvent('enter-statement', { nodeId: frame.nodeId, nodeType: 'Program', scopeId: this.currentScope().id });
      }
      const stmt = node.body[frame.childIndex];
      if (stmt) {
        this.pushFrame(stmt.id, stmt.type, this.getInitialStage(stmt.type));
        frame.childIndex++;
        return true;
      } else {
        frame.stage = 'done';
        return true;
      }
    } else if (frame.stage === 'done') {
      this.emitEvent('exit-statement', { nodeId: frame.nodeId, nodeType: 'Program', scopeId: this.currentScope().id });
      this.popFrame();
      return true;
    }
    return false;
  };

  // BlockStatement: push scope, execute body, pop scope
  ExecutionState.prototype.executeBlockStatement = function (frame) {
    if (frame.stage === 'enter') {
      this.emitEvent('enter-statement', { nodeId: frame.nodeId, nodeType: 'BlockStatement', scopeId: this.currentScope().id });
      this.pushScope('block');
      frame.stage = 'evaluate-body';
      return true;
    } else if (frame.stage === 'evaluate-body') {
      const node = this.astNodeMap[frame.nodeId];
      if (!node.body || node.body.length === 0) {
        frame.stage = 'exit';
        return true;
      }
      if (frame.childIndex < node.body.length) {
        const stmt = node.body[frame.childIndex];
        this.pushFrame(stmt.id, stmt.type, this.getInitialStage(stmt.type));
        frame.childIndex++;
        return true;
      } else {
        frame.stage = 'exit';
        return true;
      }
    } else if (frame.stage === 'exit') {
      // Emit exit for the block statement, then pop the scope so exit-scope
      // follows the statement exit in the trace (matches test expectations).
      this.emitEvent('exit-statement', { nodeId: frame.nodeId, nodeType: 'BlockStatement', scopeId: this.currentScope().id });
      this.popScope();
      this.popFrame();
      return true;
    }
    return false;
  };

  // VariableDeclaration: declare binding, evaluate init, assign
  ExecutionState.prototype.executeVariableDeclaration = function (frame) {
    const node = this.astNodeMap[frame.nodeId];
    if (frame.stage === 'declare') {
      this.emitEvent('enter-statement', { nodeId: frame.nodeId, nodeType: 'VariableDeclaration', scopeId: this.currentScope().id });
      // declare all bindings (in v1, one per decl, but structure allows multiples)
      const decl = node.declarations[0]; // v1: one declaration per VariableDeclaration
      this.declareBinding(decl.id.name, node.kind, frame.nodeId);
      if (decl.init) {
        frame.stage = 'evaluate-init';
      } else {
        frame.stage = 'done';
      }
      return true;
    } else if (frame.stage === 'evaluate-init') {
      const decl = node.declarations[0];
      // Push init expression onto frame stack for evaluation
      this.pushFrame(decl.init.id, decl.init.type, this.getInitialStage(decl.init.type));
      frame.stage = 'assign';
      return true;
    } else if (frame.stage === 'assign') {
      const decl = node.declarations[0];
      // After init evaluation, value should be on evalStack
      if (this.evalStack.length > 0) {
        const val = this.evalStack.pop();
        this.assignBinding(decl.id.name, val, frame.nodeId);
        frame.stage = 'done';
        return true;
      }
      return false;
    } else if (frame.stage === 'done') {
      this.emitEvent('exit-statement', { nodeId: frame.nodeId, nodeType: 'VariableDeclaration', scopeId: this.currentScope().id });
      this.popFrame();
      return true;
    }
    return false;
  };

  // ExpressionStatement: evaluate expression and discard result
  ExecutionState.prototype.executeExpressionStatement = function (frame) {
    const node = this.astNodeMap[frame.nodeId];
    if (frame.stage === 'evaluate-expr') {
      this.emitEvent('enter-statement', { nodeId: frame.nodeId, nodeType: 'ExpressionStatement', scopeId: this.currentScope().id });
      this.pushFrame(node.expression.id, node.expression.type, this.getInitialStage(node.expression.type));
      frame.stage = 'done';
      return true;
    } else if (frame.stage === 'done') {
      // Pop result value from evalStack (discard it)
      if (this.evalStack.length > 0) {
        this.evalStack.pop();
      }
      this.emitEvent('exit-statement', { nodeId: frame.nodeId, nodeType: 'ExpressionStatement', scopeId: this.currentScope().id });
      this.popFrame();
      return true;
    }
    return false;
  };

  // AssignmentStatement: evaluate RHS, assign to LHS (must be Identifier)
  ExecutionState.prototype.executeAssignmentStatement = function (frame) {
    const node = this.astNodeMap[frame.nodeId];
    if (frame.stage === 'evaluate-expr') {
      this.emitEvent('enter-statement', { nodeId: frame.nodeId, nodeType: 'AssignmentStatement', scopeId: this.currentScope().id });
      // Push RHS for evaluation
      const rhs = node.expression.right;
      this.pushFrame(rhs.id, rhs.type, this.getInitialStage(rhs.type));
      frame.stage = 'assign';
      return true;
    } else if (frame.stage === 'assign') {
      // RHS value should be on evalStack; pop and assign to LHS
      const lhsId = node.expression.left.name;
      if (this.evalStack.length > 0) {
        const val = this.evalStack.pop();
        this.assignBinding(lhsId, val, frame.nodeId);
        frame.stage = 'done';
        return true;
      }
      return false;
    } else if (frame.stage === 'done') {
      this.emitEvent('exit-statement', { nodeId: frame.nodeId, nodeType: 'AssignmentStatement', scopeId: this.currentScope().id });
      this.popFrame();
      return true;
    }
    return false;
  };

  // Literal: return the literal value
  ExecutionState.prototype.executeLiteral = function (frame) {
    const node = this.astNodeMap[frame.nodeId];
    if (frame.stage === 'eval') {
      this.evalStack.push(node.value);
      this.emitEvent('eval-literal', {
        nodeId: frame.nodeId,
        nodeType: 'Literal',
        value: node.value,
        raw: node.raw,
        scopeId: this.currentScope().id
      });
      frame.stage = 'done';
      return true;
    } else if (frame.stage === 'done') {
      this.popFrame();
      return true;
    }
    return false;
  };

  // Identifier: look up variable value
  ExecutionState.prototype.executeIdentifier = function (frame) {
    const node = this.astNodeMap[frame.nodeId];
    if (frame.stage === 'lookup') {
      const found = this.findBinding(node.name);
      if (!found) {
        this.error('undeclared-var', 'Undeclared variable: ' + node.name);
        return true;
      }
      const value = found.binding.value;
      this.evalStack.push(value);
      this.emitEvent('eval-identifier', {
        nodeId: frame.nodeId,
        nodeType: 'Identifier',
        name: node.name,
        value: value,
        foundInScopeId: found.scopeId,
        scopeId: this.currentScope().id
      });
      frame.stage = 'done';
      return true;
    } else if (frame.stage === 'done') {
      this.popFrame();
      return true;
    }
    return false;
  };

  // BinaryExpression: evaluate left, right, then apply operator
  ExecutionState.prototype.executeBinaryExpression = function (frame) {
    const node = this.astNodeMap[frame.nodeId];
    if (frame.stage === 'evaluate-left') {
      this.pushFrame(node.left.id, node.left.type, this.getInitialStage(node.left.type));
      frame.stage = 'evaluate-right';
      return true;
    } else if (frame.stage === 'evaluate-right') {
      this.pushFrame(node.right.id, node.right.type, this.getInitialStage(node.right.type));
      frame.stage = 'compute-op';
      return true;
    } else if (frame.stage === 'compute-op') {
      // Pop right, then left
      if (this.evalStack.length < 2) {
        this.error('eval-stack', 'Evaluation stack error');
        return true;
      }
      const right = this.evalStack.pop();
      const left = this.evalStack.pop();
      let result;

      // v1: support only '+' operator (and some comparisons for if/while)
      // TODO: add -, *, /, %, <, >, <=, >=, ==, !=, ===, !==, &&, ||
      switch (node.operator) {
        case '+':
          result = left + right;
          break;
        case '-':
          result = left - right;
          break;
        case '*':
          result = left * right;
          break;
        case '/':
          if (right === 0) {
            this.error('div-by-zero', 'Division by zero');
            return true;
          }
          result = left / right;
          break;
        case '%':
          if (right === 0) {
            this.error('div-by-zero', 'Modulo by zero');
            return true;
          }
          result = left % right;
          break;
        case '<':
          result = left < right;
          break;
        case '>':
          result = left > right;
          break;
        case '<=':
          result = left <= right;
          break;
        case '>=':
          result = left >= right;
          break;
        case '==':
          // eslint-disable-next-line eqeqeq
          result = left == right;
          break;
        case '!=':
          // eslint-disable-next-line eqeqeq
          result = left != right;
          break;
        case '===':
          result = left === right;
          break;
        case '!==':
          result = left !== right;
          break;
        case '&&':
          result = left && right;
          break;
        case '||':
          result = left || right;
          break;
        default:
          this.error('unsupported-op', 'Unsupported operator: ' + node.operator);
          return true;
      }

      this.evalStack.push(result);
      this.emitEvent('eval-binary', {
        nodeId: frame.nodeId,
        nodeType: 'BinaryExpression',
        operator: node.operator,
        left: left,
        right: right,
        value: result,
        scopeId: this.currentScope().id
      });
      frame.stage = 'done';
      return true;
    } else if (frame.stage === 'done') {
      this.popFrame();
      return true;
    }
    return false;
  };

  // ============================================================================
  // Control Flow Nodes
  // ============================================================================

  // IfStatement: evaluate test, branch, execute consequent or alternate
  ExecutionState.prototype.executeIfStatement = function (frame) {
    const node = this.astNodeMap[frame.nodeId];
    if (frame.stage === 'evaluate-test') {
      this.emitEvent('enter-statement', { nodeId: frame.nodeId, nodeType: 'IfStatement', scopeId: this.currentScope().id });
      // Push test expression frame for evaluation
      this.pushFrame(node.test.id, node.test.type, this.getInitialStage(node.test.type));
      frame.stage = 'branch-decision';
      return true;
    } else if (frame.stage === 'branch-decision') {
      // Test evaluated; pop value from evalStack
      if (this.evalStack.length === 0) {
        this.error('eval-stack', 'Expected test value on evalStack');
        return true;
      }
      const testValue = this.evalStack.pop();
      const isTruthy = Boolean(testValue);

      this.emitEvent('branch', {
        nodeId: frame.nodeId,
        nodeType: 'IfStatement',
        testValue: isTruthy,
        direction: isTruthy ? 'then' : (node.alternate ? 'else' : 'skip'),
        scopeId: this.currentScope().id
      });

      if (isTruthy && node.consequent) {
        this.pushFrame(node.consequent.id, node.consequent.type, this.getInitialStage(node.consequent.type));
        frame.stage = 'done';
      } else if (!isTruthy && node.alternate) {
        this.pushFrame(node.alternate.id, node.alternate.type, this.getInitialStage(node.alternate.type));
        frame.stage = 'done';
      } else {
        frame.stage = 'done';
      }
      return true;
    } else if (frame.stage === 'done') {
      this.emitEvent('exit-statement', { nodeId: frame.nodeId, nodeType: 'IfStatement', scopeId: this.currentScope().id });
      this.popFrame();
      return true;
    }
    return false;
  };

  // TODO: WhileStatement
  ExecutionState.prototype.executeWhileStatement = function (frame) {
    // Placeholder
    this.error('unsupported-node', 'WhileStatement not yet implemented');
    this.popFrame();
    return true;
  };

  // TODO: ForStatement
  ExecutionState.prototype.executeForStatement = function (frame) {
    // Placeholder
    this.error('unsupported-node', 'ForStatement not yet implemented');
    this.popFrame();
    return true;
  };

  // ============================================================================
  // Utility: determine initial stage for a node type
  // ============================================================================
  ExecutionState.prototype.getInitialStage = function (nodeType) {
    const stageMap = {
      'Program': 'evaluate-body',
      'BlockStatement': 'enter',
      'VariableDeclaration': 'declare',
      'ExpressionStatement': 'evaluate-expr',
      'AssignmentStatement': 'evaluate-expr',
      'Literal': 'eval',
      'Identifier': 'lookup',
      'BinaryExpression': 'evaluate-left',
      'UnaryExpression': 'evaluate-arg',
      'IfStatement': 'evaluate-test',
      'WhileStatement': 'evaluate-test',
      'ForStatement': 'evaluate-init'
    };
    return stageMap[nodeType] || 'unknown';
  };

  // ============================================================================
  // Public API: start execution
  // ============================================================================
  function start(programAst, options) {
    const state = new ExecutionState(options);
    state.astNodeMap = buildAstNodeMap(programAst);
    state.status = 'running';

    // Push root Program frame
    state.pushFrame(programAst.id, 'Program', 'evaluate-body');

    return state;
  }

  // Build a map from node.id -> node for quick lookup
  function buildAstNodeMap(ast) {
    const map = {};
    function traverse(node) {
      if (!node || typeof node !== 'object') return;
      if (node.id) map[node.id] = node;
      // Traverse all properties
      for (const key in node) {
        if (key !== 'id' && key !== 'type' && key !== 'loc' && key !== 'start' && key !== 'end' && key !== 'raw') {
          const val = node[key];
          if (Array.isArray(val)) {
            val.forEach(traverse);
          } else {
            traverse(val);
          }
        }
      }
    }
    traverse(ast);
    return map;
  }

  // ============================================================================
  // Export
  // ============================================================================
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { start, ExecutionState };
  } else if (typeof window !== 'undefined') {
    window.Executor = { start, ExecutionState };
  } else if (typeof self !== 'undefined') {
    self.Executor = { start, ExecutionState };
  }

})();
