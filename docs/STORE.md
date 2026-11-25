# Google Play store paperwork for Rustwater

Everything here is ready to copy into Play Console. Items in [SQUARE BRACKETS]
are for the owner to fill in. Policies change, so check each answer against
the live form before you submit.

Technical facts used below:
- Package name: `io.github.dmo18.rustwater` (permanent once uploaded, see docs/PLAY.md).
- Built with `targetSdk` 36 (Android 16) and `compileSdk` 36. Google Play
  requires new apps and updates to target the newest Android release within
  about a year of its launch, and API 36 is the level that applies from the
  second half of 2026. Re-check the target API requirement page in Play
  Console help before every upload.
- Permissions: none. The app asks for no permission at all (checked in the
  merged manifest: no INTERNET permission, see docs/ANDROID.md).
- The game is bundled inside the app and runs offline.
- Version at the time of writing: 0.12.x (the game as it is now: five Miami
  regions plus the classic island, Flow meter, street events, records, Daily
  Three, free paint and wheels, steering styles and feel presets).

## Listing text

**App name (30 characters max):** Rustwater

**Short description (80 characters max):**
Drive, sail and fly across Miami. Stunts, tanks, races. Plays fully offline.

**Full description (4000 characters max):**

```
Rustwater is an open-world sandbox set across Miami, built for phones. Climb
into a car, take a boat out across the bay, fly a plane or a helicopter, or
roll a tank down the avenue. There is no story to follow and nothing to buy.
Go where you like and chase your own best runs.

FIVE PARTS OF MIAMI
- Downtown and the Bay, Miami Beach and the Islands, Wynwood and the North
  Side, Little Havana and Civic Center, and The Roads and the South Shore.
- Real streets and places, with traffic, parked cars, docks, bridges and an
  airfield. Travel between parts from the pause menu or the map.
- A smaller classic island is there too.

DRIVE, SAIL, FLY, FIGHT
- Cars, trucks and service vehicles, speedboats, planes, helicopters and a
  tank.
- Get out and fight on foot with a set of weapons and explosives. Take on the
  police, or try to lose them.
- Day, dusk, night, rain and fog.

THE FLOW METER
- Near misses, clean passes, drifts, jumps, smashes and takedowns fill the
  Flow meter and raise your multiplier. Stop to bank your run, or crash and
  lose it. Risk against reward, all the time.

STREET EVENTS AND RECORDS
- Thirty gates in every part of the city: speed traps, near-miss runs, jumps,
  rush drops, police escapes and wrecking sprees. Drive through a gate and the
  event starts at once, with a quick retry.
- Earn bronze, silver and gold medals and keep your best scores in Records.
- Daily Three: three fresh challenges a day from the date on your phone, each
  with a twist such as rain or a different vehicle. No streak is ever lost.

MAKE IT YOURS
- Free paint, finishes, wheels, window tint and decals for every vehicle.
- Four ways to steer: wheel, buttons, tilt or slider, and three steering feels:
  Standard, Relaxed or Sharp. Left-handed layout and adjustable sensitivity.

BUILT FOR PHONES
- Landscape touch controls designed for a phone held in both hands.
- Plays fully offline. No account, no sign-in, no network needed.
- Your progress saves automatically on your device.

NO ADS, NO PURCHASES, NO TRACKING
- No advertising, no in-app purchases, no analytics. The game collects nothing.

MATURE CONTENT
Rustwater is for adults. It contains violence against people, including
shooting, explosions and vehicles running people over, with blood. Characters
can be hurt and killed, and vehicles can be wrecked and blown up. The violence
is in a stylized, low polygon world, and there is no dismemberment. There is no
sexual content, no gambling and no real money in the game. Not suitable for
children.

The vehicles, characters, sounds and art were all made for this game. The Miami
map is built from OpenStreetMap data, (c) OpenStreetMap contributors, used
under the Open Database License (ODbL). Shops and signs are invented, and any
resemblance to real businesses is accidental.
```

**Keywords.** Play Console has no keyword field. Search is driven by the title,
short description and full description, so these phrases are worked into the
text above: open world, driving, sandbox, offline, helicopter, plane, boat, tank,
car, Miami, stunts, races, action. Do not add a list of keywords to the
description; Google treats that as keyword stuffing.

**Category:** Game, then Action. (Racing also fits, but most of the play is
open-world action, and picking the one that matches the main activity is the
honest choice.)

**Tags (up to five from the list Play Console offers):** Action, Open world,
Sandbox, Driving, Offline (pick whichever the list offers).

**Map credit (shown in the game on the title screen, in Settings and here; keep
the same words everywhere):**

```
Map data (c) OpenStreetMap contributors, ODbL
```

The full description ends with: "The Miami map is built from OpenStreetMap data,
(c) OpenStreetMap contributors, used under the Open Database License (ODbL)."
Street and place names are real; everything else is invented.

**Contact details (required):**
- Email: PRIVACY_EMAIL_PLACEHOLDER (owner: replace with a public contact email)
- Website: https://dmo18.github.io/gtdrv/ (or your own page)
- Privacy policy URL: https://dmo18.github.io/gtdrv/privacy.html
  (this page is `public/privacy.html`; it goes live when the site is published.
  Put the real contact address inside it first.)

## Privacy policy text

This is the text of `public/privacy.html`, for pasting into any other place
that asks for it. The one thing the owner supplies is the contact address.
Today `public/privacy.html` carries its own bracket placeholder instead of
`PRIVACY_EMAIL_PLACEHOLDER`; whoever next edits `public/` should use the literal
`PRIVACY_EMAIL_PLACEHOLDER` there too so a single search finds both.

```
Rustwater privacy policy
Last updated: [DATE OF PUBLISHING]

Short version. Rustwater does not collect, send, sell or share any personal
information. The game works entirely on your device.

What the game stores on your device. Your progress, scores, medals, records,
daily streak, paint and wheel choices and settings (steering style, steering
feel, sound and display options) are saved in the local storage of the app or
browser on your device. This stays on your device. We never receive it and
cannot see it. Clearing the app data, or uninstalling the app, deletes it.

What the game does not do. It has no accounts or sign-in. It contains no
advertising and no analytics or tracking tools. It has no in-app purchases. It
does not use your location, camera, microphone, contacts, photos or files. It
makes no network requests while you play, and the Android app asks for no
permissions, not even network access. It works offline from the first launch.
It contains no code from advertising or social networks and sets no cookies.

Daily Three. The daily challenges use the date on your phone to pick the day's
events. The date is not sent anywhere.

Web version hosting. If you play the web version, the website host (GitHub
Pages) delivers the files and, like any web host, may keep ordinary server logs
such as your IP address. We do not receive or use those logs. GitHub's own
privacy statement applies to that hosting.

Map data. The map is built from OpenStreetMap data, (c) OpenStreetMap
contributors, used under the Open Database License (ODbL). It is bundled with
the game; nothing is fetched while you play.

Children. Rustwater contains violence and blood and is meant for adults (17 and
over). It is not directed at children, and we do not knowingly collect
information from anyone.

Changes. If this policy ever changes, the new version will be posted on this
page with a new date.

Contact. Questions about this policy: PRIVACY_EMAIL_PLACEHOLDER
```

## Graphics (in `store/`)

| Play field | File | Size |
| --- | --- | --- |
| App icon | `store/icon-512.png` | 512 x 512 |
| Feature graphic | `store/feature-graphic-1024x500.png` | 1024 x 500 |
| Phone screenshots (8) | `store/screenshot-1.png` to `screenshot-8.png` | 1920 x 1080, landscape |

Play accepts screenshots from 320 to 3840 pixels on a side with the long side
at most twice the short side, so 16:9 landscape is valid. The current files in
`store/` and `scripts/store-shots.mjs` show the old island districts, not the
Miami game, so retake them with the list below before the 1.0.0 upload (no image
is generated by this document). For tablet slots you may reuse the same
screenshots, or leave those slots empty.

### Screenshot list (8 shots, 1920 x 1080, landscape, HUD visible)

Take each from a real run (phone screen capture scaled, or a desktop browser at
1920 x 1080 with touch controls on). Keep the on-screen controls in view, show
no personal details, and keep the in-game look honest: do not stage a scene
that is calmer or more violent than normal play. Start from a new game or a save
with a few medals. Setup tools: Pause (top corner), then Travel to change region;
the Daily Three tile can set the weather or the hour for you ("rain", "midnight",
"sunset" twists), otherwise wait for the time you want.

| # | Show | Exact setup |
| --- | --- | --- |
| 1 | Flow meter at speed, daytime, Downtown | Region "Downtown and the Bay", start street. Noon. Drive a sedan down an avenue with traffic, passing cars close until the meter bar under the score shows x3 or more, with a "Near miss" callout visible. Capture while the callout is on screen. |
| 2 | A street event in progress, Miami Beach | Pause, Travel, "Miami Beach and the Islands" (starts on Ocean Drive). Dusk (sunset twist or about 6 pm game time). Drive through the blue gate ahead of the start. Capture while the prompt strip reads "Passes n/3" with the timer and the palms and parked cars in view. |
| 3 | Boating | Any region with water, for example Downtown and the Bay. Daytime. Get into a speedboat at a dock, push the throttle until it planes, wake spray behind it, skyline in view. |
| 4 | Flying | Downtown at Gullwing Airfield. Take the jet (Velloria) or a helicopter (Midgefly); capture in the air, 150 to 300 m up, the skyline and bay in view, flight stick and throttle controls visible. |
| 5 | Tank and combat | Get into the tank (Rustback). Fire the cannon at a parked car or a wall so a blast shows. Daytime, controls and ammo readout in view. |
| 6 | Police chase at night in rain | Any region. Rain twist from Daily Three, or wait. Drive fast past a police car to get two stars, so the wanted stars and the siren lights show. Wet streets, headlights on. |
| 7 | Customize: paint and wheels | Pause, Customize. Pick a bright paint, the metallic finish and a bronze or red wheel, so the car on the right shows the change. The paint and wheel pickers must be readable. |
| 8 | Pause menu with the loop tiles | Pause on a save with a few medals. The tile grid shows Records, Daily Three (with "n / 3 today"), Customize, Travel and Map. Optional spare: Settings, Controls, with Steering (Wheel, Buttons, Tilt, Slider) and Steering feel (Standard, Relaxed, Sharp) visible. |

After retaking: check each file is 1920 x 1080 and under 8 MB, and that no
shot shows a real brand, a real number plate or any personal data.

## Content rating (IARC questionnaire)

Play Console, Policy, App content, Content rating. Choose the category
"Game". Answer honestly. The answers that describe Rustwater:

| Question area | Answer |
| --- | --- |
| Violence | Yes. Violence against human characters (shooting, explosions, vehicles and tanks running people over, police chases and takedowns) in a stylized low polygon 3D world. Violence against animals: no. |
| Blood and gore | Yes, blood. No dismemberment, no graphic gore. |
| Sexual content or nudity | No |
| Profanity or crude humour | Answer for what is actually in the game (check the in-game text and shop signs). |
| Controlled substances (drugs, alcohol, tobacco) | No. Check shop signs once more before submitting. |
| Gambling or simulated gambling | No |
| Fear or horror | No |
| User interaction | No chat, no user generated content, no sharing of location, no sharing of personal info |
| In-app purchases | No |
| Ads | No |
| Does the app let users buy digital goods | No |
| Unrestricted web access | No |

**Expected rating.** Probably ESRB Mature 17+ (PEGI 16, USK 16, and similar
levels elsewhere), because the game has intense violence against people with
blood. If the questionnaire yields Teen or 12+, that is fine too: the result
comes from the answers, and you should never answer down to get a lower rating.
Wrong answers can get the app removed.

## Target audience and content

- Target age groups: **18 and over only** (do not tick any group under 18).
- Appeals to children: **No.** Not designed for children, no child-appealing
  art direction, so the Families policy does not apply.
- The Play Console "Teacher Approved" and Designed for Families programs: not applicable.

## Ads

Contains ads: **No.** The app has no advertising SDK and no ad code.

## App access

All functionality is available without login, special access or an account.
Select "All functionality is available without restrictions".

## Data safety form

Play Console, Policy, App content, Data safety. The app has no network
requests at runtime and no third party code that collects anything.

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | Not applicable, nothing is sent |
| Do you provide a way for users to request that their data be deleted? | Not applicable. Data stays on the device only and is deleted by clearing app data or uninstalling. |
| Data types (location, personal info, financial info, health, messages, photos, audio, files, calendar, contacts, app activity, web browsing, app info and performance, device or other IDs) | None collected, none shared |

What the app does keep: game progress, scores, medals, records, daily streak, paint and wheel choices and settings are saved on the
device in WebView local storage (`localStorage`). This data never leaves the
device, so under Google's definition it is not "collected". Declare nothing for
it, and mention it in the privacy policy (already done).

The Daily Three reads the phone's local date to pick the day's challenges. The date stays on the device, so nothing is declared for it.

The privacy policy URL is required even when you collect nothing.

## Other App content declarations

- Government apps: No. News app: No. COVID-19 app: No. Health features: No.
- Financial features: None. Advertising ID: the app does not use it (answer
  "No"). Since the app requests no permissions, there is nothing to justify.
- Does the app use sensitive permissions (SMS, call log, location in the
  background, all files access): No.

## Policies to check before you publish

1. **Violence.** Google's policy allows realistic violence in games when it is
   not gratuitous and when the rating reflects it. It does not allow depictions
   of real-world violence presented as fact, content that encourages real
   violence, or violence against real people. Rustwater is fictional, in a
   stylized low polygon style, with no dismemberment. Describe it plainly in
   the listing (done above) and use the screenshots that show gameplay, not
   only the calmest scenes. Do not use screenshots that look more or less violent
   than the game really is.
2. **Metadata.** No misleading claims, no "best" or "number 1" claims, no
   emojis in the title, no keyword stuffing, no mentions of other apps or
   brands.
3. **Intellectual property and impersonation.** The listing and the game must
   use no real brands, logos, characters, vehicles, maps or music. See the
   statement below.
4. **Restricted content: gambling, real money, user generated content.** None
   in the game.
5. **Minimum functionality and stability.** Test on a real phone before
   release (see docs/PLAY.md). Crashes, blank screens and a game that does not
   start are the usual reasons for rejection.
6. **Target API level.** Must meet the current requirement (see top of this file).
7. **Developer account verification.** Personal accounts need identity
   verification and, for new personal accounts, a closed test. See docs/PLAY.md.
8. **Developer contact and address.** Play shows a contact email, and for
   some accounts a public address, on the listing. Use details you are happy to
   publish.

## Originality statement

All the content in Rustwater is original work made for this project, with one
exception that is credited: the Miami street layout and place names come from
OpenStreetMap data, (c) OpenStreetMap contributors, used under the Open
Database License (ODbL), and the credit shows in the game and in the listing.
The classic island, the building models, signs and shop names, vehicles,
characters, weapons, user interface, icons, the feature graphic, the
screenshots and the audio were created for this game, either drawn in code or
generated procedurally at runtime or build time. The game does not use art,
audio, names, characters, other maps, logos or trademarks from any existing game,
film, brand or real organization, and no third party game assets were
copied. The only third party code is the open source three.js library (MIT
license) used for 3D rendering, bundled into the app. Names of shops and
signs in the game are invented, and any resemblance to real
businesses is accidental.
