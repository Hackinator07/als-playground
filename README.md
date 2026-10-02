# Al's Playground stage times

Results board for **Al's Playground** (LSPR 2024 SS1, 12.5 km, gravel), a Richard Burns Rally stage.

**Live page:** https://hackinator07.github.io/als-playground/

Preview the page with fictional data:
[empty](https://hackinator07.github.io/als-playground/?sample=empty) ·
[one time](https://hackinator07.github.io/als-playground/?sample=one) ·
[ties](https://hackinator07.github.io/als-playground/?sample=ties) ·
[repeat drivers](https://hackinator07.github.io/als-playground/?sample=repeat) ·
[many](https://hackinator07.github.io/als-playground/?sample=many) ·
[load failure](https://hackinator07.github.io/als-playground/?sample=broken)

## How it works

- Every run is one JSON file in `data/submissions/`. That file is the record.
- On every push, GitHub Actions runs the tests, builds `results.json` from those files and publishes the site to GitHub Pages. A new time appears about a minute later.
- The page ranks the times in the browser, so positions and diffs are always worked out fresh. Nothing calculated is stored.
- Submissions from the public form (coming in a later stage) go through a small Cloudflare Worker that only ever **adds** new files. It can't change or delete an existing time.

## Admin tasks (all in the GitHub web editor)

| Task | How |
|---|---|
| Hide a bad result | Open its file in `data/submissions/`, change `"status": "published"` to `"status": "hidden"`, commit. The file and its history stay. |
| Bring a hidden result back | Change `"status"` back to `"published"`. |
| Fix a typo in a driver's name | Edit `driver` in its file. |
| Add a time by hand | Create a new file in `data/submissions/2026/` using the example below. |
| Add a car | Add one line to `data/cars.json` with a new `id`. |
| Rename a car | Edit its `name`. Never change an `id` once a time uses it. |
| Retire a car | Set `"active": false`. It leaves the dropdown; old times still show. |
| Change stage details | Edit `data/stage.json` (name, length, the fastest and slowest believable finish). |
| Undo vandalism | Revert the bad commits. Git history has everything. |

If a file you edit has a mistake, the build skips that one file and shows a warning on the Actions run; the rest of the board still publishes. If `stage.json` or `cars.json` is broken, the build stops and the last good version of the site stays live.

### Submission file format

`data/submissions/2026/2026-10-02T210533Z_k7f3q9.json`

```json
{
  "schema": 1,
  "id": "k7f3q9",
  "stage": "als-playground",
  "driver": "Jane Driver",
  "car_id": "subaru-impreza-gc8-555-grpa",
  "car_name": "Subaru Impreza GC8 555 GrpA",
  "cp1_ms": 141402,
  "cp2_ms": 280118,
  "finish_ms": 408034,
  "entered": { "cp1": "2:21.402", "cp2": "4:40.118", "finish": "6:48.034" },
  "uploaded_at": "2026-10-02T21:05:33.412Z",
  "screenshot": null,
  "status": "published"
}
```

- Times are whole milliseconds: 6:48.034 is `408034`. Checkpoint times are elapsed time from the start, as the game shows them.
- `id` is 4–16 lowercase letters and digits, unique.
- `uploaded_at` is UTC. The page shows it in US Central time.
- `screenshot` is `null` or a path such as `screenshots/2026/k7f3q9.webp`.

## Rules the page follows

- Ordered by finish time; equal times share a position (1, 2, 2, 4), and whoever posted first is listed first.
- **Best per driver** (default) shows each driver once, at their fastest run. **All runs** shows every run. Names are matched ignoring case and extra spaces.
- The class filter ranks within the class, using each driver's best run in that class.
- Diff. Prev and Diff. First use the finish time only. The leader shows 00.000.
- Purple marks the fastest Checkpoint 1 and Checkpoint 2 among the rows shown.
- Car groups in `data/cars.json` are the RSF plugin's categories (102 RSF cars plus the 8 original RBR cars under "Original"). Correct any car by editing its `group`.

## Working on it locally

Needs Node 20 or newer, no installs.

```sh
node --test tests/*.test.mjs   # unit tests
node scripts/build.mjs         # builds _site/
node scripts/serve.mjs         # http://localhost:8080/  (add ?sample=many etc.)
node scripts/make-samples.mjs  # regenerates the fictional sample data
```

## Layout

```
site/                 the pages (results at /, submit at /submit/)
  assets/css/style.css  colours are variables at the top
  assets/js/results.js  loads, ranks and draws the table
  assets/samples/       fictional data for ?sample=
shared/rules.js       time parsing, formatting, ranking, Central time (used everywhere)
data/stage.json       stage details and plausibility bounds
data/cars.json        the car list and groups
data/submissions/     one JSON file per run
screenshots/          optional screenshots
scripts/              build, local server, sample generator
tests/                node:test unit tests
```
