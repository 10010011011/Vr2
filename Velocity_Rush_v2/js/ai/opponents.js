// ===== Opponent AI: tuned racing-line driver (Low/Medium/High) + tactical driver (Max) + real parameter learner =====
    const SCRIPTED_LOOKAHEAD = 18;
    class ScriptedOpponent {
      constructor(track, speedBoost = 1.0, aLat = 320, vTop = 88, opt = {}) {
        this.track = track;
        this.opt = opt;
        this.nitroOn = opt.nitroOn !== false;
        this.rubber = opt.rubber !== false;
        this.speedBoost = speedBoost;
        const n = track.samples.length;
        const s = track.samples;

        this.cornerSharpness = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const a = s[(i - 3 + n) % n], b = s[(i + 3) % n];
          let diff = Math.atan2(b.tangent.x, b.tangent.z) - Math.atan2(a.tangent.x, a.tangent.z);
          while (diff >  Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          this.cornerSharpness[i] = Math.abs(diff);
        }

        this.racingLine = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const a = s[(i - 6 + n) % n], b = s[(i + 6) % n];
          let diff = Math.atan2(b.tangent.x, b.tangent.z) - Math.atan2(a.tangent.x, a.tangent.z);
          while (diff >  Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const farAhead = s[(i + 14) % n];
          const nearAhead = s[(i + 6) % n];
          let farDiff = Math.atan2(farAhead.tangent.x, farAhead.tangent.z) - Math.atan2(nearAhead.tangent.x, nearAhead.tangent.z);
          while (farDiff >  Math.PI) farDiff -= Math.PI * 2;
          while (farDiff < -Math.PI) farDiff += Math.PI * 2;
          const combined = diff * 0.75 + farDiff * 0.25;
          this.racingLine[i] = -Math.sign(combined) * Math.tanh(Math.abs(combined) * 2.5) * 0.52;
        }

        const A_LAT   = aLat;
        const A_BRAKE = 42;
        const A_ACCEL = 32;
        const V_TOP   = vTop;
        const DIST_PER_SAMPLE = track.totalLength / n;

        this.vMax = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const kappa = this.cornerSharpness[i] / DIST_PER_SAMPLE;
          this.vMax[i] = kappa > 0.0008
            ? Math.min(V_TOP, Math.sqrt(A_LAT / kappa))
            : V_TOP;
        }

        for (let pass = 0; pass < 3; pass++) {
          for (let i = n - 1; i >= 0; i--) {
            const next = (i + 1) % n;
            const vNext = this.vMax[next];
            const vBrake = Math.sqrt(Math.max(0, vNext * vNext + 2 * A_BRAKE * DIST_PER_SAMPLE));
            if (vBrake < this.vMax[i]) this.vMax[i] = vBrake;
          }
        }

        for (let pass = 0; pass < 3; pass++) {
          for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            const vPrev = this.vMax[prev];
            const vAccel = Math.sqrt(Math.max(0, vPrev * vPrev + 2 * A_ACCEL * DIST_PER_SAMPLE));
            if (vAccel < this.vMax[i]) this.vMax[i] = vAccel;
          }
        }
      }

      update(self, opponent, _dt, bottles) {
        const n = this.track.samples.length;
        const idx = nearestSampleIndex(this.track, self.pos, self.progress);
        const spd = Math.abs(self.speed);

        let vTarget = this.vMax[idx] * this.speedBoost;
        for (let k = 1; k <= 8; k++) {
          vTarget = Math.min(vTarget, this.vMax[(idx + k) % n] * this.speedBoost);
        }

        let throttle;
        const speedErr = spd - vTarget;
        if (speedErr > 1.5) {
          throttle = Math.max(-1.0, -speedErr * 0.06);
        } else {
          throttle = 1.0;
        }

        if (!self._nitroState) { self._nitroState = 'BLAST'; self._nitroCooldownT = 0; }
        const vMaxHere = this.vMax[idx];
        const nitroCornerSafe = vMaxHere > 30;
        if (self._nitroState === 'BLAST') {
          if (self.nitroCharge < 0.02) {
            self._nitroState = 'COOLDOWN';
            self._nitroCooldownT = 3.0;
          }
        } else {
          self._nitroCooldownT = Math.max(0, (self._nitroCooldownT || 3) - _dt);
          if (self._nitroCooldownT <= 0) self._nitroState = 'BLAST';
        }
        const nitro = this.nitroOn && self._nitroState === 'BLAST' && self.nitroCharge > 0.02 && nitroCornerSafe;

        const gap = opponent.totalProgress - self.totalProgress;
        if (this.rubber && gap > 30) throttle = Math.min(1.0, throttle + 0.08);

        const kHere = this.cornerSharpness[idx];
        const cornerTighten = 1 / (1 + kHere * 4.5);
        const lookahead = Math.max(8, Math.min(28, Math.floor(spd * 0.28 * cornerTighten)));
        const aheadIdx = (idx + lookahead) % n;
        const aSample  = this.track.samples[aheadIdx];
        const rl = this.racingLine[aheadIdx];

        const seek = findSeekableBottle(self, this.track, bottles, this.cornerSharpness, 40);
        const lineRl = seek ? rl * 0.35 + seek.lateralBias * 0.65 : rl;

        const target = aSample.pos.clone().addScaledVector(
          aSample.normal, lineRl * this.track.roadWidth * 0.44
        );

        const dx = target.x - self.pos.x;
        const dz = target.z - self.pos.z;
        const desired = Math.atan2(dx, dz);
        let diff = desired - self.heading;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const steerGain = 2.0 + kHere * 5.0;
        const steer = Math.max(-1, Math.min(1, diff * steerGain));

        return { throttle, steer, nitro, jump: false };
      }
    }

    /* Max: same fair physics as the player, plus tactics — overtake lines, nitro stealing,
       bottle seeking and a light catch-up assist. P = { boost, aLat, vTop, nitroMin, catchUp } */
    class ImpossibleOpponent {
      constructor(track, P = {}) {
        this.track = track;
        this.P = P;
        this.base = new ScriptedOpponent(track, P.boost || 1.0, P.aLat || 320, P.vTop || 88);
      }
      update(self, opponent, _dt, bottles) {
        const n   = this.track.samples.length;
        const idx = nearestSampleIndex(this.track, self.pos, self.progress);
        const spd = Math.abs(self.speed);
        const base = this.base, P = this.P;

        let vTarget = base.vMax[idx] * base.speedBoost;
        for (let k = 1; k <= 10; k++) {
          vTarget = Math.min(vTarget, base.vMax[(idx + k) % n] * base.speedBoost);
        }

        const speedErr = spd - vTarget;
        let throttle = speedErr > 1 ? Math.max(-1, -speedErr * (P.brakeK || 0.08)) : 1.0;

        const gap = self.totalProgress - opponent.totalProgress;
        if (gap > 400) throttle = Math.min(throttle, 0.6);
        else if (gap < -10 && P.catchUp) {
          const deficit = Math.min(1, (-gap - 10) / 100);
          throttle = Math.min(1, throttle + P.catchUp * (0.4 + deficit * 0.6));
        }

        const oppMult = (typeof gameStore !== 'undefined' && gameStore.oppNitroMult) || 1;
        const minChargeToFire = Math.max(0.10, (P.nitroMin || 0.48) - (oppMult - 1) * 0.09);
        const nitroCornerOk = base.vMax[idx] > (P.nitroCorner || 30);

        if (!self._nitroActive) {
          if (self.nitroCharge >= minChargeToFire && nitroCornerOk) self._nitroActive = true;
        } else if (self.nitroCharge <= 0.02 || !nitroCornerOk) {
          self._nitroActive = false;
        }
        const nitro = !!self._nitroActive;

        const kHere = base.cornerSharpness[idx];
        const cornerTighten = 1 / (1 + kHere * 6.0);
        const lookahead = Math.max(6, Math.min(24, Math.floor(spd * 0.24 * cornerTighten)));
        const aheadIdx  = (idx + lookahead) % n;
        const aSample   = this.track.samples[aheadIdx];
        let cornerRl = base.racingLine[aheadIdx];

        const closeBehindPlayer = gap < 0 && gap > -30;
        if (closeBehindPlayer && kHere < 0.05) {
          const playerSample = this.track.samples[nearestSampleIndex(this.track, opponent.pos, opponent.progress)];
          const playerLateral = opponent.pos.clone().sub(playerSample.pos).dot(playerSample.normal);
          const playerLateralNorm = THREE.MathUtils.clamp(playerLateral / (this.track.roadWidth / 2), -1, 1);
          const overtakeSide = playerLateralNorm >= 0 ? -1 : 1;
          const overtakeCloseness = THREE.MathUtils.clamp((30 + gap) / 30, 0, 1);
          const overtakeWeight = 0.15 + overtakeCloseness * 0.35;
          cornerRl = cornerRl * (1 - overtakeWeight) + overtakeSide * 0.45 * overtakeWeight;
        }

        const steal = findStealableBottle(self, opponent, this.track, bottles, base.cornerSharpness, 70, gap);
        const seek  = steal ? null : findSeekableBottle(self, this.track, bottles, base.cornerSharpness, 50);
        const grab  = steal || seek;
        const grabWeight = steal ? 0.90 : 0.70;
        const lineRl = grab ? cornerRl * (1 - grabWeight) + grab.lateralBias * grabWeight : cornerRl;

        const target = aSample.pos.clone().addScaledVector(aSample.normal, lineRl * this.track.roadWidth * 0.46);
        if (grab) {
          const bottleSample = this.track.samples[grab.bottle.idx % n];
          const bottleTarget = bottleSample.pos.clone().addScaledVector(bottleSample.tangent, 2.5);
          target.lerp(bottleTarget, grabWeight);
        }
        const dx = target.x - self.pos.x, dz = target.z - self.pos.z;
        let diff = Math.atan2(dx, dz) - self.heading;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const steerGain = 3.2 + kHere * 8.0;
        const steer = Math.max(-1, Math.min(1, diff * steerGain));
        return { throttle, steer, nitro, jump: false };
      }
    }

    /* ---------------- difficulty ladder (fair physics for everyone) ---------------- */
    const DIFFICULTY = {
      low:    { name: "Low",    kind: "scripted", boost: 0.72, aLat: 230, vTop: 70, nitroOn: false, rubber: false, cap: 0.05 },
      medium: { name: "Medium", kind: "scripted", boost: 0.86, aLat: 270, vTop: 78, nitroOn: true,  rubber: false, cap: 0.05 },
      high:   { name: "High",   kind: "scripted", boost: 1.05, aLat: 320, vTop: 88, nitroOn: true,  rubber: true,  cap: 0.04 },
      max:    { name: "Max",    kind: "max",      boost: 1.25, aLat: 400, vTop: 88, nitroMin: 0.4, nitroCorner: 30, catchUp: 0.1, brakeK: 0.08, accelMul: 1.10, topMul: 1.035, cap: 0.008 }
    };

    /* Real learner: evolves 3 knobs t=[pace, cornering, nitro] in [0,1] across races (1+1 evolution strategy).
       Each race tries best + gaussian noise; if the rival did better against you (further ahead / won), the
       trial becomes the new best. Knobs only move inside each difficulty's small band (cap), so Max stays beatable. */
    const Learner = {
      fresh() { return { v: 2, best: [0, 0, 0], bestScore: -1e9, trial: null, stats: { generation: 0, races: 0, bestFitness: 0, lastFitness: 0, wins: 0 }, sigma: 0.35 }; },
      propose(brain) {
        const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
        brain.trial = brain.best.map((x) => Math.min(1, Math.max(0, x + g() * brain.sigma)));
        if (brain.stats.races === 0) brain.trial = [0.5, 0.5, 0.5];
        return brain.trial.slice();
      },
      /* score: positive when the rival ends ahead of you (metres, +bonus for a win) */
      report(brain, aiWon, gapMeters) {
        const gm = Math.min(600, gapMeters), score = (aiWon ? 400 + gm : -gm);
        const st = brain.stats;
        st.races++; st.lastFitness = score; if (!aiWon) st.wins++;   // wins = player's wins against Felix
        if (score > brain.bestScore) { brain.bestScore = score; if (brain.trial) brain.best = brain.trial.slice(); st.generation++; st.bestFitness = Math.max(st.bestFitness, score); }
        brain.sigma = Math.max(0.12, brain.sigma * 0.96);
        return brain;
      }
    };

    function makeOpponent(track, level, theta) {
      const D = DIFFICULTY[level] || DIFFICULTY.high;
      const t = theta || [0, 0, 0];
      const boost = D.boost * (1 + D.cap * t[0]);
      const aLat = D.aLat * (1 + 0.12 * t[1]);
      const nitroMin = (D.nitroMin || 0.45) - 0.12 * t[2];
      if (D.kind === "max") return new ImpossibleOpponent(track, { boost, aLat, vTop: D.vTop, nitroMin, nitroCorner: D.nitroCorner, catchUp: D.catchUp, brakeK: D.brakeK });
      return new ScriptedOpponent(track, boost, aLat, D.vTop, { nitroOn: D.nitroOn, rubber: D.rubber });
    }
