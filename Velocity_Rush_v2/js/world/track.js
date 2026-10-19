// ===== Procedural track generator + nearest-sample lookup — carried over unchanged from the original game =====
    const ROAD_WIDTH = 35;
    const SAMPLES = 480;

    function generateTrack(seed) {
      const rng = makeRng(seed);
      const anchorCount = 18 + Math.floor(rng() * 4);
      const baseRadius = 420;

      const allBiomes = ["plains", "forest", "mountain", "cliff", "cliffside", "water", "tunnel"];
      const bandCount = 6 + Math.floor(rng() * 4);
      const biomeBands = [];
      for (let i = 0; i < bandCount; i++) biomeBands.push(allBiomes[Math.floor(rng() * allBiomes.length)]);
      if (!biomeBands.includes("tunnel")) biomeBands[1] = "tunnel";
      if (!biomeBands.includes("water")) biomeBands[biomeBands.length - 1] = "water";
      if (!biomeBands.includes("mountain")) biomeBands[3] = "mountain";
      if (!biomeBands.includes("cliffside")) biomeBands[Math.min(2, biomeBands.length - 1)] = "cliffside";

      const anchors = [];
      for (let i = 0; i < anchorCount; i++) {
        const t = i / anchorCount;
        const angle = t * Math.PI * 2;
        const wob =
          Math.sin(angle * 2 + rng() * 6.28) * 0.22 +
          Math.sin(angle * 3 + rng() * 6.28) * 0.12 +
          Math.sin(angle * 5 + rng() * 6.28) * 0.06 +
          rngRange(rng, -0.1, 0.1);
        const r = baseRadius * (1 + wob);
        const angleJitter = (rng() - 0.5) * (Math.PI * 2 / anchorCount) * 0.55;
        const x = Math.cos(angle + angleJitter) * r;
        const z = Math.sin(angle + angleJitter) * r;

        const biome = biomeBands[Math.floor(t * biomeBands.length) % biomeBands.length];
        let y = 0;
        if (biome === "mountain") y = rngRange(rng, 18, 42);
        else if (biome === "cliff") y = rngRange(rng, 14, 30);
        else if (biome === "cliffside") y = rngRange(rng, 20, 36);
        else if (biome === "water") y = rngRange(rng, 1, 3);
        else if (biome === "tunnel") y = rngRange(rng, 3, 9);
        else if (biome === "forest") y = rngRange(rng, 4, 12);
        else y = rngRange(rng, 0, 6);

        anchors.push(new THREE.Vector3(x, y, z));
      }

      const curve = new THREE.CatmullRomCurve3(anchors, true, "catmullrom", 0.5);
      const positions = curve.getSpacedPoints(SAMPLES);
      const pts = positions.slice(0, SAMPLES);

      // Multi-pass coordinate smoothing for silk-smooth track lines (removes micro S-curves)
      for (let pass = 0; pass < 8; pass++) {
        const smoothX = new Float32Array(SAMPLES);
        const smoothZ = new Float32Array(SAMPLES);
        for (let i = 0; i < SAMPLES; i++) {
          const pPrev = pts[(i - 1 + SAMPLES) % SAMPLES];
          const pCur  = pts[i];
          const pNext = pts[(i + 1) % SAMPLES];
          smoothX[i] = pPrev.x * 0.25 + pCur.x * 0.5 + pNext.x * 0.25;
          smoothZ[i] = pPrev.z * 0.25 + pCur.z * 0.5 + pNext.z * 0.25;
        }
        for (let i = 0; i < SAMPLES; i++) {
          pts[i].x = smoothX[i];
          pts[i].z = smoothZ[i];
        }
      }

      const maxTurn = Math.PI * 0.21;
      function relaxTightCusps(maxPasses) {
        for (let pass = 0; pass < maxPasses; pass++) {
          let anyCorrected = false;
          for (let i = 0; i < SAMPLES; i++) {
            const prev = pts[(i - 1 + SAMPLES) % SAMPLES];
            const cur  = pts[i];
            const next = pts[(i + 1) % SAMPLES];
            const v1x = cur.x - prev.x, v1z = cur.z - prev.z;
            const v2x = next.x - cur.x, v2z = next.z - cur.z;
            const len1 = Math.hypot(v1x, v1z), len2 = Math.hypot(v2x, v2z);
            if (len1 < 1e-4 || len2 < 1e-4) continue;
            const cosA = (v1x * v2x + v1z * v2z) / (len1 * len2);
            const turnAngle = Math.acos(Math.max(-1, Math.min(1, cosA)));
            if (turnAngle > maxTurn) {
              anyCorrected = true;
              const midX = (prev.x + next.x) / 2, midZ = (prev.z + next.z) / 2;
              const pull = Math.min(0.85, (turnAngle - maxTurn) / maxTurn);
              cur.x += (midX - cur.x) * pull;
              cur.z += (midZ - cur.z) * pull;
            }
          }
          if (!anyCorrected) break;
        }
      }
      relaxTightCusps(14);
      const hardMaxTurn = Math.PI * 0.30;
      for (let pass = 0; pass < 6; pass++) {
        let worst = 0;
        for (let i = 0; i < SAMPLES; i++) {
          const prev = pts[(i - 1 + SAMPLES) % SAMPLES];
          const cur  = pts[i];
          const next = pts[(i + 1) % SAMPLES];
          const v1x = cur.x - prev.x, v1z = cur.z - prev.z;
          const v2x = next.x - cur.x, v2z = next.z - cur.z;
          const len1 = Math.hypot(v1x, v1z), len2 = Math.hypot(v2x, v2z);
          if (len1 < 1e-4 || len2 < 1e-4) continue;
          const cosA = (v1x * v2x + v1z * v2z) / (len1 * len2);
          const turnAngle = Math.acos(Math.max(-1, Math.min(1, cosA)));
          worst = Math.max(worst, turnAngle);
          if (turnAngle > hardMaxTurn) {
            const midX = (prev.x + next.x) / 2, midZ = (prev.z + next.z) / 2;
            cur.x += (midX - cur.x) * 0.9;
            cur.z += (midZ - cur.z) * 0.9;
          }
        }
        if (worst <= hardMaxTurn) break;
      }

      const wideWindowRadius = 8;
      const wideTargetTurn = Math.PI * (30 / 180);
      for (let pass = 0; pass < 40; pass++) {
        const newX = new Array(SAMPLES), newZ = new Array(SAMPLES);
        for (let i = 0; i < SAMPLES; i++) { newX[i] = pts[i].x; newZ[i] = pts[i].z; }
        let anyCorrected = false;
        for (let i = 0; i < SAMPLES; i++) {
          const a = pts[(i - wideWindowRadius + SAMPLES) % SAMPLES];
          const b = pts[i];
          const c = pts[(i + wideWindowRadius) % SAMPLES];
          const v1x = b.x - a.x, v1z = b.z - a.z;
          const v2x = c.x - b.x, v2z = c.z - b.z;
          const len1 = Math.hypot(v1x, v1z), len2 = Math.hypot(v2x, v2z);
          if (len1 < 1e-4 || len2 < 1e-4) continue;
          const cosA = (v1x * v2x + v1z * v2z) / (len1 * len2);
          const turnAngle = Math.acos(Math.max(-1, Math.min(1, cosA)));
          if (turnAngle > wideTargetTurn) {
            anyCorrected = true;
            const midX = (a.x + c.x) / 2, midZ = (a.z + c.z) / 2;
            const pull = Math.min(0.45, (turnAngle - wideTargetTurn) / wideTargetTurn * 0.45);
            newX[i] = b.x + (midX - b.x) * pull;
            newZ[i] = b.z + (midZ - b.z) * pull;
          }
        }
        for (let i = 0; i < SAMPLES; i++) { pts[i].x = newX[i]; pts[i].z = newZ[i]; }
        if (!anyCorrected) break;
      }

      relaxTightCusps(14);

      const samples = [];
      const up = new THREE.Vector3(0, 1, 0);
      let totalLength = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const next = pts[(i + 1) % SAMPLES];
        const prev = pts[(i - 1 + SAMPLES) % SAMPLES];
        const tangent = next.clone().sub(prev).normalize();
        const normal = up.clone().cross(tangent).normalize();
        const frac = i / SAMPLES;
        const bandIdx = Math.floor(frac * biomeBands.length) % biomeBands.length;
        const biome = biomeBands[bandIdx];

        samples.push({ pos: pts[i].clone(), tangent, normal, biome });
        totalLength += pts[i].distanceTo(next);
      }

      const ys = new Array(SAMPLES);
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i < SAMPLES; i++) ys[i] = samples[i].pos.y;
        for (let i = 0; i < SAMPLES; i++) {
          const a = ys[(i - 1 + SAMPLES) % SAMPLES];
          const b = ys[i];
          const c = ys[(i + 1) % SAMPLES];
          samples[i].pos.y = (a + 2 * b + c) / 4;
        }
      }

      const segLen = totalLength / SAMPLES;
      const maxSlope = 0.11;
      const maxStep = segLen * maxSlope;
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < SAMPLES; i++) {
          const j = (i + 1) % SAMPLES;
          const dy = samples[j].pos.y - samples[i].pos.y;
          if (dy > maxStep) {
            const mid = (samples[i].pos.y + samples[j].pos.y) / 2;
            samples[i].pos.y = mid - maxStep / 2;
            samples[j].pos.y = mid + maxStep / 2;
          } else if (dy < -maxStep) {
            const mid = (samples[i].pos.y + samples[j].pos.y) / 2;
            samples[i].pos.y = mid + maxStep / 2;
            samples[j].pos.y = mid - maxStep / 2;
          }
        }
      }

      return { samples, totalLength, roadWidth: ROAD_WIDTH, startPos: samples[0].pos.clone(), startTangent: samples[0].tangent.clone() };
    }

    function nearestSampleIndex(track, world, hint) {
      const s = track.samples;
      const n = s.length;
      const wx = world.x, wz = world.z;
      function dist2(i) {
        const p = s[i].pos;
        const dx = p.x - wx, dz = p.z - wz;
        return dx * dx + dz * dz;
      }
      if (hint !== undefined) {
        let best = hint % n;
        let bestD = dist2(best);
        for (let step = 1; step < 48; step++) {
          const fwd = (best + step) % n;
          const bwd = (best - step + n) % n;
          const df = dist2(fwd), db = dist2(bwd);
          if (df < bestD) { bestD = df; best = fwd; }
          else if (db < bestD) { bestD = db; best = bwd; }
          else if (step > 8) break;
        }
        if (bestD < 80000) return best;
      }
      let best = 0, bestD = Infinity;
      for (let i = 0; i < n; i += 4) {
        const d = dist2(i);
        if (d < bestD) { bestD = d; best = i; }
      }
      for (let k = -4; k <= 4; k++) {
        const i = (best + k + n) % n;
        const d = dist2(i);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
