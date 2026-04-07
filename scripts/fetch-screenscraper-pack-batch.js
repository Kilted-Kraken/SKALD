'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const SYSTEM_IDS = {
  snes: 4,
};

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    provider: 'archiveorg',
    system: 'snes',
    count: 10,
    offset: 0,
    search: '',
    delayMs: 1200,
    outPath: '',
    cacheOnly: false,
    dryRun: false,
    checkCredentials: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--provider') args.provider = argv[++i] || args.provider;
    else if (value === '--system') args.system = argv[++i] || args.system;
    else if (value === '--count') args.count = Math.max(1, Number(argv[++i] || args.count));
    else if (value === '--offset') args.offset = Math.max(0, Number(argv[++i] || args.offset));
    else if (value === '--search') args.search = argv[++i] || args.search;
    else if (value === '--delay-ms') args.delayMs = Math.max(250, Number(argv[++i] || args.delayMs));
    else if (value === '--out') args.outPath = argv[++i] || args.outPath;
    else if (value === '--cache-only') args.cacheOnly = true;
    else if (value === '--dry-run') args.dryRun = true;
    else if (value === '--check-credentials') args.checkCredentials = true;
  }
  return args;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'batch';
}

function candidateMatchesSearch(candidate, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    candidate.key,
    candidate.suggestedTitle,
    ...(candidate.identifiers || []),
  ].join('\n').toLowerCase();
  return haystack.includes(needle);
}

function firstValue(value) {
  if (Array.isArray(value)) return value.map(firstValue).find(Boolean) || '';
  if (value && typeof value === 'object') {
    return value.text || value.nom || value.name || value.value || value.libelle || '';
  }
  return String(value || '').trim();
}

function localizedText(collection, preferred = ['us', 'wor', 'ss', 'eu', 'jp', 'fr', 'en']) {
  if (!collection) return '';
  if (typeof collection === 'string') return collection.trim();
  if (Array.isArray(collection)) {
    for (const region of preferred) {
      const match = collection.find(item => {
        const key = String(item?.region || item?.region_shortname || item?.langue || item?.lang || '').toLowerCase();
        return key === region;
      });
      const value = firstValue(match);
      if (value) return value;
    }
    return firstValue(collection);
  }
  if (typeof collection === 'object') {
    for (const key of preferred) {
      const direct = firstValue(collection[key] || collection[`nom_${key}`] || collection[`synopsis_${key}`]);
      if (direct) return direct;
    }
    return firstValue(Object.values(collection));
  }
  return '';
}

function normalizeDate(value) {
  const text = firstValue(value);
  const match = text.match(/\d{4}(?:-\d{2}(?:-\d{2})?)?/);
  return match ? match[0] : '';
}

function normalizeRating(value) {
  const text = firstValue(value).toUpperCase().replace(/^ESRB[:\s-]*/i, '').trim();
  const normalized = text.replace(/\s+/g, '');
  if (normalized === 'E10+' || normalized === 'E10') return 'E10+';
  if (['EC', 'E', 'T', 'M', 'AO', 'RP'].includes(normalized)) return normalized;
  return '';
}

function normalizeGenres(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .flatMap(item => {
      const text = firstValue(item);
      return text.split(/[;,/]/g);
    })
    .map(item => item.trim())
    .filter(Boolean))];
}

function getGameObject(raw) {
  return raw?.response?.jeu || raw?.jeu || raw?.game || raw?.response?.game || null;
}

function mapScreenScraperMetadata(raw, fallbackTitle) {
  const game = getGameObject(raw);
  if (!game || typeof game !== 'object') return null;
  const title = localizedText(game.noms) || firstValue(game.nom) || fallbackTitle;
  const ageRating = normalizeRating(game.classifications || game.classification || game.rating);
  return {
    title,
    sort_title: title,
    publisher: firstValue(game.editeur),
    developer: firstValue(game.developpeur),
    genres: normalizeGenres(game.genres || game.genre),
    description: localizedText(game.synopsis || game.synopsiss || game.description),
    release_date: normalizeDate(game.dates || game.datessortie || game.date),
    players: firstValue(game.joueurs || game.players || game.nbj),
    age_rating: ageRating,
    age_rating_label: ageRating ? esrbLabel(ageRating) : '',
    age_rating_board: ageRating ? 'ESRB' : '',
    metadata_source: 'screenscraper',
    match_confidence: 0.9,
    source_id: firstValue(game.id),
  };
}

function esrbLabel(value) {
  return {
    EC: 'Early Childhood',
    E: 'Everyone',
    'E10+': 'Everyone 10+',
    T: 'Teen',
    M: 'Mature',
    AO: 'Adults Only',
    RP: 'Rating Pending',
  }[value] || '';
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`ScreenScraper HTTP ${response.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Could not parse ScreenScraper JSON: ${error.message}`));
        }
      });
    }).on('error', reject);
  });
}

function credentials() {
  return {
    devid: process.env.SCREENSCRAPER_DEVID || '',
    devpassword: process.env.SCREENSCRAPER_DEVPASSWORD || '',
    softname: process.env.SCREENSCRAPER_SOFTNAME || 'SKALD',
    ssid: process.env.SCREENSCRAPER_SSID || '',
    sspassword: process.env.SCREENSCRAPER_SSPASSWORD || '',
  };
}

function buildUrl({ systemId, identifier, size }) {
  const creds = credentials();
  if (!creds.devid || !creds.devpassword) {
    throw new Error('Set SCREENSCRAPER_DEVID and SCREENSCRAPER_DEVPASSWORD before fetching.');
  }
  const url = new URL('https://api.screenscraper.fr/api2/jeuInfos.php');
  url.searchParams.set('devid', creds.devid);
  url.searchParams.set('devpassword', creds.devpassword);
  url.searchParams.set('softname', creds.softname);
  url.searchParams.set('output', 'json');
  if (creds.ssid) url.searchParams.set('ssid', creds.ssid);
  if (creds.sspassword) url.searchParams.set('sspassword', creds.sspassword);
  url.searchParams.set('systemeid', String(systemId));
  url.searchParams.set('romtype', 'rom');
  url.searchParams.set('romnom', identifier);
  if (size) url.searchParams.set('romtaille', String(size));
  return url;
}

async function getScreenScraperResponse({ cachePath, dryRun, cacheOnly, systemId, identifier, size }) {
  if (fs.existsSync(cachePath)) return readJson(cachePath, null);
  if (dryRun || cacheOnly) return null;
  const raw = await requestJson(buildUrl({ systemId, identifier, size }));
  writeJson(cachePath, raw);
  return raw;
}

function candidatePrimaryVariant(candidate) {
  const variants = Array.isArray(candidate.variants) ? candidate.variants : [];
  return variants.find(variant => /\(USA\)/i.test(variant.identifier || ''))
    || variants.find(variant => !/(Beta|Proto|Demo|Sample|Pirate|Hack)/i.test(variant.identifier || ''))
    || variants[0]
    || { identifier: (candidate.identifiers || [])[0] || candidate.suggestedTitle, size: '' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  loadDotEnv(path.join(root, '.env'));
  const systemId = SYSTEM_IDS[args.system];
  if (!systemId) throw new Error(`No ScreenScraper system id configured for ${args.system}.`);
  if (args.checkCredentials) {
    const creds = credentials();
    console.log(JSON.stringify({
      hasDeveloperId: Boolean(creds.devid),
      hasDeveloperPassword: Boolean(creds.devpassword),
      softname: creds.softname,
      hasUserId: Boolean(creds.ssid),
      hasUserPassword: Boolean(creds.sspassword),
      canFetch: Boolean(creds.devid && creds.devpassword),
    }, null, 2));
    return;
  }
  const candidatesPath = path.join(root, 'reports', `${args.provider}-${args.system}-pack.candidates.json`);
  const cacheDir = path.join(root, 'reports', 'screenscraper-cache', args.system);
  const source = readJson(candidatesPath, { candidates: [] });
  const candidates = (Array.isArray(source.candidates) ? source.candidates : [])
    .filter(candidate => candidateMatchesSearch(candidate, args.search))
    .slice(args.offset, args.offset + args.count);
  const defaultName = args.search
    ? `${args.provider}-${args.system}-pack.screenscraper-${slug(args.search)}-${args.offset}-${args.offset + args.count - 1}.json`
    : `${args.provider}-${args.system}-pack.screenscraper-${args.offset}-${args.offset + args.count - 1}.json`;
  const outPath = args.outPath ? path.resolve(process.cwd(), args.outPath) : path.join(root, 'reports', defaultName);
  const entries = [];
  const misses = [];

  fs.mkdirSync(cacheDir, { recursive: true });

  for (const candidate of candidates) {
    const primary = candidatePrimaryVariant(candidate);
    const cachePath = path.join(cacheDir, `${slug(primary.identifier || candidate.suggestedTitle)}.json`);
    try {
      const raw = await getScreenScraperResponse({
        cachePath,
        dryRun: args.dryRun,
        cacheOnly: args.cacheOnly,
        systemId,
        identifier: primary.identifier || candidate.suggestedTitle,
        size: primary.sizeBytes || primary.size || '',
      });
      const metadata = raw ? mapScreenScraperMetadata(raw, candidate.suggestedTitle) : null;
      if (metadata && metadata.title && metadata.description) {
        entries.push({
          key: candidate.key,
          suggestedTitle: candidate.suggestedTitle,
          identifiers: candidate.identifiers || [],
          metadata,
        });
      } else {
        misses.push({ key: candidate.key, title: candidate.suggestedTitle, identifier: primary.identifier || '' });
      }
    } catch (error) {
      misses.push({ key: candidate.key, title: candidate.suggestedTitle, identifier: primary.identifier || '', error: error.message });
    }
    if (!args.dryRun && !args.cacheOnly) await sleep(args.delayMs);
  }

  const batch = {
    provider: args.provider,
    system: args.system,
    source: candidatesPath,
    generatedAt: new Date().toISOString(),
    metadataProvider: 'screenscraper',
    offset: args.offset,
    count: entries.length,
    search: args.search,
    dryRun: args.dryRun,
    cacheOnly: args.cacheOnly,
    misses,
    entries,
  };

  writeJson(outPath, batch);
  console.log(JSON.stringify({
    provider: args.provider,
    system: args.system,
    outPath,
    entries: entries.length,
    misses: misses.length,
    dryRun: args.dryRun,
    cacheOnly: args.cacheOnly,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
