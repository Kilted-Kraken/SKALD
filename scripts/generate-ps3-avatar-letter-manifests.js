#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function printUsage() {
  console.log(`
Usage:
  node scripts/generate-ps3-avatar-letter-manifests.js --root <by-letter-folder>

Example:
  node scripts/generate-ps3-avatar-letter-manifests.js --root "C:\\Projects\\RG-THEMES\\Archive Ready\\ps3-avatars\\by-letter"

Creates:
  by-letter/A/manifest.json
  by-letter/B/manifest.json
  ...
`);
}

function parseArgs(argv) {
  const args = { root: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--root' || arg === '-r') {
      args.root = argv[++i] || '';
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function toArchivePath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function readPngDimensions(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 24) return null;
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buffer.subarray(0, 8).equals(signature)) return null;
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return null;
  }
}

function parsePs3AvatarFilename(fileName) {
  const stem = path.basename(fileName, path.extname(fileName));
  const match = /^([A-Z]{2}\d{4}-([A-Z0-9]{4,5}\d{5})_00-([A-Z0-9]+))\s+-\s+(PSNA_[0-9A-F]{40})$/i.exec(stem);
  if (!match) {
    return {
      contentId: '',
      titleId: '',
      contentName: stem,
      psnaId: '',
    };
  }
  return {
    contentId: match[1].toUpperCase(),
    titleId: match[2].toUpperCase(),
    contentName: match[3].toUpperCase(),
    psnaId: match[4].toUpperCase(),
  };
}

function collectLetterItems(letterDir, bucket) {
  const items = [];
  const titleDirs = fs.readdirSync(letterDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  for (const titleEntry of titleDirs) {
    const titleFolder = path.join(letterDir, titleEntry.name);
    const title = decodeHtmlEntities(titleEntry.name);
    const idDirs = fs.readdirSync(titleFolder, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (const idEntry of idDirs) {
      const idFolder = path.join(titleFolder, idEntry.name);
      const files = fs.readdirSync(idFolder, { withFileTypes: true })
        .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

      for (const fileEntry of files) {
        const filePath = path.join(idFolder, fileEntry.name);
        const parsed = parsePs3AvatarFilename(fileEntry.name);
        const dimensions = readPngDimensions(filePath);
        const relativePath = toArchivePath(letterDir, filePath);
        items.push({
          title,
          folderTitle: titleEntry.name,
          titleId: parsed.titleId || idEntry.name,
          folderTitleId: idEntry.name,
          contentId: parsed.contentId,
          contentName: parsed.contentName,
          psnaId: parsed.psnaId,
          fileName: fileEntry.name,
          width: dimensions?.width || null,
          height: dimensions?.height || null,
          relativePath,
          archivePath: `by-letter/${bucket}/${relativePath}`,
        });
      }
    }
  }

  return items;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.root) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const byLetterRoot = path.resolve(args.root);
  if (!fs.existsSync(byLetterRoot) || !fs.statSync(byLetterRoot).isDirectory()) {
    throw new Error(`Folder not found: ${byLetterRoot}`);
  }

  const generatedAt = new Date().toISOString();
  const letterDirs = fs.readdirSync(byLetterRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const summary = [];
  for (const letterEntry of letterDirs) {
    const letterDir = path.join(byLetterRoot, letterEntry.name);
    const items = collectLetterItems(letterDir, letterEntry.name);
    const titles = new Set(items.map(item => `${item.title}::${item.folderTitleId}`));
    const manifest = {
      generatedAt,
      system: 'ps3',
      type: 'avatar',
      bucket: letterEntry.name,
      root: `by-letter/${letterEntry.name}`,
      totalImages: items.length,
      totalTitleGroups: titles.size,
      items,
    };
    fs.writeFileSync(path.join(letterDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    summary.push({ bucket: letterEntry.name, totalImages: items.length, totalTitleGroups: titles.size });
  }

  console.log(`Wrote ${summary.length} letter manifest(s).`);
  for (const row of summary) {
    console.log(`${row.bucket}: ${row.totalImages} image(s), ${row.totalTitleGroups} title group(s)`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
