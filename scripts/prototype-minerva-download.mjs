import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebTorrent from 'webtorrent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const DEFAULT_TARGET = '240p Test Suite (World) (v1.03) (NTSC) (Program) (Aftermarket) (Unl).zip';

function parseArgs(argv) {
  const args = {
    system: 'snes',
    torrentPath: '',
    target: DEFAULT_TARGET,
    outDir: path.join(root, 'reports', 'minerva-download-test'),
    dryRun: false,
    timeoutMs: 120000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--system') args.system = argv[++i] || args.system;
    else if (value === '--torrent') args.torrentPath = argv[++i] || args.torrentPath;
    else if (value === '--target') args.target = argv[++i] || args.target;
    else if (value === '--out') args.outDir = path.resolve(process.cwd(), argv[++i] || args.outDir);
    else if (value === '--timeout-ms') args.timeoutMs = Math.max(10000, Number(argv[++i] || args.timeoutMs));
    else if (value === '--dry-run') args.dryRun = true;
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function baseName(value) {
  return path.basename(String(value || '')).toLowerCase();
}

function findIndexEntry(system, target) {
  const indexPath = path.join(root, 'reports', `minerva-${system}-index.json`);
  const index = readJson(indexPath, { games: {} });
  const targetBase = baseName(target);
  const match = Object.entries(index.games || {}).find(([identifier]) => baseName(identifier) === targetBase);
  if (!match) return null;
  return { identifier: match[0], ...match[1], infoHash: index.infoHash };
}

function addTorrent(client, torrentPath, outDir) {
  return new Promise((resolve, reject) => {
    client.add(torrentPath, { path: outDir }, torrent => resolve(torrent));
    client.on('error', reject);
  });
}

function listDownloadedFiles(outDir) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.push({ path: fullPath, bytes: fs.statSync(fullPath).size });
    }
  }
  walk(outDir);
  return files;
}

function waitForSelectedFile({ torrent, file, outputPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const isComplete = () => fs.existsSync(outputPath) && fs.statSync(outputPath).size === file.length;
    const timer = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      if (isComplete()) {
        clearInterval(timer);
        clearTimeout(timeout);
        resolve();
        return;
      }
      console.log(JSON.stringify({
        progress: Number(torrent.progress || 0),
        selectedFileProgress: Number(file.progress || 0),
        downloaded: torrent.downloaded,
        downloadSpeed: torrent.downloadSpeed,
        numPeers: torrent.numPeers,
        elapsedMs,
      }));
    }, 5000);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (isComplete()) {
      clearInterval(timer);
      clearTimeout(timeout);
      resolve();
      return;
    }
    torrent.once('done', () => {
      clearInterval(timer);
      clearTimeout(timeout);
      resolve();
    });
    torrent.once('error', error => {
      clearInterval(timer);
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.torrentPath) {
    throw new Error('Usage: node scripts/prototype-minerva-download.mjs --torrent <file.torrent> [--target <filename>] [--dry-run]');
  }
  const torrentPath = path.resolve(process.cwd(), args.torrentPath);
  const entry = findIndexEntry(args.system, args.target);
  if (!entry) throw new Error(`Target "${args.target}" was not found in reports/minerva-${args.system}-index.json.`);

  console.log(JSON.stringify({
    system: args.system,
    target: args.target,
    torrentPath,
    outDir: args.outDir,
    torrentIndex: entry.torrentIndex,
    torrentFile: entry.torrentPath,
    torrentLength: entry.torrentLength,
    infoHash: entry.infoHash,
    dryRun: args.dryRun,
  }, null, 2));

  if (args.dryRun) return;

  fs.mkdirSync(args.outDir, { recursive: true });
  const client = new WebTorrent();
  try {
    const torrent = await addTorrent(client, torrentPath, args.outDir);
    for (const file of torrent.files) file.deselect();
    const file = torrent.files[entry.torrentIndex] || torrent.files.find(item => item.path === entry.torrentPath);
    if (!file) throw new Error(`Torrent file index ${entry.torrentIndex} was not found.`);
    file.select();
    console.log(JSON.stringify({ selected: file.path, length: file.length }));
    const outputPath = path.join(args.outDir, file.path);
    await waitForSelectedFile({ torrent, file, outputPath, timeoutMs: args.timeoutMs });
    const downloadedFiles = listDownloadedFiles(args.outDir);
    console.log(JSON.stringify({
      done: true,
      outputPath,
      exists: fs.existsSync(outputPath),
      bytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
      downloadedFiles: downloadedFiles.length,
      extraFiles: downloadedFiles
        .filter(item => item.path !== outputPath)
        .map(item => ({ path: item.path, bytes: item.bytes })),
    }, null, 2));
  } finally {
    await new Promise(resolve => client.destroy(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
