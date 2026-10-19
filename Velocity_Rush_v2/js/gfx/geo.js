"use strict";
/* ============================================================================
   Geometry helpers: merge, lofted surfaces (cars), simple instancing utilities.
   ========================================================================== */
VR.geo = {};

/** Merge indexed/non-indexed BufferGeometries that share position/normal/uv layout. */
VR.geo.merge = function mergeGeometries(list, withUV = true) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = withUV ? new Float32Array(nv * 2) : null;
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (uv && t) uv.set(t.array, vo * 2);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < p.count; i++) idx[io + i] = vo + i; io += p.count; }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
};

/** Smooth interpolation through keyed rows (Catmull-Rom on each column). keys: [[t, a, b, ...], ...] ascending in t. */
VR.geo.keyed = function keyed(keys, t) {
  const n = keys.length;
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  const u = VR.saturate((t - k1[0]) / (k2[0] - k1[0] || 1));
  const out = [t];
  for (let c = 1; c < k1.length; c++) {
    const p0 = k0[c], p1 = k1[c], p2 = k2[c], p3 = k3[c];
    out.push(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u));
  }
  return out;
};

/**
 * Loft a closed super-elliptic cross-section along Z.
 * stations: [{ z, w, y0, y1, n1, n2, cx }]. u runs around the section starting at the right side (u=0.25 = top centre),
 * v runs along z (0 at first station, 1 at last).
 */
VR.geo.loft = function loft(stations, ring) {
  const M = stations.length, R = ring, W = R + 1;
  const pos = new Float32Array(M * W * 3), nor = new Float32Array(M * W * 3), uv = new Float32Array(M * W * 2);
  const sp = (a, e) => Math.sign(a) * Math.pow(Math.abs(a), e);
  for (let i = 0; i < M; i++) {
    const s = stations[i];
    const ym = (s.y0 + s.y1) / 2, hh = (s.y1 - s.y0) / 2;
    for (let k = 0; k <= R; k++) {
      const th = (k / R) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const o = (i * W + k) * 3;
      pos[o] = (s.cx || 0) + s.w * sp(c, 2 / s.n1);
      pos[o + 1] = ym + hh * sp(sn, 2 / s.n2);
      pos[o + 2] = s.z;
      uv[(i * W + k) * 2] = k / R; uv[(i * W + k) * 2 + 1] = i / (M - 1);
    }
  }
  // analytic-ish normals from neighbours (wrap around the ring so the seam is smooth)
  const P = (i, k) => { const kk = ((k % R) + R) % R, o = (i * W + kk) * 3; return [pos[o], pos[o + 1], pos[o + 2]]; };
  for (let i = 0; i < M; i++) for (let k = 0; k <= R; k++) {
    const a = P(i, k + 1), b = P(i, k - 1), c = P(Math.min(M - 1, i + 1), k), d = P(Math.max(0, i - 1), k);
    const t1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], t2 = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    let nx = t2[1] * t1[2] - t2[2] * t1[1], ny = t2[2] * t1[0] - t2[0] * t1[2], nz = t2[0] * t1[1] - t2[1] * t1[0];
    let l = Math.hypot(nx, ny, nz);
    const o = (i * W + k) * 3;
    if (l < 1e-9) { nx = 0; ny = 0; nz = i === 0 ? -1 : 1; l = 1; }
    // orient outward
    const s = stations[i], ox = pos[o] - (s.cx || 0), oy = pos[o + 1] - (s.y0 + s.y1) / 2;
    const sgn = (nx * ox + ny * oy) < 0 ? -1 : 1;
    nor[o] = (nx / l) * sgn; nor[o + 1] = (ny / l) * sgn; nor[o + 2] = (nz / l) * sgn;
    if (l >= 1e-9 && Math.abs(ox) + Math.abs(oy) < 1e-6) { nor[o] = 0; nor[o + 1] = 0; nor[o + 2] = i === 0 ? -1 : 1; }
  }
  // end poles: fall back to axial normals when the ring collapsed
  for (const i of [0, M - 1]) {
    const s = stations[i];
    if (s.w < 0.02 && (s.y1 - s.y0) < 0.02) for (let k = 0; k <= R; k++) { const o = (i * W + k) * 3; nor[o] = 0; nor[o + 1] = 0; nor[o + 2] = i === 0 ? -1 : 1; }
  }
  const idx = [];
  for (let i = 0; i < M - 1; i++) for (let k = 0; k < R; k++) {
    const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  // verify winding against the normal of one mid-station triangle; flip if needed
  {
    const i = Math.floor(M / 2), k = Math.floor(R / 8);
    const a = (i * W + k), c = a + W, b = a + 1;
    const A = new THREE.Vector3().fromArray(pos, a * 3), B = new THREE.Vector3().fromArray(pos, c * 3), C = new THREE.Vector3().fromArray(pos, b * 3);
    const gn = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
    const wn = new THREE.Vector3().fromArray(nor, a * 3);
    if (gn.dot(wn) < 0) { const arr = g.index.array; for (let t = 0; t < arr.length; t += 3) { const tmp = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = tmp; } }
  }
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
};

/** Raycast helper: first hit of `mesh` along (origin, dir) in the mesh's local space. */
VR.geo.probe = (function () {
  const rc = new THREE.Raycaster();
  return function probe(mesh, origin, dir) {
    mesh.updateMatrixWorld(true);
    rc.set(origin, dir.clone().normalize());
    rc.far = 20;
    const hit = rc.intersectObject(mesh, false)[0];
    if (!hit) return null;
    const n = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
    return { point: hit.point.clone(), normal: n };
  };
})();
