# Release

Any push to the default working branch publishes the game to GitHub Pages.
So only push after the gate below passes. Never push work in progress there.

## Steps, in order

Steps 1 to 5 in one command: `npm run gate` (lint, tests, build,
release:check, smoke --extra; stops at the first failure and prints a table).
Add `-- --ui` to include the ui-test. `npm run review-shots [dir]` writes the
screenshot review views (PLAN_V1 2.6 item 8) to a scratch dir (default
`<tmp>/rustwater-review`); views without a scripted hook are printed as todo.

1. `npm run lint`
2. `npm test`
3. `npm run release:check` (needs a fresh `npm run build`). It checks that
   package.json and android/package.json have the same version, that
   android/native/version.properties has the same VERSION_NAME and a
   VERSION_CODE higher than the one in `release/last.json`, and that the built
   splash screen shows the version. It prints the version and code it checked.
4. `node scripts/smoke.mjs --extra`
5. `node scripts/ui-test.mjs` (about 8 minutes)
6. Bump the version first if you have not: `npm run bump -- patch` (or `minor`,
   `major`). It updates package.json, android/package.json, VERSION_NAME and
   VERSION_CODE (+1), and package-lock.json if it carries the version. Then
   rebuild and rerun the check.
7. Commit with a normal message (not "wip").
8. Push.
9. Wait for the Pages deploy to finish.
10. Open the live site and check the version string on the splash screen.
11. `npm run release:record` writes `release/last.json` (version, code, HEAD
    commit). Commit that file with the next change. Only run it after the
    publish is confirmed live.

`release/last.json` is the record of what is published. The next release must
have a higher VERSION_CODE than the code stored there.

## What the workflow enforces

- A non-wip push to the default branch fails the check job if package.json
  version equals the version in `release/last.json` (run `npm run bump`).
  Commits with `[wip]` skip this and skip the deploy.
- After a successful deploy the `tag` job creates the git tag `v<version>`
  (the only job with `contents: write`). An existing tag is left alone.
- Pinning every action to a full commit SHA (tag in a comment) is still open:
  SHAs could not be looked up from the machine that wrote this. Look each up
  with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (for an annotated tag
  `type` is `tag`: fetch `git/tags/<sha>` and use `.object.sha`).
