"use strict";
/* ============================================================================
   gameStore — shared state between the sim, HUD and menus.
   API-compatible with the original store (the opponent AI reads
   `gameStore.oppNitroMult`) but UI updates now go through subscribers.
   ========================================================================== */
const defaultStats = { generation: 0, races: 0, bestFitness: 0, lastFitness: 0, wins: 0 };

const gameStore = {
  opponent: "scripted",
  laps: 2,
  seed: Math.floor(Math.random() * 1e9),
  difficulty: "normal",
  oppNitroMult: 1,

  // live race state
  speed: 0, nitro: 1, nitroActive: false, position: 1, lap: 1, progress: 0,
  lapTimeMs: 0, message: null, finished: null, paused: false,
  gear: 1, countdown: null, brainStats: { ...defaultStats },

  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  _emit(kind) { for (const fn of this._subs) fn(this, kind); },

  setOpponent(o) { this.opponent = o; this._emit("menu"); },
  setOppNitroMult(m) { this.oppNitroMult = m; this._emit("menu"); },
  setLaps(n) { this.laps = n; this._emit("menu"); },
  reseed() { this.seed = Math.floor(Math.random() * 1e9); },
  setHud(p) { Object.assign(this, p); this._emit("hud"); },
  reset() {
    Object.assign(this, {
      speed: 0, nitro: 1, nitroActive: false, position: 1, lap: 1, progress: 0,
      lapTimeMs: 0, message: null, finished: null, paused: false, gear: 1, countdown: null,
    });
    this._emit("hud");
  },
  setBrainStats(s) { this.brainStats = s; this._emit("brain"); },
};

const useGame = { getState: () => gameStore };
