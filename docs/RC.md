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
