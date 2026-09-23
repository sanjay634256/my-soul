<div align="center">

# 🐍 பாம்பு · PAMBU

**A neon snake game with zero dependencies.**

Canvas + vanilla JS. No build step, no `node_modules`, no framework.
Open `index.html` and play.

</div>

---

## Play it

```bash
# Option 1 — any static server
node server.js
# -> http://localhost:3000

# Option 2 — literally just open the file
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows
```

`server.js` binds to `0.0.0.0`, so it also works behind proxies and in
sandboxed preview environments. Override with `PORT=8080 node server.js`.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` `←` `→` or `WASD` | Steer |
| `Space` | Start / pause / resume |
| `R` | Restart |
| `M` | Mute |
| Swipe / tap | Mobile steering, pause, restart |

Touch devices get an on-screen D-pad automatically.

## Rules

- Eat the pink orb: **+10 points**, snake grows by one.
- Every **4 orbs** = one level, and the game gets faster.
- Speed ramps from **150 ms/tick** down to a floor of **65 ms/tick**.
- Hit a wall → dead. Hit yourself → dead.
- Chase your own tail? That's fine — the tail cell vacates on the same tick.
- Fill the entire 21×21 board and you win.

High score and mute state persist in `localStorage`.

## Project layout

```
index.html      Markup + HUD
styles.css      Neon theme, responsive layout, touch controls
game.js         Part 1: pure game logic  (Node + browser)
                Part 2: canvas render / input / audio  (browser only)
server.js       Zero-dependency static file server
test/           Unit tests against the real exported logic
```

`game.js` splits the simulation from the rendering on purpose: everything
that decides *what happens* is a pure function with no DOM access, so it runs
unchanged under Node for testing.

## Tests

```bash
npm test
```

18 tests cover the shipped module (`require('../game.js')` — nothing is
re-implemented in the tests):

- initial state, head-first body orientation
- food never spawns on the snake, including when `rand()` returns exactly `1.0`
- movement, queued turns, rejected 180° reversals
- eating → growth, score, respawn, level-up
- wall death and self-collision death
- the tail-chase edge case, and its inverse (eating on the tail cell kills)
- speed ramp and the `MIN_SPEED_MS` clamp
- the status machine (`ready → running → paused → over → won`)
- a full board is a win, not a crash

## Tuning

All game feel lives in the constants at the top of `game.js`:

```js
const COLS = 21;             // board width in cells
const ROWS = 21;             // board height in cells
const START_SPEED_MS = 150;  // tick interval at level 1
const MIN_SPEED_MS = 65;     // fastest the game will ever run
const SPEED_STEP_MS = 7;     // speedup per level
const FOODS_PER_LEVEL = 4;   // orbs per level
const POINTS_PER_FOOD = 10;
```

## License

MIT
