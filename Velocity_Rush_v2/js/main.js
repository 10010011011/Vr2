"use strict";
/* Entry point */
(function () {
  const canvas = document.getElementById("gl");
  let app = null;
  try {
    app = new VR.App(canvas);
  } catch (e) {
    console.error(e);
    const el = document.getElementById("fatal");
    el.classList.remove("hidden");
    el.textContent = "This device could not start the 3D engine (WebGL required).\n\n" + (e && e.message ? e.message : e);
    document.getElementById("boot").classList.add("hidden-boot");
    return;
  }
  VR.app = app;
  VR.ui.init(app);
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => VR.ui.hideBoot(), 350)));
})();
