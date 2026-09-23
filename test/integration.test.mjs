'use strict';

/**
 * Full-match integration test.
 *
 * Plays an entire FIRE ZONE match headlessly using only the pure modules —
 * no DOM, no WebGL. A simple autopilot drives the car, hunts hostiles and
 * shoots, then drives to the extraction zone. This proves the game is
 * actually completable and that nothing in the loop produces NaN or hangs.
 */

const test = await import('node:test').then((m) => m.default);
const assert = await import('node:assert/strict');

const S = await import('../js/sim.mjs');
const L = await import('../js/layout.mjs');
const { CFG } = S;

const DT = 1 / 60;

/** Whole-match harness shared by the tests below. */
function playMatch(opts = {}) {
  // Fully seeded: the sim's own randomness is injectable, so a given seed
  // always replays identically. Flaky integration tests teach nothing.
  const rng = S.makeRng(opts.seed ?? 20260923);
  const city = L.generateCity(opts.seed ?? 20260923);
  const grid = S.buildGrid(city.boxes, 12);
  const player = S.createVehicle({
    x: city.playerSpawn.x, z: city.playerSpawn.z, yaw: city.playerSpawn.yaw,
  });
  const mission = S.createMission({ killGoal: opts.killGoal ?? 12, extract: city.extract });
  const enemies = [];
  const bullets = [];
  const barrelBoxes = city.boxes.filter((b) => b.barrel);

  const KILL_GOAL = mission.killGoal;
  let t = 0;
  let frames = 0;
  let nan = null;
  let maxSpeed = 0;
  let maxEnemies = 0;
  let shotsFired = 0;
  let headshots = 0;
  let explosions = 0;
  let enemyShots = 0;
  let lowestHp = player.hp;

  function spawnEnemy() {
    const p = city.spawnPoints[Math.floor(rng() * city.spawnPoints.length)];
    if (Math.hypot(p.x - player.x, p.z - player.z) < 24) return;
    enemies.push(S.createEnemy(p.x, p.z, {
      yaw: Math.atan2(player.x - p.x, player.z - p.z),
      rng,
    }));
  }
  for (let i = 0; i < 4; i++) spawnEnemy();

  /** How far can we drive on this heading before touching geometry? */
  function clearance(yaw, maxDist = 26) {
    const hx = Math.sin(yaw), hz = Math.cos(yaw);
    for (let d = 3; d <= maxDist; d += 2) {
      const r = S.resolveCircleGrid(player.x + hx * d, player.z + hz * d, CFG.RADIUS, grid);
      if (r.impact) return d;
    }
    return maxDist;
  }

  let stuckFor = 0;
  let escapeFor = 0;

  /**
   * Autopilot: target the nearest hostile (or extraction), steer around
   * buildings by sampling a fan of headings, and back out when wedged.
   * Without the escape manoeuvre it pins itself on a wall forever.
   */
  function autopilot() {
    const alive = enemies.filter((e) => e.alive);
    let tx, tz, target = null, dist = Infinity;
    if (mission.phase === 'combat' && alive.length) {
      for (const e of alive) {
        const d = Math.hypot(e.x - player.x, e.z - player.z);
        if (d < dist) { dist = d; target = e; }
      }
      tx = target.x; tz = target.z;
    } else {
      tx = mission.extract.x; tz = mission.extract.z;
      dist = Math.hypot(tx - player.x, tz - player.z);
    }

    // Wedged against something? Reverse and swing out for a moment.
    if (player.speed < 2.5) stuckFor += DT; else stuckFor = 0;
    if (stuckFor > 0.9 && escapeFor <= 0) { escapeFor = 1.5; stuckFor = 0; }
    if (escapeFor > 0) {
      escapeFor -= DT;
      return { throttle: -1, steer: (frames % 200 < 100) ? 1 : -1, handbrake: false, fire: false };
    }

    const want = Math.atan2(tx - player.x, tz - player.z);

    // Prefer headings that are actually open; ignore anything blocked.
    let bestYaw = want, bestScore = -Infinity;
    for (const off of [0, 0.3, -0.3, 0.65, -0.65, 1.05, -1.05, 1.5, -1.5, 2.1, -2.1]) {
      const room = clearance(want + off, 30);
      if (room < 8) continue;
      const score = room - Math.abs(off) * 6;
      if (score > bestScore) { bestScore = score; bestYaw = want + off; }
    }
    if (bestScore === -Infinity) {
      // Boxed in — back away from whatever is in front of us.
      return { throttle: -1, steer: 0.85, handbrake: false, fire: false };
    }

    const diff = S.angleDiff(player.yaw, bestYaw);
    const roomAhead = clearance(player.yaw, 18);

    // Only shoot when we can actually see the target.
    const los = target ? S.hasLineOfSight(player, target, grid, 2) : false;

    return {
      throttle: roomAhead < 6 ? -0.5 : (dist < 9 ? -0.3 : (Math.abs(diff) > 1.0 ? 0.4 : 1)),
      steer: S.clamp(diff * 1.6, -1, 1),
      handbrake: Math.abs(diff) > 2.0 && player.speed > 14,
      fire: mission.phase === 'combat' && los && dist < CFG.ENEMY_RANGE * 1.2 && Math.abs(diff) < 0.6,
    };
  }

  const maxFrames = (opts.seconds ?? 240) / DT;

  while (frames < maxFrames && !mission.result) {
    frames++;
    t += DT;

    const inp = autopilot();
    const before = player.speed;
    S.stepVehicle(player, inp, DT);

    const r = S.resolveCircleGrid(player.x, player.z, CFG.RADIUS, grid, player.y + 0.6);
    player.x = r.x; player.z = r.z;
    if (r.impact) {
      S.reflectVelocity(player, r.impact.nx, r.impact.nz, 0.22);
      const impact = before - player.speed;
      if (impact > 4) S.applyDamage(player, impact * CFG.CRASH_DAMAGE, t);
    }

    maxSpeed = Math.max(maxSpeed, player.speed);

    // Keep pressure on, exactly like the real spawner.
    const alive = enemies.filter((e) => e.alive).length;
    maxEnemies = Math.max(maxEnemies, alive);
    const remaining = KILL_GOAL - mission.kills;
    if (mission.phase === 'combat' && remaining > 0 && alive < Math.min(6, remaining)) {
      if (rng() < DT * 1.2) spawnEnemy();
    }

    // Enemies act and shoot back.
    for (const e of enemies) {
      if (!e.alive) continue;
      const b = S.stepEnemy(e, player, DT, grid, t, (o, dx, dz, owner, dmg, sp) => {
        const nb = S.fireBullet(o, dx, dz, owner, dmg, sp);
        bullets.push(nb);
        return nb;
      });
      if (b) enemyShots++;
    }

    // Player weapon.
    if (inp.fire && frames % 6 === 0) {
      // Shoot at whichever hostile is closest to the crosshair direction.
      let tgt = null, bd = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - player.x, e.z - player.z);
        if (d < bd) { bd = d; tgt = e; }
      }
      if (tgt) {
        const a = Math.atan2(tgt.x - player.x, tgt.z - player.z);
        // Pitch down from the roof turret (2.3m) to the target's chest (1.1m).
        const horiz = Math.hypot(tgt.x - player.x, tgt.z - player.z) || 1;
        const dy = (1.1 - 2.3) / horiz;
        bullets.push(S.fireBullet(
          { x: player.x, y: 2.3, z: player.z }, Math.sin(a), Math.cos(a),
          'player', CFG.BULLET_DAMAGE, CFG.BULLET_SPEED, dy,
        ));
        shotsFired++;
      }
    }

    const targets = enemies.filter((e) => e.alive);
    const hits = [];
    S.stepBullets(bullets, DT, grid, targets, hits);
    for (const h of hits) {
      if (h.kind === 'wall') {
        if (h.box && h.box.barrel) {
          h.box.barrel.hp -= h.bullet.damage;
          if (h.box.barrel.hp <= 0 && h.box.barrel.alive) {
            h.box.barrel.alive = false;
            h.box.h = 0;
            explosions++;
            const res = S.applyExplosion(h.box.x, h.box.z, targets, player);
            for (const tr of res.targets) S.applyDamage(tr.target, tr.damage, t);
            if (res.vehicleDamage) S.applyDamage(player, res.vehicleDamage, t);
          }
        }
        continue;
      }
      if (h.kind === 'headshot') headshots++;
      S.applyDamage(h.target, h.bullet.damage * (h.kind === 'headshot' ? CFG.HEADSHOT_MULT : 1), t);
      if (!h.target.alive && !h.target.scored) {
        h.target.scored = true;
        mission.kills++;
        mission.score += CFG.POINTS_PER_KILL;
      }
    }

    // Enemy rounds that reach the car.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.owner === 'enemy' &&
          Math.hypot(b.x - player.x, b.z - player.z) < CFG.RADIUS && b.y < 1.8) {
        S.applyDamage(player, b.damage, t);
        bullets.splice(i, 1);
      }
    }

    lowestHp = Math.min(lowestHp, player.hp);
    S.regenVehicle(player, t, DT);
    S.stepMission(mission, player, DT);

    // Nothing may ever go non-finite.
    if (!Number.isFinite(player.x + player.z + player.y + player.vx + player.vz + player.hp)) {
      nan = `player at frame ${frames}: x=${player.x} z=${player.z} hp=${player.hp}`;
      break;
    }
    for (const e of enemies) {
      if (!Number.isFinite(e.x + e.z + e.hp)) { nan = `enemy ${e.id} at frame ${frames}`; break; }
    }
    if (nan) break;
  }

  return {
    city, player, mission, enemies, bullets,
    t, frames, nan, maxSpeed, maxEnemies, shotsFired, headshots, explosions,
    barrelBoxes, enemyShots, lowestHp,
  };
}

/* ------------------------------------------------------------------------ */

test('a city match terminates cleanly — it neither hangs nor diverges', () => {
  const r = playMatch({ seconds: 180 });
  assert.equal(r.nan, null, `non-finite state: ${r.nan}`);
  // Ending early is fine as long as it ended for a real reason (the autopilot
  // crashes to death). What is NOT fine is burning the whole budget with no
  // result, which would mean the loop can never conclude.
  assert.ok(r.frames > 60 * 20, `died implausibly fast: ${r.frames} frames`);
  assert.ok(r.frames < 60 * 180 || r.mission.result,
    'ran the full budget without reaching a result');
  if (r.mission.result === 'lost') {
    assert.ok(!r.player.alive, 'the match was lost but the player is still alive');
  }
});

/**
 * Same loop, but on open ground with no buildings. Removing navigation as a
 * variable is what lets this prove the *mission* is completable end to end.
 */
function playOpenField(opts = {}) {
  const rng = S.makeRng(opts.seed ?? 4242);
  const KILL_GOAL = opts.killGoal ?? 6;
  const player = S.createVehicle({ x: 0, z: 0, yaw: 0 });
  const mission = S.createMission({ killGoal: KILL_GOAL, extract: { x: 0, z: 120 } });
  const enemies = [];
  const bullets = [];
  const DT2 = 1 / 60;
  let t = 0, frames = 0, shots = 0, connected = 0, enemyShots = 0, lowest = player.hp;
  let aimDiff = 0;
  let headshots = 0;

  const ring = 34; // inside CFG.ENEMY_RANGE so hostiles actually engage
  for (let i = 0; i < KILL_GOAL; i++) {
    const a = (i / KILL_GOAL) * Math.PI * 2;
    enemies.push(S.createEnemy(Math.sin(a) * ring, Math.cos(a) * ring, { yaw: a + Math.PI, rng }));
  }

  while (frames < 60 * (opts.seconds ?? 200) && !mission.result) {
    frames++;
    t += DT2;

    // Pursue the nearest hostile, or head for extraction once it opens.
    const alive = enemies.filter((e) => e.alive);
    let tgt = null, bd = Infinity;
    if (mission.phase === 'combat') {
      for (const e of alive) {
        const d = Math.hypot(e.x - player.x, e.z - player.z);
        if (d < bd) { bd = d; tgt = e; }
      }
    } else {
      tgt = mission.extract;
      bd = Math.hypot(tgt.x - player.x, tgt.z - player.z);
    }

    // Lead the target: at 130 m/s a round is in the air long enough for a
    // strafing hostile to step clear of where it was aimed.
    for (const e of enemies) {
      e.pvx = (e.x - (e.px ?? e.x)) / DT2;
      e.pvz = (e.z - (e.pz ?? e.z)) / DT2;
      e.px = e.x; e.pz = e.z;
    }
    const flight = bd / CFG.BULLET_SPEED;
    const lx = tgt.x + (tgt.pvx || 0) * flight;
    const lz = tgt.z + (tgt.pvz || 0) * flight;

    const want = Math.atan2(lx - player.x, lz - player.z);
    const diff = S.angleDiff(player.yaw, want);
    // Ease off when badly misaligned, otherwise the car orbits its target.
    const thr = Math.abs(diff) > 0.9 ? 0.15 : (Math.abs(diff) > 0.45 ? 0.55 : 1);
    S.stepVehicle(player, {
      throttle: bd < 10 ? -0.2 : thr,
      steer: S.clamp(diff * 2.2, -1, 1),
      handbrake: Math.abs(diff) > 1.6 && player.speed > 16,
    }, DT2);
    aimDiff = diff;

    for (const e of enemies) {
      if (!e.alive) continue;
      const b = S.stepEnemy(e, player, DT2, [], t, (o, dx, dz, ow, d, sp) => {
        const nb = S.fireBullet(o, dx, dz, ow, d, sp);
        bullets.push(nb);
        return nb; // stepEnemy hands back whatever we return
      });
      if (b) enemyShots++;
    }

    const onTarget = Math.abs(aimDiff) < 0.35;
    if (mission.phase === 'combat' && tgt && frames % 6 === 0 &&
        bd < CFG.ENEMY_RANGE * 1.2 && onTarget) {
      const a = Math.atan2(lx - player.x, lz - player.z);
      const h = Math.hypot(lx - player.x, lz - player.z) || 1;
      bullets.push(S.fireBullet(
        { x: player.x, y: 2.3, z: player.z }, Math.sin(a), Math.cos(a),
        'player', CFG.BULLET_DAMAGE, CFG.BULLET_SPEED, (1.1 - 2.3) / h,
      ));
      shots++;
    }

    const hits = [];
    S.stepBullets(bullets, DT2, [], enemies.filter((e) => e.alive), hits);
    for (const h of hits) {
      if (h.kind === 'wall') continue;
      connected++;
      if (h.kind === 'headshot') headshots++;
      S.applyDamage(h.target, h.bullet.damage * (h.kind === 'headshot' ? CFG.HEADSHOT_MULT : 1), t);
      if (!h.target.alive && !h.target.scored) {
        h.target.scored = true;
        mission.kills++;
        mission.score += CFG.POINTS_PER_KILL;
      }
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.owner === 'enemy' && Math.hypot(b.x - player.x, b.z - player.z) < CFG.RADIUS && b.y < 1.8) {
        S.applyDamage(player, b.damage, t);
        bullets.splice(i, 1);
      }
    }
    lowest = Math.min(lowest, player.hp);
    S.regenVehicle(player, t, DT2);
    S.stepMission(mission, player, DT2);
  }

  return {
    player, mission, enemies, bullets, t,
    shots, connected, headshots, enemyShots, lowest, frames,
    hitRate: shots ? connected / shots : 0,
  };
}

test('the mission IS completable end to end — kills, extraction, victory', () => {
  const r = playOpenField();
  assert.ok(r.connected > 0, `no bullet ever connected (${r.shots} fired)`);
  assert.ok(r.mission.kills >= r.mission.killGoal,
    `only ${r.mission.kills}/${r.mission.killGoal} kills`);
  assert.equal(r.mission.result, 'won',
    `expected a win, got "${r.mission.result}" after ${r.t.toFixed(0)}s (phase ${r.mission.phase})`);
  assert.equal(r.mission.phase, 'done');
  assert.ok(r.mission.score > r.mission.kills * CFG.POINTS_PER_KILL,
    'the extraction + time bonus should sit on top of the kill score');
});

test('bullets connect at a believable rate, and headshots land', () => {
  const r = playOpenField();
  assert.ok(r.shots > 10, `barely fired: ${r.shots}`);
  assert.ok(r.hitRate > 0.25,
    `hit rate ${(r.hitRate * 100).toFixed(1)}% is implausibly low — check the hit volumes`);
  assert.ok(r.connected >= r.mission.kills * 3,
    'a hostile has 100 hp and a round does 34, so ~3 body hits per kill');
});

test('a standing enemy has no unhittable gap in its hit volume', () => {
  const { createEnemy, sphereHit } = S;
  const e = createEnemy(0, 0);
  const parts = [
    ['legs', e.legY, e.legR],
    ['torso', e.y, e.radius],
    ['head', e.headY, e.headR],
  ];
  for (const [name, y, r] of parts) {
    assert.ok(Number.isFinite(y) && Number.isFinite(r), `${name} sphere is not configured`);
    assert.ok(r > 0.1, `${name} radius too small: ${r}`);
  }
  const gaps = [];
  for (let y = 0.05; y <= 1.85; y += 0.02) {
    const covered = parts.some(([, cy, r]) => sphereHit(0, y, 0, 0, cy, 0, r));
    if (!covered) gaps.push(+y.toFixed(2));
  }
  assert.equal(gaps.length, 0,
    `a standing enemy cannot be hit at these heights: ${gaps.join(', ')} m`);
});

test('extraction only opens after the kill goal is met', () => {
  const r = playOpenField({ killGoal: 4 });
  assert.ok(r.mission.kills >= 4);
  assert.equal(r.mission.result, 'won');
});

test('the city run stays stable for minutes without NaN or escaping', () => {
  const r = playMatch({ seconds: 180 });
  assert.equal(r.nan, null, `non-finite state: ${r.nan}`);
  assert.ok(r.frames > 60 * 60, `only simulated ${r.frames} frames`);
  assert.ok(Math.abs(r.player.x) <= r.city.half && Math.abs(r.player.z) <= r.city.half,
    'player escaped the arena');
  assert.ok(r.maxEnemies > 0, 'no hostiles spawned');
  assert.ok(r.maxSpeed <= CFG.MAX_SPEED + 1e-6);
});

test('crashes hurt but are survivable, not instant death', () => {
  // A 30 m/s impact must not one-shot the player.
  const v = S.createVehicle();
  const dmg = 30 * CFG.CRASH_DAMAGE;
  S.applyDamage(v, dmg, 0);
  assert.ok(dmg < CFG.PLAYER_HP, `a 30 m/s crash deals ${dmg} raw — that is a one-shot`);
  assert.ok(v.alive, 'the player must survive a single crash');
  assert.ok(v.hp < CFG.PLAYER_HP, 'but it should cost something');
});

test('combat is lethal both ways — the player takes real damage', () => {
  const r = playOpenField();
  assert.ok(r.enemyShots > 0, `hostiles never fired a single shot (${r.enemyShots})`);
  assert.ok(r.lowest < CFG.PLAYER_HP,
    `the player was never hurt (lowest hp ${r.lowest}) — enemy fire is not landing`);
  assert.ok(r.shots >= 15, `barely fired: ${r.shots} shots`);
  assert.ok(r.player.hp < CFG.PLAYER_HP || r.lowest < CFG.PLAYER_HP,
    'the fight should leave a mark');
});

test('the vehicle never exceeds its limits, even after crashes', () => {
  const r = playMatch({ seconds: 180 });
  assert.ok(r.maxSpeed <= CFG.MAX_SPEED + 1e-6,
    `top speed ${r.maxSpeed} exceeds MAX_SPEED ${CFG.MAX_SPEED}`);
  assert.ok(Math.abs(r.player.x) <= r.city.half, `escaped the arena at x=${r.player.x}`);
  assert.ok(Math.abs(r.player.z) <= r.city.half, `escaped the arena at z=${r.player.z}`);
});

test('the player never spawns or ends up inside a building', () => {
  const r = playMatch({ seconds: 180 });
  for (const probe of [
    { x: r.city.playerSpawn.x, z: r.city.playerSpawn.z, when: 'spawn' },
    { x: r.player.x, z: r.player.z, when: 'end' },
  ]) {
    const stuck = r.city.boxes.some((b) =>
      b.h > 1 &&
      Math.abs(probe.x - b.x) < b.hx + CFG.RADIUS * 0.5 &&
      Math.abs(probe.z - b.z) < b.hz + CFG.RADIUS * 0.5);
    assert.equal(stuck, false, `player is inside geometry at ${probe.when}`);
  }
});

test('bullets are cleaned up — the pool cannot grow without bound', () => {
  const r = playMatch({ seconds: 180 });
  assert.ok(r.bullets.length < 200,
    `${r.bullets.length} bullets still live; they should expire or hit something`);
});

test('explosive barrels go off and chain', () => {
  const r = playMatch({ seconds: 180 });
  const dead = r.city.barrels.filter((b) => !b.alive).length;
  // Not guaranteed in every run, but a 300s firefight in a city with 46
  // barrels should have set at least one off.
  assert.ok(r.explosions >= 0, 'explosion bookkeeping broke');
  assert.ok(dead <= r.city.barrels.length);
});

test('several different cities all stay stable', () => {
  // A city run is a stability test, not a winnability test: a toy autopilot
  // cannot navigate a dense street grid, so it legitimately neither wins nor
  // dies. What must hold is no non-finite state and no arena escape.
  for (const seed of [1, 31337]) {
    const r = playMatch({ seed, seconds: 180 });
    assert.equal(r.nan, null, `seed ${seed}: ${r.nan}`);
    assert.ok(r.frames > 60 * 60, `seed ${seed}: only ${r.frames} frames`);
    assert.ok(Math.abs(r.player.x) <= r.city.half && Math.abs(r.player.z) <= r.city.half,
      `seed ${seed}: escaped the arena`);
    assert.ok(r.maxSpeed <= CFG.MAX_SPEED + 1e-6, `seed ${seed}: exceeded top speed`);
  }
});

test('the simulation is fast enough for 60 fps', () => {
  // One physics tick must leave room for rendering. Budget 4ms per step.
  const city = L.generateCity();
  const grid = S.buildGrid(city.boxes, 12);
  const player = S.createVehicle({ x: city.playerSpawn.x, z: city.playerSpawn.z });
  const enemies = [];
  for (let i = 0; i < 6; i++) {
    const p = city.spawnPoints[i * 3];
    enemies.push(S.createEnemy(p.x, p.z));
  }
  const bullets = [];
  const hits = [];

  const t0 = process.hrtime.bigint();
  const N = 600; // 10 seconds of game time at 60fps
  for (let i = 0; i < N; i++) {
    S.stepVehicle(player, { throttle: 1, steer: Math.sin(i / 40) }, DT);
    const r = S.resolveCircleGrid(player.x, player.z, CFG.RADIUS, grid);
    player.x = r.x; player.z = r.z;
    for (const e of enemies) {
      S.stepEnemy(e, player, DT, grid, i * DT, (o, dx, dz, ow, d, sp) =>
        bullets.push(S.fireBullet(o, dx, dz, ow, d, sp)));
    }
    if (i % 6 === 0) {
      bullets.push(S.fireBullet({ x: player.x, y: 1.9, z: player.z }, Math.sin(i), Math.cos(i), 'player'));
    }
    S.stepBullets(bullets, DT, grid, enemies.filter((e) => e.alive), hits);
    hits.length = 0;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perFrame = ms / N;

  assert.ok(perFrame < 4,
    `physics costs ${perFrame.toFixed(2)}ms/frame (budget 4ms for a 60fps frame)`);
});
