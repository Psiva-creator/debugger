// UI Controller for the Code Debugger
// Wires up buttons, manages execution state, updates display
// Assumes parser.js and executor.js are already loaded

(function () {
  'use strict';

  // ============================================================================
  // Debugger UI State
  // ============================================================================
  const debugger = {
    sourceCode: '',
    ast: null,
    executionState: null,
    
    // DOM elements
    codeEditor: null,
    parseBtn: null,
    stepBtn: null,
    runBtn: null,
    resetBtn: null,
    stepsCount: null,
    statusText: null,
    scopeDepth: null,
    
    // Initialize UI
    init: function () {
      this.cacheElements();
      this.attachListeners();
    },
    
    cacheElements: function () {
      this.codeEditor = document.getElementById('codeEditor');
      this.parseBtn = document.getElementById('parseBtn');
      this.stepBtn = document.getElementById('stepBtn');
      this.runBtn = document.getElementById('runBtn');
      this.resetBtn = document.getElementById('resetBtn');
      this.stepsCount = document.getElementById('stepsCount');
      this.statusText = document.getElementById('statusText');
      this.scopeDepth = document.getElementById('scopeDepth');
    },
    
    attachListeners: function () {
      this.parseBtn.addEventListener('click', () => this.handleParse());
      this.stepBtn.addEventListener('click', () => this.handleStep());
      this.runBtn.addEventListener('click', () => this.handleRun());
      this.resetBtn.addEventListener('click', () => this.handleReset());
    },
    
    // ========================================================================
    // Event Handlers
    // ========================================================================
    handleParse: function () {
      const source = this.codeEditor.value.trim();
      if (!source) {
        alert('No code to parse');
        return;
      }
      
      this.sourceCode = source;
      
      // Parse the source code
      try {
        const result = window.Parser.parse(source);
        if (result.error) {
          alert('Parse error: ' + result.error.message);
          return;
        }
        this.ast = result.ast;
        
        // Start execution
        this.executionState = window.Executor.start(this.ast, { maxSteps: 10000 });
        
        // Enable step and run buttons
        this.stepBtn.disabled = false;
        this.runBtn.disabled = false;
        
        this.updateDisplay();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    },
    
    handleStep: function () {
      if (!this.executionState) {
        alert('Parse code first');
        return;
      }
      
      this.executionState.step();
      this.updateDisplay();
      
      // Disable buttons when done
      if (this.executionState.status !== 'running') {
        this.stepBtn.disabled = true;
        this.runBtn.disabled = true;
      }
    },
    
    handleRun: function () {
      if (!this.executionState) {
        alert('Parse code first');
        return;
      }
      
      while (this.executionState.status === 'running') {
        this.executionState.step();
      }
      
      this.updateDisplay();
      this.stepBtn.disabled = true;
      this.runBtn.disabled = true;
    },
    
    handleReset: function () {
      this.sourceCode = '';
      this.ast = null;
      this.executionState = null;
      this.stepBtn.disabled = true;
      this.runBtn.disabled = true;
      this.updateDisplay();
    },
    
    // ========================================================================
    // Display Updates
    // ========================================================================
    updateDisplay: function () {
      if (!this.executionState) {
        this.stepsCount.textContent = '0';
        this.statusText.textContent = 'ready';
        this.scopeDepth.textContent = '0';
        return;
      }
      
      this.stepsCount.textContent = this.executionState.stats.stepsExecuted;
      this.statusText.textContent = this.executionState.status;
      this.scopeDepth.textContent = this.executionState.scopeStack.length;
    }
  };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => debugger.init());
  } else {
    debugger.init();
  }
  
})();
