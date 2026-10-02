// Generates the sample data sets used by ?sample=… on the results page.
// Fictional drivers and times. Re-run after changing: node scripts/make-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'site/assets/samples');
const cars = JSON.parse(fs.readFileSync(path.join(root, 'data/cars.json'), 'utf8')).cars;
const car = (id) => {
  const c = cars.find((x) => x.id === id);
  if (!c) throw new Error(`no car ${id}`);
  return { car_id: c.id, car_name: c.name };
};
const SHOT = 'assets/samples/sample-screenshot.webp';

// Small deterministic PRNG so the samples don't change between runs.
let seed = 20261002;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];

let idn = 0;
const nextId = () => (++idn).toString(36).padStart(6, 'a');
let clock = Date.parse('2026-10-03T14:00:00Z');

function mk(driver, carId, finish, extra = {}) {
  const cp1 = Math.round(finish * (0.338 + rand() * 0.012));
  const cp2 = Math.round(finish * (0.676 + rand() * 0.012));
  clock += Math.round((0.3 + rand() * 7) * 3600 * 1000);
  return {
    id: nextId(), driver, ...car(carId), cp1_ms: cp1, cp2_ms: cp2, finish_ms: finish,
    uploaded_at: new Date(extra.at ? Date.parse(extra.at) : clock).toISOString(),
    screenshot: extra.shot ? SHOT : null,
    ...(extra.cp1 ? { cp1_ms: extra.cp1 } : {}),
    ...(extra.cp2 ? { cp2_ms: extra.cp2 } : {}),
  };
}

const write = (name, runs) => {
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ generated_at: '2026-10-02T22:00:00.000Z', sample: name, runs }, null, 1) + '\n');
  console.log(`${name}: ${runs.length} runs`);
};

// --- empty / one
write('empty', []);
write('one', [mk('Jane Driver', 'subaru-impreza-gc8-555-grpa', 408034, { shot: true, at: '2026-10-14T00:02:11Z' })]);

// --- ties: the four rows from the plan, plus a tie for first in a second set
write('ties', [
  mk('Jane Driver', 'subaru-impreza-gc8-555-grpa', 408034, { cp1: 141402, cp2: 280118, shot: true, at: '2026-10-14T00:02:11Z' }),
  mk('Alex Rally', 'skoda-fabia-rs-rally2', 410500, { cp1: 141390, cp2: 281900, at: '2026-10-15T13:11:40Z' }),
  mk('Sam Gravel', 'hyundai-i20-n-rally2', 410500, { cp1: 142010, cp2: 282330, shot: true, at: '2026-10-17T02:40:05Z' }),
  mk('Pat Slow', 'lancia-stratos-hf-grp4', 472120, { cp1: 160800, cp2: 320040, at: '2026-10-17T17:00:30Z' }),
]);

// --- repeat: one driver improving across several runs and cars
write('repeat', [
  mk('Jane Driver', 'subaru-impreza-gc8-555-grpa', 425200, { at: '2026-10-05T18:00:00Z' }),
  mk('Jane Driver', 'subaru-impreza-gc8-555-grpa', 418900, { at: '2026-10-06T18:00:00Z' }),
  mk('Jane Driver', 'skoda-fabia-rs-rally2', 412400, { shot: true, at: '2026-10-07T18:00:00Z' }),
  mk('Alex Rally', 'skoda-fabia-rs-rally2', 415000, { at: '2026-10-06T20:00:00Z' }),
  mk('Pat Slow', 'subaru-impreza-gc8-555-grpa', 421700, { at: '2026-10-08T01:00:00Z' }),
  mk('Alex Rally', 'toyota-gr-yaris-rally2', 416250, { at: '2026-10-09T01:00:00Z' }),
]);

// --- many: 115 drivers, some with several runs, a few ties and long names
const first = ['Jane', 'Alex', 'Sam', 'Pat', 'Mika', 'Tomás', 'Kacper', 'Ole', 'Lena', 'Marco', 'Aurélien', 'Jakub', 'Erik', 'Nina', 'Gabe', 'Eli', 'Rosa', 'Juho', 'Hana', 'Petr', 'Ivo', 'Lukas', 'Sara', 'Dave', 'Ben'];
const last = ['Driver', 'Rally', 'Gravel', 'Slow', 'Mäkinen', 'Novák', 'Kowalski', 'Hansen', 'Berg', 'Rossi', 'Tricaud', 'Dvořák', 'Lindqvist', 'Sato', 'Keller', 'Moreau', 'Virtanen', 'Horák', 'Silva', 'Brennan'];
const popular = ['skoda-fabia-rs-rally2', 'hyundai-i20-n-rally2', 'toyota-gr-yaris-rally2', 'subaru-impreza-gc8-555-grpa', 'ford-fiesta-rally2', 'peugeot-208-rally4', 'renault-clio-rally3', 'toyota-yaris-wrc-2018', 'hyundai-i20-coupe-wrc-2021', 'mitsubishi-lancer-evo-ix-n4', 'ford-escort-mk-ii-rs-grp4', 'lancia-stratos-hf-grp4', 'bmw-m3-e30-grpa', 'peugeot-306-maxi-kit-car', 'audi-sport-quattro-grpb', 'citroen-c2-gt-s1600'];
const pace = { 'toyota-yaris-wrc-2018': 0.94, 'hyundai-i20-coupe-wrc-2021': 0.94, 'audi-sport-quattro-grpb': 0.97, 'skoda-fabia-rs-rally2': 1, 'hyundai-i20-n-rally2': 1, 'toyota-gr-yaris-rally2': 1, 'ford-fiesta-rally2': 1.005, 'subaru-impreza-gc8-555-grpa': 1.02, 'mitsubishi-lancer-evo-ix-n4': 1.05, 'renault-clio-rally3': 1.07, 'peugeot-306-maxi-kit-car': 1.07, 'peugeot-208-rally4': 1.1, 'bmw-m3-e30-grpa': 1.1, 'citroen-c2-gt-s1600': 1.11, 'ford-escort-mk-ii-rs-grp4': 1.13, 'lancia-stratos-hf-grp4': 1.12 };
const names = new Set();
while (names.size < 113) names.add(`${pick(first)} ${pick(last)}`);
names.add('Maximilian Oberhauser-Lindqvist');
names.add('Aurélien Tricaud-Desjardins_RBR');
const many = [];
for (const name of names) {
  const c = pick(popular);
  const skill = 0.965 + rand() * 0.16;
  const base = Math.round(400000 * pace[c] * skill);
  many.push(mk(name, c, base, { shot: rand() < 0.3 }));
  if (rand() < 0.25) many.push(mk(name, c, base + Math.round(1500 + rand() * 9000)));
  if (rand() < 0.1) {
    const c2 = pick(popular);
    many.push(mk(name, c2, Math.round(400000 * pace[c2] * skill * (0.995 + rand() * 0.02))));
  }
}
// a tie in the middle of the board
const count = (d) => many.filter((r) => r.driver === d).length;
const solo = many.filter((r) => count(r.driver) === 1).slice(10, 12);
for (const r of solo) {
  r.finish_ms = 418888;
  r.cp1_ms = Math.round(418888 * 0.344);
  r.cp2_ms = Math.round(418888 * 0.682);
}
write('many', many);
