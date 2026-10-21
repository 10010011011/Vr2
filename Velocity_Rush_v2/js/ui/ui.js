"use strict";
/* ============================================================================
   UI controller — menu, settings, HUD, pause / finish overlays, minimap.
   ========================================================================== */
VR.ui = (() => {
  const $ = (id) => document.getElementById(id);
  const U = {};
  let app = null, game = null;
  let racing = false, bootToken = 0;
  const hud = {};
  let lastMsgId = 0, lastCountdown = null;
  const mm = { ctx: null, pts: null, frame: 0 };
  let keyHintTimer = 0;

  /* ----------------------------------------------------------------- views */
  U.show = function show(name) {
    for (const v of document.querySelectorAll(".view")) v.classList.toggle("active", v.id === name);
    if (name === "settings" || name === "menu") refreshBrain();
  };

  /* ----------------------------------------------------------- menu wiring */
  function updateMenuSelection() {
    const s = gameStore;
    document.querySelectorAll("#diff-grid .opp").forEach((b) => b.classList.toggle("active", b.dataset.diff === s.difficulty));
    const canLearn = s.difficulty !== "low";
    const lr = $("btn-learn");
    lr.classList.toggle("off", !canLearn);
    lr.setAttribute("aria-checked", String(canLearn && s.learning));
    $("learn-sub").textContent = canLearn ? "Rival adapts to you over races" : "Not available on Low";
    try { localStorage.setItem("vr_diff", JSON.stringify({ d: s.difficulty, l: s.learning })); } catch {}
    document.querySelectorAll(".lap-btn").forEach((b) => b.classList.toggle("active", parseInt(b.dataset.laps) === s.laps));
    const sl = $("nitroMultSlider");
    sl.value = s.oppNitroMult;
    sl.style.setProperty("--p", ((s.oppNitroMult - 1) / 4) * 100 + "%");
    $("nitroMultLabel").textContent = s.oppNitroMult + "x";
  }

  function refreshBrain() {
    loadBrain().then((b) => {
      const lb = b && b.v === 2 && b.levels && b.levels[gameStore.difficulty];
      gameStore.setBrainStats(lb ? lb.stats : { generation: 0, races: 0, bestFitness: 0, lastFitness: 0, wins: 0 });
    });
  }
  function updateBrainUI(st) {
    if (!st) return;
    $("brain-chip").textContent = "GEN " + (st.generation || 0);
    $("st-gen").textContent = st.generation || 0;
    $("st-races").textContent = st.races || 0;
    $("st-wins").textContent = st.wins || 0;
    $("st-best").textContent = Math.round(st.bestFitness || 0);
  }

  function buildSwatches() {
    const host = $("swatches");
    host.innerHTML = "";
    VR.CAR_PRESETS.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sw"; b.setAttribute("aria-label", p.name);
      const c = "#" + new THREE.Color(p.body).getHexString(), t = "#" + new THREE.Color(p.trim).getHexString();
      b.style.background = `linear-gradient(135deg, ${c} 0 60%, ${t} 60% 100%)`;
      b.addEventListener("click", () => selectCar(i));
      host.appendChild(b);
    });
    selectCar(VR.clamp(VR.settings.car | 0, 0, VR.CAR_PRESETS.length - 1), true);
  }
  function selectCar(i, silent) {
    VR.settings.car = i;
    if (!silent) VR.saveSettings();
    [...$("swatches").children].forEach((el, k) => el.classList.toggle("active", k === i));
    $("livery-name").textContent = VR.CAR_PRESETS[i].name;
    if (app && app.showroom && !silent) app.showroom.setCar(i);
  }

  /* -------------------------------------------------------------- settings */
  function syncSettings() {
    document.querySelectorAll(".seg[data-setting]").forEach((seg) => {
      const key = seg.dataset.setting, cur = String(VR.settings[key]);
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === cur));
    });
    const q = VR.settings.quality;
    $("quality-note").textContent = q === "auto" ? `Auto picks a preset for your device (${VR.resolveQualityName()}) and trims resolution on the fly to hold frame-rate.`
      : { low: "Fastest: no shadows or bloom, fewer trees. Best for older phones.", medium: "Balanced: shadows, bloom and full scenery at moderate resolution.", high: "MSAA, soft shadows, dense foliage and full post-processing.", ultra: "Everything on at the highest resolution — needs a strong GPU." }[q];
  }
  function wireSettings() {
    document.querySelectorAll(".seg[data-setting]").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        const key = seg.dataset.setting;
        let v = b.dataset.v; if (seg.dataset.bool) v = v === "true";
        VR.settings[key] = v; VR.saveSettings(); syncSettings();
        if (key === "quality") app.applyQuality();
        if (key === "showFps") $("fps").classList.toggle("hidden", !v);
      });
    });
    $("tabs").addEventListener("click", (e) => {
      const t = e.target.closest(".tab"); if (!t) return;
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === "tab-" + t.dataset.tab));
    });
    $("btn-reset-brain").addEventListener("click", async () => {
      const btn = $("btn-reset-brain");
      btn.textContent = "Clearing…";
      await clearBrain();
      gameStore.setBrainStats({ generation: 0, races: 0, bestFitness: 0, lastFitness: 0, wins: 0 });
      btn.textContent = "Reset Kitsune brain";
      $("cleared").textContent = "Kitsune memory cleared.";
      setTimeout(() => ($("cleared").textContent = ""), 2200);
    });
  }

  /* ------------------------------------------------------------------- HUD */
  function buildGauge() {
    const g = $("gauge-ticks");
    const cx = 130, cy = 112.6, r = 100, a0 = 159, sweep = 222;
    let html = "";
    for (let v = 0; v <= 400; v += 20) {
      const major = v % 100 === 0, th = ((a0 + sweep * (v / 400)) * Math.PI) / 180;
      const r1 = r + (major ? 16 : 12), r0 = r + 7;
      html += `<line x1="${(cx + Math.cos(th) * r0).toFixed(1)}" y1="${(cy + Math.sin(th) * r0).toFixed(1)}" x2="${(cx + Math.cos(th) * r1).toFixed(1)}" y2="${(cy + Math.sin(th) * r1).toFixed(1)}" stroke="rgba(255,255,255,${major ? 0.6 : 0.28})" stroke-width="${major ? 2.2 : 1.4}" stroke-linecap="round"/>`;
    }
    g.innerHTML = html;
    const segs = $("hud-nitro"); segs.innerHTML = "";
    for (let i = 0; i < 24; i++) segs.appendChild(document.createElement("i"));
    hud.segs = [...segs.children];
  }

  function cacheHud() {
    Object.assign(hud, {
      posN: $("hud-pos-n"), pos: document.querySelector(".pos"), lap: $("hud-lap"), prog: $("hud-prog"), time: $("hud-time"),
      speed: $("hud-speed"), fill: $("gauge-fill"), nitroWrap: $("hud-nitro-wrap"), gap: $("hud-gap"), msg: $("hud-msg"), cd: $("countdown"),
      nbtn: $("btn-nitro"), nring: $("nitro-ring"), pause: $("pause"), finish: $("finish"), last: {},
    });
  }

  function onHud(s) {
    if (!racing) return;
    const L = hud.last;
    const sp = Math.round(s.speed);
    if (L.speed !== sp) { L.speed = sp; hud.speed.textContent = sp; const pct = VR.clamp(s.speed / 400, 0, 1) * 100; hud.fill.setAttribute("stroke-dasharray", pct.toFixed(1) + " 100"); }
    const act = !!s.nitroActive;
    if (L.nActive !== act) { L.nActive = act; hud.fill.setAttribute("stroke", act ? "url(#gn)" : "url(#gg)"); hud.nitroWrap.classList.toggle("active", act); }
    const nn = Math.round(s.nitro * 24);
    if (L.nn !== nn) { L.nn = nn; hud.segs.forEach((el, i) => el.classList.toggle("on", i < nn)); hud.nitroWrap.classList.toggle("low", s.nitro < 0.25); }
    const nr = Math.round(s.nitro * 100);
    if (L.nr !== nr) { L.nr = nr; hud.nring.setAttribute("stroke-dasharray", nr + " 100"); hud.nbtn.classList.toggle("low", s.nitro < 0.25); hud.nbtn.classList.toggle("empty", s.nitro <= 0.001); }
    if (L.position !== s.position) { L.position = s.position; hud.posN.textContent = s.position; hud.pos.classList.toggle("first", s.position === 1); }
    const lapTxt = `LAP ${s.lap}/${gameStore.laps}`;
    if (L.lap !== lapTxt) { L.lap = lapTxt; hud.lap.textContent = lapTxt; }
    const pg = Math.round(s.progress * 1000);
    if (L.pg !== pg) { L.pg = pg; hud.prog.style.width = (s.progress * 100).toFixed(1) + "%"; }
    const cs = Math.floor(s.lapTimeMs / 10);
    if (L.cs !== cs) {
      L.cs = cs; const sec = Math.floor(cs / 100);
      hud.time.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
    }
    if (s.gap !== undefined) {
      const g = Math.round(s.gap), key = g > 3 ? "a" + g : g < -3 ? "b" + g : "e";
      if (L.gap !== key) {
        L.gap = key;
        hud.gap.className = "gap glass " + (g > 3 ? "ahead" : g < -3 ? "behind" : "");
        hud.gap.lastChild.textContent = g > 3 ? `+${g} m` : g < -3 ? `−${Math.abs(g)} m` : "Even";
      }
    }
    // toast
    if (s.messageId !== lastMsgId && s.message) {
      lastMsgId = s.messageId;
      hud.msg.className = "toast " + (s.messageKind || "info");
      hud.msg.textContent = s.message;
      void hud.msg.offsetWidth; hud.msg.classList.add("show");
    }
    // countdown
    if (s.countdown !== lastCountdown) {
      lastCountdown = s.countdown;
      if (s.countdown) {
        hud.cd.textContent = s.countdown;
        hud.cd.className = "countdown";
        void hud.cd.offsetWidth;
        hud.cd.classList.add(s.countdown === "GO" ? "go" : "tick");
      }
    }
    hud.pause.classList.toggle("hidden", !(s.paused && !s.finished));
    $("btn-pause").firstElementChild.firstElementChild.setAttribute("href", s.paused ? "#i-play" : "#i-pause");
  }

  /* --------------------------------------------------------------- minimap */
  function initMinimap() { mm.ctx = $("minimap").getContext("2d"); }
  function drawMinimap(g) {
    const ctx = mm.ctx; if (!ctx || !g || !g.track) return;
    const cv = ctx.canvas, W = cv.width, H = cv.height, half = W / 2;
    const S = g.track.samples, N = S.length, range = 340, scale = half / range;
    const p = g.player, h = p.heading, sh = Math.sin(h), ch = Math.cos(h);
    ctx.clearRect(0, 0, W, H);
    // heading-up transform: screen x → driver's right, screen y → forward
    const sx = (x, z) => half + ((x - p.pos.x) * -ch + (z - p.pos.z) * sh) * scale;
    const sy = (x, z) => half - ((x - p.pos.x) * sh + (z - p.pos.z) * ch) * scale;
    // range rings
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
    for (const f of [0.33, 0.66]) { ctx.beginPath(); ctx.arc(half, half, half * f, 0, 7); ctx.stroke(); }
    // track
    const path = () => {
      ctx.beginPath(); let started = false;
      for (let k = 0; k <= N; k += 2) {
        const q = S[k % N].pos, x = sx(q.x, q.z), y = sy(q.x, q.z);
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) { started = false; continue; }
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
    };
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.lineWidth = 11; path(); ctx.stroke();
    ctx.strokeStyle = "rgba(235,240,250,0.78)"; ctx.lineWidth = 5.5; path(); ctx.stroke();
    // start / finish
    { const q = S[0].pos, x = sx(q.x, q.z), y = sy(q.x, q.z); ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 2, 12, 4); ctx.fillStyle = "#111"; ctx.fillRect(x - 6, y - 2, 4, 2); ctx.fillRect(x + 2, y - 2, 4, 2); ctx.fillRect(x - 2, y, 4, 2); }
    // bottles
    ctx.fillStyle = "#ffc247";
    for (const b of g.nitroBottles) { if (b.taken) continue; const x = sx(b.pos.x, b.pos.z), y = sy(b.pos.x, b.pos.z); if (Math.hypot(x - half, y - half) > half - 6) continue; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill(); }
    // opponent
    const o = g.opponent, ox = sx(o.pos.x, o.pos.z), oy = sy(o.pos.x, o.pos.z), od = Math.hypot(ox - half, oy - half);
    ctx.fillStyle = "#ff4a4a"; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3;
    if (od < half - 10) { ctx.beginPath(); ctx.arc(ox, oy, 7.5, 0, 7); ctx.stroke(); ctx.fill(); }
    else { const a = Math.atan2(oy - half, ox - half), px = half + Math.cos(a) * (half - 14), py = half + Math.sin(a) * (half - 14); ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, 8); ctx.lineTo(-7, -8); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore(); }
    // player arrow
    ctx.save(); ctx.translate(half, half);
    ctx.shadowColor = "rgba(255,255,255,0.8)"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill();
    ctx.restore();
    // vignette to fade the edge
    const gr = ctx.createRadialGradient(half, half, half * 0.6, half, half, half);
    gr.addColorStop(0, "rgba(8,10,14,0)"); gr.addColorStop(1, "rgba(8,10,14,0.75)");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  }

  /** Called by the app once per frame while racing. */
  U.frame = function frame(g, dt) {
    if (!racing || !g) return;
    if ((mm.frame = (mm.frame + 1) % 2) === 0) drawMinimap(g);
    keyHintTimer += dt;
    if (keyHintTimer > 9) document.body.classList.add("keys-fade");
  };

  /* ------------------------------------------------------------ race flow */
  async function bootRace() {
    const token = ++bootToken;
    if (game) { app.stopRace(); game = null; }
    VR.Input.reset();
    gameStore.reset();
    lastMsgId = 0; lastCountdown = null; hud.last = {};
    $("finish").classList.add("hidden"); $("pause").classList.add("hidden");
    const boot = $("boot");
    boot.classList.remove("hidden-boot");
    const setProg = (f, label) => { $("boot-fill").style.width = Math.round(VR.clamp(f, 0.03, 1) * 100) + "%"; if (label) $("boot-sub").textContent = label; };
    const level = gameStore.difficulty;
    const learning = gameStore.learning && level !== "low";
    setProg(0.03, learning ? "Waking Felix…" : "Seeding rival…");

    let theta = null, root = null;
    if (learning) {
      root = await loadBrain();
      if (!root || root.v !== 2 || !root.levels) root = { v: 2, levels: {} };   // old neural brain is discarded
      const lb = root.levels[level] || (root.levels[level] = Learner.fresh());
      theta = Learner.propose(lb);
      await saveBrain(root);
      gameStore.setBrainStats(lb.stats);
    }
    if (token !== bootToken) return;
    try {
      U.show("race");
      racing = true; keyHintTimer = 0; document.body.classList.remove("keys-fade");
      await new Promise((r) => requestAnimationFrame(r));
      game = await app.startRace({
        trackSeed: gameStore.seed, laps: gameStore.laps, difficulty: level, theta, input: VR.input,
        onFinish: (winner, totalMs, extra) => {
          gameStore.setHud({ finished: { winner, totalMs, extra } }); showFinish();
          if (learning && root) {
            try {
              const lb = root.levels[level];
              Learner.report(lb, winner === "opponent", Math.abs((extra && extra.gap) || 0));
              gameStore.setBrainStats(lb.stats);
              saveBrain(root);
            } catch (e) { console.warn("[learn]", e); }
          }
        },
      }, setProg);
      if (token !== bootToken) return;
      boot.classList.add("hidden-boot");
      VR.Input.enable(true);
    } catch (err) {
      console.error("[bootRace]", err);
      $("boot-sub").textContent = "Failed to start: " + (err && err.message ? err.message : String(err));
    }
  }

  function showFinish() {
    const f = gameStore.finished; if (!f) return;
    const win = f.winner === "player", ex = f.extra || {};
    const el = $("finish");
    el.className = "overlay " + (win ? "win" : "lose");
    $("finish-title").textContent = win ? "Victory" : "Defeated";
    $("fin-time").textContent = (f.totalMs / 1000).toFixed(2) + "s";
    $("fin-top").innerHTML = Math.round(ex.topSpeed || 0) + "<small>km/h</small>";
    $("fin-ko").textContent = ex.knockouts || 0;
    const gm = Math.abs(Math.round(ex.gap || 0));
    $("fin-gap-l").textContent = win ? "Winning margin" : "Behind by";
    $("fin-gap").innerHTML = gm + "<small>m</small>";
    VR.Input.enable(false);
  }

  function toMenu() {
    bootToken++;
    racing = false;
    VR.Input.reset(); VR.Input.enable(false);
    gameStore.reset();
    $("boot").classList.add("hidden-boot");
    app.stopRace(); game = null;
    U.show("menu");
    updateMenuSelection();
  }

  function togglePause() {
    if (!racing || !game || gameStore.finished || game.countdown > 0) return;
    const p = !gameStore.paused;
    gameStore.setHud({ paused: p });
    VR.Input.enable(!p);
    if (p) VR.Input.reset();
  }

  /* ------------------------------------------------------------------ init */
  U.init = function init(appRef) {
    app = appRef;
    cacheHud(); buildGauge(); initMinimap(); buildSwatches(); wireSettings(); syncSettings();
    const touch = new URLSearchParams(location.search).get("touch") === "1" || (window.matchMedia && matchMedia("(pointer: coarse)").matches);
    document.body.classList.toggle("is-touch", !!touch);
    $("fps").classList.toggle("hidden", !VR.settings.showFps);

    gameStore.subscribe((s, kind) => {
      if (kind === "menu") updateMenuSelection();
      else if (kind === "brain") updateBrainUI(s.brainStats);
      else if (kind === "hud") onHud(s);
    });
    updateMenuSelection(); updateBrainUI(gameStore.brainStats);

    document.querySelectorAll("#diff-grid .opp").forEach((b) => b.addEventListener("click", () => { gameStore.setDifficulty(b.dataset.diff); refreshBrain(); }));
    $("btn-learn").addEventListener("click", () => { if (gameStore.difficulty !== "low") gameStore.setLearning(!gameStore.learning); });
    try { const sv = JSON.parse(localStorage.getItem("vr_diff") || "null"); if (sv && DIFFICULTY[sv.d]) { gameStore.difficulty = sv.d; gameStore.learning = !!sv.l; } } catch {}
    updateMenuSelection(); refreshBrain();
    document.querySelectorAll(".lap-btn").forEach((b) => b.addEventListener("click", () => gameStore.setLaps(parseInt(b.dataset.laps))));
    $("nitroMultSlider").addEventListener("input", (e) => gameStore.setOppNitroMult(parseFloat(e.target.value)));
    $("btn-start").addEventListener("click", () => { gameStore.reseed(); bootRace(); });
    $("btn-settings").addEventListener("click", () => { syncSettings(); U.show("settings"); });
    $("btn-back").addEventListener("click", () => U.show("menu"));
    $("btn-pause").addEventListener("click", togglePause);
    $("pause-resume").addEventListener("click", togglePause);
    $("pause-quit").addEventListener("click", toMenu);
    $("finish-menu").addEventListener("click", toMenu);
    $("finish-again").addEventListener("click", () => { gameStore.reseed(); bootRace(); });

    VR.Input.setupKeyboard();
    VR.Input.setPause(() => { if ($("settings").classList.contains("active")) U.show("menu"); else togglePause(); });
    VR.Input.setupJoystick($("joystick-wrap"), $("joystick-base"), $("joystick-stick"));
    VR.Input.setupNitro($("btn-nitro"));
    VR.Input.enable(false);
    // block the context menu / pinch-zoom gestures inside the game
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("gesturestart", (e) => e.preventDefault());

    refreshBrain();
    U.show("menu");
  };

  U.hideBoot = function hideBoot() { $("boot").classList.add("hidden-boot"); document.body.classList.remove("booting"); };
  U.setFps = function setFps(v, pr) { const el = $("fps"); el.textContent = `${Math.round(v)} FPS · ${pr.toFixed(2)}×`; };
  U.fatal = function fatal(e) { const el = $("fatal"); el.classList.remove("hidden"); el.textContent = "Something went wrong:\n" + (e && e.stack ? e.stack : String(e)); };
  U.setBootProgress = (f, label) => { $("boot-fill").style.width = Math.round(f * 100) + "%"; if (label) $("boot-sub").textContent = label; };
  return U;
})();
