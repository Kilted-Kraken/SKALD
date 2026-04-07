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

function parseArgs(argv) {
  const args = {
    provider: 'archiveorg',
    system: 'snes',
    batchPath: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--provider') args.provider = argv[++i] || args.provider;
    else if (value === '--system') args.system = argv[++i] || args.system;
    else if (!args.batchPath) args.batchPath = value;
  }
  return args;
}

function normalizeBatch(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.entries)) return raw.entries;
  return [];
}

function validReleaseDate(value) {
  const text = String(value || '').trim();
  return !text || /^\d{4}(-\d{2}){0,2}$/.test(text);
}

function validAgeRating(value) {
  const text = String(value || '').trim().toUpperCase();
  return !text || new Set(['EC', 'E', 'E10', 'E10+', 'T', 'M', 'AO', 'RP']).has(text);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.batchPath) {
    console.error('Usage: node scripts/validate-marketplace-pack-batch.js <batch.json> [--provider archiveorg] [--system snes]');
    process.exit(1);
  }

  const root = path.resolve(__dirname, '..');
  const batchPath = path.resolve(process.cwd(), args.batchPath);
  const catalogPath = path.join(root, 'assets', 'roms', `roms-${args.system}.json`);
  const catalog = readJson(catalogPath, []);
  const knownIdentifiers = new Set((Array.isArray(catalog) ? catalog : []).map(rom => rom?.name).filter(Boolean));
  const rawBatch = readJson(batchPath, null);
  const entries = normalizeBatch(rawBatch);
  const seen = new Set();
  const problems = [];
  let identifierCount = 0;

  entries.forEach((entry, index) => {
    const metadata = entry.metadata || entry;
    const identifiers = Array.isArray(entry.identifiers)
      ? entry.identifiers.filter(Boolean)
      : [entry.identifier].filter(Boolean);

    if (!identifiers.length) {
      problems.push({ index, severity: 'error', message: 'Entry has no identifiers.' });
    }

    for (const identifier of identifiers) {
      identifierCount += 1;
      if (seen.has(identifier)) {
        problems.push({ index, identifier, severity: 'error', message: 'Duplicate identifier in batch.' });
      }
      seen.add(identifier);
      if (!knownIdentifiers.has(identifier)) {
        problems.push({ index, identifier, severity: 'warning', message: 'Identifier was not found in the catalog file.' });
      }
    }

    if (!String(metadata?.title || '').trim()) {
      problems.push({ index, severity: 'error', message: 'Metadata title is missing.' });
    }
    if (!String(metadata?.description || '').trim()) {
      problems.push({ index, severity: 'error', message: 'Metadata description is missing.' });
    }
    if (!Array.isArray(metadata?.genres) || !metadata.genres.length) {
      problems.push({ index, severity: 'warning', message: 'Metadata genres are empty.' });
    } else if (metadata.genres.some(genre => !String(genre || '').trim())) {
      problems.push({ index, severity: 'warning', message: 'Metadata genres contain blank values.' });
    }
    if (!String(metadata?.publisher || metadata?.developer || '').trim()) {
      problems.push({ index, severity: 'warning', message: 'Metadata publisher/developer are both empty.' });
    }
    if (metadata?.age_rating && !validAgeRating(metadata.age_rating)) {
      problems.push({ index, severity: 'warning', message: `Age rating "${metadata.age_rating}" is not a recognized ESRB shorthand.` });
    }
    if (!validReleaseDate(metadata?.release_date)) {
      problems.push({ index, severity: 'warning', message: 'Release date should use YYYY, YYYY-MM, or YYYY-MM-DD.' });
    }
  });

  const errorCount = problems.filter(problem => problem.severity === 'error').length;
  const warningCount = problems.filter(problem => problem.severity === 'warning').length;
  const summary = {
    provider: args.provider,
    system: args.system,
    batchPath,
    entries: entries.length,
    identifiers: identifierCount,
    errors: errorCount,
    warnings: warningCount,
    ok: errorCount === 0,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (problems.length) {
    console.log('\nProblems:');
    problems.slice(0, 100).forEach(problem => {
      const prefix = problem.identifier ? `${problem.index}:${problem.identifier}` : `${problem.index}`;
      console.log(`- [${problem.severity}] ${prefix} ${problem.message}`);
    });
    if (problems.length > 100) console.log(`- ...and ${problems.length - 100} more.`);
  }

  if (errorCount > 0) process.exit(1);
}

main();
