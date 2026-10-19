// ===== Opponent AI (Scripted + Impossible/Felix v3) and feature extraction — carried over unchanged =====
    const SCRIPTED_LOOKAHEAD = 18;
    const NEURAL_HZ = 60;
    const NN_INPUTS = 44;
    const NN_HIDDEN = [192, 192, 128, 64];
    const NN_OUTPUTS = 5;

    class ScriptedOpponent {
      constructor(track, speedBoost = 1.0, aLat = 320, vTop = 88) {
        this.track = track;
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
        const nitro = self._nitroState === 'BLAST' && self.nitroCharge > 0.02 && nitroCornerSafe;

        const gap = opponent.totalProgress - self.totalProgress;
        if (gap > 30) throttle = Math.min(1.0, throttle + 0.08);

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

    class ImpossibleOpponent {
      constructor(track, weights = null, generation = 0) {
        this.track = track;
        this.base = new ScriptedOpponent(track, 1.28, 600, 115);
        this.weights = weights;
        this._generation = generation;
        this.lastNetTickAt = 0;
        this.lastNetOut = null;
      }
      update(self, opponent, _dt, bottles) {
        const n   = this.track.samples.length;
        const idx = nearestSampleIndex(this.track, self.pos, self.progress);
        const spd = Math.abs(self.speed);
        const base = this.base;

        let vTarget = base.vMax[idx] * base.speedBoost;
        for (let k = 1; k <= 10; k++) {
          vTarget = Math.min(vTarget, base.vMax[(idx + k) % n] * base.speedBoost);
        }

        const speedErr = spd - vTarget;
        let throttle = speedErr > 1 ? Math.max(-1, -speedErr * 0.08) : 1.0;

        const gap = self.totalProgress - opponent.totalProgress;
        if (gap > 500) throttle = Math.min(throttle, 0.6);
        else if (gap < -10) {
          const deficit = Math.min(1, (-gap - 10) / 100);
          throttle = Math.min(1, throttle + 0.15 + deficit * 0.35);
        }

        // Refined Nitro activation threshold scaling (proper 1x vs 5x distinction)
        const oppMult = (typeof gameStore !== 'undefined' && gameStore.oppNitroMult) || 1;
        const minChargeToFire = Math.max(0.10, 0.48 - (oppMult - 1) * 0.09);
        const nitroCornerOk = base.vMax[idx] > 22;

        if (!self._nitroActive) {
          if (self.nitroCharge >= minChargeToFire && nitroCornerOk) {
            self._nitroActive = true;
          }
        } else {
          if (self.nitroCharge <= 0.02 || !nitroCornerOk) {
            self._nitroActive = false;
          }
        }
        const nitro = !!self._nitroActive;

        let netSteerSuggestion = null, netConfidence = 0, netCatchAwareness = 0, netStability = 1;
        if (this.weights) {
          const now = performance.now();
          if (now - this.lastNetTickAt >= 1000 / NEURAL_HZ || !this.lastNetOut) {
            this.lastNetTickAt = now;
            const catchUp = (opponent.totalProgress - self.totalProgress) / 50;
            const feats = buildFeatures(self, opponent, this.track, catchUp);
            const out = forward(this.weights, feats);
            const newSteer = out[0];
            if (this.lastNetOut) {
              const jump = Math.abs(newSteer - this.lastNetOut.steer);
              this._steerVolatility = (this._steerVolatility ?? 0) * 0.7 + jump * 0.3;
            }
            this.lastNetOut = {
              steer: newSteer,
              confidence: (out[4] + 1) * 0.5,
              catchAwareness: Math.max(0, catchUp),
              stability: Math.max(0, 1 - (this._steerVolatility ?? 0) * 3),
            };
          }
          netSteerSuggestion = this.lastNetOut.steer;
          netConfidence = this.lastNetOut.confidence;
          netCatchAwareness = this.lastNetOut.catchAwareness;
          netStability = this.lastNetOut.stability;
        }

        const kHere = base.cornerSharpness[idx];
        const cornerTighten = 1 / (1 + kHere * 6.0);
        const lookahead = Math.max(6, Math.min(22, Math.floor(spd * 0.22 * cornerTighten)));
        const aheadIdx  = (idx + lookahead) % n;
        const aSample   = this.track.samples[aheadIdx];
        const rl = base.racingLine[aheadIdx];

        let cornerRl = rl;
        if (netSteerSuggestion !== null && kHere > 0.03) {
          const cornerNudgeWeight = Math.min(0.35, netConfidence * 0.4) * netStability;
          cornerRl = rl * (1 - cornerNudgeWeight) + netSteerSuggestion * cornerNudgeWeight;
        }

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

        const stealLookahead = 70 + Math.round(netCatchAwareness * 15);
        const steal = findStealableBottle(self, opponent, this.track, bottles, base.cornerSharpness, stealLookahead, gap);
        const seek  = steal ? null : findSeekableBottle(self, this.track, bottles, base.cornerSharpness, 50);
        const grab  = steal || seek;
        const grabWeight = steal ? 0.90 : 0.70;
        const lineRl = grab ? cornerRl * (1 - grabWeight) + grab.lateralBias * grabWeight : cornerRl;

        const target = aSample.pos.clone().addScaledVector(
          aSample.normal, lineRl * this.track.roadWidth * 0.46
        );

        if (grab) {
          const bottleSample = this.track.samples[grab.bottle.idx % n];
          const bottleTarget = bottleSample.pos.clone().addScaledVector(bottleSample.tangent, 2.5);
          target.lerp(bottleTarget, grabWeight);
        }
        const dx = target.x - self.pos.x;
        const dz = target.z - self.pos.z;
        const desired = Math.atan2(dx, dz);
        let diff = desired - self.heading;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const steerGain = 3.2 + kHere * 8.0;
        const steer = Math.max(-1, Math.min(1, diff * steerGain));

        return { throttle, steer, nitro, jump: false };
      }
    }

    const _featureScriptedCache = new Map();
    function getFeatureScripted(track) {
      const k = track.startPos.x;
      if (!_featureScriptedCache.has(k)) _featureScriptedCache.set(k, new ScriptedOpponent(track, 1.0));
      if (_featureScriptedCache.size > 6) _featureScriptedCache.delete(_featureScriptedCache.keys().next().value);
      return _featureScriptedCache.get(k);
    }

    function buildFeatures(self, opp, track, catchUp = 0) {
      const f = new Float32Array(NN_INPUTS);
      const n = track.samples.length;
      const idx = nearestSampleIndex(track, self.pos, self.progress);
      const s = track.samples[idx];
      const lateral = self.pos.clone().sub(s.pos).dot(s.normal);
      const trackHeading = Math.atan2(s.tangent.x, s.tangent.z);
      let headingErr = self.heading - trackHeading;
      while (headingErr > Math.PI) headingErr -= Math.PI * 2;
      while (headingErr < -Math.PI) headingErr += Math.PI * 2;
      const sc = getFeatureScripted(track);

      f[0] = Math.tanh(self.speed / 60);
      f[1] = Math.tanh(lateral / (track.roadWidth / 2));
      f[2] = headingErr / Math.PI;
      f[3] = Math.tanh((self.speed - sc.vMax[idx]) / 30);

      for (let k = 0; k < 12; k++) {
        const step = 3 + k * 4;
        const a = track.samples[(idx + step) % n];
        const b = track.samples[(idx + step + 2) % n];
        const ca = Math.atan2(a.tangent.x, a.tangent.z);
        const cb = Math.atan2(b.tangent.x, b.tangent.z);
        let cv = cb - ca;
        while (cv > Math.PI) cv -= Math.PI * 2;
        while (cv < -Math.PI) cv += Math.PI * 2;
        f[4 + k] = Math.tanh(cv * 6);
      }

      for (let k = 0; k < 6; k++) {
        const step = 4 + k * 6;
        const a = track.samples[(idx + step) % n];
        const off = self.pos.clone().sub(a.pos).dot(a.normal);
        f[16 + k] = Math.tanh(off / (track.roadWidth / 2));
      }

      for (let k = 0; k < 4; k++) {
        const lookSteps = [4, 10, 20, 36][k];
        const vAhead = sc.vMax[(idx + lookSteps) % n];
        f[22 + k] = Math.tanh((vAhead - self.speed) / 40);
      }

      for (let k = 0; k < 4; k++) {
        const lookSteps = [6, 12, 20, 32][k];
        f[26 + k] = sc.racingLine[(idx + lookSteps) % n];
      }

      const dx = opp.pos.x - self.pos.x;
      const dz = opp.pos.z - self.pos.z;
      f[30] = Math.tanh(dx / 40);
      f[31] = Math.tanh(dz / 40);
      f[32] = Math.tanh(Math.hypot(dx, dz) / 40);

      f[33] = self.nitroCharge;
      f[34] = (self._nitroState || 'BLAST') === 'BLAST' ? 1 : -1;
      f[35] = Math.max(0, (self._nitroCooldownT || 0) / 3.0);
      f[36] = self.airborne ? 1 : 0;
      f[37] = self.knockoutMs > 0 ? 1 : 0;

      f[38] = Math.tanh((self.totalProgress - opp.totalProgress) / 100);
      f[39] = Math.tanh(catchUp);
      f[40] = self.speed > 0 ? 1 : -1;

      const windows = [8, 20, 40];
      for (let w = 0; w < 3; w++) {
        let maxC = 0;
        for (let k = 0; k < windows[w]; k++) {
          const a2 = track.samples[(idx + k) % n];
          const b2 = track.samples[(idx + k + 1) % n];
          const d1 = Math.atan2(a2.tangent.x, a2.tangent.z);
          const d2 = Math.atan2(b2.tangent.x, b2.tangent.z);
          let dd = d2 - d1;
          while (dd > Math.PI) dd -= Math.PI * 2;
          while (dd < -Math.PI) dd += Math.PI * 2;
          maxC = Math.max(maxC, Math.abs(dd));
        }
        f[41 + w] = Math.tanh(maxC * 8);
      }
      return f;
    }
