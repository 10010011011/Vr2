# Velocity Rush v2 — graphics & UI rebuild

Same game, rebuilt visuals. Gameplay, physics, track generator, AI is now four fair-physics difficulties (Low / Medium / High / Max) with an optional on-device learning rival (Medium and up).

## Run
Open `index.html` (or `game.html`, the APK home page) in any modern browser, or wrap the folder as an APK (`app-config.json` is included, package `com.kitsune.velocityrush`). Everything is offline: Three.js r128 and fonts are bundled.

## Controls
Keyboard: W/S or ↑/↓ throttle & brake, A/D or ←/→ steer, Space nitro, Shift jump, P / Esc pause. Touch: joystick + NITRO button.

## Structure
- `js/gfx/` renderer pipeline: HDR post (bloom, ACES, grading), procedural sky/atmosphere, textures, water, car models, particles.
- `js/world/` track info, terrain, road, scenery (trees/rocks/grass), structures (tunnels, bridges, start gantry).
- `js/game/` race logic + input, `js/ai/` opponents (unchanged), `js/ui/` menu/HUD/settings.
- Settings (quality, time of day, camera, FPS counter) are in the in-game Settings screen. Quality "Auto" adapts resolution to hold frame rate.

The original v1 project is kept separately as `Velocity_Rush.zip`.
