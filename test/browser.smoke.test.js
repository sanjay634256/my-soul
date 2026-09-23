'use strict';

/**
 * Browser-layer smoke test.
 *
 * game.js has two halves: pure logic (covered by game.test.js) and the
 * canvas/input/audio layer that only runs when `window` exists. This file
 * installs a minimal DOM stub, then loads the REAL module and drives it
 * through boot -> start -> steer -> eat -> die, asserting on the actual
 * HUD elements the page would display.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/* ----------------------------- DOM stub -------------------------------- */

function makeCtx() {
  const log = [];
  const noop = (name) => () => log.push(name);
  const ctx = {
    __log: log,
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    shadowColor: '', shadowBlur: 0, globalAlpha: 1,
    font: '', textAlign: '',
  };
  for (const m of [
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath',
    'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'arcTo',
    'save', 'restore', 'setTransform', 'translate', 'scale', 'drawImage',
  ]) {
    ctx[m] = noop(m);
  }
  return ctx;
}

const ctxStub = makeCtx();
const elements = {};
const windowListeners = {};
let rafQueue = [];

function el(id) {
  return {
    id,
    textContent: '',
    hidden: false,
    style: {},
    dataset: {},
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    },
    setAttribute(k, v) { this['attr:' + k] = v; },
    getAttribute(k) { return this['attr:' + k]; },
    getContext: () => ctxStub,
    parentElement: { clientWidth: 600, clientHeight: 600 },
    clientWidth: 600,
    clientHeight: 600,
  };
}

const store = {};

// Virtual clock, started safely ahead of game.js's own `performance.now()`
// baseline so every frame is guaranteed to be past the tick threshold.
let clock = performance.now() + 5000;

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, fn) {
    (windowListeners[type] || (windowListeners[type] = [])).push(fn);
  },
  // No AudioContext on purpose: beep() must swallow the failure.
  AudioContext: undefined,
  webkitAudioContext: undefined,
};

globalThis.document = {
  getElementById: (id) => elements[id] || (elements[id] = el(id)),
  querySelectorAll: (sel) =>
    sel === '[data-dir]'
      ? ['up', 'left', 'down', 'right'].map((d) => {
          const b = el('btn-' + d);
          b.dataset.dir = d;
          elements['btn-' + d] = b; // register so the test can dispatch to it
          return b;
        })
      : [],
};

globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

globalThis.requestAnimationFrame = (fn) => {
  rafQueue.push(fn);
  return rafQueue.length;
};

/* --------------------------- load the game ------------------------------ */

delete require.cache[require.resolve('../game.js')];
require('../game.js');

const PAMBU = globalThis.window.PAMBU;

/* ----------------------------- helpers ---------------------------------- */

function key(k, code) {
  (windowListeners.keydown || []).forEach((fn) =>
    fn({ key: k, code: code || '', preventDefault() {} }),
  );
}

function pointerDown(id) {
  const btn = elements[id];
  (btn.listeners.pointerdown || []).forEach((fn) => fn({ preventDefault() {} }));
}

/** Run n animation frames, advancing the virtual clock past one tick each time. */
function frames(n, dt) {
  const step = dt === undefined ? 200 : dt;
  for (let i = 0; i < n; i++) {
    const fn = rafQueue.shift();
    if (!fn) throw new Error('frame did not re-register with requestAnimationFrame');
    clock += step;
    fn(clock);
  }
  return clock;
}

/* ------------------------------ tests ----------------------------------- */

test('the browser layer boots and exposes a debug handle', () => {
  assert.ok(PAMBU, 'window.PAMBU should exist');
  assert.equal(PAMBU.state.status, 'ready');
  assert.equal(elements.score.textContent, 0);
  assert.equal(elements.length.textContent, 3);
  assert.equal(elements.level.textContent, 1);
  assert.equal(elements['overlay-title'].textContent, 'பாம்பு');
  assert.equal(elements.overlay.hidden, false, 'start overlay should be visible');
});

test('the render loop draws the board, food and snake every frame', () => {
  ctxStub.__log.length = 0;
  frames(1);
  for (const op of ['clearRect', 'fillRect', 'beginPath', 'arc', 'fill', 'save', 'restore']) {
    assert.ok(ctxStub.__log.includes(op), `expected canvas op "${op}" to be called`);
  }
});

test('Space starts the game and hides the overlay', () => {
  key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(elements.overlay.hidden, true);
});

test('arrow keys steer the snake on the next frame', () => {
  const headBefore = { ...PAMBU.state.snake[0] };
  key('ArrowUp');
  assert.equal(PAMBU.state.pendingDir, 'up');
  frames(1);
  assert.equal(PAMBU.state.dir, 'up');
  assert.equal(PAMBU.state.snake[0].y, headBefore.y - 1);
  assert.equal(PAMBU.state.snake[0].x, headBefore.x);
});

test('WASD and the on-screen D-pad also steer', () => {
  key('a');
  assert.equal(PAMBU.state.pendingDir, 'left');
  pointerDown('btn-right');
  assert.equal(PAMBU.state.pendingDir, 'right');
});

test('a rejected 180° turn never reaches the state', () => {
  frames(1); // commit pendingDir
  const dir = PAMBU.state.dir;
  const opposite = PAMBU.logic.OPPOSITE[dir];
  key({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[opposite]);
  assert.notEqual(PAMBU.state.pendingDir, opposite);
  assert.equal(PAMBU.state.pendingDir, dir);
});

test('eating food updates the score HUD and the length readout', () => {
  const g = PAMBU.state;
  const d = PAMBU.logic.DIRS[g.dir];
  const scoreBefore = g.score;
  const lenBefore = g.snake.length;

  g.food = { x: g.snake[0].x + d.x, y: g.snake[0].y + d.y };
  frames(1);

  assert.equal(g.score, scoreBefore + 10);
  assert.equal(g.snake.length, lenBefore + 1);
  assert.equal(Number(elements.score.textContent), scoreBefore + 10);
  assert.equal(Number(elements.length.textContent), lenBefore + 1);
  assert.ok(g.food, 'food should respawn');
});

test('Space mid-run pauses, and Space again resumes', () => {
  key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'paused');
  assert.equal(elements.overlay.hidden, false);
  assert.match(elements['overlay-title'].textContent, /Paused/);

  key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(elements.overlay.hidden, true);
});

test('R restarts from a clean board', () => {
  PAMBU.state.score = 123; // make the run look dirty
  key('r');
  assert.equal(PAMBU.state.score, 0);
  assert.equal(PAMBU.state.snake.length, 3);
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(Number(elements.score.textContent), 0);
});

test('the mute button toggles and persists to localStorage', () => {
  const before = elements['sound-btn'].textContent;
  (elements['sound-btn'].listeners.click || []).forEach((fn) => fn({}));
  assert.notEqual(elements['sound-btn'].textContent, before);
  assert.ok('pambu.muted' in store, 'mute state should persist');
  (elements['sound-btn'].listeners.click || []).forEach((fn) => fn({}));
  assert.equal(elements['sound-btn'].textContent, before);
});

test('running into a wall shows the game-over overlay and saves the best score', () => {
  // Eat a few orbs first so there is a score worth saving.
  for (let i = 0; i < 3; i++) {
    const d = PAMBU.logic.DIRS[PAMBU.state.dir];
    PAMBU.state.food = {
      x: PAMBU.state.snake[0].x + d.x,
      y: PAMBU.state.snake[0].y + d.y,
    };
    frames(1);
    assert.equal(PAMBU.state.status, 'running', `run died early while eating orb ${i + 1}`);
  }
  assert.equal(PAMBU.state.score, 30);
  assert.ok(PAMBU.state.score > 0, 'need a non-zero score to exercise the best-score save');

  // Now let it run straight into a wall.
  PAMBU.state.food = null; // no growth, keep the run predictable
  for (let i = 0; i < 60 && PAMBU.state.status === 'running'; i++) {
    frames(1);
  }

  assert.equal(PAMBU.state.status, 'over');
  assert.equal(elements['overlay-title'].textContent, '💀 Game Over');
  assert.match(elements['overlay-body'].textContent, /Best/);
  assert.ok('pambu.best' in store, 'best score should be written to localStorage');
  assert.equal(Number(store['pambu.best']), PAMBU.state.score);
});

test('Space after game over starts a fresh run', () => {
  key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(PAMBU.state.snake.length, 3);
  assert.equal(PAMBU.state.score, 0);
  assert.equal(elements.overlay.hidden, true);
});
