// ===== Opponent nitro-bottle seeking helpers — carried over unchanged from the original game =====
    function findSeekableBottle(self, track, bottles, cornerSharpness, maxLookSamples = 40) {
      if (!bottles || self.nitroCharge > 0.6) return null;
      const n = track.samples.length;
      let best = null, bestScore = -Infinity;
      for (const b of bottles) {
        if (b.taken) continue;
        let aheadSamples = b.idx - self.progress;
        if (aheadSamples < 0) aheadSamples += n;
        if (aheadSamples > maxLookSamples) continue;
        if (aheadSamples < 1) continue;
        const localCorner = cornerSharpness[self.progress % n];
        if (localCorner > 0.045) continue;
        const urgency = (1 - self.nitroCharge);
        const score = urgency * 10 - aheadSamples * 0.08;
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (!best) return null;
      const s = track.samples[best.idx];
      const lateral = best.pos.clone().sub(s.pos).dot(s.normal);
      const lateralBias = Math.max(-1, Math.min(1, lateral / (track.roadWidth / 2)));
      return { bottle: best, lateralBias };
    }

    function findStealableBottle(self, player, track, bottles, cornerSharpness, maxLookSamples = 70, gapToPlayer = null) {
      if (!bottles) return null;
      const n = track.samples.length;
      const localCorner = cornerSharpness[self.progress % n];
      if (localCorner > 0.07) return null;
      let riskDiscount = 1;
      if (gapToPlayer !== null && gapToPlayer > 0 && gapToPlayer < 25) {
        if (gapToPlayer < 10) return null;
        riskDiscount = (gapToPlayer - 10) / 15;
      }
      let best = null, bestScore = -Infinity;
      for (const b of bottles) {
        if (b.taken) continue;
        let selfAhead = b.idx - self.progress;
        if (selfAhead < 0) selfAhead += n;
        if (selfAhead > maxLookSamples || selfAhead < 1) continue;
        let playerAhead = b.idx - player.progress;
        if (playerAhead < 0) playerAhead += n;
        if (playerAhead > maxLookSamples + 25) continue;
        if (selfAhead > playerAhead + 18) continue;
        const advantageBonus = selfAhead < playerAhead ? (playerAhead - selfAhead) * 2.5 : 0;
        const tankBonus = (1 - player.nitroCharge) * 8;
        const score = (advantageBonus + tankBonus - selfAhead * 0.08) * riskDiscount;
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (!best) return null;
      const s = track.samples[best.idx % n];
      const lateral = best.pos.clone().sub(s.pos).dot(s.normal);
      const lateralBias = Math.max(-1, Math.min(1, lateral / (track.roadWidth / 2)));
      return { bottle: best, lateralBias };
    }
