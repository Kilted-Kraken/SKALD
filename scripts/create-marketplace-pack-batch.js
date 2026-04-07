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
    count: 25,
    offset: 0,
    outPath: '',
    search: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--provider') args.provider = argv[++i] || args.provider;
    else if (value === '--system') args.system = argv[++i] || args.system;
    else if (value === '--count') args.count = Math.max(1, Number(argv[++i] || args.count));
    else if (value === '--offset') args.offset = Math.max(0, Number(argv[++i] || args.offset));
    else if (value === '--out') args.outPath = argv[++i] || args.outPath;
    else if (value === '--search') args.search = argv[++i] || args.search;
  }
  return args;
}

function blankMetadata(template = {}) {
  const title = String(template.title || template.suggestedTitle || '').trim();
  return {
    title,
    sort_title: template.sort_title || title,
    publisher: '',
    developer: '',
    genres: [],
    description: '',
    release_date: '',
    players: '',
    age_rating: '',
    age_rating_label: '',
    age_rating_board: 'ESRB',
    metadata_source: 'packaged-metadata',
    match_confidence: 1,
  };
}

function markdownEscape(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'batch';
}

function candidateMatchesSearch(candidate, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    candidate.key,
    candidate.suggestedTitle,
    ...(candidate.identifiers || []),
  ].join('\n').toLowerCase();
  return haystack.includes(needle);
}

function batchMarkdown(batch) {
  const lines = [
    `# ${batch.provider} ${batch.system} metadata batch`,
    '',
    'Use this as a curation guide. Edit the JSON batch file, not this Markdown file, then run validation before merging.',
    '',
  ];

  for (const [index, entry] of batch.entries.entries()) {
    lines.push(`## ${index + 1}. ${entry.suggestedTitle}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Title | ${markdownEscape(entry.metadata.title)} |`);
    lines.push('| Publisher |  |');
    lines.push('| Developer |  |');
    lines.push('| Genres |  |');
    lines.push('| Release date |  |');
    lines.push('| Players |  |');
    lines.push('| ESRB |  |');
    lines.push('');
    lines.push('Description:');
    lines.push('');
    lines.push('```text');
    lines.push('');
    lines.push('```');
    lines.push('');
    lines.push('Archive identifiers:');
    for (const identifier of entry.identifiers || []) {
      lines.push(`- ${identifier}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const candidatesPath = path.join(root, 'reports', `${args.provider}-${args.system}-pack.candidates.json`);

  const source = readJson(candidatesPath, { candidates: [] });
  const candidates = (Array.isArray(source.candidates) ? source.candidates : [])
    .filter(candidate => candidateMatchesSearch(candidate, args.search));
  const slice = candidates.slice(args.offset, args.offset + args.count);
  const defaultName = args.search
    ? `${args.provider}-${args.system}-pack.batch-${slug(args.search)}-${args.offset}-${args.offset + args.count - 1}.json`
    : `${args.provider}-${args.system}-pack.batch-${args.offset}-${args.offset + args.count - 1}.json`;
  const outPath = args.outPath
    ? path.resolve(process.cwd(), args.outPath)
    : path.join(root, 'reports', defaultName);

  const batch = {
    provider: args.provider,
    system: args.system,
    source: candidatesPath,
    generatedAt: new Date().toISOString(),
    offset: args.offset,
    count: slice.length,
    search: args.search,
    instructions: 'Fill metadata.description plus publisher/developer/genres/release/ratings, then merge with npm run merge:pack -- <this file> --provider archiveorg --system snes --dry-run first.',
    entries: slice.map(candidate => ({
      key: candidate.key,
      suggestedTitle: candidate.suggestedTitle,
      variantCount: candidate.variantCount,
      regions: candidate.regions || [],
      tags: candidate.tags || [],
      identifiers: candidate.identifiers || [],
      metadata: blankMetadata({
        title: candidate.suggestedTitle,
        ...(candidate.metadataTemplate || {}),
      }),
    })),
  };

  writeJson(outPath, batch);
  writeText(outPath.replace(/\.json$/i, '.md'), batchMarkdown(batch));
  console.log(JSON.stringify({
    provider: args.provider,
    system: args.system,
    outPath,
    markdownPath: outPath.replace(/\.json$/i, '.md'),
    count: batch.entries.length,
    offset: args.offset,
  }, null, 2));
}

main();
