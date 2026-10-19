"use strict";
/* ============================================================================
   PostFX — HDR scene target (MSAA when available) → dual-filter bloom →
   composite (speed blur, chromatic aberration, ACES, grading, vignette, grain)
   → optional FXAA. Degrades: HDR+MSAA → HDR → LDR (tone-mapped in materials).
   ========================================================================== */
VR.PostFX = class PostFX {
  constructor(renderer, opts) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.opts = Object.assign({ msaa: 4, bloom: true, bloomLevels: 5 }, opts || {});
    this.isGL2 = !!renderer.capabilities.isWebGL2;
    this.hdr = false; this.useMSAA = false; this.useFXAA = false; this.ok = false;
    this.w = 2; this.h = 2;
    this.params = {
      bloom: 0.42, vignette: 0.34, grain: 0.028, aberration: 0.0022, exposure: 1.0, nightGrade: 0, worldLift: 1,
      speed: 0, nitro: 0, flash: 0, saturation: 1.1, contrast: 1.08, tint: 0,
      time: 0, sun: new THREE.Vector3(0.5, 0.5, 0), // xy = screen pos, z = visibility
    };

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this._buildMaterials();
    this._chooseTargets();
  }

  /* ---------- shaders ---------- */
  _mat(frag, uniforms, defines) {
    return new THREE.ShaderMaterial({
      uniforms, defines: defines || {},
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: frag,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
  }

  _buildMaterials() {
    const T = () => ({ value: null });
    this.matPre = this._mat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee;
      vec3 pre(vec3 c) {
        float br = max(c.r, max(c.g, c.b));
        float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
        soft = soft * soft / (4.0 * uKnee + 1e-4);
        float k = max(soft, br - uThreshold) / max(br, 1e-4);
        return c * k;
      }
      vec3 fetch(vec2 uv) { return min(pre(texture2D(tSrc, uv).rgb), vec3(60.0)); }
      void main() {
        vec3 a = fetch(vUv + vec2(-1.0, -1.0) * uTexel), b = fetch(vUv + vec2(1.0, -1.0) * uTexel);
        vec3 c = fetch(vUv + vec2(-1.0, 1.0) * uTexel),  d = fetch(vUv + vec2(1.0, 1.0) * uTexel);
        vec3 e = fetch(vUv);
        float wa = 1.0 / (1.0 + dot(a, vec3(0.333))), wb = 1.0 / (1.0 + dot(b, vec3(0.333)));
        float wc = 1.0 / (1.0 + dot(c, vec3(0.333))), wd = 1.0 / (1.0 + dot(d, vec3(0.333)));
        float we = 2.0 / (1.0 + dot(e, vec3(0.333)));
        vec3 col = (a * wa + b * wb + c * wc + d * wd + e * we) / (wa + wb + wc + wd + we);
        gl_FragColor = vec4(col, 1.0);
      }`, { tSrc: T(), uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.5 } });

    this.matDown = this._mat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
      void main() {
        vec2 h = uTexel * 0.5;
        vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
        s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb;
        s += texture2D(tSrc, vUv + vec2( h.x, -h.y)).rgb;
        s += texture2D(tSrc, vUv + vec2(-h.x,  h.y)).rgb;
        s += texture2D(tSrc, vUv + vec2( h.x,  h.y)).rgb;
        gl_FragColor = vec4(s / 8.0, 1.0);
      }`, { tSrc: T(), uTexel: { value: new THREE.Vector2() } });

    this.matUp = this._mat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uMix;
      void main() {
        vec2 h = uTexel * 0.5;
        vec3 s = texture2D(tLow, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
        s += texture2D(tLow, vUv + vec2(-h.x, h.y)).rgb * 2.0;
        s += texture2D(tLow, vUv + vec2(0.0, h.y * 2.0)).rgb;
        s += texture2D(tLow, vUv + vec2(h.x, h.y)).rgb * 2.0;
        s += texture2D(tLow, vUv + vec2(h.x * 2.0, 0.0)).rgb;
        s += texture2D(tLow, vUv + vec2(h.x, -h.y)).rgb * 2.0;
        s += texture2D(tLow, vUv + vec2(0.0, -h.y * 2.0)).rgb;
        s += texture2D(tLow, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
        s /= 12.0;
        vec3 hi = texture2D(tHigh, vUv).rgb;
        gl_FragColor = vec4(hi + s * uMix, 1.0);
      }`, { tLow: T(), tHigh: T(), uTexel: { value: new THREE.Vector2() }, uMix: { value: 0.85 } });

    this.matComposite = this._mat(/* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tScene, tBloom;
      uniform vec2 uRes; uniform vec3 uSun;
      uniform float uBloom, uVignette, uGrain, uAberration, uExposure, uSpeed, uNitro, uFlash, uSat, uContrast, uTime, uToneMap, uUseBloom, uTint, uNightGrade, uWorldLift;
      ${VR.glsl.noise}
      ${VR.glsl.aces}
      vec3 toSRGB(vec3 c) {
        c = max(c, vec3(0.0));
        vec3 lo = c * 12.92;
        vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
        return mix(lo, hi, step(vec3(0.0031308), c));
      }
      void main() {
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        float r2 = dot(c, c);
        // chromatic aberration (stronger at the edges / at speed)
        float ab = uAberration * (0.4 + uSpeed * 1.4 + uNitro * 1.2) * (0.3 + r2 * 4.0);
        vec2 off = c * ab;
        // radial speed blur, sparing the screen centre-bottom where the car sits
        float blurAmt = (uSpeed * 0.028 + uNitro * 0.05) * smoothstep(0.04, 0.34, r2);
        vec3 col;
        if (blurAmt > 0.0004) {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 7; i++) {
            float s = 1.0 - blurAmt * float(i) / 6.0;
            vec2 p = c * s + 0.5;
            acc.r += texture2D(tScene, p + off).r;
            acc.g += texture2D(tScene, p).g;
            acc.b += texture2D(tScene, p - off).b;
          }
          col = acc / 7.0;
        } else {
          col = vec3(texture2D(tScene, uv + off).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off).b);
        }
        if (uUseBloom > 0.5) col += texture2D(tBloom, uv).rgb * uBloom;

        // sun glare (cheap): additive halo when the sun is on screen
        if (uSun.z > 0.001) {
          vec2 sd = (uv - uSun.xy) * vec2(uRes.x / uRes.y, 1.0);
          float dsun = length(sd);
          col += vec3(1.0, 0.82, 0.6) * (exp(-dsun * 7.0) * 0.18 + exp(-dsun * 22.0) * 0.25) * uSun.z;
        }

        float worldMask = texture2D(tScene, uv).a;          // sky writes alpha 0, everything else 1
        col *= uExposure * mix(1.0, uWorldLift, worldMask);
        if (uToneMap > 0.5) col = vrACES(col);

        // grading: saturation, S-curve contrast, split-tone
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = mix(col, col * col * (3.0 - 2.0 * col), clamp((uContrast - 1.0) * 3.0, 0.0, 1.0));
        col *= mix(vec3(0.94, 1.0, 1.06), vec3(1.06, 1.0, 0.93), smoothstep(0.05, 0.85, l));

        // moonlit grade: the world (sky writes alpha 0) is pulled toward a cool blue, bright lights keep their colour
        if (uNightGrade > 0.001) {
          float world = worldMask;
          float nl = dot(col, vec3(0.2126, 0.7152, 0.0722));
          vec3 moon = nl * vec3(0.56, 0.8, 1.32);
          col = mix(col, moon, uNightGrade * 0.86 * world * (1.0 - smoothstep(0.3, 0.95, nl)));
        }

        // nitro speed streaks
        if (uNitro > 0.01) {
          float ang = atan(c.y, c.x);
          float r = sqrt(r2);
          float n = vrNoise(vec2(ang * 34.0, floor(uTime * 24.0)));
          float n2 = vrNoise(vec2(ang * 11.0 + 7.0, uTime * 9.0));
          float line = smoothstep(0.72, 1.0, n) * smoothstep(0.22, 0.75, r) * (0.5 + n2);
          col += vec3(0.55, 0.8, 1.0) * line * uNitro * 0.28;
        }

        // vignette
        float vg = smoothstep(0.18, 0.78, r2 * 1.45);
        col *= 1.0 - uVignette * vg;
        // impact flash / damage tint
        col = mix(col, vec3(1.0, 0.95, 0.9), uFlash * 0.55);
        col = mix(col, col * vec3(1.0, 0.55, 0.45), uTint);

        col = toSRGB(col);
        // film grain + dither
        float g = vrHash(uv * uRes + fract(uTime) * 61.0) - 0.5;
        col += g * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }`, {
        tScene: T(), tBloom: T(), uRes: { value: new THREE.Vector2(1, 1) }, uSun: { value: new THREE.Vector3() },
        uBloom: { value: 0.4 }, uVignette: { value: 0.3 }, uGrain: { value: 0.03 }, uAberration: { value: 0.002 },
        uExposure: { value: 1 }, uSpeed: { value: 0 }, uNitro: { value: 0 }, uFlash: { value: 0 }, uSat: { value: 1.1 },
        uContrast: { value: 1.08 }, uTime: { value: 0 }, uToneMap: { value: 1 }, uUseBloom: { value: 1 }, uTint: { value: 0 }, uNightGrade: { value: 0 }, uWorldLift: { value: 1 },
      });

    this.matFXAA = this._mat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
      float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main() {
        vec3 rgbM = texture2D(tSrc, vUv).rgb;
        vec3 rgbNW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
        vec3 rgbNE = texture2D(tSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
        vec3 rgbSW = texture2D(tSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
        vec3 rgbSE = texture2D(tSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
        float lM = luma(rgbM), lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
        float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        vec2 dir;
        dir.x = -((lNW + lNE) - (lSW + lSE));
        dir.y =  ((lNW + lSW) - (lNE + lSE));
        float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 * 0.125), 1.0 / 128.0);
        float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
        dir = min(vec2(8.0), max(vec2(-8.0), dir * rcpDirMin)) * uTexel;
        vec3 rgbA = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
        float lB = luma(rgbB);
        gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
      }`, { tSrc: T(), uTexel: { value: new THREE.Vector2() } });
  }

  /* ---------- render targets ---------- */
  _rt(w, h, type, msaa) {
    const o = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type,
      depthBuffer: true, stencilBuffer: false,
    };
    let rt;
    if (msaa) { rt = new THREE.WebGLMultisampleRenderTarget(w, h, o); rt.samples = this.opts.msaa; }
    else rt = new THREE.WebGLRenderTarget(w, h, o);
    rt.texture.generateMipmaps = false;
    return rt;
  }
  _probe(rt) {
    try {
      this.renderer.setRenderTarget(rt);
      const st = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
      this.renderer.setRenderTarget(null);
      return st === this.gl.FRAMEBUFFER_COMPLETE;
    } catch (e) { this.renderer.setRenderTarget(null); return false; }
  }
  _chooseTargets() {
    const r = this.renderer;
    const hdrOk = this.isGL2 && r.extensions.has("EXT_color_buffer_float");
    const tries = [];
    if (hdrOk && this.opts.msaa > 0) tries.push({ hdr: true, msaa: true });
    if (hdrOk) tries.push({ hdr: true, msaa: false });
    tries.push({ hdr: false, msaa: false });
    for (const t of tries) {
      const rt = this._rt(8, 8, t.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, t.msaa);
      if (this._probe(rt)) {
        this.hdr = t.hdr; this.useMSAA = t.msaa; this.useFXAA = !t.msaa;
        rt.dispose();
        this.ok = true;
        break;
      }
      rt.dispose();
    }
    this.matComposite.uniforms.uToneMap.value = this.hdr ? 1 : 0;
    r.toneMapping = this.hdr ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    this.bloomThreshold = this.hdr ? 1.05 : 0.8;
    this._sceneRT = null; this._ldrRT = null; this._down = []; this._up = [];
  }

  /** Size in drawing-buffer pixels. */
  setSize(w, h) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (w === this.w && h === this.h && this._sceneRT) return;
    this.w = w; this.h = h;
    this._disposeTargets();
    this._sceneRT = this._rt(w, h, this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, this.useMSAA);
    if (this.useFXAA) this._ldrRT = this._rt(w, h, THREE.UnsignedByteType, false);
    if (this.opts.bloom) {
      const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
      let bw = w, bh = h;
      for (let i = 0; i < this.opts.bloomLevels; i++) {
        bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
        const mk = () => { const t = this._rt(bw, bh, type, false); t.depthBuffer = false; return t; };
        this._down.push(mk());
        if (i < this.opts.bloomLevels - 1) this._up.push(mk());
      }
    }
    this.matComposite.uniforms.uRes.value.set(w, h);
  }
  _disposeTargets() {
    for (const t of [this._sceneRT, this._ldrRT, ...this._down, ...this._up]) if (t) t.dispose();
    this._sceneRT = null; this._ldrRT = null; this._down = []; this._up = [];
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /** Project the sun direction to screen for glare. */
  _sunScreen(camera, sunDir, strength) {
    const v = new THREE.Vector3().copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const facing = fwd.dot(sunDir);
    const vis = facing > 0 ? VR.smoothstep(0.0, 0.5, facing) * strength : 0;
    this.params.sun.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, vis);
  }

  render(scene, camera, sunDir, sunStrength) {
    const r = this.renderer, p = this.params;
    if (sunDir) this._sunScreen(camera, sunDir, sunStrength || 0);
    // 1) scene → HDR target
    r.setRenderTarget(this._sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2) bloom chain
    let useBloom = 0;
    if (this.opts.bloom && this._down.length) {
      useBloom = 1;
      const d = this._down;
      const mp = this.matPre.uniforms;
      mp.tSrc.value = this._sceneRT.texture;
      mp.uTexel.value.set(1 / this.w, 1 / this.h);
      mp.uThreshold.value = this.bloomThreshold; mp.uKnee.value = 0.5;
      this._pass(this.matPre, d[0]);
      for (let i = 1; i < d.length; i++) {
        const mdn = this.matDown.uniforms;
        mdn.tSrc.value = d[i - 1].texture;
        mdn.uTexel.value.set(1 / d[i - 1].width, 1 / d[i - 1].height);
        this._pass(this.matDown, d[i]);
      }
      let low = d[d.length - 1];
      for (let i = d.length - 2; i >= 0; i--) {
        const mu = this.matUp.uniforms;
        mu.tLow.value = low.texture; mu.tHigh.value = d[i].texture;
        mu.uTexel.value.set(1 / low.width, 1 / low.height);
        mu.uMix.value = 0.9;
        this._pass(this.matUp, this._up[i]);
        low = this._up[i];
      }
      this.matComposite.uniforms.tBloom.value = low.texture;
    }

    // 3) composite
    const u = this.matComposite.uniforms;
    u.tScene.value = this._sceneRT.texture;
    u.uUseBloom.value = useBloom;
    u.uBloom.value = p.bloom * (this.hdr ? 1 : 0.7);
    u.uVignette.value = p.vignette; u.uGrain.value = p.grain; u.uAberration.value = p.aberration;
    u.uExposure.value = p.exposure; u.uSpeed.value = p.speed; u.uNitro.value = p.nitro;
    u.uFlash.value = p.flash; u.uSat.value = p.saturation; u.uContrast.value = p.contrast; u.uTime.value = p.time;
    u.uNightGrade.value = p.nightGrade; u.uWorldLift.value = p.worldLift; u.uTint.value = p.tint; u.uSun.value.copy(p.sun);
    this._pass(this.matComposite, this.useFXAA ? this._ldrRT : null);

    // 4) FXAA (non-MSAA paths)
    if (this.useFXAA) {
      this.matFXAA.uniforms.tSrc.value = this._ldrRT.texture;
      this.matFXAA.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this._pass(this.matFXAA, null);
    }
    r.setRenderTarget(null);
  }

  dispose() {
    this._disposeTargets();
    for (const m of [this.matPre, this.matDown, this.matUp, this.matComposite, this.matFXAA]) m.dispose();
    this.quad.geometry.dispose();
  }
};
