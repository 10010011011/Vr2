"use strict";
/* ============================================================================
   TrackInfo — derived data & fast spatial queries over the generated track.
   (The track itself, from generateTrack(), is left untouched.)
   ========================================================================== */
VR.BIOMES = ["plains", "forest", "mountain", "cliff", "cliffside", "water", "tunnel"];

VR.TrackInfo = class TrackInfo {
  constructor(track) {
    this.track = track;
    const S = (this.samples = track.samples);
    const n = (this.n = S.length);
    this.half = track.roadWidth / 2;

    // cumulative distance along the loop
    this.dist = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) this.dist[i + 1] = this.dist[i] + S[i].pos.distanceTo(S[(i + 1) % n].pos);
    this.length = this.dist[n];
    this.segLen = this.length / n;

    // signed curvature (+ = turning toward +normal, i.e. left) per sample
    this.kappa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = S[(i - 2 + n) % n].tangent, b = S[(i + 2) % n].tangent;
      const cross = a.z * b.x - a.x * b.z;           // y-component of a × b
      const ang = Math.asin(VR.clamp(cross, -1, 1));
      this.kappa[i] = ang / (4 * this.segLen);        // radians per unit length
    }
    // smoothed absolute curvature (for sign placement etc.)
    this.absK = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0; for (let k = -3; k <= 3; k++) s += Math.abs(this.kappa[(i + k + n) % n]);
      this.absK[i] = s / 7;
    }

    // signed curvature, lightly smoothed (used to keep inner-bend offsets from folding over themselves)
    this.kappaS = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0; for (let k = -3; k <= 3; k++) s += this.kappa[(i + k + n) % n];
      this.kappaS[i] = s / 7;
    }

    // biome one-hot → gaussian-smoothed weights
    const nb = VR.BIOMES.length;
    this.biomeIdx = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.biomeIdx[i] = VR.BIOMES.indexOf(S[i].biome);
    this.w = new Float32Array(n * nb);
    const sigma = 9, R = 27;
    for (let i = 0; i < n; i++) {
      let tot = 0;
      for (let k = -R; k <= R; k++) {
        const g = Math.exp(-(k * k) / (2 * sigma * sigma));
        this.w[i * nb + this.biomeIdx[(i + k + n) % n]] += g; tot += g;
      }
      for (let b = 0; b < nb; b++) this.w[i * nb + b] /= tot;
    }

    // contiguous runs of a biome (for tunnels / bridges)
    this.runs = { tunnel: this._runs("tunnel"), water: this._runs("water") };

    // spatial grid (cell = 64u)
    this.cell = 64;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const p = S[i].pos;
      const key = Math.floor(p.x / this.cell) + "," + Math.floor(p.z / this.cell);
      let arr = this.grid.get(key); if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    }
    // coarse subset for IDW height reference
    this.idwIdx = [];
    for (let i = 0; i < n; i += 6) this.idwIdx.push(i);

    // bounds
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const s of S) { minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z); }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  _runs(biome) {
    const n = this.n, S = this.samples, runs = [];
    // find a start index that is not inside a run to handle wrap-around
    let start = 0;
    for (let i = 0; i < n; i++) if (S[i].biome !== biome) { start = i; break; }
    let i = 0;
    while (i < n) {
      const idx = (start + i) % n;
      if (S[idx].biome === biome) {
        let j = i; while (j < n && S[(start + j) % n].biome === biome) j++;
        runs.push({ i0: idx, count: j - i });
        i = j;
      } else i++;
    }
    return runs;
  }

  wrap(i) { const n = this.n; return ((i % n) + n) % n; }

  /** Nearest point on the track centre-line. Writes into `out` (allocated if omitted). */
  nearest(x, z, out) {
    out = out || {};
    const S = this.samples, n = this.n, cs = this.cell;
    const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
    let best = -1, bestD = Infinity;
    for (let r = 1; r < 40; r++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (r > 1 && Math.abs(i) < r && Math.abs(j) < r) continue; // ring only
        const arr = this.grid.get((cx + i) + "," + (cz + j));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const p = S[arr[k]].pos, dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
          if (d2 < bestD) { bestD = d2; best = arr[k]; }
        }
      }
      if (best >= 0 && Math.sqrt(bestD) <= (r - 0.2) * cs) break;
    }
    return this._refine(best, bestD, x, z, out);
  }

  /** Cheap brute-force nearest (stride 3) for far-field terrain; same output as nearest(). */
  nearestFar(x, z, out) {
    out = out || {};
    const S = this.samples, n = this.n;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i += 3) {
      const p = S[i].pos, dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    for (let k = -3; k <= 3; k++) {
      const i = (best + k + n) % n, p = S[i].pos, dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    return this._refine(best, bestD, x, z, out);
  }

  _refine(best, bestD, x, z, out) {
    const S = this.samples, n = this.n;
    // refine on the two adjacent segments
    let bi = best, bu = 0, bd2 = bestD;
    for (const a of [(best - 1 + n) % n, best]) {
      const p0 = S[a].pos, p1 = S[(a + 1) % n].pos;
      const sx = p1.x - p0.x, sz = p1.z - p0.z, l2 = sx * sx + sz * sz || 1;
      const u = VR.saturate(((x - p0.x) * sx + (z - p0.z) * sz) / l2);
      const qx = p0.x + sx * u - x, qz = p0.z + sz * u - z, d2 = qx * qx + qz * qz;
      if (d2 <= bd2) { bd2 = d2; bi = a; bu = u; }
    }
    const a = S[bi], b = S[(bi + 1) % n];
    out.idx = bi; out.u = bu; out.d = Math.sqrt(bd2);
    out.y = a.pos.y + (b.pos.y - a.pos.y) * bu;
    const px = a.pos.x + (b.pos.x - a.pos.x) * bu, pz = a.pos.z + (b.pos.z - a.pos.z) * bu;
    let nx = a.normal.x + (b.normal.x - a.normal.x) * bu, nz = a.normal.z + (b.normal.z - a.normal.z) * bu;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    out.nx = nx; out.nz = nz;
    out.lat = (x - px) * nx + (z - pz) * nz;       // signed lateral offset (+ = left)
    out.px = px; out.pz = pz;
    return out;
  }

  /**
   * Lowest road surface height seen from (x,z): min over road samples of (y + grade-out beyond R0).
   * Keeps terrain beneath every stretch of road that passes close to a point (hairpin interiors).
   */
  envelope(x, z, y0, R0, reach) {
    const S = this.samples, cs = this.cell, r2 = reach * reach;
    const ax = Math.floor((x - reach) / cs), bx = Math.floor((x + reach) / cs);
    const az = Math.floor((z - reach) / cs), bz = Math.floor((z + reach) / cs);
    let best = y0;
    for (let cz = az; cz <= bz; cz++) for (let cx = ax; cx <= bx; cx++) {
      const arr = this.grid.get(cx + "," + cz);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const p = S[arr[k]].pos, dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2), y = p.y + (d > R0 ? d - R0 : 0);
        if (y < best) best = y;
      }
    }
    return best;
  }

  /** Max lateral offset (>0) that stays clear of the centre of curvature on the inside of a bend at sample i. */
  innerLimit(i, side, frac) {
    const k = this.kappaS[((i % this.n) + this.n) % this.n] * side;
    return k > 1e-5 ? frac / k : 1e9;
  }

  /** Biome weights interpolated at a nearest() result (Float32Array of 7). */
  weights(t, out) {
    const nb = VR.BIOMES.length, a = t.idx * nb, b = ((t.idx + 1) % this.n) * nb;
    out = out || new Float32Array(nb);
    for (let k = 0; k < nb; k++) out[k] = this.w[a + k] + (this.w[b + k] - this.w[a + k]) * t.u;
    return out;
  }

  /** Inverse-distance-weighted road height — a smooth far-field reference. */
  idwHeight(x, z) {
    let sw = 0, sy = 0; const S = this.samples;
    for (const i of this.idwIdx) {
      const p = S[i].pos, dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz + 900;
      const w = 1 / (d2 * Math.sqrt(d2));
      sw += w; sy += w * p.y;
    }
    return sy / sw;
  }
};
