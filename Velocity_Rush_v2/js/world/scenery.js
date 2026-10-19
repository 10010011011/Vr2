"use strict";
/* ============================================================================
   Scenery — instanced, chunked vegetation / rocks / grass / roadside signs.
   • trees (pine, oak, birch), bushes, boulders: 160 m chunks, 2 LODs, distance culled
   • grass tufts + wild flowers: 64 m chunks, shrink-fade with distance, wind sway
   • corner chevron signs on tight bends
   Placement is deterministic from the track seed.
   ========================================================================== */
VR.buildScenery = function buildScenery(info, terrain, seed, q, atm, road) {
  const group = new THREE.Group();
  group.name = "scenery";
  const S0 = seed & 0xffff;
  const WATER = VR.WATER_Y;
  const hAt = terrain.heightAt;
  const half = info.half;
  const band = q.terrainBand * 0.95;
  const sm = VR.smoothstep, lerp = VR.lerp;

  // ---------------------------------------------------------------- utilities
  const mulberry = (a) => () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rng = mulberry((seed * 2654435761) ^ 0x9e3779b9);
  const h3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
  const noise3 = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
    const a = lerp(lerp(h3(xi, yi, zi), h3(xi + 1, yi, zi), xf), lerp(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), xf), yf);
    const b = lerp(lerp(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), xf), lerp(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), xf), yf);
    return lerp(a, b, zf);
  };
  const L = VR.linRGB;
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /** Paint a (non-)indexed geometry with a per-vertex colour function. */
  function paint(geo, fn) {
    const P = geo.attributes.position, N = geo.attributes.normal;
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const c = fn(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), i);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return geo;
  }
  const part = (geometry, matrix) => ({ geometry, matrix });
  const T = (x, y, z, ry) => { const m = new THREE.Matrix4().makeTranslation(x, y, z); if (ry) m.multiply(new THREE.Matrix4().makeRotationY(ry)); return m; };

  /** Displaced icosphere (smooth radial normals), used for crowns / bushes. */
  function blob(r, detail, sd, amp, sy) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + amp * (noise3(x * 1.6 + sd, y * 1.6 + sd * 0.7, z * 1.6) - 0.5) * 2 + amp * 0.5 * (noise3(x * 3.4 + sd, y * 3.4, z * 3.4 + sd) - 0.5) * 2;
      p.setXYZ(i, x * k * r, y * k * r * (sy || 1), z * k * r);
    }
    return g;
  }

  // ---------------------------------------------------------------- palette
  const C = {
    bark: L(0x4a3b2d), barkLight: L(0x6a5a47), birchBark: L(0xcfc9bb),
    pineDark: L(0x0e1f17), pineMid: L(0x1a3b27), pineTip: L(0x2f5b3a),
    oakDark: L(0x14271a), oakMid: L(0x2f4f26), oakTop: L(0x5f8639),
    birchMid: L(0x628c38), birchTop: L(0x86ac4a),
    rockLow: L(0x4a463f), rockMid: L(0x7b756b), rockTop: L(0x938c80), moss: L(0x59703c),
  };

  // ---------------------------------------------------------------- geometries
  function makePine(sd, near) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.2, 0.42, 3.6, 6, 1, true); trunk.translate(0, 1.8, 0);
    paint(trunk, (x, y) => mix3(C.bark, C.barkLight, y / 3.6 * 0.5));
    parts.push(part(trunk));
    const tiers = near ? 5 : 3;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const r = lerp(3.5, 0.85, Math.pow(t, 0.9)) * (0.94 + h3(sd, i, 1) * 0.14);
      const h = lerp(5.4, 3.2, t), y0 = (near ? 1.9 : 2.2) + i * (near ? 2.15 : 3.2);
      const cone = new THREE.ConeGeometry(r, h, near ? 9 : 6, 1, false);
      const p = cone.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        if (y < 0) {   // skirt: irregular radius + droop
          const a = Math.atan2(z, x), j = 0.86 + 0.28 * h3(sd + i, Math.round(a * 9) , i);
          p.setXYZ(k, x * j, y - 0.35 * (1 - j), z * j);
        }
      }
      cone.translate(0, y0 + h / 2, 0);
      cone.rotateY(h3(sd, i, 7) * 6.28);
      paint(cone, (x, y, z, nx, ny) => {
        const hy = (y - y0) / h;                          // 0 skirt → 1 tip of this tier
        const k = Math.min(1, t * 0.55 + hy * 0.55);
        const c = mix3(C.pineDark, C.pineMid, Math.min(1, hy * 1.5 + t * 0.2));
        const lit = mix3(c, C.pineTip, Math.max(0, k - 0.45) * 1.2);
        const under = ny < -0.5 ? 0.45 : 1;
        return [lit[0] * under, lit[1] * under, lit[2] * under];
      });
      parts.push(part(cone));
    }
    return VR.mergeGeometries(parts);
  }

  function makeBroad(sd, near, kind) {
    const parts = [];
    const birch = kind === "birch";
    const th = birch ? 5.2 : 2.9;
    const trunk = new THREE.CylinderGeometry(birch ? 0.14 : 0.28, birch ? 0.26 : 0.55, th + 1.2, 6, 1, true); trunk.translate(0, (th + 1.2) / 2, 0);
    paint(trunk, (x, y, z) => {
      if (birch) { const m = 0.75 + 0.25 * noise3(y * 6, x * 9, z * 9); const b = (noise3(y * 11, x * 20, z * 20) > 0.74) ? 0.2 : 1; return [C.birchBark[0] * m * b, C.birchBark[1] * m * b, C.birchBark[2] * m * b]; }
      return mix3(C.bark, C.barkLight, 0.4 * noise3(x * 5, y * 3, z * 5));
    });
    parts.push(part(trunk));
    const nb = near ? (birch ? 4 : 7) : 3;
    const col = birch ? [C.birchMid, C.birchTop] : [C.oakMid, C.oakTop];
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * 6.283 + h3(sd, i, 3) * 1.2;
      const top = i === 0;
      const rr = top ? 0 : (birch ? 0.85 : 1.9) * (0.75 + 0.5 * h3(sd, i, 5)) * (near ? 1 : 1.1);
      const rad = (birch ? 1.55 : 2.35) * (0.8 + 0.4 * h3(sd, i, 9)) * (top ? 1.2 : 1) * (near ? 1 : 1.2);
      const by = th + (birch ? 1.2 : 1.35) + (top ? (birch ? 1.0 : 1.1) : (h3(sd, i, 11) - 0.35) * 1.6);
      const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr;
      const g = blob(rad, 1, sd * 3 + i * 7, 0.2, birch ? 1.3 : 0.82);
      g.translate(bx, by, bz);
      paint(g, (x, y, z, nx, ny, nz) => {
        const k = VR.saturate((y - (by - rad)) / (rad * 2));          // 0 underside → 1 top of this blob
        const sunSide = VR.saturate(ny * 0.7 + 0.3);
        const ao = 0.3 + 0.7 * VR.saturate((y - th - 0.1) / 4.2);      // lower crown darker (inside of canopy)
        const c = mix3(C.oakDark, col[0], VR.saturate(k * 1.5));
        const t = mix3(c, col[1], Math.pow(k, 2) * sunSide);
        const v = 0.85 + 0.3 * noise3(x * 2.2, y * 2.2, z * 2.2);
        return [t[0] * ao * v, t[1] * ao * v, t[2] * ao * v];
      });
      parts.push(part(g));
    }
    return VR.mergeGeometries(parts);
  }

  function makeBush(sd) {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const g = blob(0.85 + 0.35 * h3(sd, i, 1), 1, sd + i * 5, 0.22, 0.75);
      g.translate((h3(sd, i, 2) - 0.5) * 1.5, 0.55 + 0.2 * h3(sd, i, 3), (h3(sd, i, 4) - 0.5) * 1.5);
      paint(g, (x, y, z, nx, ny) => { const k = VR.saturate(y / 1.4); const c = mix3(C.oakDark, C.oakTop, k * 0.8 + 0.1); const v = 0.8 + 0.4 * noise3(x * 3, y * 3, z * 3); return [c[0] * v, c[1] * v, c[2] * v]; });
      parts.push(part(g));
    }
    return VR.mergeGeometries(parts);
  }

  function makeRock(sd, sx, sy, sz) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.78 + 0.5 * noise3(x * 1.3 + sd, y * 1.3, z * 1.3 + sd) + 0.14 * noise3(x * 4 + sd, y * 4, z * 4);
      x *= k * sx; y *= k * sy; z *= k * sz;
      if (y < -0.35 * sy) y = -0.35 * sy + (y + 0.35 * sy) * 0.3;     // flat-ish bed
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();                                          // non-indexed → crisp facets
    paint(g, (x, y, z, nx, ny, nz) => {
      const v = 0.78 + 0.45 * noise3(x * 2.6 + sd, y * 2.6, z * 2.6);
      let c = mix3(C.rockLow, C.rockMid, VR.saturate((y / sy + 0.5) * 0.9));
      c = mix3(c, C.rockTop, VR.saturate(ny) * 0.6);
      c = mix3(c, C.moss, VR.smoothstep(0.62, 0.88, ny) * 0.5);
      return [c[0] * v, c[1] * v, c[2] * v];
    });
    return g;
  }

  // ---------------------------------------------------------------- materials
  const windU = { uTime: VR.uniforms.uTime, uWind: VR.uniforms.uWind };
  const swayGLSL = (amp) => `
    #ifdef USE_INSTANCING
      vec3 ip = instanceMatrix[3].xyz;
    #else
      vec3 ip = vec3(0.0);
    #endif
    float swH = max(transformed.y, 0.0);
    float swP = ip.x * 0.043 + ip.z * 0.057;
    float swS = sin(uTime * 1.25 + swP) * 0.6 + sin(uTime * 2.6 + swP * 1.9) * 0.4;
    float swA = ${amp} * swH * swH * uWind;
    transformed.x += swS * swA;
    transformed.z += cos(uTime * 1.1 + swP * 1.3) * swA * 0.55;
  `;
  const foliageMat = VR.reg(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0, envMapIntensity: 0.95 }), 0.95);
  VR.patch(foliageMat, {
    key: "foliage", worldPos: true, uniforms: windU,
    vertexDecl: "uniform float uTime; uniform float uWind;",
    vertexMain: swayGLSL("0.0016"),
    fragDecl: VR.glsl.noise,
    fragAfterColor: `
      float lf = vrNoise(vWorldPos.xz * 1.9 + vWorldPos.y * 0.8) * 0.6 + vrNoise(vWorldPos.xz * 6.5 - vWorldPos.y * 2.0) * 0.4;
      diffuseColor.rgb *= 0.78 + 0.46 * lf;
    `,
  });
  const rockMat = VR.reg(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.8 }), 0.8);
  VR.patch(rockMat, {
    key: "rockprop", worldPos: true, fragDecl: VR.glsl.noise,
    fragAfterColor: `
      float rn = vrNoise(vWorldPos.xy * 1.7 + vWorldPos.zz * 0.4) * 0.5 + vrNoise(vWorldPos.zy * 3.1) * 0.3 + vrNoise(vWorldPos.xz * 9.0) * 0.2;
      diffuseColor.rgb *= 0.72 + 0.5 * rn;
    `,
  });

  // grass / flower textures (procedural blades)
  function bladeTexture(flowers) {
    const W = 128, H = 128, cv = VR.canvas(W, H), g = cv.getContext("2d");
    g.clearRect(0, 0, W, H);
    const r = mulberry(flowers ? 77 : 31);
    const n = flowers ? 9 : 17;
    // grass blades are near-neutral (tinted per instance to match the terrain); flower tufts carry their own greens
    const cols = flowers ? [[0x1e3d12, 0x5f8a2c], [0x2a4d16, 0x7aa334], [0x3a5a1c, 0x98b840]] : [[0x5d6652, 0xdfe6cf], [0x6f7a60, 0xf4f8e6], [0x4c5545, 0xc9d3b4]];
    for (let i = 0; i < n; i++) {
      const bx = 10 + r() * (W - 20), hgt = H * (0.42 + r() * 0.5) * (flowers ? 0.8 : 1), lean = (r() - 0.5) * 36, w = 3.5 + r() * 3.5;
      const c = cols[Math.floor(r() * cols.length)];
      const grd = g.createLinearGradient(0, H, 0, H - hgt);
      grd.addColorStop(0, "#" + c[0].toString(16).padStart(6, "0")); grd.addColorStop(1, "#" + c[1].toString(16).padStart(6, "0"));
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(bx - w, H);
      g.quadraticCurveTo(bx - w * 0.5 + lean * 0.3, H - hgt * 0.55, bx + lean, H - hgt);
      g.quadraticCurveTo(bx + w * 0.5 + lean * 0.3, H - hgt * 0.55, bx + w, H);
      g.closePath(); g.fill();
      if (flowers && i < 4) {
        const fc = ["#fff6e8", "#ffd84a", "#c58bff", "#ff9bb8"][i % 4];
        const fx = bx + lean, fy = H - hgt;
        g.fillStyle = fc; g.beginPath(); g.arc(fx, fy, 6 + r() * 3, 0, 6.283); g.fill();
        g.fillStyle = "#e9a21c"; g.beginPath(); g.arc(fx, fy, 2.2, 0, 6.283); g.fill();
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 2;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  function grassMaterial(flowers) {
    const m = VR.reg(new THREE.MeshStandardMaterial({ map: bladeTexture(flowers), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 0.9 }), 0.9);
    VR.patch(m, {
      key: flowers ? "flowers" : "grass", worldPos: true, uniforms: windU,
      vertexDecl: "uniform float uTime; uniform float uWind;",
      vertexMain: swayGLSL("0.16") + `
        float gd = distance(cameraPosition.xz, ip.xz);
        transformed *= 1.0 - smoothstep(64.0, 108.0, gd);
      `,
      fragAfterNormal: `normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz * 0.88 + normal * 0.12);`,
    });
    return m;
  }
  const grassMat = grassMaterial(false), flowerMat = grassMaterial(true);

  function makeTuft(w, h) {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(w, h, 1, 2);
      g.translate(0, h / 2, 0);
      g.rotateY(i * Math.PI / 3);
      parts.push(part(g));
    }
    const geo = VR.mergeGeometries(parts);
    const col = geo.attributes.color.array; col.fill(1);
    return geo;
  }

  // ---------------------------------------------------------------- species table
  const lodNear = 250;
  const treeCull = 520 + 560 * q.trees;
  const SP = {
    pine0:  { near: makePine(3, true),  far: makePine(3, false), mat: foliageMat, cast: true, recv: true, cull: treeCull },
    pine1:  { near: makePine(8, true),  far: makePine(8, false), mat: foliageMat, cast: true, recv: true, cull: treeCull },
    oak0:   { near: makeBroad(2, true, "oak"), far: makeBroad(2, false, "oak"), mat: foliageMat, cast: true, recv: true, cull: treeCull },
    oak1:   { near: makeBroad(6, true, "oak"), far: makeBroad(6, false, "oak"), mat: foliageMat, cast: true, recv: true, cull: treeCull },
    birch:  { near: makeBroad(4, true, "birch"), far: makeBroad(4, false, "birch"), mat: foliageMat, cast: true, recv: true, cull: treeCull * 0.85 },
    bush:   { near: makeBush(5), far: null, mat: foliageMat, cast: false, recv: true, cull: 330 },
    rock0:  { near: makeRock(1, 1.15, 0.85, 1.0), far: null, mat: rockMat, cast: true, recv: true, cull: 520 },
    rock1:  { near: makeRock(7, 1.4, 0.6, 0.95), far: null, mat: rockMat, cast: true, recv: true, cull: 520 },
    rock2:  { near: makeRock(13, 0.8, 1.35, 0.85), far: null, mat: rockMat, cast: true, recv: true, cull: 600 },
  };
  const GRASS = {
    grass: { near: makeTuft(1.05, 0.62), far: null, mat: grassMat, cast: false, recv: false, cull: 120 },
    flower: { near: makeTuft(0.85, 0.55), far: null, mat: flowerMat, cast: false, recv: false, cull: 120 },
  };
  if (!q.shadows) for (const k in SP) { SP[k].cast = false; SP[k].recv = false; }

  // ---------------------------------------------------------------- binning
  const BIG = 160, SMALL = 64;
  const bigBins = new Map(), smallBins = new Map();
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
  function put(bins, size, sp, x, y, z, yaw, sx, sy, sz, tx, tz, c) {
    const k = Math.floor(x / size) + "," + Math.floor(z / size);
    let b = bins.get(k); if (!b) { b = { cx: Math.floor(x / size), cz: Math.floor(z / size), sp: {}, minY: 1e9, maxY: -1e9 }; bins.set(k, b); }
    let s = b.sp[sp]; if (!s) s = b.sp[sp] = { m: [], c: [] };
    _e.set(tx, yaw, tz, "YXZ"); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_p, _q, _s);
    const e = _m.elements; for (let i = 0; i < 16; i++) s.m.push(e[i]);
    s.c.push(c[0], c[1], c[2]);
    if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
  }

  // ---------------------------------------------------------------- placement
  const t = {}, wv = new Float32Array(VR.BIOMES.length);
  const nearSet = new Set();
  {
    const R = Math.ceil((band + 10) / info.cell);
    for (const key of info.grid.keys()) {
      const [cx, cz] = key.split(",").map(Number);
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) nearSet.add((cx + dx) + "," + (cz + dz));
    }
  }
  const slopeAt = (x, z, h) => Math.hypot(hAt(x + 2.5, z) - h, hAt(x, z + 2.5) - h) / 2.5;
  const tint = (b, v, hue) => [b * (1 + hue * 0.35) * v, b * v, b * (1 - hue * 0.45) * v];

  const treeStep = 8, cs = info.cell;
  let nTrees = 0, nRocks = 0, nBush = 0;
  for (const key of nearSet) {
    const [cx, cz] = key.split(",").map(Number);
    for (let j = 0; j < cs / treeStep; j++) for (let i = 0; i < cs / treeStep; i++) {
      const x = cx * cs + (i + rng()) * treeStep, z = cz * cs + (j + rng()) * treeStep;
      const tt = info.nearest(x, z, t);
      const d = tt.d;
      if (d < 21.5 || d > band) continue;
      const w = info.weights(tt, wv);
      const fade = sm(21.5, 31, d) * (1 - sm(band * 0.72, band, d));
      if (fade <= 0) continue;
      const clump = VR.fbm(x * 0.006 + 3.1, z * 0.006, 3, S0 + 31);
      const clearing = sm(0.34, 0.6, clump);
      const grove = sm(0.52, 0.74, VR.fbm(x * 0.011 + 9, z * 0.011 - 4, 3, S0 + 17));
      const wetEdge = w[5];
      // per-species densities (probability of a plant per 8 m cell)
      let pForest = w[1] * (0.2 + 0.62 * clearing);
      let pPlain = (w[0] + w[6]) * (0.012 + 0.45 * grove);
      let pMount = w[2] * (0.05 + 0.2 * sm(0.3, 0.6, clump));
      let pCliff = w[3] * 0.015 + w[4] * 0.05;
      let pShore = wetEdge * 0.08;
      let pTrees = (pForest + pPlain + pMount + pCliff + pShore) * fade * q.trees;
      const r1 = rng();
      let planted = false;
      if (r1 < pTrees) {
        const h = hAt(x, z);
        if (h > WATER + 0.7) {
          const sl = slopeAt(x, z, h);
          const maxSl = 0.5 + 0.4 * w[2] + 0.2 * w[3];
          if (sl < maxSl) {
            const alt = sm(34, 84, h);                     // high ground → more conifer
            const pineP = Math.min(0.97, w[1] * 0.35 + w[2] * 0.85 + w[4] * 0.8 + w[3] * 0.9 + alt * 0.6 + w[0] * 0.12);
            const rr = rng();
            let sp, sc;
            if (rr < pineP) { sp = rng() < 0.5 ? "pine0" : "pine1"; sc = 0.72 + rng() * 0.7 - alt * 0.2; }
            else if (rng() < 0.22 + w[0] * 0.2) { sp = "birch"; sc = 0.8 + rng() * 0.45; }
            else { sp = rng() < 0.5 ? "oak0" : "oak1"; sc = 0.75 + rng() * 0.65; }
            const bv = 0.8 + rng() * 0.4;
            let hue = (rng() - 0.5) * 0.3;
            if (sp !== "pine0" && sp !== "pine1" && rng() < 0.035) hue = 0.55 + rng() * 0.3;    // rare golden tree
            const col = tint(1, bv, hue);
            put(bigBins, BIG, sp, x, h - 0.2, z, rng() * 6.283, sc * (0.88 + rng() * 0.24), sc * (0.88 + rng() * 0.4), sc * (0.88 + rng() * 0.24), (rng() - 0.5) * 0.07, (rng() - 0.5) * 0.07, col);
            nTrees++; planted = true;
          }
        }
      }
      // understorey bushes
      const pBush = (w[1] * 0.14 + (w[0] + w[6]) * 0.025 + w[4] * 0.02 + wetEdge * 0.05) * fade * q.props * (planted ? 0.2 : 1);
      if (rng() < pBush) {
        const bx = x + (rng() - 0.5) * 6, bz = z + (rng() - 0.5) * 6, h = hAt(bx, bz);
        if (h > WATER + 0.6 && slopeAt(bx, bz, h) < 0.55 && info.nearest(bx, bz, t).d > 20.5) {
          const sc = 0.7 + rng() * 0.9, bv = 0.75 + rng() * 0.5;
          put(bigBins, BIG, "bush", bx, h - 0.1, bz, rng() * 6.283, sc, sc * (0.8 + rng() * 0.3), sc, 0, 0, tint(1, bv, (rng() - 0.5) * 0.4));
          nBush++;
        }
      }
      // rocks
      const pRock = (w[2] * 0.06 + w[3] * 0.1 + w[4] * 0.12 + w[1] * 0.012 + (w[0] + w[6]) * 0.006 + w[5] * 0.03) * sm(21.5, 28, d) * (1 - sm(band * 0.75, band, d)) * q.rocks;
      if (rng() < pRock) {
        const h = hAt(x, z);
        if (h > WATER + 0.2) {
          const sl = slopeAt(x, z, h);
          const big = (w[2] + w[3] + w[4]) > 0.4;
          let sc = 0.7 + Math.pow(rng(), 2.2) * (big ? 4.2 : 1.9);
          if (sl > 0.7) sc *= 1.3;
          const sp = "rock" + Math.floor(rng() * 3);
          const v = 0.8 + rng() * 0.35;
          put(bigBins, BIG, sp, x, h - sc * 0.18, z, rng() * 6.283, sc * (0.85 + rng() * 0.4), sc * (0.8 + rng() * 0.4), sc * (0.85 + rng() * 0.4), (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3, [v, v * 0.98, v * 0.95]);
          nRocks++;
        }
      }
    }
  }

  // roadside verge rocks (near the barrier, readable at speed)
  if (q.rocks > 0.5) {
    for (let i = 0; i < info.n; i += 2) {
      if (rng() > 0.08 * q.rocks) continue;
      const S = info.samples[i];
      const side = rng() < 0.5 ? -1 : 1, off = half + 5 + rng() * 14;
      const x = S.pos.x + S.normal.x * side * off, z = S.pos.z + S.normal.z * side * off;
      const h = hAt(x, z);
      if (h <= WATER + 0.3) continue;
      const tt = info.nearest(x, z, t);
      if (tt.d < 21) continue;
      const sc = 0.55 + rng() * 1.1, v = 0.8 + rng() * 0.3;
      put(bigBins, BIG, "rock" + Math.floor(rng() * 3), x, h - sc * 0.15, z, rng() * 6.283, sc, sc * 0.9, sc, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25, [v, v, v * 0.97]);
      nRocks++;
    }
  }

  // ---- grass & flowers ----------------------------------------------------------
  const gStep = 2.6, gSub = SMALL / gStep;
  const G = { grass: L(0x58852f), dry: L(0x9a9a52), forest: L(0x3f6a2b), meadow: L(0x6e8d45), lime: L(0x8e8a6a) };
  let nGrass = 0;
  if (q.grass > 0) {
    const gband = 62;
    const gNear = new Set();
    {
      const R = Math.ceil((gband + 8) / SMALL);
      for (const key of info.grid.keys()) {
        const [cx, cz] = key.split(",").map(Number);
        const x0 = cx * cs, z0 = cz * cs;
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) gNear.add((Math.floor(x0 / SMALL) + dx) + "," + (Math.floor(z0 / SMALL) + dz));
      }
    }
    for (const key of gNear) {
      const [cx, cz] = key.split(",").map(Number);
      for (let j = 0; j < gSub; j++) for (let i = 0; i < gSub; i++) {
        const x = cx * SMALL + (i + rng()) * gStep, z = cz * SMALL + (j + rng()) * gStep;
        const tt = info.nearest(x, z, t);
        const d = tt.d;
        if (d < 19.6 || d > gband) continue;
        const w = info.weights(tt, wv);
        const fade = sm(19.6, 24, d) * (1 - sm(gband * 0.6, gband, d));
        const patch = VR.fbm(x * 0.006 + 7, z * 0.006 - 3, 3, S0 + 21);
        const meadow = 0.55 + 0.45 * VR.fbm(x * 0.05, z * 0.05, 2, S0 + 41);
        const p = ((w[0] + w[6]) * 0.62 + w[1] * 0.3 + w[2] * 0.34 + w[3] * 0.05 + w[4] * 0.12 + w[5] * 0.1) * fade * meadow * q.grass;
        if (rng() > p) continue;
        const h = hAt(x, z);
        if (h < WATER + 0.9) continue;
        if (slopeAt(x, z, h) > 0.62) continue;
        // match the terrain's base tint
        const dry = sm(0.35, 0.7, patch);
        let b = mix3(G.grass, G.dry, dry);
        b = mix3(b, G.forest, w[1]);
        b = mix3(b, G.meadow, w[2] * 0.7);
        b = mix3(b, G.lime, w[4] * 0.6 + w[3] * 0.4);
        const v = 0.95 + rng() * 0.5;
        const sc = 0.65 + rng() * 0.8;
        const flower = (w[0] + w[6] + w[2]) > 0.5 && rng() < 0.05 * (0.4 + dry * -0.2 + 0.6);
        if (flower) put(smallBins, SMALL, "flower", x, h - 0.03, z, rng() * 6.283, sc, sc, sc, 0, 0, [1, 1, 1]);
        else put(smallBins, SMALL, "grass", x, h - 0.03, z, rng() * 6.283, sc, sc * (0.8 + rng() * 0.5), sc, 0, 0, [b[0] * v * 2.1, b[1] * v * 2.1, b[2] * v * 2.1]);
        nGrass++;
      }
    }
  }

  // ---------------------------------------------------------------- build chunk meshes
  const chunks = [];
  function shallow(geo) {
    const g = new THREE.BufferGeometry();
    for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
    if (geo.index) g.setIndex(geo.index);
    return g;
  }
  function buildBins(bins, size, defs, lodDist) {
    for (const b of bins.values()) {
      const cxm = (b.cx + 0.5) * size, czm = (b.cz + 0.5) * size;
      const cym = (b.minY + b.maxY) / 2 + 6, rad = Math.hypot(size / 2, size / 2, (b.maxY - b.minY) / 2 + 14) + 6;
      const ch = { x: cxm, z: czm, half: size / 2, items: [] };
      for (const name in b.sp) {
        const def = defs[name], s = b.sp[name], count = s.m.length / 16;
        const near = new THREE.InstancedMesh(shallow(def.near), def.mat, count);
        near.instanceMatrix.array.set(s.m); near.instanceMatrix.needsUpdate = true;
        near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(s.c), 3);
        VR.setBounds(near.geometry, new THREE.Vector3(cxm, cym, czm), rad);
        near.castShadow = def.cast; near.receiveShadow = def.recv; near.matrixAutoUpdate = false; near.name = name;
        group.add(near);
        let far = null;
        if (def.far) {
          far = new THREE.InstancedMesh(shallow(def.far), def.mat, count);
          far.instanceMatrix = near.instanceMatrix; far.instanceColor = near.instanceColor;
          VR.setBounds(far.geometry, new THREE.Vector3(cxm, cym, czm), rad);
          far.castShadow = false; far.receiveShadow = false; far.matrixAutoUpdate = false; far.name = name + "_far";
          far.visible = false;
          group.add(far);
        }
        ch.items.push({ near, far, cull: def.cull, lod: lodDist });
      }
      chunks.push(ch);
    }
  }
  buildBins(bigBins, BIG, SP, lodNear);
  buildBins(smallBins, SMALL, GRASS, 0);

  // ---------------------------------------------------------------- corner chevrons
  const chev = (() => {
    const W = 256, H = 96, cv = VR.canvas(W, H), g = cv.getContext("2d");
    g.fillStyle = "#f6c014"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#16161a"; g.lineWidth = 6; g.strokeRect(4, 4, W - 8, H - 8);
    g.fillStyle = "#16161a";
    for (let k = 0; k < 2; k++) {
      const ox = 62 + k * 74;
      g.beginPath(); g.moveTo(ox, 16); g.lineTo(ox + 56, H / 2); g.lineTo(ox, H - 16); g.lineTo(ox + 24, H - 16); g.lineTo(ox + 80, H / 2); g.lineTo(ox + 24, 16); g.closePath(); g.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  })();
  const nightU = { uNightL: { value: 0 } };
  const signMat = VR.reg(new THREE.MeshStandardMaterial({ map: chev, roughness: 0.45, metalness: 0.25, envMapIntensity: 0.7 }), 0.7);
  VR.patch(signMat, { key: "chevron", uniforms: nightU, fragDecl: "uniform float uNightL;", fragEmissive: "totalEmissiveRadiance += diffuseColor.rgb * uNightL * 0.45;" });
  const postMat = VR.reg(new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8d939b), roughness: 0.5, metalness: 0.6 }), 1);

  const signs = [];
  {
    let lastI = -100;
    for (let i = 0; i < info.n; i++) {
      const k = info.kappaS[i];
      if (Math.abs(k) < 0.0095) continue;
      if (i - lastI < 5) continue;
      // only in the heart of a bend: curvature is still high 3 samples ahead and behind
      if (Math.abs(info.kappaS[(i + 3) % info.n]) < 0.0085 || Math.abs(info.kappaS[(i - 3 + info.n) % info.n]) < 0.0085) continue;
      lastI = i;
      const S = info.samples[i];
      const outer = k > 0 ? -1 : 1;                        // outer side of the bend
      const off = half + 5.2;
      const x = S.pos.x + S.normal.x * outer * off, z = S.pos.z + S.normal.z * outer * off;
      const h = hAt(x, z);
      if (h < WATER) continue;
      // face the oncoming car: panel normal points back along the track
      const yaw = Math.atan2(-S.tangent.x, -S.tangent.z);
      signs.push({ x, z, y: Math.max(h, S.pos.y - 0.4), yaw: yaw, left: k > 0 });
    }
  }
  if (signs.length) {
    const mkGeo = (flip) => {
      const g = new THREE.BoxGeometry(3.1, 1.2, 0.08); g.translate(0, 2.9, 0);
      if (flip) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
      return g;
    };
    const postGeo = (() => { const a = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6); a.translate(-1.0, 1.6, -0.1); const b = a.clone(); b.translate(2.0, 0, 0); return VR.mergeGeometries([part(a), part(b)]); })();
    const make = (geo, mat, list) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((s, i) => { _e.set(0, s.yaw, 0); _q.setFromEuler(_e); _p.set(s.x, s.y, s.z); _s.set(1, 1, 1); _m.compose(_p, _q, _s); m.setMatrixAt(i, _m); });
      m.instanceMatrix.needsUpdate = true; m.castShadow = !!q.shadows; m.frustumCulled = false; group.add(m);
    };
    const L1 = signs.filter((s) => s.left), R1 = signs.filter((s) => !s.left);
    make(mkGeo(false), signMat, R1);      // texture arrows point right
    make(mkGeo(true), signMat, L1);
    make(postGeo, postMat, signs);
  }

  // ---------------------------------------------------------------- per-frame
  const cullStep = { acc: 0 };
  function cull(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    for (const c of chunks) {
      const d = Math.max(0, Math.hypot(c.x - cx, c.z - cz) - c.half * 1.2);
      for (const it of c.items) {
        const vis = d < it.cull;
        if (it.far) {
          const nearVis = vis && d < it.lod;
          it.near.visible = nearVis; it.far.visible = vis && !nearVis;
        } else it.near.visible = vis;
      }
    }
  }
  let first = true;
  const api = {
    group,
    stats: { trees: nTrees, rocks: nRocks, bushes: nBush, grass: nGrass, chunks: chunks.length, signs: signs.length },
    update(dt, camera) {
      nightU.uNightL.value = atm.night;
      VR.uniforms.uWind.value = 0.85 + 0.3 * Math.sin(VR.uniforms.uTime.value * 0.23) + 0.15 * Math.sin(VR.uniforms.uTime.value * 0.71);
      cullStep.acc += dt;
      if (first || cullStep.acc > 0.12) { cullStep.acc = 0; first = false; cull(camera); }
    },
  };
  if (VR.DEBUG) console.log("scenery", JSON.stringify(api.stats));
  return api;
};
