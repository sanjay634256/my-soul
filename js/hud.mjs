/**
 * FIRE ZONE — HUD.
 *
 * A single 2D canvas overlay drawn every frame: rotating radar, vitals,
 * ammo, speedo, crosshair, kill feed, objective state. Free Fire-ish
 * angular panels in amber and olive.
 */

import { toRadar, kmh, CFG } from './sim.mjs';

const AMBER = '#ffb02e';
const AMBER_DIM = 'rgba(255,176,46,0.35)';
const GREEN = '#35e08a';
const RED = '#ff3b30';
const PANEL = 'rgba(12,14,16,0.62)';

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  const feed = [];      // { text, color, t }
  let hitMarker = 0;    // seconds remaining
  let damageFlash = 0;
  let lastHp = CFG.PLAYER_HP;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pushFeed(text, color = AMBER) {
    feed.unshift({ text, color, t: 4 });
    if (feed.length > 5) feed.pop();
  }

  function panel(x, y, w, h, accent = AMBER) {
    ctx.save();
    ctx.fillStyle = PANEL;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    const c = 9;
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + c);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function bar(x, y, w, h, frac, color, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (label) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, x, y - 4);
    }
    ctx.restore();
  }

  /* ---------------------------- radar -------------------------------- */
  function radar(cx, cy, R, state) {
    const { player, city, enemies, bullets, mission, grid } = state;

    ctx.save();
    // disc
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,10,0.78)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = AMBER_DIM;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    ctx.clip();

    const range = grid.range;
    const scale = R / range;

    // roads, drawn in world space then rotated into the player's frame
    ctx.translate(cx, cy);
    ctx.rotate(-player.yaw);
    ctx.strokeStyle = 'rgba(120,140,120,0.55)';
    ctx.lineWidth = 1.2;
    for (let v = -city.half; v <= city.half; v += 60) {
      for (const [ax, az, bx, bz] of [
        [v, -city.half, v, city.half],
        [-city.half, v, city.half, v],
      ]) {
        const dx = ax - player.x, dz = az - player.z;
        const ex = bx - player.x, ez = bz - player.z;
        ctx.beginPath();
        ctx.moveTo(dz * scale, -dx * scale);
        ctx.lineTo(ez * scale, -ex * scale);
        ctx.stroke();
      }
    }

    // buildings as faint blocks
    ctx.fillStyle = 'rgba(90,90,88,0.5)';
    for (const b of city.buildings) {
      const dx = b.x - player.x, dz = b.z - player.z;
      if (Math.abs(dx) > range + 40 || Math.abs(dz) > range + 40) continue;
      const w = (b.w / 2) * scale, d = (b.d / 2) * scale;
      ctx.fillRect(dz * scale - d, -dx * scale - w, d * 2, w * 2);
    }

    // extraction zone
    if (mission.phase !== 'combat') {
      const dx = mission.extract.x - player.x, dz = mission.extract.z - player.z;
      ctx.beginPath();
      ctx.arc(dz * scale, -dx * scale, CFG.EXTRACT_RADIUS * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(53,224,138,0.18)';
      ctx.fill();
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      const p = toRadar(e.x, e.z, player.x, player.z, player.yaw, range);
      if (Math.hypot(p.x, p.y) > 1.02) continue;
      ctx.beginPath();
      ctx.arc(p.x * R, p.y * R, 3, 0, Math.PI * 2);
      ctx.fillStyle = e.alert ? RED : 'rgba(255,59,48,0.55)';
      ctx.fill();
    }

    // bullets
    ctx.fillStyle = 'rgba(255,226,122,0.75)';
    for (const b of bullets) {
      const p = toRadar(b.x, b.z, player.x, player.z, player.yaw, range);
      if (Math.hypot(p.x, p.y) > 1.02) continue;
      ctx.fillRect(p.x * R - 1, p.y * R - 1, 2, 2);
    }
    ctx.restore();

    // player arrow, always dead centre pointing up
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 6);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx + 5, cy + 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // sweep
    const t = performance.now() / 1400;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, t % (Math.PI * 2), (t % (Math.PI * 2)) + 0.55);
    ctx.closePath();
    ctx.fillStyle = 'rgba(53,224,138,0.10)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------------------- render -------------------------------- */
  function draw(state) {
    ctx.clearRect(0, 0, W, H);
    const { player, mission, weapon, enemies } = state;
    const compact = W < 700;
    const pad = compact ? 10 : 16;

    // vitals decay tracking for the damage vignette
    if (player.hp < lastHp - 0.5) damageFlash = 1;
    lastHp = player.hp;
    damageFlash = Math.max(0, damageFlash - 0.02);
    hitMarker = Math.max(0, hitMarker - 0.016);

    /* --- top left: vitals --- */
    const bw = compact ? 132 : 200;
    panel(pad, pad, bw + 20, 66, AMBER);
    ctx.fillStyle = AMBER;
    ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('OPERATIVE', pad + 10, pad + 15);
    bar(pad + 10, pad + 22, bw, 12, player.hp / CFG.PLAYER_HP,
      player.hp > 35 ? GREEN : RED, null);
    bar(pad + 10, pad + 40, bw, 8, player.armor / CFG.PLAYER_ARMOR, '#4ea8ff', null);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${Math.ceil(player.hp)} HP`, pad + 14, pad + 32);
    ctx.fillText(`${Math.ceil(player.armor)} AR`, pad + 14, pad + 47);

    /* --- top centre: objective --- */
    const objW = compact ? 190 : 260;
    const ox = W / 2 - objW / 2;
    panel(ox, pad, objW, mission.phase === 'extract' ? 54 : 40, mission.phase === 'extract' ? GREEN : AMBER);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    if (mission.phase === 'combat') {
      ctx.fillText(`ELIMINATE HOSTILES  ${mission.kills}/${mission.killGoal}`, W / 2, pad + 18);
    } else if (mission.phase === 'extract') {
      ctx.fillStyle = GREEN;
      ctx.fillText('REACH EXTRACTION ZONE', W / 2, pad + 18);
      const d = Math.hypot(player.x - mission.extract.x, player.z - mission.extract.z);
      if (d > CFG.EXTRACT_RADIUS) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(`${Math.round(d)} m`, W / 2, pad + 33);
      } else {
        bar(W / 2 - 60, pad + 30, 120, 10, mission.holdTime / CFG.EXTRACT_HOLD, GREEN);
        ctx.fillStyle = '#fff';
        ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('HOLDING', W / 2, pad + 38);
      }
    }
    ctx.fillStyle = AMBER;
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    const scoreTxt = `SCORE ${mission.score}`;
    if (mission.phase !== 'done') ctx.fillText(scoreTxt, W / 2, pad + (mission.phase === 'extract' ? 50 : 36));

    /* --- top right: radar --- */
    const R = compact ? 52 : 74;
    radar(W - pad - R - 4, pad + R + 4, R, state);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${state.grid.range} m`, W - pad - R - 4, pad + R * 2 + 16);

    /* --- bottom right: weapon --- */
    const ww = compact ? 120 : 160;
    panel(W - pad - ww, H - pad - 74, ww, 74, AMBER);
    ctx.textAlign = 'right';
    ctx.fillStyle = AMBER;
    ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(weapon.name, W - pad - 12, H - pad - 56);
    ctx.fillStyle = weapon.reloading ? RED : '#fff';
    ctx.font = '800 30px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(weapon.reloading ? '--' : String(weapon.mag), W - pad - 46, H - pad - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`/ ${CFG.MAG_SIZE}`, W - pad - 12, H - pad - 22);
    if (weapon.reloading) {
      bar(W - pad - ww + 12, H - pad - 14, ww - 24, 5, weapon.reloadProgress, AMBER);
    }

    /* --- bottom left: speedo --- */
    const sw = compact ? 120 : 156;
    panel(pad, H - pad - 74, sw, 74, AMBER);
    const speed = kmh(player.speed);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '800 30px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(Math.round(speed)).padStart(3, '0'), pad + 12, H - pad - 26);
    ctx.fillStyle = AMBER;
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('KM/H', pad + 78, H - pad - 28);
    bar(pad + 12, H - pad - 18, sw - 24, 6, speed / kmh(CFG.MAX_SPEED), AMBER);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(player.drifting ? 'DRIFT' : 'GRIP', pad + 12, H - pad - 60);

    /* --- crosshair --- */
    const cx = W / 2, cy = H / 2;
    const gap = 6 + Math.min(14, player.speed * 0.3);
    ctx.strokeStyle = weapon.reloading ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * gap, cy + dy * gap);
      ctx.lineTo(cx + dx * (gap + 8), cy + dy * (gap + 8));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);

    if (hitMarker > 0) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 2.4;
      const k = 6 + (1 - hitMarker / 0.3) * 8;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * k, cy + sy * k);
        ctx.lineTo(cx + sx * (k + 6), cy + sy * (k + 6));
        ctx.stroke();
      }
    }

    /* --- kill feed --- */
    ctx.textAlign = 'right';
    let fy = pad + R * 2 + 30;
    for (const f of feed) {
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.fillStyle = f.color;
      ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(f.text, W - pad - 4, fy);
      fy += 16;
    }
    ctx.globalAlpha = 1;

    /* --- alive counter --- */
    const alive = enemies.filter((e) => e.alive).length;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`HOSTILES ${alive}`, pad + 10, pad + 82);

    /* --- damage vignette --- */
    const hurt = Math.max(damageFlash * 0.7, player.hp < 30 ? 0.28 + Math.sin(performance.now() / 220) * 0.1 : 0);
    if (hurt > 0.01) {
      const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.62);
      grd.addColorStop(0, 'rgba(200,20,10,0)');
      grd.addColorStop(1, `rgba(200,20,10,${Math.min(0.75, hurt)})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    }
  }

  return {
    resize,
    draw,
    pushFeed,
    hit() { hitMarker = 0.3; },
    hurt() { damageFlash = 1; },
  };
}
