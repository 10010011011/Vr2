"use strict";
/* ============================================================================
   Atmosphere: procedural sky (gradient, sun, moon, clouds, stars), time-of-day,
   sun/moon directional light with texel-snapped shadows, fog, IBL capture.
   ========================================================================== */
// sunset / dawn sit right at peak twilight (sun a hair above the horizon) so the sky is at its most colourful
VR.TOD = { dawn: 0.258, day: 0.47, sunset: 0.742, night: 0.0 };

VR.Atmosphere = class Atmosphere {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.q = quality;
    this.tod = 0.4;
    this.mode = "dynamic";
    this.cycleSeconds = 480;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.night = 0;
    this.exposure = 1;
    this.dayFactor = 1;
    this._envClock = 99;
    this._envTod = -1;

    const L = VR.lin;
    // Palette keyed by sun elevation (sin of angle above horizon).
    const K = (arr) => arr.map(([e, hex]) => ({ e, c: L(hex) }));
    // Palettes were authored in *display* space against twilight/night reference frames and inverted through the
    // tone-map, so what you see is muted and mid-value (no neon): sunset = gold → rose → lilac → periwinkle,
    // dusk = peach/pink horizon under violet and indigo, deep dusk = dusty mauve → navy, night = deep navy.
    this.pal = {
      zenith: K([[-0.35, 0x151c36], [-0.2, 0x151c36], [-0.12, 0x252d50], [-0.05, 0x394765], [0.03, 0x575b7d], [0.1, 0x4a62a2], [0.2, 0x3f7bd0], [0.5, 0x2f6fcb], [1, 0x2a66c6]]),
      mid: K([[-0.35, 0x1c2642], [-0.2, 0x1c2642], [-0.12, 0x3a4165], [-0.05, 0x6d6798], [0.03, 0xa86579], [0.1, 0x8f9ccc], [0.2, 0x8ebcea], [0.5, 0x82b6ec], [1, 0x78aee8]]),
      horizon: K([[-0.35, 0x26304f], [-0.2, 0x26304f], [-0.12, 0x7d616c], [-0.05, 0xffc3ba], [0.03, 0xffa274], [0.09, 0xffbf86], [0.2, 0xf7d9bc], [0.5, 0xd6e7f4], [1, 0xc9e1f3]]),
      ground: K([[-0.35, 0x05060a], [-0.05, 0x1b1a22], [0.1, 0x4a4a42], [0.5, 0x6b7156], [1, 0x6d7a58]]),
      sun: K([[-0.35, 0x6a82c0], [-0.12, 0x8a6aa8], [-0.05, 0xff7a5a], [0.0, 0xff6a3a], [0.05, 0xff8d48], [0.2, 0xffcf96], [0.5, 0xfff0dc], [1, 0xfff6ea]]),
      band: K([[-0.35, 0x675367], [-0.15, 0x675367], [-0.05, 0xd2797a], [0.03, 0xff6b77], [0.12, 0xffa6a0], [0.3, 0xffd0c0]]),
      cloudLit: K([[-0.35, 0x374264], [-0.2, 0x374264], [-0.12, 0x7d6175], [-0.05, 0xeb7e90], [0.03, 0xffb298], [0.12, 0xffd2b4], [0.3, 0xffffff], [1, 0xffffff]]),
      cloudShade: K([[-0.35, 0x1b233d], [-0.2, 0x1b233d], [-0.12, 0x3d3d5c], [-0.05, 0x5c4f75], [0.03, 0x7d5875], [0.12, 0x9a7ba6], [0.25, 0x9fb2cf], [1, 0x8ea4c6]]),
    };

    // An original comet low in the sky (head + long curved ion/dust tail), visible from dusk through the night.
    {
      const H = new THREE.Vector3(0.5, 0.46, -0.75).normalize();
      const A = new THREE.Vector3(-0.35, 0.92, -0.15);
      const T = A.clone().addScaledVector(H, -A.dot(H)).normalize();
      this._comet = { H, T };
    }

    const u = (this.skyU = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uZenith: { value: new THREE.Color() }, uMid: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() }, uSunGlow: { value: 1 },
      uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uTime: VR.uniforms.uTime, uNight: { value: 0 }, uCover: { value: 0.45 }, uDetail: { value: 1 },
      uBand: { value: new THREE.Color() }, uTwi: { value: 0 },
      uComet: { value: 0 }, uCometH: { value: this._comet.H.clone() }, uCometT: { value: this._comet.T.clone() },
      uStarScale: { value: 120 }, uPx: { value: 0.002 },
    });

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 40, 20), this._makeSkyMaterial(u, quality.cloudOct, 1));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 1000;   // drawn after the opaque world: early-z skips every sky pixel hidden behind terrain
    scene.add(this.sky);

    // Sun / moon light
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = !!quality.shadows;
    if (quality.shadows) {
      const s = this.sun.shadow;
      s.mapSize.set(quality.shadowMap, quality.shadowMap);
      const R = quality.shadowRadius;
      Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: R * 5 + 200 });
      s.bias = -0.00035;
      s.normalBias = 0.06;
      s.camera.updateProjectionMatrix();
    }
    scene.add(this.sun, this.sun.target);

    this.fog = new THREE.FogExp2(0xaec6dd, 0.00085);
    scene.fog = this.fog;

    // Image-based lighting source scene
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), this._makeSkyMaterial(u, 3, 0));
    this.envSky.frustumCulled = false;
    this.envScene.add(this.envSky);
    this.envRT = null;

    this.setMode("dynamic");
  }

  _makeSkyMaterial(u, cloudOct, detail) {
    const uniforms = {};
    for (const k in u) uniforms[k] = u[k];
    // each material owns its own `uDetail`
    uniforms.uDetail = { value: detail };
    uniforms.uSkyAlpha = { value: detail > 0.5 ? 0 : 1 };
    uniforms.uOut = { value: 1 };   // output scale (the IBL capture dims at night so scene lighting stays dark)
    return new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      defines: { CLOUD_OCT: cloudOct, COSMOS_FULL: cloudOct >= 4 ? 1 : 0 },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uMoonDir, uCloudLit, uCloudShade;
        uniform float uTime, uNight, uCover, uDetail, uComet, uOut, uStarScale, uSkyAlpha, uPx;
        uniform vec3 uCometH, uCometT;
        ${VR.glsl.noise}
        ${VR.glsl.skyBase}
        float cloudFbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < CLOUD_OCT; i++) { v += a * vrNoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
          return v;
        }
        // Star field: four layers on a 3D hash grid (fine dust, main field, brighter, a few brightest). Every star is a
        // tiny point (support radius 0.16-0.3 cell, cell size set on the CPU to ~3-14px) so stars stay ~1-2px and
        // never shimmer; most are faint, only a handful are bright. No halos, no glints.
        vec3 vrStarLayer(vec3 d, float scale, float thresh, float gain, float seed, float rad) {
          vec3 p = d * scale; vec3 ip = floor(p); vec3 fp = fract(p);
          float h = vrHash3(ip + seed);
          if (h < thresh) return vec3(0.0);
          vec3 off = 0.3 + 0.4 * vec3(vrHash3(ip + 7.1 + seed), vrHash3(ip + 13.3 + seed), vrHash3(ip + 21.7 + seed));
          vec3 q = fp - off;
          float r2 = dot(q, q) / (rad * rad);
          if (r2 >= 1.0) return vec3(0.0);
          float mag = (h - thresh) / (1.0 - thresh);
          float s = 1.0 - r2;
          float tw = 0.8 + 0.2 * sin(uTime * (1.1 + mag * 3.0) + h * 90.0);
          float tint = vrHash3(ip + 3.3 + seed);
          vec3 sc = mix(vec3(0.68, 0.8, 1.0), vec3(1.0, 0.89, 0.8), smoothstep(0.55, 1.0, tint));
          return sc * (s * s * s) * tw * gain * (0.2 + 1.5 * mag * mag * mag);
        }
        vec3 vrStars(vec3 d) {
          vec3 c = vrStarLayer(d, uStarScale * 1.45, 0.90, 0.5, 5.0, 0.30);
          c += vrStarLayer(d, uStarScale, 0.93, 0.85, 0.0, 0.26);
          c += vrStarLayer(d, uStarScale * 0.55, 0.955, 1.15, 31.0, 0.22);
          c += vrStarLayer(d, uStarScale * 0.28, 0.968, 1.25, 67.0, 0.16);
          return c;
        }
        // Soft cosmic dust: a faint galactic band and a few drifts of blue / teal haze (kept dim: the stars are the show).
        vec3 vrCosmos(vec3 d) {
          vec3 bn = normalize(vec3(0.45, 0.75, 0.35));
          float bd = dot(d, bn);
          float band = exp(-bd * bd * 12.0);
          float dust = vrFbm3(d.xz * 5.0 + d.y * 3.5);
          float n1 = vrFbm3(d.xz * 2.4 + d.y * 1.7 + 4.0);
        #if COSMOS_FULL
          float lanes = smoothstep(0.38, 0.72, vrFbm3(d.xz * 9.0 + d.yx * 4.0 + 7.0));
          float n2 = vrFbm3(d.zx * 3.0 - d.y * 2.2 + 19.0);
        #else
          float lanes = 0.25;
          float n2 = 0.0;
        #endif
          vec3 mw = mix(vec3(0.22, 0.32, 0.62), vec3(0.40, 0.40, 0.70), dust) * band * (0.2 + dust * 0.8) * (1.0 - lanes * 0.6);
          vec3 neb = vec3(0.12, 0.14, 0.42) * smoothstep(0.42, 0.88, n1) * 0.4 + vec3(0.03, 0.22, 0.36) * smoothstep(0.46, 0.92, n2) * 0.4;
          return (mw + neb) * 0.11;
        }
        // Comet: one thin curved ribbon of parallel colour lines (cyan | white core | violet | magenta), a tiny bright
        // head, and a second small red-tipped fragment trailing a hair-thin blue line. Crisp, low glow.
        vec3 vrComet(vec3 d) {
          float c = dot(d, uCometH);
          if (c < 0.25) return vec3(0.0);
          float ang = acos(clamp(c, -1.0, 1.0));
          vec3 B = cross(uCometH, uCometT);
          vec3 pp = d - uCometH * c;
          vec2 dir = vec2(dot(pp, uCometT), dot(pp, B));
          dir /= max(length(dir), 1e-5);
          float u = ang * dir.x, v = ang * dir.y;           // u along the tail (+ = away from the head), v across
          float px = max(uPx, 1e-4);
          float uu = max(u, 0.0);
          float cur = 0.26 * pow(uu, 1.7);                  // gentle bow
          float slope = 0.442 * pow(max(uu, 1e-3), 0.7);
          float dv = (v - cur) / sqrt(1.0 + slope * slope);
          float hw = max(0.0012 + 0.0105 * pow(smoothstep(0.0, 0.7, uu), 1.2), 1.15 * px);
          float w = dv / hw;
          float env = smoothstep(0.0, 0.09, u) * (1.0 - smoothstep(0.6, 1.1, u)) * (0.35 + 0.65 * smoothstep(0.0, 0.45, u));
          float cyan = exp(-pow((w + 0.55) / 0.5, 2.0));
          float vio  = exp(-pow((w - 0.62) / 0.55, 2.0));
          float mag  = exp(-pow((w - 1.1) / 0.32, 2.0));
          float haze = exp(-w * w * 0.35);
          vec3 rib = vec3(0.22, 0.85, 0.80) * cyan * 0.5 + vec3(0.55, 0.30, 0.95) * vio * 0.42
                   + vec3(0.92, 0.30, 0.72) * mag * 0.3 + vec3(0.18, 0.32, 0.85) * haze * 0.14;
          float cs = max(0.2 * hw, 0.65 * px);
          rib += vec3(0.95, 1.0, 1.0) * exp(-dv * dv / (2.0 * cs * cs)) * 0.9;
          vec3 col = rib * env * 0.75;
          // head: a tiny bright point with almost no glow
          float r2 = u * u + v * v, hs = max(0.0016, 1.3 * px);
          col += vec3(0.95, 1.0, 1.0) * exp(-r2 / (hs * hs)) * 1.3 + vec3(0.45, 0.85, 1.0) * exp(-r2 / (hs * hs * 20.0)) * 0.12;
          // second fragment: small red tip with a hair-thin blue trail
          vec2 fp = vec2(0.05, 0.078);
          float fu = u - fp.x;
          float vt = fp.y + 0.26 * 0.9 * (pow(max(u, 0.0), 1.7) - pow(fp.x, 1.7));
          float fw = max(0.0009, 0.9 * px);
          float trail = exp(-(v - vt) * (v - vt) / (fw * fw)) * smoothstep(0.0, 0.01, fu) * (1.0 - smoothstep(0.08, 0.34, fu));
          col += vec3(0.35, 0.55, 1.0) * trail * 0.55;
          float fr2 = (u - fp.x) * (u - fp.x) + (v - fp.y) * (v - fp.y), fs = 1.5 * px;
          col += vec3(1.0, 0.38, 0.28) * exp(-fr2 / (fs * fs)) * 1.0 + vec3(1.0, 0.3, 0.4) * exp(-fr2 / (fs * fs * 25.0)) * 0.12;
          return col;
        }
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = vrSkyBase(d);
          float horizonFade = smoothstep(-0.02, 0.18, d.y);

          // ---- stars, milky way, moon ----
          if (uNight > 0.01 && uDetail > 0.5) {
            col += (vrStars(d) + vrCosmos(d)) * uNight * horizonFade;
            float md = dot(d, uMoonDir);
            if (md > 0.99) {
              vec3 mt = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
              vec2 mp = vec2(dot(d, mt), dot(d, cross(mt, uMoonDir))) * 200.0;
              float shade = 0.72 + 0.28 * vrFbm3(mp * 2.5);
              float disc = smoothstep(0.99972, 0.99985, md);
              col = mix(col, vec3(0.88, 0.92, 1.0) * 1.35 * shade, disc * uNight);
              col += vec3(0.45, 0.58, 0.9) * pow(max(md, 0.0), 900.0) * 0.2 * uNight;
            }
          }

          // ---- comet (appears at dusk, fades with the day) ----
          if (uComet > 0.01 && uDetail > 0.5) col += vrComet(d) * uComet * horizonFade;

          // ---- sun disc ----
          float sd = dot(d, uSunDir);
          float disc = smoothstep(0.99962, 0.99985, sd);
          col += uSunCol * disc * 28.0 * uSunGlow * (1.0 - uNight);

          // ---- clouds ----
          if (uDetail > 0.5 && d.y > 0.01) {
            vec2 p = d.xz / (d.y * 0.85 + 0.14);
            p = p * 0.42 + vec2(uTime * 0.010, uTime * 0.0035);
            float n = cloudFbm(p);
            float thr = mix(0.66, 0.40, uCover);
            // two cloud looks share the sky: soft realistic volumes, and a lightly cel-shaded variant (mostly at
            // twilight) with crisper silhouettes, stepped violet shadows and a bright rim on the sun side
            float styl = smoothstep(0.34, 0.52, vrNoise(p * 0.3 + 5.7)) * (0.3 + 0.7 * uTwi);
            float c = smoothstep(thr, thr + 0.24, n);
            c = mix(c, smoothstep(thr + 0.01, thr + 0.075, n), styl * 0.85);
            vec2 sp = normalize(uSunDir.xz + 1e-4) * 0.06 / max(uSunDir.y + 0.25, 0.3);
            float n2 = cloudFbm(p + sp);
            float lit = clamp(0.55 + (n - n2) * 4.2, 0.0, 1.0);
            float thick = smoothstep(thr, thr + 0.5, n);
            // shadow amount: thick cores and the side facing away from the sun; the stylised look steps it into
            // soft-edged violet tones (lit / mid / shadow) while the realistic look keeps it smooth
            float shade = clamp(0.55 * thick + 0.85 * (1.0 - lit) + 0.4 * smoothstep(0.12, 0.65, d.y) * uTwi - 0.2, 0.0, 1.0);
            float shadeS = smoothstep(0.30, 0.38, shade) * 0.5 + smoothstep(0.58, 0.66, shade) * 0.5;
            float shadeF = mix(shade, shadeS, styl * 0.9);
            vec3 shadeC = uCloudShade * mix(vec3(1.0), vec3(0.82, 0.74, 1.28), styl);
            vec3 cc = mix(uCloudLit, shadeC, clamp(shadeF * 1.05, 0.0, 1.0));
            cc = mix(cc, shadeC * 0.82, thick * 0.2);
            float rim = (1.0 - smoothstep(thr + 0.02, thr + 0.2, n)) * smoothstep(0.35, 0.75, lit);
            cc += uCloudLit * rim * 0.34 * styl;
            // silver lining toward the sun
            cc += uSunCol * pow(max(sd, 0.0), 8.0) * (1.0 - thick) * 0.55 * uSunGlow;
            // thin cirrus streaks
            float ci = cloudFbm(vec2(p.x * 0.35 + 3.0, p.y * 2.2) + 9.0);
            float cirrus = smoothstep(0.55, 0.9, ci) * 0.22 * smoothstep(0.1, 0.5, d.y);
            float a = c * horizonFade;
            col = mix(col, cc, a * 0.94);
            col = mix(col, uCloudLit * 0.95, cirrus * horizonFade * (1.0 - a));
          }
          gl_FragColor = vec4(col * uOut, uSkyAlpha);   // main sky writes alpha 0 = 'not world' (post night-grade mask)
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "dynamic") this.tod = 0.32 + Math.random() * 0.28;
    else this.tod = VR.TOD[mode] !== undefined ? VR.TOD[mode] : 0.47;
    this._applyTime();
    this._captureEnv();
  }

  /** Tell the sky how big a pixel is, so star cells stay ~4px wide at any resolution. Call on resize / FOV change. */
  setViewport(heightPx, fovDeg) {
    const pxAngle = (fovDeg * Math.PI / 180) / Math.max(1, heightPx);
    const cellPx = this.q.msaa ? 4 : 5.5;   // without MSAA, slightly larger star cells keep stars round
    this.skyU.uStarScale.value = VR.clamp(1 / (pxAngle * cellPx), 70, 380);
    this.skyU.uPx.value = pxAngle;
  }

  _pal(keys, e, out) {
    let i = 0;
    while (i < keys.length - 1 && e > keys[i + 1].e) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const t = a === b ? 0 : VR.saturate((e - a.e) / (b.e - a.e));
    return out.copy(a.c).lerp(b.c, t);
  }

  _applyTime() {
    const ang = (this.tod - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang) * 0.78, -0.5).normalize();
    this.moonDir.set(-this.sunDir.x * 0.85, -this.sunDir.y + 0.05, 0.35).normalize();
    const e = this.sunDir.y;
    const u = this.skyU;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    this._pal(this.pal.zenith, e, u.uZenith.value);
    this._pal(this.pal.mid, e, u.uMid.value);
    this._pal(this.pal.horizon, e, u.uHorizon.value);
    this._pal(this.pal.ground, e, u.uGround.value);
    this._pal(this.pal.sun, e, u.uSunCol.value);
    this._pal(this.pal.band, e, u.uBand.value);
    this._pal(this.pal.cloudLit, e, u.uCloudLit.value);
    this._pal(this.pal.cloudShade, e, u.uCloudShade.value);
    u.uTwi.value = VR.smoothstep(-0.2, -0.06, e) * (1 - VR.smoothstep(0.06, 0.28, e));
    u.uComet.value = VR.smoothstep(0.08, -0.07, e);
    this.night = VR.smoothstep(0.04, -0.16, e);
    // the IBL capture is dimmed at night: the sky is bright to look at, but scene lighting stays dark and blue
    this.envSky.material.uniforms.uOut.value = VR.lerp(1, 0.3, this.night);
    this.dayFactor = VR.smoothstep(-0.1, 0.25, e);
    u.uNight.value = this.night;
    u.uSunGlow.value = VR.smoothstep(-0.12, 0.06, e);
    u.uCover.value = 0.5 - this.dayFactor * 0.08 - u.uTwi.value * 0.07;
    VR.uniforms.uNight.value = this.night;

    // Fog follows the horizon colour (slightly desaturated + dimmed)
    const fogC = this.fog.color.copy(u.uHorizon.value);
    const g = (fogC.r + fogC.g + fogC.b) / 3, ds = 0.2 * (1 - u.uTwi.value * 0.75);
    fogC.r += (g - fogC.r) * ds; fogC.g += (g - fogC.g) * ds; fogC.b += (g - fogC.b) * ds;
    fogC.lerp(u.uBand.value, u.uTwi.value * 0.14);
    fogC.multiplyScalar(0.92);
    this.fog.density = 0.00085 + this.night * 0.0002 + (1 - VR.smoothstep(0.0, 0.35, e)) * 0.0003;

    // Light: sun by day, moon by night (cross-fade through the dark gap)
    const sunI = VR.smoothstep(-0.07, 0.14, e) * (1.5 + this.dayFactor * 0.75);
    const moonI = this.night * 0.3 * VR.smoothstep(-0.02, 0.15, this.moonDir.y);
    const useSun = sunI >= moonI;
    const dir = useSun ? this.sunDir : this.moonDir;
    this._lightDir = dir;
    this.sun.intensity = Math.max(sunI, moonI);
    if (useSun) this.sun.color.copy(u.uSunCol.value); else this.sun.color.setRGB(0.62, 0.72, 1.0);
    // brightness of ambient for tunnel/night control
    this.ambientBase = 0.55 + this.dayFactor * 0.55;
    // post exposure: lift twilight/night a touch so the road stays readable (game copies this to post.params.exposure)
    this.exposure = 1 + u.uTwi.value * 0.12 + this.night * 0.22;   // applied to the WORLD only (post alpha mask), never to the sky
  }

  _captureEnv() {
    try {
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this._envTod = this.tod;
      this._envClock = 0;
    } catch (e) { console.warn("[env] capture failed", e); }
  }

  /** Per-frame update. `focus` = world position shadows should follow. */
  update(dt, camera, focus) {
    if (this.mode === "dynamic") this.tod = (this.tod + dt / this.cycleSeconds) % 1;
    this._applyTime();
    this._envClock += dt;
    const envEvery = this.q.envUpdate ? 3.0 : 8.0;
    if (this.mode === "dynamic" && this._envClock > envEvery && Math.abs(this.tod - this._envTod) > 0.003) this._captureEnv();

    this.sky.position.copy(camera.position);
    if (focus) this._updateShadowFrame(focus);
  }

  _updateShadowFrame(focus) {
    const L = this._lightDir;
    const sun = this.sun;
    if (!this.q.shadows) {
      sun.position.copy(focus).addScaledVector(L, 200);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
      return;
    }
    const R = this.q.shadowRadius;
    const texel = (2 * R) / this.q.shadowMap;
    const up = Math.abs(L.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, L).normalize();
    const upv = new THREE.Vector3().crossVectors(L, right).normalize();
    const fx = Math.round(focus.dot(right) / texel) * texel;
    const fy = Math.round(focus.dot(upv) / texel) * texel;
    const fz = focus.dot(L);
    const snapped = new THREE.Vector3().addScaledVector(right, fx).addScaledVector(upv, fy).addScaledVector(L, fz);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(L, R * 2.5 + 80);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  dispose() {
    this.pmrem.dispose();
    if (this.envRT) this.envRT.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.envSky.geometry.dispose(); this.envSky.material.dispose();
  }
};
