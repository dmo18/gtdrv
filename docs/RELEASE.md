# Release

Any push to the default working branch publishes the game to GitHub Pages.
So only push after the gate below passes. Never push work in progress there.

## Steps, in order

1. `npm run lint`
2. `npm test`
3. `npm run release:check` (needs a fresh `npm run build`). It checks that
   package.json and android/package.json have the same version, that
   android/native/version.properties has the same VERSION_NAME and a
   VERSION_CODE higher than the one in `release/last.json`, and that the built
   splash screen shows the version. It prints the version and code it checked.
4. `node scripts/smoke.mjs --extra`
5. `node scripts/ui-test.mjs` (about 8 minutes)
6. Bump the version first if you have not: package.json, android/package.json,
   VERSION_NAME and VERSION_CODE (then rebuild and rerun the check).
7. Commit with a normal message (not "wip").
8. Push.
9. Wait for the Pages deploy to finish.
10. Open the live site and check the version string on the splash screen.
11. `npm run release:record` writes `release/last.json` (version, code, HEAD
    commit). Commit that file with the next change. Only run it after the
    publish is confirmed live.

`release/last.json` is the record of what is published. The next release must
have a higher VERSION_CODE than the code stored there.
