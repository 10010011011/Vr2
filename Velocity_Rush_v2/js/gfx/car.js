"use strict";
/* ============================================================================
   Procedural hyper-coupe: lofted body + glasshouse, carbon aero, sculpted wheels,
   clear-coat paint, LED lighting, nitro flames, suspension motion.
   Origin sits on the ground between the wheels; +Z is forward.
   ========================================================================== */
VR.CAR_PRESETS = [
  { id: "arctic",  name: "Arctic",  body: 0xeef1f4, trim: 0xe63030, accent: 0xe63030 },
  { id: "crimson", name: "Crimson", body: 0xc4161c, trim: 0x15161a, accent: 0xe8e8e8 },
  { id: "cobalt",  name: "Cobalt",  body: 0x1f4fd8, trim: 0xf2f4f8, accent: 0x32d0ff },
  { id: "solar",   name: "Solar",   body: 0xf0b400, trim: 0x15161a, accent: 0x15161a },
  { id: "jade",    name: "Jade",    body: 0x12a083, trim: 0xf2f4f8, accent: 0xf2f4f8 },
  { id: "night",   name: "Obsidian", body: 0x14161b, trim: 0xe63030, accent: 0xff4a3a },
];

VR.carShared = (() => {
  let S = null;
  return function () {
    if (S) return S;
    const L = VR.lin;
    // woven carbon
    const c = VR.canvas(64, 64), g = c.getContext("2d");
    g.fillStyle = "#101114"; g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const on = (x + y) % 2 === 0;
      const gr = g.createLinearGradient(x * 8, y * 8, on ? x * 8 + 8 : x * 8, on ? y * 8 : y * 8 + 8);
      gr.addColorStop(0, "#2a2c31"); gr.addColorStop(1, "#0a0b0d");
      g.fillStyle = gr; g.fillRect(x * 8 + 0.5, y * 8 + 0.5, 7, 7);
    }
    const carbonTex = VR.tex.canvasTex(c);
    const carbon = VR.reg(new THREE.MeshPhysicalMaterial({ map: carbonTex, roughness: 0.38, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.9 }), 0.9);
    const rubber = VR.reg(new THREE.MeshStandardMaterial({ color: L(0x16171a), roughness: 0.92, metalness: 0, envMapIntensity: 0.35 }), 0.35);
    const rim = VR.reg(new THREE.MeshStandardMaterial({ color: L(0xc9cdd3), roughness: 0.22, metalness: 1.0, envMapIntensity: 1.2 }), 1.2);
    const rimDark = VR.reg(new THREE.MeshStandardMaterial({ color: L(0x2a2d33), roughness: 0.4, metalness: 0.9, envMapIntensity: 1.0 }), 1.0);
    const disc = VR.reg(new THREE.MeshStandardMaterial({ color: L(0x6d7076), roughness: 0.45, metalness: 1.0, envMapIntensity: 0.8 }), 0.8);
    const liner = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const black = VR.reg(new THREE.MeshStandardMaterial({ color: L(0x0b0c0e), roughness: 0.6, metalness: 0.2, envMapIntensity: 0.5 }), 0.5);
    const chrome = VR.reg(new THREE.MeshStandardMaterial({ color: L(0xdadde2), roughness: 0.12, metalness: 1.0, envMapIntensity: 1.3 }), 1.3);
    const lampOff = VR.reg(new THREE.MeshStandardMaterial({ color: L(0x0c1016), roughness: 0.15, metalness: 0.4, envMapIntensity: 1.2 }), 1.2);
    S = { carbon, rubber, rim, rimDark, disc, liner, black, chrome, lampOff };
    return S;
  };
})();

/** Wheel model for the +X side (outer face toward +X). Returns { spin, brake }. */
function vrBuildWheel(shared) {
  const R = 0.42;
  // tyre: lathe profile (radius, axial)
  const prof = [[0.285, -0.16], [0.34, -0.168], [0.39, -0.15], [0.412, -0.1], [0.42, -0.04], [0.42, 0.04], [0.412, 0.1], [0.39, 0.15], [0.34, 0.168], [0.285, 0.16]].map(([r, y]) => new THREE.Vector2(r, y));
  const tg = new THREE.LatheGeometry(prof, 36); tg.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tg, shared.rubber);
  // rim barrel + lip
  const bp = [[0.275, -0.15], [0.3, -0.158], [0.31, -0.13], [0.3, -0.09], [0.285, 0.0], [0.285, 0.12], [0.31, 0.152], [0.32, 0.17]].map(([r, y]) => new THREE.Vector2(r, y));
  const bg = new THREE.LatheGeometry(bp, 32); bg.rotateZ(Math.PI / 2);
  const barrel = new THREE.Mesh(bg, shared.rimDark);
  // spokes (5, tapered, slightly dished)
  const spokes = [];
  const sh = new THREE.Shape();
  sh.moveTo(0.05, -0.034); sh.lineTo(0.30, -0.062); sh.lineTo(0.30, 0.062); sh.lineTo(0.05, 0.034); sh.closePath();
  const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 });
  for (let i = 0; i < 5; i++) {
    const g = sg.clone();
    g.rotateY(-Math.PI / 2);                       // extrusion → +X, spoke runs along +Z
    g.translate(0.095, 0, 0);
    g.rotateX((i / 5) * Math.PI * 2);
    spokes.push(g);
  }
  const hubG = new THREE.CylinderGeometry(0.085, 0.095, 0.1, 20); hubG.rotateZ(Math.PI / 2); hubG.translate(0.11, 0, 0);
  const capG = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16); capG.rotateZ(Math.PI / 2); capG.translate(0.172, 0, 0);
  const faceG = VR.geo.merge([...spokes.map((g) => { g.deleteAttribute("uv"); return g; }), hubG].map((g) => { const gg = g.index ? g : g; if (!gg.attributes.normal) gg.computeVertexNormals(); return gg; }), false);
  const face = new THREE.Mesh(faceG, shared.rim);
  const cap = new THREE.Mesh(capG, shared.chrome);
  // motion-blur disc (fades in at speed)
  const blurMat = new THREE.MeshStandardMaterial({ color: VR.lin(0x24262b), roughness: 0.7, metalness: 0.3, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const bd = new THREE.CircleGeometry(0.3, 24); bd.rotateY(Math.PI / 2); bd.translate(0.16, 0, 0);
  const blur = new THREE.Mesh(bd, blurMat);
  const spin = new THREE.Group();
  spin.add(tyre, barrel, face, cap, blur);
  // brake disc + caliper (do not spin)
  const brake = new THREE.Group();
  const dg = new THREE.CylinderGeometry(0.235, 0.235, 0.03, 28); dg.rotateZ(Math.PI / 2); dg.translate(0.03, 0, 0);
  brake.add(new THREE.Mesh(dg, shared.disc));
  return { spin, brake, blurMat, tyre };
}

VR.buildCar = function buildCar(opts) {
  opts = Object.assign({ body: 0xeef1f4, trim: 0xe63030, accent: 0xe63030, number: "1", spot: false, quality: "high" }, opts || {});
  const sh = VR.carShared();
  const L = VR.lin;
  const root = new THREE.Group(); root.name = "car";
  const inner = new THREE.Group(); inner.name = "carInner";
  root.add(inner);
  const chassis = new THREE.Group(); inner.add(chassis);

  const ZR = -2.35, ZF = 2.35, WZ = 1.52, WY = 0.42, WX = 0.91, ARCH = 0.495;

  // ------------------------------------------------------------------ body
  const bodyKeys = [
    [-2.35, 0.62, 0.40, 0.76, 2.6, 2.4], [-2.15, 0.88, 0.36, 0.90, 2.8, 2.5], [-1.80, 1.00, 0.32, 0.99, 3.0, 2.6],
    [-1.35, 1.07, 0.30, 1.00, 3.2, 2.7], [-0.60, 1.05, 0.27, 0.91, 3.2, 2.8], [0.20, 1.04, 0.26, 0.86, 3.2, 2.8],
    [0.90, 1.06, 0.27, 0.88, 3.2, 2.8], [1.50, 1.08, 0.26, 0.96, 3.1, 2.7], [1.95, 0.99, 0.23, 0.74, 2.9, 2.5],
    [2.25, 0.80, 0.21, 0.58, 2.6, 2.3], [2.35, 0.56, 0.22, 0.52, 2.4, 2.2],
  ];
  const stationsFrom = (keys, count, zA, zB, cap) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const u = (1 - Math.cos((i / (count - 1)) * Math.PI)) / 2;
      const z = zA + (zB - zA) * u;
      const k = VR.geo.keyed(keys, z);
      let c = 1; const dA = z - zA, dB = zB - z;
      if (dA < cap) c = Math.sqrt(Math.max(0, 1 - Math.pow(1 - dA / cap, 2)));
      if (dB < cap) c = Math.min(c, Math.sqrt(Math.max(0, 1 - Math.pow(1 - dB / cap, 2))));
      const ym = (k[2] + k[3]) / 2, hh = ((k[3] - k[2]) / 2) * c;
      out.push({ z, w: k[1] * c, y0: ym - hh, y1: ym + hh, n1: k[4], n2: k[5] });
    }
    return out;
  };
  const bodyGeo = VR.geo.loft(stationsFrom(bodyKeys, 64, ZR, ZF, 0.34), 44);

  const cabinKeys = [
    [1.02, 0.84, 0.70, 0.82, 2.4, 2.0], [0.70, 0.88, 0.70, 1.02, 2.4, 2.2], [0.30, 0.84, 0.70, 1.20, 2.5, 2.3],
    [-0.15, 0.80, 0.70, 1.27, 2.5, 2.4], [-0.70, 0.78, 0.70, 1.24, 2.5, 2.4], [-1.10, 0.84, 0.70, 1.08, 2.5, 2.3],
    [-1.55, 0.80, 0.70, 0.93, 2.4, 2.0],
  ];
  cabinKeys.reverse();
  const cabinGeo = VR.geo.loft(stationsFrom(cabinKeys, 40, -1.55, 1.02, 0.14), 36);

  const uBody = { value: L(opts.body) }, uTrim = { value: L(opts.trim) }, uAccent = { value: L(opts.accent) };
  const archGLSL = `
    vec2 a1 = vObj.zy - vec2(${WZ.toFixed(3)}, ${WY.toFixed(3)}), a2 = vObj.zy - vec2(${(-WZ).toFixed(3)}, ${WY.toFixed(3)});
    if (abs(vObj.x) > 0.42 && (dot(a1, a1) < ${(ARCH * ARCH).toFixed(4)} || dot(a2, a2) < ${(ARCH * ARCH).toFixed(4)})) discard;`;
  const liveryGLSL = `
    vec3 on = normalize(vObjN);
    float ax = abs(vObj.x);
    float upF = smoothstep(0.35, 0.6, on.y);
    float stripe = step(0.10, ax) * step(ax, 0.27) * upF;
    stripe = max(stripe, step(0.32, ax) * step(ax, 0.345) * upF);
    vec3 basePaint = mix(uBody, uTrim, stripe);
    float sideAcc = step(0.355, vObj.y) * step(vObj.y, 0.425) * smoothstep(0.55, 0.8, abs(on.x));
    basePaint = mix(basePaint, uAccent, sideAcc);
    basePaint *= mix(0.74, 1.0, smoothstep(0.28, 0.58, vObj.y));`;
  const common = {
    uniforms: { uBody, uTrim, uAccent },
    vertexDecl: "varying vec3 vObj; varying vec3 vObjN;",
    vertexMain: "vObj = position; vObjN = normal;",
    fragDecl: "varying vec3 vObj; varying vec3 vObjN; uniform vec3 uBody, uTrim, uAccent;",
  };
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.5, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.0, side: THREE.DoubleSide,
  });
  VR.patch(bodyMat, Object.assign({}, common, {
    key: "carbody",
    fragAfterColor: `{ ${archGLSL} ${liveryGLSL}
      diffuseColor.rgb = basePaint; if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.008); }`,
    fragRoughness: "if (!gl_FrontFacing) roughnessFactor = 1.0;",
  }));
  VR.reg(bodyMat, 1.0);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true; body.receiveShadow = false;
  chassis.add(body);

  const cabinMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.62, roughness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.5, side: THREE.DoubleSide,
  });
  VR.patch(cabinMat, Object.assign({}, common, {
    key: "carcabin",
    fragAfterColor: `
      ${liveryGLSL}
      float vrRoof = smoothstep(0.76, 0.86, on.y);
      float vrFront = step(0.22, on.z) * step(ax, 0.60);
      float vrRear = step(on.z, -0.22) * step(ax, 0.58);
      float vrSide = smoothstep(0.30, 0.46, abs(on.x)) * step(-1.02, vObj.z) * step(vObj.z, 0.50);
      float vrGlass = clamp(max(max(vrFront, vrRear), vrSide) * (1.0 - vrRoof) * step(0.74, vObj.y), 0.0, 1.0);
      diffuseColor.rgb = mix(basePaint, vec3(0.006, 0.010, 0.016), vrGlass);
      if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.008);`,
    fragRoughness: "roughnessFactor = mix(roughnessFactor, 0.035, vrGlass); if (!gl_FrontFacing) roughnessFactor = 1.0;",
    fragMetal: "metalnessFactor = mix(metalnessFactor, 0.0, vrGlass);",
  }));
  VR.reg(cabinMat, 1.5);
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.castShadow = true;
  chassis.add(cabin);

  // wheel-arch liners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = new THREE.CylinderGeometry(ARCH * 0.985, ARCH * 0.985, 0.7, 28, 1, true);
    g.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(g, sh.liner);
    m.position.set(sx * (0.42 + 0.35), WY, sz * WZ);
    chassis.add(m);
  }
  // underbody
  {
    const g = new THREE.BoxGeometry(1.7, 0.04, 4.0);
    const m = new THREE.Mesh(g, sh.black); m.position.set(0, 0.2, 0); chassis.add(m);
  }

  // ----------------------------------------------------------- surface details
  const Z = new THREE.Vector3(0, 0, 1);
  const stick = (geo, mat, ox, oy, oz, dx, dy, dz, off, extraRot) => {
    const hit = VR.geo.probe(body, new THREE.Vector3(ox, oy, oz), new THREE.Vector3(dx, dy, dz));
    if (!hit) return null;
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(hit.point).addScaledVector(hit.normal, off);
    m.quaternion.setFromUnitVectors(Z, hit.normal);
    if (extraRot) m.rotateZ(extraRot);
    chassis.add(m);
    return m;
  };
  // carbon aero
  {
    const split = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.035, 0.42), sh.carbon); split.position.set(0, 0.2, 2.2); chassis.add(split);
    for (const sx of [-1, 1]) {
      const cn = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.3), sh.carbon); cn.position.set(sx * 0.98, 0.28, 2.0); cn.rotation.y = sx * 0.16; chassis.add(cn);
      const sk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 1.5), sh.carbon); sk.position.set(sx * 1.05, 0.27, 0); chassis.add(sk);
    }
    // rear diffuser with fins
    const df = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.55), sh.carbon); df.position.set(0, 0.24, -2.15); df.rotation.x = 0.16; chassis.add(df);
    for (let i = -2; i <= 2; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.5), sh.carbon); f.position.set(i * 0.3, 0.31, -2.15); chassis.add(f); }
    // rear wing
    const wingMain = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.045, 0.52), sh.carbon);
    wingMain.position.set(0, 1.27, -2.12); wingMain.rotation.x = -0.1; chassis.add(wingMain);
    const wingFlap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.03, 0.2), sh.carbon);
    wingFlap.position.set(0, 1.33, -2.34); wingFlap.rotation.x = -0.45; chassis.add(wingFlap);
    for (const sx of [-1, 1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.66), sh.carbon); ep.position.set(sx * 1.0, 1.28, -2.18); chassis.add(ep);
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.12), sh.carbon); up.position.set(sx * 0.5, 1.07, -2.0); up.rotation.x = 0.1; chassis.add(up);
    }
  }
  // mirrors
  for (const sx of [-1, 1]) {
    const mg = new THREE.BoxGeometry(0.2, 0.11, 0.12);
    const m = new THREE.Mesh(mg, sh.carbon); m.position.set(sx * 0.95, 0.9, 0.62); m.rotation.y = -sx * 0.25; chassis.add(m);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), sh.black); arm.position.set(sx * 0.84, 0.86, 0.6); chassis.add(arm);
  }
  // intakes / grille / vents (dark shapes pressed on the nose and flanks)
  {
    const grille = new THREE.PlaneGeometry(0.62, 0.16);
    stick(grille, sh.black, 0.0, 0.34, 4, 0, 0, -1, 0.006);
    for (const sx of [-1, 1]) {
      stick(new THREE.PlaneGeometry(0.34, 0.12), sh.black, sx * 0.62, 0.32, 4, 0, 0, -1, 0.006);
      stick(new THREE.PlaneGeometry(0.5, 0.1), sh.black, sx * 3, 0.52, 0.55, -sx, 0, 0, 0.006);       // fender vent
    }
    // hood vents
    for (const sx of [-1, 1]) stick(new THREE.PlaneGeometry(0.2, 0.5), sh.black, sx * 0.5, 3, 1.55, 0, -1, 0, 0.005);
  }
  // lamps
  const headMat = new THREE.MeshStandardMaterial({ color: 0x111418, emissive: new THREE.Color(1.0, 0.97, 0.88), emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300508, emissive: new THREE.Color(1.0, 0.04, 0.05), emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.2 });
  const lampShape = (len, h) => { const s = new THREE.Shape(); s.moveTo(-len / 2, -h / 2); s.lineTo(len / 2, -h * 0.15); s.lineTo(len / 2, h / 2); s.lineTo(-len / 2, h * 0.28); s.closePath(); return new THREE.ShapeGeometry(s); };
  for (const sx of [-1, 1]) {
    const hg = lampShape(0.5, 0.1); if (sx < 0) hg.scale(-1, 1, 1);
    // housing
    stick(new THREE.PlaneGeometry(0.58, 0.17), sh.lampOff, sx * 0.72, 0.62, 4, -0.2 * sx, -0.05, -1, 0.004, sx * -0.18);
    stick(hg, headMat, sx * 0.72, 0.62, 4, -0.2 * sx, -0.05, -1, 0.012, sx * -0.18);
    // DRL accent
    stick(new THREE.PlaneGeometry(0.4, 0.02), headMat, sx * 0.68, 0.7, 4, -0.2 * sx, -0.05, -1, 0.014, sx * -0.18);
  }
  for (const sx of [-1, 1]) {
    stick(lampShape(0.5, 0.12), tailMat, sx * 0.66, 0.66, -4, 0.12 * sx, 0, 1, 0.01, 0);
  }
  stick(new THREE.PlaneGeometry(0.9, 0.035), tailMat, 0, 0.7, -4, 0, 0, 1, 0.012);
  // exhaust tips
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.2, 18, 1, true), sh.chrome); e.rotation.x = Math.PI / 2; e.position.set(sx * 0.34, 0.45, -2.36); e.material.side = THREE.DoubleSide; chassis.add(e);
    const ei = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), new THREE.MeshBasicMaterial({ color: 0x050505 })); ei.position.set(sx * 0.34, 0.45, -2.31); ei.rotation.y = Math.PI; chassis.add(ei);
  }
  // door roundels
  {
    const c = VR.canvas(128, 128), g = c.getContext("2d");
    g.fillStyle = "#f5f5f5"; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
    g.strokeStyle = "#" + new THREE.Color(opts.trim).getHexString(); g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.stroke();
    g.fillStyle = "#14151a"; g.font = "900 78px 'Saira Condensed', Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(opts.number, 64, 70);
    const t = VR.tex.canvasTex(c, { repeat: false });
    const dm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.1, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const sx of [-1, 1]) {
      const m = stick(new THREE.PlaneGeometry(0.42, 0.42), dm, sx * 3, 0.62, -0.12, -sx, 0, 0, 0.005);
      if (m) m.rotateZ(0);
    }
  }

  // ------------------------------------------------------------------ wheels
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [1, -1]) {
    const w = vrBuildWheel(sh);
    const pivot = new THREE.Group();
    pivot.position.set(sx * WX, WY, sz * WZ);
    if (sx < 0) pivot.scale.x = -1;
    pivot.add(w.spin, w.brake);
    // caliper
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.17), new THREE.MeshStandardMaterial({ color: L(opts.accent), roughness: 0.4, metalness: 0.3 }));
    cal.position.set(0.04, 0.12, -0.18 * sz); w.brake.add(cal);
    w.brake.children[0].castShadow = false;
    w.tyre.castShadow = true;
    chassis.parent.add(pivot);       // wheels live on `inner` (not on the chassis) so they stay planted
    wheels.push({ pivot, spin: w.spin, blur: w.blurMat, front: sz > 0, angle: 0, sx });
  }

  // ------------------------------------------------------------------ lights
  const glowTex = VR.tex.glow();
  const mkGlow = (x, y, z, color, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
    s.position.set(x, y, z); s.scale.set(size, size, 1); chassis.add(s); return s;
  };
  const headGlow = [mkGlow(-0.7, 0.66, 2.32, 0xfff2d6, 0.8), mkGlow(0.7, 0.66, 2.32, 0xfff2d6, 0.8)];
  const tailGlow = [mkGlow(-0.66, 0.68, -2.4, 0xff2a2a, 0.9), mkGlow(0.66, 0.68, -2.4, 0xff2a2a, 0.9)];
  let spot = null, spotTarget = null;
  if (opts.spot) {
    spot = new THREE.SpotLight(0xfff0d8, 0, 110, 0.5, 0.75, 1.3);
    spot.position.set(0, 0.75, 2.2);
    spotTarget = new THREE.Object3D(); spotTarget.position.set(0, -0.6, 32);
    chassis.add(spot, spotTarget); spot.target = spotTarget;
  }
  // underglow + soft contact shadow
  const underMat = new THREE.MeshBasicMaterial({ map: VR.tex.blob(), color: L(opts.accent), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const under = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.2), underMat);
  under.rotation.x = -Math.PI / 2; under.position.y = 0.06; inner.add(under);
  const shadowMat = new THREE.MeshBasicMaterial({ map: VR.tex.blob(), color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const shadowBlob = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 5.6), shadowMat);
  shadowBlob.rotation.x = -Math.PI / 2; shadowBlob.position.y = 0.05; root.add(shadowBlob);

  // ------------------------------------------------------------------ nitro flames
  const flameMat = (core) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uA: { value: 0 }, uT: VR.uniforms.uTime, uCore: { value: core } },
    vertexShader: "varying vec2 vUv; varying float vAxis; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vAxis = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }",
    fragmentShader: `
      varying vec2 vUv; varying float vAxis; varying vec3 vN; varying vec3 vV; uniform float uA, uT, uCore;
      void main() {
        float along = vAxis;
        float fade = pow(1.0 - along, 1.25);
        float soft = pow(abs(dot(normalize(vN), normalize(vV))), 1.1);
        float dia = 0.8 + 0.2 * sin(along * 20.0 - uT * 46.0);
        vec3 hot = mix(vec3(0.35, 0.65, 1.0), vec3(0.95, 1.1, 1.3), uCore);
        vec3 cold = vec3(0.08, 0.2, 0.8);
        vec3 col = mix(hot, cold, smoothstep(0.0, 0.85, along)) * dia;
        float a = fade * soft * uA * (0.85 + 0.15 * sin(uT * 90.0 + along * 9.0));
        gl_FragColor = vec4(col * a * 0.9, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const flames = [], flameMats = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * 0.34, 0.45, -2.42);
    for (const [r, len, core] of [[0.26, 1.7, 0.0], [0.14, 1.1, 1.0]]) {
      const geo = new THREE.ConeGeometry(r, len, 14, 6, true); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -len / 2);  // base at origin, tip → −z
      // flip so base (uv.y=0) is at the exhaust
      const uvs = geo.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setY(i, 1 - uvs.getY(i));
      const mt = flameMat(core); flameMats.push(mt);
      const m = new THREE.Mesh(geo, mt); m.frustumCulled = false; m.renderOrder = 5; g.add(m);
    }
    const glow = mkGlow(sx * 0.34, 0.5, -2.55, 0x66b8ff, 1.1); flames.push({ g, glow });
    chassis.add(g);
  }
  const nitro = (() => {
    let active = false, a = 0, t = 0;
    return {
      setActive(on) { active = on; },
      update(dt) {
        t += dt;
        a += ((active ? 1 : 0) - a) * Math.min(1, dt * 10);
        const wob = 1 + Math.sin(t * 70) * 0.08 + Math.sin(t * 43) * 0.06;
        for (const m of flameMats) m.uniforms.uA.value = a;
        for (const f of flames) { f.g.scale.set(1, 1, Math.max(0.001, a * wob)); f.g.visible = a > 0.01; f.glow.material.opacity = a * 0.55; }
      },
      get level() { return a; },
    };
  })();

  // ------------------------------------------------------------------ dynamics
  const dyn = { roll: 0, pitch: 0, bounce: 0, lastSpeed: 0, lastSteer: 0, hop: 0, tilt: 0, brake: 0, night: 0, vy: 0 };
  const api = {
    group: root, inner, chassis, wheels, nitro, spot, bodyMat, cabinMat, opts,
    setNight(n) {
      dyn.night = n;
      headMat.emissiveIntensity = 1.2 + n * 2.6;
      for (const g of headGlow) g.material.opacity = n * 0.4;
      underMat.opacity = n * 0.4;
      shadowMat.opacity = 0.42 - n * 0.16;
      if (spot) spot.intensity = n * 5.0;
    },
    /** st: { speed, steer, throttle, brake, nitro, drift, knock, spin, lateralG } */
    update(dt, st) {
      const spd = st.speed;
      // brake / tail lights
      dyn.brake += ((st.brake ? 1 : 0) - dyn.brake) * Math.min(1, dt * 18);
      tailMat.emissiveIntensity = 0.8 + dyn.brake * 3.4 + dyn.night * 0.7;
      for (const g of tailGlow) g.material.opacity = (0.03 + dyn.brake * 0.4) * (0.25 + dyn.night * 0.75);
      // suspension: pitch with longitudinal accel, roll with steering × speed
      const acc = (spd - dyn.lastSpeed) / Math.max(dt, 1e-3); dyn.lastSpeed = spd;
      const accS = VR.clamp(acc, -40, 40);
      dyn.pitch += ((-accS * 0.0016) - dyn.pitch) * Math.min(1, dt * 7);
      const rollT = VR.clamp(-st.steer * Math.min(1, Math.abs(spd) / 40) * 0.045 - (st.drift || 0) * 0.05, -0.08, 0.08);
      dyn.roll += (rollT - dyn.roll) * Math.min(1, dt * 7);
      const buzz = (Math.sin(performance.now() * 0.05) * 0.0006) * Math.min(1, Math.abs(spd) / 50);
      // knock-out: hop and tumble
      if (st.knock) { dyn.hop = Math.min(1, dyn.hop + dt * 6); } else dyn.hop = Math.max(0, dyn.hop - dt * 3);
      const kh = Math.sin(dyn.hop * Math.PI) * 0.0;
      inner.rotation.x = dyn.pitch + buzz;
      inner.rotation.z = dyn.roll + (st.knock ? Math.sin(performance.now() * 0.012) * 0.12 : 0);
      inner.position.y = (st.knock ? 0.1 + Math.abs(Math.sin(performance.now() * 0.01)) * 0.08 : 0) + kh;
      // wheels
      const steerAng = -VR.clamp(st.steer, -1, 1) * 0.42 * (1 - Math.min(1, Math.abs(spd) / 110) * 0.6);
      const w = Math.min(Math.abs(spd), 80) / 0.42 * Math.sign(spd || 1);
      for (const wh of wheels) {
        wh.angle += w * dt;
        wh.spin.rotation.x = wh.angle;
        wh.pivot.rotation.y = wh.front ? steerAng * wh.sx * 1.0 : 0;
        if (wh.front) wh.pivot.rotation.y = steerAng;
        wh.blur.opacity = VR.smoothstep(14, 32, Math.abs(w)) * 0.78;
      }
      nitro.setActive(!!st.nitro);
      nitro.update(dt);
    },
    setSteerVisual() {},
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    },
  };
  return api;
};
