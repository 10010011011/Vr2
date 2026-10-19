"use strict";
/* ============================================================================
   Velocity Rush — core utilities
   Global namespace `VR` holds every new module so classic <script> loading works
   inside Android WebViews (no ES-module CORS problems on file://).
   ========================================================================== */
const VR = (window.VR = window.VR || {});

VR.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
VR.lerp = (a, b, t) => a + (b - a) * t;
VR.saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
VR.smoothstep = (a, b, x) => {
  const t = VR.saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing. */
VR.damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));
VR.mix = VR.lerp;

/* ---------- value noise (deterministic, seedable) ---------- */
VR.hash2 = (ix, iy, seed = 0) => {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
};
VR.vnoise = (x, y, seed = 0) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = VR.hash2(ix, iy, seed), b = VR.hash2(ix + 1, iy, seed);
  const c = VR.hash2(ix, iy + 1, seed), d = VR.hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};
VR.fbm = (x, y, oct = 5, seed = 0) => {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * VR.vnoise(x * f, y * f, seed + i * 17);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
};
VR.ridged = (x, y, oct = 5, seed = 0) => {
  let v = 0, amp = 0.5, f = 1, norm = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(VR.vnoise(x * f, y * f, seed + i * 31) * 2 - 1);
    n *= n; n *= w; w = VR.saturate(n * 1.6);
    v += n * amp; norm += amp; amp *= 0.5; f *= 2.1;
  }
  return v / norm;
};
/** Periodic (tileable) value noise; period is in lattice cells. */
VR.pnoise = (x, y, px, py, seed = 0) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = (v, p) => ((v % p) + p) % p;
  const x0 = m(ix, px), x1 = m(ix + 1, px), y0 = m(iy, py), y1 = m(iy + 1, py);
  const a = VR.hash2(x0, y0, seed), b = VR.hash2(x1, y0, seed);
  const c = VR.hash2(x0, y1, seed), d = VR.hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

/* ---------- colour helpers (author in sRGB, shade in linear) ---------- */
VR.lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
VR.linRGB = (hex) => {
  const c = VR.lin(hex);
  return [c.r, c.g, c.b];
};

/* ---------- misc ---------- */
VR.isMobile = () => /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "") || (navigator.maxTouchPoints || 0) > 1;

/** Create an offscreen 2D canvas. */
VR.canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
};

/** Yield to the browser so overlays can paint between heavy build steps. */
VR.nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Merge a list of { geometry, matrix? } into one BufferGeometry (position/normal/uv/color). */
VR.mergeGeometries = (parts) => {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2), col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const p of parts) {
    const g = p.geometry, m = p.matrix || null;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color;
    if (m) nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (m) v.applyMatrix4(m);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      if (N) {
        n.fromBufferAttribute(N, i);
        if (m) n.applyMatrix3(nm).normalize();
        nor[(vo + i) * 3] = n.x; nor[(vo + i) * 3 + 1] = n.y; nor[(vo + i) * 3 + 2] = n.z;
      }
      if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
      if (C) {
        col[(vo + i) * 3] = C.getX(i); col[(vo + i) * 3 + 1] = C.getY(i); col[(vo + i) * 3 + 2] = C.getZ(i);
      } else if (p.color) {
        col[(vo + i) * 3] = p.color.r; col[(vo + i) * 3 + 1] = p.color.g; col[(vo + i) * 3 + 2] = p.color.b;
      } else {
        col[(vo + i) * 3] = col[(vo + i) * 3 + 1] = col[(vo + i) * 3 + 2] = 1;
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = i + vo;
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
};

/** Frustum-friendly bounding sphere for instanced chunks. */
VR.setBounds = (geometry, center, radius) => {
  geometry.boundingSphere = new THREE.Sphere(center.clone(), radius);
  geometry.boundingBox = null;
};

/** Let the browser paint (progress UI) between heavy build steps. */
VR.yieldFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
VR.angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
