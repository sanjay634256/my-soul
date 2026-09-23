/**
 * FIRE ZONE — pure simulation core.
 *
 * No THREE, no DOM, no globals. Everything that decides *what happens* lives
 * here so it runs unchanged under Node for testing. Rendering is a separate
 * layer that reads this state and draws it.
 *
 * Units: 1 unit = 1 metre, speeds in m/s, angles in radians, +Z is north.
 */

/* ============================== tuning ================================= */

export const CFG = {
  WORLD_HALF: 240, // playable area is 480x480, centred on origin

  // --- vehicle -------------------------------------------------------
  MAX_SPEED: 46, // m/s  (~165 km/h)
  MAX_REVERSE: 14,
  ENGINE_POWER: 22, // m/s^2 at zero speed
  POWER_HEADROOM: 1.15, // >1 so the limiter, not drag, sets top speed
  BRAKE_POWER: 34,
  DRAG: 0.04, // proportional to speed
  QUAD_DRAG: 0.0005, // proportional to speed^2
  ROLLING: 3.5, // constant deceleration when off throttle
  GRIP: 7.5, // lateral velocity bleed per second
  GRIP_HANDBRAKE: 1.1, // drifting
  HANDBRAKE_DRAG: 0.9,
  STEER_MAX: 0.62, // rad, at low speed
  STEER_SPEED_FALLOFF: 0.55, // how much steering authority is lost at top speed
  YAW_RATE: 2.6, // rad/s multiplier
  DRIFT_YAW: 0.055, // extra yaw from lateral slip while handbraking
  RADIUS: 1.7, // collision radius
  MASS: 1, // relative, used for impact damage
  WHEELBASE: 2.6,

  // --- ballistics ----------------------------------------------------
  BULLET_SPEED: 130,
  BULLET_LIFE: 1.9, // seconds
  BULLET_DAMAGE: 34,
  BULLET_RADIUS: 0.45,
  FIRE_INTERVAL: 0.095, // s between player shots
  RELOAD_TIME: 1.8,
  MAG_SIZE: 40,
  SPREAD: 0.018, // rad

  // --- enemies -------------------------------------------------------
  ENEMY_HP: 100,
  ENEMY_SPEED: 7.5,
  ENEMY_FIRE_INTERVAL: 1.15,
  ENEMY_RANGE: 46,
  ENEMY_BULLET_SPEED: 62,
  ENEMY_BULLET_DAMAGE: 7,
  ENEMY_BULLET_LIFE: 2.2,
  ENEMY_KEEP_DISTANCE: 18,
  ENEMY_SEEK_TURN: 2.2, // rad/s
  ENEMY_ACCURACY: 0.075, // rad of aim jitter

  // --- player --------------------------------------------------------
  PLAYER_HP: 100,
  PLAYER_ARMOR: 50,
  ARMOR_ABSORB: 0.6, // fraction of damage soaked by armor
  REGEN_DELAY: 6, // s without damage before regen starts
  REGEN_RATE: 9, // hp/s

  // --- damage / scoring ----------------------------------------------
  // Damage per (m/s) of speed lost in a crash. A 30 m/s head-on hit costs
  // ~39 raw, ~16 after armor — survivable, but you feel it.
  CRASH_DAMAGE: 1.3,
  EXPLOSION_RADIUS: 11,
  EXPLOSION_DAMAGE: 120,
  BARREL_HP: 30,
  POINTS_PER_KILL: 100,
  POINTS_PER_BARREL: 25,
  HEADSHOT_MULT: 2,

  // --- mission -------------------------------------------------------
  EXTRACT_RADIUS: 16,
  EXTRACT_HOLD: 4, // seconds inside the zone to win
};

/* ============================ small maths ============================== */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const len2 = (x, z) => Math.sqrt(x * x + z * z);

/** Signed shortest difference between two angles, in (-PI, PI]. */
export function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Deterministic PRNG so a seeded run always plays out the same way. */
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ============================== vehicle ================================ */

export function createVehicle(opts = {}) {
  return {
    x: opts.x ?? 0,
    z: opts.z ?? 0,
    yaw: opts.yaw ?? 0,
    vx: 0,
    vz: 0,
    speed: 0, // scalar |v|
    forwardSpeed: 0, // signed, along heading
    lateralSpeed: 0, // signed, across heading
    steer: 0, // current visual steering angle
    wheelSpin: 0, // accumulated rotation for the wheel meshes
    hp: opts.hp ?? CFG.PLAYER_HP,
    armor: opts.armor ?? CFG.PLAYER_ARMOR,
    alive: true,
    grounded: true,
    // vertical motion for ramps/jumps
    y: 0,
    vy: 0,
    lastDamageAt: -Infinity,
  };
}

/** Heading unit vector. yaw 0 faces +Z. */
export function headingOf(yaw) {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}
export function rightOf(yaw) {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/**
 * Advance the vehicle by dt.
 * inp = { throttle: -1..1, steer: -1..1 (left negative), handbrake: bool }
 */
export function stepVehicle(v, inp, dt) {
  if (!v.alive) return;
  dt = clamp(dt, 0, 0.05);

  const fwd = headingOf(v.yaw);
  const rgt = rightOf(v.yaw);

  // Decompose velocity into the car's own frame.
  let vF = v.vx * fwd.x + v.vz * fwd.z;
  let vL = v.vx * rgt.x + v.vz * rgt.z;

  const throttle = clamp(inp.throttle || 0, -1, 1);
  const steerIn = clamp(inp.steer || 0, -1, 1);
  const handbrake = !!inp.handbrake;

  // --- longitudinal -------------------------------------------------
  if (throttle > 0) {
    // Power falls off as we approach top speed.
    vF += CFG.ENGINE_POWER * throttle * dt *
      Math.max(0, CFG.POWER_HEADROOM - vF / CFG.MAX_SPEED);
  } else if (throttle < 0) {
    if (vF > 1) {
      vF += CFG.BRAKE_POWER * throttle * dt; // braking
    } else {
      vF += CFG.ENGINE_POWER * 0.55 * throttle * dt *
        Math.max(0, 1 - Math.abs(vF) / CFG.MAX_REVERSE);
    }
  }

  vF -= vF * CFG.DRAG * dt;
  vF -= Math.sign(vF) * vF * vF * CFG.QUAD_DRAG * dt;
  if (throttle === 0) {
    const roll = CFG.ROLLING * dt;
    if (Math.abs(vF) <= roll) vF = 0;
    else vF -= Math.sign(vF) * roll;
  }
  vF = clamp(vF, -CFG.MAX_REVERSE, CFG.MAX_SPEED);

  // --- lateral grip -------------------------------------------------
  const grip = handbrake ? CFG.GRIP_HANDBRAKE : CFG.GRIP;
  vL -= vL * clamp(grip * dt, 0, 1);
  if (handbrake) vF -= vF * clamp(CFG.HANDBRAKE_DRAG * dt, 0, 1);

  // --- steering -----------------------------------------------------
  // No steering when parked; authority fades with speed.
  const speedFactor = clamp(Math.abs(vF) / 6, 0, 1);
  const authority = 1 - CFG.STEER_SPEED_FALLOFF *
    clamp(Math.abs(vF) / CFG.MAX_SPEED, 0, 1);
  const targetSteer = steerIn * CFG.STEER_MAX * authority;
  v.steer = lerp(v.steer, targetSteer, clamp(dt * 12, 0, 1));

  const dirSign = vF < -0.1 ? -1 : 1;
  v.yaw += v.steer * speedFactor * dirSign * CFG.YAW_RATE * dt;
  if (handbrake) v.yaw += steerIn * vL * CFG.DRIFT_YAW * dt;

  // --- back to world frame ------------------------------------------
  const f2 = headingOf(v.yaw);
  const r2 = rightOf(v.yaw);
  v.vx = f2.x * vF + r2.x * vL;
  v.vz = f2.z * vF + r2.z * vL;
  v.forwardSpeed = vF;
  v.lateralSpeed = vL;
  v.speed = len2(v.vx, v.vz);

  v.x += v.vx * dt;
  v.z += v.vz * dt;

  // --- vertical (ramps / jumps) --------------------------------------
  v.vy -= 26 * dt; // gravity
  v.y += v.vy * dt;
  if (v.y <= 0) {
    if (v.vy < -14 && v.grounded === false) {
      // hard landing hurts
      applyDamage(v, (-v.vy - 14) * 2.2, 0);
    }
    v.y = 0;
    v.vy = 0;
    v.grounded = true;
  } else {
    v.grounded = false;
  }

  // Wheel spin for the mesh.
  v.wheelSpin += (vF / 0.42) * dt;
}

/** Damage that bypasses nothing — armor soaks a share. Returns damage dealt. */
export function applyDamage(target, amount, now) {
  if (!target.alive || amount <= 0) return 0;
  let dmg = amount;
  if (target.armor > 0) {
    const soaked = Math.min(target.armor, dmg * CFG.ARMOR_ABSORB);
    target.armor -= soaked;
    dmg -= soaked;
  }
  target.hp -= dmg;
  target.lastDamageAt = now;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
  }
  return amount;
}

/** Passive health regen once the player has been out of trouble a while. */
export function regenVehicle(v, now, dt) {
  if (!v.alive) return 0;
  if (now - v.lastDamageAt < CFG.REGEN_DELAY) return 0;
  if (v.hp >= CFG.PLAYER_HP) return 0;
  const healed = Math.min(CFG.REGEN_RATE * dt, CFG.PLAYER_HP - v.hp);
  v.hp += healed;
  return healed;
}

/* ============================ collisions =============================== */

/**
 * Push a circle out of every AABB it overlaps.
 * boxes = [{ x, z, hx, hz, h }]  (centre + half extents)
 * Returns the strongest impact so the caller can apply crash damage.
 */
export function resolveCircleAABBs(px, pz, radius, boxes, maxY = Infinity) {
  let worst = null;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.h !== undefined && b.h <= 0.01) continue;
    if (maxY !== Infinity && b.baseY !== undefined && b.baseY > maxY) continue;

    const nx = clamp(px, b.x - b.hx, b.x + b.hx);
    const nz = clamp(pz, b.z - b.hz, b.z + b.hz);
    let dx = px - nx;
    let dz = pz - nz;
    let d2 = dx * dx + dz * dz;

    if (d2 >= radius * radius) continue;

    const d = Math.sqrt(d2);
    let ux, uz, depth;
    if (d < 1e-6) {
      // Centre is inside the box: eject along the shallowest axis, and the
      // penetration is the distance to that face plus the radius.
      const ox = b.hx + radius - Math.abs(px - b.x);
      const oz = b.hz + radius - Math.abs(pz - b.z);
      if (ox < oz) { ux = px < b.x ? -1 : 1; uz = 0; depth = ox; }
      else { ux = 0; uz = pz < b.z ? -1 : 1; depth = oz; }
    } else {
      const inv = 1 / d;
      ux = dx * inv;
      uz = dz * inv;
      depth = radius - d;
    }

    px += ux * depth;
    pz += uz * depth;

    if (!worst || depth > worst.depth) {
      worst = { depth, nx: ux, nz: uz, box: b };
    }
  }
  return { x: px, z: pz, impact: worst };
}

/**
 * Uniform spatial hash over the static geometry. A city has a few hundred
 * boxes; testing every bullet sub-step against all of them would be far too
 * slow, so we bucket them once and only test nearby cells.
 */
export function buildGrid(boxes, cellSize = 10) {
  const map = new Map();
  for (const b of boxes) {
    const x0 = Math.floor((b.x - b.hx) / cellSize);
    const x1 = Math.floor((b.x + b.hx) / cellSize);
    const z0 = Math.floor((b.z - b.hz) / cellSize);
    const z1 = Math.floor((b.z + b.hz) / cellSize);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i + ',' + j;
        let a = map.get(k);
        if (!a) map.set(k, (a = []));
        a.push(b);
      }
    }
  }
  return { grid: true, map, cellSize };
}

/** True for a spatial hash, false for a plain box array. */
export function isGrid(o) {
  return !!o && o.grid === true;
}

/** Every box whose cell overlaps the query circle. */
export function queryGrid(grid, x, z, radius) {
  const cs = grid.cellSize;
  const out = [];
  const seen = new Set();
  const x0 = Math.floor((x - radius) / cs), x1 = Math.floor((x + radius) / cs);
  const z0 = Math.floor((z - radius) / cs), z1 = Math.floor((z + radius) / cs);
  for (let i = x0; i <= x1; i++) {
    for (let j = z0; j <= z1; j++) {
      const a = grid.map.get(i + ',' + j);
      if (!a) continue;
      for (const b of a) if (!seen.has(b)) { seen.add(b); out.push(b); }
    }
  }
  return out;
}

/** resolveCircleAABBs, but using the grid for the broad phase. */
export function resolveCircleGrid(px, pz, radius, grid, maxY = Infinity) {
  return resolveCircleAABBs(px, pz, radius, queryGrid(grid, px, pz, radius + 0.1), maxY);
}

/** Kill the velocity component going into a surface; return energy lost. */
export function reflectVelocity(v, nx, nz, restitution = 0.25) {
  const vn = v.vx * nx + v.vz * nz;
  if (vn >= 0) return 0; // already moving away
  const before = len2(v.vx, v.vz);
  v.vx -= (1 + restitution) * vn * nx;
  v.vz -= (1 + restitution) * vn * nz;
  return before - len2(v.vx, v.vz);
}

/** Is a point inside the playable area? */
export function inBounds(x, z) {
  const h = CFG.WORLD_HALF;
  return x > -h && x < h && z > -h && z < h;
}

/* ============================ ballistics =============================== */

/** Max distance a bullet advances per collision sub-step, in metres. */
const BULLET_SUBSTEP = 0.25;

let bulletId = 1;

/**
 * Spawn a bullet. `dirY` is optional but the roof turret sits well above a
 * standing enemy, so without a vertical component every player round would
 * fly clean over their heads. Direction is normalised in 3D.
 */
export function fireBullet(o, dirX, dirZ, owner, damage, speed, dirY = 0) {
  const l = Math.sqrt(dirX * dirX + dirZ * dirZ + dirY * dirY) || 1;
  const sp = speed ?? CFG.BULLET_SPEED;
  return {
    id: bulletId++,
    x: o.x, y: o.y ?? 1.2, z: o.z,
    vx: (dirX / l) * sp,
    vy: (dirY / l) * sp,
    vz: (dirZ / l) * sp,
    life: CFG.BULLET_LIFE,
    damage: damage ?? CFG.BULLET_DAMAGE,
    owner, // 'player' | 'enemy'
    dead: false,
    headshot: false,
  };
}

/** Sphere test used for hitting characters. */
export function sphereHit(bx, by, bz, cx, cy, cz, r) {
  const dx = bx - cx, dy = by - cy, dz = bz - cz;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

/**
 * Advance every bullet one step, swept against the world.
 * `hits` receives { bullet, target, kind } for the caller to score.
 * targets = [{ x, y, z, radius, headY, headR, alive, ref }]
 */
export function stepBullets(bullets, dt, boxes, targets, hits) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    if (b.life <= 0) {
      bullets.splice(i, 1);
      continue;
    }

    // Sub-step small enough that a bullet cannot skip over the thinnest hit
    // sphere (a head is only 0.26m across).
    const travel = len2(b.vx, b.vz) * dt;
    const steps = clamp(Math.ceil(travel / BULLET_SUBSTEP), 1, 64);
    const sdt = dt / steps;
    let consumed = false;

    for (let s = 0; s < steps && !consumed; s++) {
      b.x += b.vx * sdt;
      b.z += b.vz * sdt;
      b.y += b.vy * sdt;

      if (b.y < 0 || !inBounds(b.x, b.z)) {
        bullets.splice(i, 1);
        consumed = true;
        break;
      }

      // Solid geometry (broad phase via the grid when one is supplied).
      const near = isGrid(boxes)
        ? queryGrid(boxes, b.x, b.z, CFG.BULLET_RADIUS + 0.1)
        : boxes;
      const blocked = resolveCircleAABBs(b.x, b.z, CFG.BULLET_RADIUS, near, b.y);
      if (blocked.impact) {
        hits.push({ bullet: b, kind: 'wall', x: b.x, y: b.y, z: b.z, box: blocked.impact.box });
        bullets.splice(i, 1);
        consumed = true;
        break;
      }

      // Characters.
      for (let t = 0; t < targets.length; t++) {
        const tg = targets[t];
        if (!tg.alive) continue;
        if (tg.owner === b.owner) continue;
        const isHead = sphereHit(b.x, b.y, b.z, tg.x, tg.headY, tg.z, tg.headR);
        const isBody = !isHead && (
          sphereHit(b.x, b.y, b.z, tg.x, tg.y, tg.z, tg.radius) ||
          (tg.legY !== undefined && sphereHit(b.x, b.y, b.z, tg.x, tg.legY, tg.z, tg.legR))
        );
        if (isHead || isBody) {
          b.headshot = isHead;
          hits.push({ bullet: b, kind: isHead ? 'headshot' : 'body', target: tg });
          bullets.splice(i, 1);
          consumed = true;
          break;
        }
      }
    }
  }
}

/* ============================== enemies ================================ */

let enemyId = 1;

/**
 * Create a hostile. Pass `opts.rng` for a deterministic run (tests, replays);
 * it defaults to Math.random for normal play.
 */
export function createEnemy(x, z, opts = {}) {
  const rng = opts.rng || Math.random;
  return {
    id: enemyId++,
    rng,
    x, z,
    y: 1.05, // torso centre height — NOT the ground, see the spheres below
    yaw: opts.yaw ?? 0,
    hp: opts.hp ?? CFG.ENEMY_HP,
    alive: true,
    cooldown: rng() * CFG.ENEMY_FIRE_INTERVAL,
    alert: false,
    strafe: rng() < 0.5 ? 1 : -1,
    strafeTimer: 0,
    hitFlash: 0,
    // Three overlapping spheres: legs, torso, head. A single body sphere
    // resting on the ground leaves the whole chest as a bullet-shaped hole,
    // and shots pass clean through a standing enemy.
    radius: 0.5,
    legY: 0.42,
    legR: 0.4,
    headY: 1.62,
    headR: 0.26,
    owner: 'enemy',
    inVehicle: !!opts.inVehicle,
  };
}

/**
 * Very small tactical AI: close to engagement range, strafe, shoot on
 * cooldown when roughly facing the player and in line of sight.
 */
export function stepEnemy(e, player, dt, boxes, now, wantShot) {
  if (!e.alive) return null;
  e.hitFlash = Math.max(0, e.hitFlash - dt * 4);

  const dx = player.x - e.x;
  const dz = player.z - e.z;
  const dist = len2(dx, dz);
  const toPlayer = Math.atan2(dx, dz);

  if (dist < CFG.ENEMY_RANGE * 1.6) e.alert = true;
  e.cooldown -= dt;

  // --- movement -----------------------------------------------------
  if (e.alert && player.alive) {
    const desired = toPlayer + (Math.PI / 2) * e.strafe;
    let moveX = 0, moveZ = 0;

    if (dist > CFG.ENEMY_KEEP_DISTANCE * 1.25) {
      moveX = dx / dist; moveZ = dz / dist;
    } else if (dist < CFG.ENEMY_KEEP_DISTANCE * 0.7) {
      moveX = -dx / dist; moveZ = -dz / dist;
    } else {
      moveX = Math.sin(desired); moveZ = Math.cos(desired);
    }

    e.x += moveX * CFG.ENEMY_SPEED * dt;
    e.z += moveZ * CFG.ENEMY_SPEED * dt;

    // Don't walk through buildings.
    const push = resolveCircleAABBs(e.x, e.z, e.radius, boxes);
    e.x = push.x; e.z = push.z;

    // Keep inside the arena.
    const h = CFG.WORLD_HALF - 2;
    e.x = clamp(e.x, -h, h);
    e.z = clamp(e.z, -h, h);

    // Turn to face, at a limited rate.
    e.yaw += clamp(angleDiff(e.yaw, toPlayer), -CFG.ENEMY_SEEK_TURN * dt, CFG.ENEMY_SEEK_TURN * dt);

    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      const rng = e.rng || Math.random;
      e.strafeTimer = 1.6 + rng() * 2.2;
      if (rng() < 0.5) e.strafe *= -1;
    }
  }

  // --- shooting -----------------------------------------------------
  if (!e.alert || !player.alive || e.cooldown > 0) return null;
  if (dist > CFG.ENEMY_RANGE) return null;
  if (Math.abs(angleDiff(e.yaw, toPlayer)) > 0.7) return null;
  if (!hasLineOfSight(e, player, boxes)) return null;

  const frng = e.rng || Math.random;
  e.cooldown = CFG.ENEMY_FIRE_INTERVAL * (0.8 + frng() * 0.5);
  const jitter = (frng() * 2 - 1) * CFG.ENEMY_ACCURACY;
  const aim = toPlayer + jitter;
  return wantShot(
    { x: e.x, y: 1.35, z: e.z },
    Math.sin(aim), Math.cos(aim),
    'enemy', CFG.ENEMY_BULLET_DAMAGE, CFG.ENEMY_BULLET_SPEED,
  );
}

/** Cheap LOS test: march between two points and stop if we enter a box. */
/** Boxes that could block a ray, given either an array or a spatial grid. */
function blockersNear(boxes, x, z) {
  return isGrid(boxes) ? queryGrid(boxes, x, z, 1) : boxes;
}

export function hasLineOfSight(a, b, boxes, step = 1.5) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = len2(dx, dz);
  if (dist < 1e-3) return true;
  const n = Math.max(1, Math.ceil(dist / step));
  const ux = dx / n, uz = dz / n;
  let x = a.x, z = a.z;
  for (let i = 0; i < n; i++) {
    x += ux; z += uz;
    const near = blockersNear(boxes, x, z);
    for (let j = 0; j < near.length; j++) {
      const bo = near[j];
      if (bo.h !== undefined && bo.h < 1.2) continue; // crates don't block sight
      if (x > bo.x - bo.hx && x < bo.x + bo.hx && z > bo.z - bo.hz && z < bo.z + bo.hz) {
        return false;
      }
    }
  }
  return true;
}

/* ============================== mission ================================ */

export function createMission(opts = {}) {
  return {
    phase: 'combat', // combat -> extract -> done | failed
    kills: 0,
    killGoal: opts.killGoal ?? 12,
    barrels: 0,
    score: 0,
    extract: opts.extract ?? { x: 0, z: 0 },
    holdTime: 0,
    time: 0,
    result: null,
  };
}

export function stepMission(m, player, dt) {
  if (m.result) return m;
  m.time += dt;

  if (!player.alive) {
    m.phase = 'done';
    m.result = 'lost';
    return m;
  }

  if (m.phase === 'combat' && m.kills >= m.killGoal) {
    m.phase = 'extract';
    m.holdTime = 0;
  }

  if (m.phase === 'extract') {
    const d = len2(player.x - m.extract.x, player.z - m.extract.z);
    if (d <= CFG.EXTRACT_RADIUS) {
      m.holdTime += dt;
      if (m.holdTime >= CFG.EXTRACT_HOLD) {
        m.phase = 'done';
        m.result = 'won';
        m.score += 500 + Math.max(0, Math.round((300 - m.time) * 2));
      }
    } else if (m.holdTime > 0) {
      m.holdTime = Math.max(0, m.holdTime - dt * 2);
    }
  }
  return m;
}

/** Radial blast: damages anything within EXPLOSION_RADIUS, falloff by distance. */
export function applyExplosion(cx, cz, targets, vehicle) {
  const out = [];
  for (const t of targets) {
    if (!t.alive) continue;
    const d = len2(t.x - cx, t.z - cz);
    if (d > CFG.EXPLOSION_RADIUS) continue;
    const falloff = 1 - d / CFG.EXPLOSION_RADIUS;
    out.push({ target: t, damage: CFG.EXPLOSION_DAMAGE * falloff, dist: d });
  }
  let vehicleDamage = 0;
  if (vehicle && vehicle.alive) {
    const d = len2(vehicle.x - cx, vehicle.z - cz);
    if (d <= CFG.EXPLOSION_RADIUS) {
      vehicleDamage = CFG.EXPLOSION_DAMAGE * (1 - d / CFG.EXPLOSION_RADIUS);
    }
  }
  return { targets: out, vehicleDamage };
}

/* ============================ minimap maths ============================ */

/**
 * Project world coords into a rotating radar.
 * Returns {x, y} in -1..1 where +y is "ahead of the player".
 */
export function toRadar(wx, wz, px, pz, pyaw, range) {
  const dx = wx - px;
  const dz = wz - pz;
  // Project onto the player's own axes: +y = straight ahead, +x = to the right.
  const ahead = dx * Math.sin(pyaw) + dz * Math.cos(pyaw);
  const right = dx * Math.cos(pyaw) - dz * Math.sin(pyaw);
  return {
    x: clamp(right / range, -1.15, 1.15),
    y: clamp(ahead / range, -1.15, 1.15),
  };
}

export const kmh = (ms) => ms * 3.6;
