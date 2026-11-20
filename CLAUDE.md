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
- Game logic (`src/core`, `src/world/citygen.js`, `src/world/collision.js`,
  `src/entities`, `src/systems`) must not import three.js or touch the
  DOM, so it runs in node tests. Drawing lives in `src/render`, `src/ui`.
- Simulation runs in fixed 1/60 s steps; never use wall-clock time in logic.
- All randomness goes through `createRng` (seeded).
- No network requests at runtime. No secrets. Dependencies pinned exactly.
- Avoid allocating objects inside per-frame loops (phone performance).
- Plan and progress: `docs/PLAN.md`, `docs/STATUS.md`.
