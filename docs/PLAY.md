# Getting Rustwater on Google Play: the owner's checklist

Written for someone who is not a developer. Follow the parts in order. Policies
and screens change, so when something here does not match what you see, trust
the current Play Console help pages (search "Play Console Help") over this file.

## What is already done for you

- The game works as an installable web app (offline, icon, full screen).
- An Android app project is in `android/`. It wraps the game, locks the screen
  to landscape, hides the system bars, keeps the screen awake, asks for no
  permissions and works offline.
- The Back button pauses the game. Press it again while paused and the app goes
  to the background.
- Store graphics, 8 screenshots, the privacy policy page and all the form
  answers are ready (see `docs/STORE.md` and the `store/` folder).
- A GitHub workflow can build the signed upload file for you (Part 5).

## What only you can do

- Create and pay for the Play Console account and verify your identity.
- Make and keep safe your upload key (a small file plus passwords).
- Press the buttons in Play Console (forms, uploads, testers, release).
- Put your contact email in `public/privacy.html` and in the store listing.
- Find testers (Part 6).

## Part 1. Create the developer account

1. Go to https://play.google.com/console and sign in with a Google account you
   plan to keep for this. Use one you will not lose access to.
2. Choose **Personal** (you as a private person) or **Organization** (a
   registered business; needs a D-U-N-S number and takes longer to set up).
3. Pay the one-off registration fee, 25 US dollars.
4. Verify your identity. Google asks for a government ID and a phone number,
   and often an Android phone logged into the Play app. Verification can take
   from a day to a couple of weeks. You cannot publish before it finishes.
5. Fill in your public developer name and contact email. The name appears on
   the store page.

### IMPORTANT: what applies to new personal accounts

As far as I know at the time of writing (check this again yourself, because
Google changes it): a **new personal developer account** (created after
November 2023) must first run a **closed test with at least 12 testers who stay
opted in for 14 days in a row** before it is allowed to apply for production
access (the public release). After the 14 days you apply for production in Play
Console and answer some questions about your test, then Google reviews the
application. **Organization accounts are exempt** from this rule.

Please open the current page in Play Console Help ("Testing requirements for new
personal developer accounts" or similar) before you plan anything. The
numbers (12 testers, 14 days) have changed before. Also, if you are not sure
whether an account counts as new, Play Console shows a banner on the Dashboard
telling you what is required.

If you have a registered business, an organization account avoids the 14 day
wait but takes longer to open because Google verifies the business.

## Part 2. Test the game on your phone first (your Galaxy S24 Ultra)

Do this before anything else, so you do not upload something broken.

The debug build is a normal Android app file (an APK). It is signed with a
throwaway test key, which is fine for trying it, but Google Play will not
accept it.

Where it is: building it needs the Android SDK. On the machine used to prepare
this project the SDK was installed and the build worked. The file is at
`android/native/app/build/outputs/apk/debug/app-debug.apk` on that machine. It
is not saved in git (it is a build output and large). You can make it yourself:
see "Building it yourself" below.

Install it on your phone:

1. On the S24 Ultra, open Settings, About phone, Software information, and
   tap **Build number** seven times. Developer options now exist.
2. Copy `app-debug.apk` to the phone (USB cable, or cloud drive, or email to
   yourself).
3. On the phone, open the file (My Files app). Android will ask you to allow
   installs from this app (for example, My Files or Chrome). Allow it for this
   one install.
4. Tap Install. If Play Protect warns about an unknown app, choose
   "Install anyway". This is expected for a test build.
5. Open Rustwater. Check: it goes full screen in landscape, Play starts the
   game, the touch controls work, sound works, the Back button pauses, and it
   works with airplane mode on.

If you have a computer and a USB cable you can instead run
`adb install -r app-debug.apk` (USB debugging switched on in Developer options).

Honest note about what has been tested: the app was built and inspected, and
the web game has been tested in a browser, but it has not been run on a physical
Android phone or an emulator by the person who prepared it. Your own test
matters. Please look for a black screen at startup, controls in the wrong
place, or sound that does not start until you tap.

### Building it yourself

You need Node 22, Java 21, and the Android SDK (platform 36, build tools 36.0.0).
From the repository folder:

```
npm install
cd android
npm install
export ANDROID_HOME=/path/to/android-sdk     # where the SDK lives
echo "sdk.dir=$ANDROID_HOME" > native/local.properties
npm run apk          # debug APK  -> native/app/build/outputs/apk/debug/app-debug.apk
```

## Part 3. Make your upload key (once, keep it forever)

Play uses two keys. The **upload key** is yours, you sign each upload with it.
With **Play App Signing** switched on (it is the default and Google requires it
for new apps), Google keeps the real **app signing key** and re-signs the app
for players. If you lose the upload key you can ask Google to reset it, but
losing it is still a hassle, so keep a backup.

1. In a terminal (Java installed):

```
keytool -genkeypair -v -keystore rustwater-upload.jks -alias rustwater-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

   It asks for a password and some name details. Write the password down.
2. Save `rustwater-upload.jks` and the passwords in a password manager, and a
   second copy somewhere safe (not in this repository, never email it).
3. NEVER put the keystore or passwords into git. The repository ignores
   `*.jks` and `keystore.properties` to help, but you are the last line of
   defence.

## Part 4. Build the release bundle (the .aab file)

Google Play takes an **Android App Bundle (.aab)**, not an APK. Either build it
on GitHub (Part 5, recommended) or on your own machine:

```
cd android
cp native/keystore.properties.example native/keystore.properties
# edit native/keystore.properties: storeFile, storePassword, keyAlias, keyPassword
# (this file is ignored by git)
npm run aab
```

The result is `android/native/app/build/outputs/bundle/release/app-release.aab`.
The version number is in `android/native/version.properties`. Every upload to
Play needs a **higher VERSION_CODE** than the last one. VERSION_NAME is the
number players see (for example 1.0.0).

Choose your package name before the first upload, because it can never change
afterwards. The current one is `io.github.dmo18.rustwater`. If you own a
domain you may prefer a name based on it, for example `com.yourdomain.rustwater`.
To change it, edit these places and keep them identical: `appId` in
`android/capacitor.config.json`; `namespace` and `applicationId` in
`android/native/app/build.gradle`; `package_name` and `custom_url_scheme` in
`android/native/app/src/main/res/values/strings.xml`; the `package` line and the
folder `android/native/app/src/main/java/io/github/dmo18/rustwater/` of
`MainActivity.java`. Then rebuild.

## Part 5. Let GitHub build the signed bundle (optional but handy)

The workflow is `.github/workflows/android-release.yml`. It runs only when you
press the button.

1. On your computer, make the keystore into one line of text:
   `base64 -w0 rustwater-upload.jks` (on a Mac: `base64 -i rustwater-upload.jks`).
2. In the GitHub repository open Settings, Secrets and variables, Actions, and
   add four **repository secrets** with exactly these names:
   - `ANDROID_KEYSTORE_BASE64` (the long text from step 1)
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (`rustwater-upload` if you followed Part 3)
   - `ANDROID_KEY_PASSWORD`
3. Open the Actions tab, choose **Android release bundle**, click **Run
   workflow**, and enter the version code (1 for the first upload, higher each
   time) and a version name (for example 1.0.0).
4. When it finishes, open the run and download the artifact
   `rustwater-release-aab`. It contains `app-release.aab`. It is kept for 14
   days.

The workflow's action versions are pinned to exact version tags (checkout
4.2.2, setup-node 4.4.0, setup-java 4.7.1, upload-artifact 4.6.2) because full
commit hashes could not be looked up when it was written. If you want the extra
safety, replace each tag with its full commit hash.

## Part 6. Set up the app in Play Console

1. **Create app.** Name Rustwater, language English, type **Game**, **Free**.
   Accept the declarations.
2. **Dashboard, Set up your app.** Complete every task in the list. The answers
   are in `docs/STORE.md`:
   - Privacy policy: https://dmo18.github.io/gtdrv/privacy.html (put your email
     into `public/privacy.html` first and publish the site).
   - App access: all functionality available without restrictions.
   - Ads: No.
   - Content rating: fill the IARC questionnaire honestly (STORE.md has the answers).
   - Target audience: 18 and over.
   - Data safety: collects no data (STORE.md).
   - The other declarations (government, financial, health): No.
3. **Main store listing.** Paste the texts from STORE.md and upload the icon,
   feature graphic and screenshots from the `store/` folder.
4. **Play App Signing.** When you upload your first bundle, accept Play App
   Signing (the default).

## Part 7. Internal testing, then closed testing

1. **Testing, Internal testing, Create new release.** Upload `app-release.aab`.
   Add testers by email (up to 100, yourself first), save, and open the
   opt-in link on your S24 Ultra. Install from Play and check it all works.
   Internal tests are available within minutes and need no Google review.
2. **Closed testing** (needed for new personal accounts): Testing, Closed
   testing, create a track, upload the same or a newer bundle, and create a
   tester list. The simplest way is a Google Group with your testers' email
   addresses; add the group to the track. Send each tester the opt-in link.
   Every tester must **opt in** (tap the link, tap Become a tester) and install
   the app. They need to stay opted in for 14 days in a row.
3. Check the Dashboard counts opted-in testers. You need at least 12 (check
   the current number).

### What to do during the 14 days

- Recruit testers early. Ask friends, family, colleagues and online communities
  that swap testing help. Aim for 15 to 20, because some people drop out.
  Never pay for fake installs or use fake accounts; that can get the account
  banned.
- Ask testers to open the game a few times over the two weeks, and to tell you
  about crashes or confusion. Real use during the test helps your application.
- Fix problems and upload a new bundle with a higher version code. Testers
  update automatically. Do not remove testers, as that can reset the timer.
- Write down what you learned. The production application asks how you
  recruited testers, what feedback you got, and what you changed.

## Part 8. Apply for production, then release

1. After 14 days with enough opted-in testers, Play Console shows **Apply for
   production** on the Dashboard. Answer the questions and submit.
2. Google reviews the application, which usually takes up to about a week.
3. When approved, go to Production, Create new release, upload the bundle (a
   newer one if you made fixes), write short release notes, choose countries,
   and **send for review**. A first review commonly takes from a few days up
   to a week or two for new accounts.
4. After approval, the app goes live. Check the listing on your phone.

## Realistic timeline for a new personal account

| When | What |
| --- | --- |
| Day 0 | Create the account, pay, start identity verification |
| Days 1 to 7 | Verification finishes. Test the debug APK. Fill in the forms. Build and upload to internal testing. |
| Days 7 to 14 | Recruit testers. Start the closed test once enough testers have joined. |
| 14 days after the test has enough testers | Apply for production |
| About 1 week | Google reviews the production application |
| Another few days to a week | Review of the production release |
| Total | About 4 to 6 weeks. An organization account skips the 14 day test and can be done in 1 to 3 weeks after verification. |

## Updating the game later

1. Change the game, run `npm test`, `npm run lint`, `npm run smoke`.
2. Raise `VERSION_CODE` (and `VERSION_NAME`) in `android/native/version.properties`,
   or use the workflow's inputs.
3. Build a new bundle (Part 4 or 5), upload it as a new release.

The web version on GitHub Pages updates by itself when the repository is
published, and installed copies pick up the new version the next time they are
opened with a network connection. The Android app holds its own copy of the
game, so Android players get changes only through a new Play release.

## Google's rules for apps installed from outside Play

Google has announced a developer verification requirement for apps installed
on certified Android phones from outside Play, rolling out in stages from
2026. Check the current Android developer pages to see whether installing the
debug APK on your own phone needs anything extra in your country. It does not
affect apps installed from Play.
