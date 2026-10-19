"use strict";
/* ============================================================================
   Effects: soft-sprite particle pools (smoke / sparks / glow), skid marks,
   nitro bottles with light beams, and a pickup burst.
   ========================================================================== */

/** Ring-buffer particle pool rendered as THREE.Points with a soft round sprite shader. */
VR.ParticlePool = class ParticlePool {
  constructor(max, { additive = false, soft = 1.4 } = {}) {
    this.max = max; this.head = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max).fill(1);
    this.a0 = new Float32Array(max); this.s0 = new Float32Array(max); this.grow = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.rgb = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aCol = new THREE.BufferAttribute(this.col, 4); this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aCol.setUsage(THREE.DynamicDrawUsage); this.aSize.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.aPos); g.setAttribute("aCol", this.aCol); g.setAttribute("aSize", this.aSize);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uScale: { value: 600 }, uSoft: { value: soft }, uLight: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float aSize; attribute vec4 aCol; uniform float uScale; varying vec4 vCol;
        void main() {
          vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 220.0);
        }`,
      fragmentShader: `
        varying vec4 vCol; uniform float uSoft; uniform vec3 uLight;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
          if (d > 1.0 || vCol.a < 0.002) discard;
          float a = pow(1.0 - d, uSoft);
          gl_FragColor = vec4(vCol.rgb * uLight, vCol.a * a);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 20 : 15;
    this.additive = additive;
  }
  emit(x, y, z, vx, vy, vz, size, life, r, g, b, alpha, grow = 0, drag = 0, grav = 0) {
    const i = this.head; this.head = (i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.s0[i] = size; this.size[i] = size; this.life[i] = life; this.age[i] = 0; this.a0[i] = alpha;
    this.rgb[i * 3] = r; this.rgb[i * 3 + 1] = g; this.rgb[i * 3 + 2] = b;
    this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      const age = this.age[i];
      if (age >= this.life[i]) { if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0; continue; }
      const a = age + dt; this.age[i] = a;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = a / this.life[i];
      this.size[i] = this.s0[i] + this.grow[i] * a;
      const fade = this.additive ? (1 - t) * (1 - t) : Math.min(1, t * 8) * (1 - t);
      this.col[i * 4] = this.rgb[i * 3]; this.col[i * 4 + 1] = this.rgb[i * 3 + 1]; this.col[i * 4 + 2] = this.rgb[i * 3 + 2];
      this.col[i * 4 + 3] = this.a0[i] * fade;
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
  }
  setScale(heightPx, fovDeg) { this.uniforms.uScale.value = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360)); }
};

/** Tyre skid marks: ring-buffered ribbon quads laid on the road. */
VR.Skids = class Skids {
  constructor(trails = 4, perTrail = 380) {
    this.T = trails; this.N = perTrail;
    const nq = trails * perTrail;
    this.pos = new Float32Array(nq * 4 * 3); this.alpha = new Float32Array(nq * 4);
    this.head = new Int32Array(trails); this.last = [];
    for (let t = 0; t < trails; t++) this.last.push(null);
    const idx = new Uint32Array(nq * 6);
    for (let q = 0; q < nq; q++) { const v = q * 4, o = q * 6; idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], o); }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aA = new THREE.BufferAttribute(this.alpha, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aA.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.aPos); g.setAttribute("aAlpha", this.aA); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: "attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `varying float vA;
      void main() {
        gl_FragColor = vec4(vec3(0.01), vA);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.dirty = false;
  }
  /** Add a point to trail `t` at world (x,y,z); right = unit lateral vector; intensity 0..1 (0 breaks the trail). */
  add(t, x, y, z, rx, rz, intensity, width = 0.17) {
    if (intensity < 0.08) { this.last[t] = null; return; }
    const l = this.last[t];
    if (l) {
      const dx = x - l.x, dz = z - l.z;
      if (dx * dx + dz * dz < 0.12) return;
      if (dx * dx + dz * dz > 25) { this.last[t] = null; }
    }
    const cur = { x, y, z, lx: x - rx * width, lz: z - rz * width, rx: x + rx * width, rz: z + rz * width, a: intensity };
    if (this.last[t]) {
      const p = this.last[t], q = (t * this.N + this.head[t]) * 4; this.head[t] = (this.head[t] + 1) % this.N;
      const P = this.pos, A = this.alpha;
      const set = (k, px, py, pz, a) => { P[(q + k) * 3] = px; P[(q + k) * 3 + 1] = py; P[(q + k) * 3 + 2] = pz; A[q + k] = a; };
      const a0 = p.a * 0.5, a1 = cur.a * 0.5;
      set(0, p.lx, p.y + 0.03, p.lz, a0); set(1, p.rx, p.y + 0.03, p.rz, a0); set(2, cur.lx, y + 0.03, cur.lz, a1); set(3, cur.rx, y + 0.03, cur.rz, a1);
      this.dirty = true;
    }
    this.last[t] = cur;
  }
  update() { if (this.dirty) { this.aPos.needsUpdate = true; this.aA.needsUpdate = true; this.dirty = false; } }
  clear() { this.alpha.fill(0); this.aA.needsUpdate = true; this.last.fill(null); }
};

/** Nitro pickups: a glass-and-chrome canister with a glowing core, a ground ring and a light beam. */
VR.buildNitroBottles = function buildNitroBottles(track, rng) {
  const L = VR.lin, S = track.samples, n = S.length;
  const group = new THREE.Group(); group.name = "bottles";
  const bodyG = (() => { const pts = [], R = 0.28, H = 0.31; for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * R, -H - Math.cos(a) * R)); } for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * R, H + Math.sin(a) * R)); } return new THREE.LatheGeometry(pts, 20); })();
  const capG = new THREE.CylinderGeometry(0.16, 0.2, 0.16, 14), valveG = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8);
  const bandG = new THREE.CylinderGeometry(0.292, 0.292, 0.2, 18, 1, true);
  const glass = new THREE.MeshPhysicalMaterial({ color: L(0x2a7bff), emissive: L(0x1f6bff), emissiveIntensity: 1.5, roughness: 0.12, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.9, envMapIntensity: 1.2 });
  const chrome = new THREE.MeshStandardMaterial({ color: L(0xdadde2), roughness: 0.15, metalness: 1, envMapIntensity: 1.3 });
  const band = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 0.5), side: THREE.DoubleSide });
  const beamTex = (() => { const c = VR.canvas(8, 128), g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.7, "rgba(255,255,255,0.4)"); gr.addColorStop(1, "rgba(255,255,255,0.95)"); g.fillStyle = gr; g.fillRect(0, 0, 8, 128); return VR.tex.canvasTex(c, { srgb: false, repeat: false, aniso: false }); })();
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(0.35, 0.75, 1.5), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const beamG = new THREE.CylinderGeometry(0.5, 0.9, 16, 14, 1, true); beamG.translate(0, 8 - 1.2, 0);
  const ringTex = (() => { const c = VR.canvas(128, 128), g = c.getContext("2d"); const gr = g.createRadialGradient(64, 64, 20, 64, 64, 62); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.55, "rgba(255,255,255,0.9)"); gr.addColorStop(0.7, "rgba(255,255,255,0.25)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return VR.tex.canvasTex(c, { srgb: false, repeat: false, aniso: false }); })();
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, color: new THREE.Color(0.4, 0.85, 1.6), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const ringG = new THREE.PlaneGeometry(3.6, 3.6); ringG.rotateX(-Math.PI / 2);
  const bottles = [];
  const count = 18, used = new Set();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < 400) {
    const zone = placed / count;
    let idx = Math.floor((zone + (rng() - 0.5) * 0.4) * n);
    idx = ((idx % n) + n) % n;
    if (used.has(idx)) idx = (idx + 7) % n;
    used.add(idx);
    const s = S[idx];
    if (s.biome === "water") { placed++; continue; }
    const side = (rng() < 0.5 ? 1 : -1) * (0.2 + rng() * 0.55) * track.roadWidth / 2;
    const p = s.pos.clone().addScaledVector(s.normal, side); p.y += 1.2;
    const holder = new THREE.Group(); holder.position.copy(p);
    const body = new THREE.Group();
    const m = new THREE.Mesh(bodyG, glass); body.add(m);
    const top = new THREE.Mesh(capG, chrome); top.position.y = 0.6; body.add(top);
    const valve = new THREE.Mesh(valveG, chrome); valve.position.y = 0.75; body.add(valve);
    const bot = new THREE.Mesh(capG, chrome); bot.position.y = -0.6; bot.rotation.x = Math.PI; body.add(bot);
    const bnd = new THREE.Mesh(bandG, band); body.add(bnd);
    body.rotation.z = 0.25;
    holder.add(body);
    const beam = new THREE.Mesh(beamG, beamMat); beam.renderOrder = 3; holder.add(beam);
    const ring = new THREE.Mesh(ringG, ringMat); ring.position.y = -1.14; ring.renderOrder = 3; holder.add(ring);
    group.add(holder);
    bottles.push({ mesh: holder, body, ring, pos: p, taken: false, idx, phase: rng() * 6.28 });
    placed++;
  }
  return { group, bottles, update(dt, t) { for (const b of bottles) { if (b.taken) continue; b.body.rotation.y += dt * 2.2; b.body.position.y = Math.sin(t * 2 + b.phase) * 0.14; b.ring.rotation.y += dt * 0.8; } } };
};
