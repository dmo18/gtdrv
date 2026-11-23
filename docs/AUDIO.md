# Rustwater audio: design and measurements

Every sound in the game is generated in code when audio is unlocked:
no audio files, no network. This page says how each sound is built, what
it measures, and how honest those numbers are.

**Read this first.** Nobody has listened to these sounds while they
were made. Everything below was measured: buffers rendered offline in
node (`node scripts/audio-analyze.mjs`) and the live mix measured in
headless Chromium (`node scripts/audio-test.mjs`). Measurements can show
that a sound has the energy, spectrum, length and dynamics of the real
thing, and that nothing clips. They cannot show that it sounds good on a
real phone speaker. Treat the descriptions below as intentions backed by
numbers, not as listening notes.

## What was wrong (measured, before this pass)

The owner heard the old sound as "absolute garbage" on a phone. The
numbers explain much of it:

- **Heavy sounds were almost all sub-bass.** A phone speaker plays very
  little below about 150 to 300 Hz. Before: crash thud 100 % of its power
  under 100 Hz, explosion 90 %, tank cannon 92 %, tank engine and tracks
  96 %, door slam 95 %, helicopter rotor 79 %, shotgun 96 %. On a phone
  those sounds were close to silent apart from small clicks.
- **Gunshots had no crack.** Pistol spectral centroid 206 Hz (real
  reports are centered around 1 to 3 kHz), half its power under 100 Hz.
- **Engines had no top end and repeated.** 1 to 3 kHz held only 1 to 4 %
  of engine power (real recordings: exhaust rasp and mechanical noise
  there), and each loop was only 0.22 to 0.4 s long, so the
  cycle-to-cycle variation repeated 3 to 4 times a second: a mechanical
  "motorboat" pattern.
- **The mix was quiet and the master curve was never linear.** The
  output sat around -20 dBFS and a tanh curve shaped every sample.
- Smaller gaps: the plane nose gun had no sound at all; bullet impacts
  were one generic tick; no music; no birds; no footsteps.

## Signal chain (src/systems/audio.js)

```
sources -> per-bus gain (engine, tires, world, effects, ui) -> master
music   -> music bus -> explosion duck -> master
all buses -> sends -> one shared ConvolverNode (generated 1.1 s street IR
             with building slap-back echoes) -> master
master -> glue compressor (-16 dB, 2.5:1, knee 12, attack 6 ms,
          release 400 ms: slow, so engines do not pump)
       -> trim 0.75 -> peak limiter (-3 dB, 20:1, attack 1 ms)
       -> safety curve (exactly linear below 0.8, rounds off above)
       -> speakers
master -> phone bass helper: low-pass 140 Hz -> harmonic curve ->
          band 170..750 Hz -> 0.32 -> compressor
```

- The context is created with `latencyHint: 'interactive'` at the
  device's own rate (44.1 or 48 kHz; buffers are made at 12, 11.025 or
  22.05 kHz and resampled by the browser as they play; the impulse
  response is built at the context rate).
- Unlock: `unlock()` runs on the Play button; after that, `touchend`,
  `pointerup`, `click` and `keydown` on the window resume a suspended or
  interrupted context (Android only counts those as activations, not
  touchstart). Visibility changes and pause suspend and resume it; a
  failed resume is retried at most every 0.5 s.
- No ScriptProcessor and no AudioWorklet: only buffer sources, gains,
  biquads, panners, two compressors, two wave shapers and one convolver.
- Caps: 10 pooled event voices (each up to 5 layers, one low-pass, one
  panner), 6 raw engine pops/blow-offs/footsteps, 4 ambient spots, 4
  other-vehicle engine slots, the player's rig, the siren, 7 ambience
  beds, and music notes (about 30 short sources per 2.5 s bar).
- Settings: master volume (existing), plus **Music on/off** and **Music
  volume** in the settings tab (saved as `music`, `musicVol`).
  `setVolume({ master, music, musicOn, sfx, ambience, muteAll })`.
- **Volume model** (src/audio/levels.js, pure): effective level = master
  times category. Master is the master gain node; music, effects
  (engine, tires, effects and ui buses) and ambience (the world bus: city,
  birds, wind, surf, rain, cabin wind) are the category buses under it.
  Mute all sets the master to 0 (fast 12 ms constant, silent inside 0.1 s)
  and keeps every slider. Routing audit: every source ends in a bus, every
  bus in the master (reverb return, siren and music ducks included); the
  bass-synth tap reads the master, so nothing reaches the output around
  it. The old build scaled the world bus by the effects level and had no
  ambience control; music now follows its slider exactly. Check:
  `node scripts/volume-test.mjs` (real gain values in Chromium) and
  `test/levels.test.js`.

## Sound designs (plain language)

**Car engines** (src/audio/engines.js). Each firing is a pressure pulse
(fast blowdown spike, slower rarefaction) that rings the exhaust and body
resonances; combustion roughness, intake roar breathing with the firing
rhythm, gear whine and, new, an *exhaust rasp*: noise gated by each pulse
and band-passed at 1.5 to 3.2 kHz. The whole loop is then overdriven
asymmetrically (exhaust-pipe harmonics) and the low band is "harmonized"
(see below). Five rpm points (idle, low, mid, high, redline) times an
on-load and an overrun layer, equal-power crossfaded by rpm and throttle.
Loops are 0.64 s (whole engine cycles) instead of 0.25 s. Characters:
inline four (buzzy, rasp 2.7 kHz), V6 (round, light turbo), cross-plane
V8 (uneven bank pattern, burble, low rasp), sports flat six (high rev,
3.2 kHz rasp, turbo), diesel (knock, turbo), outboard and inboard boat
engines (exhaust through water), aircraft flat six with blade thumps.
Behavior: gear shifts drop rpm and cut the load layer, with a body
clunk; a rev limiter cuts ignition about 14 times a second at redline;
lift-off pops for the V8 and sports car; turbo whistle rising with boost
and a fluttering blow-off valve on lift (V6, sports, diesel). There is no
electric car in the game, so no electric whine.

**Tires, road, wind, impacts.** Road roar, gravel, wet hiss and squeal
loops scale with speed and slip; wind grows with the square of speed.
Crashes layer a body thud (now with a panel knock at 320 Hz and
harmonics), a metal crunch through three random resonances, and glass
for hard hits.

**Aircraft.** Jet: two turbine whine layers that spool up, a broadband
roar whose low-pass opens with thrust, and the fighter's afterburner
layer (deep roar with ragged crackle). Prop plane: the flat six with
blade passes. Helicopter: the rotor loop is a blade slap at 13 to 17 Hz
(2 or 4 blades) with a short broadband crack of air on every pass (new,
300 Hz and 900 Hz bands), plus tail rotor and turbine whine. AI planes
and helicopters use the four engine slots with doppler, distance
low-pass and occlusion.

**Boats.** Outboard and inboard engines, bow wash by speed, hull slaps
from the boat's bounce, splashes, harbor lapping and surf on shore.

**Tank.** Diesel rumble with track-link clanks (louder now, plus a
high-passed link rattle and injector knock with every firing), pivot
squeal, turret motor whine. Cannon: a 4 ms muzzle N-wave and noise
crack, a falling 74 to 22 Hz thump, a long rumble, a breech clunk, then
the shared explosion rumble tail and reverb. Coax gun uses the rifle
report.

**Guns** (src/audio/combatsounds.js). Each report has a supersonic
crack (an N-wave 0.35 to 1.2 ms long plus a 2 to 4 ms noise burst), a
muzzle-blast body (band-passed noise 420 to 1050 Hz), a short low thump,
a short tail and mechanical detail (slide, pump). Pistol, SMG, shotgun,
rifle (tank coax) and an aircraft cannon (plane nose gun, previously
silent). At play time: distance delay (speed of sound), distance
low-pass, a slap-back echo off facades when the street is enclosed, and
the shared reverb. Shell casings tinkle after your own pistol and SMG
shots on foot.

**Impacts.** Concrete and ground (hard click, grit, dust), metal on
craft (ringing inharmonic modes), body hits (a slap plus a low thump with
harmonics), ricochets, whiz-bys, reload clicks, melee thwacks, grenade
pin and bounce, sticky-bomb beep, bomb whistle, rocket launch (ignition,
rising roar, hiss).

**Explosions.** Four layers chosen per event: *crack* (3.5 ms N-wave
and broadband burst; only within 300 m), *body* (a 90 to 28 Hz thump and
a fireball roar whose low-pass closes from 3.4 kHz to 180 Hz), *rumble
tail* (4.5 s, slowly rolling, darker and relatively louder far away) and
*debris rain* (ticks, clinks and small thuds over 2.5 s, within 90 m).
Size from `size` and `radius` changes pitch (bigger is lower), level and
range (up to about 1 km), and big ones add a second, lower body. Sound
arrives late by distance / 343 m/s and is low-passed with distance.
Music and ambience duck under it.

**Phone bass ("harmonize", src/audio/dsp.js).** The low band of a heavy
sound is clipped hard and rectified, which makes its 2nd and 3rd
harmonics; those are band-limited to roughly 1.6 x the cut-off up to
700 to 1200 Hz and mixed back. The ear reconstructs the missing
fundamental, so a 45 Hz V8 or a 30 Hz boom keeps a pitch and weight on a
speaker that cannot play 45 Hz. A cheap version of the same runs on the
master for anything else.

**City ambience.** Distant traffic wash (darker at night), birds by
day in quieter districts (new), crickets at night, wind by weather, rain,
gulls and surf near the shore, dock clanks, far horns and passing cars.
Siren: wail and yelp cycles with doppler, distance low-pass, reverb and
now a muffle when a building is in the way; its level was lowered (the
buffer is dense, -5 dBFS RMS). Horns: two detuned two-tone pairs.

**Music** (src/audio/music.js). Six short instrument samples (FM
pluck, saw bass, detuned saw pad, kick, snare, hat) and a seeded composer
that writes one bar at a time: a mode (aeolian, dorian or mixolydian), a
key, a tempo of 88 to 103 BPM, a four-chord progression that may change
every 8 bars, an eighth-note arpeggio over the chord, a syncopated bass
and a light kit, with a drumless breakdown every fourth section. The
audio system schedules each bar half a second ahead on the music bus. It
never repeats exactly and costs about 0.4 MB. On by default at half
volume; switch it off in settings.

**Footsteps.** On foot, a step every 0.75 m walking (1.3 m running):
heel tap and scuff on sidewalk, a soft rustle in parks and on the beach.

**Spatial.** Stereo pan from the camera's right vector, distance
attenuation, doppler for other vehicles and the siren
(`src/audio/spatial.js`), speed-of-sound delay for guns and explosions,
distance low-pass, and occlusion-lite: one collision ray every quarter
second from the player to each of the four engine slots and to the
siren; a wall in between closes their low-pass.

## Radio (src/audio/radioplayer.js, radio.js, radiosounds.js, core/radio.js)

In a car or boat the RADIO button in the "more" fan (or Settings, "Car
radio") steps through Off, **Lagoon Drive**, **Pulse Harbor**, **Lamplight
Keys** and **Gullspeak** (station names are invented). On foot, or in a
plane, tank or helicopter, the station stops and the background score
returns. Everything is generated from the seeded rng; no audio files.

- **Lagoon Drive**: the existing composer (music.js) with its own seed and
  a slower 82 to 93 BPM.
- **Pulse Harbor**: dance pop at 118 to 124 BPM. Four-on-the-floor kick,
  claps, offbeat hats, a rolling offbeat sub bass, syncopated chord stabs
  and a sixteenth-note lead; intro, full, breakdown with a clap build.
- **Lamplight Keys**: slow jazz-like, 72 to 81 BPM, swung eighths. Chord
  voicings are generated (third, fifth, seventh and ninth of ii V I style
  progressions, kept inside an octave), an electric-piano comp, a short
  melody from chord tones, a walking bass with a half-step approach, and
  brushed-style noise drums (brush swish, ride tick, feathered kick).
- **Gullspeak** (talk). Honest version: **there is no speech.** No speech
  service and no speech files exist. The station plays a jingle, then a
  stylised talk texture (one short vowel blip per syllable of the caption,
  made from a glottal pulse train through formant filters, with a pitch
  contour that falls at the end of a sentence and rises on a question) while
  the **words are shown as captions** in a small strip below the minimap
  (src/systems/radio.js). Each line is one of 40 original DJ lines about the
  island, three songs between lines, "Now playing: <invented title>"
  captions, and an ad jingle plus one of 8 invented ads after every third
  song. The strip is shown only while the station plays and is cleared when
  the station changes.
- **Switching** crossfades over 0.6 s: every tune-in gets its own gain bus
  under the music bus; the old bus ramps to 0 (and the background score
  ramps back in if the station is off), then the old bus is disconnected.
  Only the station on air is scheduled, so the cost is one bar of notes
  (about 25 sources) every 1.5 to 3 s. Music volume and the Music switch
  apply to the radio too. A station on air steps back with the music under
  explosions (the existing duck) and, new, under a siren within 150 m.
- Memory: 12 new buffers, 0.35 MB. The memory limit in the tests moved from
  12 to 12.5 MB for them (the bank is 12.2 MB).
- Measured (headless Chromium, busy machine): scheduling a bar averages
  about 0.7 ms and at most 3 ms, at most 25 notes per bar, no clipping and no
  click when switching (largest sample jump the same as steady playback),
  stations within 2x of each other in mean RMS.
- Not done: the talk station is not speech and sounds like a muffled
  chatter of beeps. Nobody has listened to any of this on a phone.

## Checks (scripts/audio-test.mjs, test/audio.test.js)

The browser harness keeps all its earlier checks and adds: no buffer
clips; loudness of every buffer within -36..-4 (one-shots) or -40..-4
(loops); spectral centroid ranges for 18 categories; at least 10 % of
power above 100 Hz for every heavy sound (52 buffers); gun crest factor
at least 14 dB; explosion layers last crack < body < tail (> 3 s);
on-load engine at least 3 dB louder than overrun; impulse response at
the context rate; doppler direction on a real approaching and receding
car; music plays and switches off; a point-blank huge explosion is loud
but below full scale at the output; pointerup resumes a suspended
context; render cost; generation job length. The engine pitch check now
finds the fundamental by harmonic product (f, 2f, 3f, 4f) instead of the
lowest strong peak, because the new engines (like real ones) can have a
louder 2nd firing harmonic than the fundamental; it still requires the
3x rpm step to give a 3x pitch step within 25 %. Two limits changed on
purpose: the voice cap from 8 to 10 (explosions hold a voice for their
4 s tail) and the listed combat buffer memory from 2 to 2.5 MB (the list
now holds 9 more buffers); the total memory limit stays 12 MB (12.5 MB since the radio samples).

## Performance

Headless Chromium on a shared, heavily loaded 4-core machine; a phone
will be slower, a quiet desktop faster.

- Parameter update (30 Hz): about 0.17 ms on average; 2 of about 2230
  updates over 4 ms (worst about 6 ms).
- Bank generation: about 0.45 s wall, about 0.43 s main thread in 35 to
  45 slices before sound starts, then about 1 s more in the background
  for the extras and other engines. Median job about 1 ms, 95th
  percentile 10 to 15 ms; single jobs (the 2.6 s tank cannon, engine
  sets) can reach 20 to 45 ms when the machine is busy.
- Memory: 11.9 MB of buffers with every engine character made.

## Measured numbers per sound

Peak and RMS in dBFS, crest = peak / RMS in dB, "loud" is a rough
K-weighted loudness (loudest 400 ms for one-shots, whole loop for loops),
centroid in Hz, then the share of power (percent) in bands below 100 Hz,
100 to 300 Hz, 300 Hz to 1 kHz, 1 to 3 kHz, 3 to 8 kHz, and the time to
fall 40 dB. Variants after the first, middle engine rpm points and the
music samples are left out. Regenerate with
`node scripts/audio-analyze.mjs --md`.

| sound | type | dur s | peak dBFS | RMS dBFS | crest dB | loud | centroid Hz | <100 | 100-300 | 300-1k | 1k-3k | 3k-8k | decay s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| abroar | loop | 2.00 | -1.9 | -14.6 | 12.7 | -16.7 | 405 | 23 | 57 | 11 | 7 | 3 | - |
| beep | shot | 0.07 | -6.0 | -15.1 | 9.1 | -13.8 | 2544 | 0 | 0 | 0 | 92 | 8 | 0.07 |
| birds | loop | 4.00 | -4.4 | -18.1 | 13.7 | -16.4 | 3397 | 0 | 0 | 0 | 27 | 73 | - |
| blastBody0 | shot | 2.20 | -0.4 | -15.0 | 14.6 | -11.2 | 637 | 70 | 7 | 7 | 9 | 5 | 2.10 |
| blastCrack0 | shot | 0.40 | -0.4 | -21.5 | 21.0 | -20.5 | 2102 | 0 | 2 | 31 | 45 | 19 | 0.20 |
| blastTail | shot | 4.50 | -0.9 | -18.3 | 17.4 | -18.0 | 97 | 59 | 38 | 2 | 0 | 0 | 3.85 |
| blowoff | shot | 0.60 | -1.9 | -19.9 | 18.0 | -16.4 | 5174 | 0 | 0 | 1 | 24 | 54 | 0.56 |
| bodyHit0 | shot | 0.25 | -1.4 | -16.3 | 14.9 | -18.9 | 107 | 79 | 17 | 3 | 0 | 0 | 0.20 |
| buffet | loop | 1.50 | -1.4 | -14.5 | 13.1 | -23.0 | 47 | 91 | 9 | 0 | 0 | 0 | - |
| casing0 | shot | 0.50 | -4.4 | -24.5 | 20.0 | -21.7 | 4331 | 0 | 0 | 0 | 0 | 100 | 0.39 |
| checkpoint | shot | 0.45 | -4.4 | -16.6 | 12.2 | -15.5 | 1495 | 0 | 0 | 0 | 99 | 1 | 0.44 |
| chime | shot | 1.10 | -3.1 | -16.3 | 13.2 | -12.9 | 951 | 0 | 0 | 64 | 36 | 0 | 0.89 |
| city | loop | 3.00 | -1.9 | -14.1 | 12.1 | -18.1 | 277 | 57 | 23 | 13 | 7 | 1 | - |
| clank0 | shot | 1.00 | -1.9 | -17.5 | 15.6 | -14.5 | 478 | 0 | 0 | 93 | 7 | 0 | 0.99 |
| click | shot | 0.06 | -4.4 | -22.6 | 18.2 | -21.2 | 2332 | 0 | 0 | 0 | 99 | 0 | 0.03 |
| crank | shot | 1.15 | -1.9 | -17.4 | 15.4 | -17.5 | 466 | 0 | 38 | 55 | 6 | 0 | 0.55 |
| crickets | loop | 3.00 | -3.1 | -21.4 | 18.3 | -19.6 | 4280 | 0 | 0 | 0 | 0 | 100 | - |
| crunch0 | shot | 0.80 | -0.9 | -21.9 | 21.0 | -17.6 | 4125 | 1 | 2 | 8 | 38 | 34 | 0.59 |
| debris0 | shot | 2.60 | -1.4 | -25.2 | 23.8 | -16.7 | 5579 | 4 | 7 | 1 | 12 | 48 | 1.51 |
| doorClose | shot | 0.45 | -0.9 | -15.9 | 15.0 | -20.3 | 144 | 95 | 2 | 2 | 0 | 1 | 0.28 |
| doorOpen | shot | 0.40 | -3.1 | -21.4 | 18.3 | -23.6 | 135 | 0 | 99 | 1 | 0 | 0 | 0.15 |
| emptyClick | shot | 0.08 | -4.4 | -25.2 | 20.8 | -24.2 | 1438 | 0 | 0 | 0 | 100 | 0 | 0.03 |
| eng:diesel:0:off | loop | 0.58 | -15.1 | -25.8 | 10.6 | -29.0 | 149 | 35 | 62 | 1 | 1 | 0 | - |
| eng:diesel:0:on | loop | 0.58 | -5.2 | -15.2 | 10.0 | -18.1 | 291 | 34 | 58 | 2 | 3 | 3 | - |
| eng:diesel:2:off | loop | 0.64 | -14.4 | -25.9 | 11.4 | -27.5 | 372 | 12 | 55 | 27 | 5 | 1 | - |
| eng:diesel:2:on | loop | 0.64 | -4.9 | -15.2 | 10.3 | -16.5 | 612 | 12 | 46 | 27 | 10 | 5 | - |
| eng:diesel:4:off | loop | 0.63 | -11.4 | -22.7 | 11.2 | -23.9 | 464 | 0 | 42 | 51 | 5 | 2 | - |
| eng:diesel:4:on | loop | 0.63 | -1.4 | -11.4 | 9.9 | -12.5 | 597 | 0 | 38 | 50 | 8 | 4 | - |
| eng:i4:0:off | loop | 0.71 | -22.1 | -33.9 | 11.8 | -36.0 | 468 | 27 | 53 | 6 | 11 | 3 | - |
| eng:i4:0:on | loop | 0.71 | -10.4 | -21.0 | 10.6 | -22.7 | 729 | 24 | 47 | 6 | 16 | 7 | - |
| eng:i4:1:off | loop | 0.65 | -18.9 | -30.6 | 11.7 | -31.7 | 601 | 3 | 68 | 11 | 14 | 4 | - |
| eng:i4:1:on | loop | 0.65 | -8.2 | -17.7 | 9.5 | -18.6 | 830 | 2 | 62 | 11 | 18 | 7 | - |
| eng:i4:2:off | loop | 0.64 | -16.6 | -28.3 | 11.6 | -29.1 | 762 | 0 | 52 | 25 | 19 | 4 | - |
| eng:i4:2:on | loop | 0.64 | -5.7 | -14.8 | 9.1 | -15.6 | 887 | 0 | 50 | 25 | 16 | 8 | - |
| eng:i4:3:off | loop | 0.64 | -15.9 | -27.1 | 11.2 | -27.9 | 816 | 0 | 28 | 49 | 19 | 4 | - |
| eng:i4:3:on | loop | 0.64 | -5.2 | -13.7 | 8.6 | -14.5 | 944 | 0 | 29 | 45 | 18 | 8 | - |
| eng:i4:4:off | loop | 0.63 | -12.7 | -23.3 | 10.6 | -24.4 | 571 | 0 | 68 | 17 | 12 | 3 | - |
| eng:i4:4:on | loop | 0.63 | -1.4 | -9.9 | 8.5 | -10.9 | 647 | 0 | 67 | 18 | 10 | 5 | - |
| eng:inboard:0:off | loop | 0.60 | -11.9 | -22.1 | 10.2 | -26.0 | 110 | 59 | 40 | 1 | 0 | 0 | - |
| eng:inboard:0:on | loop | 0.60 | -2.6 | -11.9 | 9.4 | -15.8 | 127 | 60 | 37 | 1 | 1 | 0 | - |
| eng:inboard:2:off | loop | 0.65 | -12.1 | -22.6 | 10.4 | -24.9 | 199 | 13 | 72 | 14 | 1 | 0 | - |
| eng:inboard:2:on | loop | 0.65 | -3.2 | -12.9 | 9.7 | -15.1 | 239 | 14 | 66 | 17 | 2 | 0 | - |
| eng:inboard:4:off | loop | 0.63 | -10.9 | -21.6 | 10.7 | -23.1 | 327 | 0 | 57 | 41 | 2 | 0 | - |
| eng:inboard:4:on | loop | 0.63 | -1.4 | -11.3 | 9.9 | -12.7 | 378 | 0 | 53 | 43 | 4 | 0 | - |
| eng:outboard:0:off | loop | 0.60 | -17.8 | -30.9 | 13.2 | -33.8 | 232 | 33 | 55 | 8 | 4 | 0 | - |
| eng:outboard:0:on | loop | 0.60 | -9.4 | -20.1 | 10.7 | -22.7 | 373 | 34 | 50 | 5 | 8 | 2 | - |
| eng:outboard:2:off | loop | 0.64 | -15.3 | -27.3 | 11.9 | -28.7 | 330 | 5 | 61 | 31 | 3 | 0 | - |
| eng:outboard:2:on | loop | 0.64 | -5.5 | -14.6 | 9.1 | -15.7 | 603 | 4 | 51 | 29 | 13 | 3 | - |
| eng:outboard:4:off | loop | 0.63 | -11.7 | -22.5 | 10.8 | -23.9 | 333 | 0 | 65 | 33 | 1 | 0 | - |
| eng:outboard:4:on | loop | 0.63 | -1.4 | -9.8 | 8.3 | -10.9 | 528 | 0 | 59 | 29 | 9 | 2 | - |
| eng:prop:0:off | loop | 0.69 | -8.0 | -17.4 | 9.4 | -21.8 | 97 | 53 | 46 | 0 | 0 | 0 | - |
| eng:prop:0:on | loop | 0.69 | -5.5 | -13.1 | 7.6 | -16.7 | 149 | 35 | 61 | 2 | 1 | 0 | - |
| eng:prop:2:off | loop | 0.61 | -7.4 | -14.4 | 7.0 | -17.2 | 142 | 29 | 70 | 1 | 0 | 0 | - |
| eng:prop:2:on | loop | 0.61 | -3.3 | -10.0 | 6.8 | -12.6 | 213 | 24 | 68 | 5 | 2 | 0 | - |
| eng:prop:4:off | loop | 0.64 | -5.6 | -13.0 | 7.4 | -14.9 | 210 | 12 | 75 | 13 | 0 | 0 | - |
| eng:prop:4:on | loop | 0.64 | -2.2 | -8.6 | 6.4 | -10.4 | 324 | 9 | 65 | 21 | 4 | 1 | - |
| eng:sports:0:off | loop | 0.63 | -19.0 | -30.5 | 11.5 | -32.8 | 288 | 33 | 56 | 7 | 3 | 1 | - |
| eng:sports:0:on | loop | 0.63 | -9.1 | -18.2 | 9.2 | -19.9 | 651 | 29 | 47 | 7 | 11 | 7 | - |
| eng:sports:2:off | loop | 0.63 | -13.2 | -23.2 | 10.0 | -24.4 | 403 | 0 | 69 | 26 | 4 | 1 | - |
| eng:sports:2:on | loop | 0.63 | -4.2 | -10.6 | 6.4 | -11.6 | 612 | 0 | 65 | 22 | 8 | 5 | - |
| eng:sports:4:off | loop | 0.65 | -12.7 | -23.5 | 10.7 | -24.2 | 738 | 0 | 2 | 87 | 8 | 2 | - |
| eng:sports:4:on | loop | 0.65 | -1.4 | -9.4 | 8.0 | -9.5 | 1467 | 0 | 0 | 61 | 22 | 17 | - |
| eng:v6:0:off | loop | 0.64 | -16.7 | -27.9 | 11.2 | -31.0 | 158 | 28 | 69 | 1 | 1 | 0 | - |
| eng:v6:0:on | loop | 0.64 | -7.0 | -16.1 | 9.1 | -19.2 | 178 | 29 | 67 | 3 | 2 | 0 | - |
| eng:v6:1:off | loop | 0.63 | -16.2 | -26.8 | 10.6 | -28.5 | 289 | 14 | 66 | 17 | 3 | 0 | - |
| eng:v6:1:on | loop | 0.63 | -5.4 | -14.5 | 9.1 | -16.1 | 330 | 15 | 61 | 20 | 4 | 1 | - |
| eng:v6:2:off | loop | 0.64 | -14.2 | -24.8 | 10.6 | -26.3 | 346 | 0 | 56 | 40 | 3 | 0 | - |
| eng:v6:2:on | loop | 0.64 | -2.6 | -11.6 | 9.0 | -13.1 | 385 | 0 | 53 | 42 | 4 | 1 | - |
| eng:v6:3:off | loop | 0.65 | -12.9 | -24.9 | 12.0 | -26.0 | 435 | 0 | 50 | 46 | 4 | 0 | - |
| eng:v6:3:on | loop | 0.65 | -2.0 | -11.5 | 9.5 | -12.4 | 535 | 0 | 38 | 54 | 7 | 1 | - |
| eng:v6:4:off | loop | 0.63 | -11.7 | -24.6 | 12.9 | -25.5 | 562 | 0 | 1 | 90 | 9 | 1 | - |
| eng:v6:4:on | loop | 0.63 | -1.4 | -11.5 | 10.0 | -12.2 | 714 | 0 | 0 | 82 | 16 | 2 | - |
| eng:v8:0:off | loop | 0.71 | -9.5 | -23.2 | 13.7 | -27.2 | 103 | 68 | 31 | 0 | 0 | 0 | - |
| eng:v8:0:on | loop | 0.71 | -4.2 | -12.8 | 8.6 | -16.8 | 121 | 74 | 24 | 1 | 1 | 0 | - |
| eng:v8:1:off | loop | 0.67 | -11.1 | -23.7 | 12.6 | -25.8 | 211 | 2 | 80 | 18 | 1 | 0 | - |
| eng:v8:1:on | loop | 0.67 | -2.9 | -12.7 | 9.8 | -14.6 | 256 | 1 | 74 | 22 | 2 | 0 | - |
| eng:v8:2:off | loop | 0.64 | -13.7 | -26.5 | 12.8 | -27.7 | 411 | 1 | 46 | 49 | 4 | 0 | - |
| eng:v8:2:on | loop | 0.64 | -3.6 | -14.1 | 10.5 | -15.2 | 516 | 1 | 39 | 50 | 9 | 1 | - |
| eng:v8:3:off | loop | 0.64 | -8.4 | -23.8 | 15.4 | -24.9 | 444 | 0 | 63 | 31 | 5 | 0 | - |
| eng:v8:3:on | loop | 0.64 | -2.0 | -11.2 | 9.2 | -12.2 | 497 | 0 | 71 | 20 | 8 | 1 | - |
| eng:v8:4:off | loop | 0.63 | -9.9 | -23.4 | 13.5 | -24.3 | 533 | 1 | 10 | 81 | 9 | 0 | - |
| eng:v8:4:on | loop | 0.63 | -1.4 | -11.1 | 9.7 | -11.9 | 680 | 0 | 5 | 79 | 15 | 1 | - |
| fail | shot | 0.75 | -4.4 | -16.6 | 12.2 | -15.2 | 291 | 0 | 63 | 37 | 0 | 0 | 0.55 |
| glass0 | shot | 1.10 | -1.9 | -22.3 | 20.3 | -16.0 | 5363 | 0 | 0 | 0 | 10 | 88 | 0.56 |
| gravel | loop | 2.00 | -1.9 | -20.1 | 18.2 | -19.2 | 2763 | 6 | 6 | 8 | 40 | 39 | - |
| gull0 | shot | 1.20 | -1.9 | -15.3 | 13.4 | -13.1 | 1891 | 0 | 0 | 11 | 77 | 12 | 0.81 |
| gunCannon0 | shot | 0.40 | -0.4 | -18.9 | 18.5 | -20.1 | 458 | 47 | 14 | 26 | 10 | 2 | 0.33 |
| gunLobber | shot | 1.10 | -0.9 | -15.7 | 14.7 | -12.6 | 2428 | 20 | 1 | 9 | 43 | 22 | 1.09 |
| gunPistol0 | shot | 0.55 | -0.4 | -23.2 | 22.8 | -21.5 | 894 | 21 | 15 | 29 | 31 | 3 | 0.30 |
| gunRifle0 | shot | 0.80 | -0.4 | -22.6 | 22.1 | -19.8 | 596 | 35 | 14 | 33 | 16 | 2 | 0.53 |
| gunScatter | shot | 1.10 | -0.4 | -22.2 | 21.8 | -19.3 | 501 | 49 | 9 | 27 | 12 | 2 | 0.84 |
| gunSmg0 | shot | 0.32 | -0.4 | -24.3 | 23.8 | -23.1 | 1294 | 5 | 15 | 28 | 45 | 7 | 0.15 |
| hornA | loop | 1.00 | -1.9 | -11.7 | 9.8 | -11.9 | 963 | 0 | 0 | 65 | 33 | 2 | - |
| hornB | loop | 1.00 | -1.9 | -13.1 | 11.1 | -13.6 | 738 | 0 | 21 | 60 | 18 | 1 | - |
| impact0 | shot | 0.15 | -3.1 | -25.4 | 22.3 | -25.1 | 323 | 5 | 68 | 23 | 4 | 1 | 0.08 |
| impactConcrete0 | shot | 0.30 | -1.4 | -26.6 | 25.1 | -25.9 | 1713 | 0 | 7 | 28 | 50 | 15 | 0.20 |
| impactMetal0 | shot | 0.45 | -1.4 | -22.3 | 20.9 | -20.5 | 2541 | 0 | 0 | 0 | 84 | 14 | 0.42 |
| ir | shot | 1.10 | -8.1 | -27.3 | 19.2 | -21.5 | 3946 | 2 | 5 | 16 | 35 | 30 | 1.08 |
| jetroar | loop | 2.00 | -1.9 | -13.9 | 11.9 | -14.5 | 1055 | 7 | 19 | 55 | 13 | 3 | - |
| lap | loop | 3.00 | -2.5 | -21.7 | 19.2 | -23.0 | 650 | 12 | 18 | 56 | 12 | 2 | - |
| lockOn | shot | 0.42 | -6.9 | -10.8 | 3.9 | -9.9 | 1744 | 0 | 0 | 0 | 94 | 6 | 0.33 |
| lockSeek | shot | 0.06 | -6.9 | -15.7 | 8.8 | -15.6 | 1180 | 0 | 0 | 0 | 100 | 0 | 0.06 |
| pin | shot | 0.22 | -4.4 | -19.2 | 14.7 | -17.5 | 3257 | 0 | 0 | 0 | 0 | 100 | 0.20 |
| pop0 | shot | 0.14 | -0.9 | -17.6 | 16.6 | -21.9 | 154 | 96 | 0 | 1 | 2 | 1 | 0.09 |
| rain | loop | 2.00 | -2.5 | -19.3 | 16.8 | -17.5 | 4949 | 0 | 0 | 2 | 28 | 55 | - |
| reloadA | shot | 0.16 | -3.1 | -26.4 | 23.3 | -25.9 | 1411 | 0 | 0 | 16 | 84 | 0 | 0.09 |
| reloadB | shot | 0.30 | -3.1 | -20.4 | 17.3 | -21.2 | 1592 | 0 | 5 | 21 | 69 | 4 | 0.29 |
| ricochet0 | shot | 0.50 | -3.1 | -20.6 | 17.5 | -18.0 | 2653 | 0 | 0 | 0 | 81 | 19 | 0.48 |
| road | loop | 2.00 | -1.9 | -13.7 | 11.8 | -16.0 | 654 | 34 | 32 | 10 | 20 | 5 | - |
| rocketLaunch | shot | 1.60 | -0.9 | -15.5 | 14.5 | -11.3 | 5403 | 5 | 0 | 3 | 21 | 44 | 1.59 |
| rotor | loop | 0.57 | -1.4 | -13.7 | 12.3 | -18.3 | 136 | 57 | 38 | 4 | 1 | 0 | - |
| scrape | loop | 1.20 | -1.9 | -17.4 | 15.4 | -16.1 | 2819 | 0 | 0 | 2 | 55 | 42 | - |
| shift | shot | 0.18 | -3.1 | -17.3 | 14.2 | -19.0 | 182 | 0 | 99 | 1 | 0 | 0 | 0.16 |
| shockThump | shot | 0.90 | -1.4 | -13.6 | 12.2 | -16.7 | 55 | 97 | 3 | 0 | 0 | 0 | 0.78 |
| sirenWail | loop | 3.00 | -1.9 | -5.2 | 3.3 | -4.9 | 1314 | 0 | 0 | 22 | 74 | 4 | - |
| sirenYelp | loop | 0.62 | -1.9 | -5.1 | 3.2 | -4.8 | 1379 | 0 | 0 | 18 | 78 | 4 | - |
| slap0 | shot | 0.40 | -1.4 | -17.9 | 16.5 | -20.3 | 2692 | 5 | 48 | 6 | 7 | 20 | 0.32 |
| splash | shot | 1.30 | -1.4 | -18.7 | 17.3 | -13.1 | 2563 | 2 | 3 | 26 | 39 | 24 | 1.00 |
| spotClick | shot | 0.16 | -4.6 | -22.0 | 17.4 | -21.5 | 1386 | 0 | 8 | 0 | 92 | 0 | 0.10 |
| squeal | loop | 1.60 | -1.9 | -11.6 | 9.6 | -10.9 | 1708 | 0 | 0 | 2 | 95 | 4 | - |
| stepHard0 | shot | 0.16 | -4.4 | -22.0 | 17.6 | -22.5 | 6069 | 0 | 13 | 0 | 4 | 48 | 0.15 |
| stepSoft0 | shot | 0.22 | -6.0 | -23.2 | 17.2 | -22.8 | 2565 | 0 | 3 | 12 | 54 | 30 | 0.20 |
| surf | loop | 5.50 | -1.9 | -16.5 | 14.6 | -15.6 | 3873 | 5 | 7 | 16 | 25 | 29 | - |
| tail | loop | 0.25 | -1.9 | -19.7 | 17.7 | -20.0 | 1172 | 1 | 1 | 49 | 46 | 2 | - |
| tankBoom | shot | 2.60 | -0.3 | -14.8 | 14.6 | -13.5 | 82 | 80 | 16 | 4 | 0 | 0 | 2.55 |
| tankCoax | shot | 0.16 | -0.9 | -19.9 | 19.0 | -20.7 | 306 | 1 | 88 | 4 | 6 | 1 | 0.13 |
| tankCrush | shot | 0.80 | -0.9 | -12.7 | 11.8 | -11.7 | 3107 | 35 | 2 | 14 | 10 | 25 | 0.63 |
| tankTracks | loop | 1.50 | -1.9 | -8.6 | 6.6 | -15.9 | 161 | 86 | 7 | 3 | 3 | 1 | - |
| tankTurret | loop | 1.00 | -4.4 | -12.9 | 8.5 | -14.3 | 292 | 0 | 72 | 24 | 4 | 0 | - |
| thud0 | shot | 0.50 | -0.9 | -15.0 | 14.0 | -18.5 | 84 | 81 | 16 | 3 | 0 | 0 | 0.45 |
| thwack0 | shot | 0.22 | -0.9 | -18.3 | 17.4 | -20.3 | 125 | 0 | 97 | 3 | 0 | 0 | 0.12 |
| tink0 | shot | 0.16 | -4.7 | -22.7 | 18.0 | -21.9 | 1640 | 0 | 0 | 0 | 99 | 1 | 0.14 |
| turbine | loop | 1.00 | -1.9 | -10.7 | 8.8 | -9.8 | 2025 | 0 | 0 | 3 | 88 | 8 | - |
| turbo | loop | 1.00 | -3.1 | -12.4 | 9.3 | -10.8 | 3363 | 0 | 0 | 0 | 3 | 97 | - |
| wash | loop | 2.00 | -1.9 | -13.1 | 11.2 | -12.2 | 3527 | 4 | 4 | 13 | 42 | 20 | - |
| wet | loop | 2.00 | -2.5 | -14.6 | 12.1 | -12.9 | 4169 | 0 | 0 | 1 | 28 | 69 | - |
| whistle | shot | 2.60 | -5.2 | -12.6 | 7.4 | -10.7 | 1244 | 0 | 0 | 27 | 73 | 0 | 0.15 |
| whiz0 | shot | 0.35 | -3.1 | -17.8 | 14.7 | -16.2 | 3639 | 0 | 0 | 0 | 46 | 49 | 0.16 |
| whoosh0 | shot | 2.20 | -1.9 | -19.6 | 17.7 | -11.9 | 3082 | 1 | 1 | 12 | 50 | 29 | 0.83 |
| wind | loop | 2.50 | -1.9 | -16.1 | 14.2 | -18.6 | 318 | 29 | 42 | 22 | 6 | 1 | - |


## A1 phone check fix (0.6.0): "harsh and crackly and just wrong"

The owner marked 7 of 8 phone-check sounds bad on a Galaxy S24 Ultra
(only Radio passed). Rendered offline through the real graph in headless
Chromium (OfflineAudioContext, suspended every 1/60 s), the causes were:

- **Siren slot was silent**: the test car is not a police car and the
  audio only sounds a siren on a vehicle with `siren` set. Now
  `audio.testSiren(on)` plays it as if a police car were 20 m away.
- **Boost whoosh was inaudible**: the plain whoosh at 0.35 on the engine
  bus, about the level of the city bed. Now `boostWhoosh` (noise through
  a low-pass opening 300 Hz to 4 kHz and a rising band-pass) at 0.8 on
  the effects bus.
- **Music was masked**: the car kept driving under it. From the gunshot
  slot on, the phone check now rolls the car to a stop; music bus 0.2 ->
  0.28. The composer's bass "fifth" (+7 semitones) left the mode on some
  chords (a tritone under the pad); it now uses the chord's own fifth.
- **Saturation everywhere, crackle-prone**: `harmonize` used a hard
  clip plus |tanh| rectifier (a corner at every zero crossing); the
  master bass helper did the same live at 0.32. Engines were overdriven
  (drive up to 2.6) at their 12 kHz rate with no oversampling and then
  left unfiltered to Nyquist, with loud pulse-gated noise rasp. Now: a
  smooth rectifier and 4-pole filtering in `harmonize`, the helper curve
  smooth (src/audio/master.js) and mixed at 0.2, engine drive about 0.6x,
  rasp about 0.5x and a 4-pole low-pass at 3.9 kHz on every engine loop;
  blast and gun saturation 1.3 instead of 2.2 to 2.4.
- **Siren was a soft-clipped square** (-5 dBFS RMS buffer): now a
  near-sine (2nd/3rd harmonics at -18 and -20 dB) through a gentle band.
- **Tire squeal** was three Q 24..36 band-passes soft-clipped into a
  dense block whose pitch jittered randomly every update; now wider bands,
  no saturation, pitch follows the slip smoothly.
- **Gunshot was a click**: the 0.5 ms crack alone set the peak (crest
  22.8 dB). Crack softer and longer, body and thump longer and louder,
  an octave thump added, top above 7 kHz rolled off.
- Master: latencyHint 'balanced' (bigger audio buffer on Android, fewer
  underrun crackles), safety curve linear to 0.7 and capped at 0.89
  (-1 dBFS), 4x oversampled; limiter -4 dBFS; trim 0.75 -> 1.

Measured (isolated, master 0.8, peak / RMS dBFS at the output, before ->
after): Engine -9.3/-22.2 -> -6.7/-19.4; Tire squeal -7.0/-19.8 ->
-5.3/-17.2; Gunshot -6.4/-30.0 (loudest 400 ms -25.7) -> -2.9/-27.3 (-22.0);
Blast -2.8/-23.6 -> -1.6/-22.9; Siren silent -> -6.0/-17.1; Music
-12.4/-28.0 -> -7.7/-23.5; Radio -14.3/-28.7 -> -11.0/-24.6; Boost
inaudible (-29.5 = bed) -> -3.5/-21.2 (loudest 400 ms -14.7). No sample
clipped in any render, before or after. Unit tests: test/audio.test.js
("phone-check sounds", "master curves", "music composer stays in key").
Still not heard by anyone: the next phone check is the judge.

## Still weak, honestly

- Not heard. The phone bass helper and the overdrive could sound fizzy
  or harsh in ways the numbers do not show; the master bass helper
  amount (0.32) and engine rasp gains are the first knobs to turn.
- Engines are still one synthesis model with different parameters, not
  recordings; the V8 idle still has about 75 % of its power under
  100 Hz (by design, with harmonics added above).
- No per-cylinder pitch wander inside a loop; loops still repeat every
  0.64 s.
- Explosion body and tail are single samples pitch-shifted by size, so
  many explosions in a row sound related.
- Music is a simple generated groove; it is original but plain.
- Screams, a radio with stations, bell buoys, landing gear thumps, stall
  horns and a missile motor that follows the missile are not made.
- Occlusion is one ray per source, only for vehicle engines and the
  siren, not for gunshots or explosions.
- Timing numbers come from a busy shared machine, not from the phone.
