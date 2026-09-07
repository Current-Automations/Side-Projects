/**
 * benchmark/run.mjs
 *
 * Scores a card identifier against the fixture set in benchmark/labels.json.
 * See benchmark/README.md for the fixture format and the rebuild plan (Phase 0.4)
 * for why this is the permanent regression benchmark.
 *
 * Default identifier: GPT-4o vision, called directly with a Pokemon-specific
 * prompt (this is the baseline the retrieval identifier has to beat). The
 * identifier is a single pluggable function — swap `identifyOpenAI` for a
 * retrieval-backed one later and the scoring is unchanged.
 *
 *   node benchmark/run.mjs [--model gpt-4o] [--limit N]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const FRAMES_DIR = join(HERE, 'frames');
const LABELS_FILE = join(HERE, 'labels.json');
const RESULTS_DIR = join(HERE, 'results');

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MODEL = getArg('model', 'gpt-4o');
const LIMIT = Number(getArg('limit', '0')) || 0;

// ---- minimal .env.local loader (no dep) -----------------------------------
function loadEnvLocal() {
  const p = join(REPO, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnvLocal();

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set (checked env and .env.local).');
  process.exit(1);
}

// ---- normalisation + scoring ---------------------------------------------
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// normFinish collapses free-text finish labels to: normal | holo | reverse | first_edition | unlimited | promo
function normFinish(s) {
  const n = norm(s);
  if (!n) return '';
  if (n.includes('reverse')) return 'reverse';
  if (n.includes('first') || n.includes('1st')) return 'first_edition';
  if (n.includes('unlimited')) return 'unlimited';
  if (n.includes('promo')) return 'promo';
  if (n.includes('holo') || n.includes('foil')) return 'holo';
  if (n.includes('normal') || n.includes('non') || n.includes('base')) return 'normal';
  return n;
}

const nameMatch = (truth, guess) => {
  const t = norm(truth);
  const g = norm(guess);
  if (!t || !g) return false;
  return t === g || g.includes(t) || t.includes(g);
};

const setMatch = (label, guess) => {
  const g = norm(guess);
  return nameMatch(label.set_name, guess) || (label.set_id && g.includes(norm(label.set_id)));
};

const numberMatch = (truth, guess) =>
  norm(truth).replace(/^0+/, '') === norm(guess).replace(/^0+/, '') && norm(truth) !== '';

// ---- the identifier under test -----------------------------------------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT = `You are identifying a Pokemon Trading Card Game card from a video frame that may be blurry, angled, partially occluded, or moving.

Return ONLY a JSON object with these fields:
- set_name: string (the English expansion name, e.g. "Obsidian Flames")
- card_name: string (the card title, e.g. "Charizard ex")
- card_number: string (the printed collector number, e.g. "223" or "223/197")
- finish: one of "normal", "holo", "reverse", "first_edition", "unlimited", "promo" (the physical finish, not the rarity — "reverse" means the card body is foiled, "holo" means the artwork is foiled)
- confidence: number 0..1

If you cannot tell, still give your best single guess and lower the confidence. No markdown, no backticks.`;

async function identifyOpenAI(imgDataUri) {
  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You return only valid JSON.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: imgDataUri, detail: 'high' } },
        ],
      },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? '{}';
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, raw: text };
  }
}

// ---- run ---------------------------------------------------------------
function loadLabels() {
  if (!existsSync(LABELS_FILE)) {
    console.error(
      `No ${LABELS_FILE}.\nCopy benchmark/labels.example.json to benchmark/labels.json, ` +
        `drop frames in benchmark/frames/, and fill in ground truth. See benchmark/README.md.`
    );
    process.exit(1);
  }
  const labels = JSON.parse(readFileSync(LABELS_FILE, 'utf8'));
  return LIMIT ? labels.slice(0, LIMIT) : labels;
}

function toDataUri(file) {
  const p = join(FRAMES_DIR, file);
  if (!existsSync(p)) throw new Error(`frame not found: ${p}`);
  const ext = extname(file).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`;
}

function blankTally() {
  return { n: 0, card: 0, set: 0, number: 0, finish: 0 };
}
function pct(hit, n) {
  return n ? `${Math.round((100 * hit) / n)}%` : '  -';
}

async function main() {
  const labels = loadLabels();
  console.log(`benchmark: ${labels.length} frames · model=${MODEL}\n`);

  const byDist = {};
  const overall = blankTally();
  const perFrame = [];

  for (const label of labels) {
    process.stdout.write(`  ${label.file} ... `);
    let guess = null;
    let error = null;
    try {
      const res = await identifyOpenAI(toDataUri(label.file));
      if (res.ok) guess = res.data;
      else error = `unparseable: ${res.raw?.slice(0, 120)}`;
    } catch (err) {
      error = err.message;
    }

    const score = {
      card: guess ? nameMatch(label.card_name, guess.card_name) : false,
      set: guess ? setMatch(label, guess.set_name) : false,
      number: guess ? numberMatch(label.card_number, guess.card_number) : false,
      finish: guess ? normFinish(label.finish) === normFinish(guess.finish) : false,
    };

    const dist = label.distribution || 'unspecified';
    byDist[dist] ||= blankTally();
    for (const t of [byDist[dist], overall]) {
      t.n++;
      t.card += score.card ? 1 : 0;
      t.set += score.set ? 1 : 0;
      t.number += score.number ? 1 : 0;
      t.finish += score.finish ? 1 : 0;
    }

    perFrame.push({ ...label, guess, error, score });
    console.log(
      error ? `ERROR ${error}` : `card:${score.card ? 'Y' : 'n'} set:${score.set ? 'Y' : 'n'} finish:${score.finish ? 'Y' : 'n'}`
    );
  }

  const rows = [['distribution', 'n', 'card', 'set', 'number', 'finish'], ['-', '-', '-', '-', '-', '-']];
  for (const [dist, t] of Object.entries(byDist)) {
    rows.push([dist, String(t.n), pct(t.card, t.n), pct(t.set, t.n), pct(t.number, t.n), pct(t.finish, t.n)]);
  }
  rows.push(['OVERALL', String(overall.n), pct(overall.card, overall.n), pct(overall.set, overall.n), pct(overall.number, overall.n), pct(overall.finish, overall.n)]);

  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  console.log('\n' + rows.map((r) => r.map((cell, c) => cell.padEnd(w[c])).join('  ')).join('\n'));

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(RESULTS_DIR, `${stamp}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      { at: new Date().toISOString(), model: MODEL, identifier: 'openai-direct', summary: { byDist, overall }, perFrame },
      null,
      2
    )
  );
  console.log(`\nwrote ${out}`);
}

main().catch((err) => {
  console.error('\nBENCHMARK ERROR:', err);
  process.exit(1);
});
