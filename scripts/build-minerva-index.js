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
    system: 'snes',
    outPath: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--system') args.system = argv[++i] || args.system;
    else if (value === '--out') args.outPath = argv[++i] || args.outPath;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const matchedPath = path.join(root, 'reports', `minerva-${args.system}-torrent.matched.json`);
  const summaryPath = path.join(root, 'reports', `minerva-${args.system}-torrent.summary.json`);
  const outPath = args.outPath
    ? path.resolve(process.cwd(), args.outPath)
    : path.join(root, 'reports', `minerva-${args.system}-index.json`);
  const matched = readJson(matchedPath, []);
  const summary = readJson(summaryPath, {});
  const games = {};

  for (const item of Array.isArray(matched) ? matched : []) {
    if (!item?.identifier) continue;
    games[item.identifier] = {
      torrentIndex: item.torrentIndex,
      torrentPath: item.torrentPath,
      torrentLength: item.torrentLength,
    };
  }

  const index = {
    source: 'minerva',
    system: args.system,
    torrentName: summary.torrentName || '',
    infoHash: summary.infoHash || '',
    pieceLength: summary.pieceLength || 0,
    generatedAt: new Date().toISOString(),
    games,
  };

  writeJson(outPath, index);
  console.log(JSON.stringify({
    system: args.system,
    outPath,
    entries: Object.keys(games).length,
    infoHash: index.infoHash,
  }, null, 2));
}

main();
