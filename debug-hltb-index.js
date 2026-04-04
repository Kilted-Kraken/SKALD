// Debug: show what the hltb-list-cache handler would return
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const cacheDir = path.join(os.homedir(), 'AppData', 'Roaming', 'skald-launcher', 'hltbcache');
console.log('Cache dir:', cacheDir);
console.log('Exists:', fs.existsSync(cacheDir));

if (!fs.existsSync(cacheDir)) { process.exit(0); }

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
console.log(`Found ${files.length} JSON files\n`);

const index = {};
for (const file of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
    if (!data) { console.log(`  ${file}: null (no HLTB result)`); continue; }
    const slug = file.slice(0, -5);
    index[slug] = {
      developer:   data.developer   || null,
      genre:       data.genre       || null,
      releaseDate: data.releaseDate ? data.releaseDate.slice(0, 4) : null,
      esrb:        data.esrb        || null,
      pegi:        data.pegi        || null,
    };
    console.log(`  ${slug}:`);
    console.log(`    developer: ${data.developer || '(none)'}`);
    console.log(`    genre:     ${data.genre || '(none)'}`);
    console.log(`    year:      ${data.releaseDate ? data.releaseDate.slice(0,4) : '(none)'}`);
    console.log(`    esrb:      ${data.esrb || '(none)'}`);
    console.log(`    pegi:      ${data.pegi || '(none)'}`);
  } catch(e) { console.log(`  ${file}: ERROR ${e.message}`); }
}

console.log(`\nIndex has ${Object.keys(index).length} entries with metadata`);
