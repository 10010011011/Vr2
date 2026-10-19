"use strict";
/* ============================================================================
   Water — analytic shader (no planar-reflection pass): depth-based colour,
   fresnel sky reflection, procedural wave normals, sun glints, shoreline foam.
   Depth comes from a per-vertex attribute (water level − terrain height).
   ========================================================================== */
VR.WATER_Y = -1.5;

VR.makeWaterMaterial = (atm, simple) => {
  const u = atm.skyU;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
  Object.assign(uniforms, {
    uTime: VR.uniforms.uTime,
    uSunDir: u.uSunDir, uZenith: u.uZenith, uMid: u.uMid, uHorizon: u.uHorizon, uGround: u.uGround,
    uSunCol: u.uSunCol, uSunGlow: u.uSunGlow, uBand: u.uBand, uTwi: u.uTwi,
    uShallow: { value: VR.lin(0x2fa5a0) }, uDeep: { value: VR.lin(0x0c3552) },
  });
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: true, defines: { SIMPLE: simple ? 1 : 0 },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      varying vec3 vWorld; varying float vDepth;
      #include <fog_pars_vertex>
      void main() {
        vDepth = aDepth;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld; varying float vDepth;
      uniform float uTime; uniform vec3 uShallow, uDeep;
      ${VR.glsl.noise}
      ${VR.glsl.skyBase}
      #include <fog_pars_fragment>
      float wave(vec2 p) {
        return vrNoise(p * 0.32 + vec2(uTime * 0.33, uTime * 0.17)) * 0.6
             + vrNoise(p * 0.85 - vec2(uTime * 0.5, uTime * 0.29)) * 0.3
             + vrNoise(p * 2.3 + vec2(uTime * 0.9, -uTime * 0.6)) * 0.1;
      }
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;
        float e = 0.35;
        float h0 = wave(p), hx = wave(p + vec2(e, 0.0)), hz = wave(p + vec2(0.0, e));
        vec3 N = normalize(vec3((h0 - hx) * 1.6, e, (h0 - hz) * 1.6));
        // ripples are flattened with distance (and at steep view angles) so the surface never shimmers
        float calm = clamp(smoothstep(30.0, 260.0, dist) + smoothstep(0.35, 0.95, V.y) * 0.55, 0.0, 0.92);
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), calm));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = vrSkyBase(R);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        float depth = max(vDepth, 0.0);
        vec3 light = uMid * 0.55 + uSunCol * uSunGlow * max(uSunDir.y, 0.0) * 0.45 + uHorizon * 0.1;
        vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.5)) * light;
        vec3 col = mix(body, refl, clamp(fres * 0.9 + 0.1, 0.0, 1.0));
        float spec = pow(max(dot(R, uSunDir), 0.0), 260.0) * 3.2 * uSunGlow * (1.0 - calm * 0.6);
        col += uSunCol * spec;
        // shoreline foam
        float n2 = vrNoise(p * 1.4 + uTime * 0.4);
        float foamBand = 1.0 - smoothstep(0.0, 0.55 + n2 * 0.25, vDepth);
        float foamLine = smoothstep(0.35, 0.65, n2 + sin(vDepth * 14.0 - uTime * 1.6) * 0.18);
        col = mix(col, vec3(0.88, 0.93, 0.95) * light * 1.6, foamBand * foamLine * 0.8);
        float alpha = smoothstep(-0.05, 0.4, vDepth) * (0.78 + 0.2 * (1.0 - exp(-depth * 0.4)));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        #include <fog_fragment>
      }`,
  });
};
