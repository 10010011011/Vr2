"use strict";
/* ============================================================================
   Procedural texture library (everything is generated at load — zero image
   assets needed). Textures are cached; call VR.tex.* lazily.
   ========================================================================== */
VR.tex = (() => {
  const cache = {};
  const maxAniso = () => VR.maxAniso || 4;
  const rnd = (seedObj) => () => { // small deterministic PRNG
    seedObj.s = (seedObj.s + 0x6D2B79F5) >>> 0;
    let t = seedObj.s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function canvasTex(canvas, { srgb = true, repeat = true, aniso = true } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = aniso ? maxAniso() : 1;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  /** Build a tangent-space normal map (OpenGL convention) from a height array [row0 = v0]. */
  function normalFromHeight(H, w, h, strength) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const y0 = (y - 1 + h) % h, y1 = (y + 1) % h;
      for (let x = 0; x < w; x++) {
        const x0 = (x - 1 + w) % w, x1 = (x + 1) % w;
        const dx = (H[y * w + x1] - H[y * w + x0]) * strength;
        const dy = (H[y1 * w + x] - H[y0 * w + x]) * strength;
        const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
        const o = (y * w + x) * 4;
        out[o] = (-dx * il * 0.5 + 0.5) * 255;
        out[o + 1] = (-dy * il * 0.5 + 0.5) * 255;
        out[o + 2] = (il * 0.5 + 0.5) * 255;
        out[o + 3] = 255;
      }
    }
    return out;
  }
  function dataTex(data, w, h, { srgb = false, aniso = true } = {}) {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = aniso ? maxAniso() : 1;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    return t;
  }

  /* -------------------------------------------------------------------------
     Asphalt: covers lateral −19 … +19 (road 35 + 1.5 shoulder each side) and
     24 units along the road.
     ---------------------------------------------------------------------- */
  const ROAD_W = 38, HALF_DRIVE = 17.5;
  function asphalt() {
    if (cache.asphalt) return cache.asphalt;
    const W = 512, H = 1024, R = rnd({ s: 777 });
    const c = VR.canvas(W, H), g = c.getContext("2d");
    const X = (lat) => ((lat + ROAD_W / 2) / ROAD_W) * W; // lateral → px
    const PXU = W / ROAD_W;                                 // px per unit

    g.fillStyle = "#2a2b2f"; g.fillRect(0, 0, W, H);

    // soft blotches (tileable in y by drawing wrapped copies)
    for (let i = 0; i < 260; i++) {
      const x = R() * W, y = R() * H, rx = 18 + R() * 90, ry = 18 + R() * 120;
      const light = R() < 0.5;
      for (const oy of [-H, 0, H]) {
        const gr = g.createRadialGradient(x, y + oy, 0, x, y + oy, Math.max(rx, ry));
        const a = 0.035 + R() * 0.05;
        gr.addColorStop(0, light ? `rgba(120,122,128,${a})` : `rgba(8,8,10,${a * 1.4})`);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.save(); g.translate(x, y + oy); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -(y + oy));
        g.fillStyle = gr; g.fillRect(x - rx * 2, y + oy - ry * 2, rx * 4, ry * 4); g.restore();
      }
    }

    // rubbered racing lines (two soft dark bands) + wheel-track striations
    for (const lat of [-4.6, 4.6]) {
      const gr = g.createLinearGradient(X(lat - 3.2), 0, X(lat + 3.2), 0);
      gr.addColorStop(0, "rgba(6,6,8,0)"); gr.addColorStop(0.5, "rgba(6,6,8,0.34)"); gr.addColorStop(1, "rgba(6,6,8,0)");
      g.fillStyle = gr; g.fillRect(X(lat - 3.2), 0, 6.4 * PXU, H);
      for (let i = 0; i < 70; i++) {
        const x = X(lat + (R() - 0.5) * 4.2), y0 = R() * H, len = 120 + R() * 500;
        g.strokeStyle = `rgba(4,4,6,${0.05 + R() * 0.08})`; g.lineWidth = 1 + R() * 2;
        for (const oy of [-H, 0, H]) { g.beginPath(); g.moveTo(x, y0 + oy); g.lineTo(x + (R() - 0.5) * 6, y0 + len + oy); g.stroke(); }
      }
    }
    // tyre marbles / dust drifting to the edges (lighter)
    for (const lat of [-13.5, 13.5]) {
      const gr = g.createLinearGradient(X(lat - 4), 0, X(lat + 4), 0);
      gr.addColorStop(0, "rgba(90,90,96,0)"); gr.addColorStop(0.5, "rgba(90,90,96,0.12)"); gr.addColorStop(1, "rgba(90,90,96,0)");
      g.fillStyle = gr; g.fillRect(X(lat - 4), 0, 8 * PXU, H);
    }

    // repair patches
    for (let i = 0; i < 9; i++) {
      const w = 40 + R() * 150, h = 40 + R() * 150, x = R() * (W - w), y = R() * (H - h);
      g.fillStyle = `rgba(${R() < 0.5 ? "14,14,17" : "52,53,58"},${0.35 + R() * 0.25})`;
      g.fillRect(x, y, w, h);
      g.strokeStyle = "rgba(5,5,6,0.5)"; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    }

    // cracks (random walks)
    g.lineCap = "round";
    for (let i = 0; i < 34; i++) {
      let x = R() * W, y = R() * H; const dir = R() * Math.PI * 2;
      g.strokeStyle = `rgba(8,8,10,${0.5 + R() * 0.35})`; g.lineWidth = 0.8 + R() * 1.2;
      g.beginPath(); g.moveTo(x, y);
      let a = dir;
      for (let k = 0; k < 18; k++) { a += (R() - 0.5) * 1.1; x += Math.cos(a) * (6 + R() * 12); y += Math.sin(a) * (6 + R() * 12); g.lineTo(x, y); }
      g.stroke();
    }

    // expansion joints across the road
    for (const y of [0, H / 2]) { g.fillStyle = "rgba(6,6,8,0.55)"; g.fillRect(X(-HALF_DRIVE), y - 1, HALF_DRIVE * 2 * PXU, 2.2); }

    // markings: continuous edge lines + dashed centre line (worn white paint)
    const paint = (x, w, y0, y1, a) => { g.fillStyle = `rgba(236,236,230,${a})`; g.fillRect(x - w / 2, y0, w, y1 - y0); };
    paint(X(-15.1), 0.34 * PXU, 0, H, 0.92); paint(X(15.1), 0.34 * PXU, 0, H, 0.92);
    for (let i = 0; i < 2; i++) paint(X(0), 0.3 * PXU, i * (H / 2) + 40, i * (H / 2) + 40 + 4 * (H / 24), 0.9);
    // quarter-lane dots
    for (const lat of [-7.5, 7.5]) for (let i = 0; i < 2; i++) paint(X(lat), 0.16 * PXU, i * (H / 2) + 120, i * (H / 2) + 126, 0.6);

    // shoulder strip (outside the driving lane): lighter concrete-grey
    for (const sgn of [-1, 1]) {
      const x0 = sgn < 0 ? 0 : X(HALF_DRIVE), x1 = sgn < 0 ? X(-HALF_DRIVE) : W;
      g.fillStyle = "rgba(108,106,100,0.55)"; g.fillRect(x0, 0, x1 - x0, H);
    }

    // per-pixel grain + wear on paint
    const img = g.getImageData(0, 0, W, H), d = img.data;
    const Hh = new Float32Array(W * H); // height for normal map (row0 = canvas top)
    let s = 12345;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      const n = ((s >>> 8) & 255) / 255;
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      const n2 = ((s >>> 8) & 255) / 255;
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 765;
      let f = (n - 0.5) * 34 + (n2 > 0.97 ? 38 : 0) + (n2 < 0.03 ? -22 : 0);
      if (lum > 0.6) f -= n2 > 0.82 ? 70 : 0; // paint chips
      d[i] += f; d[i + 1] += f; d[i + 2] += f * 1.02;
      Hh[p] = n * 0.7 + (n2 > 0.97 ? 0.6 : 0) + lum * 0.5;
    }
    g.putImageData(img, 0, 0);

    // normal + roughness maps from the finished albedo (flip rows so row0 = v0)
    const flipped = new Float32Array(W * H), rough = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const sy = H - 1 - y;
      for (let x = 0; x < W; x++) {
        flipped[y * W + x] = Hh[sy * W + x];
        const o = (sy * W + x) * 4;
        const lum = (d[o] + d[o + 1] + d[o + 2]) / 765;
        const rr = lum > 0.5 ? 0.7 : 0.6 + 0.3 * VR.smoothstep(0.07, 0.2, lum);
        const ro = (y * W + x) * 4;
        rough[ro] = 255; rough[ro + 1] = Math.round(rr * 255); rough[ro + 2] = 0; rough[ro + 3] = 255;
      }
    }
    cache.asphalt = {
      map: canvasTex(c),
      normalMap: dataTex(normalFromHeight(flipped, W, H, 2.4), W, H),
      roughnessMap: dataTex(rough, W, H),
      width: ROAD_W, tile: 24,
    };
    return cache.asphalt;
  }

  /* ----------------------------- kerb stripes ---------------------------- */
  function kerb() {
    if (cache.kerb) return cache.kerb;
    const R = rnd({ s: 4242 }), W = 128, H = 256;
    const c = VR.canvas(W, H), g = c.getContext("2d");
    g.fillStyle = "#c8141e"; g.fillRect(0, 0, W, H / 2);
    g.fillStyle = "#ecece8"; g.fillRect(0, H / 2, W, H / 2);
    // dirt gradient toward the outside + grain
    const gr = g.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(30,24,10,0.28)");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, 0, W, 3); g.fillRect(0, H / 2, W, 3);
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 36; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    cache.kerb = canvasTex(c);
    return cache.kerb;
  }

  /* -------- packed terrain detail (R grass, G soil, B rock, A sand) ------- */
  function terrainDetail() {
    if (cache.terrain) return cache.terrain;
    const N = 256, data = new Uint8Array(N * N * 4);
    const P = (x, y, f, s) => VR.pnoise(x * f / N * 8, y * f / N * 8, 8 * f, 8 * f, s);
    const vor = (x, y, cells, seed) => { // periodic voronoi (F2-F1 style crack lines)
      const u = (x / N) * cells, v = (y / N) * cells; const ix = Math.floor(u), iy = Math.floor(v);
      let d1 = 9, d2 = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const cx = ((ix + i) % cells + cells) % cells, cy = ((iy + j) % cells + cells) % cells;
        const px = ix + i + VR.hash2(cx, cy, seed), py = iy + j + VR.hash2(cx, cy, seed + 9);
        const dd = Math.hypot(u - px, v - py);
        if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
      }
      return d2 - d1;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      // grass: stretched streaks + clumps
      const gr = 0.5 * P(x, y * 0.25, 4, 1) + 0.3 * P(x, y * 0.4, 12, 2) + 0.2 * P(x, y, 32, 3);
      // soil: pebbly
      const so = 0.55 * P(x, y, 6, 4) + 0.3 * P(x, y, 18, 5) + 0.15 * P(x, y, 48, 6);
      // rock: cracked plates
      const v = vor(x, y, 7, 11);
      const ro = 0.35 + 0.45 * VR.smoothstep(0.0, 0.35, v) + 0.2 * P(x, y, 20, 7) - 0.15 * (1 - VR.smoothstep(0.0, 0.06, v));
      // sand: ripples
      const sa = 0.55 + 0.25 * Math.sin((x / N) * Math.PI * 2 * 9 + P(x, y, 5, 8) * 6) * 0.5 + 0.2 * P(x, y, 40, 9);
      data[o] = VR.clamp(gr, 0, 1) * 255; data[o + 1] = VR.clamp(so, 0, 1) * 255;
      data[o + 2] = VR.clamp(ro, 0, 1) * 255; data[o + 3] = VR.clamp(sa, 0, 1) * 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = maxAniso(); t.needsUpdate = true;
    cache.terrain = t;
    return t;
  }

  /* ------------------------------ signage -------------------------------- */
  function chevron() {
    if (cache.chevron) return cache.chevron;
    const c = VR.canvas(256, 128), g = c.getContext("2d");
    g.fillStyle = "#f2c500"; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = "#111"; g.lineWidth = 22; g.lineJoin = "miter";
    for (let i = 0; i < 3; i++) { const x = 40 + i * 70; g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 38, 64); g.lineTo(x, 114); g.stroke(); }
    g.strokeStyle = "#111"; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
    cache.chevron = canvasTex(c, { repeat: false });
    return cache.chevron;
  }

  function banner(text, sub, colors) {
    const key = "banner:" + text;
    if (cache[key]) return cache[key];
    const c = VR.canvas(1024, 256), g = c.getContext("2d");
    const [bg, fg, acc] = colors;
    const gr = g.createLinearGradient(0, 0, 1024, 0);
    gr.addColorStop(0, bg); gr.addColorStop(1, "#0b0b0e");
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = acc; g.fillRect(0, 0, 1024, 14); g.fillRect(0, 242, 1024, 14);
    // slanted accent bars
    g.save(); g.globalAlpha = 0.9; g.fillStyle = acc;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(40 + i * 26, 256); g.lineTo(80 + i * 26, 0); g.lineTo(92 + i * 26, 0); g.lineTo(52 + i * 26, 256); g.fill(); }
    g.restore();
    g.fillStyle = fg; g.font = "italic 900 118px 'Saira Condensed', Impact, sans-serif"; g.textBaseline = "middle";
    g.fillText(text, 190, sub ? 108 : 132);
    if (sub) { g.font = "700 40px 'Saira', sans-serif"; g.fillStyle = acc; g.fillText(sub, 194, 196); }
    cache[key] = canvasTex(c, { repeat: false });
    return cache[key];
  }

  function checker() {
    if (cache.checker) return cache.checker;
    const c = VR.canvas(512, 128), g = c.getContext("2d");
    const n = 32, s = 16;
    for (let y = 0; y < 8; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? "#f4f4f0" : "#17171a"; g.fillRect(x * s, y * s, s, s); }
    cache.checker = canvasTex(c, { repeat: false });
    return cache.checker;
  }

  /** Generic radial soft-glow sprite texture (for lamps, halos). */
  function glow() {
    if (cache.glow) return cache.glow;
    const c = VR.canvas(128, 128), g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    cache.glow = canvasTex(c, { repeat: false, aniso: false });
    return cache.glow;
  }

  /** Soft radial blob for contact shadows. */
  function blob() {
    if (cache.blob) return cache.blob;
    const c = VR.canvas(128, 128), g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, "rgba(0,0,0,0.85)"); gr.addColorStop(0.5, "rgba(0,0,0,0.45)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    cache.blob = canvasTex(c, { srgb: false, repeat: false, aniso: false });
    return cache.blob;
  }

  return { asphalt, kerb, terrainDetail, chevron, banner, checker, glow, blob, canvasTex, dataTex, normalFromHeight, ROAD_W, HALF_DRIVE };
})();
