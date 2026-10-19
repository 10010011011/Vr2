"use strict";
/* ============================================================================
   Road — seamless asphalt ribbon, corner kerbs, continuous concrete barriers
   with LED strips (glow at night), shoulder skirts. The surface sits at
   sample.y + ROAD_Y, which is where the (unchanged) car physics expects it.
   ========================================================================== */
VR.ROAD_Y = 0.2;          // road surface above the sample point (physics: groundY = pos.y + 0.2)
VR.BARRIER_LAT = 18.0;    // barrier centre line (physics wall is at 17.0)

VR.buildRoad = function buildRoad(info, q, atm) {
  const S = info.samples, n = info.n, half = info.half;
  const RW = VR.tex.ROAD_W / 2;      // asphalt texture half-width (19)
  const Y0 = VR.ROAD_Y;
  const group = new THREE.Group();
  group.name = "road";
  const total = info.length;

  // ---- per-sample frames --------------------------------------------------------
  const frame = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = S[(i - 1 + n) % n].pos, nx = S[(i + 1) % n].pos;
    const t = new THREE.Vector3().subVectors(nx, p).normalize();
    const l = new THREE.Vector3(S[i].normal.x, 0, S[i].normal.z).normalize();
    const up = new THREE.Vector3().crossVectors(t, l).normalize();
    frame[i] = { t, l, up, pos: S[i].pos };
  }
  const dist = info.dist;           // cumulative distance (n+1)
  const colIdx = (i) => i % n;

  // ---------------------------------------------------------------------------------
  // asphalt ribbon
  // ---------------------------------------------------------------------------------
  const at = VR.tex.asphalt();
  const tiles = Math.max(1, Math.round(total / at.tile));
  {
    const pos = new Float32Array((n + 1) * 2 * 3), nor = new Float32Array((n + 1) * 2 * 3), uv = new Float32Array((n + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const f = frame[colIdx(i)], v = (dist[i] / total) * tiles;
      for (let s = 0; s < 2; s++) {
        const sg = s === 0 ? -1 : 1, lat = sg * Math.min(RW, info.innerLimit(i, sg, 0.9)), o = (i * 2 + s);
        pos[o * 3] = f.pos.x + f.l.x * lat; pos[o * 3 + 1] = f.pos.y + Y0; pos[o * 3 + 2] = f.pos.z + f.l.z * lat;
        nor[o * 3] = f.up.x; nor[o * 3 + 1] = f.up.y; nor[o * 3 + 2] = f.up.z;
        uv[o * 2] = s; uv[o * 2 + 1] = v;
      }
      if (i < n) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      map: at.map, normalMap: at.normalMap, roughnessMap: at.roughnessMap, roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(0.75, 0.75), envMapIntensity: 0.55,
    });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
    VR.reg(mat, 0.55);
    // night: painted lines catch the light (retro-reflective paint)
    VR.patch(mat, {
      key: "road", uniforms: { uNightR: VR.uniforms.uNight },
      fragDecl: "uniform float uNightR;",
      fragEmissive: `
        { float pl = dot(diffuseColor.rgb, vec3(0.3333));
          totalEmissiveRadiance += diffuseColor.rgb * smoothstep(0.30, 0.55, pl) * uNightR * 0.22; }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = !!q.shadows; mesh.name = "asphalt";
    group.add(mesh);
  }

  // ---------------------------------------------------------------------------------
  // shoulder skirts (hide the step down to the terrain)
  // ---------------------------------------------------------------------------------
  {
    const DROP = 0.7, pos = [], nor = [], idx = [];
    for (const sgn of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const f = frame[colIdx(i)];
        const lw = Math.min(RW, info.innerLimit(i, sgn, 0.9)) * sgn;
        const x = f.pos.x + f.l.x * lw, z = f.pos.z + f.l.z * lw, y = f.pos.y + Y0;
        pos.push(x, y, z, x, y - DROP, z);
        nor.push(f.l.x * sgn, 0, f.l.z * sgn, f.l.x * sgn, 0, f.l.z * sgn);
        if (i < n) { const a = base + i * 2; if (sgn > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx); geo.computeBoundingSphere();
    const mat = VR.reg(new THREE.MeshStandardMaterial({ color: VR.lin(0x6b6a66), roughness: 1, metalness: 0 }), 0.6);
    group.add(new THREE.Mesh(geo, mat));
  }

  // ---------------------------------------------------------------------------------
  // kerbs on the inside of corners
  // ---------------------------------------------------------------------------------
  {
    const kt = VR.tex.kerb();
    const pos = [], nor = [], uv = [], idx = [];
    const K0 = 15.9, K1 = 17.45, THR = 0.0042;
    for (const sgn of [1, -1]) {
      const flag = new Uint8Array(n);
      for (let i = 0; i < n; i++) flag[i] = sgn * info.kappa[i] > THR ? 1 : 0;
      // close short gaps, drop short runs (circular)
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) if (!flag[i]) {
        let a = 1, b = 1; while (a <= 5 && !flag[(i - a + n) % n]) a++; while (b <= 5 && !flag[(i + b) % n]) b++;
        if (a <= 5 && b <= 5 && a + b <= 7) flag[i] = 2;
      }
      let start = 0; for (let i = 0; i < n; i++) if (!flag[i]) { start = i; break; }
      let i = 0;
      while (i < n) {
        const idxI = (start + i) % n;
        if (flag[idxI]) {
          let j = i; while (j < n && flag[(start + j) % n]) j++;
          const len = j - i;
          if (len >= 5) {
            const i0 = start + i - 2, i1 = start + j + 2, base = pos.length / 3;
            let vAcc = 0;
            for (let k = i0; k <= i1; k++) {
              const f = frame[((k % n) + n) % n];
              const e = Math.min(1, Math.min(k - i0, i1 - k) / 3);          // taper in/out
              const w = (K1 - K0) * (0.35 + 0.65 * e);
              const lim = info.innerLimit(k, sgn, 0.9), k1 = Math.min(K1, lim), l0 = Math.min(K1 - w, lim * 0.9) * sgn, l1 = k1 * sgn;
              if (k > i0) vAcc += (info.segLen) / 4.8;
              for (const [lat, lift] of [[l0, 0.03], [l1, 0.07]]) {
                pos.push(f.pos.x + f.l.x * lat, f.pos.y + Y0 + lift, f.pos.z + f.l.z * lat);
                nor.push(f.up.x, f.up.y, f.up.z);
              }
              uv.push(0, vAcc, 1, vAcc);
              if (k < i1) { const a = base + (k - i0) * 2; if (sgn > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            }
          }
          i = j;
        } else i++;
      }
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ map: kt, roughness: 0.78, metalness: 0, envMapIntensity: 0.6 });
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      VR.reg(mat, 0.6);
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = !!q.shadows;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------------------------
  // concrete barriers with LED strip
  // ---------------------------------------------------------------------------------
  const PROFILE = [[-0.5, 0], [-0.5, 0.3], [-0.2, 0.96], [0.2, 0.96], [0.5, 0.3], [0.5, 0]];   // x outward, y up
  const profLen = []; let profTot = 0;
  for (let k = 0; k < PROFILE.length - 1; k++) { const d = Math.hypot(PROFILE[k + 1][0] - PROFILE[k][0], PROFILE[k + 1][1] - PROFILE[k][1]); profLen.push(d); profTot += d; }
  const profU = [0]; for (let k = 0; k < profLen.length; k++) profU.push(profU[k] + profLen[k] / profTot);

  const BTILE = 16, bTiles = Math.max(1, Math.round(total / BTILE));
  function barrierTextures() {
    const W = 256, H = 512, R = (() => { let s = 99; return () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 8 & 0xffff) / 65535; })();
    const c = VR.canvas(W, H), g = c.getContext("2d"), ce = VR.canvas(W, H), ge = ce.getContext("2d");
    const U = (u) => u * W;
    g.fillStyle = "#cfd1d2"; g.fillRect(0, 0, W, H);
    ge.fillStyle = "#000"; ge.fillRect(0, 0, W, H);
    // concrete mottling
    for (let i = 0; i < 380; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? "60,58,52" : "245,245,245"},${0.03 + R() * 0.05})`;
      const r = 4 + R() * 26; g.beginPath(); g.ellipse(R() * W, R() * H, r, r * (0.6 + R()), R() * 3, 0, 7); g.fill();
    }
    // top face slightly darker
    g.fillStyle = "rgba(60,62,66,0.18)"; g.fillRect(U(profU[2]), 0, U(profU[3] - profU[2]), H);
    // painted blocks on the inner slope: red / white every 4 units
    const a = U(profU[1]) + 2, b = U(profU[2]) - 2, bh = H / 4;
    for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? "#ececea" : "#c3202b"; g.fillRect(a, k * bh, b - a, bh); }
    // LED strip: dark slot + dashes (emissive map carries the dashes)
    const ls = a + (b - a) * 0.50, lw = (b - a) * 0.17;
    g.fillStyle = "#0d1014"; g.fillRect(ls, 0, lw, H);
    for (let k = 0; k < 8; k++) {
      const y = k * (H / 8) + 6, h = H / 8 - 12;
      g.fillStyle = "#bff0ff"; g.fillRect(ls + 2, y, lw - 4, h);
      ge.fillStyle = "#9fe6ff"; ge.fillRect(ls + 2, y, lw - 4, h);
    }
    // dirt toward the base, joints
    const gl = g.createLinearGradient(0, 0, W, 0);
    for (const [u, al] of [[0, 0.34], [0.1, 0.08], [0.9, 0.08], [1, 0.34]]) gl.addColorStop(u, `rgba(34,30,22,${al})`);
    g.fillStyle = gl; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(20,20,24,0.55)"; g.fillRect(0, 0, W, 3); g.fillRect(0, H / 2, W, 3);
    // grain
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const nz = (R() - 0.5) * 22; d[i] += nz; d[i + 1] += nz; d[i + 2] += nz; }
    g.putImageData(img, 0, 0);
    return { map: VR.tex.canvasTex(c), emissiveMap: VR.tex.canvasTex(ce) };
  }
  const bt = barrierTextures();
  const barrierMat = new THREE.MeshStandardMaterial({
    map: bt.map, emissiveMap: bt.emissiveMap, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0,
    roughness: 0.82, metalness: 0.0, envMapIntensity: 0.7,
  });
  VR.reg(barrierMat, 0.7);
  {
    const pos = [], nor = [], uv = [], idx = [];
    for (const sgn of [1, -1]) {
      // pick the winding by testing one quad's geometric normal against its intended normal
      let flip = null;
      for (let k = 0; k < PROFILE.length - 1; k++) {
        const base = pos.length / 3;
        const [x0, y0] = PROFILE[k], [x1, y1] = PROFILE[k + 1];
        const dx = x1 - x0, dy = y1 - y0, pl = Math.hypot(dx, dy);
        const nxp = -dy / pl, nyp = dx / pl;                         // outward normal in profile plane
        for (let i = 0; i <= n; i++) {
          const f = frame[colIdx(i)], v = (dist[i] / total) * bTiles;
          for (const [px, py, u] of [[x0, y0, profU[k]], [x1, y1, profU[k + 1]]]) {
            const lat = sgn * (Math.min(VR.BARRIER_LAT, info.innerLimit(i, sgn, 0.95) - 0.6) + px);
            pos.push(f.pos.x + f.l.x * lat, f.pos.y + Y0 + py, f.pos.z + f.l.z * lat);
            const ws = sgn * nxp;
            nor.push(f.l.x * ws + f.up.x * nyp, f.up.y * nyp + f.l.y * ws, f.l.z * ws + f.up.z * nyp);
            uv.push(u, v);
          }
        }
        if (flip === null) {
          const A = new THREE.Vector3(pos[base * 3], pos[base * 3 + 1], pos[base * 3 + 2]);
          const B = new THREE.Vector3(pos[(base + 1) * 3], pos[(base + 1) * 3 + 1], pos[(base + 1) * 3 + 2]);
          const C = new THREE.Vector3(pos[(base + 2) * 3], pos[(base + 2) * 3 + 1], pos[(base + 2) * 3 + 2]);
          const gn = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
          const wn = new THREE.Vector3(nor[base * 3], nor[base * 3 + 1], nor[base * 3 + 2]);
          flip = gn.dot(wn) < 0;
        }
        for (let i = 0; i < n; i++) {
          const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
          if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, barrierMat);
    mesh.castShadow = !!q.shadows; mesh.receiveShadow = !!q.shadows; mesh.name = "barrier";
    group.add(mesh);
  }

  return {
    group, frame, barrierMat,
    /** night: 0..1 → LED strips glow */
    update(night) { barrierMat.emissiveIntensity = night * 1.9; },
  };
};
