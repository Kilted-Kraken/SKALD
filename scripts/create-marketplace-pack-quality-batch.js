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

function writeText(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data, 'utf8');
}

function parseArgs(argv) {
  const args = {
    provider: 'archiveorg',
    system: 'snes',
    bucket: 'missingAgeRating',
    count: 25,
    offset: 0,
    outPath: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--provider') args.provider = argv[++i] || args.provider;
    else if (value === '--system') args.system = argv[++i] || args.system;
    else if (value === '--bucket') args.bucket = argv[++i] || args.bucket;
    else if (value === '--count') args.count = Math.max(1, Number(argv[++i] || args.count));
    else if (value === '--offset') args.offset = Math.max(0, Number(argv[++i] || args.offset));
    else if (value === '--out') args.outPath = argv[++i] || args.outPath;
  }
  return args;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'quality';
}

function markdownEscape(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

function batchMarkdown(batch) {
  const lines = [
    `# ${batch.provider} ${batch.system} quality batch: ${batch.bucket}`,
    '',
    'Use this as a curation guide. Edit the JSON batch file, not this Markdown file, then run validation before merging.',
    '',
  ];

  for (const [index, entry] of batch.entries.entries()) {
    const metadata = entry.metadata || {};
    lines.push(`## ${index + 1}. ${metadata.title || entry.identifier}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Identifier | ${markdownEscape(entry.identifier)} |`);
    lines.push(`| Title | ${markdownEscape(metadata.title)} |`);
    lines.push(`| Publisher | ${markdownEscape(metadata.publisher)} |`);
    lines.push(`| Developer | ${markdownEscape(metadata.developer)} |`);
    lines.push(`| Genres | ${markdownEscape((metadata.genres || []).join(', '))} |`);
    lines.push(`| Release date | ${markdownEscape(metadata.release_date)} |`);
    lines.push(`| Players | ${markdownEscape(metadata.players)} |`);
    lines.push(`| ESRB | ${markdownEscape(metadata.age_rating)} |`);
    lines.push('');
    lines.push('Description:');
    lines.push('');
    lines.push('```text');
    lines.push(metadata.description || '');
    lines.push('```');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const packPath = path.join(root, 'assets', 'metadata', args.provider, `${args.system}.json`);
  const qualityPath = path.join(root, 'reports', `${args.provider}-${args.system}-pack.quality.json`);
  const pack = readJson(packPath, { games: {} });
  const quality = readJson(qualityPath, { buckets: {} });
  const games = pack?.games && typeof pack.games === 'object' ? pack.games : {};
  const identifiers = Array.isArray(quality?.buckets?.[args.bucket])
    ? quality.buckets[args.bucket]
    : [];
  const slice = identifiers.slice(args.offset, args.offset + args.count);
  const defaultName = `${args.provider}-${args.system}-pack.quality-${slug(args.bucket)}-${args.offset}-${args.offset + args.count - 1}.json`;
  const outPath = args.outPath
    ? path.resolve(process.cwd(), args.outPath)
    : path.join(root, 'reports', defaultName);

  const batch = {
    provider: args.provider,
    system: args.system,
    source: qualityPath,
    generatedAt: new Date().toISOString(),
    bucket: args.bucket,
    offset: args.offset,
    count: slice.length,
    instructions: 'Edit the metadata fields in this JSON file, validate it, then merge with npm run merge:pack.',
    entries: slice.map(identifier => ({
      identifier,
      identifiers: [identifier],
      metadata: {
        ...(games[identifier] || {}),
        metadata_source: 'packaged-metadata',
      },
    })),
  };

  writeJson(outPath, batch);
  writeText(outPath.replace(/\.json$/i, '.md'), batchMarkdown(batch));
  console.log(JSON.stringify({
    provider: args.provider,
    system: args.system,
    bucket: args.bucket,
    outPath,
    markdownPath: outPath.replace(/\.json$/i, '.md'),
    count: batch.entries.length,
    offset: args.offset,
  }, null, 2));
}

main();
