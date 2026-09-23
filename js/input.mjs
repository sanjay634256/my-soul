/**
 * FIRE ZONE — input.
 *
 * Keyboard for desktop, on-screen sticks and buttons for touch. Both feed
 * the same normalised state object the simulation consumes.
 */

export function createInput(canvas) {
  const state = {
    throttle: 0,   // -1..1
    steer: 0,      // -1..1  (left is negative)
    handbrake: false,
    fire: false,
    reload: false,
    camYawOffset: 0,
    anyKey: false,
    paused: false,
  };

  const keys = new Set();
  let touchDrive = null;  // { id, cx, cy }
  let touchLook = null;
  const stick = { x: 0, y: 0, active: false };

  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  /* ---------------------------- keyboard ----------------------------- */
  const DRIVE = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
  };

  window.addEventListener('keydown', (e) => {
    if (DRIVE[e.key] || e.key === ' ') e.preventDefault();
    keys.add(e.key);
    state.anyKey = true;
    if (e.code === 'Space') state.fire = true;
    if (e.key === 'r' || e.key === 'R') state.reload = true;
    if (e.key === 'Shift') state.handbrake = true;
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.key);
    if (e.code === 'Space') state.fire = false;
    if (e.key === 'r' || e.key === 'R') state.reload = false;
    if (e.key === 'Shift') state.handbrake = false;
  });

  window.addEventListener('blur', () => {
    keys.clear();
    state.fire = false;
    state.handbrake = false;
  });

  function readKeys() {
    let t = 0, s = 0;
    if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) t += 1;
    if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) t -= 1;
    if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) s -= 1;
    if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) s += 1;
    return { t, s };
  }

  /* ----------------------------- touch -------------------------------- */
  const btns = {};
  document.querySelectorAll('[data-btn]').forEach((el) => {
    const name = el.dataset.btn;
    btns[name] = { el, down: false };
    const on = (e) => { e.preventDefault(); btns[name].down = true; el.classList.add('on'); };
    const off = (e) => { e.preventDefault(); btns[name].down = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  const padEl = document.getElementById('touch-pad');
  const knobEl = document.getElementById('touch-knob');

  if (padEl) {
    padEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      padEl.setPointerCapture(e.pointerId);
      touchDrive = { id: e.pointerId, cx: e.clientX, cy: e.clientY };
      stick.active = true;
    });
    padEl.addEventListener('pointermove', (e) => {
      if (!touchDrive || e.pointerId !== touchDrive.id) return;
      const r = padEl.getBoundingClientRect();
      const dx = e.clientX - touchDrive.cx;
      const dy = e.clientY - touchDrive.cy;
      const max = r.width / 2;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / max);
      stick.x = (dx / d) * k;
      stick.y = (dy / d) * k;
      if (knobEl) {
        knobEl.style.transform =
          `translate(${stick.x * max * 0.72}px, ${stick.y * max * 0.72}px)`;
      }
    });
    const end = (e) => {
      if (!touchDrive || e.pointerId !== touchDrive.id) return;
      touchDrive = null;
      stick.active = false;
      stick.x = stick.y = 0;
      if (knobEl) knobEl.style.transform = 'translate(0,0)';
    };
    padEl.addEventListener('pointerup', end);
    padEl.addEventListener('pointercancel', end);
    padEl.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ------------------------------ poll -------------------------------- */
  function sample() {
    const k = readKeys();

    // Throttle: keys, or the drive stick pushed forward/back, or the pedals.
    let t = k.t;
    if (stick.active) t = -stick.y; // up on the stick is forward
    if (btns.gas && btns.gas.down) t = 1;
    if (btns.brake && btns.brake.down) t = -1;
    state.throttle = Math.max(-1, Math.min(1, t));

    // Steering: keys, or the stick, or the left/right buttons.
    let s = k.s;
    if (stick.active && Math.abs(stick.x) > 0.18) s = stick.x;
    state.steer = Math.max(-1, Math.min(1, s));

    if (btns.drift && btns.drift.down) state.handbrake = true;
    // One source of truth: keyboard OR the touch button.
    state.fire = keys.has(' ') || !!(btns.fire && btns.fire.down);
    if (btns.reload && btns.reload.down) { state.reload = true; btns.reload.down = false; }

    return state;
  }

  function consumeReload() {
    const r = state.reload;
    state.reload = false;
    return r;
  }

  return {
    state,
    sample,
    consumeReload,
    isTouch,
    hasTouchUI: !!padEl,
    /** Latched "any input yet" flag, used to dismiss the start screen. */
    get anyInput() { return state.anyKey || stick.active || Object.values(btns).some((b) => b.down); },
    btns,
  };
}
