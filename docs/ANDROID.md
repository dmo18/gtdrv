# Android: config check and owner steps

No key, password or secret is in this file or in the repository. Everything marked
OWNER can only be done by you.

## 1. Config check (done offline, from the files, for 0.13.5)

| Item | Result | Where |
| --- | --- | --- |
| Version name | 0.13.5, same as package.json and android/package.json | `android/native/version.properties` |
| Version code | 27 (must be higher than `release/last.json` before an upload; `npm run release:check` tests it) | same file |
| applicationId and namespace | `io.github.dmo18.rustwater`, same in `capacitor.config.json`; permanent after the first upload | `app/build.gradle` |
| SDK levels | minSdk 24, compileSdk 36, targetSdk 36. Play required API 35 for updates from August 2025; 36 is expected from August 2026. Re-check "Target API level requirements" in Play Console help before upload | `variables.gradle` |
| Orientation | `sensorLandscape` (landscape both ways) on the only activity | `AndroidManifest.xml` |
| Permissions | none declared; the merged release manifest has no INTERNET permission (0 matches) | `app/build/outputs/logs/manifest-merger-release-report.txt` |
| Cleartext traffic | off (`usesCleartextTraffic=false`, `allowMixedContent=false`) | manifest, `capacitor.config.json` |
| Offline assets | the WebView loads the bundled game from `assets/public` (served as https://localhost by Capacitor); no `server.url` is set, so nothing is fetched | `capacitor.config.json` |
| Back button | `MainActivity` asks `window.__rwBack()`: first press pauses a running game, a press on the title screen or while paused sends the app to the background | `MainActivity.java`, `src/main.js` |
| Backup | `allowBackup=false`: no cloud or device-transfer backup. Saves live only on the phone; a new phone starts fresh (the privacy policy says data stays on the device). No data extraction rules are needed while backup is off | manifest |
| Signing | release is unsigned unless `native/keystore.properties` or `RUSTWATER_KEYSTORE_*` environment variables exist; both are git-ignored (`*.jks`, `keystore.properties`) | `app/build.gradle`, `.gitignore` |

Not verifiable here, so not claimed: a fresh Gradle build and the WebView on a real phone. The
copy of the game in `native/app/src/main/assets/public` is git-ignored and was synced on
2026-11-20, so it is older than 0.13.5. Always run `npm run sync` (inside `android/`) before building;
that rebuilds the web game and copies it in. A debug APK and a release AAB from an earlier
build exist under `android/native/app/build/outputs/`; do not upload those.

Gaps to know about (none block a build): the Android app has no `INTERNET` permission, so the
service worker only serves from the bundle; the app has a single activity with
`launchMode=singleTask`; the unit test stubs under `app/src/test` and `androidTest` are Capacitor
defaults.

## 2. Make the upload key (OWNER, once, keep it forever)

Needs Java (the `keytool` command). Do this on your own computer, never in a Claude session.

1. Open a terminal in a folder that is NOT inside the repository, for example `~/rustwater-keys`.
2. Run:
   `keytool -genkeypair -v -keystore rustwater-upload.jks -alias rustwater-upload -keyalg RSA -keysize 2048 -validity 10000`
3. When asked, type a keystore password, then the same again. Use a long random password from a
   password manager. Answer the name questions with anything you are happy with, then type `yes`.
4. Press Enter when it asks for the key password to use the same one (simplest), or type a second one.
5. Store `rustwater-upload.jks` and the passwords in your password manager, and put a second copy
   of the file on a USB stick or another private cloud. Never email it, never commit it.
6. In the repository folder run `cd android/native`, `cp keystore.properties.example keystore.properties`,
   open `keystore.properties` and fill in the real absolute path to the `.jks`, both passwords and the
   alias `rustwater-upload`. The file is git-ignored; confirm with `git status` that it is not listed.

## 3. Build the bundle (OWNER, or a helper you trust, without the key)

1. In the repository run `git pull`, then `npm ci`, then `cd android && npm ci`.
2. Run `npm run aab` (inside `android/`). It builds the web game, syncs it, and signs the bundle if
   `keystore.properties` exists.
3. The file is `android/native/app/build/outputs/bundle/release/app-release.aab`.
4. For a first phone test run `npm run apk`, copy `app-debug.apk` to the S24 and open it
   (allow "Install unknown apps" for your file manager once). Check: starts landscape, Back pauses, no
   network needed (turn on airplane mode), sound after a phone call.
5. Alternative: GitHub Actions workflow "Android release bundle" (see docs/PLAY.md Part 5) with the
   four ANDROID_* repository secrets that you add yourself.

## 4. Play Console upload (OWNER, tap by tap)

Screens move, so match words, not positions. Forms and answers are in docs/STORE.md.

1. Open https://play.google.com/console and sign in with your developer account. Pay and finish
   identity verification first if you have not (docs/PLAY.md Part 1).
2. Tap **Create app**. Enter name `Rustwater`, default language English (United States), choose **Game**,
   **Free**, tick the declarations, tap **Create app**.
3. On the Dashboard open **Set up your app** and finish each task: **Privacy policy** (paste the
   URL from STORE.md), **App access** (all functionality available), **Ads** (No), **Content rating**
   (use the STORE.md table), **Target audience** (18 and over), **Data safety** (collects nothing),
   and the small declarations (government, financial, health: No).
4. Before this step put your email into `public/privacy.html` (replace the placeholder
   `PRIVACY_EMAIL_PLACEHOLDER` or its bracket text) and publish the site, or step 3 fails the URL check.
5. Left menu, **Grow users**, **Store presence**, **Main store listing**. Paste the short and full
   description from STORE.md, upload the icon, feature graphic and the 8 retaken screenshots, tap **Save**.
6. Left menu, **Test and release**, **Testing**, **Internal testing**, tap **Create new release**.
7. Under **App signing** accept **Play App Signing** (default). Play keeps the real signing key; your
   `.jks` is only the upload key.
8. Tap **Upload**, pick `app-release.aab`. Release name and notes: "0.13.5" and one plain sentence. Tap **Next**,
   fix any warning (target API, 64-bit are already met), tap **Save**, then **Go to overview**,
   then **Start rollout to internal testing**.
9. Tab **Testers**, tap **Create email list**, add your own address, save, copy the **opt-in link**,
   open it on the S24 signed in with that account, tap **Become a tester**, then install from Play.
10. Test on the phone as in section 3 step 4. If good, left menu **Closed testing**, **Create track**,
    upload the same bundle, add a tester list (a Google Group is simplest), send the opt-in link.
    A new personal account needs the closed test for the number of testers and days Play shows today
    (it said 12 testers for 14 days; check the live page). Never use fake accounts.
11. After the test period, Dashboard, **Apply for production**, answer the questions.
12. When approved: **Production**, **Create new release**, upload the bundle (higher VERSION_CODE
    than any earlier upload), notes, countries, then **Send for review**.

## 5. Only the owner can

Create and pay for the developer account and verify identity; make and guard the upload key; supply
the privacy contact email; press every Play Console button; recruit the testers; run the phone check
on the S24; accept 1.0.0 (docs/PLAN_V2 5.6). Claude sessions must never see the keystore or passwords.

Ongoing: every upload needs a higher VERSION_CODE (`npm run bump -- patch` does package.json, android
and version.properties together).
