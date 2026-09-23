/**
 * FIRE ZONE — meshes for the things that move.
 *
 * Vehicles, hostiles, barrels, bullet tracers and explosions. Bullet and
 * particle objects are pooled so a firefight never allocates per frame.
 */

import * as THREE from '../vendor/three.module.min.js';

/* ============================== the car ================================ */

export function buildCar(palette = {}) {
  const body = palette.body ?? 0x3d4a3a;
  const trim = palette.trim ?? 0x1c1f22;
  const g = new THREE.Group();

  const paint = new THREE.MeshStandardMaterial({ color: body, roughness: 0.42, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.7, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1a2733, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.72,
  });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // Chassis + body
  add(new THREE.BoxGeometry(2.0, 0.42, 4.5), dark, 0, 0.46, 0);
  add(new THREE.BoxGeometry(2.05, 0.62, 4.2), paint, 0, 0.86, 0);
  add(new THREE.BoxGeometry(2.1, 0.24, 1.5), paint, 0, 1.2, 1.25); // bonnet
  // Cabin
  add(new THREE.BoxGeometry(1.78, 0.66, 1.9), paint, 0, 1.5, -0.35);
  add(new THREE.BoxGeometry(1.6, 0.5, 1.7), glass, 0, 1.54, -0.35);
  // Bed / rear
  add(new THREE.BoxGeometry(1.9, 0.5, 1.5), dark, 0, 1.22, -1.75);
  // Bumpers + bull bar
  add(new THREE.BoxGeometry(2.15, 0.34, 0.3), dark, 0, 0.62, 2.15);
  add(new THREE.BoxGeometry(2.15, 0.34, 0.3), dark, 0, 0.62, -2.3);
  add(new THREE.BoxGeometry(1.9, 0.14, 0.14), dark, 0, 1.05, 2.25);
  add(new THREE.BoxGeometry(1.9, 0.14, 0.14), dark, 0, 0.78, 2.25);
  // Roof rack + spoiler
  add(new THREE.BoxGeometry(1.7, 0.09, 1.5), dark, 0, 1.87, -0.35);
  add(new THREE.BoxGeometry(1.9, 0.1, 0.42), dark, 0, 1.42, -2.2, -0.25);
  // Exhausts
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8), dark, 0.62, 0.42, -2.35, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8), dark, -0.62, 0.42, -2.35, Math.PI / 2);

  // Lights
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d0, emissive: 0xffe9b0, emissiveIntensity: 3.2, roughness: 0.3,
  });
  add(new THREE.BoxGeometry(0.44, 0.2, 0.1), lampMat, 0.62, 0.98, 2.11);
  add(new THREE.BoxGeometry(0.44, 0.2, 0.1), lampMat, -0.62, 0.98, 2.11);
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x5a1010, emissive: 0xff2a1a, emissiveIntensity: 2.2, roughness: 0.4,
  });
  add(new THREE.BoxGeometry(0.5, 0.16, 0.08), tailMat, 0.66, 1.0, -2.31);
  add(new THREE.BoxGeometry(0.5, 0.16, 0.08), tailMat, -0.66, 1.0, -2.31);

  // Headlight cones (cheap volumetric look)
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffe6b0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 22, 16, 1, true), coneMat);
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0, 0.9, 13);
  g.add(cone);

  /* --- wheels -------------------------------------------------------- */
  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.36, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 });
  const wheels = [];
  const pos = [[0.98, 1.45], [-0.98, 1.45], [0.98, -1.55], [-0.98, -1.55]];
  for (const [x, z] of pos) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.46, z);
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    pivot.add(w, hub);
    g.add(pivot);
    wheels.push({ pivot, mesh: w, front: z > 0 });
  }

  /* --- roof turret ---------------------------------------------------- */
  const turret = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.22, 12), dark);
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.7), dark);
  mount.position.y = 0.3;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.5, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.16, 0.4, 0.75);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), dark);
  grip.position.set(-0.2, 0.28, 0.2);
  turret.add(ring, mount, barrel, grip);
  turret.position.set(0, 1.92, -0.35);
  turret.castShadow = true;
  g.add(turret);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.16, 0.4, 1.55);
  turret.add(muzzle);

  return { group: g, wheels, turret, muzzle, paint, barrel, barrelPitch: 0 };
}

/* ============================== hostile ================================ */

export function buildEnemy() {
  const g = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: 0x4a4034, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9c7355, roughness: 0.9 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 });

  const add = (geo, mat, y, x = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(0.52, 0.62, 0.3), uniform, 1.16);   // torso
  add(new THREE.BoxGeometry(0.56, 0.2, 0.34), gear, 1.28);        // vest
  add(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin, 1.62);          // head
  add(new THREE.BoxGeometry(0.36, 0.12, 0.36), gear, 1.76);       // helmet
  add(new THREE.BoxGeometry(0.16, 0.72, 0.18), uniform, 0.42, 0.14); // legs
  add(new THREE.BoxGeometry(0.16, 0.72, 0.18), uniform, 0.42, -0.14);
  const armL = add(new THREE.BoxGeometry(0.13, 0.56, 0.15), uniform, 1.2, 0.33, 0.05);
  const armR = add(new THREE.BoxGeometry(0.13, 0.56, 0.15), uniform, 1.2, -0.33, 0.05);
  const rifle = add(new THREE.BoxGeometry(0.1, 0.12, 0.85), gear, 1.22, -0.2, 0.42);

  // Team marker so you can spot hostiles at a glance.
  const tag = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
  );
  tag.position.set(0, 2.05, 0);
  g.add(tag);

  return { group: g, armL, armR, rifle, tag, uniform, skin };
}

/* =============================== barrel ================================ */

export function buildBarrel() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xb03a2a, roughness: 0.6, metalness: 0.35 });
  const band = new THREE.MeshStandardMaterial({ color: 0xe8c33a, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12), shell);
  body.position.y = 0.55;
  body.castShadow = true;
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 14), band);
  ring1.rotation.x = Math.PI / 2;
  ring1.position.y = 0.85;
  const ring2 = ring1.clone();
  ring2.position.y = 0.3;
  g.add(body, ring1, ring2);
  return { group: g, body };
}

/* =========================== bullet tracers ============================ */

export function buildBulletPool(scene, size = 220) {
  const geo = new THREE.SphereGeometry(0.09, 5, 4);
  const playerMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
  const enemyMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
  const items = [];
  for (let i = 0; i < size; i++) {
    const m = new THREE.Mesh(geo, playerMat);
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    items.push({ mesh: m, id: -1, playerMat, enemyMat });
  }
  let cursor = 0;

  return {
    acquire(id, isPlayer) {
      // Reuse the slot already bound to this bullet if it exists.
      for (const it of items) {
        if (it.id === id) {
          it.mesh.material = isPlayer ? it.playerMat : it.enemyMat;
          return it.mesh;
        }
      }
      for (let n = 0; n < size; n++) {
        const it = items[(cursor + n) % size];
        if (it.id === -1 || !it.mesh.visible) {
          it.id = id;
          it.mesh.material = isPlayer ? it.playerMat : it.enemyMat;
          it.mesh.visible = true;
          cursor = (cursor + n + 1) % size;
          return it.mesh;
        }
      }
      return null;
    },
    release(id) {
      for (const it of items) {
        if (it.id === id) { it.id = -1; it.mesh.visible = false; return; }
      }
    },
    releaseAll() {
      for (const it of items) { it.id = -1; it.mesh.visible = false; }
    },
  };
}

/* ============================ explosions =============================== */

export function buildExplosions(scene, glowTexture) {
  const tex = glowTexture('255,180,90');
  const smokeTex = glowTexture('90,85,80');
  const MAX = 900;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const siz = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));

  const mat = new THREE.PointsMaterial({
    size: 2.4, map: tex, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  const smokeMat = new THREE.PointsMaterial({
    size: 5.5, map: smokeTex, vertexColors: true, transparent: true,
    opacity: 0.4, depthWrite: false, sizeAttenuation: true,
  });
  const smokeGeo = geo.clone();
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false;
  scene.add(smoke);

  const parts = [];

  function spawn(x, y, z, power = 1) {
    const n = Math.min(46, Math.floor(26 * power));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.5;
      const sp = (5 + Math.random() * 16) * power;
      parts.push({
        x, y: y + 0.4, z,
        vx: Math.cos(a) * Math.cos(el) * sp,
        vy: Math.sin(el) * sp * 0.9 + 2,
        vz: Math.sin(a) * Math.cos(el) * sp,
        life: 1, decay: 0.9 + Math.random() * 1.1,
        hot: Math.random() < 0.75,
        smoke: false,
      });
    }
    for (let i = 0; i < 14 * power; i++) {
      const a = Math.random() * Math.PI * 2;
      parts.push({
        x, y: y + 1 + Math.random() * 2, z,
        vx: Math.cos(a) * 2.4, vy: 2 + Math.random() * 3.4, vz: Math.sin(a) * 2.4,
        life: 1, decay: 0.35 + Math.random() * 0.4, hot: false, smoke: true,
      });
    }
    if (parts.length > MAX) parts.splice(0, parts.length - MAX);
  }

  function update(dt) {
    let fi = 0, si = 0;
    const fp = smokeGeo.attributes.position.array;
    const fc = smokeGeo.attributes.color.array;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= p.decay * dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy -= (p.smoke ? 2.2 : 16) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.15) { p.y = 0.15; p.vy *= -0.32; p.vx *= 0.7; p.vz *= 0.7; }
      p.vx *= 1 - 1.4 * dt; p.vz *= 1 - 1.4 * dt;

      if (p.smoke) {
        if (si < MAX) {
          fp[si * 3] = p.x; fp[si * 3 + 1] = p.y; fp[si * 3 + 2] = p.z;
          const g = 0.32 * p.life;
          fc[si * 3] = g * 1.05; fc[si * 3 + 1] = g; fc[si * 3 + 2] = g * 0.95;
          si++;
        }
      } else if (fi < MAX) {
        pos[fi * 3] = p.x; pos[fi * 3 + 1] = p.y; pos[fi * 3 + 2] = p.z;
        const t = p.life;
        col[fi * 3] = p.hot ? 1.0 : 0.85;
        col[fi * 3 + 1] = 0.35 + t * 0.55;
        col[fi * 3 + 2] = 0.08 + t * 0.2;
        siz[fi] = 1.6 + t * 2.2;
        fi++;
      }
    }
    for (let i = fi; i < MAX; i++) { pos[i * 3 + 1] = -9999; siz[i] = 0; }
    for (let i = si; i < MAX; i++) fp[i * 3 + 1] = -9999;

    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.setDrawRange(0, fi);
    smokeGeo.attributes.position.needsUpdate = true;
    smokeGeo.attributes.color.needsUpdate = true;
    smokeGeo.setDrawRange(0, si);
  }

  return { spawn, update, clear: () => { parts.length = 0; } };
}

/* ============================ impact sparks ============================ */

export function buildSparks(scene, glowTexture) {
  const ex = buildExplosions(scene, glowTexture);
  return {
    hit(x, y, z) { ex.spawn(x, y, z, 0.28); },
    update: ex.update,
    clear: ex.clear,
  };
}

/* ========================= screen-space helpers ======================== */

export function makeMuzzleFlash() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.95 }),
  );
  const light = new THREE.PointLight(0xffcf70, 0, 14, 2);
  g.add(core, light);
  g.visible = false;
  return { group: g, core, light, timer: 0 };
}

export function pulseFlash(flash, dt) {
  if (flash.timer > 0) {
    flash.timer -= dt;
    const k = Math.max(0, flash.timer / 0.06);
    flash.core.scale.setScalar(0.6 + k * 1.5);
    flash.light.intensity = k * 22;
    flash.group.visible = true;
    if (flash.timer <= 0) { flash.group.visible = false; flash.light.intensity = 0; }
  }
}
