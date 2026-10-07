# Tuning the engine

Every number the engine uses lives in `packages/engine/src/config.ts`, in one
`EngineConfig` object. This page says what each value changes, which direction
to move it, and how to see the effect.

Try a change without editing code — the CLI exposes the ones you will touch most:

```bash
pnpm rally corners  fixtures/sample-ghat.gpx --smooth 9 --span 15
pnpm rally simulate fixtures/sample-ghat.gpx --speed 50 --lead 7 --lag 1.5
```

---

## geometry — how the road shape is measured

| Value | Default | What it does |
| --- | --- | --- |
| `dedupeMeters` | 1 m | Points closer than this to the previous one are dropped. Raise it if a logger spams near-identical fixes at a stop. |
| `resampleMeters` | 5 m | Spacing of the resampled route. Smaller = finer detail and more CPU/memory (a 100 km route at 5 m is 20 000 points). Below ~3 m you mostly resample noise. |
| `smoothing` | `savitzky-golay` | `savitzky-golay` keeps corner sharpness while removing jitter; `moving-average` is blunter and reads tight corners as wider than they are; `none` is for debugging only. |
| `smoothWindow` | 13 samples (60 m) | **The most important knob.** Too small: GPS noise becomes phantom corners (at ±5 m noise, a window of 9 finds 6 corners where there is 1). Too large: genuinely tight corners get flattened and hairpins stacked close together merge. Always odd. |
| `smoothPolyOrder` | 2 | Savitzky-Golay polynomial order. 2 follows arcs. 3 preserves more detail and more noise. |
| `curvatureSpanMeters` | 10 m | Half-span of the 3-point circumradius. Larger (15–20 m) is steadier on noisy data but blurs short corners; smaller is twitchy. |
| `maxRadiusMeters` | 5000 m | Anything wider is reported as straight. Cosmetic. |

## detection — what counts as a corner

| Value | Default | What it does |
| --- | --- | --- |
| `cornerRadiusMeters` | 300 m | The entry threshold: tighter than this and you are "in a corner". Lower it (200 m) if the co-driver mentions motorway-grade bends; raise it (400 m) to hear every lazy curve. Also sets where a corner is considered to *start*, so it shifts call timing slightly. |
| `mergeGapMeters` | 20 m | Same-direction corners separated by less than this become one. Raise it if one long bend is being announced as two; lower it if two real corners are being merged. |
| `minCornerLengthMeters` | 10 m | Runs shorter than this are noise... |
| `shortCornerHeadingChangeDeg` | 45° | ...unless they bend at least this much. This is what keeps a hairpin that exists as 10 m of samples in sparse map data. |
| `minHeadingChangeDeg` | 12° | Hard noise floor: anything bending less is never a corner. Raise to 15–20° if you hear calls for kinks you do not even notice. |
| `longCornerMeters` | 80 m | A corner whose *sustained* tight part exceeds this gets `long`. |
| `sustainedCurvatureFraction` | 0.5 | Which part counts as "sustained": points at least this fraction of the apex curvature. Lower = more corners count as long. (The full detected extent is always padded by the smoothing blend into the straights, which is why `long` is not measured from it.) |
| `intoGapMeters` | 30 m | Corners this close together are chained into one call. Raise it (40–50 m) for more flowing calls on continuously twisty roads; lower it if calls feel over-stuffed. |
| `tightensRatio` | 0.7 | Second half tighter than 70% of the first half → `tightens`. |
| `opensRatio` | 1.4 | Second half wider than 140% of the first half → `opens`. |

## grading — what the corner is called

`thresholds` is a tightest-first list of `{ grade, maxRadius }`; the first bucket
a corner fits wins.

| Grade | Default max radius | Rally number |
| --- | --- | --- |
| hairpin | — (override: >135° turn **and** <25 m radius) | 1 |
| very sharp | 25 m | 2 |
| sharp | 45 m | 3 |
| medium | 80 m | 4 |
| gentle | 150 m | 5 |
| slight | 300 m | 6 |

Move the whole set up if the calls feel alarmist for the speeds you actually
ride, down if "medium" corners keep surprising you. `hairpinHeadingChangeDeg`
and `hairpinRadiusMeters` control the hairpin override: a 150° turn at 28 m
radius is *not* a hairpin by default — it is called "sharp".

## runtime — when and how it speaks

| Value | Default | What it does |
| --- | --- | --- |
| `leadSeconds` | 5 s | How far ahead, in time, the call lands. The single setting riders will want to change. 4 s feels urgent, 7 s feels relaxed and makes corner-to-corner calls run together on twisty roads. |
| `lagSeconds` | 1.0 s | Compensation for speech and system latency: the position is projected this far ahead before deciding. Raise it if calls consistently feel late (Bluetooth codecs with deep buffers), lower it if they feel early. |
| `minLeadMeters` | 30 m | Floor on the warning distance, so crawling up a ghat does not produce a call 8 m before the apex. |
| `maxLeadMeters` | 300 m | Ceiling, so a fast road does not get calls you forget before you arrive. |
| `immediateMeters` | 30 m | Closer than this and the call becomes *"Immediate hairpin right"* with no distance — speaking "20 metres" takes longer than covering it. |
| `offRouteMeters` | 50 m | Perpendicular distance that counts as off-route. Below ~30 m, a wide hairpin or a parallel service road triggers false alarms. |
| `snapSearchMeters` | 150 m | How far along the route the snap searches around the last position. Must exceed the distance covered between two fixes (150 m is ~11 s at 50 km/h, so it survives a few dropped fixes) but stay well below the along-route distance between the two legs of a switchback. |
| `maxAccuracyMeters` | 50 m | Fixes worse than this are ignored entirely. |
| `minSpeedForCalls` | 1.5 m/s | Below this you are stopped; no corner calls. |
| `fallbackSpeed` | 11 m/s | Used before any speed is known. |
| `derivedSpeedSmoothing` | 0.35 | Low-pass factor for speed derived from positions (used when the platform reports no speed, e.g. replaying a recorded GPX). Lower = smoother and laggier. |
| `gpsLostSeconds` | 5 s | Fix age that triggers *"GPS lost"*. |
| `maxRallyNumberToCall` | 6 | Verbosity. 6 calls everything; 3 calls only sharp and tighter; 1 only hairpins. |
| `rallyMode` | false | `false`: *"Sharp right, 80 metres"*. `true`: *"Right 3, 80"*. |
| `distanceRoundingMeters` | 10 m | Spoken distances are rounded to this. |
| `chainIntoCorners` / `maxChainedCorners` | true / 3 | Whether `into` corners share one call, and how many corners one call may cover. |
| `announceBackOnRoute` | true | Say *"back on route"* after an off-route excursion. |
| `routeEndMeters` | 50 m | How close to the end triggers *"route finished"*. |

## A tuning loop that works

1. Ride with the app (Phase 3) — it records a GPX plus a JSON log of every call.
2. Replay it: `pnpm rally simulate route.gpx --replay ride.gpx`.
3. Compare against what you remember: late calls → raise `lagSeconds` or
   `leadSeconds`; corners you did not need to hear → lower
   `maxRallyNumberToCall`; corners that surprised you → check their grade in
   `pnpm rally corners route.gpx` and move the `thresholds`.
4. Re-run with flags (`--lead`, `--lag`, `--smooth`, `--span`) until the list
   reads the way you want, then write the values into `DEFAULT_CONFIG`.

---

# Tuning the OSM layer

`packages/osm/src/config.ts`, same idea.

| Value | Default | What it does |
| --- | --- | --- |
| `corridorMeters` | 150 m | How far either side of the GPX to look for roads. Wide enough for a badly traced line, narrow enough not to drag in the road down in the valley. Raise to 250 m for really rough imports; above ~400 m the matcher starts getting tempted by parallel roads. |
| `corridorChunkMeters` | 5 km | Route is split into chunks, one bounding box each. Smaller = more precise corridor, longer query. |
| `highwayTypes` | 15 values | Which `highway=*` tags count as road. Drop `track` if you keep matching onto farm tracks. |
| `cacheMaxAgeMs` | 6 months | How long a cached corridor stays usable offline. |
| `sampleSpacingMeters` | 15 m | Matching resolution. Smaller = more states = slower (cost is roughly linear in samples × candidates²). |
| `searchRadiusMeters` | 35 m | How far from a sample to look for candidate roads. Must exceed the tracing error of your GPX files; too large and the decoy road next door becomes a candidate. |
| `maxCandidates` | 6 | Candidate roads per sample. |
| `gpsSigmaMeters` | 12 m | How far a GPX point is *expected* to sit from the real road. Raise it for rougher sources, which makes the matcher care more about continuity and less about proximity. |
| `transitionBetaMeters` | 12 m | Tolerance on "distance travelled along the road should match distance travelled by the GPX". Lower = stricter continuity. |
| `wayChangePenalty` | 1.5 | Cost of hopping to another way mid-step. Stops the matcher flapping between two ways that overlap at a junction. |
| `disconnectedPenalty` | 6 | Extra cost when the two ways share no node. This is what keeps the route on the road network instead of teleporting to a parallel road. |
| `headingPenalty` | 4 | Cost of travelling a way against the GPX's direction. Without it, a matcher happily rides a hairpin backwards. |
| `minMatchedFraction` | 0.8 | Reject the match if less than this fraction of samples found any road. The usual reason a real ghat route is rejected: OSM simply has not mapped the upper half. |
| `maxMeanOffsetMeters` | 20 m | Reject if the matched road averages further than this from the GPX. |
| `minLengthRatio` / `maxLengthRatio` | 0.85 / 1.2 | Reject if the matched road is much shorter or longer than the GPX - the signature of a matcher that cut a corner or went round the houses. |

Rejection is not failure: it means "the raw GPX is the better of the two", and
the import carries on with Phase 1 behaviour. `pnpm rally corners <gpx> --osm`
prints the reason.

## U-turn detection

| Value | Default | What it does |
| --- | --- | --- |
| `uTurnMeters` | 60 m | How much sustained travel *against* the route direction is needed before the co-driver accepts you turned round and starts calling the route backwards. Evidence is one-sided: riding forwards pays the debt back to zero but never into credit, so a U-turn two hours into a ride is noticed just as fast as one two minutes in. Lower it and a roll-back at a junction flips the route; raise it and you ride the first corner of the way home unannounced. |
| `announceUTurn` | true | Say "riding back" when it flips. |

Riding backwards mirrors each corner: left becomes right, `tightens` becomes
`opens`, and `into` is re-derived for the new order (corner *n* chains with
corner *n−1*). The grade, radius and heading change are properties of the road
and do not change.
