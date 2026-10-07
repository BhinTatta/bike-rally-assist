# bike-rally-assist

A motorcycle **rally co-driver**. It watches your position on a route you have
loaded and speaks the next corner into your Bluetooth headset —
*"Sharp right, 80 metres"*, *"Hairpin left, 100 metres"* — so you never look at
the phone on a twisty ghat road.

It is **not** navigation. It never tells you where to go, only what the road is
about to do.

> **Assistive only.** The engine works from map data, which is sometimes wrong,
> and from GPS, which is sometimes late. Ride to what you can see.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **1** | Engine (GPX → corners, runtime co-driver) + CLI + tests | **done** |
| **2** | OSM road snapping at import time | **done** |
| **3** | React Native / Expo app (Android first) | **done** |
| 4 | Polish: U-turns, mid-route starts, full README | partly done |

## Layout

```
packages/engine   pure TypeScript: GPX parsing, corner detection, the co-driver.
                  Zero Node/browser/React Native APIs - runs anywhere.
packages/osm      optional layer: fetch OSM roads, map-match the GPX onto them.
                  Platform-agnostic (fetch and storage are injected).
packages/cli      Node developer tools built on both.
apps/mobile       the Expo app (dev build, Android first, iOS-compatible code).
fixtures          the synthetic Western Ghats climb, in three forms.
```

### The fixtures

One road, three representations, so every layer can be tested honestly:

| File | What it is |
| --- | --- |
| `sample-ghat.gpx` | a clean planner export: correct geometry, but sparse (hairpins are 3 points) |
| `sample-ghat-planner.gpx` | the same road traced by hand: sparse **and** 0-8 m off the centreline |
| `sample-ghat-osm.json` | what OSM has: surveyed every 4 m, split into 5 joined ways |

Regenerate them with `pnpm rally gen-sample`.

## Setup

```bash
pnpm install
pnpm build          # builds engine, then osm, then cli
pnpm test           # 58 engine tests + 31 OSM tests
pnpm typecheck
```

Node 22+ and pnpm 10+.

## Verifying Phase 1

Everything below runs against the bundled sample route, a 2.95 km synthetic
ghat climb with two hairpins (deliberately given only 3 GPX points each, like
real planner exports), an S-bend, two "into" pairs and a long sweeper.

### 1. Corner detection

```bash
pnpm rally corners fixtures/sample-ghat.gpx
```

```
#   km    length  dir    grade    no.  min R  turn  modifiers
--  ----  ------  -----  -------  ---  -----  ----  ---------
0   0.39  85 m    right  medium   4    58 m   68°
1   0.61  85 m    left   sharp    3    42 m   80°   into
2   0.71  81 m    right  hairpin  1    13 m   172°
3   0.86  82 m    left   hairpin  1    15 m   166°
4   0.99  85 m    right  gentle   5    93 m   43°   into
5   1.09  59 m    left   sharp    3    32 m   69°
6   1.35  150 m   right  slight   6    241 m  34°   long
...
```

Also writes `corners.json` (`--out` to change the path).

### 2. Simulated ride

```bash
pnpm rally simulate fixtures/sample-ghat.gpx --speed 45 --lateral-g 0.4
```

```
0:26.0    325 m  45 km/h  "Medium right, 50 metres" (55 m / 4.4 s ahead)
0:43.0    538 m  45 km/h  "Sharp left, 60 metres, into hairpin right" (62 m / 5.0 s ahead)
1:07.0    786 m  44 km/h  "Hairpin left, 60 metres" (60 m / 5.0 s ahead)
```

Things worth checking:

* every call lands about 5 s before the corner, at any speed (`--speed 25`
  through `--speed 80`);
* each corner is called exactly once — the summary line counts them;
* the S-bend is a single chained call (`"... into sharp left"`);
* GPS noise does not break it: `--noise 6` still calls 11 of 11 corners;
* rally pacenotes: `--rally` gives `"Left 3, 60, into right 1"`.

Replay a recorded ride instead of simulating one (this is the Phase 3 tuning
loop — the app will export rides in exactly this format):

```bash
pnpm rally simulate fixtures/sample-ghat.gpx --replay my-ride.gpx
```

### 3. Debug map

```bash
pnpm rally debug-map fixtures/sample-ghat.gpx
open debug-map.html     # xdg-open on Linux
```

A standalone Leaflet page: route in grey, corners coloured by grade
(magenta hairpin → blue slight), a dot at each apex, and a popup per corner with
its radius, heading change, length and modifiers. It pulls Leaflet and OSM tiles
from their public CDNs, so the first open needs internet.

## Verifying Phase 2

A planner's hand-traced line wobbles, and the engine can only describe the line
it is given - so it reads a wobble as a corner. Snapping to OSM first fixes
that at the source.

```bash
# the hand-traced line, as-is
pnpm rally corners fixtures/sample-ghat-planner.gpx
#   corners 17 (5.7 per km)   <- six of them are the tracing error

# the same file, snapped onto the surveyed OSM road
pnpm rally corners fixtures/sample-ghat-planner.gpx --osm-file fixtures/sample-ghat-osm.json
#   Snapped to 5 OSM way(s), mean offset 2.0 m via Tamhini Ghat Road
#   corners 11 (3.7 per km)   <- identical to the clean route, hairpins and all
```

`--osm-file` replays a saved Overpass response. For the real thing, which
fetches from Overpass and caches to `./.rally-cache`:

```bash
pnpm rally osm-fetch fixtures/sample-ghat.gpx --out roads.json  # warm the cache
pnpm rally corners   fixtures/sample-ghat-planner.gpx --osm        # fetch or use cache
pnpm rally corners   fixtures/sample-ghat-planner.gpx --osm --offline  # cache only
pnpm rally osm-fetch fixtures/sample-ghat.gpx --print-query      # see the Overpass QL
```

`--osm` works on `corners`, `simulate` and `debug-map`.

### How it works

1. **Corridor.** The route is split into 5 km chunks and each gets a bounding
   box padded by 150 m - so a 100 km ride does not ask Overpass for every road
   in the district.
2. **Fetch.** One union query for all the boxes, `out geom` so node coordinates
   come inline. Endpoints are tried in order with a backoff; 429 and 504 from a
   free, shared service are normal.
3. **Match.** A Hidden Markov matcher in the style of Newson & Krumm: states are
   candidate projections of each 15 m sample onto nearby roads, emission cost is
   how far the sample sits from that road, transition cost is how badly
   "distance travelled along the road" disagrees with "distance travelled by the
   GPX", plus penalties for hopping between ways that do not touch and for
   riding a way against the GPX's direction. Viterbi picks the cheapest path.
4. **Stitch.** The output is the *OSM geometry itself*, sliced between matched
   positions - every surveyed node of the hairpin, not the sparse input snapped
   sideways.
5. **Judge.** Mean offset, matched fraction and length ratio decide whether to
   accept. A bad match falls back to the raw GPX and says why; nothing is ever
   worse than Phase 1.
6. **Cache.** The fetched network is cached by corridor, so a route imported at
   home works on a ghat with no signal. The store is injected - a directory for
   the CLI, AsyncStorage for the app.

The engine never learns about any of this: `@rally/osm` hands it points.

### 4. Tests

```bash
pnpm test
```

Engine - straight lines, arcs of 20/50/100/200 m (radius recovered within 20%),
a 180° hairpin, an S-bend producing "into", a sparse 3-point hairpin, noisy GPS
(5 seeds, no duplicate and no missed calls), snapping across a hairpin without
jumping legs, off-route, GPS loss, starting mid-route, and the phrasing of every
call type.

OSM - recovering a surveyed road from a rough traced line (mean error under
1 m), ignoring a parallel decoy road, a hairpin whose legs are both on one way,
corridor chunking, Overpass query building and parsing, retry and endpoint
failover, caching (fetch once, then offline), corrupt cache entries, and four
ways a match can be rejected in favour of the raw GPX.

## How a corner is found

1. **Parse** the GPX (`<trkpt>`, `<rtept>` or `<wpt>`), keeping elevation and time.
2. **Dedupe** points closer than 1 m.
3. **Resample** at a fixed 5 m spacing along the geodesic path, so every later
   stage works in known units of road rather than "points".
4. **Smooth** with Savitzky-Golay (quadratic, 13-sample / 60 m window). This is
   what makes sparse Indian ghat data usable: a hairpin drawn with three points
   becomes a plausible arc, while ±5 m GPS jitter stops inventing corners.
5. **Curvature** per point: the circumradius of the point 10 m behind, the point
   itself and the point 10 m ahead. The sign of the cross product gives
   left (+) or right (−).
6. **Segment**: consecutive points tighter than 300 m radius and turning the
   same way form a corner; gaps under 20 m are merged; runs that bend less than
   12° are dropped (a short run survives if it bends more than 45°, which is
   what a sparse hairpin looks like).
7. **Grade** by minimum radius, with a hairpin override for >135° of turn inside
   25 m radius. Each grade also carries a rally number, 1 (tightest) to 6.
8. **Modifiers**: `tightens` / `opens` (second half vs first half),
   `long` (the *sustained* tight part exceeds 80 m), `into` (next corner starts
   within 30 m).

Every threshold in that list lives in one object:
[`packages/engine/src/config.ts`](packages/engine/src/config.ts). See
[docs/tuning.md](docs/tuning.md) for what each value does to the calls.

## How a call is made

`CoDriver` takes GPS fixes and returns calls.

* **Snap** the fix to the route, searching only around the last known position
  so two legs of a hairpin 20 m apart never swap. More than 50 m off and it says
  *"off route"* — once — then re-acquires globally.
* **Lag compensation**: project 1.0 s of travel ahead, because the words take
  time to reach your ear.
* **Trigger** when the corner is `leadSeconds` (5 s) away, floored at 30 m and
  capped at 300 m, so the warning is useful at 20 km/h and at 90 km/h.
* **Once each.** A corner already passed is dropped, never announced late.
* **Chain**: corners marked `into` are spoken in one call, up to three.
* **Text and tokens.** Every call carries `text` for TTS *and* `tokens`
  (`["sharp", "right", "80", "metres"]`) so pre-recorded clips can be stitched
  later without changing any logic.

```ts
import { analyseGpx, CoDriver } from "@rally/engine";

const route = analyseGpx(gpxText);
const codriver = new CoDriver(route, { runtime: { rallyMode: true } });

for await (const fix of gpsFixes) {
  for (const call of codriver.update(fix)) speak(call.text);
}
```

## Licence

Private project, all rights reserved for now.
