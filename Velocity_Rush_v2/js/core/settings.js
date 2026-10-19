"use strict";
/* ============================================================================
   Quality presets + persisted user settings
   ========================================================================== */
VR.QUALITY = {
  low: {
    label: "Low", pixelRatio: 1.0, shadows: false, shadowMap: 1024, shadowRadius: 50,
    msaa: 0, bloom: false, bloomLevels: 4, rays: false, terrainCell: 12, terrainBand: 170,
    trees: 0.45, grass: 0.0, rocks: 0.6, props: 0.6, particles: 0.55, skid: false, envUpdate: false,
    cloudOct: 3, water: "simple", detailTex: false,
  },
  medium: {
    label: "Medium", pixelRatio: 1.25, shadows: true, shadowMap: 1024, shadowRadius: 55,
    msaa: 0, bloom: true, bloomLevels: 4, rays: false, terrainCell: 8, terrainBand: 200,
    trees: 0.75, grass: 0.45, rocks: 0.85, props: 0.85, particles: 0.8, skid: true, envUpdate: true,
    cloudOct: 4, water: "full", detailTex: true,
  },
  high: {
    label: "High", pixelRatio: 1.75, shadows: true, shadowMap: 2048, shadowRadius: 70,
    msaa: 4, bloom: true, bloomLevels: 5, rays: true, terrainCell: 6, terrainBand: 230,
    trees: 1.0, grass: 0.8, rocks: 1.0, props: 1.0, particles: 1.0, skid: true, envUpdate: true,
    cloudOct: 5, water: "full", detailTex: true,
  },
  ultra: {
    label: "Ultra", pixelRatio: 2.5, shadows: true, shadowMap: 4096, shadowRadius: 85,
    msaa: 4, bloom: true, bloomLevels: 6, rays: true, terrainCell: 5, terrainBand: 250,
    trees: 1.25, grass: 1.0, rocks: 1.15, props: 1.0, particles: 1.25, skid: true, envUpdate: true,
    cloudOct: 5, water: "full", detailTex: true,
  },
};

VR.settings = {
  quality: "auto",        // auto | low | medium | high | ultra
  camera: "chase",        // chase | far | bumper
  timeOfDay: "dynamic",   // dynamic | dawn | day | sunset | night
  showFps: false,
  _loaded: false,
};

VR.loadSettings = () => {
  try {
    const raw = localStorage.getItem("velocity-rush:settings");
    if (raw) Object.assign(VR.settings, JSON.parse(raw));
  } catch (e) { /* storage may be unavailable */ }
  VR.settings._loaded = true;
};
VR.saveSettings = () => {
  try { localStorage.setItem("velocity-rush:settings", JSON.stringify(VR.settings)); } catch (e) { /* ignore */ }
};

/** Resolve "auto" to a concrete preset (mobile → medium, desktop → high). */
VR.resolveQualityName = () => {
  const q = VR.settings.quality;
  if (q && q !== "auto" && VR.QUALITY[q]) return q;
  return VR.isMobile() ? "medium" : "high";
};
VR.getQuality = () => {
  const q = Object.assign({}, VR.QUALITY[VR.resolveQualityName()]);
  q.pixelRatio = Math.min(q.pixelRatio, Math.max(1, window.devicePixelRatio || 1));
  return q;
};

VR.loadSettings();
