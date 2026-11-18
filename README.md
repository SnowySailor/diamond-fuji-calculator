# Diamond Fuji calculator

Click where you'll stand on a Google map, set your elevation, and pick a year. The app lists every day the
sun (Diamond Fuji, ダイヤモンド富士) or the full moon (Pearl Fuji, パール富士) sits on Mt. Fuji's summit.
It also draws the disk's exact position against Fuji's skyline, minute by minute.

Everything runs in Docker; nothing is installed on the host.

![The app: map, inputs, the selected day's view of the sun on the summit, and the list of dates](docs/screenshots/overview.png)

| | |
|---|---|
| ![Zoomed in 45 seconds after the best moment: the last sliver of sun on the summit](docs/screenshots/diamond-moment.png) | ![Pearl Fuji: a 99%-lit moon setting onto the summit at dawn](docs/screenshots/pearl-fuji.png) |
| **The "diamond":** zoomed in on Tokyo Station's best day (6 Feb 2026), 45 s after closest approach. The dotted track has minute ticks. | **Pearl Fuji:** the full moon setting onto the summit at dawn on 3 Apr 2026, seen from Den-en-chōfu. The moon's phase is drawn to scale. |

![From Panorama-dai at Lake Yamanaka, 17 km away, the crater's near rim hides Kengamine](docs/screenshots/yamanaka-close-range.png)

**Close range:** from Panorama-dai at Lake Yamanaka, 17 km away, the crater's near rim stands higher in the sky than Kengamine itself. The crosshair marks the middle of the summit, on the rim; the triangle marks Kengamine, hidden behind it.

The screenshots draw Fuji's ridge from Google terrain data (Elevation API enabled). Without the Elevation API, the app draws a modelled cone instead.

## Run

```sh
cp .env.example .env.local        # then fill in VITE_GOOGLE_MAPS_API_KEY
docker compose up --build app     # http://127.0.0.1:4778
```

The key needs **Maps JavaScript API** enabled, with `http://127.0.0.1:4778/*` as an allowed referrer.
Enabling the **Elevation API** on the same key turns on two features:

- ground elevation fills in automatically when you click the map
- Fuji's real ridge line, built from 13 terrain cross-sections, replaces the modelled cone

Without it, you type the elevation and the app draws the modelled profile.

If you change dependencies, run `docker compose up --build -V app`. The `-V` gives the container a fresh
`node_modules` volume.

```sh
docker compose run --rm app npm test          # vitest
docker compose run --rm app npm run typecheck
docker compose --env-file .env.local --profile prod up --build prod   # nginx build on :4778
```

## Deploy (Cloudflare Workers)

The site is static: Workers static assets serve `dist/` (`wrangler.jsonc`), with no Worker code.
Deploying is the one thing that runs on the host, not in Docker, so wrangler can use your normal
browser login.

1. Create a second Maps key for production. Restrict it to your Worker's URL as the only referrer
   (`https://<worker>.<subdomain>.workers.dev/*`) and to the Maps JavaScript API and Elevation API.
   Put it in `.env.production.local` (git-ignored) as `VITE_GOOGLE_MAPS_API_KEY=…`. The deploy
   refuses to run without it, so the dev key never ships.
2. Deploy from the host:

   ```sh
   npm install            # once; host node_modules, separate from the container's
   npx wrangler login     # once
   npm run deploy         # build + wrangler deploy
   ```

A key in a web page is always readable. The referrer restriction stops other sites from using it, but
a script can fake the Referer header, so set daily quotas on both APIs to cap what misuse could cost.

## How it works (`src/lib`)

- **What counts as "on the summit".** Diamond Fuji is the sun sitting in the *middle* of the summit (MLIT
  Kanto: 頂上の真ん中). The target is the direction of the crater centre (大内院, 35.36354° N 138.73062° E),
  at the height of the visible ridge in that direction. The ridge comes from Google terrain when available
  and from a modelled crater otherwise. Kengamine (剣ヶ峰, 3776.24 m, GSI) is the high point on the
  south-west rim, about 410 m from the centre, and is marked separately. From close or side-on viewpoints,
  aiming at Kengamine instead would put the best day a day early or late.
- **Where the summit appears.** Its direction and altitude come from WGS84 ECEF→ENU geometry, which
  includes Earth's curvature. Terrestrial refraction is added with k = 0.13.
- **Sun and moon positions.** These are topocentric positions from
  [astronomy-engine](https://github.com/cosinekitty/astronomy). Astronomical refraction uses the
  Saemundsson formula, scaled for the lower air pressure at your elevation.
- **Finding each crossing.** For each day, `SearchAltitude` brackets when the body passes the
  summit's altitude, rising if Fuji is east of you and setting if it's west. A root-finder then
  pins down the refracted crossing.
- **How close it passes.** From that crossing, the app works out the disk centre's closest approach
  to the summit.
- **Ratings.**
  - *Dead centre*: within 3′ of the summit.
  - *On summit*: the summit point is inside the disk.
  - *Near miss*: within 1°.
- **Checked against published data** (in `src/lib/lib.test.ts`):
  - NAOJ sunset times and azimuths for Tokyo: within 1 minute.
  - Enoshima Ōhashi, around Apr 5 and Sep 7: both match exactly.
  - Yokohama Ōsanbashi, Mar 9–10 (MLIT Kanto): matches.
  - The Lake Yamanaka sequence through February, from Nagaike to Asahigaoka to Panorama-dai. Panorama-dai
    lands on Feb 23, the published date, with terrain data.
  - Den-en-chōfu (MLIT Kanto, Feb 17–18) comes out on Feb 15 at the station. MLIT's coordinates for that
    neighbourhood were placed by eye.

Not modelled: whether hills, buildings or trees between you and Fuji block the view, weather, or the day-to-day variation in refraction near the horizon.
Expect timing to be off by up to a minute either way.

From close range (Lake Yamanaka, for example), the crater's near rim stands higher in the sky than
Kengamine, which is behind it. The target sits on that near rim, because that is where the sun actually
touches the mountain.
