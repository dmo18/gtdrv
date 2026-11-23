# Market research: what we adopt (from the owner's reference, 2026-11)

The reference is supplemental. Standing owner rules win: fun not points, no money or
shop, everything available from the start, scores and medals only, offline, no network.

## Adopted (fits the rules)

| Finding | What we do | Where |
|---|---|---|
| Driving must feel right; vehicles must feel different | Real class specs, Handling lab, 16 American classes | V3 0.9.0 LAB, 0.10.0 HANDLE, FLEET |
| Large empty worlds fail; density beats size | Five smaller regions, content floor per region, map by real streets | V2 0.7.0, V3 MAP |
| First five minutes decide | Time to first drive under 3 s, no menu wall, guided start that ends in an adventure, skip and replay | V3 0.11.0 START, V2 ST1 |
| Performance, saves, crashes outweigh features | Budgets in docs/PERF.md, soak per region, sanitised saves, no regressions gate | gates |
| Retention without punishment | Daily three from the phone date, records board, no streak penalties, no time gates | V3 0.11.0 LOOP |
| Customization gives ownership | NEW row CUSTOM in 0.11.0: paint colors, metallic finishes, wheels, tint, decals, saved looks, all free, shown in the garage and Phone-sized UI. Earned by play (medals unlock finishes) or simply available (owner rule: everything available) | V3 0.11.0 |
| Character outfits | Same CUSTOM row, a few outfits and accessories, free | 0.11.0 |
| Controls: fewer buttons, adjustable, no clipping camera | Four steering styles kept, HUD grid contract, 748x360 checks, view rework | V3 VIEW |
| Avoid: forced ads, popups, essential content locked | Nothing of that exists in the game | rule |

## Not adopted without an owner decision (changes cost and exposure)

| Item | Why held | Default |
|---|---|---|
| In-app purchases, premium currency, paid cosmetic packs | Conflicts with the standing rule "no money or shop"; needs Play Billing, tax and refund handling, a legal review | Off. Revisit after 1.0.0 |
| Rewarded or any ads | Needs an ad SDK (network at runtime, a privacy policy change, consent), conflicts with "no network" | Off. Revisit after 1.0.0 |
| Analytics (D1/D7/D30, funnels) | Needs a network service or a play console only view; privacy implications | Use only the Google Play Console's built-in crash and vitals data after launch; no SDK |
| Online leaderboards, multiplayer | Rejected earlier by the owner ("No network") | Off |
| Currency and grind economy | Conflicts with "fun not points" | Off. Medals and unlocks only |

## Owner decision (one line, recommended default in bold)

Monetization after 1.0.0: **A. launch free with no ads and no purchases, decide later from
real player feedback**; B. optional cosmetic packs only; C. rewarded ads only.
Silence means A.
