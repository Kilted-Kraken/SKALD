'use strict';

const fs = require('fs');
const path = require('path');

function sanitizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.(zip|7z|chd|iso|bin|cue|sfc|smc)$/i, '')
    .replace(/[\[(][^\])]*[\])]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const positionals = [];
  const flags = new Set();
  for (const value of argv) {
    if (value.startsWith('--')) flags.add(value);
    else positionals.push(value);
  }
  return {
    provider: positionals[0] || 'archiveorg',
    system: positionals[1] || 'snes',
    write: flags.has('--write'),
  };
}

function main() {
  const { provider, system, write } = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const catalogPath = path.join(root, 'assets', 'roms', `roms-${system}.json`);
  const packPath = path.join(root, 'assets', 'metadata', provider, `${system}.json`);
  const reportDir = path.join(root, 'reports');
  const reportBase = `${provider}-${system}-pack`;

  const catalog = readJson(catalogPath, []);
  const pack = readJson(packPath, { games: {} });
  const packGames = pack && typeof pack.games === 'object' ? pack.games : {};
  const exactMatches = new Set(Object.keys(packGames));
  const titleMatches = new Map();

  for (const [identifier, entry] of Object.entries(packGames)) {
    const keys = [
      identifier,
      entry?.catalog_identifier,
      entry?.name,
      entry?.title,
      entry?.sort_title,
    ]
      .filter(Boolean)
      .map(sanitizeTitle)
      .filter(Boolean);
    for (const key of keys) {
      if (!titleMatches.has(key)) titleMatches.set(key, identifier);
    }
  }

  const matched = [];
  const missing = [];
  for (const rom of Array.isArray(catalog) ? catalog : []) {
    const identifier = String(rom?.name || '');
    if (!identifier) continue;
    const normalized = sanitizeTitle(rom?.cleanName || rom?.name || '');
    const exact = exactMatches.has(identifier);
    const titleKey = normalized && titleMatches.has(normalized) ? titleMatches.get(normalized) : null;
    const result = {
      identifier,
      cleanName: rom?.cleanName || '',
      region: rom?.region || '',
      size: rom?.size || '',
      exact,
      matchedPackEntry: exact ? identifier : titleKey,
    };
    if (exact || titleKey) matched.push(result);
    else missing.push(result);
  }

  const summary = {
    provider,
    system,
    catalogPath,
    packPath,
    catalogEntries: Array.isArray(catalog) ? catalog.length : 0,
    packEntries: Object.keys(packGames).length,
    matchedCatalogEntries: matched.length,
    missingCatalogEntries: missing.length,
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!write) return;

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, `${reportBase}.summary.json`),
    JSON.stringify(summary, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(reportDir, `${reportBase}.missing.txt`),
    missing.map(item => `${item.identifier}${item.region ? ` | ${item.region}` : ''}${item.size ? ` | ${item.size}` : ''}`).join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(reportDir, `${reportBase}.matched.json`),
    JSON.stringify(matched, null, 2),
    'utf8'
  );

  console.log(`Wrote reports to ${reportDir}`);
}

main();
