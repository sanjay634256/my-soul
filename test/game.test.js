'use strict';

/**
 * Tests for the REAL game logic exported by ../game.js.
 * Nothing here re-implements the game — we require the shipped module.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const G = require('../pambu/game.js');

/** Deterministic RNG that walks a fixed list of values, then repeats. */
function seeded(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Run `n` ticks, feeding a direction before each one. */
function run(game, n, dir) {
  const results = [];
  for (let i = 0; i < n; i++) {
    if (dir) G.turn(game, dir);
    results.push(G.tick(game));
    if (game.status !== 'running') break;
  }
  return results;
}

/* ------------------------------------------------------------------ */

test('exports the whole public surface', () => {
  for (const name of [
    'COLS', 'ROWS', 'START_SPEED_MS', 'MIN_SPEED_MS', 'SPEED_STEP_MS',
    'FOODS_PER_LEVEL', 'POINTS_PER_FOOD', 'DIRS', 'OPPOSITE',
    'freeCells', 'spawnFood', 'createGame', 'levelOf', 'turn',
    'start', 'pause', 'resume', 'tick',
  ]) {
    assert.ok(G[name] !== undefined, `missing export: ${name}`);
  }
  assert.equal(G.COLS, 21);
  assert.equal(G.ROWS, 21);
});

test('a new game starts with a length-3 snake, no score, ready status', () => {
  const g = G.createGame(seeded([0.5]));
  assert.equal(g.snake.length, 3);
  assert.equal(g.score, 0);
  assert.equal(g.foods, 0);
  assert.equal(g.status, 'ready');
  assert.equal(g.dir, 'right');
  assert.equal(G.levelOf(g), 1);
  assert.equal(g.speed, G.START_SPEED_MS);
});

test('the snake starts horizontally with the head at the front', () => {
  const g = G.createGame(seeded([0.5]));
  const [head, mid, tail] = g.snake;
  assert.ok(head.x > mid.x && mid.x > tail.x, 'body should trail the head');
  assert.equal(head.y, mid.y);
  assert.equal(mid.y, tail.y);
});

test('food is always placed on a free cell, never on the snake', () => {
  for (const v of [0, 0.1, 0.5, 0.9, 0.999999, 1]) {
    const g = G.createGame(seeded([v]));
    assert.ok(g.food, `rand=${v} produced no food`);
    const onSnake = g.snake.some((c) => c.x === g.food.x && c.y === g.food.y);
    assert.equal(onSnake, false, `rand=${v} spawned food on the snake`);
    assert.ok(g.food.x >= 0 && g.food.x < g.cols, 'food x out of bounds');
    assert.ok(g.food.y >= 0 && g.food.y < g.rows, 'food y out of bounds');
  }
});

test('rand() returning exactly 1.0 cannot index past the free-cell list', () => {
  const g = G.createGame(() => 1);
  assert.ok(g.food);
  assert.ok(g.food.x < g.cols && g.food.y < g.rows);
});

test('tick() is a no-op unless the game is running', () => {
  const g = G.createGame(seeded([0.5]));
  const before = JSON.stringify(g.snake);
  G.tick(g);
  assert.equal(JSON.stringify(g.snake), before);
  assert.equal(g.status, 'ready');

  G.start(g);
  G.pause(g);
  assert.equal(g.status, 'paused');
  G.tick(g);
  assert.equal(g.status, 'paused');
});

test('the snake moves one cell per tick in its facing direction', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  const head = g.snake[0];
  const res = G.tick(g);
  assert.deepEqual(res, { moved: true, ate: false, died: false });
  assert.equal(g.snake[0].x, head.x + 1);
  assert.equal(g.snake[0].y, head.y);
  assert.equal(g.snake.length, 3, 'length is constant when not eating');
});

test('turn() reverses are rejected, other turns are queued', () => {
  const g = G.createGame(seeded([0.5]));
  assert.equal(G.turn(g, 'left'), false, 'reversing into the neck must be refused');
  assert.equal(g.pendingDir, 'right');
  assert.equal(G.turn(g, 'up'), true);
  assert.equal(g.pendingDir, 'up');
  assert.equal(G.turn(g, 'sideways'), false, 'unknown direction must be refused');
});

test('a queued turn takes effect on the next tick', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  G.turn(g, 'up');
  G.tick(g);
  assert.equal(g.dir, 'up');
  assert.equal(g.snake[0].y, Math.floor(G.ROWS / 2) - 1);
});

test('eating food grows the snake, scores points, and respawns food', () => {
  // Force food directly in front of the head.
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  g.food = { x: g.snake[0].x + 1, y: g.snake[0].y };

  const res = G.tick(g);
  assert.equal(res.ate, true);
  assert.equal(g.snake.length, 4);
  assert.equal(g.score, G.POINTS_PER_FOOD);
  assert.equal(g.foods, 1);
  assert.ok(g.food, 'food should respawn immediately');
  const onSnake = g.snake.some((c) => c.x === g.food.x && c.y === g.food.y);
  assert.equal(onSnake, false, 'respawned food must not land on the snake');
});

test('hitting a wall ends the game', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  // Head starts at x=5; the wall is at x=20, so 15 moves reach it.
  const res = run(g, 16, 'right');
  const last = res[res.length - 1];
  assert.equal(last.died, true);
  assert.equal(g.status, 'over');
  assert.ok(g.snake[0].x < g.cols, 'head never leaves the board');
});

test('running into your own body ends the game', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  // Hand-built U-shaped body, so the outcome is fully deterministic.
  g.snake = [
    { x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 },
    { x: 4, y: 8 }, { x: 4, y: 7 }, { x: 4, y: 6 }, { x: 4, y: 5 },
  ];
  g.dir = 'down';
  g.pendingDir = 'down';
  g.food = { x: 0, y: 0 }; // far away, never reached in this tick

  // Head at (5,5) heading down walks straight into the neck at (5,6).
  const res = G.tick(g);
  assert.equal(res.died, true);
  assert.equal(g.status, 'over');
});

test('chasing your own tail is legal — the tail cell vacates this tick', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  // A 2x2 loop: head at (5,10) facing left, tail sitting at (4,10).
  g.snake = [{ x: 5, y: 10 }, { x: 5, y: 11 }, { x: 4, y: 11 }, { x: 4, y: 10 }];
  g.dir = 'left';
  g.pendingDir = 'left';
  g.food = null; // no growth, so the tail always moves out of the way

  const res = G.tick(g);
  assert.equal(res.died, false, 'moving into the vacating tail cell must be safe');
  assert.equal(g.status, 'running');
  assert.equal(g.snake[0].x, 4);
  assert.equal(g.snake[0].y, 10);
  assert.equal(g.snake.length, 4, 'length is unchanged when not eating');
});

test('...but eating in that same cell is fatal, because the tail stays put', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  g.snake = [{ x: 5, y: 10 }, { x: 5, y: 11 }, { x: 4, y: 11 }, { x: 4, y: 10 }];
  g.dir = 'left';
  g.pendingDir = 'left';
  g.food = { x: 4, y: 10 }; // food exactly where the tail is

  const res = G.tick(g);
  assert.equal(res.died, true, 'growing into the tail cell must kill the snake');
  assert.equal(g.status, 'over');
});

test('speed ramps up with level and clamps at MIN_SPEED_MS', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);
  assert.equal(g.speed, G.START_SPEED_MS);
  assert.equal(G.levelOf(g), 1);

  // Eat exactly one level's worth of food.
  for (let i = 0; i < G.FOODS_PER_LEVEL; i++) {
    g.food = { x: g.snake[0].x + 1, y: g.snake[0].y };
    assert.equal(G.tick(g).ate, true, `food ${i + 1} should be eaten`);
  }
  assert.equal(g.foods, G.FOODS_PER_LEVEL);
  assert.equal(G.levelOf(g), 2);
  assert.equal(g.speed, G.START_SPEED_MS - G.SPEED_STEP_MS);
  assert.ok(g.speed < G.START_SPEED_MS, 'the game must get faster');

  // Blow far past the ramp — the floor must hold.
  g.foods = 500;
  g.food = { x: g.snake[0].x + 1, y: g.snake[0].y };
  G.tick(g);
  assert.equal(g.speed, G.MIN_SPEED_MS);
});

test('start/pause/resume respect the status machine', () => {
  const g = G.createGame(seeded([0.5]));
  assert.equal(G.pause(g), false, 'cannot pause a game that has not started');
  assert.equal(G.resume(g), false, 'cannot resume a game that is not paused');

  assert.equal(G.start(g), true);
  assert.equal(g.status, 'running');
  assert.equal(G.pause(g), true);
  assert.equal(G.resume(g), true);

  g.status = 'over';
  assert.equal(G.start(g), false, 'a finished game must be reset, not restarted in place');
});

test('every board cell is accounted for by freeCells + snake', () => {
  const g = G.createGame(seeded([0.5]));
  assert.equal(G.freeCells(g).length, g.cols * g.rows - g.snake.length);
});

test('filling the board is a win, not a crash', () => {
  const g = G.createGame(seeded([0.5]));
  G.start(g);

  // Every cell except one, in row-major order.
  const all = [];
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) all.push({ x, y });
  }
  g.snake = all.slice(0, all.length - 1);
  assert.equal(G.freeCells(g).length, 1);

  const last = G.spawnFood(g);
  assert.ok(last, 'one free cell left should still hold food');
  assert.deepEqual(last, { x: g.cols - 1, y: g.rows - 1 });

  // Take the final cell — the board is now full.
  g.snake.unshift(last);
  assert.equal(G.freeCells(g).length, 0);
  assert.equal(G.spawnFood(g), null);
  assert.equal(g.status, 'won');
});
