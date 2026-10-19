"use strict";
/* ============================================================================
   Input — keyboard, touch joystick (steer + throttle), NITRO button, gamepad.
   Same control scheme as the original: joystick X steers (left = +1), Y up =
   throttle, Y down = brake/reverse; Space / button = nitro; P = pause.
   ========================================================================== */
VR.input = { steer: 0, throttle: 0, nitro: false, jump: false };
VR.Input = (() => {
  const input = VR.input;
  const keys = { up: false, down: false, left: false, right: false, nitro: false };
  const touch = { steer: 0, throttle: 0, nitro: false, active: false };
  let onPause = null;
  let enabled = true;

  function resolve() {
    if (!enabled) { input.steer = 0; input.throttle = 0; input.nitro = false; return; }
    const kThrottle = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const kSteer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    const g = VR.Input.pad();
    input.throttle = kThrottle !== 0 ? kThrottle : (touch.active ? touch.throttle : g.throttle);
    input.steer = kSteer !== 0 ? kSteer : (touch.active ? touch.steer : g.steer);
    input.nitro = keys.nitro || touch.nitro || g.nitro;
  }

  function setupKeyboard() {
    const map = (e, down) => {
      const k = e.key;
      if (k === "ArrowUp" || k === "w" || k === "W") keys.up = down;
      else if (k === "ArrowDown" || k === "s" || k === "S") keys.down = down;
      else if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = down;
      else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = down;
      else if (k === " " || k === "Spacebar") keys.nitro = down;
      else if (k === "Shift") input.jump = down;
      else return false;
      return true;
    };
    window.addEventListener("keydown", (e) => {
      if (e.repeat) { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault(); return; }
      if (e.key === "p" || e.key === "P" || e.key === "Escape") { if (onPause) onPause(); return; }
      if (map(e, true) && (e.key === " " || e.key.startsWith("Arrow"))) e.preventDefault();
      resolve();
    });
    window.addEventListener("keyup", (e) => { map(e, false); resolve(); });
    window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; touch.active = false; touch.nitro = false; touch.steer = 0; touch.throttle = 0; resolve(); });
  }

  function setupJoystick(wrap, base, stick) {
    let activeId = null, center = { x: 0, y: 0 };
    const idOf = (t) => (t.identifier !== undefined ? t.identifier : (t.pointerId !== undefined ? t.pointerId : 0));
    const radius = () => base.clientWidth / 2;
    function start(e) {
      e.preventDefault();
      const t = e.changedTouches ? e.changedTouches[0] : e;
      if (activeId !== null) return;
      activeId = idOf(t);
      const rect = base.getBoundingClientRect();
      center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      touch.active = true;
      move(e);
    }
    function end(e) {
      const ts = e.changedTouches ? [...e.changedTouches] : [e];
      if (!ts.some((t) => idOf(t) === activeId)) return;
      activeId = null; touch.active = false; touch.steer = 0; touch.throttle = 0;
      stick.style.transform = "translate(-50%,-50%)";
      stick.classList.remove("gas", "rev");
      resolve();
    }
    function move(e) {
      if (activeId === null) return;
      e.preventDefault();
      const ts = e.changedTouches ? [...e.changedTouches] : [e];
      const t = ts.find((x) => idOf(x) === activeId);
      if (!t) return;
      const r = radius(), sr = stick.clientWidth / 2;
      let dx = t.clientX - center.x, dy = t.clientY - center.y;
      const dist = Math.hypot(dx, dy), maxR = Math.max(1, r - sr);
      if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
      stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      touch.steer = -(dx / maxR);
      const yN = dy / maxR, dead = 0.15;
      if (yN < -dead) { touch.throttle = Math.min(1, (-yN - dead) / (1 - dead)); stick.classList.add("gas"); stick.classList.remove("rev"); }
      else if (yN > dead) { touch.throttle = -Math.min(1, (yN - dead) / (1 - dead)); stick.classList.remove("gas"); stick.classList.add("rev"); }
      else { touch.throttle = 0; stick.classList.remove("gas", "rev"); }
      resolve();
    }
    wrap.addEventListener("pointerdown", start, { passive: false });
    wrap.addEventListener("touchstart", start, { passive: false });
    wrap.addEventListener("pointermove", move, { passive: false });
    wrap.addEventListener("touchmove", move, { passive: false });
    wrap.addEventListener("pointerup", end); wrap.addEventListener("touchend", end); wrap.addEventListener("touchcancel", end);
    window.addEventListener("pointerup", (e) => { if (idOf(e) === activeId) end(e); });
  }

  function setupNitro(btn) {
    const set = (on) => { touch.nitro = on; btn.classList.toggle("on", on); resolve(); };
    const stop = (e) => { e.preventDefault(); };
    btn.addEventListener("pointerdown", (e) => { stop(e); set(true); });
    btn.addEventListener("pointerup", (e) => { stop(e); set(false); });
    btn.addEventListener("pointerleave", (e) => { stop(e); set(false); });
    btn.addEventListener("pointercancel", (e) => { stop(e); set(false); });
    btn.addEventListener("touchstart", (e) => { stop(e); set(true); }, { passive: false });
    btn.addEventListener("touchend", (e) => { stop(e); set(false); });
    btn.addEventListener("contextmenu", stop);
  }

  return {
    setPause(fn) { onPause = fn; },
    enable(on) { enabled = on; if (!on) { for (const k in keys) keys[k] = false; touch.nitro = false; touch.steer = 0; touch.throttle = 0; touch.active = false; } resolve(); },
    reset() { for (const k in keys) keys[k] = false; touch.active = false; touch.steer = 0; touch.throttle = 0; touch.nitro = false; input.steer = 0; input.throttle = 0; input.nitro = false; input.jump = false; },
    setupKeyboard, setupJoystick, setupNitro, resolve,
    pad() {
      const out = { steer: 0, throttle: 0, nitro: false };
      try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads) {
          if (!p || !p.connected) continue;
          const ax = p.axes[0] || 0;
          out.steer = Math.abs(ax) > 0.12 ? -ax : 0;
          const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
          out.throttle = rt > 0.05 ? rt : (lt > 0.05 ? -lt : 0);
          out.nitro = !!(p.buttons[0] && p.buttons[0].pressed) || !!(p.buttons[5] && p.buttons[5].pressed);
          break;
        }
      } catch (e) { /* ignore */ }
      return out;
    },
  };
})();
