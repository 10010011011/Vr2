"use strict";
/* ============================================================================
   Race simulation + presentation.
   The driving model, collision rules, lap logic, AI hooks and nitro-bottle
   rules are carried over unchanged from the original game; everything the
   player sees (cars, world, camera, effects, HUD feed) is new.
   ========================================================================== */
const MAX_SPEED = 58;
const NITRO_MAX_SPEED = 88;
const ACCEL = 26;
const BRAKE = 38;
const DRAG = 0.6;
const STEER_RATE = 2.4;
const NITRO_DRAIN = 0.22;
const NITRO_REGEN = 0.06;
const GRAVITY = 28;

VR.Game = class Game {
  /** app: { renderer, scene, camera, atm, post, q, canvas } ; opts: { trackSeed, laps, opponentKind, neuralWeights, neuralGeneration, input, onFinish } */
  constructor(app, opts) {
    this.app = app; this.opts = opts;
    this.scene = app.scene; this.camera = app.camera; this.atm = app.atm; this.post = app.post; this.q = app.q;
    this.destroyed = false; this.finished = false; this.started = false;
    this.elapsedMs = 0; this.time = 0;
    this.msgT = 0;
    this.countdown = 3.4;            // seconds of grid countdown before the race starts
    this.introT = 0;
    this.camHeading = 0; this.camY = 0; this.shake = 0; this.flash = 0; this.fov = 68; this.speedFx = 0;
    this.topSpeed = 0; this.knockouts = 0;
    this._camPos = new THREE.Vector3(); this._camLook = new THREE.Vector3(); this.cameraTarget = new THREE.Vector3();
    this._lastFov = 0;
  }

  /** Build the world + cars (async so the loading screen can animate). */
  async init(progress) {
    const P = progress || (() => {});
    const opts = this.opts, app = this.app;
    P(0.02, "Generating track");
    await VR.yieldFrame();
    this.track = generateTrack(opts.trackSeed);
    this.info = new VR.TrackInfo(this.track);
    this.world = await VR.buildWorld({ track: this.track, info: this.info, seed: opts.trackSeed, q: this.q, atm: this.atm, scene: this.scene, progress: (f, l) => P(0.05 + f * 0.8, l) });
    P(0.88, "Preparing cars"); await VR.yieldFrame();

    // effects
    this.smoke = new VR.ParticlePool(520, { additive: false, soft: 1.3 });
    this.glow = new VR.ParticlePool(640, { additive: true, soft: 1.6 });
    this.skids = new VR.Skids(4, 360);
    this.scene.add(this.smoke.points, this.glow.points, this.skids.mesh);

    // cars
    const start = this.track.samples[0];
    const startHeading = Math.atan2(start.tangent.x, start.tangent.z);
    const presets = VR.CAR_PRESETS;
    const pIdx = VR.clamp(VR.settings.car | 0, 0, presets.length - 1);
    let oIdx = opts.opponentKind === "impossible" ? 5 : 1;
    if (oIdx === pIdx) oIdx = (oIdx + 2) % presets.length;
    this.player = this.spawnCar(presets[pIdx], "1", start.pos, start.normal, 5, startHeading, true, 0);
    this.opponent = this.spawnCar(presets[oIdx], "7", start.pos, start.normal, -5, startHeading, false, 2);
    this.player._lapStartProgress = 0; this.opponent._lapStartProgress = 0;
    this.player.speed = 0; this.opponent.speed = 0;

    if (opts.opponentKind === "impossible") {
      this.opponent.isImpossible = true;
      this.opponentAI = new ImpossibleOpponent(this.track, opts.neuralWeights || null, opts.neuralGeneration || 0);
    } else {
      this.opponent.isImpossible = false;
      this.opponentAI = new ScriptedOpponent(this.track, 1.05, 320, 88);
    }

    // nitro bottles (same placement rules as the original: 18 along the lap, never on water)
    const rng = Math.random;
    this.bottleSet = VR.buildNitroBottles(this.track, rng);
    this.nitroBottles = this.bottleSet.bottles;
    this.scene.add(this.bottleSet.group);

    this.camHeading = startHeading;
    this.camY = start.pos.y + 3;
    this.handleResize();
    this._placeIntroCamera();
    this.ready = true;
    P(1, "Ready");
  }

  spawnCar(preset, number, pos, normal, lane, heading, isPlayer, trailBase) {
    const vis = VR.buildCar({ body: preset.body, trim: preset.trim, accent: preset.accent, number, spot: isPlayer });
    const wpos = pos.clone().addScaledVector(normal, lane); wpos.y += 0.2;
    vis.group.position.copy(wpos); vis.group.rotation.y = heading;
    this.scene.add(vis.group);
    return {
      pos: wpos.clone(), velY: 0, heading, speed: 0, lateralVel: 0, nitroCharge: 1, nitroActive: false, airborne: false,
      knockoutMs: 0, wallCooldownMs: 0, spinAngle: 0, driftAngle: 0, driftSlip: 0, progress: 0, laps: 0, totalProgress: 0,
      mesh: vis.group, nitro: vis.nitro, vis, trailBase, isPlayer, _steerVis: 0, _braking: false, _drifting: 0,
    };
  }

  /* ----------------------------------------------------------------------- */
  handleResize = () => {
    const a = this.app, el = a.canvas;
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    a.resize(w, h);
    this._lastFov = 0;
  };

  destroy() {
    this.destroyed = true;
    if (this.world) this.world.dispose();
    for (const c of [this.player, this.opponent]) if (c) { this.scene.remove(c.mesh); c.vis.dispose(); }
    if (this.bottleSet) { this.scene.remove(this.bottleSet.group); this.bottleSet.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    for (const f of [this.smoke, this.glow]) if (f) { this.scene.remove(f.points); f.points.geometry.dispose(); f.points.material.dispose(); }
    if (this.skids) { this.scene.remove(this.skids.mesh); this.skids.mesh.geometry.dispose(); this.skids.mesh.material.dispose(); }
    VR.setAmbientScale(1);
  }

  /* ------------------------------------------------------------------ frame */
  /** Advance the race by dt seconds and update all visuals. */
  step(dt, now) {
    if (this.destroyed) return;
    this.time += dt;
    const state = gameStore;
    VR.Input.resolve();
    let simDt = dt;
    const racing = !state.paused && !this.finished;
    if (this.countdown > 0) {
      if (!state.paused) this._tickCountdown(dt);
      simDt = 0;
    }
    if (racing && simDt > 0) {
      this.elapsedMs += simDt * 1000;
      this.update(simDt);
    } else if (this.finished && !state.paused) {
      this._coast(dt);
    }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) gameStore.setHud({ message: null }); }

    // visuals always run (even paused) so the scene stays alive
    const vdt = state.paused ? 0 : dt;
    this.bottleSet.update(vdt, this.time);
    this._updateCarVisuals(vdt);
    this.smoke.update(vdt); this.glow.update(vdt); this.skids.update();
    this.world.update(vdt, this.camera, { time: this.time, pos: this.player.pos });
    this.atm.update(vdt, this.camera, this.player.pos);
    this._updateCamera(dt);
    this._updatePost(dt);
    this.publishHud();
  }

  _tickCountdown(dt) {
    const before = this.countdown;
    this.countdown -= dt;
    this.introT = Math.min(1, this.introT + dt / 3.0);
    const sec = Math.ceil(this.countdown - 0.4);
    const prevSec = Math.ceil(before - 0.4);
    if (this.countdown > 0.4) {
      if (sec !== prevSec || gameStore.countdown == null) gameStore.setHud({ countdown: String(Math.max(1, sec)) });
    } else if (this.countdown > 0) {
      if (gameStore.countdown !== "GO") gameStore.setHud({ countdown: "GO" });
    }
    if (this.countdown <= 0) {
      this.countdown = 0; this.started = true; gameStore.setHud({ countdown: null });
      this.player.speed = 8; this.opponent.speed = 8;
    }
  }

  update(dt) {
    this.updateCar(this.player, this.opts.input, dt);
    const oppInput = this.opponentAI.update(this.opponent, this.player, dt, this.nitroBottles);
    this.updateCar(this.opponent, { steer: oppInput.steer, throttle: oppInput.throttle, nitro: oppInput.nitro, jump: oppInput.jump }, dt, true);
    this.handleCombat(dt);
    this.updateNitroBottles(dt);
    this.topSpeed = Math.max(this.topSpeed, this.player.speed * 3.6);

    const totalLaps = this.opts.laps;
    if (this.elapsedMs < 500) return;
    if (this.player.laps >= totalLaps && !this.finished) {
      this.finished = true; this._finish("player");
    } else if (this.opponent.laps >= totalLaps && !this.finished) {
      this.finished = true; this._finish("opponent");
    }
  }

  _finish(winner) {
    this.finishT = 0;
    this.opts.onFinish(winner, this.elapsedMs, { topSpeed: this.topSpeed, knockouts: this.knockouts, gap: this._gapMeters() });
  }

  /** after the flag: cars roll to a stop (visual only) */
  _coast(dt) {
    this.finishT = (this.finishT || 0) + dt;
    for (const c of [this.player, this.opponent]) {
      c.speed = Math.max(0, c.speed - 14 * dt);
      c.pos.x += Math.sin(c.heading) * c.speed * dt; c.pos.z += Math.cos(c.heading) * c.speed * dt;
      const idx = nearestSampleIndex(this.track, c.pos, c.progress); c.progress = idx;
      const s = this.track.samples[idx]; c.pos.y += (s.pos.y + 0.2 - c.pos.y) * Math.min(1, dt * 10);
      const lat = c.pos.clone().sub(s.pos).dot(s.normal), half = this.track.roadWidth / 2 - 0.5;
      if (Math.abs(lat) > half) c.pos.addScaledVector(s.normal, -Math.sign(lat) * (Math.abs(lat) - half));
      c.nitroActive = false;
      c.mesh.position.copy(c.pos);
    }
  }

  updateNitroBottles(dt) {
    for (const b of this.nitroBottles) {
      if (b.taken) continue;
      const dx = this.player.pos.x - b.pos.x, dz = this.player.pos.z - b.pos.z, dy = this.player.pos.y - b.pos.y;
      if (dx * dx + dz * dz + dy * dy < 12) {
        this.player.nitroCharge = Math.min(1, this.player.nitroCharge + 0.35);
        b.taken = true; b.mesh.visible = false;
        this._pickupBurst(b.pos);
        this.flashMessage("NITRO!", "nitro");
      }
      const odx = this.opponent.pos.x - b.pos.x, odz = this.opponent.pos.z - b.pos.z, ody = this.opponent.pos.y - b.pos.y;
      if (odx * odx + odz * odz + ody * ody < 12) {
        this.opponent.nitroCharge = Math.min(1, this.opponent.nitroCharge + 0.35);
        b.taken = true; b.mesh.visible = false;
        this._pickupBurst(b.pos);
        const pdx = this.player.pos.x - b.pos.x, pdz = this.player.pos.z - b.pos.z;
        if (pdx * pdx + pdz * pdz < 900) this.flashMessage("NITRO STOLEN!", "danger");
      }
    }
  }

  updateCar(c, input, dt, isOpponent = false) {
    if (c.knockoutMs > 0) {
      c.knockoutMs -= dt * 1000;
      c.spinAngle += dt * 14;
      c.speed = Math.max(0, c.speed - 18 * dt);
    } else {
      const accelRate = c.isImpossible ? ACCEL * 1.4 : ACCEL;
      if (input.throttle > 0) c.speed += accelRate * input.throttle * dt;
      else if (input.throttle < 0) c.speed += BRAKE * input.throttle * dt;

      c.nitroActive = input.nitro && c.nitroCharge > 0.0;
      if (c.nitroActive) {
        c.nitroCharge = Math.max(0, c.nitroCharge - NITRO_DRAIN * dt);
        c.speed += accelRate * 0.95 * dt;
      } else {
        const regenMult = isOpponent ? gameStore.oppNitroMult : 1;
        c.nitroCharge = Math.min(1, c.nitroCharge + NITRO_REGEN * regenMult * dt);
      }

      const topNitroSpd = c.isImpossible ? 115 : NITRO_MAX_SPEED;
      const topBaseSpd = c.isImpossible ? 72 : MAX_SPEED;
      const maxS = c.nitroActive ? topNitroSpd : topBaseSpd;
      if (c.speed > maxS) c.speed -= (c.speed - maxS) * Math.min(1, dt * 6);
      c.speed -= Math.sign(c.speed) * DRAG * dt * (Math.abs(c.speed) * 0.05 + 1);
      if (Math.abs(c.speed) < 0.05) c.speed = 0;

      const absSpd = Math.abs(c.speed);
      const speedFactor = Math.min(1, absSpd / 20 + 0.1);
      if (isOpponent) {
        c._smoothedSteer = c._smoothedSteer === undefined ? input.steer : c._smoothedSteer;
        c._smoothedSteer += (input.steer - c._smoothedSteer) * Math.min(1, dt * 14);
      }
      const steerInput = isOpponent ? c._smoothedSteer : input.steer;

      const isBraking = input.throttle < 0 && c.speed > 8;
      const isHandbrake = isBraking && Math.abs(steerInput) > 0.25;
      const slipTarget = steerInput * (isHandbrake ? 1.1 : 0.4) * speedFactor;
      const slipRate = isHandbrake ? 5.0 : 3.5;
      const slipDecay = isHandbrake ? 2.5 : 4.0;
      if (isHandbrake) c.driftSlip = Math.min(1, c.driftSlip + dt * slipRate);
      else c.driftSlip = Math.max(0, c.driftSlip - dt * slipDecay);
      c.driftAngle = THREE.MathUtils.lerp(c.driftAngle, slipTarget * 0.7, dt * (isHandbrake ? 3 : 7));

      const highSpeedDamp = 1 - Math.max(0, absSpd - 30) / 80;
      const steering = steerInput * STEER_RATE * dt * speedFactor * highSpeedDamp;
      c.heading += steering;

      c.speed -= c.driftSlip * (isHandbrake ? 5 : 2) * dt;
      c._braking = isBraking; c._steerVis = steerInput;
    }

    if (c.speed > 3) {
      const cIdx = nearestSampleIndex(this.track, c.pos, c.progress);
      const cS = this.track.samples[cIdx];
      const trackDir = Math.atan2(cS.tangent.x, cS.tangent.z);
      let hErr = c.heading - trackDir;
      while (hErr > Math.PI) hErr -= Math.PI * 2;
      while (hErr < -Math.PI) hErr += Math.PI * 2;
      if (Math.abs(hErr) > 1.75) {
        const correction = -Math.sign(hErr) * Math.min(3.5, (Math.abs(hErr) - 1.75) * 4) * dt;
        c.heading += correction;
        c.speed *= Math.max(0.85, 1 - dt * 2);
      }
    }

    const moveAngle = c.heading + c.driftAngle;
    c.pos.x += Math.sin(moveAngle) * c.speed * dt;
    c.pos.z += Math.cos(moveAngle) * c.speed * dt;

    const idx = nearestSampleIndex(this.track, c.pos, c.progress);
    const s = this.track.samples[idx];
    const groundY = s.pos.y + 0.2;

    if (c.airborne) {
      c.velY -= GRAVITY * dt;
      c.pos.y += c.velY * dt;
      if (c.pos.y <= groundY) { c.pos.y = groundY; c.velY = 0; c.airborne = false; }
    } else {
      c.pos.y += (groundY - c.pos.y) * Math.min(1, dt * 10);
    }

    const lateral = c.pos.clone().sub(s.pos).dot(s.normal);
    const half = this.track.roadWidth / 2 - 0.5;
    const inWall = Math.abs(lateral) > half;
    c._hitWall = false;
    if (inWall) {
      const wallSign = Math.sign(lateral);
      c.pos.addScaledVector(s.normal, -wallSign * (Math.abs(lateral) - half));
      const nx = wallSign * s.normal.x, nz = wallSign * s.normal.z;
      const vx = Math.sin(c.heading) * c.speed, vz = Math.cos(c.heading) * c.speed;
      const vDotN = vx * nx + vz * nz;
      if (!c.wasInWall && vDotN > 0) {
        const newVx = vx - vDotN * nx, newVz = vz - vDotN * nz;
        c.speed = Math.sign(c.speed || 1) * Math.hypot(newVx, newVz);
        c._hitWall = true; c._hitImpact = vDotN; c._wallN = [nx, nz];
      } else if (c.wasInWall) {
        const drain = (4 / 3.6) * dt;
        const absSpd = Math.abs(c.speed);
        c.speed = Math.sign(c.speed) * Math.max(0, absSpd - drain);
        c._hitWall = Math.abs(c.speed) > 4; c._hitImpact = 0; c._wallN = [nx, nz];
      }
      c.driftSlip = 0;
    } else {
      c._wallContactFrames = 0;
    }
    c.wasInWall = inWall;

    const prev = c.progress;
    c.progress = idx;
    const N = this.track.samples.length;
    if (prev > N * 0.82 && idx < N * 0.18 && c.speed > 0) {
      const progressSinceLap = c._lapStartProgress !== undefined ? (c.totalProgress - c._lapStartProgress) : N;
      if (progressSinceLap > N * 0.6) {
        c.laps++;
        c._lapStartProgress = c.laps * N + idx;
        if (c.isPlayer && c.laps < this.opts.laps) this.flashMessage("LAP " + (c.laps + 1), "info");
      }
    }
    c.totalProgress = c.laps * N + idx;

    const targetRot = c.heading + (c.knockoutMs > 0 ? c.spinAngle : 0) + c.driftAngle;
    c.mesh.position.copy(c.pos);
    let rotDiff = targetRot - c.mesh.rotation.y;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    c.mesh.rotation.y += rotDiff * Math.min(1, dt * 12);

    this._carEffects(c, dt);
  }

  handleCombat(_dt) {
    const p = this.player, o = this.opponent;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, dy = o.pos.y - p.pos.y;
    const dist2 = dx * dx + dz * dz;
    if (dist2 > 16) return;
    if (p.airborne && p.pos.y > o.pos.y + 0.8 && p.velY < 0 && o.knockoutMs <= 0) {
      o.knockoutMs = 1600; p.velY = 8; p.airborne = true;
      this._impact(o.pos, 1.0); this.knockouts++;
      this.flashMessage("LANDED ON OPPONENT!", "good");
      return;
    }
    if (o.airborne && o.pos.y > p.pos.y + 0.8 && o.velY < 0 && p.knockoutMs <= 0) {
      p.knockoutMs = 1600; o.velY = 8; o.airborne = true;
      this._impact(p.pos, 1.0);
      this.flashMessage("YOU GOT JUMPED ON!", "danger");
      return;
    }
    if (dist2 < 7 && Math.abs(dy) < 1.2) {
      const pvx = Math.sin(p.heading) * p.speed, pvz = Math.cos(p.heading) * p.speed;
      const ovx = Math.sin(o.heading) * o.speed, ovz = Math.cos(o.heading) * o.speed;
      const len = Math.sqrt(dist2) || 1;
      const nx = dx / len, nz = dz / len;
      const approach = (pvx - ovx) * nx + (pvz - ovz) * nz;
      const mutualNitro = p.nitroActive && o.nitroActive;
      const mid = { x: (p.pos.x + o.pos.x) / 2, y: p.pos.y, z: (p.pos.z + o.pos.z) / 2 };
      if (!mutualNitro) {
        if (approach > 6 || (p.nitroActive && approach > 1)) {
          if (o.knockoutMs <= 0) {
            o.knockoutMs = 1200; p.speed *= 0.92; this.knockouts++;
            this._impact(mid, 0.8);
            this.flashMessage("KNOCK OUT!", "good");
          }
        } else if (-approach > 6 || (o.nitroActive && -approach > 1)) {
          if (p.knockoutMs <= 0) {
            p.knockoutMs = 1200; o.speed *= 0.92;
            this._impact(mid, 0.8);
            this.flashMessage("KNOCKED OUT", "danger");
          }
        } else {
          p.pos.addScaledVector(new THREE.Vector3(nx, 0, nz), -0.3);
          o.pos.addScaledVector(new THREE.Vector3(nx, 0, nz), 0.3);
          this._sparks(mid.x, mid.y + 0.6, mid.z, 4, 0.5);
        }
      } else {
        p.pos.addScaledVector(new THREE.Vector3(nx, 0, nz), -0.4);
        o.pos.addScaledVector(new THREE.Vector3(nx, 0, nz), 0.4);
        this._sparks(mid.x, mid.y + 0.6, mid.z, 6, 0.6);
      }
    }
  }

  flashMessage(msg, kind) {
    this.msgT = 1.3;
    gameStore.setHud({ message: msg, messageKind: kind || "info", messageId: (gameStore.messageId || 0) + 1 });
  }

  /* ----------------------------------------------------------------- effects */
  _sparks(x, y, z, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 7) * power;
      this.glow.emit(x, y, z, Math.cos(a) * s, 1.5 + Math.random() * 4 * power, Math.sin(a) * s, 0.16 + Math.random() * 0.1, 0.35 + Math.random() * 0.35, 3.0, 1.7, 0.6, 1.0, -0.15, 1.2, -14);
    }
  }
  _impact(p, power) {
    this._sparks(p.x, p.y + 0.7, p.z, 28, power * 1.4);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 6.28;
      this.smoke.emit(p.x, p.y + 0.5, p.z, Math.cos(a) * 3, 0.8 + Math.random(), Math.sin(a) * 3, 0.9, 1.1, 0.6, 0.6, 0.62, 0.5, 2.2, 2.0, 0.4);
    }
    this.glow.emit(p.x, p.y + 0.8, p.z, 0, 0, 0, 3.5, 0.18, 3.0, 2.2, 1.2, 0.9, 12, 0, 0);
    this.shake = Math.max(this.shake, 0.5 * power);
    this.flash = Math.max(this.flash, 0.35 * power);
  }
  _pickupBurst(p) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, up = Math.random() * 6, s = 2 + Math.random() * 6;
      this.glow.emit(p.x, p.y, p.z, Math.cos(a) * s, up, Math.sin(a) * s, 0.22 + Math.random() * 0.2, 0.6 + Math.random() * 0.4, 0.5, 1.4, 2.4, 1.0, -0.1, 1.5, -2);
    }
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, 3.2, 0.3, 0.6, 1.6, 2.6, 0.8, 10, 0, 0);
  }

  _carEffects(c, dt) {
    const q = this.q;
    const m = c.mesh.rotation.y, fx = Math.sin(m), fz = Math.cos(m), rx = Math.cos(m), rz = -Math.sin(m);
    const spd = Math.abs(c.speed);
    // tyre smoke + skid marks (rear wheels)
    const slip = Math.max(c.driftSlip, c._braking && spd > 18 ? 0.55 : 0, c.knockoutMs > 0 ? 0.9 : 0);
    const wheelPts = [[-0.91, -1.52], [0.91, -1.52]];
    for (let i = 0; i < 2; i++) {
      const wx = c.pos.x + rx * wheelPts[i][0] + fx * wheelPts[i][1], wz = c.pos.z + rz * wheelPts[i][0] + fz * wheelPts[i][1];
      if (q.skid) this.skids.add(c.trailBase + i, wx, c.pos.y, wz, rx, rz, slip > 0.15 && spd > 6 ? Math.min(1, slip * 1.2) : 0);
      if (slip > 0.2 && spd > 6 && Math.random() < dt * 70 * q.particles) {
        const lt = 0.18 + Math.random() * 0.12;
        this.smoke.emit(wx, c.pos.y + 0.15, wz, (Math.random() - 0.5) * 1.2 - fx * 0.5, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2 - fz * 0.5, 0.55, 0.9 + lt * 3, 0.72, 0.72, 0.74, 0.34 * Math.min(1, slip + 0.3), 2.4, 1.6, 0.25);
      }
    }
    // nitro sparks from the exhausts
    if (c.nitroActive) {
      const n = Math.max(1, Math.round(dt * 120 * q.particles));
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? 1 : -1;
        const ex = c.pos.x + rx * side * 0.34 - fx * 2.5, ez = c.pos.z + rz * side * 0.34 - fz * 2.5;
        const back = 10 + Math.random() * 9;
        this.glow.emit(ex, c.pos.y + 0.5, ez, -fx * back + c.speed * fx * 0.15 + (Math.random() - 0.5) * 2, (Math.random() - 0.4) * 1.5, -fz * back + c.speed * fz * 0.15 + (Math.random() - 0.5) * 2, 0.17 + Math.random() * 0.12, 0.25 + Math.random() * 0.25, 0.35, 0.8, 2.0, 0.9, -0.2, 1.5, 0);
      }
    }
    // wall scrape sparks
    if (c._hitWall && spd > 5) {
      const nx = c._wallN ? c._wallN[0] : 0, nz = c._wallN ? c._wallN[1] : 0;
      const n = Math.round((c._hitImpact > 2 ? 14 : 3) * q.particles);
      for (let k = 0; k < n; k++) {
        const s = 3 + Math.random() * 8;
        this.glow.emit(c.pos.x + nx * 1.0, c.pos.y + 0.35 + Math.random() * 0.3, c.pos.z + nz * 1.0, fx * s * 0.6 - nx * 1 + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, fz * s * 0.6 - nz * 1 + (Math.random() - 0.5) * 3, 0.14 + Math.random() * 0.1, 0.3 + Math.random() * 0.3, 3.2, 1.8, 0.55, 1.0, -0.1, 1.0, -12);
      }
      if (c.isPlayer && c._hitImpact > 4) { this.shake = Math.max(this.shake, Math.min(0.45, c._hitImpact * 0.025)); }
    }
  }

  _updateCarVisuals(dt) {
    const night = this.atm.night;
    for (const c of [this.player, this.opponent]) {
      const spd = c.speed;
      c.vis.setNight(night);
      c.vis.update(dt, {
        speed: spd, steer: c._steerVis || 0, brake: c._braking || (c.knockoutMs > 0), nitro: c.nitroActive, drift: c.driftSlip,
        knock: c.knockoutMs > 0,
      });
    }
    // ambient light colour for sprites/smoke
    const L = this.atm.skyU.uHorizon.value, day = this.atm.dayFactor;
    const k = 0.25 + day * 0.85;
    this.smoke.uniforms.uLight.value.setRGB(Math.min(1.4, (0.5 + L.r) * k), Math.min(1.4, (0.5 + L.g) * k), Math.min(1.4, (0.5 + L.b) * k));
    this.skids.mesh.material.uniforms.uLight.value.setScalar(1);
  }

  /* ------------------------------------------------------------------ camera */
  _placeIntroCamera() { this._updateCamera(0.016, true); }

  _updateCamera(dt, snap) {
    const c = this.player, cam = this.camera;
    const mode = VR.settings.camera || "chase";
    const spd = Math.max(0, c.speed), sN = VR.saturate(spd / 90);
    const nitroN = c.vis.nitro.level || 0;
    let heading = c.heading + c.driftAngle * 0.7;
    const intro = this.countdown > 0 && !this.finished ? this.introT : 1;
    const ease = intro * intro * (3 - 2 * intro);
    // heading smoothing: the chase camera swings behind the car instead of being bolted to it
    const k = snap ? 1 : 1 - Math.exp(-(mode === "bumper" ? 14 : 5.5) * dt);
    this.camHeading += VR.angleDiff(heading, this.camHeading) * k;
    let ch = this.camHeading;
    let dist, height, look, fov, lookY = 1.1;
    if (mode === "bumper") { dist = -1.1; height = 0.95; look = 18; fov = 74 + sN * 12 + nitroN * 6; lookY = 0.9; }
    else if (mode === "far") { dist = 12.5 + sN * 3 + nitroN * 1.2; height = 5.2 + sN * 0.8; look = 14 + sN * 6; fov = 62 + sN * 10 + nitroN * 5; }
    else { dist = 8.6 + sN * 2.2 + nitroN * 1.0; height = 3.2 + sN * 0.5; look = 11 + sN * 6; fov = 68 + sN * 10 + nitroN * 6; }
    if (this.countdown > 0 && !this.finished) {
      // grid-side sweep: start beside the nose, glide round to the chase position
      ch += (1 - ease) * 2.1; dist = VR.lerp(7.2, dist, ease); height = VR.lerp(1.6, height, ease); fov = VR.lerp(48, fov, ease); look = VR.lerp(2, look, ease);
    } else if (this.finished) {
      this.camOrbit = (this.camOrbit || 0) + dt * 0.35;
      ch += this.camOrbit + 0.6; dist = 10.5; height = 3.4; fov = 58; look = 0;
    }
    const fx = Math.sin(ch), fz = Math.cos(ch);
    const tx = c.pos.x - fx * dist, tz = c.pos.z - fz * dist;
    const ty = c.pos.y + height;
    this.camY += (ty - this.camY) * (snap ? 1 : 1 - Math.exp(-9 * dt));
    let cy = this.camY;
    // never dip below the road surface under the camera
    if (this.track) {
      const idx = nearestSampleIndex(this.track, { x: tx, z: tz }, c.progress);
      const gy = this.track.samples[idx].pos.y + 0.2;
      cy = Math.max(cy, gy + (mode === "bumper" ? 0.5 : 1.3));
    }
    this._camPos.set(tx, cy, tz);
    this._camLook.set(c.pos.x + fx * look, c.pos.y + lookY + (mode === "bumper" ? 0.2 : 0), c.pos.z + fz * look);
    if (this.finished) this._camLook.set(c.pos.x, c.pos.y + 0.9, c.pos.z);
    // shake
    if (this.shake > 0.001) {
      const t = this.time * 60, a = this.shake;
      this._camPos.x += Math.sin(t * 1.7) * a * 0.35; this._camPos.y += Math.sin(t * 2.3) * a * 0.3; this._camPos.z += Math.cos(t * 1.3) * a * 0.35;
      this.shake *= Math.exp(-6 * dt);
    }
    // high-speed rumble
    if (spd > 50 && !this.finished) { const r = (spd - 50) / 60 * 0.012; const t = this.time * 47; this._camPos.y += Math.sin(t) * r; this._camPos.x += Math.cos(t * 1.3) * r; }
    cam.position.copy(this._camPos);
    this.cameraTarget.lerp(this._camLook, snap ? 1 : 1 - Math.exp(-16 * dt));
    cam.lookAt(this.cameraTarget);
    this.fov += (fov - this.fov) * (snap ? 1 : 1 - Math.exp(-4 * dt));
    if (Math.abs(this.fov - cam.fov) > 0.02) {
      cam.fov = this.fov; cam.updateProjectionMatrix();
      this.app.onFov(cam.fov);
    }
    // keep the player's headlight beam tidy and the player car visible in bumper cam
    c.mesh.visible = !(mode === "bumper");
  }

  _updatePost(dt) {
    const p = this.post.params, c = this.player, atm = this.atm;
    const target = VR.smoothstep(32, 95, Math.max(0, c.speed)) * (0.55 + 0.45 * (c.vis.nitro.level || 0));
    this.speedFx += (target - this.speedFx) * Math.min(1, dt * 4);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    p.exposure = 1; p.worldLift = atm.exposure; p.nightGrade = atm.night;
    p.speed = this.speedFx * 0.9;
    p.nitro = c.vis.nitro.level || 0;
    p.flash = this.flash;
    p.time = this.time;
  }

  /* --------------------------------------------------------------------- HUD */
  _gapMeters() {
    const N = this.track.samples.length;
    return (this.player.totalProgress - this.opponent.totalProgress) * (this.info.length / N);
  }

  publishHud() {
    const c = this.player, N = this.track.samples.length;
    const playerAhead = c.totalProgress >= this.opponent.totalProgress;
    gameStore.setHud({
      speed: Math.max(0, c.speed * 3.6), nitro: c.nitroCharge, nitroActive: c.nitroActive,
      position: playerAhead ? 1 : 2, lap: Math.min(this.opts.laps, c.laps + 1), progress: c.progress / N,
      lapTimeMs: this.elapsedMs, gap: this._gapMeters(), knock: c.knockoutMs > 0,
    });
  }
};
