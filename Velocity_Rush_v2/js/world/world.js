"use strict";
/* ============================================================================
   World orchestrator — builds terrain, road, scenery and structures (yielding
   between stages so the loading screen stays alive) and drives their updates.
   ========================================================================== */
VR.buildWorld = async function buildWorld({ track, info, seed, q, atm, scene, progress }) {
  const P = progress || (() => {});
  const group = new THREE.Group();
  group.name = "world";
  scene.add(group);

  P(0.12, "Sculpting terrain"); await VR.yieldFrame();
  const terrain = VR.buildTerrain(info, seed, q, atm);
  group.add(terrain.group);
  P(0.38, "Laying asphalt"); await VR.yieldFrame();
  const road = VR.buildRoad(info, q, atm);
  group.add(road.group);
  const parts = { terrain, road };
  P(0.5, "Planting scenery"); await VR.yieldFrame();
  if (VR.buildScenery) { parts.scenery = VR.buildScenery(info, terrain, seed, q, atm, road); group.add(parts.scenery.group); }
  P(0.7, "Building structures"); await VR.yieldFrame();
  if (VR.buildStructures) { parts.structures = VR.buildStructures(info, terrain, seed, q, atm, road); group.add(parts.structures.group); }

  const world = {
    group, terrain, road, parts,
    heightAt: terrain.heightAt,
    update(dt, camera, state) {
      road.update(atm.night);
      if (parts.scenery && parts.scenery.update) parts.scenery.update(dt, camera, state);
      if (parts.structures && parts.structures.update) parts.structures.update(dt, camera, state);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture && !v.userData.shared) v.dispose(); } m.dispose(); const i = VR.matRegistry.indexOf(m); if (i >= 0) VR.matRegistry.splice(i, 1); } }
      });
    },
  };
  return world;
};
