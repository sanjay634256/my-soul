/**
 * FIRE ZONE — renderer-side world construction.
 *
 * Reads the pure layout from layout.mjs and builds the Three.js scene.
 * Everything static is instanced: one draw call for all buildings, one for
 * lamps, one for trees, one for crates.
 */

import * as THREE from '../vendor/three.module.min.js';
import { ROAD_SPACING, ROAD_WIDTH, SIDEWALK, onRoad } from './layout.mjs';

/* ---------------------- procedural canvas textures --------------------- */

function groundTexture(city) {
  const PX = 2048;
  const world = city.half * 2;
  const s = PX / world; // pixels per metre
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  const g = c.getContext('2d');

  const toPx = (v) => (v + city.half) * s;

  // Base terrain: dusty sand with mottling.
  g.fillStyle = '#8d7f63';
  g.fillRect(0, 0, PX, PX);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * PX, y = Math.random() * PX;
    const r = 2 + Math.random() * 26;
    g.fillStyle = `rgba(${120 + Math.random() * 50 | 0},${105 + Math.random() * 45 | 0},${78 + Math.random() * 35 | 0},0.10)`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // Block interiors: concrete compounds.
  for (let bx = -city.half; bx < city.half; bx += ROAD_SPACING) {
    for (let bz = -city.half; bz < city.half; bz += ROAD_SPACING) {
      const inset = (ROAD_WIDTH / 2 + SIDEWALK) * s;
      g.fillStyle = '#7d7466';
      g.fillRect(toPx(bx) + inset, toPx(bz) + inset, ROAD_SPACING * s - inset * 2, ROAD_SPACING * s - inset * 2);
    }
  }

  // Sidewalks.
  g.fillStyle = '#9a9488';
  for (let v = -city.half; v <= city.half; v += ROAD_SPACING) {
    const w = (ROAD_WIDTH / 2 + SIDEWALK) * s;
    const p = toPx(v);
    g.fillRect(p - w, 0, w * 2, PX);
    g.fillRect(0, p - w, PX, w * 2);
  }

  // Asphalt.
  const rw = (ROAD_WIDTH / 2) * s;
  g.fillStyle = '#33363b';
  for (let v = -city.half; v <= city.half; v += ROAD_SPACING) {
    const p = toPx(v);
    g.fillRect(p - rw, 0, rw * 2, PX);
    g.fillRect(0, p - rw, PX, rw * 2);
  }
  // Asphalt grain.
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * PX, y = Math.random() * PX;
    const wx = (x / s) - city.half, wy = (y / s) - city.half;
    if (!onRoad(wx, wy)) continue;
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(x, y, 2, 2);
  }

  // Dashed centre lines + intersection boxes.
  g.strokeStyle = '#c8a237';
  g.lineWidth = Math.max(2, 0.28 * s);
  g.setLineDash([3.2 * s, 3.2 * s]);
  for (let v = -city.half; v <= city.half; v += ROAD_SPACING) {
    const p = toPx(v);
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, PX); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(PX, p); g.stroke();
  }
  g.setLineDash([]);

  // Road-edge white lines.
  g.strokeStyle = 'rgba(230,230,230,0.42)';
  g.lineWidth = Math.max(1, 0.16 * s);
  for (let v = -city.half; v <= city.half; v += ROAD_SPACING) {
    const p = toPx(v);
    for (const o of [-1, 1]) {
      const e = p + o * (ROAD_WIDTH / 2 - 0.7) * s;
      g.beginPath(); g.moveTo(e, 0); g.lineTo(e, PX); g.stroke();
      g.beginPath(); g.moveTo(0, e); g.lineTo(PX, e); g.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);

  // Faint floor bands; horizontal stripes survive non-uniform scaling better
  // than a window grid would.
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, y, 256, 3);
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(0, y + 8, 256, 8);
  }
  // Grime.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.09})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 12, 2 + Math.random() * 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function glowTexture(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `rgba(${rgb},1)`);
  grd.addColorStop(0.4, `rgba(${rgb},0.45)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* --------------------------------- world -------------------------------- */

export function buildWorld(city, renderer) {
  const group = new THREE.Group();

  /* --- sky + fog ------------------------------------------------------ */
  const skyGeo = new THREE.SphereGeometry(city.half * 3.2, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1b2b46) },
      mid: { value: new THREE.Color(0xc9663a) },
      bot: { value: new THREE.Color(0x3a2a26) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.55))
                         : mix(mid, bot, pow(clamp(-h,0.0,1.0), 0.4));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));

  /* --- lights --------------------------------------------------------- */
  const hemi = new THREE.HemisphereLight(0xffb27a, 0x2a2620, 0.85);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xffb070, 1.5);
  sun.position.set(90, 110, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  const sc = sun.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(sun.target);

  const fill = new THREE.DirectionalLight(0x5f7ea8, 0.45);
  fill.position.set(-70, 60, -50);
  group.add(fill);

  /* --- ground --------------------------------------------------------- */
  const world = city.half * 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(world + 400, world + 400),
    new THREE.MeshStandardMaterial({ map: groundTexture(city), roughness: 0.96, metalness: 0.02 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  /* --- buildings (one draw call) -------------------------------------- */
  const facade = facadeTexture();
  const bMat = new THREE.MeshStandardMaterial({
    map: facade, roughness: 0.88, metalness: 0.06,
  });
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0); // origin at the base
  const bMesh = new THREE.InstancedMesh(bGeo, bMat, city.buildings.length);
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  city.buildings.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, 0, b.z);
    bMesh.setMatrixAt(i, m4);
    const shade = 0.78 + (b.seed % 1) * 0.42;
    col.setHex(b.color).multiplyScalar(shade);
    bMesh.setColorAt(i, col);
  });
  bMesh.instanceMatrix.needsUpdate = true;
  if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
  group.add(bMesh);

  /* --- street lamps (instanced pole + emissive head) ------------------ */
  const lamps = city.props.filter((p) => p.type === 'lamp');
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7, metalness: 0.5 });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 7, 6), poleMat, lamps.length);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffb347, emissiveIntensity: 2.4, roughness: 0.4,
  });
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 6), headMat, lamps.length);
  lamps.forEach((p, i) => {
    m4.identity();
    m4.setPosition(p.x, 3.5, p.z);
    poles.setMatrixAt(i, m4);
    m4.setPosition(p.x, 7.05, p.z);
    heads.setMatrixAt(i, m4);
  });
  poles.castShadow = true;
  group.add(poles, heads);

  /* --- trees ---------------------------------------------------------- */
  const trees = city.props.filter((p) => p.type === 'tree');
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f5a34, roughness: 1 });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 3, 6), trunkMat, Math.max(1, trees.length));
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 5, 7), leafMat, Math.max(1, trees.length));
  trunks.castShadow = leaves.castShadow = true;
  trees.forEach((p, i) => {
    const s = 0.8 + (i % 5) * 0.12;
    m4.identity(); m4.scale(new THREE.Vector3(s, s, s)); m4.setPosition(p.x, 1.5 * s, p.z);
    trunks.setMatrixAt(i, m4);
    m4.identity(); m4.scale(new THREE.Vector3(s, s, s)); m4.setPosition(p.x, (3 + 2.5) * s, p.z);
    leaves.setMatrixAt(i, m4);
  });
  group.add(trunks, leaves);

  /* --- crates --------------------------------------------------------- */
  const crates = city.props.filter((p) => p.type === 'crate');
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6d5a3c, roughness: 0.95 });
  const crateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 1.1, 2.2), crateMat, Math.max(1, crates.length));
  crateMesh.castShadow = crateMesh.receiveShadow = true;
  crates.forEach((p, i) => {
    m4.makeRotationY(p.yaw);
    m4.setPosition(p.x, 0.55, p.z);
    crateMesh.setMatrixAt(i, m4);
  });
  group.add(crateMesh);

  /* --- ramps ---------------------------------------------------------- */
  const ramps = city.props.filter((p) => p.type === 'ramp');
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xb08a2e, roughness: 0.8 });
  ramps.forEach((p) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 13), rampMat);
    r.position.set(p.x, 1.15, p.z);
    r.rotation.set(-0.2, p.yaw, 0);
    r.castShadow = r.receiveShadow = true;
    group.add(r);
  });

  /* --- rooftop water tanks -------------------------------------------- */
  const tanks = city.props.filter((p) => p.type === 'tank');
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x7c8085, roughness: 0.6, metalness: 0.4 });
  tanks.forEach((p) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.6, 10), tankMat);
    t.position.set(p.x, (p.y || 0) + 1.3, p.z);
    t.castShadow = true;
    group.add(t);
  });

  /* --- perimeter walls ------------------------------------------------ */
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.95 });
  city.walls.forEach((w) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w.hx * 2, w.h, w.hz * 2), wallMat);
    m.position.set(w.x, w.h / 2, w.z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  });

  /* --- extraction zone marker ---------------------------------------- */
  const ex = city.extract;
  const exGroup = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(14.4, 16, 48),
    new THREE.MeshBasicMaterial({ color: 0x35e08a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(14.4, 48),
    new THREE.MeshBasicMaterial({ color: 0x35e08a, transparent: true, opacity: 0.11 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.06;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 60, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x35e08a, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 30;
  exGroup.add(ring, disc, beam);
  exGroup.position.set(ex.x, 0, ex.z);
  exGroup.visible = false;
  group.add(exGroup);

  return { group, sun, extraction: exGroup, glowTexture };
}

/** Keep the shadow frustum centred on the player so shadows stay crisp. */
export function followShadow(sun, x, z) {
  sun.position.set(x + 90, 110, z + 60);
  sun.target.position.set(x, 0, z);
  sun.target.updateMatrixWorld();
}
