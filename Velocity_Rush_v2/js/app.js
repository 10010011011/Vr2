"use strict";
/* ============================================================================
   App shell — owns the renderer, scene, atmosphere and post pipeline, runs the
   frame loop, hosts the showroom (menu) scene and starts/stops races.
   ========================================================================== */
VR.App = class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = "menu";                 // menu | race
    this.game = null; this.showroom = null;
    this.fps = { frames: 0, acc: 0, value: 0, last: 0 };
    this.pr = 1; this.prBase = 1; this.gov = { level: 0, slow: 0, calm: 0, lastDown: -1e9, ups: 0 }; this.shadowSkip = false; this._fc = 0;
    this.lastT = performance.now();
    this.t = 0;
    this._init();
  }

  _init() {
    VR.loadSettings();
    const q = (this.q = VR.getQuality());
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }));
    VR.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);
    renderer.shadowMap.enabled = !!q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x05070c, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3400);
    this._buildPipeline();
    this.showroom = new VR.Showroom(this);
    this.scene.add(this.showroom.group);
    this.prBase = this.pr = q.pixelRatio;
    this.resizeToWindow();
    window.addEventListener("resize", () => this.resizeToWindow());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resizeToWindow(), 250));
    this.setMode("menu");
    requestAnimationFrame((t) => this._frame(t));
  }

  _buildPipeline() {
    const q = this.q;
    this.atm = new VR.Atmosphere(this.renderer, this.scene, q);
    this.post = new VR.PostFX(this.renderer, { msaa: q.msaa, bloom: q.bloom, bloomLevels: q.bloomLevels });
  }

  /** Re-create the quality-dependent parts (shadow map size, MSAA, bloom...) after a settings change. */
  applyQuality() {
    if (this.game) return;               // applied on the next race / menu visit
    const q = (this.q = VR.getQuality());
    this.renderer.shadowMap.enabled = !!q.shadows;
    this.scene.remove(this.atm.sky, this.atm.sun, this.atm.sun.target);
    this.atm.dispose(); this.post.dispose();
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this._buildPipeline();
    this.prBase = this.pr = q.pixelRatio;
    this.resizeToWindow();
    this.setMode("menu");
  }

  /* ---------------------------------------------------------------- sizing */
  resizeToWindow() {
    const el = this.canvas;
    this.resize(el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight);
  }
  resize(w, h) {
    this.cssW = Math.max(2, w); this.cssH = Math.max(2, h);
    const r = this.renderer;
    r.setPixelRatio(this.pr);
    r.setSize(this.cssW, this.cssH, false);
    const bw = r.domElement.width, bh = r.domElement.height;
    this.post.setSize(bw, bh);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
    this.onFov(this.camera.fov);
    if (this.showroom) this.showroom.onResize();
  }
  onFov(fov) {
    const bh = this.renderer.domElement.height;
    this.atm.setViewport(bh, fov);
    if (this.game) { this.game.smoke.setScale(bh, fov); this.game.glow.setScale(bh, fov); }
  }
  setPixelRatio(pr) {
    this.pr = VR.clamp(pr, 0.6, this.prBase);
    this.resizeToWindow();
  }

  /* ----------------------------------------------------------------- modes */
  setMode(mode) {
    this.mode = mode;
    this.showroom.group.visible = mode === "menu";
    if (mode === "menu") {
      this.atm.setMode("sunset");
      this.showroom.activate();
      this.scene.fog.density = 0.0004;
      this.camera.near = 0.5; this.camera.updateProjectionMatrix();
    }
  }

  async startRace(opts, progress) {
    if (this.game) this.stopRace();
    this.setMode("race");
    this.atm.setMode(VR.settings.timeOfDay === "dynamic" ? "dynamic" : VR.settings.timeOfDay);
    const game = new VR.Game(this, opts);
    this.game = game;
    this.gov = { level: 0, slow: 0, calm: 0, lastDown: -1e9, ups: 0 }; this.shadowSkip = false;
    this.renderer.shadowMap.autoUpdate = true;
    await game.init(progress);
    this.camera.near = 0.5;
    this.camera.updateProjectionMatrix();
    this.onFov(this.camera.fov);
    this.lastT = performance.now();
    return game;
  }

  stopRace() {
    if (this.game) { try { this.game.destroy(); } catch (e) { console.warn("[destroy]", e); } this.game = null; }
    this.camera.setViewOffset && this.camera.clearViewOffset();
    this.camera.fov = 40; this.camera.updateProjectionMatrix();
    this.post.params.speed = 0; this.post.params.nitro = 0; this.post.params.flash = 0;
    this.gov.level = 0; this.shadowSkip = false; this.renderer.shadowMap.autoUpdate = true;
    if (this.pr !== this.prBase) this._pendingPR = this.prBase;
    this.setMode("menu");
    this.resizeToWindow();
  }

  /** Test/debug helper: advance the race simulation without waiting on the render loop. */
  debugAdvance(sec, dt = 1 / 30) {
    const g = this.game; if (!g || !g.ready) return;
    for (let t = 0; t < sec; t += dt) g.step(dt, performance.now());
  }

  /* ------------------------------------------------------------------ loop */
  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this.lastT) / 1000; this.lastT = now;
    if (!(dt > 0)) dt = 0.016;
    const raw = dt;
    if (dt > 0.05) dt = 0.05;               // the original clamped to 33ms; slightly looser keeps slow devices honest
    if (dt > 0.033) dt = 0.033;
    this.t += dt;
    VR.uniforms.uTime.value = now * 0.001;
    if (document.hidden) return;
    // resolution changes are applied right before drawing so the cleared canvas is never presented
    if (this._pendingPR) { const pr = this._pendingPR; this._pendingPR = 0; this.setPixelRatio(pr); }
    try {
      if (this.mode === "race" && this.game && !this.game.destroyed) {
        if (this.game.ready) { this.game.step(dt, now); if (VR.ui) VR.ui.frame(this.game, dt); }
        if (this.shadowSkip) { this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = (this._fc++ & 1) === 0; }
        this.post.render(this.scene, this.camera, this.atm.sunDir, 1);
      } else if (this.mode === "menu") {
        this.showroom.update(dt);
        const p = this.post.params;
        p.exposure = 1; p.worldLift = this.atm.exposure; p.nightGrade = this.atm.night; p.time = this.t;
        this.post.render(this.scene, this.camera, this.atm.sunDir, 1);
      }
    } catch (e) { if (!this._errShown) { this._errShown = true; console.error("[frame]", e); if (VR.ui) VR.ui.fatal(e); } }
    this._perf(raw, now);
  }

  _applyGov() {
    const g = this.gov, L = g.level;
    const lod = [1, 0.8, 0.65, 0.55][L], res = [1, 1, 0.92, 0.85][L];
    const sc = this.game && this.game.world && this.game.world.parts.scenery;
    if (sc && sc.setLodScale) sc.setLodScale(lod);
    this._pendingPR = this.prBase > 1 ? Math.max(1, this.prBase * res) : this.prBase;
    this.shadowSkip = L >= 3;
    if (!this.shadowSkip) { this.renderer.shadowMap.autoUpdate = true; }
  }

  _perf(raw, now) {
    const f = this.fps;
    f.frames++; f.acc += raw;
    if (f.acc >= 0.5) {
      f.value = f.frames / f.acc;
      if (VR.ui && VR.settings.showFps) VR.ui.setFps(f.value, this.pr);
      // adaptive load shedding (Auto quality only). Sheds scenery distance / shadow refresh first and never drops the
      // render resolution below native, so the picture stays sharp; it recovers slowly and at most twice per race.
      const avg = f.acc / f.frames, g = this.gov;
      if (VR.settings.quality === "auto" && this.mode === "race" && this.game && this.game.countdown <= 0) {
        if (avg > 1 / 38) { g.slow++; g.calm = 0; } else if (avg < 1 / 54) { g.calm++; g.slow = 0; } else { g.slow = 0; g.calm = 0; }
        if (g.slow >= 2 && g.level < 3) { g.level++; g.slow = 0; g.lastDown = now; this._applyGov(); }
        else if (g.calm >= 30 && g.level > 0 && now - g.lastDown > 30000 && g.ups < 2) { g.level--; g.ups++; g.calm = 0; this._applyGov(); }
      }
      f.frames = 0; f.acc = 0;
    }
  }
};

/* ============================================================================
   Showroom — the menu backdrop: a turntable under a dusk sky.
   ========================================================================== */
VR.Showroom = class Showroom {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group(); this.group.name = "showroom";
    this.yaw = 0.7; this.yawVel = 0.0; this.drag = false; this.auto = 1; this.t = 0;
    const L = VR.lin;
    // platform
    const floorMat = VR.reg(new THREE.MeshStandardMaterial({ color: L(0x07080b), roughness: 0.3, metalness: 0.7, envMapIntensity: 0.55 }), 0.55);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.6, 0.4, 96), floorMat);
    floor.position.y = -0.2; floor.receiveShadow = true; this.group.add(floor);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.35, 0.3) });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.05, 0.035, 8, 160), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.012; this.group.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.018, 8, 140), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.55, 0.7) })); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.012; this.group.add(ring2);
    // ground far field: dark, rough, picks up the horizon via fog
    const gm = VR.reg(new THREE.MeshStandardMaterial({ color: L(0x0c0e12), roughness: 0.95, metalness: 0 }), 0.6);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(2800, 64), gm); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.42; this.group.add(ground);
    this.turn = new THREE.Group(); this.group.add(this.turn);
    this.car = null; this.setCar(VR.settings.car | 0);
    this._bindDrag();
  }

  setCar(idx) {
    const p = VR.CAR_PRESETS[VR.clamp(idx | 0, 0, VR.CAR_PRESETS.length - 1)];
    if (this.car) { this.turn.remove(this.car.group); this.car.dispose(); }
    this.car = VR.buildCar({ body: p.body, trim: p.trim, accent: p.accent, number: "1", spot: false });
    this.car.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.turn.add(this.car.group);
    this.car.setNight(this.app.atm ? this.app.atm.night : 0);
    this.car.update(0.016, { speed: 0, steer: 0 });
  }

  activate() {
    this.car.setNight(this.app.atm.night);
    this.app.atm.update(0.016, this.app.camera, new THREE.Vector3(0, 0, 0));
    this.app.atm._captureEnv();
    this.onResize();
  }

  _bindDrag() {
    const c = this.app.canvas;
    let lastX = 0, id = null;
    c.addEventListener("pointerdown", (e) => { if (this.app.mode !== "menu") return; id = e.pointerId; lastX = e.clientX; this.drag = true; this.auto = 0; });
    window.addEventListener("pointermove", (e) => { if (!this.drag || e.pointerId !== id) return; const dx = e.clientX - lastX; lastX = e.clientX; this.yaw -= dx * 0.008; this.yawVel = -dx * 0.008 / 0.016; });
    const up = (e) => { if (e.pointerId !== id) return; this.drag = false; id = null; };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  }

  onResize() {
    const cam = this.app.camera;
    if (this.app.mode !== "menu") return;
    const w = this.app.cssW, h = this.app.cssH;
    const wide = w / h > 1.25;
    cam.fov = wide ? 32 : 40;
    if (wide) cam.setViewOffset(w, h, -w * 0.2, 0, w, h); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.app.onFov(cam.fov);
  }

  update(dt) {
    this.t += dt;
    if (!this.drag) { this.yaw += this.yawVel * dt; this.yawVel *= Math.exp(-2.5 * dt); if (Math.abs(this.yawVel) < 0.02) this.auto = Math.min(1, this.auto + dt * 0.5); this.yaw += dt * 0.28 * this.auto; }
    const cam = this.app.camera;
    const dist = 11.5, h = 1.9 + Math.sin(this.t * 0.3) * 0.12;
    cam.position.set(Math.sin(this.yaw) * dist, h, Math.cos(this.yaw) * dist);
    cam.lookAt(0, 0.62, 0);
    this.car.update(dt, { speed: 0, steer: 0 });
    this.app.atm.update(dt, cam, new THREE.Vector3(0, 0, 0));
    // slow breathing suspension for life
    this.car.inner.position.y = Math.sin(this.t * 1.3) * 0.004;
  }
};
