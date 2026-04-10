#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
let sharp = null;
try { sharp = require('sharp'); } catch {}

const repoRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(repoRoot, 'package.json'));
const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
const userData = path.join(appData, pkg.name);
const settingsPath = path.join(userData, 'settings.json');
const DEFAULT_METADATA_SERVICE_URL = 'https://skald-metadata-worker.uberbeau.workers.dev';

const system = String(process.argv[2] || '').trim().toLowerCase();
const limit = Math.max(0, Number(process.argv[3] || 0) || 0);

if (!system) {
  console.error('Usage: node scripts/export-system-harvest.js <system> [limit]');
  process.exit(1);
}

const romCachePath = path.join(userData, 'romcache', `${system}.json`);
const repoMetadataDir = path.join(repoRoot, 'assets', 'metadata', system);
const harvestDir = path.join(repoMetadataDir, 'harvest');
const localXmlDir = path.join(repoMetadataDir, 'xml');
const localIconsDir = path.join(repoMetadataDir, 'icons');
const localCoversDir = path.join(repoMetadataDir, 'covers');
const localMarqueesDir = path.join(repoMetadataDir, 'marquees');
const localScreenshotsDir = path.join(repoMetadataDir, 'screenshots');
const userArtDir = path.join(userData, 'art');
const sgdbDir = path.join(userArtDir, 'providers', 'steamgriddb');
const screenshotsCacheDir = path.join(userArtDir, 'screenshots');

const harvestIconsDir = path.join(harvestDir, 'icons');
const harvestCoversDir = path.join(harvestDir, 'covers');
const harvestMarqueesDir = path.join(harvestDir, 'marquees');
const harvestScreenshotsDir = path.join(harvestDir, 'screenshots');
const harvestXmlDir = path.join(harvestDir, 'xml');

for (const dir of [harvestDir, harvestIconsDir, harvestCoversDir, harvestMarqueesDir, harvestScreenshotsDir, harvestXmlDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeStem(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '') || 'Unknown Game';
}

function sanitizeTitle(value) {
  return String(value || '')
    .replace(/\.(zip|7z|rar|chd|iso|cso|cue|bin|img|pbp)$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(disc|disk|track|rev|beta|proto|prototype|demo)\b[^-]*$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeScanName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.(xml|webp|png|jpg|jpeg|zip|7z|rar|chd|iso|cso|cue|bin|img|pbp)$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildGameSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'game';
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!parsed.metadataService || typeof parsed.metadataService !== 'object') {
      parsed.metadataService = {};
    }
    return parsed;
  } catch {
    return { metadataService: {} };
  }
}

function getMetadataServiceSettings(settings = loadSettings()) {
  const cfg = settings?.metadataService || {};
  return {
    enabled: cfg.enabled !== false,
    baseUrl: String(cfg.baseUrl || DEFAULT_METADATA_SERVICE_URL).trim().replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || '').trim(),
    timeoutMs: Number(cfg.timeoutMs || 12000) || 12000,
  };
}

function requestJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    try {
      const req = https.request(url, { method, headers, timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, data: json, status: res.statusCode });
          } else {
            resolve({
              ok: false,
              status: res.statusCode || 0,
              error: json?.error || json?.message || `HTTP ${res.statusCode || 0}`,
              data: json,
            });
          }
        });
      });
      req.on('timeout', () => {
        req.destroy(new Error('Request timed out'));
      });
      req.on('error', (error) => resolve({ ok: false, error: error.message || String(error), status: 0 }));
      if (body) req.write(body);
      req.end();
    } catch (error) {
      resolve({ ok: false, error: error.message || String(error), status: 0 });
    }
  });
}

function normalizeProviderArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function normalizeWorkerMetadata(data = {}, context = {}) {
  const metadata = data.metadata || {};
  const art = data.art || {};
  return {
    title: data.title || metadata.title || context.title || null,
    description: metadata.description || data.description || null,
    genres: normalizeProviderArray(metadata.genres || data.genres),
    developer: metadata.developer || data.developer || null,
    publisher: metadata.publisher || data.publisher || null,
    release_date: metadata.release_date || data.release_date || null,
    players: metadata.players || data.players || null,
    rating: metadata.rating || data.rating || null,
    age_rating: metadata.age_rating || data.age_rating || null,
    age_rating_label: metadata.age_rating_label || data.age_rating_label || null,
    age_rating_board: metadata.age_rating_board || data.age_rating_board || null,
    metadata_source: data.metadata_source || 'cloudflare-worker',
    _art: {
      icon: art.icon_path || art.icon_url || null,
      cover: art.cover_path || art.cover_url || null,
      marquee: art.logo_path || art.logo_url || null,
      screenshots: normalizeProviderArray(art.screenshot_paths || art.screenshot_urls || art.screenshots),
    },
  };
}

async function fetchOnlineMetadata({ identifier, title, system, provider, catalogIdentifier }) {
  const cfg = getMetadataServiceSettings();
  if (!cfg.enabled || !cfg.baseUrl) return null;
  const body = JSON.stringify({
    identifier,
    title,
    system,
    provider: provider || null,
    catalog_identifier: catalogIdentifier || null,
  });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const response = await requestJson(`${cfg.baseUrl}/metadata/game`, {
    method: 'POST',
    headers,
    body,
    timeoutMs: cfg.timeoutMs,
  });
  if (!response.ok || !response.data) return null;
  return normalizeWorkerMetadata(response.data, { title, system, provider, catalogIdentifier });
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseSimpleGameXmlMetadata(xmlText = '', title = '') {
  const readTag = (tag) => {
    const match = String(xmlText).match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match?.[1] ? String(match[1]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : '';
  };
  const genreText = readTag('genre');
  return {
    title: readTag('name') || title || null,
    description: readTag('desc') || null,
    genres: genreText ? genreText.split(',').map(v => String(v || '').trim()).filter(Boolean) : [],
    developer: readTag('developer') || null,
    publisher: readTag('publisher') || null,
    release_date: readTag('releasedate') || null,
    players: readTag('players') || null,
    rating: readTag('rating') || null,
    metadata_source: 'local-xml',
  };
}

function loadIndex(dir, multiple = false) {
  if (!fs.existsSync(dir)) return Object.create(null);
  const out = Object.create(null);
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(xml|webp|png|jpg|jpeg)$/i.test(name)) continue;
    const stem = name.replace(/\.[^.]+$/i, '');
    const keys = [...new Set([
      normalizeScanName(stem),
      normalizeScanName(sanitizeTitle(stem)),
    ].filter(Boolean))];
    for (const key of keys) {
      if (!key) continue;
      if (multiple) {
        if (!Array.isArray(out[key])) out[key] = [];
        out[key].push(name);
      } else if (!out[key]) {
        out[key] = name;
      }
    }
  }
  if (multiple) {
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }
  }
  return out;
}

function copyIfPresent(sourcePath, destDir, destName) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  const ext = path.extname(sourcePath) || '.webp';
  const destPath = path.join(destDir, `${safeStem(destName)}${ext.toLowerCase()}`);
  if (!fs.existsSync(destPath)) fs.copyFileSync(sourcePath, destPath);
  return path.relative(harvestDir, destPath).replace(/\\/g, '/');
}

function copyMany(sourcePaths, destDir, destName) {
  return sourcePaths.map((sourcePath, idx) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const ext = path.extname(sourcePath) || '.webp';
    const destPath = path.join(destDir, `${safeStem(destName)}-${String(idx + 1).padStart(2, '0')}${ext.toLowerCase()}`);
    if (!fs.existsSync(destPath)) fs.copyFileSync(sourcePath, destPath);
    return path.relative(harvestDir, destPath).replace(/\\/g, '/');
  }).filter(Boolean);
}

function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    const doGet = (target, hops) => {
      if (hops > 5) return resolve(false);
      https.get(target, { headers: { 'User-Agent': 'SKALD-Harvest/0.1' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return doGet(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(false);
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(true)));
        file.on('error', () => {
          try { fs.unlinkSync(destPath); } catch {}
          resolve(false);
        });
      }).on('error', () => resolve(false));
    };
    doGet(url, 0);
  });
}

async function maybeConvertToWebp(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return sourcePath;
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.webp' || !sharp) return sourcePath;
  const webpPath = sourcePath.replace(/\.[^.]+$/, '.webp');
  try {
    await sharp(sourcePath).webp({ quality: 82 }).toFile(webpPath);
    if (fs.existsSync(webpPath) && fs.statSync(webpPath).size > 256) {
      try { fs.unlinkSync(sourcePath); } catch {}
      return webpPath;
    }
  } catch {}
  return sourcePath;
}

async function downloadHarvestAsset(url, destDir, destName, index = null) {
  if (!url) return null;
  let ext = '.png';
  try {
    ext = path.extname(new URL(url).pathname || '').toLowerCase() || '.png';
  } catch {}
  const suffix = Number.isFinite(index) ? `-${String(index + 1).padStart(2, '0')}` : '';
  const basePath = path.join(destDir, `${safeStem(destName)}${suffix}${ext}`);
  const existingWebp = basePath.replace(/\.[^.]+$/, '.webp');
  if (fs.existsSync(existingWebp)) return path.relative(harvestDir, existingWebp).replace(/\\/g, '/');
  if (fs.existsSync(basePath)) return path.relative(harvestDir, basePath).replace(/\\/g, '/');
  const ok = await downloadFile(url, basePath);
  if (!ok) return null;
  const finalPath = await maybeConvertToWebp(basePath);
  return path.relative(harvestDir, finalPath).replace(/\\/g, '/');
}

function buildGameXml(variant, metadata, fallbackTitle) {
  const romName = String(variant?.name || '').replace(/\.[^.]+$/i, '');
  const title = metadata?.title || fallbackTitle || variant?.cleanName || romName || 'Unknown Game';
  const rating = metadata?.rating || '';
  const ratingEsrb = metadata?.rating_esrb || '';
  const ratingAcb = metadata?.rating_acb || '';
  const ratingCero = metadata?.rating_cero || '';
  const ratingPegi = metadata?.rating_pegi || '';
  const ratingUsk = metadata?.rating_usk || '';
  const description = metadata?.description || '';
  const releaseDate = metadata?.release_date || '';
  const developer = metadata?.developer || '';
  const publisher = metadata?.publisher || '';
  const genre = Array.isArray(metadata?.genres) ? metadata.genres.join(', ') : (metadata?.genres || '');
  const players = metadata?.players || '';
  return `<game romname="${escapeXml(romName)}">\n`
    + `  <name>${escapeXml(title)}</name>\n`
    + `  <rating>${escapeXml(rating)}</rating>\n`
    + `  <rating_esrb>${escapeXml(ratingEsrb)}</rating_esrb>\n`
    + `  <rating_acb>${escapeXml(ratingAcb)}</rating_acb>\n`
    + `  <rating_cero>${escapeXml(ratingCero)}</rating_cero>\n`
    + `  <rating_pegi>${escapeXml(ratingPegi)}</rating_pegi>\n`
    + `  <rating_usk>${escapeXml(ratingUsk)}</rating_usk>\n`
    + `  <desc>${escapeXml(description)}</desc>\n`
    + `  <releasedate>${escapeXml(releaseDate)}</releasedate>\n`
    + `  <developer>${escapeXml(developer)}</developer>\n`
    + `  <publisher>${escapeXml(publisher)}</publisher>\n`
    + `  <genre>${escapeXml(genre)}</genre>\n`
    + `  <players>${escapeXml(players)}</players>\n`
    + `</game>\n`;
}

async function main() {
  if (!fs.existsSync(romCachePath)) {
    console.error(`ROM cache not found: ${romCachePath}`);
    process.exit(1);
  }

  const roms = JSON.parse(fs.readFileSync(romCachePath, 'utf8'));
  const xmlIndex = loadIndex(localXmlDir);
  const iconsIndex = loadIndex(localIconsDir);
  const coversIndex = loadIndex(localCoversDir);
  const marqueesIndex = loadIndex(localMarqueesDir);
  const screenshotsIndex = loadIndex(localScreenshotsDir, true);

  const sourceRoms = limit > 0 ? roms.slice(0, limit) : roms.slice();
  const groups = new Map();

  for (const rom of sourceRoms) {
    const title = String(rom.cleanName || sanitizeTitle(rom.name) || rom.name || 'Unknown Game').trim() || 'Unknown Game';
    const key = normalizeScanName(title);
    let group = groups.get(key);
    if (!group) {
      const slug = buildGameSlug(title);
      const stem = safeStem(title);
      const localXmlName = xmlIndex[key];
      let metadata = null;
      let remoteArt = { icon: null, cover: null, marquee: null, screenshots: [] };
      if (localXmlName) {
        const xmlPath = path.join(localXmlDir, localXmlName);
        metadata = parseSimpleGameXmlMetadata(fs.readFileSync(xmlPath, 'utf8'), title);
      } else {
        metadata = await fetchOnlineMetadata({
          identifier: `harvest::${system}::${title}`,
          title,
          system,
          provider: rom.provider || 'archiveorg',
          catalogIdentifier: rom.name || null,
        });
        remoteArt = metadata?._art || remoteArt;
      }
      if (metadata && metadata._art) {
        delete metadata._art;
      }

      const iconSource = iconsIndex[key] ? path.join(localIconsDir, iconsIndex[key]) : path.join(sgdbDir, `${system}_icon_${slug}.webp`);
      const coverSource = coversIndex[key] ? path.join(localCoversDir, coversIndex[key]) : path.join(sgdbDir, `${system}_grid_${slug}.webp`);
      const marqueeSource = marqueesIndex[key] ? path.join(localMarqueesDir, marqueesIndex[key]) : path.join(sgdbDir, `${system}_logo_${slug}.webp`);
      const screenshotSources = Array.isArray(screenshotsIndex[key]) && screenshotsIndex[key].length
        ? screenshotsIndex[key].map(name => path.join(localScreenshotsDir, name))
        : (fs.existsSync(screenshotsCacheDir)
            ? fs.readdirSync(screenshotsCacheDir)
                .filter(name => name.startsWith(`${system}_${slug}_shot_`))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                .map(name => path.join(screenshotsCacheDir, name))
            : []);

      let iconPath = copyIfPresent(iconSource, harvestIconsDir, stem);
      let coverPath = copyIfPresent(coverSource, harvestCoversDir, stem);
      let marqueePath = copyIfPresent(marqueeSource, harvestMarqueesDir, stem);
      let screenshotPaths = copyMany(screenshotSources, harvestScreenshotsDir, stem);

      if (!iconPath && remoteArt.icon) iconPath = await downloadHarvestAsset(remoteArt.icon, harvestIconsDir, stem);
      if (!coverPath && remoteArt.cover) coverPath = await downloadHarvestAsset(remoteArt.cover, harvestCoversDir, stem);
      if (!marqueePath && remoteArt.marquee) marqueePath = await downloadHarvestAsset(remoteArt.marquee, harvestMarqueesDir, stem);
      if (!screenshotPaths.length && Array.isArray(remoteArt.screenshots) && remoteArt.screenshots.length) {
        screenshotPaths = [];
        for (let i = 0; i < remoteArt.screenshots.length; i += 1) {
          const downloaded = await downloadHarvestAsset(remoteArt.screenshots[i], harvestScreenshotsDir, stem, i);
          if (downloaded) screenshotPaths.push(downloaded);
        }
      }

      group = {
        title,
        sort_title: sanitizeTitle(title),
        system,
        provider: rom.provider || 'archiveorg',
        metadata,
        art: {
          icon: iconPath,
          cover: coverPath,
          marquee: marqueePath,
          screenshots: screenshotPaths,
        },
        variants: [],
      };
      groups.set(key, group);
    }

    group.variants.push({
      name: rom.name || null,
      cleanName: rom.cleanName || null,
      region: rom.region || null,
      tags: Array.isArray(rom.tags) ? rom.tags : [],
      size: rom.size || null,
      sizeBytes: rom.sizeBytes ?? null,
      timestamp: rom.timestamp || null,
      downloadUrl: rom.downloadUrl || null,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    system,
    totalSourceEntries: sourceRoms.length,
    totalGroupedTitles: groups.size,
    items: [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
  };

  for (const item of manifest.items) {
    if (!item?.metadata) continue;
    for (const variant of item.variants || []) {
      const variantFileName = `${safeStem(String(variant?.name || '').replace(/\.[^.]+$/i, ''))}.xml`;
      const variantXmlPath = path.join(harvestXmlDir, variantFileName);
      fs.writeFileSync(variantXmlPath, buildGameXml(variant, item.metadata, item.title), 'utf8');
    }
  }

  const manifestPath = path.join(harvestDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    system,
    manifestPath,
    harvestDir,
    totalSourceEntries: manifest.totalSourceEntries,
    totalGroupedTitles: manifest.totalGroupedTitles,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
