// ===== Persistent storage (IndexedDB with localStorage fallback) — carried over unchanged from the original game =====
    const DB_NAME = "velocity-rush-kitsune-v1";
    const STORE   = "kv";
    const LS_PFX  = "velocity-rush-kitsune:";
    let _dbPromise = null;

    function openDB() {
      if (_dbPromise) return _dbPromise;
      _dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") { reject(new Error("no-idb")); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => { _dbPromise = null; reject(new Error("idb-fail")); };
      });
      return _dbPromise;
    }

    async function dbGet(key) {
      try {
        const db = await openDB();
        return await new Promise((res, rej) => {
          const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
          req.onsuccess = () => res(req.result ?? null);
          req.onerror   = () => rej(req.error);
        });
      } catch {
        try { const r = localStorage.getItem(LS_PFX + key); return r ? JSON.parse(r) : null; }
        catch { return null; }
      }
    }

    async function dbPut(key, value) {
      try {
        const db = await openDB();
        await new Promise((res, rej) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => res();
          tx.onerror    = () => rej(tx.error);
        });
      } catch {
        try { localStorage.setItem(LS_PFX + key, JSON.stringify(value)); }
        catch (e) { console.warn("[storage] fallback write failed:", e.message); }
      }
    }

    async function dbDel(key) {
      try {
        const db = await openDB();
        await new Promise((res, rej) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => res();
          tx.onerror    = () => rej(tx.error);
        });
      } catch {
        try { localStorage.removeItem(LS_PFX + key); } catch {}
      }
    }

    async function loadBrain() {
      try { return await dbGet("brain"); } catch { return null; }
    }

    async function saveBrain(b) {
      try { await dbPut("brain", b); } catch (e) { console.warn("[brain] save failed", e); }
    }

    async function clearBrain() {
      try { await dbDel("brain"); } catch (e) { console.warn("[brain] clear failed", e); }
    }
