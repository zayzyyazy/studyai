/**
 * Lightweight intake logic checks (no Electron).
 * Run: node scripts/test-intake-logic.mjs
 */

function topicCanonicalKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .replace(/\b(der|die|das|und|oder|mit|von|zur|zum|the|and|of|for|in|to|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleMatchScore(a, b) {
  const wa = new Set(topicCanonicalKey(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(topicCanonicalKey(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits += 1;
  return hits / Math.max(wa.size, wb.size);
}

function topicLooseMatch(a, b) {
  return titleMatchScore(a, b) > 0.34
    || String(a).toLowerCase().includes(String(b).toLowerCase())
    || String(b).toLowerCase().includes(String(a).toLowerCase());
}

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

assert('canonical keys match near-duplicates', topicLooseMatch('Organisatorisches Einf', 'Organisatorisches_Einf'));
assert('different lectures do not match', !topicLooseMatch('Vorlesung 5 Gruppen', 'Lineare Abbildungen'));
assert('title score high for same topic', titleMatchScore('Gruppen · Ringe', 'Gruppen Ringe') >= 0.5);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
