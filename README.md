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
| 2 | OSM road snapping at import time | not started |
| 3 | React Native / Expo app (Android first) | not started |
| 4 | Polish, permissions, docs | not started |

## Layout

```
packages/engine   pure TypeScript: GPX parsing, corner detection, the co-driver.
                  Zero Node/browser/React Native APIs - runs anywhere.
packages/cli      Node developer tools built on the engine.
fixtures          sample-ghat.gpx, a synthetic Western Ghats climb.
```

## Setup

```bash
pnpm install
pnpm build          # builds engine, then cli
pnpm test           # 58 engine tests
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

### 4. Tests

```bash
pnpm test
```

Covers: straight lines, arcs of 20/50/100/200 m (radius recovered within 20%),
a 180° hairpin, an S-bend producing "into", a sparse 3-point hairpin, noisy GPS
(5 seeds, no duplicate and no missed calls), snapping across a hairpin without
jumping legs, off-route, GPS loss, starting mid-route, and the phrasing of every
call type.

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
