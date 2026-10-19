"use strict";
/* ============================================================================
   Shared GLSL snippets + helpers to patch MeshStandardMaterial
   ========================================================================== */
VR.glsl = {};

VR.glsl.noise = /* glsl */ `
float vrHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vrHash3(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
float vrNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = vrHash(i), b = vrHash(i + vec2(1.0, 0.0)), c = vrHash(i + vec2(0.0, 1.0)), d = vrHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vrFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vrNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
float vrFbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vrNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
`;

/** Analytic sky gradient (no clouds/stars) — shared by the sky dome, water and env capture. */
VR.glsl.skyBase = /* glsl */ `
uniform vec3 uSunDir, uZenith, uMid, uHorizon, uGround, uSunCol, uBand;
uniform float uSunGlow, uTwi;
vec3 vrSkyBase(vec3 d) {
  float y = d.y;
  float h = clamp(y, 0.0, 1.0);
  float tw = uTwi;
  // at twilight the warm colours hug the horizon and the blue takes over sooner (like a real dusk gradient)
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, mix(0.2, 0.28, tw), h));
  col = mix(col, uZenith, smoothstep(mix(0.1, 0.22, tw), mix(0.8, 0.75, tw), h));
  vec2 hd = normalize(d.xz + 1e-5);
  vec2 sdz = normalize(uSunDir.xz + 1e-5);
  float az = max(dot(hd, sdz), 0.0);
  // soft pink band just above the horizon glow, strongest toward the sun but wrapping the whole sky
  float tb = exp(-pow((y - mix(0.15, 0.1, tw)) / mix(0.15, 0.09, tw), 2.0));
  col = mix(col, uBand, clamp(tb * tw * (0.45 + 0.55 * az * az), 0.0, 0.85));
  col = mix(col, uGround, 1.0 - smoothstep(-0.22, 0.0, y));
  float sd = max(dot(d, uSunDir), 0.0);
  float glow = pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.55 + pow(sd, 420.0) * 2.2;
  col += uSunCol * glow * uSunGlow;
  float azi = pow(az, 3.0);
  float lowSun = 1.0 - smoothstep(0.15, 0.55, uSunDir.y);
  col += uSunCol * azi * exp(-abs(y) * 7.0) * uSunGlow * 0.4 * lowSun;
  return col;
}
`;

VR.glsl.aces = /* glsl */ `
vec3 vrACES(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
`;

/** Shared time/wind uniform object (updated once per frame by the game). */
VR.uniforms = {
  uTime: { value: 0 },
  uWind: { value: 1.0 },
  uNight: { value: 0.0 },
};

/** Registry of PBR materials so global ambient scale (tunnels, night) can be applied. */
VR.matRegistry = [];
VR.reg = (m, envBase) => {
  m.userData.envBase = envBase !== undefined ? envBase : (m.envMapIntensity !== undefined ? m.envMapIntensity : 1);
  VR.matRegistry.push(m);
  return m;
};
VR.setAmbientScale = (s) => {
  for (const m of VR.matRegistry) m.envMapIntensity = m.userData.envBase * s;
};

/**
 * Patch a MeshStandardMaterial/MeshPhysicalMaterial.
 * opts: { key, uniforms, vertexDecl, vertexMain, fragDecl, fragAfterColor, fragAfterNormal, fragEmissive, worldPos }
 * `vWorldPos` varying is provided when worldPos:true (instancing-aware).
 */
VR.patch = (mat, opts) => {
  const key = opts.key || "patch";
  mat.onBeforeCompile = (shader) => {
    if (opts.uniforms) Object.assign(shader.uniforms, opts.uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    const vDecl = (opts.worldPos ? "varying vec3 vWorldPos;\n" : "") + (opts.vertexDecl || "");
    vs = vs.replace("#include <common>", "#include <common>\n" + vDecl);
    let vMain = "";
    if (opts.vertexMain) vMain += opts.vertexMain + "\n";
    if (opts.worldPos) {
      vMain += `
        #ifdef USE_INSTANCING
          vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
      `;
    }
    vs = vs.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + vMain);
    // when vertexMain modifies `transformed`, worldPos should be computed after: handled by ordering above
    const fDecl = (opts.worldPos ? "varying vec3 vWorldPos;\n" : "") + (opts.fragDecl || "");
    fs = fs.replace("#include <common>", "#include <common>\n" + fDecl);
    if (opts.fragAfterColor) fs = fs.replace("#include <color_fragment>", "#include <color_fragment>\n" + opts.fragAfterColor);
    if (opts.fragRoughness) fs = fs.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + opts.fragRoughness);
    if (opts.fragAfterNormal) fs = fs.replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + opts.fragAfterNormal);
    if (opts.fragMetal) fs = fs.replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n" + opts.fragMetal);
    if (opts.fragEmissive) fs = fs.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + opts.fragEmissive);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
};
