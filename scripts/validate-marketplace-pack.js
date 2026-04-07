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
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--provider') args.provider = argv[++i] || args.provider;
    else if (value === '--system') args.system = argv[++i] || args.system;
    else if (!value.startsWith('--')) positional.push(value);
  }
  if (positional[0]) args.provider = positional[0];
  if (positional[1]) args.system = positional[1];
  return args;
}

function problem(problems, severity, identifier, message) {
  problems.push({ severity, identifier, message });
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
  const root = path.resolve(__dirname, '..');
  const catalogPath = path.join(root, 'assets', 'roms', `roms-${args.system}.json`);
  const packPath = path.join(root, 'assets', 'metadata', args.provider, `${args.system}.json`);
  const catalog = readJson(catalogPath, []);
  const knownIdentifiers = new Set((Array.isArray(catalog) ? catalog : []).map(rom => rom?.name).filter(Boolean));
  const pack = readJson(packPath, { games: {} });
  const games = pack?.games && typeof pack.games === 'object' ? pack.games : {};
  const problems = [];

  for (const [identifier, metadata] of Object.entries(games)) {
    if (!knownIdentifiers.has(identifier)) {
      problem(problems, 'warning', identifier, 'Identifier was not found in the catalog file.');
    }
    if (!metadata || typeof metadata !== 'object') {
      problem(problems, 'error', identifier, 'Metadata entry is not an object.');
      continue;
    }
    if (!String(metadata.title || '').trim()) {
      problem(problems, 'error', identifier, 'Metadata title is missing.');
    }
    if (!String(metadata.description || '').trim()) {
      problem(problems, 'error', identifier, 'Metadata description is missing.');
    }
    if (!Array.isArray(metadata.genres) || !metadata.genres.length) {
      problem(problems, 'warning', identifier, 'Metadata genres are empty.');
    } else if (metadata.genres.some(genre => !String(genre || '').trim())) {
      problem(problems, 'warning', identifier, 'Metadata genres contain blank values.');
    }
    if (!String(metadata.publisher || metadata.developer || '').trim()) {
      problem(problems, 'warning', identifier, 'Metadata publisher/developer are both empty.');
    }
    if (!String(metadata.age_rating || '').trim()) {
      problem(problems, 'warning', identifier, 'Age rating is missing.');
    } else if (!validAgeRating(metadata.age_rating)) {
      problem(problems, 'warning', identifier, `Age rating "${metadata.age_rating}" is not a recognized ESRB shorthand.`);
    }
    if (String(metadata.age_rating || '').trim() && !String(metadata.age_rating_board || '').trim()) {
      problem(problems, 'warning', identifier, 'Age rating board is missing.');
    }
    if (!validReleaseDate(metadata.release_date)) {
      problem(problems, 'warning', identifier, 'Release date should use YYYY, YYYY-MM, or YYYY-MM-DD.');
    }
    if (metadata.players && !String(metadata.players).trim()) {
      problem(problems, 'warning', identifier, 'Players field is blank.');
    }
  }

  const errorCount = problems.filter(item => item.severity === 'error').length;
  const warningCount = problems.filter(item => item.severity === 'warning').length;
  const summary = {
    provider: args.provider,
    system: args.system,
    catalogPath,
    packPath,
    packEntries: Object.keys(games).length,
    errors: errorCount,
    warnings: warningCount,
    ok: errorCount === 0,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (problems.length) {
    console.log('\nProblems:');
    problems.slice(0, 100).forEach(item => {
      console.log(`- [${item.severity}] ${item.identifier} ${item.message}`);
    });
    if (problems.length > 100) console.log(`- ...and ${problems.length - 100} more.`);
  }

  if (errorCount > 0) process.exit(1);
}

main();
