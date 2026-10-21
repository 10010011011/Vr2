// ===== Seeded RNG helpers (the old untrained neural net was removed; learning now lives in opponents.js) =====
    function makeRng(seed) {
      let a = (seed | 0) >>> 0;
      return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function rngRange(rng, min, max) {
      return min + rng() * (max - min);
    }

    function randn() {
      const u = Math.max(1e-9, Math.random());
      const v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
