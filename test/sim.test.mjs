'use strict';

/**
 * Tests for the FIRE ZONE simulation core (js/sim.mjs).
 * That module has no THREE and no DOM, so it runs here unchanged — nothing
 * in this file re-implements the game.
 */

const test = await import('node:test').then((m) => m.default);
const assert = await import('node:assert/strict');

const S = await import('../js/sim.mjs');
const { CFG } = S;

const NO_INPUT = { throttle: 0, steer: 0, handbrake: false };

/** Run the vehicle for `seconds` with constant input. */
function drive(v, input, seconds, dt = 1 / 120) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) S.stepVehicle(v, input, dt);
  return v;
}

/* ============================== maths ================================== */

test('angleDiff takes the short way round', () => {
  assert.ok(Math.abs(S.angleDiff(0, Math.PI / 2) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(S.angleDiff(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9,
    'should wrap across the +/-PI seam');
  assert.ok(S.angleDiff(0, 3) > 0 && S.angleDiff(0, -3) < 0);
  assert.ok(Math.abs(S.angleDiff(1, 1)) < 1e-12);
});

test('clamp and inBounds behave', () => {
  assert.equal(S.clamp(5, 0, 3), 3);
  assert.equal(S.clamp(-5, 0, 3), 0);
  assert.equal(S.inBounds(0, 0), true);
  assert.equal(S.inBounds(CFG.WORLD_HALF + 1, 0), false);
});

test('makeRng is deterministic for a given seed', () => {
  const a = S.makeRng(12345);
  const b = S.makeRng(12345);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  const c = S.makeRng(999);
  assert.notEqual(S.makeRng(1)(), c());
});

/* ============================= vehicle ================================= */

test('a fresh vehicle is stationary and alive', () => {
  const v = S.createVehicle({ x: 5, z: -7, yaw: 1 });
  assert.equal(v.speed, 0);
  assert.equal(v.x, 5);
  assert.equal(v.z, -7);
  assert.equal(v.alive, true);
  assert.equal(v.hp, CFG.PLAYER_HP);
  assert.equal(v.armor, CFG.PLAYER_ARMOR);
});

test('throttle accelerates up to MAX_SPEED and never past it', () => {
  const v = S.createVehicle();
  drive(v, { throttle: 1, steer: 0 }, 40);
  assert.ok(v.forwardSpeed > CFG.MAX_SPEED * 0.95,
    `should reach near top speed, got ${v.forwardSpeed}`);
  assert.ok(v.forwardSpeed <= CFG.MAX_SPEED + 1e-6,
    `must never exceed MAX_SPEED, got ${v.forwardSpeed}`);
});

test('it takes a few seconds to get going, not zero', () => {
  const v = S.createVehicle();
  drive(v, { throttle: 1, steer: 0 }, 1);
  const after1s = v.forwardSpeed;
  assert.ok(after1s > 5 && after1s < CFG.MAX_SPEED * 0.6,
    `1s of throttle should give a believable speed, got ${after1s}`);
});

test('braking stops the car faster than coasting', () => {
  const a = S.createVehicle();
  const b = S.createVehicle();
  drive(a, { throttle: 1 }, 6);
  drive(b, { throttle: 1 }, 6);
  drive(a, { throttle: -1 }, 3); // brake
  drive(b, NO_INPUT, 3); // coast
  assert.ok(a.forwardSpeed < b.forwardSpeed,
    `braking (${a.forwardSpeed}) should beat coasting (${b.forwardSpeed})`);
  assert.ok(a.forwardSpeed < 2, 'three seconds of braking should nearly stop the car');
});

test('negative throttle from a standstill reverses, capped at MAX_REVERSE', () => {
  const v = S.createVehicle();
  drive(v, { throttle: -1 }, 20);
  assert.ok(v.forwardSpeed < -1, `should be reversing, got ${v.forwardSpeed}`);
  assert.ok(v.forwardSpeed >= -CFG.MAX_REVERSE - 1e-6,
    `reverse must be capped, got ${v.forwardSpeed}`);
});

test('coasting with no input rolls to a stop', () => {
  const v = S.createVehicle();
  drive(v, { throttle: 1 }, 5);
  assert.ok(v.forwardSpeed > 10);
  drive(v, NO_INPUT, 30);
  assert.equal(v.forwardSpeed, 0, 'rolling resistance must bring it to a full stop');
  assert.equal(v.speed, 0);
});

test('steering does nothing while parked', () => {
  const v = S.createVehicle();
  const yaw0 = v.yaw;
  drive(v, { throttle: 0, steer: 1 }, 3);
  assert.ok(Math.abs(v.yaw - yaw0) < 1e-9, 'a parked car must not pivot');
});

test('steering turns the car while driving, and left is negative', () => {
  const left = S.createVehicle();
  const right = S.createVehicle();
  drive(left, { throttle: 1, steer: -1 }, 3);
  drive(right, { throttle: 1, steer: 1 }, 3);
  assert.ok(left.yaw < 0, 'steer -1 should turn left (negative yaw)');
  assert.ok(right.yaw > 0, 'steer +1 should turn right (positive yaw)');
});

test('steering authority fades at speed', () => {
  const slow = S.createVehicle();
  const fast = S.createVehicle();
  drive(slow, { throttle: 1, steer: 1 }, 0.6);
  drive(fast, { throttle: 1 }, 20);
  const slowRate = Math.abs(slow.steer);
  const fastRate = Math.abs(fast.steer);
  assert.ok(fastRate < slowRate,
    `top-speed steer ${fastRate} should be less than ${slowRate}`);
});

test('the handbrake breaks traction and lets the car slide', () => {
  const grip = S.createVehicle();
  const drift = S.createVehicle();
  drive(grip, { throttle: 1, steer: 1 }, 4);
  drive(drift, { throttle: 1, steer: 1 }, 4);
  // Now yank the handbrake while still turning.
  drive(grip, { throttle: 0, steer: 1, handbrake: false }, 1.2);
  drive(drift, { throttle: 0, steer: 1, handbrake: true }, 1.2);
  assert.ok(Math.abs(drift.lateralSpeed) > Math.abs(grip.lateralSpeed),
    `handbrake slip ${drift.lateralSpeed} should exceed grip slip ${grip.lateralSpeed}`);
});

test('gravity pulls a launched car back to the ground', () => {
  const v = S.createVehicle();
  v.vy = 12; // launched off a ramp
  S.stepVehicle(v, NO_INPUT, 1 / 60);
  assert.equal(v.grounded, false);
  drive(v, NO_INPUT, 3);
  assert.equal(v.y, 0, 'must land');
  assert.equal(v.grounded, true);
});

test('a hard landing costs health, a soft one does not', () => {
  const hard = S.createVehicle();
  hard.y = 40; hard.vy = -30;
  drive(hard, NO_INPUT, 3);
  assert.ok(hard.hp < CFG.PLAYER_HP, `hard landing should hurt, hp=${hard.hp}`);

  const soft = S.createVehicle();
  soft.y = 1; soft.vy = -2;
  drive(soft, NO_INPUT, 3);
  assert.equal(soft.hp, CFG.PLAYER_HP);
});

/* =========================== damage / armor ============================ */

test('armor soaks its share, then health takes the rest', () => {
  const v = S.createVehicle();
  S.applyDamage(v, 50, 0);
  const expectedArmor = CFG.PLAYER_ARMOR - 50 * CFG.ARMOR_ABSORB;
  assert.ok(Math.abs(v.armor - expectedArmor) < 1e-9, `armor=${v.armor}`);
  assert.ok(Math.abs(v.hp - (CFG.PLAYER_HP - 50 * (1 - CFG.ARMOR_ABSORB))) < 1e-9);
  assert.equal(v.alive, true);
});

test('damage beyond the total pool kills', () => {
  const v = S.createVehicle();
  S.applyDamage(v, 100000, 0);
  assert.equal(v.alive, false);
  assert.equal(v.hp, 0);
  assert.equal(v.armor, 0);
  assert.equal(S.applyDamage(v, 10, 1), 0, 'a dead target takes no more damage');
});

test('a dead vehicle stops simulating', () => {
  const v = S.createVehicle();
  v.alive = false;
  S.stepVehicle(v, { throttle: 1 }, 1 / 60);
  assert.equal(v.speed, 0);
});

test('regen only kicks in after the delay', () => {
  const v = S.createVehicle();
  v.hp = 40;
  v.lastDamageAt = 0;
  assert.equal(S.regenVehicle(v, CFG.REGEN_DELAY - 1, 1), 0, 'too soon');
  const healed = S.regenVehicle(v, CFG.REGEN_DELAY + 0.1, 1);
  assert.ok(healed > 0, 'should regen after the delay');
  v.hp = CFG.PLAYER_HP;
  assert.equal(S.regenVehicle(v, 999, 1), 0, 'never overheal');
});

/* ============================ collisions =============================== */

test('a circle overlapping a box is pushed out along the normal', () => {
  const boxes = [{ x: 0, z: 0, hx: 5, hz: 5, h: 8 }];
  const r = S.resolveCircleAABBs(5.5, 0, 1.7, boxes);
  assert.ok(r.impact, 'should report an impact');
  assert.ok(r.x >= 5 + 1.7 - 1e-6, `pushed to ${r.x}, want >= 6.7`);
  assert.ok(r.impact.nx > 0.99, 'normal should point away on +x');
});

test('a circle clear of the box is untouched', () => {
  const boxes = [{ x: 0, z: 0, hx: 5, hz: 5, h: 8 }];
  const r = S.resolveCircleAABBs(30, 30, 1.7, boxes);
  assert.equal(r.impact, null);
  assert.equal(r.x, 30);
});

test('a circle whose centre is inside the box still gets ejected', () => {
  const boxes = [{ x: 0, z: 0, hx: 5, hz: 5, h: 8 }];
  const r = S.resolveCircleAABBs(0.2, 0, 1.7, boxes);
  assert.ok(r.impact, 'must not get stuck inside geometry');
  const d = Math.hypot(r.x, r.z);
  assert.ok(d > 1, `should be ejected outwards, ended at ${d}`);
});

test('zero-height boxes are ignored (flat decals must not block)', () => {
  const boxes = [{ x: 0, z: 0, hx: 5, hz: 5, h: 0 }];
  const r = S.resolveCircleAABBs(0, 0, 1.7, boxes);
  assert.equal(r.impact, null);
});

test('reflectVelocity kills the inbound component and reports energy lost', () => {
  const v = { vx: -10, vz: 0 }; // moving into a +x wall
  const lost = S.reflectVelocity(v, 1, 0, 0.25);
  assert.ok(v.vx > 0, 'should bounce away from the wall');
  assert.ok(lost > 0, 'energy must be lost in the crash');
  assert.ok(Math.abs(v.vx) < 10, 'bounce is weaker than the impact');
});

test('reflectVelocity leaves a car already moving away alone', () => {
  const v = { vx: 10, vz: 0 };
  const lost = S.reflectVelocity(v, 1, 0, 0.25);
  assert.equal(lost, 0);
  assert.equal(v.vx, 10);
});

test('driving into a wall stops you at the surface instead of passing through', () => {
  const boxes = [{ x: 20, z: 0, hx: 5, hz: 20, h: 10 }];
  const v = S.createVehicle();
  v.yaw = Math.PI / 2; // face +x
  for (let i = 0; i < 400; i++) {
    S.stepVehicle(v, { throttle: 1 }, 1 / 60);
    const r = S.resolveCircleAABBs(v.x, v.z, CFG.RADIUS, boxes);
    v.x = r.x; v.z = r.z;
    if (r.impact) S.reflectVelocity(v, r.impact.nx, r.impact.nz);
  }
  assert.ok(v.x < 20 - 5 + CFG.RADIUS + 0.05, `stuck inside the wall at x=${v.x}`);
  assert.ok(v.forwardSpeed < 3, 'should have been brought to rest');
});

/* ============================ ballistics =============================== */

test('a bullet travels forward and expires', () => {
  const b = S.fireBullet({ x: 0, y: 1.2, z: 0 }, 0, 1, 'player');
  const z0 = b.z;
  S.stepBullets([b], 0.1, [], [], []);
  assert.ok(b.z > z0, 'must move along +z');
  assert.ok(Math.abs(b.z - CFG.BULLET_SPEED * 0.1) < 1e-6);

  const arr = [b];
  for (let i = 0; i < 200; i++) S.stepBullets(arr, 0.05, [], [], []);
  assert.equal(arr.length, 0, 'bullet should expire');
});

test('a bullet hitting a wall is consumed and reported', () => {
  const boxes = [{ x: 0, z: 20, hx: 10, hz: 1, h: 8 }];
  const arr = [S.fireBullet({ x: 0, y: 1.2, z: 0 }, 0, 1, 'player')];
  const hits = [];
  for (let i = 0; i < 60 && arr.length; i++) S.stepBullets(arr, 0.05, boxes, [], hits);
  assert.equal(arr.length, 0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'wall');
  assert.ok(hits[0].z > 18 && hits[0].z < 21, `hit at z=${hits[0].z}`);
});

test('a bullet hitting a character body scores a body hit', () => {
  const target = { x: 0, y: 1.1, z: 20, radius: 0.55, headY: 1.62, headR: 0.26, alive: true, owner: 'enemy' };
  const arr = [S.fireBullet({ x: 0, y: 1.1, z: 0 }, 0, 1, 'player')];
  const hits = [];
  for (let i = 0; i < 60 && arr.length; i++) S.stepBullets(arr, 0.05, [], [target], hits);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'body');
  assert.equal(hits[0].target, target);
});

test('a bullet at head height scores a headshot, not a body hit', () => {
  const target = { x: 0, y: 1.1, z: 20, radius: 0.55, headY: 1.62, headR: 0.26, alive: true, owner: 'enemy' };
  const arr = [S.fireBullet({ x: 0, y: 1.62, z: 0 }, 0, 1, 'player')];
  const hits = [];
  for (let i = 0; i < 60 && arr.length; i++) S.stepBullets(arr, 0.05, [], [target], hits);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'headshot');
});

test('friendly fire is impossible — same-owner bullets pass through', () => {
  const target = { x: 0, y: 1.1, z: 20, radius: 0.55, headY: 1.62, headR: 0.26, alive: true, owner: 'player' };
  const arr = [S.fireBullet({ x: 0, y: 1.1, z: 0 }, 0, 1, 'player')];
  const hits = [];
  for (let i = 0; i < 60 && arr.length; i++) S.stepBullets(arr, 0.05, [], [target], hits);
  assert.equal(hits.length, 0, 'must not hit your own team');
});

test('a dead target cannot be shot', () => {
  const target = { x: 0, y: 1.1, z: 20, radius: 0.55, headY: 1.62, headR: 0.26, alive: false, owner: 'enemy' };
  const arr = [S.fireBullet({ x: 0, y: 1.1, z: 0 }, 0, 1, 'player')];
  const hits = [];
  for (let i = 0; i < 60 && arr.length; i++) S.stepBullets(arr, 0.05, [], [target], hits);
  assert.equal(hits.length, 0);
});

test('bullets cannot leave the arena or go underground', () => {
  const up = [S.fireBullet({ x: 0, y: 1.2, z: 0 }, 0, 1, 'player')];
  up[0].vy = -200;
  S.stepBullets(up, 0.1, [], [], []);
  assert.equal(up.length, 0, 'a bullet into the ground must be removed');

  const far = [S.fireBullet({ x: CFG.WORLD_HALF - 1, y: 1.2, z: 0 }, 1, 0, 'player')];
  S.stepBullets(far, 0.5, [], [], []);
  assert.equal(far.length, 0, 'a bullet leaving the map must be removed');
});

/* ============================== enemies ================================ */

test('an idle enemy far away neither moves nor shoots', () => {
  const e = S.createEnemy(0, 0);
  const p = S.createVehicle({ x: 300, z: 300 });
  const before = { x: e.x, z: e.z };
  const shot = S.stepEnemy(e, p, 1 / 60, [], 0, () => 'shot');
  assert.equal(shot, null);
  assert.equal(e.x, before.x);
  assert.equal(e.z, before.z);
  assert.equal(e.alert, false);
});

test('a nearby enemy becomes alert and closes the distance', () => {
  const e = S.createEnemy(0, 0);
  const p = S.createVehicle({ x: 0, z: 40 });
  for (let i = 0; i < 60; i++) S.stepEnemy(e, p, 1 / 60, [], i / 60, () => 'shot');
  assert.equal(e.alert, true);
  assert.ok(e.z > 1, `should have moved toward the player, z=${e.z}`);
});

test('an enemy in range with line of sight shoots on cooldown', () => {
  const e = S.createEnemy(0, 0);
  e.yaw = 0; // facing +z, toward the player
  e.alert = true;
  e.cooldown = 0;
  const p = S.createVehicle({ x: 0, z: 20 });
  let shots = 0;
  for (let i = 0; i < 120; i++) {
    S.stepEnemy(e, p, 1 / 60, [], i / 60, () => { shots++; return 'shot'; });
  }
  assert.ok(shots >= 1, `expected the enemy to fire, got ${shots} shots`);
  assert.ok(shots < 5, `should not machine-gun, got ${shots} shots in 2s`);
});

test('an enemy out of range holds fire', () => {
  const e = S.createEnemy(0, 0);
  e.alert = true;
  e.cooldown = 0;
  e.yaw = 0;
  const p = S.createVehicle({ x: 0, z: CFG.ENEMY_RANGE + 30 });
  let shots = 0;
  for (let i = 0; i < 30; i++) S.stepEnemy(e, p, 1 / 60, [], 0, () => { shots++; });
  assert.equal(shots, 0);
});

test('an enemy facing the wrong way holds fire', () => {
  const e = S.createEnemy(0, 0);
  e.alert = true;
  e.cooldown = 0;
  e.yaw = Math.PI; // facing away from a player at +z
  const p = S.createVehicle({ x: 0, z: 20 });
  let shots = 0;
  for (let i = 0; i < 10; i++) S.stepEnemy(e, p, 1 / 60, [], 0, () => { shots++; });
  assert.equal(shots, 0);
});

test('a dead enemy stops acting', () => {
  const e = S.createEnemy(0, 0);
  e.alive = false;
  const p = S.createVehicle({ x: 0, z: 10 });
  assert.equal(S.stepEnemy(e, p, 1 / 60, [], 0, () => 'shot'), null);
});

test('line of sight is blocked by a tall building but not by a low crate', () => {
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 30 };
  const wall = [{ x: 0, z: 15, hx: 10, hz: 2, h: 12 }];
  const crate = [{ x: 0, z: 15, hx: 2, hz: 2, h: 0.8 }];
  assert.equal(S.hasLineOfSight(a, b, wall), false, 'a wall must block sight');
  assert.equal(S.hasLineOfSight(a, b, crate), true, 'a crate must not block sight');
  assert.equal(S.hasLineOfSight(a, b, []), true);
});

test('enemies cannot walk through buildings', () => {
  const boxes = [{ x: 0, z: 10, hx: 20, hz: 2, h: 12 }];
  const e = S.createEnemy(0, 0);
  e.alert = true;
  const p = S.createVehicle({ x: 0, z: 40 });
  for (let i = 0; i < 300; i++) S.stepEnemy(e, p, 1 / 60, boxes, i / 60, () => null);
  assert.ok(e.z < 8 + 1, `enemy walked into the wall at z=${e.z}`);
});

/* ============================== mission ================================ */

test('the mission starts in the combat phase', () => {
  const m = S.createMission({ killGoal: 3 });
  assert.equal(m.phase, 'combat');
  assert.equal(m.kills, 0);
  assert.equal(m.result, null);
});

test('reaching the kill goal opens the extraction phase', () => {
  const m = S.createMission({ killGoal: 3, extract: { x: 0, z: 0 } });
  const p = S.createVehicle({ x: 200, z: 200 });
  m.kills = 3;
  S.stepMission(m, p, 0.1);
  assert.equal(m.phase, 'extract');
});

test('holding the extraction zone long enough wins and pays a time bonus', () => {
  const m = S.createMission({ killGoal: 1, extract: { x: 0, z: 0 } });
  const p = S.createVehicle({ x: 0, z: 0 });
  m.kills = 1;
  for (let i = 0; i < 400 && !m.result; i++) S.stepMission(m, p, 0.1);
  assert.equal(m.result, 'won');
  assert.equal(m.phase, 'done');
  assert.ok(m.score > 500, `should include a time bonus, score=${m.score}`);
});

test('leaving the extraction zone bleeds the hold timer back down', () => {
  const m = S.createMission({ killGoal: 1, extract: { x: 0, z: 0 } });
  const p = S.createVehicle({ x: 0, z: 0 });
  m.kills = 1;
  S.stepMission(m, p, 1);
  const held = m.holdTime;
  assert.ok(held > 0);
  p.x = 200;
  S.stepMission(m, p, 0.5);
  assert.ok(m.holdTime < held, 'progress must decay when you leave');
  assert.equal(m.result, null, 'and you must not win by leaving');
});

test('dying loses the mission', () => {
  const m = S.createMission({ killGoal: 5 });
  const p = S.createVehicle();
  p.alive = false;
  S.stepMission(m, p, 0.1);
  assert.equal(m.result, 'lost');
});

test('a finished mission is frozen', () => {
  const m = S.createMission({ killGoal: 1 });
  const p = S.createVehicle();
  p.alive = false;
  S.stepMission(m, p, 0.1);
  const t = m.time;
  p.alive = true;
  S.stepMission(m, p, 5);
  assert.equal(m.time, t, 'no more ticking after the result is set');
});

/* ============================ explosions =============================== */

test('explosion damage falls off with distance and stops at the radius', () => {
  const near = S.createEnemy(2, 0);
  const mid = S.createEnemy(7, 0);
  const far = S.createEnemy(CFG.EXPLOSION_RADIUS + 5, 0);
  const res = S.applyExplosion(0, 0, [near, mid, far], null);

  assert.equal(res.targets.length, 2, 'the far target is out of range');
  const [n, m] = res.targets;
  assert.ok(n.damage > m.damage, 'closer means more damage');
  assert.ok(Math.abs(n.damage - CFG.EXPLOSION_DAMAGE * (1 - 2 / CFG.EXPLOSION_RADIUS)) < 1e-9);
});

test('an explosion also hits the player vehicle', () => {
  const v = S.createVehicle({ x: 3, z: 0 });
  const res = S.applyExplosion(0, 0, [], v);
  assert.ok(res.vehicleDamage > 0);
  const far = S.createVehicle({ x: 500, z: 0 });
  assert.equal(S.applyExplosion(0, 0, [], far).vehicleDamage, 0);
});

test('dead targets are skipped by explosions', () => {
  const e = S.createEnemy(1, 0);
  e.alive = false;
  assert.equal(S.applyExplosion(0, 0, [e], null).targets.length, 0);
});

/* ============================== minimap ================================ */

test('the radar puts what is ahead of you at +y', () => {
  const p = S.toRadar(0, 10, 0, 0, 0, 10);
  assert.ok(Math.abs(p.x) < 1e-9);
  assert.ok(p.y > 0.99, `ahead should be +y, got ${p.y}`);
});

test('the radar rotates with the player heading', () => {
  // Something due north; when we face east it should read as being to the left.
  const facingEast = S.toRadar(0, 10, 0, 0, Math.PI / 2, 10);
  assert.ok(facingEast.x < -0.99, `expected -x, got ${facingEast.x}`);
  assert.ok(Math.abs(facingEast.y) < 1e-9);
});

test('the radar clamps far-away markers just outside the disc', () => {
  const p = S.toRadar(10000, 10000, 0, 0, 0, 100);
  assert.ok(Math.abs(p.x) <= 1.15 && Math.abs(p.y) <= 1.15);
});

test('kmh converts correctly', () => {
  assert.equal(S.kmh(10), 36);
  assert.ok(Math.abs(S.kmh(CFG.MAX_SPEED) - CFG.MAX_SPEED * 3.6) < 1e-9);
});
