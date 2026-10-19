// ===== Seeded RNG + neural network (MLP) — carried over unchanged from the original game =====
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

    function makeMLP(shape) {
      const sizes = [shape.inputs, ...shape.hidden, shape.outputs];
      const layers = [];
      for (let i = 0; i < sizes.length - 1; i++) {
        const ni = sizes[i], no = sizes[i + 1];
        const w = new Float32Array(ni * no);
        const b = new Float32Array(no);
        const scale = Math.sqrt(2 / ni);
        for (let k = 0; k < w.length; k++) w[k] = randn() * scale;
        layers.push({ w, b });
      }
      return { shape, layers };
    }

    const SCRATCH_A = new Float32Array(768);
    const SCRATCH_B = new Float32Array(768);

    function forward(w, input) {
      let cur = SCRATCH_A; let nxt = SCRATCH_B;
      for (let i = 0; i < w.shape.inputs; i++) cur[i] = input[i];
      let curLen = w.shape.inputs;
      for (let li = 0; li < w.layers.length; li++) {
        const layer = w.layers[li];
        const outLen = layer.b.length;
        for (let o = 0; o < outLen; o++) {
          let sum = layer.b[o];
          const off = o * curLen;
          for (let i = 0; i < curLen; i++) sum += cur[i] * layer.w[off + i];
          nxt[o] = Math.tanh(sum);
        }
        const tmp = cur; cur = nxt; nxt = tmp;
        curLen = outLen;
      }
      const result = new Float32Array(curLen);
      for (let i = 0; i < curLen; i++) result[i] = cur[i];
      return result;
    }

    function serialize(w) {
      return {
        shape: { inputs: w.shape.inputs, hidden: [...w.shape.hidden], outputs: w.shape.outputs },
        layers: w.layers.map((l) => ({ w: Array.from(l.w), b: Array.from(l.b) })),
      };
    }

    function deserialize(s) {
      return {
        shape: { inputs: s.shape.inputs, hidden: [...s.shape.hidden], outputs: s.shape.outputs },
        layers: s.layers.map((l) => ({ w: Float32Array.from(l.w), b: Float32Array.from(l.b) })),
      };
    }
