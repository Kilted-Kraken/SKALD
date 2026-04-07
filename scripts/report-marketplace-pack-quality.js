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
    write: false,
  };
  const positional = [];
  for (const value of argv) {
    if (value === '--write') args.write = true;
    else if (!value.startsWith('--')) positional.push(value);
  }
  if (positional[0]) args.provider = positional[0];
  if (positional[1]) args.system = positional[1];
  return args;
}

function isBlank(value) {
  return !String(value || '').trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const packPath = path.join(root, 'assets', 'metadata', args.provider, `${args.system}.json`);
  const reportDir = path.join(root, 'reports');
  const pack = readJson(packPath, { games: {} });
  const games = pack?.games && typeof pack.games === 'object' ? pack.games : {};
  const buckets = {
    missingDescription: [],
    missingPublisherDeveloper: [],
    missingGenres: [],
    missingAgeRating: [],
    missingReleaseDate: [],
    missingPlayers: [],
  };

  for (const [identifier, metadata] of Object.entries(games)) {
    if (!metadata || typeof metadata !== 'object') {
      buckets.missingDescription.push(identifier);
      buckets.missingPublisherDeveloper.push(identifier);
      buckets.missingGenres.push(identifier);
      buckets.missingAgeRating.push(identifier);
      continue;
    }
    if (isBlank(metadata.description)) buckets.missingDescription.push(identifier);
    if (isBlank(metadata.publisher) && isBlank(metadata.developer)) buckets.missingPublisherDeveloper.push(identifier);
    if (!Array.isArray(metadata.genres) || !metadata.genres.length) buckets.missingGenres.push(identifier);
    if (isBlank(metadata.age_rating)) buckets.missingAgeRating.push(identifier);
    if (isBlank(metadata.release_date)) buckets.missingReleaseDate.push(identifier);
    if (isBlank(metadata.players)) buckets.missingPlayers.push(identifier);
  }

  const summary = {
    provider: args.provider,
    system: args.system,
    packPath,
    packEntries: Object.keys(games).length,
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(buckets).map(([key, entries]) => [key, entries.length])),
    buckets,
  };

  console.log(JSON.stringify({
    provider: summary.provider,
    system: summary.system,
    packEntries: summary.packEntries,
    counts: summary.counts,
  }, null, 2));

  if (args.write) {
    const outPath = path.join(reportDir, `${args.provider}-${args.system}-pack.quality.json`);
    writeJson(outPath, summary);
    console.log(`Wrote ${outPath}`);
  }
}

main();
