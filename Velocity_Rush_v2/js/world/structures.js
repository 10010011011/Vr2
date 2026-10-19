"use strict";
/* ============================================================================
   Structures — start/finish gantry + chequered line + grandstand, tunnel
   galleries (concrete shell under a grassy embankment, cove lighting),
   bridge piers over water.
   ========================================================================== */
VR.buildStructures = function buildStructures(info, terrain, seed, q, atm, road) {
  const group = new THREE.Group();
  group.name = "structures";
  const S = info.samples, n = info.n, half = info.half;
  const hAt = terrain.heightAt;
  const L = VR.linRGB;
  const RY = VR.ROAD_Y;
  const mulberry = (a) => () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rng = mulberry(seed ^ 0xabcdef);
  const nightU = { uNightS: { value: 0 } };
  const wrap = (i) => ((i % n) + n) % n;
  const part = (geometry, matrix) => ({ geometry, matrix });
  const yawOf = (s) => Math.atan2(s.tangent.x, s.tangent.z);

  /** Frame helper: world point from sample + lateral(+left) + up. */
  const P = (s, lat, up) => new THREE.Vector3(s.pos.x + s.normal.x * lat, s.pos.y + RY + up, s.pos.z + s.normal.z * lat);

  /** Build a mesh geometry from vertex grid rows with auto-winding against a desired normal. */
  function gridGeo(rows, wantFn, extra) {
    const R = rows.length, M = rows[0].length;
    const pos = new Float32Array(R * M * 3), uv = new Float32Array(R * M * 2);
    for (let r = 0; r < R; r++) for (let j = 0; j < M; j++) {
      const v = rows[r][j], id = r * M + j;
      pos[id * 3] = v.x; pos[id * 3 + 1] = v.y; pos[id * 3 + 2] = v.z;
      uv[id * 2] = extra ? extra.u(r, j) : r; uv[id * 2 + 1] = extra ? extra.v(r, j) : j / (M - 1);
    }
    const idx = [];
    for (let r = 0; r < R - 1; r++) for (let j = 0; j < M - 1; j++) {
      const a = r * M + j, b = a + 1, c = a + M, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // winding check on the first quad
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const va = new THREE.Vector3(pos[idx[0] * 3], pos[idx[0] * 3 + 1], pos[idx[0] * 3 + 2]);
    const vb = new THREE.Vector3(pos[idx[1] * 3], pos[idx[1] * 3 + 1], pos[idx[1] * 3 + 2]);
    const vc = new THREE.Vector3(pos[idx[2] * 3], pos[idx[2] * 3 + 1], pos[idx[2] * 3 + 2]);
    const nrm = new THREE.Vector3().crossVectors(vb.clone().sub(va), vc.clone().sub(va));
    const want = wantFn(va.clone().add(vb).add(vc).divideScalar(3));
    if (nrm.dot(want) < 0) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; }
    }
    g.computeVertexNormals();
    return g;
  }

  // ------------------------------------------------------------ shared materials
  const concreteTex = (() => {
    const cv = VR.canvas(256, 256), g = cv.getContext("2d");
    g.fillStyle = "#b9b7b0"; g.fillRect(0, 0, 256, 256);
    const r = mulberry(5);
    for (let i = 0; i < 2600; i++) { const v = 150 + r() * 70; g.fillStyle = `rgba(${v},${v - 2},${v - 8},${0.1 + r() * 0.2})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1 + r() * 3); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,58,52,${0.03 + r() * 0.05})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 20 + r() * 60); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  })();
  const concrete = VR.reg(new THREE.MeshStandardMaterial({ color: 0xcfcdc6, map: concreteTex, roughness: 0.92, metalness: 0, envMapIntensity: 0.85 }), 0.85);
  concreteTex.repeat.set(0.25, 0.25);
  const steel = VR.reg(new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.75 }), 1);

  const result = { group, update() {} };

  // ============================================================ start / finish
  {
    const si = wrap(-1), s = S[si], yaw = yawOf(s);
    const root = new THREE.Group(); root.position.copy(P(s, 0, 0)); root.rotation.y = yaw; root.name = "start";
    group.add(root);
    // chequered line across the asphalt
    const ck = (() => {
      const cv = VR.canvas(512, 32), g = cv.getContext("2d");
      for (let y = 0; y < 2; y++) for (let x = 0; x < 32; x++) { g.fillStyle = (x + y) % 2 ? "#f4f4f2" : "#16161a"; g.fillRect(x * 16, y * 16, 16, 16); }
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; t.magFilter = THREE.NearestFilter; return t;
    })();
    const lineGeo = new THREE.PlaneGeometry(2 * (half - 0.5), 2.0); lineGeo.rotateX(-Math.PI / 2);
    const lineMat = new THREE.MeshStandardMaterial({ map: ck, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 0.9 });
    VR.reg(lineMat, 0.9);
    const line = new THREE.Mesh(lineGeo, lineMat); line.position.set(0, 0.035, 0); line.receiveShadow = !!q.shadows; root.add(line);

    // banner texture
    const bn = (() => {
      const W = 2048, H = 256, cv = VR.canvas(W, H), g = cv.getContext("2d");
      g.fillStyle = "#0e1116"; g.fillRect(0, 0, W, H);
      const sq = 32;
      for (const x0 of [0, W - 256]) for (let y = 0; y < H / sq; y++) for (let x = 0; x < 256 / sq; x++) { g.fillStyle = (x + y) % 2 ? "#f4f4f2" : "#16161a"; g.fillRect(x0 + x * sq, y * sq, sq, sq); }
      const grd = g.createLinearGradient(256, 0, W - 256, 0); grd.addColorStop(0, "#ff3d3d"); grd.addColorStop(0.5, "#ff6a3d"); grd.addColorStop(1, "#ff3d3d");
      g.fillStyle = grd; g.fillRect(256, H - 26, W - 512, 14);
      g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "900 128px 'Saira Condensed', 'Arial Narrow', Impact, sans-serif";
      g.fillText("VELOCITY RUSH", W / 2, H / 2 - 18);
      g.font = "700 34px 'Saira Condensed', 'Arial Narrow', sans-serif"; g.fillStyle = "#9fb2c8";
      g.fillText("S T A R T  /  F I N I S H", W / 2, H - 52);
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
    })();
    const bannerMat = VR.reg(new THREE.MeshStandardMaterial({ map: bn, roughness: 0.6, metalness: 0, envMapIntensity: 0.8 }), 0.8);
    VR.patch(bannerMat, { key: "banner", uniforms: nightU, fragDecl: "uniform float uNightS;", fragEmissive: "totalEmissiveRadiance += diffuseColor.rgb * (0.05 + uNightS * 0.55);" });

    const span = 2 * (half + 3.6), H = 9.4;
    for (const sd of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.5, H, 1.9), concrete); pylon.position.set(sd * (span / 2), H / 2 - 0.1, 0);
      pylon.castShadow = !!q.shadows; root.add(pylon);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 2.5), steel); cap.position.set(sd * (span / 2), H + 0.1, 0); root.add(cap);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.8, 2.5, 1.2), steel); beam.position.set(0, H - 1.2, 0); beam.castShadow = !!q.shadows; root.add(beam);
    for (const z of [0.64, -0.64]) {
      const pan = new THREE.Mesh(new THREE.PlaneGeometry(span - 1.5, 2.2), bannerMat);
      pan.position.set(0, H - 1.2, z); if (z < 0) pan.rotation.y = Math.PI; root.add(pan);
    }
    // LED strip under the beam
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 3.4, 2.6) });
    const led = new THREE.Mesh(new THREE.BoxGeometry(span - 2, 0.12, 0.3), ledMat); led.position.set(0, H - 2.5, 0); root.add(led);
    // start lights (five red, lit only by the sky at dusk, glowing during the countdown via emissive bloom)
    // grandstand on the outside of the start straight
    const stand = new THREE.Group(); root.add(stand);
    const crowd = (() => {
      const cv = VR.canvas(512, 64), g = cv.getContext("2d"), r = mulberry(99);
      g.fillStyle = "#2a2f38"; g.fillRect(0, 0, 512, 64);
      const cols = ["#d9423c", "#e8e8e8", "#3b78d8", "#f0b429", "#2fa36b", "#9b59d0", "#1c1f26", "#f27ea9"];
      for (let i = 0; i < 520; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; const x = r() * 512, y = 4 + r() * 56; g.beginPath(); g.arc(x, y, 3 + r() * 2, 0, 6.283); g.fill(); g.fillStyle = "rgba(240,205,170,0.9)"; g.beginPath(); g.arc(x, y - 6, 2.2, 0, 6.283); g.fill(); }
      const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
    })();
    crowd.repeat.set(2, 1);
    const crowdMat = VR.reg(new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9, envMapIntensity: 0.8 }), 0.8);
    const roofMat = VR.reg(new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5, metalness: 0.2 }), 1);
    const side = -1;                                 // right-hand side of travel direction? (+x local = left); put stand on the left
    const sx = (half + 7);
    const len = 46;
    for (let k = 0; k < 5; k++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0 + k * 1.0, len), k % 1 === 0 ? crowdMat : concrete);
      tier.position.set(-side * (sx + k * 2.2 + 1.1) * -1, (1.0 + k * 1.0) / 2 - 0.2, -len * 0.18);
      tier.position.x = (sx + k * 2.2 + 1.1);
      tier.receiveShadow = !!q.shadows; tier.castShadow = !!q.shadows; stand.add(tier);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.35, len + 2), roofMat); roof.position.set(sx + 5.8, 8.2, -len * 0.18); roof.rotation.z = -0.08; roof.castShadow = !!q.shadows; stand.add(roof);
    for (const z of [-len * 0.18 - len / 2 + 1, -len * 0.18 + len / 2 - 1]) for (const dx of [0.5, 11]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, 8.3, 0.45), steel); col.position.set(sx + dx, 4, z); stand.add(col);
    }
    // keep the stand on the ground
    const gy = hAt(root.position.x + Math.cos(yaw) * (sx + 6), root.position.z - Math.sin(yaw) * (sx + 6));
    stand.position.y = Math.min(0, gy - root.position.y) ;
  }

  // ============================================================ tunnel galleries
  const tunnelRuns = info.runs.tunnel.filter((r) => r.count >= 14);
  const tunnelSpans = [];
  if (tunnelRuns.length) {
    const ARC = 14;
    const profile = (a, b, yBase, yWall) => {
      const pts = [[a, yBase], [a, yWall]];
      for (let k = 1; k <= ARC; k++) { const th = (k / ARC) * Math.PI; pts.push([a * Math.cos(th), yWall + b * Math.sin(th)]); }
      pts.push([-a, yBase]);
      return pts;
    };
    const PI_ = profile(21, 7.4, -0.3, 1.8), PO_ = profile(30, 11.5, -1.9, 2.6);
    const M = PI_.length;
    const lightMat = VR.reg(new THREE.MeshStandardMaterial({ color: 0xb8b5ad, map: concreteTex, roughness: 0.82, metalness: 0, envMapIntensity: 0.7, side: THREE.FrontSide }), 0.7);
    VR.patch(lightMat, {
      key: "tunnelIn", worldPos: true,
      vertexDecl: "attribute vec2 aT; varying vec2 vT;", vertexMain: "vT = aT;",
      fragDecl: "varying vec2 vT;",
      fragAfterColor: `
        float seam = 1.0 - smoothstep(0.0, 0.05, abs(fract(vT.x / 6.0) - 0.5) - 0.455 + 0.05);
        diffuseColor.rgb *= 0.9 - 0.35 * seam;
      `,
      fragEmissive: `
        float ph = fract(vT.x / 13.0);
        float lampA = exp(-pow((ph - 0.5) * 7.0, 2.0));
        float band = (1.0 - smoothstep(0.0, 0.016, abs(vT.y - 0.36))) + (1.0 - smoothstep(0.0, 0.016, abs(vT.y - 0.64)));
        float wall = 1.0 - smoothstep(0.0, 0.05, abs(vT.y - 0.13)) ;
        float wall2 = 1.0 - smoothstep(0.0, 0.05, abs(vT.y - 0.87));
        totalEmissiveRadiance += vec3(1.0, 0.86, 0.64) * (band * (0.45 + 0.55 * lampA) * 1.9 + (wall + wall2) * 0.08 * lampA);
        totalEmissiveRadiance += diffuseColor.rgb * 0.16;
      `,
    });
    const grassCol = L(0x4a6b2c), dirtCol = L(0x5a4a34);
    const outerMat = VR.reg(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.85 }), 0.85);

    for (const run of tunnelRuns) {
      const i0 = run.i0, cnt = run.count;
      const rIn = [], rOut = [], T = [];
      let along = 0;
      const k0 = -2, k1 = cnt + 1;                    // extend a little beyond the biome so the mouth sits on the straight
      for (let k = k0; k <= k1; k++) {
        const s = S[wrap(i0 + k)];
        if (k > k0) along += S[wrap(i0 + k)].pos.distanceTo(S[wrap(i0 + k - 1)].pos);
        rIn.push(PI_.map((p) => P(s, p[0], p[1])));
        rOut.push(PO_.map((p) => P(s, p[0], p[1])));
        T.push(along);
      }
      const mid = P(S[wrap(i0 + (cnt >> 1))], 0, 4);
      const inner = gridGeo(rIn, (c) => mid.clone().sub(c), { u: (r) => T[r], v: (r, j) => j / (M - 1) });
      const aT = new Float32Array(inner.attributes.uv.array); inner.setAttribute("aT", new THREE.BufferAttribute(aT, 2));
      // concrete UVs (metres)
      const uvI = inner.attributes.uv; for (let i = 0; i < uvI.count; i++) { uvI.setXY(i, uvI.getX(i) * 0.5, uvI.getY(i) * 3.0); }
      const meshIn = new THREE.Mesh(inner, lightMat); meshIn.name = "tunnel-inner"; meshIn.receiveShadow = false; group.add(meshIn);

      const outer = gridGeo(rOut, (c) => c.clone().sub(mid), { u: (r) => T[r] * 0.04, v: (r, j) => j * 0.12 });
      const cp = outer.attributes.position, colA = new Float32Array(cp.count * 3);
      for (let r = 0; r < rOut.length; r++) for (let j = 0; j < M; j++) {
        const id = r * M + j, v = cp.getX(id) * 0.31 + cp.getZ(id) * 0.17;
        const nz = VR.fbm(cp.getX(id) * 0.05, cp.getZ(id) * 0.05, 3, 7);
        const top = VR.smoothstep(0.08, 0.3, Math.sin(Math.PI * j / (M - 1)));
        const c = [grassCol[0] + (dirtCol[0] - grassCol[0]) * (1 - top), grassCol[1] + (dirtCol[1] - grassCol[1]) * (1 - top), grassCol[2] + (dirtCol[2] - grassCol[2]) * (1 - top)];
        const k = 0.7 + nz * 0.6;
        colA[id * 3] = c[0] * k; colA[id * 3 + 1] = c[1] * k; colA[id * 3 + 2] = c[2] * k;
      }
      outer.setAttribute("color", new THREE.BufferAttribute(colA, 3));
      const meshOut = new THREE.Mesh(outer, outerMat); meshOut.name = "tunnel-outer"; meshOut.castShadow = !!q.shadows; meshOut.receiveShadow = !!q.shadows; group.add(meshOut);

      // headwalls
      for (const end of [0, 1]) {
        const r = end ? rIn.length - 1 : 0;
        const dirOut = new THREE.Vector3().copy(S[wrap(i0 + (end ? k1 : k0))].tangent).multiplyScalar(end ? 1 : -1); dirOut.y = 0; dirOut.normalize();
        const rows = [rIn[r], rOut[r]];
        const hw = gridGeo(rows, () => dirOut, { u: (rr, j) => j * 0.9, v: (rr) => rr * 5 });
        const m = new THREE.Mesh(hw, concrete); m.castShadow = !!q.shadows; m.receiveShadow = !!q.shadows; group.add(m);
      }
      tunnelSpans.push({ a: wrap(i0 + 2), b: wrap(i0 + cnt - 3) });
    }
  }

  // ============================================================ bridge piers
  {
    const cols = [];
    for (const run of info.runs.water) {
      for (let k = 3; k < run.count - 3; k += 5) {
        const i = wrap(run.i0 + k), s = S[i], yaw = yawOf(s);
        const ry = s.pos.y + RY;
        for (const lat of [-10.5, 10.5]) {
          const x = s.pos.x + s.normal.x * lat, z = s.pos.z + s.normal.z * lat;
          const bed = hAt(x, z);
          if (bed > ry - 2.2) continue;
          cols.push({ x, z, yaw, y0: bed - 1, y1: ry - 1.0 });
        }
        cols.push({ beam: true, x: s.pos.x, z: s.pos.z, yaw, y: ry - 1.35 });
      }
    }
    const colsOnly = cols.filter((c) => !c.beam), beams = cols.filter((c) => c.beam);
    const e = new THREE.Euler(), qn = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), m4 = new THREE.Matrix4();
    const mk = (geo, list, fn) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, concrete, list.length);
      list.forEach((c, i) => { fn(c); m4.compose(ps, qn, sc); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true; im.castShadow = !!q.shadows; im.receiveShadow = !!q.shadows; im.frustumCulled = false; group.add(im);
    };
    const unit = new THREE.BoxGeometry(1, 1, 1);
    mk(unit, colsOnly, (c) => { e.set(0, c.yaw, 0); qn.setFromEuler(e); ps.set(c.x, (c.y0 + c.y1) / 2, c.z); sc.set(2.6, c.y1 - c.y0, 3.4); });
    mk(unit, beams, (c) => { e.set(0, c.yaw, 0); qn.setFromEuler(e); ps.set(c.x, c.y, c.z); sc.set(2 * (half + 1.2), 1.5, 3.8); });
  }

  // ------------------------------------------------------------ per-frame
  let ambient = 1;
  const tn = {};
  result.update = function (dt, camera) {
    nightU.uNightS.value = atm.night;
    if (!tunnelSpans.length) return;
    // inside a tunnel? (nearest road sample is within a span and the camera is close to the road)
    info.nearest(camera.position.x, camera.position.z, tn);
    let inside = false;
    if (tn.d < 26) for (const sp of tunnelSpans) {
      const a = sp.a, b = sp.b;
      const inSpan = a <= b ? (tn.idx >= a && tn.idx <= b) : (tn.idx >= a || tn.idx <= b);
      if (inSpan) { inside = true; break; }
    }
    const target = inside ? 0.28 : 1;
    const next = VR.damp(ambient, target, 3.5, Math.min(dt, 0.1));
    if (Math.abs(next - ambient) > 0.002) { ambient = next; VR.setAmbientScale(ambient); }
  };
  return result;
};
