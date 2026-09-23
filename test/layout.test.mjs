'use strict';

/** Tests for the procedural city generator (js/layout.mjs). */

const test = await import('node:test').then((m) => m.default);
const assert = await import('node:assert/strict');

const L = await import('../js/layout.mjs');
const S = await import('../js/sim.mjs');
const { CFG } = S;

const city = L.generateCity(20260923);
const s = L.stats(city);

test('generates a substantial city', () => {
  assert.ok(s.buildings > 100, `only ${s.buildings} buildings`);
  assert.ok(s.props > 100, `only ${s.props} props`);
  assert.ok(s.spawns > 10, `only ${s.spawns} spawn points`);
  assert.ok(s.barrels > 20, `only ${s.barrels} barrels`);
  assert.ok(s.boxes >= s.buildings + 4, 'walls and barrels need colliders too');
});

test('the same seed always produces the same city', () => {
  const a = L.generateCity(4242);
  const b = L.generateCity(4242);
  assert.equal(a.buildings.length, b.buildings.length);
  assert.deepEqual(a.buildings.slice(0, 10), b.buildings.slice(0, 10));
  assert.deepEqual(a.extract, b.extract);
});

test('a different seed produces a different city', () => {
  const a = L.generateCity(1);
  const b = L.generateCity(2);
  assert.notDeepEqual(a.buildings.slice(0, 10), b.buildings.slice(0, 10));
});

test('every building has sane dimensions', () => {
  for (const b of city.buildings) {
    assert.ok(b.w > 2 && b.w < 60, `bad width ${b.w}`);
    assert.ok(b.d > 2 && b.d < 60, `bad depth ${b.d}`);
    assert.ok(b.h > 3 && b.h < 80, `bad height ${b.h}`);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z));
  }
});

test('nothing is built outside the arena', () => {
  for (const b of city.buildings) {
    assert.ok(Math.abs(b.x) + b.w / 2 <= city.half + 1, `building escapes at x=${b.x}`);
    assert.ok(Math.abs(b.z) + b.d / 2 <= city.half + 1, `building escapes at z=${b.z}`);
  }
});

test('buildings never overlap a road, so the streets stay drivable', () => {
  let bad = 0;
  for (const b of city.buildings) {
    // Sample the four corners and the midpoints of each edge.
    const pts = [
      [b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2],
      [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z + b.d / 2],
      [b.x, b.z - b.d / 2], [b.x, b.z + b.d / 2],
      [b.x - b.w / 2, b.z], [b.x + b.w / 2, b.z],
    ];
    for (const [x, z] of pts) if (L.onRoad(x, z)) bad++;
  }
  assert.equal(bad, 0, `${bad} building corners landed on a road`);
});

test('buildings do not overlap each other', () => {
  let overlaps = 0;
  for (let i = 0; i < city.buildings.length; i++) {
    const a = city.buildings[i];
    for (let j = i + 1; j < city.buildings.length; j++) {
      const b = city.buildings[j];
      if (Math.abs(a.x - b.x) > (a.w + b.w) / 2 + 10) continue; // cheap reject
      if (Math.abs(a.z - b.z) > (a.d + b.d) / 2 + 10) continue;
      const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
      const oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
      if (ox > 0.2 && oz > 0.2) overlaps++;
    }
  }
  assert.equal(overlaps, 0, `${overlaps} overlapping building pairs`);
});

test('every building has a matching collider', () => {
  for (const b of city.buildings) {
    const box = city.boxes.find((x) => x.x === b.x && x.z === b.z && x.h === b.h);
    assert.ok(box, `no collider for the building at ${b.x},${b.z}`);
    assert.ok(Math.abs(box.hx - b.w / 2) < 1e-9);
    assert.ok(Math.abs(box.hz - b.d / 2) < 1e-9);
  }
});

test('the perimeter is fully walled on all four sides', () => {
  assert.equal(city.walls.length, 4);
  const sides = city.walls.map((w) => (w.x === 0 ? 'z' : 'x'));
  assert.deepEqual(sides.sort(), ['x', 'x', 'z', 'z']);
  for (const w of city.walls) {
    if (w.x === 0) {
      // spans the whole east-west extent, thin in z
      assert.ok(w.hx >= city.half, `n/s wall too short: hx=${w.hx}`);
      assert.ok(w.hz < 6, `n/s wall should be thin: hz=${w.hz}`);
      assert.ok(Math.abs(Math.abs(w.z) - (city.half + w.hz)) < 1e-6, 'n/s wall off the edge');
    } else {
      assert.ok(w.hz >= city.half, `e/w wall too short: hz=${w.hz}`);
      assert.ok(w.hx < 6, `e/w wall should be thin: hx=${w.hx}`);
      assert.ok(Math.abs(Math.abs(w.x) - (city.half + w.hx)) < 1e-6, 'e/w wall off the edge');
    }
  }
});

test('the player spawns on a road, clear of geometry', () => {
  const p = city.playerSpawn;
  assert.ok(L.onRoad(p.x, p.z), 'player spawn must be on a road');
  const blocked = city.boxes.some((b) =>
    b.h > 1 && Math.abs(p.x - b.x) < b.hx + CFG.RADIUS + 1 && Math.abs(p.z - b.z) < b.hz + CFG.RADIUS + 1);
  assert.equal(blocked, false, 'player spawns stuck in something');
});

test('every enemy spawn point is on a road and clear of geometry', () => {
  for (const p of city.spawnPoints) {
    assert.ok(L.onRoad(p.x, p.z), `spawn ${p.x},${p.z} is off-road`);
    const blocked = city.boxes.some((b) =>
      b.h > 1 && Math.abs(p.x - b.x) < b.hx + 2 && Math.abs(p.z - b.z) < b.hz + 2);
    assert.equal(blocked, false, `spawn ${p.x},${p.z} is inside geometry`);
  }
});

test('spawn points are spread out, not clustered', () => {
  for (let i = 0; i < city.spawnPoints.length; i++) {
    for (let j = i + 1; j < city.spawnPoints.length; j++) {
      const a = city.spawnPoints[i], b = city.spawnPoints[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 33, 'spawn points too close');
    }
  }
});

test('the extraction zone is reachable and inside the arena', () => {
  const e = city.extract;
  assert.ok(Math.abs(e.x) < city.half && Math.abs(e.z) < city.half);
  assert.ok(L.onRoad(e.x, e.z), 'extraction must be on a road so you can drive in');
});

test('onRoad classifies the grid correctly', () => {
  assert.equal(L.onRoad(0, 30), true, 'centre line');
  assert.equal(L.onRoad(60, 30), true, 'next road');
  assert.equal(L.onRoad(30, 30), false, 'middle of a block');
  assert.equal(L.onRoad(30, 0), true, 'cross street');
});

test('barrels are off the roads and inside the arena', () => {
  for (const b of city.barrels) {
    assert.equal(L.onRoad(b.x, b.z), false, 'a barrel must not block a road');
    assert.ok(Math.abs(b.x) < city.half && Math.abs(b.z) < city.half);
    assert.equal(b.alive, true);
  }
});

test('a spatial grid finds the same boxes a brute-force scan would', () => {
  const grid = S.buildGrid(city.boxes, 12);
  let checked = 0;
  for (const b of city.buildings.slice(0, 40)) {
    for (const [dx, dz] of [[0, 0], [b.w / 2 + 1, 0], [0, b.d / 2 + 1]]) {
      const x = b.x + dx, z = b.z + dz;
      const brute = S.resolveCircleAABBs(x, z, CFG.RADIUS, city.boxes);
      const fast = S.resolveCircleGrid(x, z, CFG.RADIUS, grid);
      assert.equal(!!brute.impact, !!fast.impact, `disagreement at ${x},${z}`);
      assert.ok(Math.abs(brute.x - fast.x) < 1e-9);
      assert.ok(Math.abs(brute.z - fast.z) < 1e-9);
      checked++;
    }
  }
  assert.ok(checked > 100, `only checked ${checked} probes`);
});

test('the grid is a real broad-phase win, not just correct', () => {
  const grid = S.buildGrid(city.boxes, 12);
  const probes = city.buildings.slice(0, 300).map((b) => ({ x: b.x + b.w, z: b.z }));

  const t0 = process.hrtime.bigint();
  for (let r = 0; r < 6; r++) for (const p of probes) S.resolveCircleAABBs(p.x, p.z, 1.7, city.boxes);
  const brute = Number(process.hrtime.bigint() - t0) / 1e6;

  const t1 = process.hrtime.bigint();
  for (let r = 0; r < 6; r++) for (const p of probes) S.resolveCircleGrid(p.x, p.z, 1.7, grid);
  const fast = Number(process.hrtime.bigint() - t1) / 1e6;

  assert.ok(fast < brute, `grid (${fast.toFixed(1)}ms) should beat brute force (${brute.toFixed(1)}ms)`);
});
