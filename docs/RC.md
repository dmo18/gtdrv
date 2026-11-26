# 1.0.0 release candidate status (0.13.3)

Measured by me, no owner action needed:
- Lint, tests, build, gate (regions, ui, touch), smoke: pass on the 0.13.x line (last full gate run on 0.13.0; 0.13.2 and 0.13.3 changes were checked with lint, npm test, smoke --extra).
- Security: reviews at each milestone; none critical or high open.
- No runtime network call in src. No secret in git. Dependencies pinned.
- Draw budget Normal street view: all regions within 210 calls / 295k triangles.
- Store screenshots: 8 current Miami shots in `store/` (0.13.3), no metadata.

Owner-only, exactly these five (cannot be done here):
1. Privacy contact email: replace PRIVACY_EMAIL_PLACEHOLDER (docs/STORE.md, public/privacy.html).
2. Real phone check on the S24 (median, worst, steering, sound).
3. Play developer account.
4. Signing key (upload key and keystore, docs/ANDROID.md).
5. Closed test (Play requirement before production).

Known open: lot-to-lot 5 m steps, heavy hedges, memory about 185 to 202 MB,
Actions not pinned to SHAs (blocked), shader programs 75 (target 60).

## Checklist run on 0.13.0 (code 22), items that need no owner

Run by me; the 60 minute soak was running at the same time, so timings are not used.

1. Offline: PASS. The game is an installed PWA (service worker `public/sw.js`, cache of 25 files).
   `node scripts/offline-test.mjs`: worker controls the page, offline reload starts and runs,
   offline travel to Miami West (car, title skipped), privacy page and manifest served from
   the cache, 0 outside requests, 0 page errors. The script still expected Downtown as the
   start region (the default became the Beach in 0.9.0); its precondition was changed to
   `miami-beach`. No assertion was removed or loosened.
2. Old saves: PASS. `test/oldsaves.test.js` with `test/fixtures/save-<version>.json` for 0.3.1,
   0.4.0, 0.5.0, 0.6.0, 0.7.0 and 0.8.0. The fixtures were written by each release's own
   `core/save.js` and `core/explore.js` (taken from git history) with non-default values, so
   they have the real shapes (keys `rustwater.save.v1`, `rustwater.explore.v1`,
   `rustwater.map`). The tests check: progress kept, fields added later at defaults, explore
   state kept, the whole-box map choice of 0.4.0 to 0.6.0 moved to a region, idempotent
   sanitizing, round trip, and a tampered save.
3. Supply chain: PASS with notes.
   - `package.json` and `android/package.json` pin exact versions; the lock file holds 109
     packages, all exact. `npm audit` is clean (root and android): 0 vulnerabilities.
   - Note: both `package-lock.json` files still say version 0.1.0 for the root package
     (metadata only; not shown anywhere).
   - Secret scan of tracked files: only variable names (workflow `secrets.*` references,
     `storePassword` in build.gradle) and `keystore.properties.example` with CHANGE_ME. No
     key, token, keystore or private key committed.
   - No runtime network call in `src/` or `public/` except the service worker's `fetch(req)`,
     which skips every other origin.
   - GitHub Actions (report only; none pinned to a commit SHA, all use version tags):
     `pages.yml`: checkout@v4 (twice), setup-node@v4, upload-pages-artifact@v3,
     deploy-pages@v4. `android-release.yml`: checkout@v4.2.2, setup-node@v4.4.0,
     setup-java@v4.7.1, upload-artifact@v4.6.2. FAIL for the "pinned to SHAs" line.
4. Version: PASS. package.json, release/last.json, android/package.json, and
   android/native/version.properties (VERSION_NAME 0.13.0, VERSION_CODE 22) agree; the build
   shows v0.13.0 in game (built `dist/index.html` and the menu from package.json).

## 0.13.6 RC audit (run on 0.13.5, code 27)

Machine load average was 9 to 17 (other jobs), so timings are not used.

- Lint: pass. `npm test`: 1190 of 1192 on the full run; the two failures were timing tests
  (miami.test.js "whole box builds in under 3 s", wall 9.7 s under load; world-density
  "dressLot ... under 0.05 ms a lot"). Rerun alone: both pass (0.0404 ms a lot). Nothing loosened.
- Build: pass. dist 6.2 MB raw. Offline test: 8 of 8 ok (cache of 25 files, offline reload and travel, 0 outside requests).
- Supply chain: `npm audit --omit=dev` 0 vulnerabilities (root and android). All dependencies pinned
  exact. Runtime deps: three 0.187.0 (MIT) only; android adds Capacitor 8.6.2 (MIT) inside the wrapper.
  No postinstall script in either lock file (esbuild, dev only, has an install script flag). Actions as before: tags, not SHAs.
- `release:check`: fails only on "VERSION_CODE 27 must be greater than the last published code 27";
  that is the expected state after `release:record` for 0.13.5, so the next bump clears it.
- Versions agree: package.json, android/package.json, version.properties (0.13.5, code 27),
  release/last.json. Service worker cache is `rustwater-` plus a build hash (447dac542291), not a version.
- Play assets: 512 px icon and maskable 192 and 512 present; store/icon-512.png 512x512, feature
  graphic 1024x500, 8 screenshots all 1920x1080 (0.8 to 2.6 MB), matching docs/STORE.md. No PNG has
  EXIF, text or time chunks.
- Privacy: code uses localStorage keys `rustwater.save.v1`, `.explore.v1`, `.map`, `.res`, and
  sessionStorage `rustwater.travel`; no fetch, XHR or beacon in src. privacy.html now also says session
  storage, Daily Three and map data (as in docs/STORE.md); date 25 November 2026.
- Secrets and personal data: no email address (only PRIVACY_EMAIL_PLACEHOLDER), no key or token patterns,
  no keystore files tracked; every commit author is "Claude".
- Not fixed, for the owner: first play download measures about 0.96 to 1.01 MB gzip (game.js 696 KB,
  chunk 58 KB, index 2 KB, plus one region chunk 207 to 252 KB, gzip -9) against the 0.95 MB in
  docs/PERF.md; release-check.mjs does not measure it. Both package-lock files say 0.1.0 for the root.
