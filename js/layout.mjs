/**
 * FIRE ZONE — procedural city layout.
 *
 * Pure data, no THREE. Both the renderer and the collision solver read from
 * the same generated arrays, so what you see is always what you hit.
 * Seeded, so a given seed always produces the same map.
 */

import { makeRng, clamp } from './sim.mjs';

export const ROAD_SPACING = 60;
export const ROAD_WIDTH = 15;
export const SIDEWALK = 2.5;

/** Is this point on a road? */
export function onRoad(x, z) {
  const half = ROAD_WIDTH / 2;
  const nearLine = (v) => {
    const m = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING;
    return m < half || m > ROAD_SPACING - half;
  };
  return nearLine(x) || nearLine(z);
}

export function generateCity(seed = 20260923, half = 240) {
  const rng = makeRng(seed);

  const buildings = [];
  const props = [];
  const barrels = [];
  const boxes = []; // collision geometry
  const spawnPoints = [];

  const pick = (a) => a[Math.floor(rng() * a.length) % a.length];
  const range = (a, b) => a + rng() * (b - a);

  /* ------------------------- building blocks ------------------------- */
  const PALETTE = [
    0x6b6a63, 0x7a7265, 0x5f6660, 0x847a68, 0x55585c,
    0x6f5f52, 0x4f5a55, 0x8a8375, 0x5c5650, 0x74706a,
  ];

  for (let bx = -half; bx < half; bx += ROAD_SPACING) {
    for (let bz = -half; bz < half; bz += ROAD_SPACING) {
      // Inset the block from the roads and sidewalks.
      const inset = ROAD_WIDTH / 2 + SIDEWALK + 2;
      const x0 = bx + inset;
      const z0 = bz + inset;
      const size = ROAD_SPACING - inset * 2;
      if (size <= 12) continue;

      // Some blocks stay open (plazas, compounds) for driving room.
      if (rng() < 0.10) {
        props.push({ type: 'crate', x: bx + ROAD_SPACING / 2, z: bz + ROAD_SPACING / 2, yaw: rng() * 3 });
        continue;
      }

      // Split the block into 1-4 lots.
      const splits = pick([1, 2, 2, 4, 4, 4, 9, 9]);
      const cells = [];
      if (splits === 1) cells.push([x0, z0, size, size]);
      else if (splits === 2) {
        if (rng() < 0.5) {
          cells.push([x0, z0, size / 2 - 1.5, size], [x0 + size / 2 + 1.5, z0, size / 2 - 1.5, size]);
        } else {
          cells.push([x0, z0, size, size / 2 - 1.5], [x0, z0 + size / 2 + 1.5, size, size / 2 - 1.5]);
        }
      } else if (splits === 4) {
        const hs = size / 2 - 1.5;
        cells.push(
          [x0, z0, hs, hs],
          [x0 + size / 2 + 1.5, z0, hs, hs],
          [x0, z0 + size / 2 + 1.5, hs, hs],
          [x0 + size / 2 + 1.5, z0 + size / 2 + 1.5, hs, hs],
        );
      } else {
        // 3x3
        const t = size / 3 - 2;
        for (let ix = 0; ix < 3; ix++) {
          for (let iz = 0; iz < 3; iz++) {
            cells.push([x0 + ix * (size / 3 + 1), z0 + iz * (size / 3 + 1), t, t]);
          }
        }
      }

      for (const [cx, cz, cw, cd] of cells) {
        if (cw < 6 || cd < 6) continue;
        if (rng() < 0.14) continue; // empty lot

        const w = cw * range(0.7, 0.95);
        const d = cd * range(0.7, 0.95);
        const h = range(7, 34) * (rng() < 0.18 ? 1.7 : 1); // occasional tower
        const x = cx + cw / 2;
        const z = cz + cd / 2;

        buildings.push({ x, z, w, d, h, color: pick(PALETTE), seed: rng() });
        boxes.push({ x, z, hx: w / 2, hz: d / 2, h, baseY: 0 });

        // Rooftop clutter on tall blocks.
        if (h > 26 && rng() < 0.6) {
          props.push({ type: 'tank', x: x + range(-w / 4, w / 4), z: z + range(-d / 4, d / 4), y: h, yaw: rng() * 6 });
        }
      }
    }
  }

  /* --------------------------- street props -------------------------- */
  for (let v = -half; v <= half; v += ROAD_SPACING) {
    for (let u = -half + 15; u < half; u += 30) {
      // Lamps line both sides of every road.
      const off = ROAD_WIDTH / 2 + 1.2;
      props.push({ type: 'lamp', x: v + off, z: u, yaw: 0 });
      props.push({ type: 'lamp', x: u, z: v + off, yaw: Math.PI / 2 });

      if (rng() < 0.25) {
        props.push({ type: 'tree', x: v - off - range(0, 4), z: u, yaw: rng() * 6 });
      }
    }
  }

  /* ----------------------- explosive barrels ------------------------- */
  const barrelSpots = 46;
  let guard = 0;
  while (barrels.length < barrelSpots && guard++ < 2000) {
    const x = range(-half + 10, half - 10);
    const z = range(-half + 10, half - 10);
    if (onRoad(x, z)) continue; // keep the roads drivable
    if (boxes.some((b) => Math.abs(x - b.x) < b.hx + 2 && Math.abs(z - b.z) < b.hz + 2)) continue;
    barrels.push({ x, z, hp: 30, alive: true });
    boxes.push({ x, z, hx: 0.55, hz: 0.55, h: 1.1, baseY: 0, barrel: barrels[barrels.length - 1] });
  }

  /* ------------------------- cover and ramps ------------------------- */
  guard = 0;
  while (props.filter((p) => p.type === 'crate').length < 60 && guard++ < 3000) {
    const x = range(-half + 8, half - 8);
    const z = range(-half + 8, half - 8);
    if (onRoad(x, z)) continue;
    if (boxes.some((b) => Math.abs(x - b.x) < b.hx + 2.5 && Math.abs(z - b.z) < b.hz + 2.5)) continue;
    props.push({ type: 'crate', x, z, yaw: rng() * 6 });
    boxes.push({ x, z, hx: 1.1, hz: 1.1, h: 1.1, baseY: 0 });
  }

  guard = 0;
  while (props.filter((p) => p.type === 'ramp').length < 10 && guard++ < 3000) {
    const x = range(-half + 30, half - 30);
    const z = range(-half + 30, half - 30);
    if (!onRoad(x, z)) continue;
    if (boxes.some((b) => Math.abs(x - b.x) < b.hx + 8 && Math.abs(z - b.z) < b.hz + 8)) continue;
    props.push({ type: 'ramp', x, z, yaw: rng() * Math.PI * 2 });
  }

  /* ------------------------ enemy spawn points ----------------------- */
  guard = 0;
  while (spawnPoints.length < 40 && guard++ < 4000) {
    const x = range(-half + 20, half - 20);
    const z = range(-half + 20, half - 20);
    if (!onRoad(x, z)) continue;
    if (boxes.some((b) => Math.abs(x - b.x) < b.hx + 3 && Math.abs(z - b.z) < b.hz + 3)) continue;
    if (spawnPoints.some((p) => Math.hypot(p.x - x, p.z - z) < 34)) continue;
    spawnPoints.push({ x, z });
  }

  /* ------------------------ perimeter walls -------------------------- */
  const t = 4;
  const walls = [
    { x: 0, z: -half - t / 2, hx: half + t, hz: t / 2, h: 14, baseY: 0 },
    { x: 0, z: half + t / 2, hx: half + t, hz: t / 2, h: 14, baseY: 0 },
    { x: -half - t / 2, z: 0, hx: t / 2, hz: half + t, h: 14, baseY: 0 },
    { x: half + t / 2, z: 0, hx: t / 2, hz: half + t, h: 14, baseY: 0 },
  ];
  boxes.push(...walls);

  /* ------------------------- player spawn ---------------------------- */
  // On the north-south arterial at x=0, facing up it.
  const playerSpawn = { x: 0, z: ROAD_SPACING / 2, yaw: 0 };

  /* ------------------------ extraction zone -------------------------- */
  let extract = { x: -half + 90, z: half - 90 };
  guard = 0;
  while (guard++ < 3000) {
    if (onRoad(extract.x, extract.z) &&
        !boxes.some((b) => Math.abs(extract.x - b.x) < b.hx + 18 && Math.abs(extract.z - b.z) < b.hz + 18)) break;
    extract = { x: range(-half + 60, half - 60), z: range(-half + 60, half - 60) };
  }

  return {
    half,
    buildings,
    props,
    barrels,
    boxes,
    walls,
    spawnPoints,
    playerSpawn,
    extract,
  };
}

/** Sanity metrics, mostly for tests and the debug overlay. */
export function stats(city) {
  return {
    buildings: city.buildings.length,
    boxes: city.boxes.length,
    props: city.props.length,
    barrels: city.barrels.length,
    spawns: city.spawnPoints.length,
  };
}

export { clamp };
