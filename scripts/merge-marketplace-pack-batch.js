'use strict';

const fs = require('fs');
const path = require('path');

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

function parseArgs(argv) {
  const args = {
    provider: 'archiveorg',
    system: 'snes',
    batchPath: '',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--provider') args.provider = argv[++i] || args.provider;
    else if (value === '--system') args.system = argv[++i] || args.system;
    else if (!args.batchPath) args.batchPath = value;
  }
  return args;
}

function normalizeBatch(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.entries)) return raw.entries;
  if (Array.isArray(raw?.candidates)) {
    return raw.candidates.map(candidate => ({
      identifiers: candidate.identifiers || [],
      metadata: candidate.metadata || candidate.metadataTemplate || null,
    }));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([identifier, metadata]) => ({
      identifiers: [identifier],
      metadata,
    }));
  }
  return [];
}

function normalizeMetadata(metadata = {}, context = {}) {
  const title = String(metadata.title || context.title || '').trim();
  if (!title) return null;
  return {
    title,
    sort_title: metadata.sort_title || title,
    publisher: metadata.publisher || '',
    developer: metadata.developer || '',
    genres: Array.isArray(metadata.genres) ? metadata.genres : [],
    description: metadata.description || '',
    release_date: metadata.release_date || '',
    players: metadata.players || '',
    age_rating: metadata.age_rating || '',
    age_rating_label: metadata.age_rating_label || '',
    age_rating_board: metadata.age_rating_board || (metadata.age_rating ? 'ESRB' : ''),
    rating: metadata.rating || '',
    metadata_source: metadata.metadata_source || 'packaged-metadata',
    match_confidence: metadata.match_confidence ?? 1,
    source_id: metadata.source_id || metadata.screenscraper_id || metadata.thegamesdb_id || '',
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.batchPath) {
    console.error('Usage: node scripts/merge-marketplace-pack-batch.js <batch.json> [--provider archiveorg] [--system snes] [--dry-run]');
    process.exit(1);
  }

  const root = path.resolve(__dirname, '..');
  const batchPath = path.resolve(process.cwd(), args.batchPath);
  const packPath = path.join(root, 'assets', 'metadata', args.provider, `${args.system}.json`);
  const pack = readJson(packPath, {
    system: args.system,
    version: 1,
    source: 'packaged-metadata',
    generatedAt: new Date().toISOString(),
    games: {},
  });
  if (!pack.games || typeof pack.games !== 'object') pack.games = {};

  const rawBatch = readJson(batchPath, null);
  const entries = normalizeBatch(rawBatch);
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const identifiers = Array.isArray(entry.identifiers)
      ? entry.identifiers.filter(Boolean)
      : [entry.identifier].filter(Boolean);
    const metadata = normalizeMetadata(entry.metadata || entry, { title: entry.suggestedTitle || identifiers[0] });
    if (!identifiers.length || !metadata || !metadata.description) {
      skipped += identifiers.length || 1;
      continue;
    }

    for (const identifier of identifiers) {
      if (pack.games[identifier]) updated += 1;
      else added += 1;
      pack.games[identifier] = {
        ...pack.games[identifier],
        ...metadata,
      };
    }
  }

  pack.system = pack.system || args.system;
  pack.version = pack.version || 1;
  pack.source = pack.source || 'packaged-metadata';
  pack.generatedAt = new Date().toISOString();

  const summary = {
    provider: args.provider,
    system: args.system,
    batchPath,
    packPath,
    added,
    updated,
    skipped,
    totalPackEntries: Object.keys(pack.games).length,
    dryRun: args.dryRun,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!args.dryRun) writeJson(packPath, pack);
}

main();
