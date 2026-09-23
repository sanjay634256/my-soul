'use strict';

/**
 * Browser-layer smoke test — desktop path.
 *
 * game.js has two halves: pure logic (covered by game.test.js) and the
 * canvas/input layer that only runs when `window` exists. This suite stubs
 * the DOM, loads the REAL module, and drives it through
 * boot -> start -> steer -> eat -> pause -> restart -> die, asserting on the
 * actual HUD elements the page would display.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { installDom } = require('./helpers/dom');

const dom = installDom({ audioContext: false, localStorageThrows: false });
const PAMBU = dom.loadGame();
const el = dom.elements;

const ARROW = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

test('the browser layer boots and exposes a debug handle', () => {
  assert.ok(PAMBU, 'window.PAMBU should exist');
  assert.equal(PAMBU.state.status, 'ready');
  assert.equal(el.score.textContent, 0);
  assert.equal(el.length.textContent, 3);
  assert.equal(el.level.textContent, 1);
  assert.equal(el['overlay-title'].textContent, 'பாம்பு');
  assert.equal(el.overlay.hidden, false, 'start overlay should be visible');
  assert.equal(el['pause-btn'].textContent, '⏸');
});

test('the render loop draws the board, food and snake every frame', () => {
  dom.ctxLog.length = 0;
  dom.frames(1);
  for (const op of ['clearRect', 'fillRect', 'beginPath', 'arc', 'fill', 'save', 'restore']) {
    assert.ok(dom.ctxLog.includes(op), `expected canvas op "${op}" to be called`);
  }
});

test('Space starts the game and hides the overlay', () => {
  dom.key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(el.overlay.hidden, true);
});

test('arrow keys steer the snake on the next frame', () => {
  const headBefore = { ...PAMBU.state.snake[0] };
  dom.key('ArrowUp');
  assert.equal(PAMBU.state.pendingDir, 'up');
  dom.frames(1);
  assert.equal(PAMBU.state.dir, 'up');
  assert.equal(PAMBU.state.snake[0].y, headBefore.y - 1);
  assert.equal(PAMBU.state.snake[0].x, headBefore.x);
});

test('WASD and the on-screen D-pad also steer', () => {
  dom.key('a');
  assert.equal(PAMBU.state.pendingDir, 'left');
  dom.pointerDown('btn-right');
  assert.equal(PAMBU.state.pendingDir, 'right');
});

test('a rejected 180° turn never reaches the state', () => {
  dom.frames(1); // commit pendingDir
  const dir = PAMBU.state.dir;
  dom.key(ARROW[PAMBU.logic.OPPOSITE[dir]]);
  assert.notEqual(PAMBU.state.pendingDir, PAMBU.logic.OPPOSITE[dir]);
  assert.equal(PAMBU.state.pendingDir, dir);
});

test('eating food updates the score HUD and the length readout', () => {
  const g = PAMBU.state;
  const d = PAMBU.logic.DIRS[g.dir];
  const scoreBefore = g.score;
  const lenBefore = g.snake.length;

  g.food = { x: g.snake[0].x + d.x, y: g.snake[0].y + d.y };
  dom.frames(1);

  assert.equal(g.score, scoreBefore + 10);
  assert.equal(g.snake.length, lenBefore + 1);
  assert.equal(Number(el.score.textContent), scoreBefore + 10);
  assert.equal(Number(el.length.textContent), lenBefore + 1);
  assert.ok(g.food, 'food should respawn');
});

test('Space mid-run pauses, and Space again resumes', () => {
  dom.key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'paused');
  assert.equal(el.overlay.hidden, false);
  assert.match(el['overlay-title'].textContent, /Paused/);
  assert.equal(el['pause-btn'].textContent, '▶', 'pause button should flip to a play icon');

  dom.key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(el.overlay.hidden, true);
  assert.equal(el['pause-btn'].textContent, '⏸');
});

test('R restarts from a clean board', () => {
  PAMBU.state.score = 123; // make the run look dirty
  dom.key('r');
  assert.equal(PAMBU.state.score, 0);
  assert.equal(PAMBU.state.snake.length, 3);
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(Number(el.score.textContent), 0);
});

test('the mute button toggles and persists to localStorage', () => {
  const before = el['sound-btn'].textContent;
  dom.click('sound-btn');
  assert.notEqual(el['sound-btn'].textContent, before);
  assert.ok('pambu.muted' in dom.store, 'mute state should persist');
  dom.click('sound-btn');
  assert.equal(el['sound-btn'].textContent, before);
});

test('running into a wall shows the game-over overlay and saves the best score', () => {
  // Eat a few orbs first so there is a score worth saving.
  for (let i = 0; i < 3; i++) {
    const d = PAMBU.logic.DIRS[PAMBU.state.dir];
    PAMBU.state.food = {
      x: PAMBU.state.snake[0].x + d.x,
      y: PAMBU.state.snake[0].y + d.y,
    };
    dom.frames(1);
    assert.equal(PAMBU.state.status, 'running', `run died early while eating orb ${i + 1}`);
  }
  assert.equal(PAMBU.state.score, 30);

  // Now let it run straight into a wall.
  PAMBU.state.food = null; // no growth, keep the run predictable
  for (let i = 0; i < 60 && PAMBU.state.status === 'running'; i++) dom.frames(1);

  assert.equal(PAMBU.state.status, 'over');
  assert.equal(el['overlay-title'].textContent, '💀 Game Over');
  assert.match(el['overlay-body'].textContent, /Best/);
  assert.ok('pambu.best' in dom.store, 'best score should be written to localStorage');
  assert.equal(Number(dom.store['pambu.best']), PAMBU.state.score);
});

test('Space after game over starts a fresh run', () => {
  dom.key(' ', 'Space');
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(PAMBU.state.snake.length, 3);
  assert.equal(PAMBU.state.score, 0);
  assert.equal(el.overlay.hidden, true);
});
