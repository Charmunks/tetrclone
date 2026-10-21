'use strict';

// ---------- constants ----------
const COLS = 10, ROWS = 40, VIS = 20, CELL = 30;
const COLORS = { I: '#42afe1', J: '#3b6fd8', L: '#f38927', O: '#f6d03c', S: '#51b84d', T: '#b94bc6', Z: '#eb4f65' };
const BASE = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};
const BOX = { I: 4, O: 4, J: 3, L: 3, S: 3, T: 3, Z: 3 };
const ROT = {};
for (const t in BASE) {
  let c = BASE[t];
  ROT[t] = [c];
  for (let i = 1; i < 4; i++) {
    if (t !== 'O') c = c.map(([x, y]) => [BOX[t] - 1 - y, x]);
    ROT[t].push(c);
  }
}

// SRS kick tables, [dx, dy] with y pointing up. Keys are "from"+"to" rotation states.
const KICKS = {
  JLSTZ: {
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  },
  I: {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  },
  R180: {
    '02': [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]],
    '20': [[0, 0], [0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]],
    '13': [[0, 0], [1, 0], [1, 2], [1, 1], [0, 2], [0, 1]],
    '31': [[0, 0], [-1, 0], [-1, 2], [-1, 1], [0, 2], [0, 1]],
  },
};

// ---------- settings ----------
const ACTIONS = [
  ['left', 'Move left'], ['right', 'Move right'], ['softDrop', 'Soft drop'], ['hardDrop', 'Hard drop'],
  ['cw', 'Rotate CW'], ['ccw', 'Rotate CCW'], ['r180', 'Rotate 180'], ['hold', 'Hold'],
];
const DEFAULTS = {
  das: 167, arr: 33, sdf: 6, ghost: true, grid: true, light: false,
  keys: {
    left: ['ArrowLeft'], right: ['ArrowRight'], softDrop: ['ArrowDown'], hardDrop: ['Space'],
    cw: ['ArrowUp', 'KeyX'], ccw: ['KeyZ'], r180: ['KeyA'], hold: ['KeyC', 'ShiftLeft', 'ShiftRight'],
  },
};
let settings = loadSettings();
let gridColor = '#141a26';
let boardBgColor = '#07090d';
function applyTheme() {
  document.documentElement.dataset.theme = settings.light ? 'light' : 'dark';
  const cs = getComputedStyle(document.documentElement);
  gridColor = cs.getPropertyValue('--grid').trim();
  boardBgColor = cs.getPropertyValue('--board').trim();
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('tetrclone.settings'));
    if (s) return { ...structuredClone(DEFAULTS), ...s, keys: { ...DEFAULTS.keys, ...s.keys } };
  } catch (e) {}
  return structuredClone(DEFAULTS);
}
function saveSettings() {
  try { localStorage.setItem('tetrclone.settings', JSON.stringify(settings)); } catch (e) {}
}
function loadPB() {
  try { return JSON.parse(localStorage.getItem('tetrclone.pb')) || {}; } catch (e) { return {}; }
}
function savePB(pb) {
  try { localStorage.setItem('tetrclone.pb', JSON.stringify(pb)); } catch (e) {}
}

// ---------- state ----------
const $ = id => document.getElementById(id);
const boardCtx = $('board').getContext('2d');
const holdCtx = $('hold').getContext('2d');
const nextCtx = $('next').getContext('2d');

const down = new Set();
let G = null;          // current game
let mode = 'sprint';
let state = 'menu';    // menu | countdown | play | over
let flashes = [];
let undoStack = [];

const isDown = a => settings.keys[a].some(k => down.has(k));
const emptyRow = () => new Array(COLS).fill(0);

function newGame(m) {
  mode = m;
  G = {
    board: Array.from({ length: ROWS }, emptyRow),
    queue: [], piece: null, hold: null, holdUsed: false,
    time: 0, score: 0, lines: 0, level: 1, pieces: 0,
    combo: -1, b2b: false,
    gravAcc: 0, lockT: 0, resets: 0, lowest: 0, lastRot: false, kick: 0,
    dasDir: 0, dasTime: 0, arrTime: 0, dasCharged: false,
    cd: 3000,
  };
  flashes = [];
  undoStack = [];
  fillQueue();
  $('action').innerHTML = '';
  $('center').textContent = '';
  $('goalLabel').textContent = mode === 'sprint' ? 'LINES LEFT' : 'LINES';
  showOverlay(null);
  state = 'countdown';
  // keys already held when the round starts count for DAS
  const l = isDown('left'), r = isDown('right');
  if (l || r) { G.dasDir = r && !l ? 1 : -1; G.dasCharged = false; }
  updateHUD();
}

function fillQueue() {
  while (G.queue.length < 14) {
    const bag = [...'IJLOSTZ'];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    G.queue.push(...bag);
  }
}

// ---------- piece helpers ----------
const cellsOf = p => ROT[p.type][p.rot].map(([x, y]) => [p.x + x, p.y + y]);
function collides(p) {
  for (const [x, y] of cellsOf(p)) {
    if (x < 0 || x >= COLS || y >= ROWS || (y >= 0 && G.board[y][x])) return true;
  }
  return false;
}
const grounded = () => collides({ ...G.piece, y: G.piece.y + 1 });

function spawn(type) {
  G.piece = { type, rot: 0, x: 3, y: 19 };
  G.lastRot = false; G.kick = 0; G.lockT = 0; G.resets = 0; G.gravAcc = 0;
  if (collides(G.piece)) { endGame(false); return; }
  G.lowest = G.piece.y;
  if (!grounded()) { G.piece.y++; G.lowest = G.piece.y; }
}

function nextPiece() {
  const t = G.queue.shift();
  fillQueue();
  G.holdUsed = false;
  spawn(t);
}

// a successful move/rotate while on the stack refreshes lock delay (up to 15 times)
function onAdjust() {
  if ((grounded() || G.lockT > 0) && G.resets < 15) { G.lockT = 0; G.resets++; }
}

function tryMove(dx, dy, user) {
  const np = { ...G.piece, x: G.piece.x + dx, y: G.piece.y + dy };
  if (collides(np)) return false;
  G.piece = np;
  G.lastRot = false;
  if (np.y > G.lowest) { G.lowest = np.y; G.resets = 0; G.lockT = 0; }
  if (user) onAdjust();
  return true;
}

function rotate(delta) {
  const p = G.piece;
  if (p.type === 'O') return;
  const to = (p.rot + delta) % 4;
  const table = delta === 2 ? KICKS.R180 : (p.type === 'I' ? KICKS.I : KICKS.JLSTZ);
  const kicks = table['' + p.rot + to];
  for (let i = 0; i < kicks.length; i++) {
    const np = { ...p, rot: to, x: p.x + kicks[i][0], y: p.y - kicks[i][1] };
    if (!collides(np)) {
      G.piece = np; G.lastRot = true; G.kick = i;
      if (np.y > G.lowest) { G.lowest = np.y; G.resets = 0; G.lockT = 0; }
      onAdjust();
      return;
    }
  }
}

function hardDrop() {
  let d = 0;
  while (tryMove(0, 1)) d++;
  G.score += d * 2;
  lock();
}

function doHold() {
  if (G.holdUsed) return;
  const cur = G.piece.type;
  if (G.hold) { const h = G.hold; G.hold = cur; spawn(h); }
  else { G.hold = cur; nextPiece(); }
  G.holdUsed = true;
}

function ghostY() {
  let p = G.piece;
  while (!collides({ ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
  return p.y;
}

// ---------- locking / scoring ----------
function detectSpin(p) {
  const occ = (x, y) => x < 0 || x >= COLS || y >= ROWS || G.board[y][x];
  const c = (dx, dy) => occ(p.x + dx, p.y + dy);
  const corners = { a: c(0, 0), b: c(2, 0), c: c(0, 2), d: c(2, 2) };
  const n = Object.values(corners).filter(Boolean).length;
  if (n < 3) return 'none';
  const front = [['a', 'b'], ['b', 'd'], ['c', 'd'], ['a', 'c']][p.rot];
  const frontFull = corners[front[0]] && corners[front[1]];
  return frontFull || G.kick === 4 ? 'full' : 'mini';
}

const SCORE_NONE = [0, 100, 300, 500, 800];
const SCORE_MINI = [100, 200, 400];
const SCORE_FULL = [400, 800, 1200, 1600];
const LINE_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];

function snapshot() {
  undoStack.push({
    board: G.board.map(r => r.slice()), queue: G.queue.slice(), hold: G.hold, holdUsed: G.holdUsed,
    score: G.score, lines: G.lines, level: G.level, pieces: G.pieces, combo: G.combo, b2b: G.b2b,
    type: G.piece.type,
  });
  if (undoStack.length > 200) undoStack.shift();
}

function undo() {
  if (mode !== 'zen' || !undoStack.length || (state !== 'play' && state !== 'over')) return;
  const { type, ...s } = undoStack.pop();
  Object.assign(G, s);
  flashes = [];
  $('action').innerHTML = '';
  showOverlay(null);
  state = 'play';
  spawn(type);
  updateHUD();
}

function lock() {
  if (mode === 'zen') snapshot();
  const p = G.piece;
  const cells = cellsOf(p);
  const spin = p.type === 'T' && G.lastRot ? detectSpin(p) : 'none';
  for (const [x, y] of cells) G.board[y][x] = p.type;
  G.pieces++;
  const lockOut = cells.every(([, y]) => y < VIS);

  const full = [];
  for (let y = 0; y < ROWS; y++) if (G.board[y].every(Boolean)) full.push(y);
  const n = full.length;

  if (n) {
    for (const y of full) flashes.push({ row: y, t: 0 });
    G.board = G.board.filter((_, i) => !full.includes(i));
    while (G.board.length < ROWS) G.board.unshift(emptyRow());
  }

  const lines = [];
  let pts = 0;
  const difficult = n > 0 && (n === 4 || spin !== 'none');
  if (spin !== 'none') lines.push(`T-SPIN${spin === 'mini' ? ' MINI' : ''}${n ? ' ' + LINE_NAMES[n] : ''}`);
  else if (n) lines.push(LINE_NAMES[n]);

  if (spin === 'full') pts = SCORE_FULL[n];
  else if (spin === 'mini') pts = SCORE_MINI[n];
  else pts = SCORE_NONE[n];
  pts *= G.level;

  if (n) {
    if (difficult && G.b2b) { pts = Math.floor(pts * 1.5); lines.push('BACK-TO-BACK'); }
    G.b2b = difficult ? true : false;
    G.combo++;
    if (G.combo > 0) { pts += 50 * G.combo * G.level; lines.push(`${G.combo} COMBO`); }
  } else {
    G.combo = -1;
  }

  const pc = n > 0 && G.board.every(r => r.every(c => !c));
  if (pc) { pts += 3500 * G.level; lines.push('ALL CLEAR'); }
  G.score += pts;
  G.lines += n;
  if (mode !== 'sprint') G.level = 1 + Math.floor(G.lines / 10);

  if (lines.length) popup(lines);
  G.piece = null;

  if (mode === 'sprint' && G.lines >= 40) { endGame(true); return; }
  if (lockOut && !n) { endGame(false); return; }
  nextPiece();
}

function popup(lines) {
  const el = $('action');
  el.innerHTML = lines.map((l, i) => `<div class="a${Math.min(i + 1, 3)}">${l}</div>`).join('');
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ---------- game flow ----------
function fmtTime(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, f = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

function endGame(win) {
  state = 'over';
  const pb = loadPB();
  let title, body, newPB = false;
  const pps = (G.pieces / (G.time / 1000 || 1)).toFixed(2);
  if (mode === 'sprint') {
    if (win) {
      if (!pb.sprint || G.time < pb.sprint) { pb.sprint = G.time; newPB = true; }
      title = '40 LINES COMPLETE';
      body = `<b>${fmtTime(G.time)}</b><br>${G.pieces} pieces · ${pps} PPS`;
    } else {
      title = 'TOPPED OUT';
      body = `${G.lines} / 40 lines<br>${fmtTime(G.time)}`;
    }
  } else if (mode === 'blitz') {
    if (!pb.blitz || G.score > pb.blitz) { pb.blitz = G.score; newPB = true; }
    title = win ? 'TIME!' : 'TOPPED OUT';
    body = `<b>${G.score.toLocaleString()}</b><br>${G.lines} lines · level ${G.level} · ${pps} PPS`;
  } else {
    title = 'TOPPED OUT';
    body = `<b>${G.score.toLocaleString()}</b><br>${G.lines} lines · level ${G.level}<br>${fmtTime(G.time)}`;
  }
  if (newPB) { body += '<br>NEW PERSONAL BEST!'; savePB(pb); }
  G.piece = null;
  $('resTitle').textContent = title;
  $('resBody').innerHTML = body;
  showOverlay('result');
  updateHUD();
}

function showMenu() {
  state = 'menu';
  $('center').textContent = '';
  const pb = loadPB();
  $('pbs').innerHTML =
    (pb.sprint ? `40 LINES best: ${fmtTime(pb.sprint)}<br>` : '') +
    (pb.blitz ? `BLITZ best: ${pb.blitz.toLocaleString()}` : '');
  showOverlay('menu');
}

function showOverlay(id) {
  for (const o of ['menu', 'result', 'settings']) $(o).classList.toggle('hidden', o !== id);
}

function gravityMs() {
  if (mode === 'sprint' || mode === 'zen') return 1000;
  const L = G.level;
  return Math.max(1, Math.pow(0.8 - (L - 1) * 0.007, L - 1) * 1000);
}

// ---------- input ----------
function actionsFor(code) {
  return ACTIONS.map(a => a[0]).filter(a => settings.keys[a].includes(code));
}

function pressDir(dir) {
  G.dasDir = dir; G.dasTime = 0; G.arrTime = 0; G.dasCharged = false;
  if (state === 'play' && G.piece) tryMove(dir, 0, true);
}

function releaseDir(dir) {
  if (G.dasDir !== dir) return;
  const other = dir === -1 ? isDown('right') : isDown('left');
  if (other) { G.dasDir = -dir; G.dasTime = 0; G.arrTime = 0; G.dasCharged = false; }
  else G.dasDir = 0;
}

let rebinding = null;

addEventListener('keydown', e => {
  if (rebinding) {
    e.preventDefault();
    if (e.code !== 'Escape') {
      settings.keys[rebinding.action] = [e.code];
      saveSettings();
    }
    rebinding = null;
    buildKeyUI();
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
  const acts = actionsFor(e.code);
  if (acts.length || e.code === 'Escape' || e.code === 'KeyR') e.preventDefault();
  if (e.repeat) return;
  down.add(e.code);

  if (e.code === 'Escape') { showMenu(); return; }
  if (e.code === 'KeyR' && state !== 'menu') { newGame(mode); return; }
  if (!G || (state !== 'play' && state !== 'countdown')) return;

  for (const a of acts) {
    if (a === 'left') pressDir(-1);
    else if (a === 'right') pressDir(1);
    else if (state === 'play' && G.piece) {
      if (a === 'cw') rotate(1);
      else if (a === 'ccw') rotate(3);
      else if (a === 'r180') rotate(2);
      else if (a === 'hold') doHold();
      else if (a === 'hardDrop') hardDrop();
    }
    if (state !== 'play') break;
  }
});

addEventListener('keyup', e => {
  down.delete(e.code);
  if (!G) return;
  for (const a of actionsFor(e.code)) {
    if (a === 'left') releaseDir(-1);
    if (a === 'right') releaseDir(1);
  }
});

addEventListener('blur', () => { down.clear(); if (G) G.dasDir = 0; });

// ---------- update ----------
function update(dt) {
  if (state === 'countdown') {
    G.cd -= dt;
    const n = Math.ceil(G.cd / 1000);
    $('center').textContent = G.cd > 0 ? n : '';
    if (G.cd <= 0) { state = 'play'; nextPiece(); }
    return;
  }
  if (state !== 'play' || !G.piece) return;

  G.time += dt;
  if (mode === 'blitz' && G.time >= 120000) { G.time = 120000; endGame(true); return; }

  // DAS / ARR
  if (G.dasDir) {
    G.dasTime += dt;
    if (!G.dasCharged && G.dasTime >= settings.das) { G.dasCharged = true; G.arrTime = settings.arr; }
    if (G.dasCharged) {
      if (settings.arr === 0) { while (tryMove(G.dasDir, 0, true)); }
      else {
        G.arrTime += dt;
        let guard = 0;
        while (G.arrTime >= settings.arr && guard++ < 20) {
          G.arrTime -= settings.arr;
          if (!tryMove(G.dasDir, 0, true)) { G.arrTime = 0; break; }
        }
      }
    }
  }

  // gravity & soft drop
  const sd = isDown('softDrop');
  if (sd && settings.sdf > 40) {
    while (tryMove(0, 1)) G.score++;
  } else {
    const grav = gravityMs();
    const iv = sd ? Math.min(grav, 400) / settings.sdf : grav;
    G.gravAcc += dt;
    let guard = 0;
    while (G.gravAcc >= iv && guard++ < 60) {
      if (tryMove(0, 1)) { G.gravAcc -= iv; if (sd) G.score++; }
      else { G.gravAcc = 0; break; }
    }
  }

  // lock delay
  if (grounded()) {
    G.lockT += dt;
    if (G.lockT >= 500) lock();
  }
  for (const f of flashes) f.t += dt;
  flashes = flashes.filter(f => f.t < 250);
  updateHUD();
}

// ---------- rendering ----------
function drawCell(ctx, x, y, color, size, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.fillRect(x, y, size, 3);
  ctx.fillRect(x, y, 3, size);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(x, y + size - 3, size, 3);
  ctx.fillRect(x + size - 3, y, 3, size);
  ctx.globalAlpha = 1;
}

function render() {
  const c = boardCtx;
  c.clearRect(0, 0, 300, 600);
  c.fillStyle = boardBgColor;
  c.fillRect(0, 0, 300, 600);
  if (settings.grid) {
    c.strokeStyle = gridColor;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < COLS; i++) { c.moveTo(i * CELL + .5, 0); c.lineTo(i * CELL + .5, 600); }
    for (let i = 1; i < VIS; i++) { c.moveTo(0, i * CELL + .5); c.lineTo(300, i * CELL + .5); }
    c.stroke();
  }
  if (!G) return;
  for (let y = VIS; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const v = G.board[y][x];
      if (v) drawCell(c, x * CELL, (y - VIS) * CELL, COLORS[v], CELL);
    }
  if (G.piece && state === 'play') {
    const p = G.piece;
    if (settings.ghost) {
      const gy = ghostY();
      for (const [x, y] of cellsOf({ ...p, y: gy })) if (y >= VIS) drawCell(c, x * CELL, (y - VIS) * CELL, COLORS[p.type], CELL, .28);
    }
    for (const [x, y] of cellsOf(p)) if (y >= VIS) drawCell(c, x * CELL, (y - VIS) * CELL, COLORS[p.type], CELL);
  }
  for (const f of flashes) {
    if (f.row < VIS) continue;
    c.fillStyle = `rgba(255,255,255,${0.7 * (1 - f.t / 250)})`;
    c.fillRect(0, (f.row - VIS) * CELL, 300, CELL);
  }
  drawMini(holdCtx, 120, 90, G.hold ? [G.hold] : [], G.holdUsed);
  drawMini(nextCtx, 120, 330, G.queue.slice(0, 5), false);
}

function drawMini(ctx, w, h, types, dim) {
  ctx.clearRect(0, 0, w, h);
  const s = 22, slot = 66;
  types.forEach((t, i) => {
    const cells = ROT[t][0];
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const ox = (w - (maxX - minX + 1) * s) / 2 - minX * s;
    const oy = i * slot + (slot - (maxY - minY + 1) * s) / 2 - minY * s + (h === 90 ? 12 : 0);
    for (const [x, y] of cells) drawCell(ctx, ox + x * s, oy + y * s, dim ? '#555c6e' : COLORS[t], s);
  });
}

function updateHUD() {
  if (!G) return;
  $('time').textContent = mode === 'blitz' ? fmtTime(Math.max(0, 120000 - G.time)) : fmtTime(G.time);
  $('lines').textContent = mode === 'sprint' ? Math.max(0, 40 - G.lines) : G.lines;
  $('score').textContent = G.score.toLocaleString();
  $('level').textContent = G.level;
  $('pieces').textContent = G.pieces;
  $('pps').textContent = (G.time > 0 ? G.pieces / (G.time / 1000) : 0).toFixed(2);
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(t - last, 100);
  last = t;
  if (G) update(dt);
  render();
  requestAnimationFrame(frame);
}

// ---------- menu / settings UI ----------
document.querySelectorAll('#menu [data-mode]').forEach(b => b.onclick = () => newGame(b.dataset.mode));
$('resRetry').onclick = () => newGame(mode);
$('resMenu').onclick = showMenu;
$('openSettings').onclick = () => { syncSettingsUI(); showOverlay('settings'); };
$('closeSettings').onclick = showMenu;
$('resetSettings').onclick = () => { settings = structuredClone(DEFAULTS); saveSettings(); applyTheme(); syncSettingsUI(); };

function syncSettingsUI() {
  for (const k of ['das', 'arr', 'sdf']) {
    $(k).value = settings[k];
    $(k + 'V').textContent = fmtSetting(k, settings[k]);
  }
  $('ghost').checked = settings.ghost;
  $('grid').checked = settings.grid;
  $('light').checked = settings.light;
  buildKeyUI();
}
function fmtSetting(k, v) {
  if (k === 'sdf') return v > 40 ? 'INF' : v + 'x';
  return v + ' ms';
}
for (const k of ['das', 'arr', 'sdf']) {
  $(k).oninput = () => {
    settings[k] = +$(k).value;
    $(k + 'V').textContent = fmtSetting(k, settings[k]);
    saveSettings();
  };
}
$('ghost').onchange = () => { settings.ghost = $('ghost').checked; saveSettings(); };
$('light').onchange = () => { settings.light = $('light').checked; saveSettings(); applyTheme(); };
$('grid').onchange = () => { settings.grid = $('grid').checked; saveSettings(); };

function prettyKey(code) {
  const m = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift' };
  return m[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
}
function buildKeyUI() {
  const el = $('keys');
  el.innerHTML = '';
  for (const [a, label] of ACTIONS) {
    const span = document.createElement('span');
    span.textContent = label;
    const b = document.createElement('button');
    const names = [...new Set(settings.keys[a].map(prettyKey))];
    b.textContent = rebinding && rebinding.action === a ? 'press a key…' : names.join(' / ');
    if (rebinding && rebinding.action === a) b.classList.add('listening');
    b.onclick = () => { rebinding = { action: a }; buildKeyUI(); };
    el.append(span, b);
  }
}

applyTheme();
showMenu();
requestAnimationFrame(frame);
