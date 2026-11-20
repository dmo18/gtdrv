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
- Permissions: none. The app asks for no permission at all.
- The game is bundled inside the app and runs offline.

## Listing text

**App name (30 characters max):** Rustwater

**Short description (80 characters max):**
Drive, sail and fly across an open island. Mature sandbox, plays offline.
(73 characters)

**Full description (4000 characters max):**

```
Rustwater is a sandbox on an island of rust, salt and bad ideas. Climb into a
car, take a boat out past the docks, fly a plane or a helicopter, and do what
you like with the place. Nothing is scripted to stop you.

WHAT YOU CAN DO
- Drive cars through a city of streets, avenues, docks, a beach, a residential
  district and an airfield, in daylight, at dusk, at night and in the rain.
- Pilot speedboats, planes and helicopters. Take a tank or a fighter jet out
  when you want more firepower.
- Get out and fight on foot with a set of weapons and explosives.
- Take on races, missions and stunts, and chase your own best scores.
- Draw police attention and try to shake it.
- Open the map, pause any time, and pick the controls that suit you.

BUILT FOR PHONES
- Landscape touch controls designed for a phone held in both hands.
- Plays fully offline. No account, no sign-in, no network needed.
- Your progress saves automatically on your device.

NO ADS, NO PURCHASES, NO TRACKING
- No advertising, no in-app purchases, no analytics. The game collects nothing.

MATURE CONTENT
Rustwater is for adults. It contains violence against people, including
shooting and explosions, with blood. Characters can be hurt and killed, and
vehicles can be wrecked and blown up. The violence is in a stylised, low
polygon world, and there is no dismemberment. There is no sexual content, no
gambling and no real money in the game. Not suitable for children.

Everything in Rustwater is original: the island, the vehicles, the characters,
the sounds and the art were all made for this game. Any resemblance to real
places, brands or people is accidental.
```

**Keywords.** Play Console has no keyword field. Search is driven by the title,
short description and full description, so these phrases are worked into the
text above: open world, driving, sandbox, offline, helicopter, plane, boat, tank,
car, city, races, missions, action. Do not add a list of keywords to the
description; Google treats that as keyword stuffing.

**Category:** Game, then Action. (Racing also fits, but most of the play is
open-world action, and picking the one that matches the main activity is the
honest choice.)

**Tags (Play Console lets you choose up to five from a list):** Action, Open
world, Sandbox, Driving, Offline (pick whichever the list offers).

**Contact details (required):**
- Email: [OWNER: a public contact email]
- Website: https://dmo18.github.io/gtdrv/ (or your own page)
- Privacy policy URL: https://dmo18.github.io/gtdrv/privacy.html
  (this page is `public/privacy.html`; it goes live when the site is published.
  Replace the contact placeholder inside it first.)

## Graphics (already generated in `store/`)

| Play field | File | Size |
| --- | --- | --- |
| App icon | `store/icon-512.png` | 512 x 512 |
| Feature graphic | `store/feature-graphic-1024x500.png` | 1024 x 500 |
| Phone screenshots (8) | `store/screenshot-1.png` to `screenshot-8.png` | 1920 x 1080, landscape |

Play accepts screenshots from 320 to 3840 pixels on a side with the long side
at most twice the short side, so 16:9 landscape is valid. Make them again with
`node scripts/make-icons.mjs` and `node scripts/store-shots.mjs`. For tablet
slots you may reuse the same screenshots, or leave those slots empty.

## Content rating (IARC questionnaire)

Play Console, Policy, App content, Content rating. Choose the category
"Game". Answer honestly. The answers that describe Rustwater:

| Question area | Answer |
| --- | --- |
| Violence | Yes. Realistic-looking violence against human characters (shooting, explosions, vehicles running people over) in a stylised 3D world. Violence against animals: no, unless you add some. |
| Blood and gore | Yes, blood. No dismemberment, no graphic gore. |
| Sexual content or nudity | No |
| Profanity or crude humour | Answer for what is actually in the game (check the in-game text and shop signs). |
| Controlled substances (drugs, alcohol, tobacco) | No, unless the game shows them. |
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

What the app does keep: game progress, scores and settings are saved on the
device in WebView local storage (`localStorage`). This data never leaves the
device, so under Google's definition it is not "collected". Declare nothing for
it, and mention it in the privacy policy (already done).

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
   stylised low polygon style, with no dismemberment. Describe it plainly in
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

All the content in Rustwater is original work made for this project. The
island, the street layout, building models, signs and shop names, vehicles,
characters, weapons, user interface, icons, the feature graphic, the
screenshots and the audio were created for this game, either drawn in code or
generated procedurally at runtime or build time. The game does not use art,
audio, names, characters, maps, logos or trademarks from any existing game,
film, brand or real organisation, and no third party game assets were
copied. The only third party code is the open source three.js library (MIT
licence) used for 3D rendering, bundled into the app. Names of fictional
places and shops in the game are invented, and any resemblance to real
businesses is accidental.
