/**
 * FIRE ZONE — entry point.
 *
 * Wires the pure simulation (sim.mjs) to the renderer, HUD, audio and input,
 * and owns the frame loop. Physics runs on a fixed timestep so the handling
 * is identical at 30 fps and 144 fps.
 */

import * as THREE from '../vendor/three.module.min.js';
import * as S from './sim.mjs';
import { generateCity } from './layout.mjs';
import { buildWorld, followShadow } from './world.mjs';
import {
  buildCar, buildEnemy, buildBarrel,
  buildBulletPool, buildExplosions, makeMuzzleFlash, pulseFlash,
} from './entities.mjs';
import { createHud } from './hud.mjs';
import { createAudio } from './audio.mjs';
import { createInput } from './input.mjs';

const { CFG } = S;
const FIXED_DT = 1 / 120;

/* ------------------------------- screens ------------------------------- */

const screens = {
  start: document.getElementById('screen-start'),
  pause: document.getElementById('screen-pause'),
  over: document.getElementById('screen-over'),
};
const overTitle = document.getElementById('over-title');
const overStats = document.getElementById('over-stats');

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

/* ------------------------------- renderer ------------------------------ */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x6d5340, 60, 300);

const camera = new THREE.PerspectiveCamera(64, 1, 0.4, 1400);
camera.position.set(0, 8, -14);

/* -------------------------------- world -------------------------------- */

const city = generateCity();
const world = buildWorld(city, renderer);
scene.add(world.group);

const grid = S.buildGrid(city.boxes, 12);

/* ------------------------------- entities ------------------------------ */

const carRig = buildCar({ body: 0x3f4a38 });
scene.add(carRig.group);
const flash = makeMuzzleFlash();
carRig.turret.add(flash.group);

const player = S.createVehicle({
  x: city.playerSpawn.x, z: city.playerSpawn.z, yaw: city.playerSpawn.yaw,
});

const enemyRigs = [];
const enemies = [];
const barrelRigs = [];
for (const b of city.barrels) {
  const rig = buildBarrel();
  rig.group.position.set(b.x, 0, b.z);
  scene.add(rig.group);
  barrelRigs.push({ ref: b, rig, alive: true });
}

const bullets = [];
const bulletPool = buildBulletPool(scene, 260);
const fx = buildExplosions(scene, world.glowTexture);

/* --------------------------------- HUD --------------------------------- */

const hudCanvas = document.getElementById('hud');
const hud = createHud(hudCanvas);

const audio = createAudio();
const input = createInput(canvas);

/* ------------------------------ mission -------------------------------- */

const mission = S.createMission({
  killGoal: 12,
  extract: { x: city.extract.x, z: city.extract.z },
});

const weapon = {
  name: 'M2 .50 CAL',
  mag: CFG.MAG_SIZE,
  cooldown: 0,
  reloading: false,
  reloadProgress: 0,
};

let running = false;
let elapsed = 0;

/* ---------------------------- enemy spawning --------------------------- */

const MAX_ALIVE = 6;

function spawnEnemy() {
  const pts = city.spawnPoints;
  let best = null, bestD = -1;
  for (let i = 0; i < 14; i++) {
    const p = pts[Math.floor(Math.random() * pts.length)];
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d < 26) continue;
    if (d > bestD) { bestD = d; best = p; }
  }
  if (!best) return;
  const e = S.createEnemy(best.x, best.z, {
    yaw: Math.atan2(player.x - best.x, player.z - best.z),
  });
  enemies.push(e);
  const rig = buildEnemy();
  rig.group.position.set(e.x, 0, e.z);
  scene.add(rig.group);
  enemyRigs.push({ ref: e, rig });
}

/* -------------------------------- aiming ------------------------------- */

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.35);
const aimPoint = new THREE.Vector3();
let aimYaw = 0;

/**
 * Aim the roof turret at whatever the crosshair is over. Returns the muzzle
 * position AND the world point being aimed at, so the shot can be pitched
 * down at the target instead of flying straight off the horizon.
 */
function updateAim() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, aimPoint);
  const muzzleWorld = new THREE.Vector3();
  carRig.muzzle.getWorldPosition(muzzleWorld);
  if (hit) {
    aimYaw = Math.atan2(aimPoint.x - muzzleWorld.x, aimPoint.z - muzzleWorld.z);
  } else {
    aimYaw = player.yaw;
    aimPoint.set(muzzleWorld.x + Math.sin(aimYaw) * 40, 1.2, muzzleWorld.z + Math.cos(aimYaw) * 40);
  }
  carRig.turret.rotation.y = aimYaw - carRig.group.rotation.y;
  // Pitch the barrel to match.
  const horiz = Math.hypot(aimPoint.x - muzzleWorld.x, aimPoint.z - muzzleWorld.z) || 1;
  carRig.barrelPitch = Math.atan2(muzzleWorld.y - aimPoint.y, horiz);
  return {
    muzzle: { x: muzzleWorld.x, y: muzzleWorld.y, z: muzzleWorld.z },
    aim: { x: aimPoint.x, y: aimPoint.y, z: aimPoint.z },
  };
}

/* -------------------------------- firing ------------------------------- */

function playerShoot(aim) {
  if (weapon.reloading || weapon.mag <= 0) {
    if (weapon.mag <= 0 && !weapon.reloading) startReload();
    return;
  }
  weapon.mag--;
  weapon.cooldown = CFG.FIRE_INTERVAL;

  const jitter = (Math.random() * 2 - 1) * CFG.SPREAD;
  const a = aimYaw + jitter;
  const m = aim.muzzle;
  // Full 3D direction: without the Y term every round clears the target's head.
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  const dy = (aim.aim.y - m.y) / (Math.hypot(aim.aim.x - m.x, aim.aim.z - m.z) || 1);
  const b = S.fireBullet(m, dx, dz, 'player', CFG.BULLET_DAMAGE, CFG.BULLET_SPEED, dy);
  bullets.push(b);
  flash.timer = 0.06;
  audio.shot();

  // Recoil nudge on the camera.
  camShake = Math.min(0.5, camShake + 0.06);
}

function startReload() {
  if (weapon.reloading || weapon.mag === CFG.MAG_SIZE) return;
  weapon.reloading = true;
  weapon.reloadProgress = 0;
  audio.reload();
}

/* ------------------------------- camera -------------------------------- */

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 8, -14);
let camShake = 0;

function updateCamera(dt) {
  const speedNorm = S.clamp(player.speed / CFG.MAX_SPEED, 0, 1);
  const back = 11 + speedNorm * 4.5;
  const up = 4.4 + speedNorm * 1.6;

  const hx = Math.sin(player.yaw), hz = Math.cos(player.yaw);
  const desired = new THREE.Vector3(
    player.x - hx * back,
    up,
    player.z - hz * back,
  );

  // Keep the camera out of walls.
  const push = S.resolveCircleGrid(desired.x, desired.z, 1.6, grid);
  desired.x = push.x;
  desired.z = push.z;

  const k = 1 - Math.pow(0.0016, dt);
  camPos.lerp(desired, k);
  camera.position.copy(camPos);

  camTarget.set(player.x + hx * 6, 1.8, player.z + hz * 6);
  camera.lookAt(camTarget);

  const fov = 64 + speedNorm * 14;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 6);
    camera.updateProjectionMatrix();
  }

  if (camShake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * camShake;
    camera.position.y += (Math.random() - 0.5) * camShake;
    camShake *= Math.pow(0.002, dt);
  } else {
    camShake = 0;
  }
}

/* ------------------------------ explosion ------------------------------ */

function explode(x, z, power = 1) {
  fx.spawn(x, 0.6, z, power);
  audio.explosion(power);
  camShake = Math.min(1.2, camShake + 0.55 * power);

  const targets = enemies.filter((e) => e.alive)
    .map((e) => ({ x: e.x, y: 1.1, z: e.z, alive: true, ref: e, radius: 4 }));
  const res = S.applyExplosion(x, z, targets, player);

  for (const t of res.targets) {
    const e = t.target.ref;
    if (!e || !e.alive) continue;
    S.applyDamage(e, t.damage, elapsed);
    if (!e.alive) killEnemy(e, 'BLAST');
  }
  for (const br of barrelRigs) {
    if (!br.alive) continue;
    const d = Math.hypot(br.ref.x - x, br.ref.z - z);
    if (d < CFG.EXPLOSION_RADIUS) {
      br.ref.hp -= CFG.EXPLOSION_DAMAGE * (1 - d / CFG.EXPLOSION_RADIUS);
      if (br.ref.hp <= 0) destroyBarrel(br);
    }
  }
  if (res.vehicleDamage > 0) {
    S.applyDamage(player, res.vehicleDamage, elapsed);
    hud.hurt();
    audio.hurt();
  }
}

function destroyBarrel(br) {
  br.alive = false;
  br.rig.group.visible = false;
  br.ref.alive = false;
  // Deactivate its collider rather than splicing it out: the spatial grid
  // was built once and would still be pointing at a removed entry.
  const box = city.boxes.find((b) => b.barrel === br.ref);
  if (box) box.h = 0;
  mission.barrels++;
  mission.score += CFG.POINTS_PER_BARREL;
  hud.pushFeed('BARREL DESTROYED  +' + CFG.POINTS_PER_BARREL, '#ffb02e');
  explode(br.ref.x, br.ref.z, 1.15);
}

function killEnemy(e, how) {
  if (e.scored) return;
  e.scored = true;
  mission.kills++;
  mission.score += CFG.POINTS_PER_KILL;
  hud.pushFeed(`HOSTILE DOWN  [${how}]  +${CFG.POINTS_PER_KILL}`, '#35e08a');
  fx.spawn(e.x, 0.8, e.z, 0.7);
  if (mission.kills === mission.killGoal) {
    world.extraction.visible = true;
    hud.pushFeed('EXTRACTION ZONE ACTIVE', '#35e08a');
    audio.pickup();
  }
}

/* ------------------------------ fixed step ----------------------------- */

function physicsStep(dt) {
  const inp = {
    throttle: input.state.throttle,
    steer: input.state.steer,
    handbrake: input.state.handbrake,
  };

  const beforeSpeed = player.speed;
  S.stepVehicle(player, inp, dt);

  // World collision.
  const r = S.resolveCircleGrid(player.x, player.z, CFG.RADIUS, grid, player.y + 0.6);
  player.x = r.x;
  player.z = r.z;
  if (r.impact) {
    const lost = S.reflectVelocity(player, r.impact.nx, r.impact.nz, 0.22);
    const impact = beforeSpeed - player.speed;
    if (impact > 4) {
      S.applyDamage(player, impact * CFG.CRASH_DAMAGE, elapsed);
      hud.hurt();
      audio.hurt();
      camShake = Math.min(1, camShake + impact * 0.02);
      fx.spawn(player.x + r.impact.nx, 0.8, player.z + r.impact.nz, 0.25);
    }
    // Barrels you ram hard enough go off.
    if (r.impact.box && r.impact.box.barrel && impact > 9) {
      r.impact.box.barrel.hp -= impact * 3;
      if (r.impact.box.barrel.hp <= 0) {
        const br = barrelRigs.find((b) => b.ref === r.impact.box.barrel);
        if (br) destroyBarrel(br);
      }
    }
  }

  // Hard arena clamp as a final safety net.
  const lim = city.half - 3;
  player.x = S.clamp(player.x, -lim, lim);
  player.z = S.clamp(player.z, -lim, lim);

  // Enemies.
  for (const e of enemies) {
    if (!e.alive) continue;
    const shot = S.stepEnemy(e, player, dt, city.boxes, elapsed, (o, dx, dz, owner, dmg, sp) => {
      const b = S.fireBullet(o, dx, dz, owner, dmg, sp);
      bullets.push(b);
      audio.enemyShot(Math.hypot(e.x - player.x, e.z - player.z));
      return b;
    });
    void shot;
  }

  // Bullets.
  const targets = enemies.filter((e) => e.alive);
  const hits = [];
  S.stepBullets(bullets, dt, grid, targets, hits);
  resolveHits(hits);

  // Weapon timing.
  weapon.cooldown -= dt;
  if (weapon.reloading) {
    weapon.reloadProgress += dt / CFG.RELOAD_TIME;
    if (weapon.reloadProgress >= 1) {
      weapon.reloading = false;
      weapon.mag = CFG.MAG_SIZE;
      weapon.reloadProgress = 0;
    }
  }

  S.regenVehicle(player, elapsed, dt);
  S.stepMission(mission, player, dt);
}

function resolveHits(hits) {
  for (const h of hits) {
    if (h.kind === 'wall') {
      fx.spawn(h.x, h.y, h.z, 0.2);
      if (h.box && h.box.barrel) {
        h.box.barrel.hp -= h.bullet.damage;
        if (h.box.barrel.hp <= 0) {
          const br = barrelRigs.find((b) => b.ref === h.box.barrel);
          if (br) destroyBarrel(br);
        }
      }
      continue;
    }
    const e = h.target;
    const dmg = h.bullet.damage * (h.kind === 'headshot' ? CFG.HEADSHOT_MULT : 1);
    S.applyDamage(e, dmg, elapsed);
    e.hitFlash = 1;
    if (h.bullet.owner === 'player') {
      hud.hit();
      if (h.kind === 'headshot') audio.headshot(); else audio.hit();
      fx.spawn(e.x, h.kind === 'headshot' ? 1.62 : 1.1, e.z, 0.2);
    }
    if (!e.alive) killEnemy(e, h.kind === 'headshot' ? 'HEADSHOT' : 'KILL');
  }

  // Enemy bullets that reach the player.
  for (const b of bullets) {
    if (b.owner !== 'enemy') continue;
    if (Math.hypot(b.x - player.x, b.z - player.z) < CFG.RADIUS && b.y < 1.8) {
      S.applyDamage(player, b.damage, elapsed);
      hud.hurt();
      audio.hurt();
      b.dead = true;
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].dead) { bulletPool.release(bullets[i].id); bullets.splice(i, 1); }
  }
}

/* ------------------------------ mesh sync ------------------------------ */

function syncMeshes(dt) {
  carRig.group.position.set(player.x, player.y, player.z);
  carRig.group.rotation.y = player.yaw;

  // Body roll and pitch from the forces being applied.
  const roll = S.clamp(-player.lateralSpeed * 0.012, -0.12, 0.12);
  const pitch = S.clamp(-player.forwardSpeed * 0.0016, -0.05, 0.05);
  carRig.group.rotation.z += (roll - carRig.group.rotation.z) * Math.min(1, dt * 8);
  carRig.group.rotation.x += (pitch - carRig.group.rotation.x) * Math.min(1, dt * 8);

  for (const w of carRig.wheels) {
    w.mesh.rotation.x = player.wheelSpin;
    if (w.front) w.pivot.rotation.y = player.steer;
  }
  if (carRig.barrel) carRig.barrel.rotation.x = Math.PI / 2 + (carRig.barrelPitch || 0);

  for (const er of enemyRigs) {
    const e = er.ref;
    er.rig.group.position.set(e.x, 0, e.z);
    er.rig.group.rotation.y = e.yaw;
    if (!e.alive) {
      er.rig.group.rotation.x = Math.min(Math.PI / 2, er.rig.group.rotation.x + dt * 3);
      er.rig.group.position.y = Math.max(-0.4, er.rig.group.position.y - dt * 0.6);
      er.rig.tag.visible = false;
      continue;
    }
    // Walk bob.
    er.rig.group.position.y = Math.abs(Math.sin(elapsed * 9 + e.id)) * 0.05;
    if (er.rig.uniform) {
      const f = e.hitFlash;
      er.rig.uniform.emissive.setRGB(f * 0.6, f * 0.1, f * 0.1);
    }
    er.rig.tag.material.color.setHex(e.alert ? 0xff3b30 : 0xffb02e);
  }

  // Bullet tracers.
  for (const b of bullets) {
    const m = bulletPool.acquire(b.id, b.owner === 'player');
    if (m) m.position.set(b.x, b.y, b.z);
  }
  followShadow(world.sun, player.x, player.z);

  if (world.extraction.visible) {
    world.extraction.rotation.y += dt * 0.4;
  }
}

/* -------------------------------- loop --------------------------------- */

let acc = 0;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // tab was backgrounded

  if (running) {
    elapsed += dt;

    input.sample();
    if (input.consumeReload()) startReload();

    const aim = updateAim();
    if (input.state.fire && weapon.cooldown <= 0) playerShoot(aim);

    acc += dt;
    let guard = 0;
    while (acc >= FIXED_DT && guard++ < 12) {
      physicsStep(FIXED_DT);
      acc -= FIXED_DT;
    }

    // Keep the pressure on.
    const alive = enemies.filter((e) => e.alive).length;
    const remaining = mission.killGoal - mission.kills;
    if (mission.phase === 'combat' && remaining > 0 && alive < Math.min(MAX_ALIVE, remaining)) {
      if (Math.random() < dt * 1.2) spawnEnemy();
    }

    syncMeshes(dt);
    updateCamera(dt);

    const revs = S.clamp(Math.abs(player.forwardSpeed) / CFG.MAX_SPEED, 0, 1);
    audio.engine(
      Math.max(0.12, revs * 0.85 + (input.state.throttle > 0 ? 0.15 : 0)),
      revs,
      input.state.throttle,
    );

    fx.update(dt);
    pulseFlash(flash, dt);

    hud.draw({
      player: { ...player, drifting: Math.abs(player.lateralSpeed) > 3.5 },
      city, enemies, bullets, mission, weapon,
      grid: { range: 90 },
    });

    if (mission.result) endGame();
  }

  renderer.render(scene, camera);
}

/* ------------------------------ lifecycle ------------------------------ */

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hudCanvas.style.width = w + 'px';
  hudCanvas.style.height = h + 'px';
  hud.resize();
}
window.addEventListener('resize', resize);

function startGame() {
  audio.unlock();
  running = true;
  show(null);
  last = performance.now();
  for (let i = 0; i < 4; i++) spawnEnemy();
}

function endGame() {
  running = false;
  const won = mission.result === 'won';
  overTitle.textContent = won ? 'MISSION COMPLETE' : 'K.I.A.';
  overTitle.style.color = won ? '#35e08a' : '#ff3b30';
  overStats.innerHTML = [
    ['SCORE', mission.score],
    ['ELIMINATIONS', mission.kills],
    ['BARRELS', mission.barrels],
    ['TIME', `${Math.floor(mission.time / 60)}:${String(Math.floor(mission.time % 60)).padStart(2, '0')}`],
  ].map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('');
  show('over');
  if (won) audio.win(); else audio.lose();
}

function togglePause() {
  if (!running && screens.pause.hidden && !screens.over.hidden === false) return;
  if (mission.result) return;
  running = !running;
  show(running ? null : 'pause');
  if (running) last = performance.now();
  audio.ui();
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-restart').addEventListener('click', () => location.reload());
document.getElementById('btn-again').addEventListener('click', () => location.reload());
document.getElementById('btn-sound').addEventListener('click', (e) => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  e.currentTarget.textContent = audio.muted ? '🔇' : '🔊';
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') togglePause();
  if (!running && !mission.result && (e.code === 'Space' || e.code === 'Enter')) {
    if (!screens.start.hidden) startGame();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) togglePause();
});

/* -------------------------------- boot --------------------------------- */

resize();
updateCamera(0.016);
syncMeshes(0.016);
renderer.render(scene, camera);
show('start');
requestAnimationFrame(frame);

// Debug handle for the console.
window.FIREZONE = { scene, camera, renderer, player, mission, city, enemies, S, CFG };
