// Build the site into _site/ for GitHub Pages.
//
// 1. Reads data/stage.json and data/cars.json (a broken one fails the build,
//    so Pages keeps serving the last good deploy).
// 2. Reads every data/submissions/**/*.json, checks it, drops hidden runs and
//    skips (with a warning) any file that is malformed or a duplicate id.
// 3. Draws the vehicle tune library and a page for each tune (a tune stays listed when its run is hidden;
//    only a tune's own "status": "hidden" removes it).
// 4. Writes _site/results.json and copies the site, shared rules, data and
//    screenshots alongside it.
//
// Run: node scripts/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStoredRun } from '../shared/rules.js';
import { parseTune } from '../shared/tune.js';
import { renderLibrary, renderTunePage } from './tunes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const inGitHub = !!process.env.GITHUB_ACTIONS;

function warn(file, msg) {
  const rel = path.relative(root, file);
  if (inGitHub) console.log(`::warning file=${rel}::${msg}`);
  else console.warn(`warning: ${rel}: ${msg}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listJson(p));
    else if (entry.name.endsWith('.json')) found.push(p);
  }
  return found.sort();
}

// --- config (must be valid)
const stage = readJson(path.join(root, 'data/stage.json'));
const cars = readJson(path.join(root, 'data/cars.json'));
const groupNames = new Set(cars.groups.map((g) => g.name));
const carIds = new Set();
for (const c of cars.cars) {
  if (!c.id || !c.name || !groupNames.has(c.group)) throw new Error(`cars.json: bad car entry ${JSON.stringify(c)}`);
  if (carIds.has(c.id)) throw new Error(`cars.json: duplicate id ${c.id}`);
  carIds.add(c.id);
}

// --- submissions
const runs = [];
const tunes = [];
const seen = new Set();
let hidden = 0;
let skipped = 0;
for (const file of listJson(path.join(root, 'data/submissions'))) {
  let run;
  try {
    run = readJson(file);
  } catch (e) {
    warn(file, `not valid JSON (${e.message}); skipped`);
    skipped++;
    continue;
  }
  const problem = checkStoredRun(run, carIds, stage);
  if (problem) {
    warn(file, `${problem}; skipped`);
    skipped++;
    continue;
  }
  if (seen.has(run.id)) {
    warn(file, `duplicate id ${run.id}; skipped`);
    skipped++;
    continue;
  }
  seen.add(run.id);
  if (run.tune && run.tune.status !== 'hidden') {
    const tuneFile = path.join(root, run.tune.file);
    if (!fs.existsSync(tuneFile)) {
      warn(file, `tune file ${run.tune.file} is missing; tune skipped`);
    } else {
      const text = fs.readFileSync(tuneFile, 'utf8');
      const parsed = parseTune(text);
      if (!parsed.ok) {
        warn(file, `tune ${run.tune.file} can't be read (${parsed.errors[0]}); tune skipped`);
      } else {
        const car = cars.cars.find((c) => c.id === run.car_id);
        const group = cars.groups.find((g) => g.name === car?.group);
        tunes.push({
          meta: {
            id: run.id,
            driver: run.driver.replace(/\s+/g, ' ').trim(),
            car_name: run.car_name,
            group: group?.name || '',
            group_tag: group?.tag || '',
            tune_name: run.tune.name,
            file_name: `${run.tune.name}.lsp`,
            uploaded_at: run.uploaded_at,
            finish_ms: run.finish_ms,
            run_published: run.status !== 'hidden',
          },
          tune: parsed.tune,
          text,
        });
      }
    }
  }
  if (run.status === 'hidden') {
    hidden++;
    continue;
  }
  runs.push({
    id: run.id,
    driver: run.driver.replace(/\s+/g, ' ').trim(),
    car_id: run.car_id,
    car_name: run.car_name,
    cp1_ms: run.cp1_ms,
    cp2_ms: run.cp2_ms,
    finish_ms: run.finish_ms,
    uploaded_at: run.uploaded_at,
    screenshot: run.screenshot || null,
    ...(run.label ? { label: run.label } : {}),
    ...(run.note ? { note: run.note } : {}),
  });
}
runs.sort((a, b) => a.finish_ms - b.finish_ms || Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at));

// --- assemble _site
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'shared'), { recursive: true });
fs.copyFileSync(path.join(root, 'shared/rules.js'), path.join(out, 'shared/rules.js'));
fs.copyFileSync(path.join(root, 'shared/tune.js'), path.join(out, 'shared/tune.js'));
fs.mkdirSync(path.join(out, 'data'), { recursive: true });
fs.copyFileSync(path.join(root, 'data/stage.json'), path.join(out, 'data/stage.json'));
fs.copyFileSync(path.join(root, 'data/cars.json'), path.join(out, 'data/cars.json'));
if (fs.existsSync(path.join(root, 'screenshots'))) {
  fs.cpSync(path.join(root, 'screenshots'), path.join(out, 'screenshots'), {
    recursive: true,
    filter: (src) => !src.endsWith('.gitkeep'),
  });
}
// vehicle tunes: /tunes/ (library), /tunes/<id>/ (page) and the untouched .lsp beside each page
fs.mkdirSync(path.join(out, 'tunes'), { recursive: true });
fs.writeFileSync(path.join(out, 'tunes/index.html'), renderLibrary(tunes.map((t) => t.meta), cars.groups));
for (const t of tunes) {
  const dir = path.join(out, 'tunes', t.meta.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), renderTunePage(t.meta, t.tune, t.text));
  fs.writeFileSync(path.join(dir, t.meta.file_name), t.text);
}
fs.writeFileSync(
  path.join(out, 'results.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), runs }) + '\n',
);
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`Built _site: ${runs.length} published, ${hidden} hidden, ${skipped} skipped, ${tunes.length} tunes.`);
