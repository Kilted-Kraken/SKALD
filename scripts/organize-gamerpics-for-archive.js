#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DEFAULT_TITLE_MAP = path.join(__dirname, '..', 'assets', 'metadata', 'gamerpics', 'title-id-map.json');
const GENERATED_FOLDER_NAMES = new Set([
  'archive ready',
  'archive ready review',
  'xbox360-gamerpics',
  'ps3-avatars',
  'unresolved',
]);

function printUsage() {
  console.log(`
Usage:
  node scripts/organize-gamerpics-for-archive.js --input <folder> --output <folder> [options]

Options:
  --input <folder>       Folder containing raw Xbox 360 gamerpic and/or PS3 avatar images.
  --output <folder>      Archive-ready output folder. Originals are copied, not moved.
  --map <file>           Optional title ID map JSON. Defaults to assets/metadata/gamerpics/title-id-map.json.
  --resolve-online       Try online title lookups for missing Xbox 360/PS3 IDs and save them to the map.
  --review-only          Only write unresolved/title-id-review.json. Does not copy image files.
  --dry-run              Parse and report without copying files.
  --help                 Show this help.

Output:
  xbox360-gamerpics/by-game/<Game>/<TitleID>/*
  ps3-avatars/by-game/<Game>/<TitleID>/*
  unresolved/xbox360/*
  unresolved/ps3/*
  manifest.json files for each system
`);
}

function parseArgs(argv) {
  const args = {
    input: '',
    output: '',
    map: DEFAULT_TITLE_MAP,
    dryRun: false,
    resolveOnline: false,
    reviewOnly: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--resolve-online') {
      args.resolveOnline = true;
      continue;
    }
    if (arg === '--review-only') {
      args.reviewOnly = true;
      continue;
    }
    if (arg === '--input' || arg === '-i') {
      args.input = argv[++i] || '';
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      args.output = argv[++i] || '';
      continue;
    }
    if (arg === '--map' || arg === '-m') {
      args.map = argv[++i] || '';
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function readJson(filePath, fallback) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON file ${filePath}: ${error.message}`);
  }
}

function saveJson(filePath, payload, dryRun) {
  if (dryRun) return;
  ensureDir(path.dirname(filePath), dryRun);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function ensureDir(dirPath, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function walkFiles(root) {
  const out = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const lowerName = entry.name.toLowerCase();
        if (lowerName.startsWith('.tmp-gamerpic-') || GENERATED_FOLDER_NAMES.has(lowerName)) continue;
        stack.push(fullPath);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push(fullPath);
      }
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function sanitizePathPart(value) {
  return String(value || 'Unknown')
    .replace(/[:/\\|]/g, ' - ')
    .replace(/[<>"?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/[. ]+$/g, '')
    .trim() || 'Unknown';
}

function sanitizeFileStem(value) {
  return sanitizePathPart(value).replace(/\s+-\s+/g, ' - ');
}

function uniqueDestination(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const stem = path.basename(filePath, ext);
  let index = 2;
  let next = path.join(dir, `${stem} (${index})${ext}`);
  while (fs.existsSync(next)) {
    index += 1;
    next = path.join(dir, `${stem} (${index})${ext}`);
  }
  return next;
}

function copyFile(source, destination, dryRun) {
  if (dryRun) return destination;
  ensureDir(path.dirname(destination), dryRun);
  const finalDestination = uniqueDestination(destination);
  fs.copyFileSync(source, finalDestination);
  try {
    fs.chmodSync(finalDestination, 0o666);
  } catch {
    // Best effort: copied Xbox/PS assets may carry read-only attributes on Windows.
  }
  return finalDestination;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return null;
}

function readImageDimensions(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return readPngDimensions(buffer) || null;
  } catch {
    return null;
  }
}

function normalizeTitleId(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function normalizeMap(titleMap) {
  const normalized = {
    xbox360: {},
    ps3: {},
  };
  for (const system of ['xbox360', 'ps3']) {
    for (const [key, value] of Object.entries(titleMap?.[system] || {})) {
      const id = normalizeTitleId(key);
      if (id && value) normalized[system][id] = String(value);
    }
  }
  return normalized;
}

function resolveGameTitle(system, titleId, titleMap) {
  const map = titleMap?.[system] || {};
  const normalized = normalizeTitleId(titleId);
  return map[normalized] || map[titleId] || '';
}

function parseXbox360Filename(filename) {
  const match = /^(\d+)_([0-9a-f]{8})([0-9a-f]+)$/i.exec(path.basename(filename, path.extname(filename)));
  if (!match) return null;
  return {
    system: 'xbox360',
    type: 'gamerpic',
    size: Number(match[1]),
    titleId: match[2].toUpperCase(),
    assetId: match[3].toUpperCase(),
  };
}

function parsePs3Filename(filename) {
  const stem = path.basename(filename, path.extname(filename));
  const match = /^([A-Z]{2}\d{4}-([A-Z]{4}\d{5})_00-([A-Z0-9]+))\s+-\s+(PSNA_[0-9A-F]{40})$/i.exec(stem);
  if (!match) return null;
  return {
    system: 'ps3',
    type: 'avatar',
    contentId: match[1].toUpperCase(),
    titleId: match[2].toUpperCase(),
    contentName: match[3].toUpperCase(),
    psnaId: match[4].toUpperCase(),
  };
}

function classifyFile(filePath, titleMap) {
  const filename = path.basename(filePath);
  const xbox = parseXbox360Filename(filename);
  if (xbox) {
    const gameTitle = resolveGameTitle('xbox360', xbox.titleId, titleMap);
    return { ...xbox, gameTitle, confidence: gameTitle ? 'mapped-title-id' : 'unresolved-title-id' };
  }

  const ps3 = parsePs3Filename(filename);
  if (ps3) {
    const gameTitle = resolveGameTitle('ps3', ps3.titleId, titleMap);
    return { ...ps3, gameTitle, confidence: gameTitle ? 'mapped-title-id' : 'unresolved-title-id' };
  }

  return { system: 'unknown', type: 'unknown', gameTitle: '', confidence: 'unrecognized-filename' };
}

function buildDestination(outputRoot, filePath, item) {
  const ext = path.extname(filePath).toLowerCase();
  const originalName = path.basename(filePath);

  if (item.system === 'xbox360') {
    if (!item.gameTitle) {
      return path.join(outputRoot, 'unresolved', 'xbox360', originalName);
    }
    const game = sanitizePathPart(item.gameTitle);
    const stem = sanitizeFileStem(`${item.gameTitle} - ${item.titleId} - ${item.assetId} - ${item.size}`);
    return path.join(outputRoot, 'xbox360-gamerpics', 'by-game', game, item.titleId, `${stem}${ext}`);
  }

  if (item.system === 'ps3') {
    if (!item.gameTitle) {
      return path.join(outputRoot, 'unresolved', 'ps3', originalName);
    }
    const game = sanitizePathPart(item.gameTitle);
    const avatarName = item.contentName || item.psnaId;
    const stem = sanitizeFileStem(`${item.gameTitle} - ${item.titleId} - ${avatarName}`);
    return path.join(outputRoot, 'ps3-avatars', 'by-game', game, item.titleId, `${stem}${ext}`);
  }

  return path.join(outputRoot, 'unresolved', 'unknown', originalName);
}

function manifestEntry(inputRoot, outputRoot, sourcePath, destinationPath, item) {
  const dimensions = readImageDimensions(sourcePath);
  return {
    system: item.system,
    type: item.type,
    gameTitle: item.gameTitle || null,
    titleId: item.titleId || null,
    size: item.size || dimensions?.width || null,
    width: dimensions?.width || null,
    height: dimensions?.height || null,
    assetId: item.assetId || null,
    contentId: item.contentId || null,
    contentName: item.contentName || null,
    psnaId: item.psnaId || null,
    confidence: item.confidence,
    originalFilename: path.basename(sourcePath),
    originalRelativePath: path.relative(inputRoot, sourcePath).replace(/\\/g, '/'),
    archivePath: path.relative(outputRoot, destinationPath).replace(/\\/g, '/'),
  };
}

function writeManifest(filePath, payload, dryRun) {
  if (dryRun) return;
  ensureDir(path.dirname(filePath), dryRun);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function summarizeUnresolved(items) {
  const byId = new Map();
  for (const item of items) {
    const key = `${item.system || 'unknown'}:${item.titleId || 'unknown'}`;
    const existing = byId.get(key) || {
      system: item.system || 'unknown',
      titleId: item.titleId || null,
      count: 0,
      sampleFiles: [],
    };
    existing.count += 1;
    if (existing.sampleFiles.length < 5) existing.sampleFiles.push(item.originalFilename);
    byId.set(key, existing);
  }
  return [...byId.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return String(a.titleId || '').localeCompare(String(b.titleId || ''));
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SKALD Gamerpic Organizer',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseXboxGamerPicsTitles(html) {
  const map = {};
  const titleBlockRegex = /<div id="([0-9a-f]{8})"[\s\S]{0,1400}?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let match = null;
  while ((match = titleBlockRegex.exec(html))) {
    const titleId = normalizeTitleId(match[1]);
    const title = decodeHtmlEntities(match[2]);
    if (titleId && title) map[titleId] = title;
  }
  return map;
}

async function fetchXboxGamerPicsMap(targetIds = []) {
  const map = {};
  const remaining = new Set(targetIds.map(normalizeTitleId).filter(Boolean));
  let emptyPages = 0;
  for (let page = 1; page <= 140; page += 1) {
    const url = `https://xboxgamer.pics/titles/all?page=${page}`;
    try {
      const html = await fetchText(url);
      const pageMap = parseXboxGamerPicsTitles(html);
      const entries = Object.entries(pageMap);
      if (!entries.length) {
        emptyPages += 1;
        if (emptyPages >= 3) break;
        continue;
      }
      emptyPages = 0;
      for (const [titleId, title] of entries) {
        map[titleId] = title;
        remaining.delete(titleId);
      }
      if (remaining.size === 0 && targetIds.length) break;
    } catch (error) {
      console.warn(`XboxGamerPics lookup failed on page ${page}: ${error.message}`);
      break;
    }
  }
  return map;
}

function serialStationUrlForTitleId(titleId) {
  const id = normalizeTitleId(titleId);
  const prefix = id.slice(0, 4);
  const number = id.slice(4);
  if (!prefix || !number) return '';
  return `https://www.serialstation.com/titles/${prefix}/${number}`;
}

function parseSerialStationTitle(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) {
    const title = decodeHtmlEntities(h1).replace(/^[A-Z]{4}-?\d{5}\s*/i, '').trim();
    if (title && !/^[A-Z]{4}-?\d{5}$/i.test(title)) return title;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (titleTag) {
    const title = decodeHtmlEntities(titleTag)
      .replace(/^SerialStation\s*\|\s*/i, '')
      .replace(/^[A-Z]{4}-?\d{5}\s*/i, '')
      .replace(/\s*-\s*SerialStation$/i, '')
      .trim();
    if (title && !/^[A-Z]{4}-?\d{5}$/i.test(title)) return title;
  }
  return '';
}

async function fetchSerialStationTitle(titleId) {
  const url = serialStationUrlForTitleId(titleId);
  if (!url) return '';
  try {
    const html = await fetchText(url);
    return parseSerialStationTitle(html);
  } catch {
    return '';
  }
}

async function resolveMissingIdsOnline(titleMap, unresolvedSummary) {
  const resolved = { xbox360: {}, ps3: {} };
  const unresolvedXboxIds = unresolvedSummary
    .filter(item => item.system === 'xbox360' && item.titleId)
    .map(item => normalizeTitleId(item.titleId))
    .filter(id => !titleMap.xbox360[id]);
  const unresolvedPs3Ids = unresolvedSummary
    .filter(item => item.system === 'ps3' && item.titleId)
    .map(item => normalizeTitleId(item.titleId))
    .filter(id => !titleMap.ps3[id]);

  if (unresolvedXboxIds.length) {
    console.log(`Resolving Xbox 360 IDs from xboxgamer.pics (${unresolvedXboxIds.length} missing IDs)...`);
    const xboxMap = await fetchXboxGamerPicsMap(unresolvedXboxIds);
    for (const id of unresolvedXboxIds) {
      if (xboxMap[id]) resolved.xbox360[id] = xboxMap[id];
    }
  }

  if (unresolvedPs3Ids.length) {
    console.log(`Resolving PS3 IDs from SerialStation (${unresolvedPs3Ids.length} missing IDs)...`);
    const uniquePs3Ids = [...new Set(unresolvedPs3Ids)];
    for (let i = 0; i < uniquePs3Ids.length; i += 1) {
      const id = uniquePs3Ids[i];
      const title = await fetchSerialStationTitle(id);
      if (title) resolved.ps3[id] = title;
      if ((i + 1) % 25 === 0) console.log(`  PS3 lookup ${i + 1}/${uniquePs3Ids.length}`);
    }
  }

  return resolved;
}

function mergeTitleMaps(baseMap, additionMap) {
  const merged = normalizeMap(baseMap);
  for (const system of ['xbox360', 'ps3']) {
    for (const [id, title] of Object.entries(additionMap?.[system] || {})) {
      if (id && title && !merged[system][id]) merged[system][id] = title;
    }
  }
  return merged;
}

function processFiles(files, inputRoot, outputRoot, titleMap, args) {
  const manifests = {
    xbox360: [],
    ps3: [],
    unresolved: [],
  };

  for (const file of files) {
    const item = classifyFile(file, titleMap);
    const destination = buildDestination(outputRoot, file, item);
    const finalDestination = args.reviewOnly
      ? destination
      : copyFile(file, destination, args.dryRun);
    const entry = manifestEntry(inputRoot, outputRoot, file, finalDestination, item);

    if (item.system === 'xbox360' && item.gameTitle) manifests.xbox360.push(entry);
    else if (item.system === 'ps3' && item.gameTitle) manifests.ps3.push(entry);
    else manifests.unresolved.push(entry);
  }

  return manifests;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.input || !args.output) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const inputRoot = path.resolve(args.input);
  const outputRoot = path.resolve(args.output);
  if (!fs.existsSync(inputRoot) || !fs.statSync(inputRoot).isDirectory()) {
    throw new Error(`Input folder does not exist: ${inputRoot}`);
  }

  const mapPath = path.resolve(args.map);
  let titleMap = normalizeMap(readJson(mapPath, { xbox360: {}, ps3: {} }));
  const files = walkFiles(inputRoot)
    .filter(file => !path.resolve(file).toLowerCase().startsWith(outputRoot.toLowerCase()));

  if (args.resolveOnline) {
    const initialManifests = processFiles(files, inputRoot, outputRoot, titleMap, { ...args, dryRun: true, reviewOnly: true });
    const initialSummary = summarizeUnresolved(initialManifests.unresolved);
    const onlineMap = await resolveMissingIdsOnline(titleMap, initialSummary);
    const onlineCount = Object.keys(onlineMap.xbox360).length + Object.keys(onlineMap.ps3).length;
    if (onlineCount) {
      titleMap = mergeTitleMaps(titleMap, onlineMap);
      saveJson(mapPath, titleMap, args.dryRun);
      console.log(`Added ${onlineCount} online title mappings${args.dryRun ? ' (dry-run; map not saved)' : ''}.`);
    } else {
      console.log('No additional online title mappings were found.');
    }
  }

  const manifests = processFiles(files, inputRoot, outputRoot, titleMap, args);
  const generatedAt = new Date().toISOString();
  const xboxManifest = { generatedAt, system: 'xbox360', type: 'gamerpic', total: manifests.xbox360.length, items: manifests.xbox360 };
  const ps3Manifest = { generatedAt, system: 'ps3', type: 'avatar', total: manifests.ps3.length, items: manifests.ps3 };
  const unresolvedManifest = { generatedAt, total: manifests.unresolved.length, items: manifests.unresolved };
  const unresolvedTitleIds = {
    generatedAt,
    totalTitleIds: summarizeUnresolved(manifests.unresolved).length,
    items: summarizeUnresolved(manifests.unresolved),
  };

  if (!args.reviewOnly) {
    writeManifest(path.join(outputRoot, 'xbox360-gamerpics', 'manifest.json'), xboxManifest, args.dryRun);
    writeManifest(path.join(outputRoot, 'ps3-avatars', 'manifest.json'), ps3Manifest, args.dryRun);
  }
  writeManifest(path.join(outputRoot, 'unresolved', 'manifest.json'), unresolvedManifest, args.dryRun);
  writeManifest(path.join(outputRoot, 'unresolved', 'title-id-review.json'), unresolvedTitleIds, args.dryRun);

  console.log(`Scanned: ${files.length}`);
  console.log(`Xbox 360 organized: ${manifests.xbox360.length}`);
  console.log(`PS3 organized: ${manifests.ps3.length}`);
  console.log(`Unresolved: ${manifests.unresolved.length}`);
  const outputMode = args.reviewOnly ? 'Review only; no image files were copied.' : (args.dryRun ? 'Dry run only; no files were copied.' : `Output: ${outputRoot}`);
  console.log(outputMode);

  if (manifests.unresolved.length) {
    console.log('Review unresolved/title-id-review.json and add missing IDs to assets/metadata/gamerpics/title-id-map.json.');
  }
}

try {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
