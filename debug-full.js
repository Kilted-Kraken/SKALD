// Full diagnostic: simulates exactly what startHltbPrefetch does
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const HLTB_CACHE_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'skald-launcher', 'hltbcache');

console.log('=== HLTB Cache Diagnostic ===');
console.log('Cache dir:', HLTB_CACHE_DIR);
console.log('Exists:', fs.existsSync(HLTB_CACHE_DIR));

if (!fs.existsSync(HLTB_CACHE_DIR)) { console.log('STOP: cache dir does not exist'); process.exit(1); }

const files = fs.readdirSync(HLTB_CACHE_DIR);
console.log('Total files:', files.length);
console.log('JSON files:', files.filter(f => f.endsWith('.json')).length);
console.log('\nFiles:');
files.forEach(f => {
  const p = path.join(HLTB_CACHE_DIR, f);
  const stat = fs.statSync(p);
  const raw = fs.readFileSync(p, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e) { parsed = 'PARSE ERROR: ' + e.message; }
  console.log(' ', f, `(${stat.size} bytes)`, '-> data is', parsed === null ? 'NULL' : typeof parsed, parsed ? `(title: ${parsed.title || 'none'}, dev: ${parsed.developer || 'none'})` : '');
});

// Simulate hltb-list-cache handler
console.log('\n=== Simulating hltb-list-cache ===');
const index = {};
for (const file of files) {
  if (!file.endsWith('.json')) continue;
  try {
    const raw  = fs.readFileSync(path.join(HLTB_CACHE_DIR, file), 'utf8');
    const data = JSON.parse(raw);
    if (!data) { console.log('SKIP (null):', file); continue; }
    const slug = file.slice(0, -5);
    index[slug] = {
      developer:   data.developer   || null,
      publisher:   data.publisher   || null,
      genre:       data.genre       || null,
      releaseDate: data.releaseDate ? data.releaseDate.slice(0, 4) : null,
      esrb:        data.esrb        || null,
      pegi:        data.pegi        || null,
    };
    console.log('INDEXED:', slug, '->', JSON.stringify(index[slug]));
  } catch(e) { console.log('ERROR on', file, e.message); }
}
console.log('\nIndex entries:', Object.keys(index).length);
console.log('Index:', JSON.stringify(index, null, 2));

// Check if prefetch-next would skip these
console.log('\n=== Prefetch skip check ===');
for (const file of files.filter(f => f.endsWith('.json'))) {
  console.log(file, '-> would be SKIPPED (already cached)');
}
