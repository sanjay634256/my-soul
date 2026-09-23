'use strict';

/**
 * Mobile / hostile-environment suite.
 *
 * Covers the things that only break on a phone:
 *   - iOS Safari private mode throws on every localStorage access
 *   - iOS starts an AudioContext suspended until it is resumed inside a
 *     user gesture, otherwise the game is silently mute
 *   - swipe steering, and the rule that a short swipe must NOT pause a
 *     live run (sub-threshold flicks are common on touchscreens)
 *
 * Runs in its own process with a throwing localStorage + working
 * AudioContext stub.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { installDom } = require('./helpers/dom');

const dom = installDom({ audioContext: true, localStorageThrows: true });

// Node collects the tests before running them, so the game has to be booted
// at module scope — not inside the first test.
let bootError = null;
try {
  dom.loadGame();
} catch (err) {
  bootError = err;
}

const PAMBU = globalThis.window.PAMBU;
const el = dom.elements;

test('booting survives localStorage throwing on every access (iOS private mode)', () => {
  assert.equal(bootError, null, `game.js crashed at boot: ${bootError && bootError.message}`);
  assert.equal(PAMBU.state.status, 'ready');
  assert.equal(el.best.textContent, 0, 'best should fall back to 0');
  assert.ok(dom.storageOps > 0, 'the game should have tried to read storage');
});

test('a tap on the board starts the run', () => {
  dom.tap({ x: 100, y: 100 });
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(el.overlay.hidden, true);
});

test('a user gesture resumes a suspended AudioContext so sound works on iOS', () => {
  assert.ok(dom.audioCtorCalls > 0, 'an AudioContext should have been created');
  assert.ok(dom.audioResumeCalls > 0, 'resume() must be called inside the gesture');
});

test('every input path unlocks audio, not just the first one', () => {
  const ctx = dom.audioContexts[0];
  const paths = [
    ['D-pad button', () => dom.pointerDown('btn-up')],
    ['keyboard', () => dom.key('ArrowLeft')],
    // click twice: pause then resume, so later tests start from 'running'
    ['pause button', () => { dom.click('pause-btn'); dom.click('pause-btn'); }],
    ['board tap', () => dom.tap({ x: 5, y: 5 })],
  ];
  for (const [label, gesture] of paths) {
    ctx.state = 'suspended'; // iOS re-suspends when the page is backgrounded
    const before = dom.audioResumeCalls;
    gesture();
    assert.ok(
      dom.audioResumeCalls > before,
      `${label} did not resume the AudioContext`,
    );
  }
});

test('swiping on the stage steers the snake', () => {
  // Pin the board to a known shape so the assertions are deterministic
  // instead of depending on where the random food landed.
  PAMBU.state.snake = [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }];
  PAMBU.state.food = null;
  PAMBU.state.dir = 'right';
  PAMBU.state.pendingDir = 'right';

  dom.swipe({ x: 0, y: 0 }, { x: 0, y: 120 }); // down flick
  assert.equal(PAMBU.state.pendingDir, 'down');
  dom.frames(1);
  assert.equal(PAMBU.state.dir, 'down');

  dom.swipe({ x: 200, y: 0 }, { x: 20, y: 0 }); // left flick
  assert.equal(PAMBU.state.pendingDir, 'left');
  dom.frames(1);
  assert.equal(PAMBU.state.dir, 'left');

  dom.swipe({ x: 0, y: 200 }, { x: 0, y: 40 }); // up flick
  assert.equal(PAMBU.state.pendingDir, 'up');
  dom.frames(1);
  assert.equal(PAMBU.state.dir, 'up');

  dom.swipe({ x: 0, y: 0 }, { x: 160, y: 0 }); // right flick
  assert.equal(PAMBU.state.pendingDir, 'right');
});

test('diagonal swipes resolve to the dominant axis', () => {
  dom.frames(1);
  dom.swipe({ x: 0, y: 0 }, { x: 90, y: 30 }); // mostly horizontal
  assert.equal(PAMBU.state.pendingDir, 'right');
  dom.swipe({ x: 0, y: 0 }, { x: 20, y: 90 }); // mostly vertical
  assert.equal(PAMBU.state.pendingDir, 'down');
});

test('a short swipe mid-run does NOT pause the game', () => {
  dom.frames(1);
  assert.equal(PAMBU.state.status, 'running');
  for (const jitter of [[5, 5], [-10, 8], [23, 0], [0, -23]]) {
    dom.swipe({ x: 100, y: 100 }, { x: 100 + jitter[0], y: 100 + jitter[1] });
    assert.equal(
      PAMBU.state.status,
      'running',
      `a ${jitter}px flick must not pause a live run`,
    );
    assert.equal(el.overlay.hidden, true);
  }
});

test('the pause button pauses and resumes, and its icon follows the state', () => {
  dom.click('pause-btn');
  assert.equal(PAMBU.state.status, 'paused');
  assert.equal(el['pause-btn'].textContent, '▶');
  assert.equal(el.overlay.hidden, false);
  assert.match(el['overlay-hint'].textContent, /▶/);

  dom.click('pause-btn');
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(el['pause-btn'].textContent, '⏸');
  assert.equal(el.overlay.hidden, true);
});

test('long-press cannot open the native callout menu', () => {
  let prevented = 0;
  const stop = { preventDefault: () => { prevented++; } };
  for (const id of ['stage', 'btn-up', 'btn-down', 'btn-left', 'btn-right']) {
    (el[id].listeners.contextmenu || []).forEach((fn) => fn(stop));
  }
  assert.equal(prevented, 5, 'stage + all four D-pad buttons should block contextmenu');
});

test('muting with storage disabled must not throw', () => {
  assert.doesNotThrow(() => dom.click('sound-btn'));
  assert.equal(el['sound-btn'].textContent, '🔇');
  assert.doesNotThrow(() => dom.click('sound-btn'));
  assert.equal(el['sound-btn'].textContent, '🔊');
});

test('dying with storage disabled still shows the overlay and keeps the score in memory', () => {
  PAMBU.state.score = 0;
  for (let i = 0; i < 3; i++) {
    const d = PAMBU.logic.DIRS[PAMBU.state.dir];
    PAMBU.state.food = {
      x: PAMBU.state.snake[0].x + d.x,
      y: PAMBU.state.snake[0].y + d.y,
    };
    dom.frames(1);
    assert.equal(PAMBU.state.status, 'running', `died early while eating orb ${i + 1}`);
  }
  assert.equal(PAMBU.state.score, 30);

  PAMBU.state.food = null;
  assert.doesNotThrow(() => {
    for (let i = 0; i < 60 && PAMBU.state.status === 'running'; i++) dom.frames(1);
  }, 'gameOver() must survive a throwing localStorage.setItem');

  assert.equal(PAMBU.state.status, 'over');
  assert.equal(el['overlay-title'].textContent, '💀 Game Over');
  assert.match(el['overlay-body'].textContent, /30/, 'score should still be displayed');
});

test('a tap after game over starts a fresh run', () => {
  dom.tap({ x: 100, y: 100 });
  assert.equal(PAMBU.state.status, 'running');
  assert.equal(PAMBU.state.score, 0);
  assert.equal(PAMBU.state.snake.length, 3);
});
