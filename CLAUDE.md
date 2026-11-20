# Rustwater

An original open-world driving, boating and flying playground for mobile
browsers (target: Galaxy S24 Ultra, Chrome, landscape, touch). It must
stay original: no names, characters, maps or art from existing games.

Stack: plain JavaScript modules, three.js, esbuild. No framework.

Commands:
- `npm test` unit tests (node:test, files in `test/*.test.js`)
- `npm run lint` eslint
- `npm run build` bundle to `dist/` (index.html + game.js)
- `npm run smoke` build, load in headless Chromium at phone size, fail on errors

Conventions:
- Coordinates: x east, z south, metres, flat ground at y = 0.
  Heading 0 faces +x; heading increases turning toward +z.
- Pure game logic (`src/core`, `src/world`, `src/entities`, and the
  rule/AI cores inside `src/systems`) must run in node tests: no
  three.js, no DOM at import time. A system file may also create its
  own meshes or small DOM panels, but must guard them so the logic
  still works when `document` or `game.scene` is missing.
- Simulation runs in fixed 1/60 s steps; never use wall-clock time in logic.
- All randomness goes through `createRng` (seeded).
- No network requests at runtime. No secrets. Dependencies pinned exactly.
- Avoid allocating objects inside per-frame loops (phone performance).
- Plan and progress: `docs/PLAN.md`, `docs/STATUS.md`.
