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
| Swipe | Mobile steering (anywhere on the board) |
| Tap | Start / restart |
| ⏸ button | Pause / resume |

Touch devices get an on-screen D-pad automatically, and the board shrinks to
whatever vertical space is left so the pad is never pushed off-screen.

### Mobile notes

Four things that only break on a phone, all handled:

- **iOS Safari private mode** throws on every `localStorage` access. All reads
  and writes go through a guarded wrapper, so a lost high score never turns
  into a crashed `gameOver()`.
- **iOS starts an `AudioContext` suspended** and only lets it resume inside a
  user gesture. Every gesture handler (key, D-pad, swipe, buttons) calls
  `unlockAudio()`, otherwise the game is silently mute.
- **A short swipe is not a pause gesture.** Sub-threshold flicks are common on
  touchscreens, and pausing a live run by accident is worse than ignoring the
  input — use the ⏸ button.
- **The mobile URL bar resizes the viewport.** The layout is flex + `100dvh`,
  and a `ResizeObserver` on the stage re-measures the canvas on rotation and
  on URL-bar show/hide.

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
index.html             Markup + HUD
styles.css             Neon theme, responsive + touch layout
game.js                Part 1: pure game logic  (Node + browser)
                       Part 2: canvas render / input / audio  (browser only)
server.js              Zero-dependency static file server
test/game.test.js      Logic tests against the real exported module
test/browser.smoke.test.js   Desktop: DOM stub drives boot -> play -> die
test/browser.mobile.test.js  Mobile: throwing storage, suspended audio, swipe
test/helpers/dom.js    Shared DOM/canvas/AudioContext stub
```

`game.js` splits the simulation from the rendering on purpose: everything
that decides *what happens* is a pure function with no DOM access, so it runs
unchanged under Node for testing.

## Tests

```bash
npm test
```

43 tests cover the shipped module (`require('../game.js')` — nothing is
re-implemented in the tests).

**Logic** (`test/game.test.js`):

- initial state, head-first body orientation
- food never spawns on the snake, including when `rand()` returns exactly `1.0`
- movement, queued turns, rejected 180° reversals
- eating → growth, score, respawn, level-up
- wall death and self-collision death
- the tail-chase edge case, and its inverse (eating on the tail cell kills)
- speed ramp and the `MIN_SPEED_MS` clamp
- the status machine (`ready → running → paused → over → won`)
- a full board is a win, not a crash

**Desktop browser layer** (`test/browser.smoke.test.js`) — stubs the DOM and
drives the real canvas/input code, asserting on actual HUD values:

- boot renders, canvas ops are issued, overlay shows
- Space starts, arrows/WASD/D-pad steer, rejected reversals never land
- eating updates score + length in the DOM
- pause/resume, restart, mute persistence
- wall death writes the best score to `localStorage`

**Mobile browser layer** (`test/browser.mobile.test.js`) — separate process
with a *throwing* `localStorage` and a *suspended* `AudioContext`:

- boot, mute and `gameOver()` all survive storage throwing
- every gesture path resumes the suspended `AudioContext`
- swipe steering on each axis, diagonal swipes resolve to the dominant axis
- a sub-threshold flick does **not** pause a live run
- the ⏸ button pauses/resumes and its icon tracks the state
- long-press cannot open the native callout menu

Every one of these is mutation-tested: seeding the corresponding bug
(unguarded `setItem`, missing `resume()`, tap-to-pause, listeners on the
canvas instead of the stage, D-pad not unlocking audio) fails the suite.

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
