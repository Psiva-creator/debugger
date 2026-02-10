// Lightweight, safe parser for a minimal imperative subset (MVP)
// Exports: parse(source, options) -> { ast, errors, warnings, stats }
// Pure parsing only: no execution, no host access, deterministic.

(function () {
  'use strict';

  let NODE_ID = 1;

  function nextId() {
    return NODE_ID++;
  }

  // --- Utilities ---
  function createLoc(src, startIdx, endIdx) {
    const lines = src.slice(0, startIdx).split(/\r?\n/);
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    const endLines = src.slice(0, endIdx).split(/\r?\n/);
    const endLine = endLines.length;
    const endCol = endLines[endLines.length - 1].length + 1;
    return { start: { line, column: col }, end: { line: endLine, column: endCol } };
  }

  function makeNode(type, props) {
    return Object.assign({ type, id: nextId() }, props);
  }

  // --- Tokenizer ---
  const KEYWORDS = new Set(['let', 'const', 'if', 'else', 'while', 'for', 'true', 'false', 'null']);

  function tokenize(src, opts) {
    const maxFileSize = (opts && opts.maxFileSize) || 20000;
    if (src.length > maxFileSize) {
      return { tokens: [], errors: [{ message: 'File too large', severity: 'error' }], stats: { size: src.length } };
    }

    const tokens = [];
    const errors = [];
    const warnings = [];
    let i = 0;
    const len = src.length;

    function isWhitespace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'; }
    function isDigit(ch) { return /[0-9]/.test(ch); }
    function isIdentStart(ch) { return /[A-Za-z_]/.test(ch); }
    function isIdentPart(ch) { return /[A-Za-z0-9_]/.test(ch); }

    while (i < len) {
      const start = i;
      const ch = src[i];
      // skip whitespace
      if (isWhitespace(ch)) { i++; continue; }

      // comments
      if (ch === '/' && src[i + 1] === '/') {
        i += 2;
        while (i < len && src[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; // skip closing
        continue;
      }

      // numbers
      if (isDigit(ch)) {
        let s = ch; i++;
        while (i < len && (isDigit(src[i]) || src[i] === '.')) { s += src[i++]; }
        tokens.push({ type: 'Number', value: s, start, end: i });
        continue;
      }

      // identifiers / keywords
      if (isIdentStart(ch)) {
        let s = ch; i++;
        while (i < len && isIdentPart(src[i])) s += src[i++];
        tokens.push({ type: KEYWORDS.has(s) ? 'Keyword' : 'Identifier', value: s, start, end: i });
        continue;
      }

      // strings (single or double)
      if (ch === '"' || ch === "'") {
        const quote = ch; i++; let s = '';
        while (i < len && src[i] !== quote) {
          if (src[i] === '\\' && i + 1 < len) { s += src[i] + src[i + 1]; i += 2; }
          else { s += src[i++]; }
        }
        i++; // skip close (if present)
        tokens.push({ type: 'String', value: s, start, end: i });
        continue;
      }

      // operators and punctuation (two-char then one-char)
      const two = src.substr(i, 2);
      const twoOps = new Set(['==', '!=', '>=', '<=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=']);
      if (twoOps.has(two)) { tokens.push({ type: 'Punct', value: two, start, end: i + 2 }); i += 2; continue; }

      const one = ch;
      const oneTokens = new Set(['+', '-', '*', '/', '%', '(', ')', '{', '}', '[', ']', ';', ',', '<', '>', '=', '!']);
      if (oneTokens.has(one)) { tokens.push({ type: 'Punct', value: one, start, end: i + 1 }); i++; continue; }

      // unknown
      errors.push({ message: 'Unknown token: ' + ch, severity: 'error', start, end: i + 1 });
      i++;
    }

    return { tokens, errors, warnings, stats: { size: src.length, tokens: tokens.length } };
  }

  // --- Parser (recursive-descent) ---
  function Parser(tokens, src, opts) {
    this.tokens = tokens;
    this.i = 0;
    this.src = src;
    this.errors = [];
    this.warnings = [];
    this.opts = opts || {};
    this.depth = 0;
    this.maxDepth = (opts && opts.maxDepth) || 200;
  }

  Parser.prototype.peek = function (n) { return this.tokens[this.i + (n || 0)]; };
  Parser.prototype.next = function () { return this.tokens[this.i++]; };
  Parser.prototype.eof = function () { return this.i >= this.tokens.length; };

  Parser.prototype.expectPunct = function (val) {
    const t = this.peek();
    if (t && t.type === 'Punct' && t.value === val) { return this.next(); }
    this.errors.push({ message: 'Expected "' + val + '"', severity: 'error', at: t ? t.start : null });
    return null;
  };

  Parser.prototype.parseProgram = function () {
    const body = [];
    while (!this.eof()) {
      const stmt = this.parseStatement();
      if (!stmt) break;
      body.push(stmt);
    }
    return makeNode('Program', { body, start: 0, end: this.src.length, loc: createLoc(this.src, 0, this.src.length) });
  };

  Parser.prototype.parseStatement = function () {
    if (this.depth++ > this.maxDepth) { this.errors.push({ message: 'Max parse depth exceeded', severity: 'error' }); return null; }
    const t = this.peek();
    if (!t) return null;

    if (t.type === 'Keyword' && (t.value === 'let' || t.value === 'const')) return this.parseVarDecl();
    if (t.type === 'Keyword' && t.value === 'if') return this.parseIf();
    if (t.type === 'Keyword' && t.value === 'while') return this.parseWhile();
    if (t.type === 'Keyword' && t.value === 'for') return this.parseFor();
    if (t.type === 'Punct' && t.value === '{') return this.parseBlock();

    // expression or assignment followed by semicolon
    const expr = this.parseExpression();
    if (!expr) return null;
    // if expression is assignment (Identifier = ...), wrap as AssignmentStatement
    if (expr.type === 'AssignmentExpression') {
      this.expectPunct(';');
      return makeNode('AssignmentStatement', { expression: expr, start: expr.start, end: expr.end, loc: createLoc(this.src, expr.start, expr.end) });
    }
    this.expectPunct(';');
    return makeNode('ExpressionStatement', { expression: expr, start: expr.start, end: expr.end, loc: createLoc(this.src, expr.start, expr.end) });
  };

  Parser.prototype.parseVarDecl = function () {
    const kw = this.next();
    const kind = kw.value; // let or const
    const idTok = this.next();
    if (!idTok || idTok.type !== 'Identifier') { this.errors.push({ message: 'Expected identifier after ' + kind, severity: 'error' }); return null; }
    const name = idTok.value;
    let init = null;
    const st = idTok.start;
    const t = this.peek();
    if (t && t.type === 'Punct' && t.value === '=') {
      this.next();
      init = this.parseExpression();
    }
    this.expectPunct(';');
    const en = (init && init.end) || idTok.end;
    return makeNode('VariableDeclaration', { kind, declarations: [{ id: makeNode('Identifier', { name, start: idTok.start, end: idTok.end }) , init }], start: st, end: en, loc: createLoc(this.src, st, en) });
  };

  Parser.prototype.parseIf = function () {
    const kw = this.next(); // if
    const st = kw.start;
    this.expectPunct('(');
    const test = this.parseExpression();
    this.expectPunct(')');
    const consequent = this.parseStatement();
    let alternate = null;
    const nxt = this.peek();
    if (nxt && nxt.type === 'Keyword' && nxt.value === 'else') {
      this.next();
      alternate = this.parseStatement();
    }
    const en = (alternate && alternate.end) || (consequent && consequent.end) || st;
    return makeNode('IfStatement', { test, consequent, alternate, start: st, end: en, loc: createLoc(this.src, st, en) });
  };

  Parser.prototype.parseWhile = function () {
    const kw = this.next();
    const st = kw.start;
    this.expectPunct('(');
    const test = this.parseExpression();
    this.expectPunct(')');
    const body = this.parseStatement();
    const en = (body && body.end) || st;
    return makeNode('WhileStatement', { test, body, start: st, end: en, loc: createLoc(this.src, st, en) });
  };

  Parser.prototype.parseFor = function () {
    const kw = this.next();
    const st = kw.start;
    this.expectPunct('(');
    let init = null;
    const p = this.peek();
    if (p && p.type === 'Keyword' && (p.value === 'let' || p.value === 'const')) { init = this.parseVarDecl(); }
    else if (!(p && p.type === 'Punct' && p.value === ';')) { init = this.parseExpression(); this.expectPunct(';'); }
    else { this.expectPunct(';'); }

    const cond = (this.peek() && !(this.peek().type === 'Punct' && this.peek().value === ';')) ? this.parseExpression() : null;
    this.expectPunct(';');
    const update = (this.peek() && !(this.peek().type === 'Punct' && this.peek().value === ')')) ? this.parseExpression() : null;
    this.expectPunct(')');
    const body = this.parseStatement();
    const en = (body && body.end) || st;
    return makeNode('ForStatement', { init, test: cond, update, body, start: st, end: en, loc: createLoc(this.src, st, en) });
  };

  Parser.prototype.parseBlock = function () {
    const open = this.next(); // {
    const st = open.start;
    const body = [];
    while (this.peek() && !(this.peek().type === 'Punct' && this.peek().value === '}')) {
      const s = this.parseStatement();
      if (!s) break;
      body.push(s);
    }
    const close = this.expectPunct('}');
    const en = close ? close.end : st;
    return makeNode('BlockStatement', { body, start: st, end: en, loc: createLoc(this.src, st, en) });
  };

  // --- Expressions (precedence climbing) ---
  const PRECEDENCE = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3, '===': 3, '!==': 3,
    '<': 4, '>': 4, '<=': 4, '>=': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6
  };

  Parser.prototype.parseExpression = function (prec) {
    prec = prec || 0;
    let left = this.parseUnary();
    if (!left) return null;

    while (true) {
      const t = this.peek();
      if (!t || t.type !== 'Punct') break;
      const op = t.value;
      const p = PRECEDENCE[op];
      if (!p || p <= prec) break;
      this.next();
      const right = this.parseExpression(p);
      const start = left.start || (left.loc && left.loc.start) || t.start;
      const end = right.end || (right.loc && right.loc.end) || t.end;
      left = makeNode('BinaryExpression', { operator: op, left, right, start, end, loc: createLoc(this.src, start, end) });
    }
    return left;
  };

  Parser.prototype.parseUnary = function () {
    const t = this.peek();
    if (!t) return null;
    if (t.type === 'Punct' && (t.value === '!' || t.value === '-' || t.value === '+')) {
      this.next();
      const arg = this.parseUnary();
      const st = t.start; const en = (arg && arg.end) || t.end;
      return makeNode('UnaryExpression', { operator: t.value, argument: arg, start: st, end: en, loc: createLoc(this.src, st, en) });
    }
    return this.parsePrimary();
  };

  Parser.prototype.parsePrimary = function () {
    const t = this.peek();
    if (!t) return null;
    if (t.type === 'Number') { this.next(); return makeNode('Literal', { value: Number(t.value), raw: t.value, start: t.start, end: t.end, loc: createLoc(this.src, t.start, t.end) }); }
    if (t.type === 'String') { this.next(); return makeNode('Literal', { value: t.value, raw: '"' + t.value + '"', start: t.start, end: t.end, loc: createLoc(this.src, t.start, t.end) }); }
    if (t.type === 'Keyword' && (t.value === 'true' || t.value === 'false' || t.value === 'null')) { this.next(); return makeNode('Literal', { value: t.value === 'true' ? true : (t.value === 'false' ? false : null), raw: t.value, start: t.start, end: t.end, loc: createLoc(this.src, t.start, t.end) }); }
    if (t.type === 'Identifier') {
      const id = this.next();
      const nxt = this.peek();
      // assignment: identifier = expr
      if (nxt && nxt.type === 'Punct' && nxt.value === '=') {
        this.next();
        const rhs = this.parseExpression();
        const start = id.start; const end = rhs.end || id.end;
        return makeNode('AssignmentExpression', { operator: '=', left: makeNode('Identifier', { name: id.value, start: id.start, end: id.end }), right: rhs, start, end, loc: createLoc(this.src, start, end) });
      }
      return makeNode('Identifier', { name: id.value, start: id.start, end: id.end, loc: createLoc(this.src, id.start, id.end) });
    }
    if (t.type === 'Punct' && t.value === '(') {
      this.next();
      const expr = this.parseExpression();
      this.expectPunct(')');
      return expr;
    }
    this.errors.push({ message: 'Unexpected token in expression', severity: 'error', at: t.start });
    this.next();
    return null;
  };

  // --- Public API ---
  function parse(source, options) {
    NODE_ID = 1; // reset ids for determinism per parse
    const opts = options || {};
    const tokRes = tokenize(source, opts);
    const parser = new Parser(tokRes.tokens, source, opts);
    const ast = parser.parseProgram();
    const errors = (tokRes.errors || []).concat(parser.errors || []);
    const warnings = (tokRes.warnings || []).concat(parser.warnings || []);
    const stats = Object.assign({}, tokRes.stats, { nodes: NODE_ID - 1 });
    return { ast, errors, warnings, stats };
  }

  // Export for common environments
  if (typeof module !== 'undefined' && module.exports) module.exports = { parse };
  else if (typeof window !== 'undefined') window.Parser = { parse };
  else if (typeof self !== 'undefined') self.Parser = { parse };

})();
