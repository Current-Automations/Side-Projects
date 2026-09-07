/**
 * scripts/spike-tcgdex.mjs
 *
 * Phase 0.7 spike — throwaway. Verifies TCGdex is a viable catalog source
 * before the Pokemon domain migration (see the plan at
 * ~/.claude/plans/lets-plan-this-out-precious-tower.md).
 *
 * Checks, against one Scarlet & Violet set (sv03, Obsidian Flames):
 *   1. set + card endpoints respond and have the fields we need
 *   2. `high` image URLs actually resolve (HEAD 200, sane byte size)
 *   3. variants_detailed is populated (the finish list Phase 2 stage 2 needs)
 *   4. illustrator is present (a stage-1 matching signal)
 *   5. alt arts sit above card_count.official with their own numbers + images
 *   6. tcgplayer / cardmarket prices are present (replaces the eBay layer for Pokemon)
 *
 * Run: node scripts/spike-tcgdex.mjs
 */

const BASE = 'https://api.tcgdex.net/v2/en';
const SET_ID = 'sv03';

const ok = (label, cond, detail = '') =>
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function headOk(url) {
  const res = await fetch(url, { method: 'GET' }); // TCGdex assets 405 on HEAD; range-free GET is fine
  const len = Number(res.headers.get('content-length') ?? '0');
  return { ok: res.ok, status: res.status, bytes: len };
}

async function main() {
  console.log(`TCGdex spike — set ${SET_ID}\n`);

  // 1. set endpoint
  const set = await getJson(`${BASE}/sets/${SET_ID}`);
  ok('set endpoint responds', !!set?.id, `id=${set.id} name=${JSON.stringify(set.name)}`);
  ok('set has cardCount.official/total', set?.cardCount?.official > 0 && set?.cardCount?.total > 0,
    `official=${set.cardCount?.official} total=${set.cardCount?.total}`);
  ok('set embeds brief card list', Array.isArray(set.cards) && set.cards.length > 0,
    `${set.cards?.length} cards`);

  const official = set.cardCount.official;
  const briefCards = set.cards;

  // 2. full card record — a mid-set base card
  const sampleId = `${SET_ID}-021`;
  const card = await getJson(`${BASE}/cards/${sampleId}`);
  ok('card endpoint responds', card?.id === sampleId, `name=${card.name} rarity=${card.rarity}`);
  ok('card has illustrator', typeof card.illustrator === 'string' && card.illustrator.length > 0,
    card.illustrator);
  ok('card has variants_detailed', Array.isArray(card.variants_detailed) && card.variants_detailed.length > 0,
    JSON.stringify(card.variants_detailed?.map((v) => v.type)));
  ok('card has variants flags', !!card.variants,
    JSON.stringify(card.variants));
  ok('card has tcgplayer or cardmarket pricing',
    !!card.pricing?.tcgplayer || !!card.pricing?.cardmarket,
    `keys=${Object.keys(card.pricing ?? {}).join(',')}`);

  // 3. image resolves
  const imgHigh = `${card.image}/high.jpg`;
  const imgLow = `${card.image}/low.webp`;
  const h = await headOk(imgHigh);
  ok('high.jpg image resolves', h.ok && h.bytes > 10_000, `status=${h.status} bytes=${h.bytes}`);
  const l = await headOk(imgLow);
  ok('low.webp image resolves', l.ok && l.bytes > 2_000, `status=${l.status} bytes=${l.bytes}`);

  // 4. reverse-vs-normal collapsed onto one entry (the finding that forces two-stage)
  const finishes = (card.variants_detailed ?? []).map((v) => v.type);
  ok('one image serves multiple finishes', finishes.length > 1,
    `${finishes.length} finishes, 1 image url (${card.image})`);

  // 5. alt art above official count
  const altCandidate = briefCards.find((c) => {
    const n = Number(c.localId);
    return Number.isFinite(n) && n > official;
  });
  if (altCandidate) {
    const alt = await getJson(`${BASE}/cards/${altCandidate.id}`);
    ok('alt art is its own entry above official count', Number(alt.localId) > official,
      `${alt.id} localId=${alt.localId} rarity=${alt.rarity} illustrator=${alt.illustrator}`);
    ok('alt art has its own image', typeof alt.image === 'string' && alt.image !== card.image,
      alt.image);
    ok('alt art illustrator differs from base', alt.illustrator !== card.illustrator,
      `base=${card.illustrator} alt=${alt.illustrator}`);
  } else {
    ok('alt art above official count present', false, 'none found in brief list');
  }

  // 6. rough coverage sample across the set
  const sample = briefCards.slice(0, 25);
  const withImg = sample.filter((c) => typeof c.image === 'string' && c.image.length > 0).length;
  ok('image coverage on first 25 cards', withImg === sample.length, `${withImg}/${sample.length}`);

  console.log('\nrarity enum sample from set:',
    [...new Set(await Promise.all(
      briefCards.slice(0, 12).map(async (c) => (await getJson(`${BASE}/cards/${c.id}`)).rarity)
    ))].join(', '));

  console.log('\nDone. If everything above is PASS, TCGdex is good for Phase 1.3.');
  console.log('Next: run the repo docker-compose for offline use, then decide API-vs-selfhost.');
}

main().catch((err) => {
  console.error('\nSPIKE ERROR:', err.message);
  process.exit(1);
});
