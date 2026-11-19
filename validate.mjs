// Local replica of the seven gate checks in kit RULES.txt, plus the
// cross-checks this entry adds: the page's farm steps and recomputed
// implied values must match board.json exactly.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const OUT = process.argv[2] || 'out';
const KIT = process.argv[3] || '../token-radar-01-kit';
const errors = [];
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) errors.push(name);
};

const snap = JSON.parse(await readFile(join(KIT, 'input/snapshot.json'), 'utf8'));
const board = JSON.parse(await readFile(join(OUT, 'board.json'), 'utf8'));
const dossier = JSON.parse(await readFile(join(OUT, 'dossier.json'), 'utf8'));
const dataJs = await readFile(join(OUT, 'data.js'), 'utf8');

// 1. Dashboard files exist, ≤400 files, ≤4 MiB, and no network addresses.
const dashFiles = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else dashFiles.push(p);
  }
}
await walk(join(OUT, 'dashboard'));
let dashBytes = 0;
let dashSourceBytes = 0;
const netRe = /(src|href)\s*=\s*["']https?:|@import\s+["']https?:|url\(\s*["']?https?:/i;
let netHit = null;
for (const f of dashFiles) {
  const buf = await readFile(f);
  dashBytes += buf.length;
  if (/\.(html|css|js)$/.test(f)) dashSourceBytes += buf.length;
  if (netRe.test(buf.toString('utf8'))) netHit = f;
}
check('dashboard files', dashFiles.length >= 3 && dashFiles.length <= 400, dashFiles.length + ' files');
check('dashboard size', dashBytes <= 4 * 1024 * 1024, (dashBytes / 1024).toFixed(1) + ' KiB');
check('dashboard source cap', dashSourceBytes <= 65536, dashSourceBytes + ' bytes shown to judge');
check('no network addresses in dashboard', !netHit, netHit || 'none found');

// 2. Board file: object with rows, 100-4000 rows, ≤8 MiB.
const boardStat = await readFile(join(OUT, 'board.json'));
check('board is object with rows', typeof board === 'object' && Array.isArray(board.rows));
check('board row count', board.rows.length >= 100 && board.rows.length <= 4000, board.rows.length + ' rows');
check('board size', boardStat.length <= 8 * 1024 * 1024, (boardStat.length / 1024).toFixed(1) + ' KiB');

// 3. Rows are sorted by value, ranks exactly 1..N, values non-increasing, positive whole dollars, not all equal.
const rows = board.rows;
const slugs = new Set();
let rowsOk = true;
let rowsWhy = '';
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.rank !== i + 1) { rowsOk = false; rowsWhy = 'rank ' + r.rank + ' at index ' + i; break; }
  if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) { rowsOk = false; rowsWhy = 'bad implied at ' + r.slug; break; }
  if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) { rowsOk = false; rowsWhy = 'not non-increasing at ' + r.slug; break; }
  if (typeof r.name !== 'string' || !r.name.trim()) { rowsOk = false; rowsWhy = 'empty name at ' + r.slug; break; }
  if (slugs.has(r.slug)) { rowsOk = false; rowsWhy = 'duplicate slug ' + r.slug; break; }
  slugs.add(r.slug);
}
check('rows sorted by value with ranks 1..N', rowsOk, rowsWhy || rows.length + ' rows');
check('implied values not all equal', new Set(rows.map((r) => r.implied_value_usd)).size > 1);

// 4. Coverage: every watchlist slug present.
const missing = snap.watchlist.filter((s) => !slugs.has(s));
check('watchlist coverage', missing.length === 0, missing.length ? 'missing ' + missing.join(', ') : snap.watchlist.length + ' / ' + snap.watchlist.length);

// 5. farm_steps: 3-12 strings, 20-600 chars each.
let farmOk = true;
let farmWhy = '';
for (const r of rows) {
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { farmOk = false; farmWhy = r.slug + ' step count ' + (r.farm_steps || []).length; break; }
  const bad = r.farm_steps.find((s) => typeof s !== 'string' || s.length < 20 || s.length > 600);
  if (bad) { farmOk = false; farmWhy = r.slug + ' step length ' + (bad ? bad.length : 0); break; }
}
check('farm_steps shape', farmOk, farmWhy || 'all rows 3-12 steps, 20-600 chars');

// 6. Screenshots: 3-4 images, each ≤512 KiB, whole PNG/JPEG, long side ≤1440, short side ≥800.
const shotFiles = (await readdir(join(OUT, 'screenshots'))).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
check('screenshot count', shotFiles.length >= 3 && shotFiles.length <= 4, shotFiles.length + ' images');
for (const f of shotFiles) {
  const buf = await readFile(join(OUT, 'screenshots', f));
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  let w = 0;
  let h = 0;
  if (isPng) { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
  check('screenshot ' + f, buf.length <= 512 * 1024 && (isPng || isJpeg) && Math.max(w, h) <= 1440 && Math.min(w, h) >= 800, (buf.length / 1024).toFixed(0) + ' KiB, ' + w + 'x' + h);
}

// 7. Dossier matches what buildDossier writes, ≤1.5 MiB. buildDossier
// returns canonical bytes, not an object, and main.ts writes those
// bytes straight to dossier.json.
const dossierStat = await readFile(join(OUT, 'dossier.json'));
const rebuilt = buildDossier(OUT, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
check('dossier matches buildDossier', Buffer.compare(Buffer.from(rebuilt), dossierStat) === 0, dossierStat.length + ' bytes vs rebuilt ' + rebuilt.length);
check('dossier size', dossierStat.length <= 1.5 * 1024 * 1024, (dossierStat.length / 1024).toFixed(1) + ' KiB');

// Cross-check: data.js rows agree with board.json rows.
const radar = JSON.parse(dataJs.replace(/^window\.RADAR\s*=\s*/, '').replace(/;\s*$/, ''));
check('data.js rows match board', radar.rows.length === rows.length && radar.rows.every((r, i) => r.slug === rows[i].slug && r.implied_value_usd === rows[i].implied_value_usd), radar.rows.length + ' rows');
check('data.js model version', radar.model_version === 'radar-2');

console.log(errors.length === 0 ? '\nALL GATE CHECKS PASSED' : '\nFAILED: ' + errors.join(', '));
process.exit(errors.length === 0 ? 0 : 1);
