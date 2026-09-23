<div align="center">

# 🔥 FIRE ZONE · தீ மண்டலம்

**A 3D open-world vehicular-combat game.** Plus a snake game, because it got here first.

No build step. No `node_modules` for the game. No framework.

</div>

---

## Run it

```bash
git clone https://github.com/sanjay634256/my-soul.git
cd my-soul
node server.js
# FIRE ZONE  ->  http://localhost:3000/
# PAMBU      ->  http://localhost:3000/pambu/
```

`server.js` binds to `0.0.0.0` and serves `.mjs` as `text/javascript`, so it works
behind proxies and sandboxed previews. Override with `PORT=8080 node server.js`.

To play from your phone on the same Wi-Fi: `http://<your-laptop-LAN-IP>:3000/`
— touch controls appear automatically on coarse pointers.

> `open index.html` directly will **not** work. ES modules are blocked on `file://`.
> You need a server.

---

## FIRE ZONE

You drive an armed buggy through a procedurally generated city. Hostiles hold the
streets. Clear the kill quota, then reach the extraction zone and hold it.

### Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | drive and steer |
| `SPACE` | fire turret |
| `SHIFT` | handbrake drift |
| `R` | reload |
| `ESC` | pause |

On a phone: left thumb on the virtual stick, right thumb on the fire / drift /
reload / brake pads.

### What is actually simulated

Everything below runs in `js/sim.mjs` as plain math — no rendering involved, which
is why it can be unit-tested headlessly.

- **Vehicle physics** — engine power with a speed-falloff headroom, quadratic drag,
  rolling resistance, a grip circle with a separate handbrake grip, speed-sensitive
  steering, lateral drift, and yaw inertia. Top speed 46 m/s (166 km/h).
- **Collision** — circle-vs-AABB resolution against a uniform spatial hash, with
  velocity reflection on impact. Substepped so a fast car cannot tunnel through a wall.
- **Ballistics** — bullets are swept in 0.25 m substeps against the same hash, so a
  130 m/s round cannot skip over a thin building. Fired from turret height (~2.3 m)
  with a real 3D pitch down to the target's chest, not a flat 2D ray.
- **Hit volumes** — every hostile is three overlapping spheres (legs, torso, head).
  Headshots do 2×. A test asserts there is no unhittable gap between 0.05 m and 1.85 m.
- **Hostile AI** — alerting, closing to a stand-off distance, strafing, breaking line
  of sight, and firing with spread. Fully RNG-injectable, so runs are reproducible.
- **Chain explosions** — barrels take damage, blow up, and set off their neighbours.
- **Health** — armour absorbs 60% until depleted, then regenerates after 6 s idle.
  Crash damage scales with speed lost (1.3 per m/s), so a 30 m/s hit costs ~16 hp
  after armour rather than being an instant death.
- **Procedural city** — `js/layout.mjs` grows a 240 m street grid and subdivides each
  block into lots (1×1 up to 3×3), with plazas, empty lots, and 46 explosive barrels.
  Deterministic per seed. The default seed produces **230 buildings, 331 colliders,
  447 props, 40 spawn points**.

### Rendering

Three.js r169, vendored at `vendor/three.module.min.js` (687 KB) because CDNs are
not something a game should depend on. `js/world.mjs` builds the city meshes,
`js/entities.mjs` the cars and hostiles, `js/hud.mjs` the DOM overlay and radar,
`js/audio.mjs` the WebAudio SFX. The sim runs on a fixed 1/120 s accumulator and the
renderer interpolates between ticks.

---

## Tests

```bash
npm test          # node --test, zero dependencies
```

**139 tests.** They are deterministic — the sim's RNG is injectable, so a given seed
always replays identically.

| File | Covers |
| --- | --- |
| `test/sim.test.mjs` | vehicle physics, collision, ballistics, hit volumes, AI, mission state, explosions |
| `test/layout.test.mjs` | city determinism, no building on a road, no building overlap, spawns clear of geometry, grid-vs-brute-force agreement + perf |
| `test/integration.test.mjs` | full headless matches: a complete win with extraction, multi-seed city stability, no NaN, no arena escape, bounded bullet pool, 60 fps budget |
| `test/wiring.test.mjs` | every named import exists in its target, every `getElementById` has a matching id, every `data-btn` is consumed, `server.js` has a MIME type for every extension on disk |
| `test/game.test.js`, `test/browser.*.test.js` | PAMBU |

`test/wiring.test.mjs` exists because importing a name that does not exist is a
**link-time** `SyntaxError` — it kills the whole module, and no amount of
`node --check` catches it.

### What the tests do *not* cover

There is no headless browser available in the build environment, so `js/world.mjs`,
`js/entities.mjs`, `js/hud.mjs` and `js/main.mjs` have never actually executed. They
are covered by `node --check` and by the static wiring assertions only. The
gameplay, physics and combat are genuinely tested; the rendering is reasoned about.

---

## PAMBU 🐍

The original: a neon snake game. Canvas + vanilla JS, no dependencies.

```bash
node server.js     # -> http://localhost:3000/pambu/
```

Arrows or WASD to steer, `SPACE` to pause. Swipe on touch.

---

## Layout

```
index.html          FIRE ZONE shell (screens, HUD, touch pads)
styles.css          angular amber/olive tactical theme
server.js           zero-dependency static server
js/sim.mjs          pure simulation core — physics, ballistics, AI, mission
js/layout.mjs       procedural city generation
js/world.mjs        three.js scene construction
js/entities.mjs     car and hostile meshes
js/hud.mjs          HUD overlay and radar
js/audio.mjs        WebAudio sound effects
js/input.mjs        keyboard and touch input
js/main.mjs         game loop, camera, wiring
vendor/             three.js r169
test/               139 tests
pambu/              the snake game
```
