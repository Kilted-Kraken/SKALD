'use strict';

const fs = require('fs');
const path = require('path');

function sanitizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.(zip|7z|chd|iso|bin|cue|sfc|smc)$/i, '')
    .replace(/[\[(][^\])]*[\])]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const positionals = [];
  const flags = new Set();
  for (const value of argv) {
    if (value.startsWith('--')) flags.add(value);
    else positionals.push(value);
  }
  return {
    provider: positionals[0] || 'archiveorg',
    system: positionals[1] || 'snes',
    write: flags.has('--write'),
  };
}

function summarizeVariant(rom) {
  return {
    identifier: rom.name,
    cleanName: rom.cleanName || '',
    region: rom.region || '',
    size: rom.size || '',
    tags: Array.isArray(rom.tags) ? rom.tags : [],
    downloadUrl: rom.downloadUrl || '',
  };
}

function cleanSuggestedTitle(value) {
  return String(value || '')
    .replace(/\s*\((?:\d{4}(?:-\d{2}){0,2}|CES|DEBUG|Switch|Classic Mini|Virtual Console|Level[^)]*|Levels[^)]*|No\.\s*\d+)\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function titleScore(variant) {
  const title = String(variant.cleanName || '').trim();
  const tags = Array.isArray(variant.tags) ? variant.tags : [];
  const region = String(variant.region || '');
  let score = 0;
  score += tags.length * 25;
  if (tags.some(tag => /beta|proto|sample|demo|pirate|hack|alt/i.test(tag))) score += 100;
  if (/\(\d{4}(?:-\d{2}){0,2}\)/.test(title)) score += 40;
  if (/\([^)]*\)/.test(title)) score += 10;
  if (/USA/i.test(region)) score -= 10;
  if (/World|USA, Europe/i.test(region)) score -= 8;
  if (/Japan/i.test(region)) score += 3;
  score += Math.max(0, title.length - 28) / 2;
  return score;
}

function isRetailLikeVariant(variant) {
  const tags = Array.isArray(variant.tags) ? variant.tags : [];
  const title = String(variant.cleanName || '');
  const identifier = String(variant.identifier || '');
  if (tags.some(tag => /beta|proto|sample|demo|pirate|hack|alt|aftermarket|unl/i.test(tag))) return false;
  if (/(Switch|Collection of Mana|Classic Mini|Virtual Console|Capcom Town)/i.test(`${title} ${identifier}`)) return false;
  if (/\(\d{4}(?:-\d{2}){0,2}\)/.test(title)) return false;
  return true;
}

function candidatePriority(candidate) {
  const retailCount = candidate.variants.filter(isRetailLikeVariant).length;
  const hasUsaRetail = candidate.variants.some(variant => isRetailLikeVariant(variant) && /USA|World|USA, Europe/i.test(String(variant.region || '')));
  const tags = Array.isArray(candidate.tags) ? candidate.tags : [...(candidate.tags || [])];
  let score = retailCount * 100;
  if (hasUsaRetail) score += 50;
  score += Math.min(candidate.variantCount, 10);
  if (tags.some(tag => /beta|proto|sample|demo|pirate|hack/i.test(tag))) score -= 20;
  return score;
}

function chooseSuggestedTitle(variants, fallback) {
  const sorted = [...variants]
    .filter(variant => variant?.cleanName)
    .sort((a, b) => {
      const score = titleScore(a) - titleScore(b);
      return score !== 0 ? score : String(a.cleanName).localeCompare(String(b.cleanName));
    });
  const best = sorted[0]?.cleanName || fallback || '';
  return cleanSuggestedTitle(best) || best;
}

function main() {
  const { provider, system, write } = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const catalogPath = path.join(root, 'assets', 'roms', `roms-${system}.json`);
  const packPath = path.join(root, 'assets', 'metadata', provider, `${system}.json`);
  const reportDir = path.join(root, 'reports');
  const outPath = path.join(reportDir, `${provider}-${system}-pack.candidates.json`);

  const catalog = readJson(catalogPath, []);
  const pack = readJson(packPath, { games: {} });
  const packGames = pack && typeof pack.games === 'object' ? pack.games : {};

  const exactIdentifiers = new Set(Object.keys(packGames));
  const packedKeys = new Set();
  for (const [identifier, entry] of Object.entries(packGames)) {
    [identifier, entry?.catalog_identifier, entry?.name, entry?.title, entry?.sort_title]
      .filter(Boolean)
      .map(sanitizeTitle)
      .filter(Boolean)
      .forEach(key => packedKeys.add(key));
  }

  const groups = new Map();
  for (const rom of Array.isArray(catalog) ? catalog : []) {
    if (!rom || typeof rom !== 'object') continue;
    const identifier = String(rom.name || '').trim();
    if (!identifier || exactIdentifiers.has(identifier)) continue;
    const cleanName = String(rom.cleanName || '').trim();
    const titleKey = sanitizeTitle(cleanName || identifier);
    if (!titleKey || packedKeys.has(titleKey)) continue;
    if (!groups.has(titleKey)) {
      groups.set(titleKey, {
        key: titleKey,
        variantCount: 0,
        regions: new Set(),
        tags: new Set(),
        identifiers: [],
        variants: [],
      });
    }
    const group = groups.get(titleKey);
    group.variantCount += 1;
    if (rom.region) group.regions.add(String(rom.region));
    if (Array.isArray(rom.tags)) rom.tags.forEach(tag => tag && group.tags.add(String(tag)));
    group.identifiers.push(identifier);
    group.variants.push(summarizeVariant(rom));
  }

  const candidates = [...groups.values()]
    .map(group => ({
      key: group.key,
      suggestedTitle: chooseSuggestedTitle(group.variants, group.key),
      variantCount: group.variantCount,
      retailVariantCount: group.variants.filter(isRetailLikeVariant).length,
      priorityScore: candidatePriority(group),
      regions: [...group.regions].sort(),
      tags: [...group.tags].sort(),
      identifiers: group.identifiers.sort(),
      variants: group.variants.sort((a, b) => a.identifier.localeCompare(b.identifier)),
      metadataTemplate: {
        title: group.suggestedTitle,
        sort_title: group.suggestedTitle,
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
      },
    }))
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      if (b.retailVariantCount !== a.retailVariantCount) return b.retailVariantCount - a.retailVariantCount;
      if (b.variantCount !== a.variantCount) return b.variantCount - a.variantCount;
      return a.suggestedTitle.localeCompare(b.suggestedTitle);
    });

  const output = {
    provider,
    system,
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    candidates,
  };

  console.log(JSON.stringify({
    provider,
    system,
    totalCandidates: candidates.length,
    topCandidate: candidates[0]?.suggestedTitle || null,
  }, null, 2));

  if (!write) return;

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${outPath}`);
}

main();
