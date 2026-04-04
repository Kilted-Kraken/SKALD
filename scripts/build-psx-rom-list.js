'use strict';
/**
 * build-psx-rom-list.js
 * Fetches CHD PSX ROM lists from 5 archive.org metadata endpoints,
 * parses filenames, and writes assets/roms/roms-psx.json
 *
 * Run: node scripts/build-psx-rom-list.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const SOURCES = [
  { identifier: 'chd_psx',        folder: 'CHD-PSX-USA',  regionHint: 'USA'    },
  { identifier: 'chd_psx_eur',    folder: 'CHD-PSX-EUR',  regionHint: 'Europe' },
  { identifier: 'chd_psx_jap',    folder: 'CHD-PSX-JAP',  regionHint: 'Japan'  },
  { identifier: 'chd_psx_jap_p2', folder: 'CHD-PSX-JAP',  regionHint: 'Japan'  },
  { identifier: 'chd_psx_misc',   folder: 'CHD-PSX-Misc', regionHint: null     },
];

const OUT_PATH = path.join(__dirname, '../assets/roms/roms-psx.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SKALD-RomBuilder/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function formatSize(bytes) {
  if (!bytes) return '';
  const b = Number(bytes);
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(2) + ' GB';
  if (b >= 1_048_576)     return (b / 1_048_576).toFixed(1) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}

function parsePsxFilename(filename) {
  const REGIONS = 'USA|Europe|Japan|World|Germany|France|Spain|Italy|Australia|Korea|China|Brazil|Netherlands|Sweden|Norway|Denmark|Finland|Russia|Poland|Canada|Mexico|Portugal|Greece|Hungary|Czech|Romania|Croatia|Serbia|Bulgaria|Ukraine|Israel|Turkey|India|Argentina|Chile|Colombia|Venezuela|Peru';
  const LANG    = 'En|Ja|De|Fr|Es|It|Nl|Pt|Sv|No|Da|Fi|Ru|Pl|Ko|Zh|Ar|He|Tr|Cs|Hu|Ro|Hr|Sr|Bg|Uk|El';
  const rBlk = `\\((?:(?:${REGIONS})(?:,\\s*(?:${REGIONS}))*|(?:${LANG})(?:,\\s*(?:${LANG}))*)\\)`;
  const tBlk = `\\((?:Beta|Proto|Sample|Demo|Rev\\s*\\d*|Hack|Alt|Unl|BIOS|Kiosk|Promo|Aftermarket|Pirate|v[\\d.]+|Disc\\s*\\d+)[^)]*\\)`;

  let base = filename.replace(/\.chd$/i, '');

  const firstRegion = base.match(new RegExp(rBlk, 'i'));
  const region = firstRegion ? firstRegion[0].replace(/[()]/g, '').trim() : '';

  const tags = [];
  let m;
  const tagRe = new RegExp(tBlk, 'gi');
  while ((m = tagRe.exec(base)) !== null) tags.push(m[0].replace(/[()]/g, '').trim());

  let cleanName = base
    .replace(new RegExp(rBlk, 'gi'), '')
    .replace(new RegExp(tBlk, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { cleanName: cleanName || base, region, tags };
}

async function main() {
  console.log('Fetching PSX ROM lists from archive.org...\n');

  const allRoms = [];
  const seen = new Set();

  for (const source of SOURCES) {
    const url = `https://archive.org/metadata/${source.identifier}`;
    console.log(`Fetching ${url} ...`);

    let data;
    try { data = await fetchJson(url); }
    catch (e) { console.error(`  ERROR: ${e.message}`); continue; }

    const files = (data.files || []).filter(f =>
      f.name.endsWith('.chd') && f.name.startsWith(source.folder + '/')
    );

    console.log(`  ${files.length} CHD files`);

    for (const file of files) {
      const basename = file.name.slice(source.folder.length + 1);
      if (seen.has(`${source.folder}::${basename}`)) continue;
      seen.add(`${source.folder}::${basename}`);

      const { cleanName, region, tags } = parsePsxFilename(basename);
      const sizeBytes = parseInt(file.size || '0', 10);
      const effectiveRegion = region || source.regionHint || '';
      const encodedPath = file.name.split('/').map(encodeURIComponent).join('/');
      const downloadUrl = `https://archive.org/download/${source.identifier}/${encodedPath}`;

      allRoms.push({
        name: basename,
        cleanName,
        region: effectiveRegion,
        tags,
        size: formatSize(sizeBytes),
        sizeBytes,
        timestamp: file.mtime ? new Date(parseInt(file.mtime) * 1000).toISOString().slice(0, 10) : '',
        downloadUrl,
        source: source.identifier,
      });
    }
  }

  allRoms.sort((a, b) => {
    const t = a.cleanName.localeCompare(b.cleanName);
    return t !== 0 ? t : a.region.localeCompare(b.region);
  });

  console.log(`\nTotal ROMs: ${allRoms.length}`);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(allRoms));

  const stat = fs.statSync(OUT_PATH);
  console.log(`Written: ${OUT_PATH} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

  const byRegion = {};
  for (const r of allRoms) {
    byRegion[r.region || 'Unknown'] = (byRegion[r.region || 'Unknown'] || 0) + 1;
  }
  console.log('\nBreakdown by region:');
  for (const [k, v] of Object.entries(byRegion).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
