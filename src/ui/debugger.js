(function () {
  'use strict';

  // --- State ---
  let executionState = null;
  let ast = null;
  let stateHistory = []; // For time-travel debugging

  let intervalId = null;
  let timelineEvents = [];

  // --- DOM Elements ---
  const initialElements = {
    parseBtn: document.getElementById('parseBtn'),
    stepBackBtn: document.getElementById('stepBackBtn'),
    stepBtn: document.getElementById('stepBtn'),
    playBtn: document.getElementById('playBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resetBtn: document.getElementById('resetBtn'),
    codeEditor: document.getElementById('codeEditor'),
    codeDisplay: document.getElementById('codeDisplay'),
    varsContainer: document.getElementById('vars'),
    eventContainer: document.getElementById('event'),
    timelineContainer: document.getElementById('timeline'),
    stepsCount: document.getElementById('stepsCount'),
    statusText: document.getElementById('statusText'),
    scopeDepth: document.getElementById('scopeDepth'),
  };

  // --- Initialization ---
  function init() {
    // Re-query elements if they were not found initially (safety check)
    // In a simple script at bottom of body, they should be there.
    attachEventListeners();
    updateUI();
  }

  function attachEventListeners() {
    initialElements.parseBtn.addEventListener('click', handleParse);
    initialElements.stepBackBtn.addEventListener('click', handleStepBack);
    initialElements.stepBtn.addEventListener('click', handleStep);
    initialElements.playBtn.addEventListener('click', handlePlay);
    initialElements.pauseBtn.addEventListener('click', handlePause);
    initialElements.resetBtn.addEventListener('click', handleReset);
    initialElements.speedSlider.addEventListener('input', handleSpeedChange);
  }

  // --- Handlers ---
  function handleParse() {
    const source = initialElements.codeEditor.value;

    // 1. Parse
    const parseResult = window.Parser.parse(source);

    if (parseResult.errors && parseResult.errors.length > 0) {
      alert('Parse Error:\n' + parseResult.errors.map(e => e.message).join('\n'));
      return;
    }

    ast = parseResult.ast;

    // 2. Initialize Execution
    try {
      timelineEvents = [];
      stateHistory = []; // Clear history for new execution
      initialElements.timelineContainer.innerHTML = '';

      executionState = window.Executor.start(ast, {
        maxSteps: 1000,
        maxScopeDepth: 50
      });
      console.log('Execution started:', executionState);
      updateUI();
    } catch (e) {
      alert('Execution Init Error: ' + e.message);
    }
  }

  function handleStep() {
    if (!executionState || executionState.status !== 'running') return;

    try {
      // Save state snapshot before stepping (for time-travel)
      saveStateSnapshot();

      const event = executionState.step();
      updateUI();

      // Update Timeline
      if (event) {
        const summary = formatEvent(event);
        if (summary && (timelineEvents.length === 0 || timelineEvents[timelineEvents.length - 1] !== summary)) {
          timelineEvents.push(summary);
          renderTimeline();
        }

        // Update Explanation
        const explanation = generateExplanation(event);
        const explanationEl = document.getElementById('explanation');
        if (explanationEl) {
          explanationEl.innerText = explanation;
        }

        // Show branch decision badge
        if (event.type === 'branch') {
          showBranchBadge(event.direction);

          // Show loop pulse if this is a loop continuing (branch true on while statement)
          if (event.direction && event.nodeId && executionState.astNodeMap) {
            const node = executionState.astNodeMap[event.nodeId];
            if (node && node.type === 'WhileStatement') {
              showLoopPulse();
            }
          }
        }

        // Show scope entry/exit animation
        if (event.type === 'enter-scope') {
          showScopeAnimation('enter');
        } else if (event.type === 'exit-scope') {
          showScopeAnimation('exit');
        }
      }

      // Explicitly handle highlighting based on event
      let activeLine = null;
      // Note: event.loc is not available, resolving from astNodeMap
      if (event && event.nodeId && executionState.astNodeMap) {
        const node = executionState.astNodeMap[event.nodeId];
        if (node && node.loc) {
          activeLine = node.loc.start.line;
        }
      }
      renderCode(initialElements.codeEditor.value, activeLine);

    } catch (e) {
      alert('Runtime Error: ' + e.message);
      updateUI(); // Show error state
    }
  }

  function handleSpeedChange(e) {
    executionSpeed = parseInt(e.target.value, 10);
    initialElements.speedValue.textContent = `${executionSpeed}ms`;

    // If playing, restart interval with new speed
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = setInterval(runStepValues, executionSpeed);
    }
  }

  function runStepValues() {
    if (!executionState || executionState.status !== 'running') {
      handlePause(); // Stop if done or error
      return;
    }
    handleStep();
  }

  // Need to define executionSpeed since it's used
  let executionSpeed = 500;

  function handlePlay() {
    if (intervalId) return; // Already running
    if (!executionState || executionState.status !== 'running') return;

    intervalId = setInterval(runStepValues, executionSpeed);
    updateUI();
  }

  function handlePause() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      updateUI();
    }
  }

  function handleReset() {
    handlePause();
    // Re-parse and reset to initial state
    handleParse();
  }

  function handleStepBack() {
    if (stateHistory.length === 0) return; // No history to go back to

    try {
      // Restore previous state
      const previousState = stateHistory.pop();
      executionState = previousState;

      // Update UI to reflect restored state
      updateUI();

      // Render code with correct highlight
      const lastTrace = executionState.trace[executionState.trace.length - 1];
      let activeLine = null;
      if (lastTrace && lastTrace.nodeId && executionState.astNodeMap) {
        const node = executionState.astNodeMap[lastTrace.nodeId];
        if (node && node.loc) {
          activeLine = node.loc.start.line;
        }
      }
      renderCode(initialElements.codeEditor.value, activeLine);

      // Update explanation
      if (lastTrace) {
        const explanation = generateExplanation(lastTrace);
        const explanationEl = document.getElementById('explanation');
        if (explanationEl) {
          explanationEl.innerText = explanation;
        }
      }
    } catch (e) {
      console.error('Step Back Error:', e);
    }
  }

  // Deep copy utility for execution state
  function deepCopyState(state) {
    if (!state) return null;

    // Create a new object with the same prototype
    const copy = Object.create(Object.getPrototypeOf(state));

    // Copy primitive properties and special handling for complex types
    for (const key in state) {
      if (!state.hasOwnProperty(key)) continue;

      const value = state[key];

      if (value === null || value === undefined) {
        copy[key] = value;
      } else if (typeof value === 'function') {
        // Preserve function references
        copy[key] = value;
      } else if (value instanceof Map) {
        // Deep copy Map
        copy[key] = new Map();
        value.forEach((v, k) => {
          copy[key].set(k, deepCopyValue(v));
        });
      } else if (value instanceof Set) {
        // Deep copy Set
        copy[key] = new Set();
        value.forEach(v => {
          copy[key].add(deepCopyValue(v));
        });
      } else if (Array.isArray(value)) {
        // Deep copy Array
        copy[key] = value.map(item => deepCopyValue(item));
      } else if (typeof value === 'object') {
        // Deep copy object (but preserve AST node references)
        if (key === 'astNodeMap' || key === 'ast') {
          // Don't deep copy AST - just reference
          copy[key] = value;
        } else {
          copy[key] = deepCopyValue(value);
        }
      } else {
        // Primitive value
        copy[key] = value;
      }
    }

    return copy;
  }

  function deepCopyValue(value) {
    if (value === null || value === undefined) {
      return value;
    } else if (typeof value === 'function') {
      return value;
    } else if (value instanceof Map) {
      const newMap = new Map();
      value.forEach((v, k) => newMap.set(k, deepCopyValue(v)));
      return newMap;
    } else if (value instanceof Set) {
      const newSet = new Set();
      value.forEach(v => newSet.add(deepCopyValue(v)));
      return newSet;
    } else if (Array.isArray(value)) {
      return value.map(item => deepCopyValue(item));
    } else if (typeof value === 'object') {
      const newObj = {};
      for (const k in value) {
        if (value.hasOwnProperty(k)) {
          newObj[k] = deepCopyValue(value[k]);
        }
      }
      return newObj;
    } else {
      return value;
    }
  }

  function saveStateSnapshot() {
    if (!executionState) return;

    // Deep copy the current state
    const snapshot = deepCopyState(executionState);
    stateHistory.push(snapshot);

    // Limit history size to prevent memory issues (keep last 100 states)
    if (stateHistory.length > 100) {
      stateHistory.shift();
    }
  }

  // --- UI Update ---
  function updateUI() {
    // 1. Status & Buttons
    if (!executionState) {
      initialElements.statusText.textContent = 'ready';
      initialElements.stepBtn.disabled = true;
      initialElements.parseBtn.disabled = false;
      initialElements.codeEditor.disabled = false;
      initialElements.parseBtn.disabled = false;
      initialElements.codeEditor.disabled = false;

      // Reset view
      initialElements.codeEditor.style.display = 'block';
      initialElements.codeDisplay.style.display = 'none';
      initialElements.codeDisplay.innerHTML = ''; // Clear display logic

      renderVariables(null);
      renderEvent(null);
      renderWatchPanel(null);
      initialElements.stepsCount.textContent = '0';
      initialElements.scopeDepth.textContent = '0';
      return;
    }

    initialElements.statusText.textContent = executionState.status;
    initialElements.stepsCount.textContent = executionState.stepCounter;

    // Enable/Disable controls based on status
    const isRunning = executionState.status === 'running' || executionState.status === 'done' || executionState.status === 'error';
    const canRun = executionState.status === 'running';

    initialElements.stepBtn.disabled = !canRun || !!intervalId;
    initialElements.playBtn.disabled = !canRun || !!intervalId;
    initialElements.pauseBtn.disabled = !intervalId;
    initialElements.parseBtn.disabled = true;

    // Switch between Editor and Display
    initialElements.codeEditor.style.display = 'none';
    initialElements.codeDisplay.style.display = 'block';

    // 2. Scope / Variables
    // executionState.scopeStack is an array of scopes.
    // We want to show all variables from all scopes, probably top-down.
    renderVariables(executionState.scopeStack);
    renderWatchPanel(executionState.scopeStack);
    initialElements.scopeDepth.textContent = executionState.scopeStack.length;

    // 3. Last Event
    const lastTrace = executionState.trace[executionState.trace.length - 1];
    renderEvent(lastTrace);

    // 4. Highlight Line
    let activeLine = null;
    if (lastTrace && lastTrace.nodeId && executionState.astNodeMap) {
      const node = executionState.astNodeMap[lastTrace.nodeId];
      if (node && node.loc) {
        activeLine = node.loc.start.line;
      }
    }
    renderCode(initialElements.codeEditor.value, activeLine);
  }

  function renderCode(source, activeLine) {
    if (!source) {
      initialElements.codeDisplay.innerHTML = '';
      return;
    }

    const lines = source.split(/\r?\n/);
    let html = '';

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const isHighlight = lineNumber === activeLine;
      const className = isHighlight ? 'highlight' : '';

      // Basic escaping to prevent HTML injection from source code
      const safeLine = line.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      html += `<div class="${className}">${lineNumber}: ${safeLine}</div>`;
    });

    initialElements.codeDisplay.innerHTML = html;

    // Auto-scroll to active line
    if (activeLine) {
      const activeEl = initialElements.codeDisplay.querySelector('.highlight');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function renderVariables(scopeStack) {
    if (!scopeStack) {
      initialElements.varsContainer.textContent = '';
      return;
    }

    let output = '';
    // Iterate from top of stack (most local) down to global
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const scope = scopeStack[i];
      const scopeName = i === 0 ? 'Global' : `Scope #${scope.id}`;
      output += `[${scopeName}]\n`;

      if (scope.bindings.size === 0) {
        output += '  (empty)\n';
      } else {
        scope.bindings.forEach((binding, name) => {
          let valStr = String(binding.value);
          if (binding.value === undefined) valStr = 'undefined';
          if (binding.value === null) valStr = 'null';
          if (typeof binding.value === 'string') valStr = `"${binding.value}"`;

          output += `  ${name}: ${valStr}\n`;
        });
      }
      output += '\n';
    }
    initialElements.varsContainer.textContent = output;
  }

  function renderEvent(event) {
    if (!event) {
      initialElements.eventContainer.textContent = '';
      return;
    }
    initialElements.eventContainer.textContent = JSON.stringify(event, null, 2);
  }

  function renderWatchPanel(scopeStack) {
    const watchPanel = document.getElementById('watchPanel');
    if (!watchPanel) return;

    if (!scopeStack || scopeStack.length === 0) {
      watchPanel.innerHTML = '<div style="padding: 0.5rem; color: var(--text-muted); font-style: italic;">No variables available</div>';
      return;
    }

    // Collect all variables from all scopes (most recent value wins)
    const allVars = new Map();

    // Iterate from global (bottom) to local (top) so local values override
    for (let i = 0; i < scopeStack.length; i++) {
      const scope = scopeStack[i];
      scope.bindings.forEach((binding, name) => {
        allVars.set(name, binding.value);
      });
    }

    // Display variables
    if (allVars.size === 0) {
      watchPanel.innerHTML = '<div style="padding: 0.5rem; color: var(--text-muted); font-style: italic;">No variables available</div>';
      return;
    }

    let html = '<div style="padding: 0.5rem; font-family: var(--font-code); font-size: 0.85rem;">';
    allVars.forEach((value, name) => {
      let valStr = String(value);
      if (value === undefined) valStr = 'undefined';
      if (value === null) valStr = 'null';
      if (typeof value === 'string') valStr = `"${value}"`;

      html += `<div style="padding: 0.25rem 0;">${name} = ${valStr}</div>`;
    });
    html += '</div>';

    watchPanel.innerHTML = html;
  }

  function showBranchBadge(direction) {
    // Find the highlighted line element
    const highlightedLine = initialElements.codeDisplay.querySelector('.highlight');
    if (!highlightedLine) return;

    // Remove any existing badge
    const existingBadge = highlightedLine.querySelector('.branch-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    // Create new badge
    const badge = document.createElement('span');
    badge.className = `branch-badge ${direction ? 'true' : 'false'}`;
    badge.textContent = direction ? 'TRUE' : 'FALSE';

    // Append to highlighted line
    highlightedLine.appendChild(badge);

    // Auto-remove after animation completes
    setTimeout(() => {
      if (badge.parentElement) {
        badge.remove();
      }
    }, 800);
  }

  function showScopeAnimation(type) {
    // Find the highlighted line element
    const highlightedLine = initialElements.codeDisplay.querySelector('.highlight');
    if (!highlightedLine) return;

    // Remove previous scope animation classes
    highlightedLine.classList.remove('scope-enter', 'scope-exit');

    // Add appropriate class
    const className = type === 'enter' ? 'scope-enter' : 'scope-exit';
    highlightedLine.classList.add(className);

    // Auto-remove after animation completes
    setTimeout(() => {
      highlightedLine.classList.remove(className);
    }, 600);
  }

  function showLoopPulse() {
    // Find the highlighted line element
    const highlightedLine = initialElements.codeDisplay.querySelector('.highlight');
    if (!highlightedLine) return;

    // Add pulse class
    highlightedLine.classList.add('loop-pulse');

    // Auto-remove after animation completes
    setTimeout(() => {
      highlightedLine.classList.remove('loop-pulse');
    }, 400);
  }

  function renderTimeline() {
    const container = initialElements.timelineContainer;
    // Optimize: only append new item if possible, but full re-render is safer for now
    // For large history, we might want to window this.

    // Simple approach: append last item
    const index = timelineEvents.length - 1;
    if (index < 0) return;

    const entry = timelineEvents[index];
    const div = document.createElement('div');
    div.textContent = `${index + 1}: ${entry}`;
    div.style.borderBottom = '1px solid #333';
    div.style.padding = '2px 0';
    container.appendChild(div);

    // Auto-scroll
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function formatEvent(event) {
    if (!event) return null;

    switch (event.type) {
      case 'program-start': return 'Started Program';
      case 'enter-statement':
        if (event.nodeType === 'Program') return 'Enter Program';
        return null; // Skip generic statement entry
      case 'exit-statement': return null; // Skip exit statement
      case 'enter-scope': return `Enter Scope #${event.scopeId}`;
      case 'exit-scope': return `Exit Scope #${event.scopeId}`;
      case 'assign': return `Set ${event.name} = ${event.newValue}`;
      case 'eval-literal': return null; // Skip literal evaluation
      case 'eval-identifier': return null; // Skip identifier lookup
      case 'eval-binary': return `Calc ${event.left} ${event.operator} ${event.right} = ${event.value}`;
      case 'branch': return `Branch → ${event.direction ? 'true' : 'false'} (test: ${event.testValue})`;
      case 'halt': return 'Halt';
      case 'error': return `Error: ${event.message}`;
      default: return null; // Filter out unknown/verbose events
    }
  }

  function generateExplanation(event) {
    if (!event) return "Ready to begin execution.";

    switch (event.type) {
      case 'program-start':
        return "We initialize the program execution. A global context is created to store our variables.";

      case 'enter-statement':
        if (event.nodeType === 'Program') return "We enter the main program body to begin processing instructions.";
        if (event.nodeType === 'VariableDeclaration') return "We encounter a variable declaration. We will reserve memory for a new variable.";
        if (event.nodeType === 'IfStatement') return "We reach an 'if' statement. We must evaluate the condition to decide which block to execute.";
        if (event.nodeType === 'WhileStatement') return "We encounter a loop. We will check the condition to see if the loop body should run.";
        return `We are preparing to execute a ${event.nodeType} statement.`;

      case 'assign':
        const val = typeof event.newValue === 'string' ? `"${event.newValue}"` : event.newValue;
        return `We assign a new value to '${event.name}'. It is now updated to ${val}.`;

      case 'eval-binary':
        let opName = event.operator;
        if (event.operator === '+') opName = 'plus';
        if (event.operator === '-') opName = 'minus';
        if (event.operator === '*') opName = 'times';
        if (event.operator === '/') opName = 'divided by';
        if (event.operator === '===') opName = 'equals';
        if (event.operator === '<') opName = 'is less than';
        if (event.operator === '>') opName = 'is greater than';

        return `We compute ${event.left} ${opName} ${event.right}, which equals ${event.value}.`;

      case 'branch':
        const dest = event.direction ? 'execute the main block' : 'take the alternative path';
        return `The condition evaluates to ${event.direction}. Therefore, we ${dest}.`;

      case 'enter-scope':
        return `We enter a new scope (ID: ${event.scopeId}). Variables declared here will be local to this block.`;

      case 'exit-scope':
        return `We exit the current scope (ID: ${event.scopeId}). Any local variables are now discarded.`;

      case 'halt':
        return "Execution is complete. The program has finished running.";

      case 'error':
        return `An error occurred: ${event.message}. Execution cannot continue.`;

      default:
        // Fallback
        if (event.type.startsWith('eval-')) return `We evaluate a ${event.type.replace('eval-', '')} expression.`;
        return `We process a ${event.type} event.`;
    }
  }

  // --- Bootstrap ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
