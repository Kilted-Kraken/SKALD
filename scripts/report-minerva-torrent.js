'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    torrentPath: '',
    write: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--system') args.system = argv[++i] || args.system;
    else if (value === '--torrent') args.torrentPath = argv[++i] || args.torrentPath;
    else if (value === '--write') args.write = true;
  }
  return args;
}

function bdecode(buffer) {
  let index = 0;
  function parse() {
    const char = String.fromCharCode(buffer[index]);
    if (char === 'i') {
      index += 1;
      const end = buffer.indexOf(0x65, index);
      const value = Number(buffer.slice(index, end).toString());
      index = end + 1;
      return value;
    }
    if (char === 'l') {
      index += 1;
      const list = [];
      while (buffer[index] !== 0x65) list.push(parse());
      index += 1;
      return list;
    }
    if (char === 'd') {
      index += 1;
      const object = {};
      while (buffer[index] !== 0x65) {
        const key = parse().toString();
        object[key] = parse();
      }
      index += 1;
      return object;
    }
    if (/\d/.test(char)) {
      const colon = buffer.indexOf(0x3a, index);
      const length = Number(buffer.slice(index, colon).toString());
      index = colon + 1;
      const value = buffer.slice(index, index + length);
      index += length;
      return value;
    }
    throw new Error(`Unexpected bencode token "${char}" at byte ${index}.`);
  }
  return parse();
}

function bencode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(String(value.length) + ':'), value]);
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  if (value && typeof value === 'object') {
    return Buffer.concat([
      Buffer.from('d'),
      ...Object.keys(value).sort().flatMap(key => [bencode(Buffer.from(key)), bencode(value[key])]),
      Buffer.from('e'),
    ]);
  }
  const buffer = Buffer.from(String(value || ''));
  return Buffer.concat([Buffer.from(String(buffer.length) + ':'), buffer]);
}

function baseName(value) {
  return path.basename(String(value || '')).toLowerCase();
}

function torrentFiles(info) {
  if (Array.isArray(info.files)) {
    return info.files.map((file, index) => {
      const parts = Array.isArray(file.path) ? file.path.map(part => part.toString()) : [];
      return {
        index,
        path: parts.join('/'),
        name: parts[parts.length - 1] || '',
        length: Number(file.length || 0),
      };
    });
  }
  return [{
    index: 0,
    path: info.name?.toString() || '',
    name: info.name?.toString() || '',
    length: Number(info.length || 0),
  }];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.torrentPath) {
    console.error('Usage: node scripts/report-minerva-torrent.js --system snes --torrent <file.torrent> [--write]');
    process.exit(1);
  }

  const root = path.resolve(__dirname, '..');
  const torrentPath = path.resolve(process.cwd(), args.torrentPath);
  const catalogPath = path.join(root, 'assets', 'roms', `roms-${args.system}.json`);
  const reportDir = path.join(root, 'reports');
  const torrent = bdecode(fs.readFileSync(torrentPath));
  const info = torrent.info || {};
  const files = torrentFiles(info);
  const filesByBaseName = new Map(files.map(file => [baseName(file.name), file]));
  const catalog = readJson(catalogPath, []);
  const matched = [];
  const missing = [];

  for (const rom of Array.isArray(catalog) ? catalog : []) {
    const identifier = String(rom?.name || '');
    if (!identifier) continue;
    const match = filesByBaseName.get(baseName(identifier));
    if (match) {
      matched.push({
        identifier,
        cleanName: rom?.cleanName || '',
        region: rom?.region || '',
        size: rom?.size || '',
        torrentIndex: match.index,
        torrentPath: match.path,
        torrentLength: match.length,
      });
    } else {
      missing.push({
        identifier,
        cleanName: rom?.cleanName || '',
        region: rom?.region || '',
        size: rom?.size || '',
      });
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.length, 0);
  const infoHash = crypto.createHash('sha1').update(bencode(info)).digest('hex');
  const summary = {
    source: 'minerva',
    system: args.system,
    torrentPath,
    catalogPath,
    torrentName: info.name?.toString() || '',
    infoHash,
    announce: torrent.announce?.toString() || '',
    announceListCount: Array.isArray(torrent['announce-list']) ? torrent['announce-list'].length : 0,
    pieceLength: Number(info['piece length'] || 0),
    torrentFiles: files.length,
    torrentBytes: totalBytes,
    torrentGiB: totalBytes / 1024 / 1024 / 1024,
    catalogEntries: Array.isArray(catalog) ? catalog.length : 0,
    matchedCatalogEntries: matched.length,
    missingCatalogEntries: missing.length,
    sampleMatches: matched.slice(0, 10),
    sampleMissing: missing.slice(0, 20),
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (args.write) {
    writeJson(path.join(reportDir, `minerva-${args.system}-torrent.summary.json`), summary);
    writeJson(path.join(reportDir, `minerva-${args.system}-torrent.matched.json`), matched);
    writeJson(path.join(reportDir, `minerva-${args.system}-torrent.missing.json`), missing);
    console.log(`Wrote Minerva reports to ${reportDir}`);
  }
}

main();
