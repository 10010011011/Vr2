"use strict";
/* ============================================================================
   Terrain — biome-driven height field, carved around the road, shaded with
   vertex colour + packed detail splat. Fine tiles near the track, coarse
   far-field beyond. Lakes are separate depth-attributed meshes.
   ========================================================================== */
VR.buildTerrain = function buildTerrain(info, seed, q, atm) {
  const S0 = seed & 0xffff;
  const nb = VR.BIOMES.length;
  const WATER = VR.WATER_Y;
  const half = info.half;
  // the flat road corridor must cover the asphalt plus a full ring of terrain cells beyond its edge, otherwise cells that
  // straddle the corridor boundary interpolate toward a steep wall and poke through the road surface
  const FLAT = half + 1.5 + q.terrainCell * 1.45;
  const C = {
    grass: VR.linRGB(0x45692a), grassDry: VR.linRGB(0x827e44), forest: VR.linRGB(0x2a4326), meadow: VR.linRGB(0x55703d),
    rock: VR.linRGB(0x6f6962), rockDark: VR.linRGB(0x4a463f), sandstone: VR.linRGB(0x8a5f3c), lime: VR.linRGB(0x877f6c),
    sand: VR.linRGB(0xb3a47c), snow: VR.linRGB(0xdfe6ee), bed: VR.linRGB(0x4d473a), soil: VR.linRGB(0x6b5336),
  };

  const tN = {}, wN = new Float32Array(nb);

  /** Height field. `exact` selects the precise nearest-road search. Returns height; fills `o` with extras. */
  function field(x, z, exact, o) {
    const t = exact ? info.nearest(x, z, tN) : info.nearestFar(x, z, tN);
    const w = info.weights(t, wN);
    const d = t.d, lat = t.lat;
    const sm = VR.smoothstep;
    let yRef = t.y;
    if (d > 22) yRef = VR.lerp(t.y, info.idwHeight(x, z), sm(22, 95, d));

    const n1 = VR.fbm(x * 0.0042, z * 0.0042, 4, S0);
    const n2 = VR.fbm(x * 0.018 + 31, z * 0.018, 3, S0 + 5);
    const n3 = VR.fbm(x * 0.07, z * 0.07 + 11, 2, S0 + 9);
    const R = VR.ridged(x * 0.0058, z * 0.0058, 4, S0 + 13);

    const oPlains = (n1 - 0.5) * 11 * sm(18, 100, d) + (n2 - 0.5) * 2.4 * sm(8, 50, d) + (n3 - 0.5) * 0.6;
    const oForest = (n1 - 0.45) * 24 * sm(16, 90, d) + (n2 - 0.5) * 4.5 * sm(8, 40, d) + 2.5 * sm(18, 60, d) + (n3 - 0.5) * 0.9;
    const oMount = sm(26, 175, d) * (24 + 95 * R) + (n2 - 0.5) * 7 * sm(14, 60, d) + (n3 - 0.5) * 1.5;
    const q4 = n1 * 5, fl = Math.floor(q4);
    const oCliff = sm(18, 120, d) * (fl + sm(0.3, 1.0, q4 - fl)) * 7.0 + (n2 - 0.5) * 2.5 + (n3 - 0.5) * 0.8;
    const side = sm(-8, 8, lat);
    const drop = -Math.min(62, Math.max(0, -lat - 15) * 1.35);
    const wall = Math.min(30, Math.max(0, lat - 17) * 0.8 + (n2 - 0.3) * 5 * sm(20, 70, d));
    const oCSide = VR.lerp(drop, wall, side) + (n3 - 0.5) * 1.2;
    const oTunnel = oPlains * 0.7 + 1.5 * sm(30, 100, d);

    const wsum = w[0] + w[1] + w[2] + w[3] + w[4] + w[6] + 1e-4;
    const off = (w[0] * oPlains + w[1] * oForest + w[2] * oMount + w[3] * oCliff + w[4] * oCSide + w[6] * oTunnel) / wsum;
    const land = yRef + off;
    const ww = sm(0.18, 0.8, w[5]);
    const bed = -2.6 - 6.5 * sm(8, 95, d) - n1 * 2.5;
    let h = VR.lerp(land, bed, ww);

    const slopeLen = VR.lerp(34, 9, w[4] * (lat < 0 ? 1 : 0.5));
    const flat = FLAT;
    const cb = 1 - sm(flat, flat + slopeLen, d);
    // corridor height: the lowest road level of ANY stretch within reach (hairpin insides see two stretches at different heights)
    const tY = d < FLAT + 14 ? info.envelope(x, z, t.y, FLAT, FLAT + 14) : t.y;
    const target = VR.lerp(tY - 0.12, Math.min(tY - 0.12, bed), ww);
    h = VR.lerp(h, target, cb);
    if (o) { o.d = d; o.lat = lat; o.n2 = n2; o.n3 = n3; o.n1 = n1; o.ww = ww; o.cb = cb; }
    return h;
  }

  // ---- generic grid builder --------------------------------------------------
  function computeGrid(g) {
    const vx = g.nx + 1, vz = g.nz + 1, nv = vx * vz;
    const H = new Float32Array(nv), D = new Float32Array(nv).fill(1e9), valid = new Uint8Array(nv);
    const W = new Float32Array(nv * nb), LAT = new Float32Array(nv);
    const ex = {};
    for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
      const x = g.x0 + i * g.cell, z = g.z0 + j * g.cell, id = j * vx + i;
      if (g.include) {
        const t = info.nearestFar(x, z, tN);
        if (t.d > g.reach) continue;
      }
      H[id] = field(x, z, g.exact, ex);
      D[id] = ex.d; LAT[id] = ex.lat; valid[id] = 1;
      const w = info.weights(tN, wN);
      for (let k = 0; k < nb; k++) W[id * nb + k] = w[k];
      if (g.post) H[id] -= g.post(ex.d);
    }
    // pass 2: normals + colours + splat
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), spl = new Float32Array(nv * 4);
    const col3 = [0, 0, 0];
    for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
      const id = j * vx + i;
      if (!valid[id]) continue;
      const x = g.x0 + i * g.cell, z = g.z0 + j * g.cell, h = H[id];
      const hL = valid[id - (i > 0 ? 1 : 0)] ? H[id - (i > 0 ? 1 : 0)] : h, hR = valid[id + (i < g.nx ? 1 : 0)] ? H[id + (i < g.nx ? 1 : 0)] : h;
      const hU = valid[id - (j > 0 ? vx : 0)] ? H[id - (j > 0 ? vx : 0)] : h, hD = valid[id + (j < g.nz ? vx : 0)] ? H[id + (j < g.nz ? vx : 0)] : h;
      let nx = -(hR - hL) / (2 * g.cell), nz = -(hD - hU) / (2 * g.cell);
      const nl = Math.sqrt(nx * nx + 1 + nz * nz); nx /= nl; const ny = 1 / nl; nz /= nl;
      pos[id * 3] = x; pos[id * 3 + 1] = h; pos[id * 3 + 2] = z;
      nor[id * 3] = nx; nor[id * 3 + 1] = ny; nor[id * 3 + 2] = nz;

      // ---- colour / splat ----
      const w = W.subarray(id * nb, id * nb + nb);
      const n2 = VR.fbm(x * 0.018 + 31, z * 0.018, 3, S0 + 5), n3 = VR.fbm(x * 0.07, z * 0.07 + 11, 2, S0 + 9);
      const patch = VR.fbm(x * 0.006 + 7, z * 0.006 - 3, 3, S0 + 21);
      const slopeRock = 1 - VR.smoothstep(0.66, 0.9, ny);
      let r = 0, gg = 0, b = 0;
      const add = (c, k) => { r += c[0] * k; gg += c[1] * k; b += c[2] * k; };
      // plains
      const gr = [0, 0, 0];
      const dry = VR.smoothstep(0.35, 0.7, patch);
      gr[0] = C.grass[0] + (C.grassDry[0] - C.grass[0]) * dry; gr[1] = C.grass[1] + (C.grassDry[1] - C.grass[1]) * dry; gr[2] = C.grass[2] + (C.grassDry[2] - C.grass[2]) * dry;
      add(gr, w[0]);
      add(C.forest, w[1]);
      // mountain: meadow low, rock higher
      const mAlt = VR.smoothstep(18, 65, h);
      add([C.meadow[0] + (C.rock[0] - C.meadow[0]) * mAlt, C.meadow[1] + (C.rock[1] - C.meadow[1]) * mAlt, C.meadow[2] + (C.rock[2] - C.meadow[2]) * mAlt], w[2]);
      add(C.sandstone, w[3]);
      add(C.lime, w[4]);
      add(C.bed, w[5]);
      add(gr, w[6] * 0.8); add(C.rock, w[6] * 0.2);
      // slope → exposed rock; altitude → snow
      const rockC = [C.rock[0] * (0.8 + n3 * 0.5), C.rock[1] * (0.8 + n3 * 0.5), C.rock[2] * (0.8 + n3 * 0.5)];
      const dk = VR.smoothstep(0.3, 0.1, n2);
      rockC[0] = rockC[0] * (1 - dk * 0.4); rockC[1] = rockC[1] * (1 - dk * 0.4); rockC[2] = rockC[2] * (1 - dk * 0.4);
      r += (rockC[0] - r) * slopeRock * 0.85; gg += (rockC[1] - gg) * slopeRock * 0.85; b += (rockC[2] - b) * slopeRock * 0.85;
      const snow = VR.smoothstep(58 + n2 * 14, 84 + n2 * 10, h) * VR.smoothstep(0.5, 0.78, ny);
      r += (C.snow[0] - r) * snow; gg += (C.snow[1] - gg) * snow; b += (C.snow[2] - b) * snow;
      // shore sand / wet bed
      const shore = VR.smoothstep(WATER + 1.4, WATER + 0.1, h) * (1 - snow);
      const bedMix = VR.smoothstep(WATER - 0.2, WATER - 2.2, h);
      r += (C.sand[0] - r) * shore; gg += (C.sand[1] - gg) * shore; b += (C.sand[2] - b) * shore;
      r += (C.bed[0] - r) * bedMix; gg += (C.bed[1] - gg) * bedMix; b += (C.bed[2] - b) * bedMix;
      // macro variation
      const mv = 0.9 + patch * 0.25 + (n3 - 0.5) * 0.18;
      col[id * 3] = r * mv; col[id * 3 + 1] = gg * mv; col[id * 3 + 2] = b * mv;

      // splat: grass, soil, rock, sand
      let sGr = (w[0] + w[1] + w[2] * 0.4 + w[6]) * (1 - slopeRock) * (1 - shore) * (1 - snow);
      let sSo = (w[1] * 0.35 + w[3] * 0.15 + w[5] * 0.4) * (1 - slopeRock);
      let sRo = Math.max(slopeRock, w[3] * 0.5 + w[4] * 0.3 + w[2] * 0.35 + snow * 0.3);
      let sSa = shore + w[4] * 0.45 + w[3] * 0.25 + bedMix * 0.5;
      spl[id * 4] = sGr; spl[id * 4 + 1] = sSo; spl[id * 4 + 2] = sRo; spl[id * 4 + 3] = sSa;
    }
    return { H, D, valid, pos, nor, col, spl, vx, vz, W, LAT };
  }

  // ---- terrain material --------------------------------------------------------
  const detailTex = q.detailTex ? VR.tex.terrainDetail() : null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.85 });
  VR.reg(mat, 0.85);
  if (detailTex) {
    VR.patch(mat, {
      key: "terrain",
      worldPos: true,
      uniforms: { uDetail: { value: detailTex } },
      vertexDecl: "attribute vec4 aSplat; varying vec4 vSplat; varying float vNY;",
      vertexMain: "vSplat = aSplat; vNY = normal.y;",
      fragDecl: "uniform sampler2D uDetail; varying vec4 vSplat; varying float vNY;",
      fragAfterColor: /* glsl */ `
        {
          float dist = length(vWorldPos - cameraPosition);
          vec2 p = vWorldPos.xz;
          vec4 d1 = texture2D(uDetail, p * 0.052);
          vec4 d2 = texture2D(uDetail, p * 0.39 + 0.31);
          vec4 d3 = texture2D(uDetail, p * 0.0117 + 0.7);
          float far = smoothstep(60.0, 320.0, dist);
          vec4 dd = mix(d1 * 0.45 + d2 * 0.55, vec4(0.5) + (d3 - 0.5) * 0.4, far);
          vec4 sp = vSplat;
          float s = sp.x + sp.y + sp.z + sp.w + 1e-4;
          float det = (dd.r * sp.x + dd.g * sp.y + dd.b * sp.z + dd.a * sp.w) / s;
          diffuseColor.rgb *= mix(0.30, 1.75, clamp(det, 0.0, 1.0));
        }`,
    });
  }

  // ---- fine mesh ------------------------------------------------------------
  const group = new THREE.Group();
  group.name = "terrain";
  const cell = q.terrainCell, band = q.terrainBand;
  const B = info.bounds, pad = band + cell * 4;
  const fine = {
    cell, exact: true, include: true, reach: band + cell * 3,
    x0: Math.floor((B.minX - pad) / cell) * cell, z0: Math.floor((B.minZ - pad) / cell) * cell,
  };
  fine.nx = Math.ceil((B.maxX + pad - fine.x0) / cell); fine.nz = Math.ceil((B.maxZ + pad - fine.z0) / cell);
  const _t0 = performance.now();
  const FG = computeGrid(fine);
  const _t1 = performance.now();
  const geoShared = { position: new THREE.BufferAttribute(FG.pos, 3), normal: new THREE.BufferAttribute(FG.nor, 3), color: new THREE.BufferAttribute(FG.col, 3), aSplat: new THREE.BufferAttribute(FG.spl, 4) };

  const TILE = 20;
  const tiles = [];
  const tilesX = Math.ceil(fine.nx / TILE), tilesZ = Math.ceil(fine.nz / TILE);
  const waterCells = [];
  const idxFor = (i, j) => j * FG.vx + i;
  for (let tj = 0; tj < tilesZ; tj++) for (let ti = 0; ti < tilesX; ti++) {
    const idx = [];
    let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let j = tj * TILE; j < Math.min((tj + 1) * TILE, fine.nz); j++) for (let i = ti * TILE; i < Math.min((ti + 1) * TILE, fine.nx); i++) {
      const a = idxFor(i, j), b = idxFor(i + 1, j), c = idxFor(i, j + 1), d = idxFor(i + 1, j + 1);
      if (!(FG.valid[a] && FG.valid[b] && FG.valid[c] && FG.valid[d])) continue;
      const cd = (FG.D[a] + FG.D[b] + FG.D[c] + FG.D[d]) / 4;
      if (cd > band) continue;
      idx.push(a, c, b, b, c, d);
      for (const v of [a, b, c, d]) {
        const y = FG.pos[v * 3 + 1];
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        const x = FG.pos[v * 3], z = FG.pos[v * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const lo = Math.min(FG.pos[a * 3 + 1], FG.pos[b * 3 + 1], FG.pos[c * 3 + 1], FG.pos[d * 3 + 1]);
      if (lo < WATER + 0.35) waterCells.push({ a, b, c, d, tile: tj * tilesX + ti });
    }
    if (!idx.length) continue;
    const geo = new THREE.BufferGeometry();
    for (const k in geoShared) geo.setAttribute(k, geoShared[k]);
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2, cym = (minY + maxY) / 2;
    VR.setBounds(geo, new THREE.Vector3(cxm, cym, czm), Math.hypot(maxX - minX, maxZ - minZ, maxY - minY) / 2 + 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.castShadow = false;
    group.add(mesh);
    tiles.push({ mesh, cx: cxm, cz: czm, r: geo.boundingSphere.radius });
  }

  // ---- coarse far field ---------------------------------------------------------
  {
    const cc = 36, ext = 1500;
    const coarse = {
      cell: cc, exact: false, include: false, x0: -ext, z0: -ext, nx: Math.ceil((2 * ext) / cc), nz: Math.ceil((2 * ext) / cc),
      post: (d) => 6 * (1 - VR.smoothstep(band - 90, band + 5, d)),
    };
    const CG = computeGrid(coarse);
    const idx = [];
    for (let j = 0; j < coarse.nz; j++) for (let i = 0; i < coarse.nx; i++) {
      const a = j * CG.vx + i, b = a + 1, c = a + CG.vx, d = c + 1;
      // cells fully inside the fine mesh's reach are not drawn at all (no poke-through near the road)
      if (Math.max(CG.D[a], CG.D[b], CG.D[c], CG.D[d]) < band - 20) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(CG.pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(CG.nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(CG.col, 3));
    geo.setAttribute("aSplat", new THREE.BufferAttribute(CG.spl, 4));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    VR.setBounds(geo, new THREE.Vector3(0, 20, 0), ext * 1.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const _t2 = performance.now();
  if (VR.DEBUG) console.log('[terrain] fine grid', fine.nx, 'x', fine.nz, 'ms', (_t1 - _t0).toFixed(0), 'tiles+coarse ms', (_t2 - _t1).toFixed(0));
  // ---- water meshes ---------------------------------------------------------------
  let waterMat = null;
  const waterMeshes = [];
  if (waterCells.length) {
    waterMat = VR.makeWaterMaterial(atm, q.water === "simple");
    const byTile = new Map();
    for (const c of waterCells) { let a = byTile.get(c.tile); if (!a) byTile.set(c.tile, (a = [])); a.push(c); }
    for (const [, cells] of byTile) {
      const remap = new Map(); const pos = [], dep = [], idx = [];
      const addV = (v) => {
        let r = remap.get(v);
        if (r === undefined) {
          r = pos.length / 3; remap.set(v, r);
          pos.push(FG.pos[v * 3], WATER, FG.pos[v * 3 + 2]);
          dep.push(Math.min(14, WATER - FG.pos[v * 3 + 1]));
        }
        return r;
      };
      for (const c of cells) { const a = addV(c.a), b = addV(c.b), cc = addV(c.c), d = addV(c.d); idx.push(a, cc, b, b, cc, d); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("aDepth", new THREE.Float32BufferAttribute(dep, 1));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, waterMat);
      m.renderOrder = 5;
      group.add(m);
      waterMeshes.push(m);
    }
  }

  // ---- height lookup (grid bilinear when possible, analytic otherwise) --------------
  const hTmp = {};
  function heightAt(x, z) {
    const fi = (x - fine.x0) / cell, fj = (z - fine.z0) / cell;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i >= 0 && j >= 0 && i < fine.nx && j < fine.nz) {
      const a = j * FG.vx + i, b = a + 1, c = a + FG.vx, d = c + 1;
      if (FG.valid[a] && FG.valid[b] && FG.valid[c] && FG.valid[d]) {
        const u = fi - i, v = fj - j;
        const h0 = FG.H[a] + (FG.H[b] - FG.H[a]) * u, h1 = FG.H[c] + (FG.H[d] - FG.H[c]) * u;
        return h0 + (h1 - h0) * v;
      }
    }
    return field(x, z, false, hTmp);
  }

  return { group, tiles, material: mat, heightAt, field, waterMeshes, waterMat, fine, FG };
};
