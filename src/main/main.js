'use strict';
/**
 * RohanKar Launcher — main.js
 * Session 5: Auto-updater added (electron-updater + GitHub releases).
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');
const extractZip = require('extract-zip');
const stoat = require('./stoat');
let sharp = null;
try { sharp = require('sharp'); } catch {}

// Force consistent userData in dev — Electron uses 'Electron' as app name in dev,
// giving a different folder from production and breaking saved settings/credentials.
if (!app.isPackaged) {
  const pkg = require('../../package.json');
  app.setPath('userData', path.join(app.getPath('appData'), pkg.name));
  console.log('[userData] dev path:', app.getPath('userData'));
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const USER_DATA         = app.getPath('userData');
const DEFAULT_GAMES_DIR = path.join(USER_DATA, 'games');
const LEGACY_DB_PATH    = path.join(USER_DATA, 'library.json');
const SETTINGS_PATH     = path.join(USER_DATA, 'settings.json');
const LIBRARY_DATA_DIR  = path.join(USER_DATA, 'library');
const ART_ROOT_DIR      = path.join(USER_DATA, 'art');
const ART_COVERS_DIR    = path.join(ART_ROOT_DIR, 'covers');
const ART_LOGOS_DIR     = path.join(ART_ROOT_DIR, 'logos');
const ART_ICONS_DIR     = path.join(ART_ROOT_DIR, 'icons');
const ART_BACKGROUNDS_DIR = path.join(ART_ROOT_DIR, 'backgrounds');
const ART_SCREENSHOTS_DIR = path.join(ART_ROOT_DIR, 'screenshots');
const ART_ACHIEVEMENTS_DIR = path.join(ART_ROOT_DIR, 'achievements');
const ART_PROVIDERS_DIR = path.join(ART_ROOT_DIR, 'providers');
const ART_PROVIDER_IGDB_DIR = path.join(ART_PROVIDERS_DIR, 'igdb');
const ART_PROVIDER_SGDB_DIR = path.join(ART_PROVIDERS_DIR, 'steamgriddb');
const ART_PROVIDER_RA_DIR   = path.join(ART_PROVIDERS_DIR, 'retroachievements');
const ART_PROVIDER_ARCHIVE_DIR = path.join(ART_PROVIDERS_DIR, 'archiveorg');
const THUMB_CACHE_DIR   = path.join(ART_PROVIDER_ARCHIVE_DIR, 'thumbs');
const SGDB_CACHE_DIR    = ART_PROVIDER_SGDB_DIR;
const MARKETPLACE_DIR   = path.join(USER_DATA, 'marketplace');
const MARKETPLACE_THEMES_DIR = path.join(MARKETPLACE_DIR, 'themes', 'xbox360');
const MARKETPLACE_METADATA_CACHE = Object.create(null);

[
  DEFAULT_GAMES_DIR,
  LIBRARY_DATA_DIR,
  ART_ROOT_DIR,
  ART_COVERS_DIR,
  ART_LOGOS_DIR,
  ART_ICONS_DIR,
  ART_BACKGROUNDS_DIR,
  ART_SCREENSHOTS_DIR,
  ART_ACHIEVEMENTS_DIR,
  ART_PROVIDERS_DIR,
  ART_PROVIDER_IGDB_DIR,
  ART_PROVIDER_SGDB_DIR,
  ART_PROVIDER_RA_DIR,
  ART_PROVIDER_ARCHIVE_DIR,
  THUMB_CACHE_DIR,
  SGDB_CACHE_DIR,
  MARKETPLACE_DIR,
  MARKETPLACE_THEMES_DIR,
].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const LEGACY_SGDB_CACHE_DIR = path.join(USER_DATA, 'artcache');
if (fs.existsSync(LEGACY_SGDB_CACHE_DIR) && !fs.readdirSync(SGDB_CACHE_DIR).length) {
  try {
    for (const file of fs.readdirSync(LEGACY_SGDB_CACHE_DIR)) {
      const from = path.join(LEGACY_SGDB_CACHE_DIR, file);
      const to   = path.join(SGDB_CACHE_DIR, file);
      if (fs.statSync(from).isFile() && !fs.existsSync(to)) fs.copyFileSync(from, to);
    }
  } catch (e) {
    console.warn('[art-migrate] Could not copy legacy SteamGridDB cache:', e.message);
  }
}

// ─── SQLite ───────────────────────────────────────────────────────────────────

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(USER_DATA, 'library.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      identifier  TEXT PRIMARY KEY,
      install_dir TEXT,
      exe_path    TEXT,
      category    TEXT,
      playtime_secs INTEGER DEFAULT 0,
      added_at    INTEGER
    );
  `);

  // Migrate: add any columns missing from older DB versions
  // Collections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT UNIQUE NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS collection_games (
      collection_id INTEGER NOT NULL,
      identifier    TEXT NOT NULL,
      PRIMARY KEY (collection_id, identifier)
    );
  `);

  // Migrate collections table — add color column if missing
  const collectionCols = db.prepare('PRAGMA table_info(collections)').all().map(r => r.name);
  if (!collectionCols.includes('color')) {
    db.exec('ALTER TABLE collections ADD COLUMN color TEXT');
    console.log('DB migration: added column collections.color');
  }

  const existingCols = db.prepare('PRAGMA table_info(games)').all().map(r => r.name);
  const needed = {
      install_dir:   'TEXT',
      exe_path:      'TEXT',
      category:      'TEXT',
      playtime_secs: 'INTEGER DEFAULT 0',
      added_at:      'INTEGER',
      is_favorite:   'INTEGER DEFAULT 0',
      notes:         'TEXT',
      title:         'TEXT',
      system:        'TEXT',
      source_type:   'TEXT',
      provider:      'TEXT',
      catalog_identifier: 'TEXT',
      match_confidence: 'REAL',
      sort_title:    'TEXT',
      metadata_status: 'TEXT',
      metadata_source: 'TEXT',
      description:   'TEXT',
      genres:        'TEXT',
      developer:     'TEXT',
      publisher:     'TEXT',
      release_date:  'TEXT',
      players:       'TEXT',
      rating:        'TEXT',
      platform_name: 'TEXT',
      igdb_id:       'TEXT',
      thegamesdb_id: 'TEXT',
      retroachievements_game_id: 'TEXT',
      cover_path:    'TEXT',
      logo_path:     'TEXT',
      icon_path:     'TEXT',
      background_path: 'TEXT',
      screenshot_paths: 'TEXT',
      has_ra:        'INTEGER DEFAULT 0',
      ra_console_id: 'TEXT',
      ra_game_id:    'TEXT',
      ra_badge_path: 'TEXT',
      ra_total_achievements: 'INTEGER',
      ra_total_points: 'INTEGER',
      ra_last_sync:  'INTEGER',
      achievements_unlocked: 'INTEGER DEFAULT 0',
      achievement_points_earned: 'INTEGER DEFAULT 0',
      play_count:    'INTEGER DEFAULT 0',
      play_time_minutes: 'INTEGER DEFAULT 0',
      last_played:   'INTEGER',
      last_metadata_refresh: 'INTEGER',
      date_modified: 'INTEGER',
    };
  for (const [col, type] of Object.entries(needed)) {
    if (!existingCols.includes(col)) {
      db.exec(`ALTER TABLE games ADD COLUMN ${col} ${type}`);
      console.log(`DB migration: added column games.${col}`);
    }
  }
} catch (e) {
  console.error('SQLite init failed:', e.message);
  db = null;
}

// ─── Migrate legacy library.json → SQLite ────────────────────────────────────

if (db && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8'));
    const insert = db.prepare(`
      INSERT OR IGNORE INTO games (identifier, install_dir, exe_path, category, playtime_secs, added_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const migrate = db.transaction(() => {
      for (const [id, g] of Object.entries(legacy)) {
        insert.run(id, g.installDir || null, g.exePath || null, g.category || null, g.playtimeSecs || 0, Date.now());
      }
    });
    migrate();
    fs.renameSync(LEGACY_DB_PATH, LEGACY_DB_PATH + '.migrated');
    console.log('Migrated library.json to SQLite');
  } catch (e) {
    console.error('Migration error:', e.message);
  }
}

function ensureGameRow(identifier) {
  if (!db || !identifier) return;
  db.prepare(`
    INSERT OR IGNORE INTO games (identifier, added_at, date_modified)
    VALUES (?, ?, ?)
  `).run(identifier, Date.now(), Date.now());
}

function toJsonText(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function fromJsonText(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function hydrateGameRow(row) {
  if (!row) return null;
  return {
    ...row,
    has_ra: !!row.has_ra,
    genres: fromJsonText(row.genres, row.genres || null),
    screenshot_paths: fromJsonText(row.screenshot_paths, []),
  };
}

function upsertGameEnrichment(identifier, payload = {}) {
  if (!db || !identifier) return null;
  ensureGameRow(identifier);
  const now = Date.now();
  const normalized = {
    title: payload.title ?? null,
    sort_title: payload.sort_title ?? null,
    system: payload.system ?? null,
    provider: payload.provider ?? null,
    catalog_identifier: payload.catalog_identifier ?? null,
    match_confidence: payload.match_confidence ?? null,
    metadata_status: payload.metadata_status ?? null,
    metadata_source: payload.metadata_source ?? null,
    description: payload.description ?? null,
    genres: toJsonText(payload.genres),
    developer: payload.developer ?? null,
    publisher: payload.publisher ?? null,
    release_date: payload.release_date ?? null,
    players: payload.players ?? null,
    rating: payload.rating ?? null,
    platform_name: payload.platform_name ?? null,
    igdb_id: payload.igdb_id ?? null,
    thegamesdb_id: payload.thegamesdb_id ?? null,
    retroachievements_game_id: payload.retroachievements_game_id ?? null,
    cover_path: payload.cover_path ?? null,
    logo_path: payload.logo_path ?? null,
    icon_path: payload.icon_path ?? null,
    background_path: payload.background_path ?? null,
    screenshot_paths: toJsonText(payload.screenshot_paths),
    has_ra: payload.has_ra == null ? null : (payload.has_ra ? 1 : 0),
    ra_console_id: payload.ra_console_id ?? null,
    ra_game_id: payload.ra_game_id ?? null,
    ra_badge_path: payload.ra_badge_path ?? null,
    ra_total_achievements: payload.ra_total_achievements ?? null,
    ra_total_points: payload.ra_total_points ?? null,
    ra_last_sync: payload.ra_last_sync ?? null,
    achievements_unlocked: payload.achievements_unlocked ?? null,
    achievement_points_earned: payload.achievement_points_earned ?? null,
    last_metadata_refresh: payload.last_metadata_refresh ?? now,
    date_modified: now,
  };
  db.prepare(`
    UPDATE games
    SET title = COALESCE(?, title),
        sort_title = COALESCE(?, sort_title),
        system = COALESCE(?, system),
        provider = COALESCE(?, provider),
        catalog_identifier = COALESCE(?, catalog_identifier),
        match_confidence = COALESCE(?, match_confidence),
        metadata_status = COALESCE(?, metadata_status),
        metadata_source = COALESCE(?, metadata_source),
        description = COALESCE(?, description),
        genres = COALESCE(?, genres),
        developer = COALESCE(?, developer),
        publisher = COALESCE(?, publisher),
        release_date = COALESCE(?, release_date),
        players = COALESCE(?, players),
        rating = COALESCE(?, rating),
        platform_name = COALESCE(?, platform_name),
        igdb_id = COALESCE(?, igdb_id),
        thegamesdb_id = COALESCE(?, thegamesdb_id),
        retroachievements_game_id = COALESCE(?, retroachievements_game_id),
        cover_path = COALESCE(?, cover_path),
        logo_path = COALESCE(?, logo_path),
        icon_path = COALESCE(?, icon_path),
        background_path = COALESCE(?, background_path),
        screenshot_paths = COALESCE(?, screenshot_paths),
        has_ra = COALESCE(?, has_ra),
        ra_console_id = COALESCE(?, ra_console_id),
        ra_game_id = COALESCE(?, ra_game_id),
        ra_badge_path = COALESCE(?, ra_badge_path),
        ra_total_achievements = COALESCE(?, ra_total_achievements),
        ra_total_points = COALESCE(?, ra_total_points),
        ra_last_sync = COALESCE(?, ra_last_sync),
        achievements_unlocked = COALESCE(?, achievements_unlocked),
        achievement_points_earned = COALESCE(?, achievement_points_earned),
        last_metadata_refresh = COALESCE(?, last_metadata_refresh),
        date_modified = ?
    WHERE identifier = ?
  `).run(
    normalized.title,
    normalized.sort_title,
    normalized.system,
    normalized.provider,
    normalized.catalog_identifier,
    normalized.match_confidence,
    normalized.metadata_status,
    normalized.metadata_source,
    normalized.description,
    normalized.genres,
    normalized.developer,
    normalized.publisher,
    normalized.release_date,
    normalized.players,
    normalized.rating,
    normalized.platform_name,
    normalized.igdb_id,
    normalized.thegamesdb_id,
    normalized.retroachievements_game_id,
    normalized.cover_path,
    normalized.logo_path,
    normalized.icon_path,
    normalized.background_path,
    normalized.screenshot_paths,
    normalized.has_ra,
    normalized.ra_console_id,
    normalized.ra_game_id,
    normalized.ra_badge_path,
    normalized.ra_total_achievements,
    normalized.ra_total_points,
    normalized.ra_last_sync,
    normalized.achievements_unlocked,
    normalized.achievement_points_earned,
    normalized.last_metadata_refresh,
    normalized.date_modified,
    identifier,
  );
  return hydrateGameRow(db.prepare('SELECT * FROM games WHERE identifier = ?').get(identifier));
}

function markGamePlayed(identifier) {
  if (!db || !identifier) return;
  ensureGameRow(identifier);
  db.prepare(`
    UPDATE games
    SET play_count = COALESCE(play_count, 0) + 1,
        last_played = ?,
        date_modified = ?
    WHERE identifier = ?
  `).run(Date.now(), Date.now(), identifier);
}

function buildGameSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'game';
}

function normalizeHltbTitle(value) {
  return String(value || '')
    .replace(/\.(zip|7z|rar|sfc|smc|snes|nes|gba|gbc|gb|md|gen|smd|n64|z64|v64|nds|pce|chd|cue|bin|img|iso|cso|pbp)$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(disc|disk|track)\s*\d+\b/gi, ' ')
    .replace(/\b(cd|dvd)\s*\d+\b/gi, ' ')
    .replace(/\s+-\s+disc\s+\d+$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hltbTitleVariants(value) {
  const variants = [];
  const add = (candidate) => {
    const clean = String(candidate || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (!variants.some(existing => existing.toLowerCase() === clean.toLowerCase())) variants.push(clean);
  };
  add(value);
  add(normalizeHltbTitle(value));
  add(normalizeHltbTitle(value).replace(/\s*:\s*/g, ' '));
  add(normalizeHltbTitle(value).replace(/\s+-\s+/g, ' '));
  return variants;
}

function fileUrlFromPath(filePath) {
  return filePath ? 'file:///' + filePath.replace(/\\/g, '/') : null;
}

function normalizeProviderArray(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
  return null;
}

function normalizeWorkerEnrichmentResponse(data = {}, context = {}) {
  if (!data || typeof data !== 'object') return null;
  const metadata = data.metadata || {};
  const art = data.art || {};
  const retroachievements = data.retroachievements || data.ra || {};
  return {
    title: data.title || metadata.title || context.title || null,
    sort_title: data.sort_title || metadata.sort_title || sanitizeTitle(data.title || metadata.title || context.title || ''),
    system: data.system || metadata.system || context.system || null,
    provider: data.provider || metadata.provider || context.provider || null,
    catalog_identifier: data.catalog_identifier || metadata.catalog_identifier || context.catalogIdentifier || null,
    match_confidence: data.match_confidence ?? metadata.match_confidence ?? 1,
    metadata_status: data.metadata_status || 'ready',
    metadata_source: data.metadata_source || 'cloudflare-worker',
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
    platform_name: metadata.platform_name || data.platform_name || null,
    igdb_id: metadata.igdb_id || data.igdb_id || null,
    thegamesdb_id: metadata.thegamesdb_id || data.thegamesdb_id || null,
    retroachievements_game_id: metadata.retroachievements_game_id || data.retroachievements_game_id || retroachievements.game_id || null,
    cover_path: art.cover_path || art.cover_url || null,
    logo_path: art.logo_path || art.logo_url || null,
    icon_path: art.icon_path || art.icon_url || null,
    background_path: art.background_path || art.background_url || null,
    screenshot_paths: normalizeProviderArray(art.screenshot_paths || art.screenshot_urls || art.screenshots),
    has_ra: retroachievements.has_ra ?? !!(retroachievements.game_id || retroachievements.id),
    ra_console_id: retroachievements.console_id || null,
    ra_game_id: retroachievements.game_id || retroachievements.id || null,
    ra_badge_path: retroachievements.badge_path || retroachievements.badge_url || retroachievements.icon_path || retroachievements.icon_url || null,
    ra_total_achievements: retroachievements.total_achievements ?? retroachievements.num_achievements ?? null,
    ra_total_points: retroachievements.total_points ?? null,
    ra_last_sync: retroachievements.synced_at ?? Date.now(),
    achievements_unlocked: retroachievements.achievements_unlocked ?? retroachievements.unlocked ?? null,
    achievement_points_earned: retroachievements.achievement_points_earned ?? retroachievements.points_earned ?? null,
    last_metadata_refresh: Date.now(),
  };
}

function packagedMetadataPath(provider, system) {
  if (!provider || !system) return null;
  const fileName = `${system}.json`;
  const devPath = path.join(__dirname, '../../assets/metadata', provider, fileName);
  const packedPath = path.join(process.resourcesPath || '', 'metadata', provider, fileName);
  if (fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(packedPath)) return packedPath;
  return devPath;
}

function loadPackagedMarketplaceMetadata(provider, system) {
  const cacheKey = `${provider || 'unknown'}::${system || 'unknown'}`;
  const filePath = packagedMetadataPath(provider, system);
  if (MARKETPLACE_METADATA_CACHE[cacheKey] && filePath && fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (MARKETPLACE_METADATA_CACHE[cacheKey].mtimeMs === stat.mtimeMs) {
        return MARKETPLACE_METADATA_CACHE[cacheKey];
      }
    } catch {}
  } else if (MARKETPLACE_METADATA_CACHE[cacheKey] && !filePath) {
    return MARKETPLACE_METADATA_CACHE[cacheKey];
  }
  if (!filePath || !fs.existsSync(filePath)) {
    const empty = { ok: false, provider, system, games: {}, byTitle: {} };
    MARKETPLACE_METADATA_CACHE[cacheKey] = empty;
    return empty;
  }
  try {
    const stat = fs.statSync(filePath);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const games = raw?.games && typeof raw.games === 'object' ? raw.games : {};
    const byTitle = Object.create(null);
    for (const [identifier, entry] of Object.entries(games)) {
      if (!entry || typeof entry !== 'object') continue;
      const keys = [
        identifier,
        entry.catalog_identifier,
        entry.name,
        entry.title,
        entry.sort_title,
      ].filter(Boolean).map(v => sanitizeTitle(String(v)));
      for (const key of keys) {
        if (key && !byTitle[key]) byTitle[key] = entry;
      }
    }
    const loaded = { ok: true, provider, system, filePath, mtimeMs: stat.mtimeMs, games, byTitle, meta: raw };
    MARKETPLACE_METADATA_CACHE[cacheKey] = loaded;
    return loaded;
  } catch (error) {
    const failed = { ok: false, provider, system, games: {}, byTitle: {}, error: error.message || String(error) };
    MARKETPLACE_METADATA_CACHE[cacheKey] = failed;
    return failed;
  }
}

function getPackagedMarketplaceMetadata(provider, system, catalogIdentifier, title) {
  const pack = loadPackagedMarketplaceMetadata(provider, system);
  if (!pack?.ok) return null;
  if (catalogIdentifier && pack.games[catalogIdentifier]) return pack.games[catalogIdentifier];
  const keys = [catalogIdentifier, title]
    .filter(Boolean)
    .map(v => sanitizeTitle(String(v)));
  for (const key of keys) {
    if (key && pack.byTitle[key]) return pack.byTitle[key];
  }
  return null;
}

function normalizePackagedMarketplaceMetadata(entry = {}, context = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const title = entry.title || context.title || null;
  return {
    title,
    sort_title: entry.sort_title || sanitizeTitle(title || ''),
    system: context.system || entry.system || null,
    provider: context.provider || entry.provider || 'archiveorg',
    catalog_identifier: context.catalogIdentifier || entry.catalog_identifier || entry.name || null,
    match_confidence: entry.match_confidence ?? 1,
    metadata_status: entry.metadata_status || 'ready',
    metadata_source: entry.metadata_source || 'packaged-metadata',
    description: entry.description || null,
    genres: normalizeProviderArray(entry.genres),
    developer: entry.developer || null,
    publisher: entry.publisher || null,
    release_date: entry.release_date || null,
    players: entry.players || null,
    rating: entry.rating || null,
    age_rating: entry.age_rating || null,
    age_rating_label: entry.age_rating_label || null,
    age_rating_board: entry.age_rating_board || null,
    platform_name: entry.platform_name || null,
    igdb_id: entry.igdb_id || null,
    thegamesdb_id: entry.thegamesdb_id || null,
    retroachievements_game_id: entry.retroachievements_game_id || null,
    cover_path: entry.cover_path || null,
    logo_path: entry.logo_path || null,
    icon_path: entry.icon_path || null,
    background_path: entry.background_path || null,
    screenshot_paths: normalizeProviderArray(entry.screenshot_paths || entry.screenshot_urls || entry.screenshots),
    has_ra: !!entry.has_ra,
    ra_console_id: entry.ra_console_id || null,
    ra_game_id: entry.ra_game_id || null,
    ra_badge_path: entry.ra_badge_path || null,
    ra_total_achievements: entry.ra_total_achievements ?? null,
    ra_total_points: entry.ra_total_points ?? null,
    ra_last_sync: entry.ra_last_sync ?? null,
    achievements_unlocked: entry.achievements_unlocked ?? null,
    achievement_points_earned: entry.achievement_points_earned ?? null,
    last_metadata_refresh: Date.now(),
  };
}

function getPackagedMarketplaceMetadataBundle(provider, system, catalogIdentifiers = []) {
  const pack = loadPackagedMarketplaceMetadata(provider, system);
  const ids = Array.isArray(catalogIdentifiers) ? catalogIdentifiers.filter(Boolean) : [];
  const entries = Object.create(null);
  if (!pack?.ok) {
    return { ok: false, provider, system, entries };
  }
  for (const identifier of ids) {
    const entry = normalizePackagedMarketplaceMetadata(
      getPackagedMarketplaceMetadata(provider, system, identifier, identifier),
      { title: identifier, system, provider, catalogIdentifier: identifier }
    );
    if (entry) entries[identifier] = entry;
  }
  return {
    ok: true,
    provider,
    system,
    metadata_source: 'packaged-metadata',
    entries,
  };
}

function getPackagedMarketplaceMetadataStats(provider, system, catalogIdentifiers = []) {
  const pack = loadPackagedMarketplaceMetadata(provider, system);
  const ids = Array.isArray(catalogIdentifiers) ? catalogIdentifiers.filter(Boolean) : [];
  const matched = new Set();
  if (pack?.ok) {
    for (const identifier of ids) {
      const entry = getPackagedMarketplaceMetadata(provider, system, identifier, identifier);
      if (entry) matched.add(identifier);
    }
  }
  return {
    ok: !!pack?.ok,
    provider,
    system,
    totalCatalogEntries: ids.length,
    totalPackEntries: pack?.ok ? Object.keys(pack.games || {}).length : 0,
    matchedCatalogEntries: matched.size,
    missingCatalogEntries: Math.max(0, ids.length - matched.size),
    metadata_source: 'packaged-metadata',
  };
}

function shouldUsePackagedMarketplaceOnly(provider, system) {
  return provider === 'archiveorg' && String(system || '').toLowerCase() === 'snes';
}

// ─── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      if (!parsed.metadataService || typeof parsed.metadataService !== 'object') {
        parsed.metadataService = {};
      }
      return parsed;
    }
  } catch {}
  return { metadataService: {} };
}

function saveSettings(data) {
  if (!data.metadataService || typeof data.metadataService !== 'object') {
    data.metadataService = {};
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}

const DEFAULT_METADATA_SERVICE_URL = 'https://skald-metadata-worker.uberbeau.workers.dev';

function getMetadataServiceSettings(settings = loadSettings()) {
  const cfg = settings?.metadataService || {};
  return {
    enabled: cfg.enabled !== false,
    baseUrl: String(cfg.baseUrl || DEFAULT_METADATA_SERVICE_URL).trim().replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || '').trim(),
    timeoutMs: Number(cfg.timeoutMs || 12000) || 12000,
  };
}

const THIRD_PARTY_PROVIDERS = {
  archiveorg: {
    id: 'archiveorg',
    name: 'Archive.org',
    loginLabel: 'Email',
    secretLabel: 'Password',
    loginKey: 'email',
    secretKey: 'password',
  },
  retroachievements: {
    id: 'retroachievements',
    name: 'RetroAchievements',
    loginLabel: 'Username',
    secretLabel: 'API Key',
    loginKey: 'username',
    secretKey: 'apiKey',
  },
  steamgriddb: {
    id: 'steamgriddb',
    name: 'SteamGridDB',
    loginLabel: 'Account Email',
    secretLabel: 'API Key',
    loginKey: 'email',
    secretKey: 'apiKey',
  },
};

function getActiveStoatUserId() {
  try {
    const live = stoat.getStatus?.();
    if (live?.user?.id) return live.user.id;
  } catch {}
  const settings = loadSettings();
  return settings?.stoatSession?.user_id || null;
}

function ensureThirdPartyProfiles(settings) {
  if (!settings.thirdPartyProfiles || typeof settings.thirdPartyProfiles !== 'object') {
    settings.thirdPartyProfiles = {};
  }
  return settings.thirdPartyProfiles;
}

function getThirdPartyAccount(providerId, userId = getActiveStoatUserId()) {
  if (!providerId || !THIRD_PARTY_PROVIDERS[providerId] || !userId) return null;
  const settings = loadSettings();
  const profiles = ensureThirdPartyProfiles(settings);
  return profiles?.[userId]?.[providerId] || null;
}

function saveThirdPartyAccount(providerId, data, userId = getActiveStoatUserId()) {
  if (!providerId || !THIRD_PARTY_PROVIDERS[providerId]) return { ok: false, error: 'Unknown provider' };
  if (!userId) return { ok: false, error: 'Sign in to Stoat before saving profile logins.' };
  const settings = loadSettings();
  const profiles = ensureThirdPartyProfiles(settings);
  if (!profiles[userId]) profiles[userId] = {};

  if (!data?.saveToProfile) {
    delete profiles[userId][providerId];
    saveSettings(settings);
    return { ok: true, cleared: true };
  }

  profiles[userId][providerId] = {
    login:      data.login || '',
    secretEnc:  data.secret ? encryptCredential(data.secret) : '',
    savedAt:    Date.now(),
  };
  saveSettings(settings);
  return { ok: true };
}

function readThirdPartyAccount(providerId, userId = getActiveStoatUserId()) {
  const provider = THIRD_PARTY_PROVIDERS[providerId];
  if (!provider) return { ok: false, error: 'Unknown provider' };
  if (!userId) {
    return {
      ok: true,
      provider,
      stoatUserId: null,
      saveToProfile: true,
      login: '',
      secret: '',
      hasSavedCredentials: false,
    };
  }
  const record = getThirdPartyAccount(providerId, userId);
  const secret = record?.secretEnc ? decryptCredential(record.secretEnc) : '';
  return {
    ok: true,
    provider,
    stoatUserId: userId,
    saveToProfile: true,
    login: record?.login || '',
    secret: secret || '',
    hasSavedCredentials: !!(record?.login || secret),
    savedAt: record?.savedAt || null,
  };
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow;

// Single session used everywhere — persistent partition in dev, default in prod.
// Must be called after app is ready.
function getSession() {
  const { session: elSession } = require('electron');
  return app.isPackaged
    ? elSession.defaultSession
    : elSession.fromPartition('persist:skald');
}

async function getArchiveSessionCookies() {
  const ses = getSession();
  const c1 = await ses.cookies.get({ domain: 'archive.org' });
  const c2 = await ses.cookies.get({ domain: '.archive.org' });
  const c3 = await ses.cookies.get({ url: 'https://archive.org' });
  return [...new Map([...c1, ...c2, ...c3].map(c => [c.name + c.domain, c])).values()];
}

async function hasArchiveSession() {
  const cookies = await getArchiveSessionCookies();
  return cookies.some(c => c.name === 'logged-in-sig' || c.name === 'logged-in-user');
}

async function setArchiveResponseCookies(setCookieHeaders = []) {
  const ses = getSession();
  for (const cookieStr of (setCookieHeaders || [])) {
    const parts = String(cookieStr).split(';').map(s => s.trim());
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx < 0) continue;
    const name = nameVal.slice(0, eqIdx).trim();
    const value = nameVal.slice(eqIdx + 1).trim();

    const attrMap = {};
    for (const attr of attrs) {
      const ai = attr.indexOf('=');
      const k = (ai >= 0 ? attr.slice(0, ai) : attr).trim().toLowerCase();
      const v = ai >= 0 ? attr.slice(ai + 1).trim() : '';
      attrMap[k] = v;
    }

    const cookieDomain = attrMap['domain'] || '.archive.org';
    const cookiePath = attrMap['path'] || '/';
    try {
      await ses.cookies.set({
        url: `https://archive.org${cookiePath}`,
        name,
        value,
        domain: cookieDomain,
        path: cookiePath,
        secure: 'secure' in attrMap,
        httpOnly: 'httponly' in attrMap,
      });
    } catch {}
  }
  await ses.cookies.flushStore();
}

async function performArchiveLogin(email, password) {
  return new Promise((resolve) => {
    const postBody = new URLSearchParams({
      email,
      password,
      remember: 'CHECKED',
      referer: 'https://archive.org/',
      login: 'true',
      submit_by_js: 'true',
    }).toString();

    const reqOptions = {
      hostname: 'archive.org',
      path: '/services/xauthn/?op=login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody),
        'Referer': 'https://archive.org/account/login',
        'Origin': 'https://archive.org',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
      },
    };

    const req = https.request(reqOptions, async (res) => {
      let body = '';
      res.on('data', chunk => body += chunk.toString());
      res.on('end', async () => {
        try {
          const json = JSON.parse(body);
          if (!json.success) {
            const msg = json.values?.reason || json.error || 'Login failed';
            return resolve({ ok: false, error: msg, reason: 'bad-credentials' });
          }

          await setArchiveResponseCookies(res.headers['set-cookie'] || []);
          const username = json.values?.screenname || json.values?.username || email;
          const s = loadSettings();
          s.archiveOrgUser = username;
          saveSettings(s);
          resolve({ ok: true, username, method: 'credentials' });
        } catch (e) {
          resolve({ ok: false, error: `Parse error: ${e.message} | body: ${body.slice(0, 200)}`, reason: 'error' });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, error: err.message, reason: 'error' }));
    req.write(postBody);
    req.end();
  });
}

async function restoreArchiveSession() {
  if (await hasArchiveSession()) {
    const s = loadSettings();
    return { ok: true, username: s.archiveOrgUser || null, method: 'cookie' };
  }

  const acct = readThirdPartyAccount('archiveorg');
  if (!acct?.login || !acct?.secret) return { ok: false, reason: 'no-credentials' };

  const email = acct.login;
  const password = acct.secret;
  if (!password) return { ok: false, reason: 'decrypt-failed' };

  return performArchiveLogin(email, password);
}

async function logoutArchiveSession() {
  const ses = getSession();
  const cookies = await getArchiveSessionCookies();
  for (const cookie of cookies) {
    try {
      const cookieUrl = `https://${String(cookie.domain || 'archive.org').replace(/^\./, '')}${cookie.path || '/'}`;
      await ses.cookies.remove(cookieUrl, cookie.name);
    } catch {}
  }
  const s = loadSettings();
  delete s.archiveOrgUser;
  saveSettings(s);
  return { ok: true };
}

async function getArchiveStatus() {
  const loggedIn = await hasArchiveSession();
  const s = loadSettings();
  return { loggedIn, username: s.archiveOrgUser || null };
}

function createWindow() {
  const ses = getSession();

  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    frame:  false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      session:          ses,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  // Validate installs on every launch — clears DB entries whose folders were deleted
  validateInstalls();
  setTimeout(() => {
    migrateExistingArtCacheToWebpOnce().catch(err => {
      console.warn('[art-migrate] WebP migration failed:', err?.message || err);
    });
  }, 1500);
});
app.on('window-all-closed', async () => {
  // Flush cookies to disk before quitting so session survives restart
  try { await getSession().cookies.flushStore(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Window controls ─────────────────────────────────────────────────────────

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('heroes-path', () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'heroes');
  }
  return path.join(__dirname, '../../assets/heroes');
});

// Check if a hero.png exists in the game's install directory
ipcMain.handle('check-game-hero', (_, { installDir }) => {
  if (!installDir) return null;
  const candidates = ['hero.png', 'hero.jpg', 'hero.jpeg', 'hero.webp'];
  for (const name of candidates) {
    const heroPath = path.join(installDir, name);
    if (fs.existsSync(heroPath)) {
      return 'file:///' + heroPath.replace(/\\/g, '/');
    }
  }
  return null;
});

ipcMain.on('open-external', (_, url) => {
  shell.openExternal(url);
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ─── Blades Theme Window ──────────────────────────────────────────────────────

let bladesWindow = null;
let thirdPartyWindow = null;

ipcMain.handle('blades-open', async () => {
  if (bladesWindow && !bladesWindow.isDestroyed()) {
    bladesWindow.focus();
    return { ok: true };
  }
  const ses = getSession();
  bladesWindow = new BrowserWindow({
    width:           1920,
    height:          1080,
    frame:           false,
    fullscreenable:  true,
    fullscreen:      false,
    resizable:       true,
    backgroundColor: '#000000',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      session:          ses,
    },
  });
  bladesWindow.loadFile(path.join(__dirname, '../renderer/blades.html'));
  bladesWindow.on('closed', () => { bladesWindow = null; });
  return { ok: true };
});

ipcMain.handle('blades-close', () => {
  bladesWindow?.close();
  return { ok: true };
});

ipcMain.handle('blades-select-system', (_, { system }) => {
  // Notify main window to switch system when returning from blades
  mainWindow?.webContents.send('blades-system-selected', { system });
  return { ok: true };
});

ipcMain.handle('thirdparty-open-window', async (_, { provider }) => {
  const providerInfo = THIRD_PARTY_PROVIDERS[provider];
  if (!providerInfo) return { ok: false, error: 'Unknown provider' };

  const ses = getSession();
  if (thirdPartyWindow && !thirdPartyWindow.isDestroyed()) {
    thirdPartyWindow.loadFile(path.join(__dirname, '../renderer/thirdparty-account.html'), { query: { provider } });
    thirdPartyWindow.focus();
    return { ok: true };
  }

  thirdPartyWindow = new BrowserWindow({
    width: 960,
    height: 700,
    frame: false,
    resizable: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      session:          ses,
    },
  });
  thirdPartyWindow.loadFile(path.join(__dirname, '../renderer/thirdparty-account.html'), { query: { provider } });
  thirdPartyWindow.on('closed', () => { thirdPartyWindow = null; });
  return { ok: true };
});

ipcMain.handle('thirdparty-close-window', () => {
  thirdPartyWindow?.close();
  return { ok: true };
});

ipcMain.handle('thirdparty-get-account', (_, { provider }) => {
  return readThirdPartyAccount(provider);
});

ipcMain.handle('thirdparty-save-account', (_, { provider, login, secret, saveToProfile }) => {
  return saveThirdPartyAccount(provider, { login, secret, saveToProfile });
});

ipcMain.handle('thirdparty-clear-account', (_, { provider }) => {
  return saveThirdPartyAccount(provider, { saveToProfile: false });
});

// ─── Settings IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('settings-get',  ()      => loadSettings());
ipcMain.handle('settings-save', (_, s)  => { saveSettings(s); return { ok: true }; });
ipcMain.handle('choose-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('folder-browser-list', async (_, { dir } = {}) => {
  const home = app.getPath('home');
  if (!dir) {
    const roots = [];
    if (process.platform === 'win32') {
      for (let code = 65; code <= 90; code += 1) {
        const drive = `${String.fromCharCode(code)}:\\`;
        if (fs.existsSync(drive)) roots.push({ name: drive, path: drive, type: 'drive' });
      }
    } else {
      roots.push({ name: '/', path: '/', type: 'drive' });
      if (home && home !== '/') roots.push({ name: 'Home', path: home, type: 'folder' });
    }
    return { ok: true, dir: '', parent: null, roots: true, entries: roots };
  }
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) return { ok: false, error: 'Folder does not exist.' };
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) return { ok: false, error: 'Path is not a folder.' };
  let entries = [];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({ name: entry.name, path: path.join(resolved, entry.name), type: 'folder' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    return { ok: false, error: e.message || 'Could not read folder.' };
  }
  const parent = path.dirname(resolved);
  const isRoot = parent === resolved;
  return { ok: true, dir: resolved, parent: isRoot ? null : parent, roots: false, entries };
});
ipcMain.handle('storage-rerun-art-migration', async () => {
  const settings = loadSettings();
  settings.webpArtMigrationVersion = 0;
  delete settings.webpArtMigration;
  saveSettings(settings);
  return migrateExistingArtCacheToWebpOnce();
});
ipcMain.handle('storage-clear-catalog-cache', () => {
  try {
    clearAllRomCaches();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('storage-clear-art-cache', () => {
  try {
    clearDirectoryContents(ART_ROOT_DIR);
    clearDirectoryContents(LEGACY_SGDB_CACHE_DIR);
    const settings = loadSettings();
    settings.webpArtMigrationVersion = 0;
    delete settings.webpArtMigration;
    saveSettings(settings);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('storage-open-path', (_, { kind } = {}) => {
  const settings = loadSettings();
  if (kind === 'install') return openFolderPath(settings.installPath || '');
  if (kind === 'download') return openFolderPath(settings.downloadPath || '');
  if (kind === 'art') return openFolderPath(ART_ROOT_DIR);
  return { ok: false, error: 'Unknown storage path' };
});

ipcMain.handle('choose-file', async (_, { filters } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

// ─── Library IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('library-get', () => {
  if (!db) return {};
  const rows = db.prepare('SELECT * FROM games').all();
  const out  = {};
  for (const r of rows) out[r.identifier] = hydrateGameRow(r);
  return out;
});

ipcMain.handle('library-get-game', (_, { identifier }) => {
  if (!db) return null;
  return hydrateGameRow(db.prepare('SELECT * FROM games WHERE identifier = ?').get(identifier)) || null;
});

ipcMain.handle('library-set-category', (_, { identifier, category }) => {
  if (!db) return { ok: false };
  ensureGameRow(identifier);
  db.prepare('UPDATE games SET category = ?, date_modified = ? WHERE identifier = ?').run(category, Date.now(), identifier);
  return { ok: true };
});

ipcMain.handle('library-set-favorite', (_, { identifier, isFavorite }) => {
  if (!db) return { ok: false };
  // Ensure the row exists (game may not be installed yet)
  ensureGameRow(identifier);
  db.prepare('UPDATE games SET is_favorite = ?, date_modified = ? WHERE identifier = ?').run(isFavorite ? 1 : 0, Date.now(), identifier);
  return { ok: true };
});

ipcMain.handle('library-set-notes', (_, { identifier, notes }) => {
  if (!db) return { ok: false };
  ensureGameRow(identifier);
  db.prepare('UPDATE games SET notes = ?, date_modified = ? WHERE identifier = ?').run(notes || null, Date.now(), identifier);
  return { ok: true };
});

ipcMain.handle('library-upsert-metadata', (_, { identifier, metadata }) => {
  if (!db || !identifier) return { ok: false, error: 'Missing identifier' };
  const game = upsertGameEnrichment(identifier, metadata || {});
  return { ok: true, game };
});

ipcMain.handle('library-mark-played', (_, { identifier }) => {
  if (!db || !identifier) return { ok: false, error: 'Missing identifier' };
  markGamePlayed(identifier);
  return { ok: true };
});

ipcMain.handle('metadata-service-health', async () => {
  const cfg = getMetadataServiceSettings();
  if (!cfg.baseUrl) {
    return { ok: false, configured: false, error: 'Metadata service URL is not set.' };
  }
  const headers = {};
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  const response = await requestJson(`${cfg.baseUrl}/health`, {
    method: 'GET',
    headers,
    timeoutMs: cfg.timeoutMs,
  });
  if (!response.ok) {
    return {
      ok: false,
      configured: true,
      error: response.error || 'Health check failed.',
      status: response.status || 0,
    };
  }
  return {
    ok: true,
    configured: true,
    data: response.data || {},
    igdbReady: !!response.data?.igdbConfigured,
    tgdbReady: !!response.data?.theGamesDbConfigured,
    sgdbReady: !!response.data?.steamGridConfigured,
    metadataReadyLabel: typeof response.data?.theGamesDbConfigured !== 'undefined'
      ? `TheGamesDB: ${response.data?.theGamesDbConfigured ? 'ready' : 'missing'}. IGDB: ${response.data?.igdbConfigured ? 'ready' : 'missing'}.`
      : `IGDB: ${response.data?.igdbConfigured ? 'ready' : 'missing'}.`,
  };
});

async function buildGameEnrichmentPreview({ title, system, provider = null, catalogIdentifier = null }) {
  const effectiveTitle = title || catalogIdentifier || 'Unknown Game';
  const effectiveSystem = system || null;
  const packagedMetadata = provider === 'archiveorg' && effectiveSystem
    ? normalizePackagedMarketplaceMetadata(
        getPackagedMarketplaceMetadata(provider, effectiveSystem, catalogIdentifier, effectiveTitle),
        { title: effectiveTitle, system: effectiveSystem, provider, catalogIdentifier }
      )
    : null;

  if (packagedMetadata) {
    const settings = loadSettings();
    const sgdbAccount = readThirdPartyAccount('steamgriddb');
    const sgdbKey = sgdbAccount.secret || settings.steamGridDbKey || '';
    if (sgdbKey && effectiveSystem) {
      const [icon, logo, cover] = await Promise.all([
        fetchSgdbAsset('icon', effectiveTitle, effectiveSystem, sgdbKey),
        fetchSgdbAsset('logo', effectiveTitle, effectiveSystem, sgdbKey),
        fetchSgdbAsset('grid', effectiveTitle, effectiveSystem, sgdbKey),
      ]);
      if (icon?.ok && !packagedMetadata.icon_path) packagedMetadata.icon_path = icon.path;
      if (logo?.ok && !packagedMetadata.logo_path) packagedMetadata.logo_path = logo.path;
      if (cover?.ok && !packagedMetadata.cover_path) packagedMetadata.cover_path = cover.path;
    }
    return { ok: true, data: packagedMetadata, source: 'packaged-metadata', cached: true };
  }

  if (shouldUsePackagedMarketplaceOnly(provider, effectiveSystem)) {
    const payload = {
      title: effectiveTitle,
      sort_title: sanitizeTitle(effectiveTitle),
      system: effectiveSystem,
      provider,
      catalog_identifier: catalogIdentifier,
      metadata_status: 'missing',
      metadata_source: 'packaged-metadata',
    };
    const settings = loadSettings();
    const sgdbAccount = readThirdPartyAccount('steamgriddb');
    const sgdbKey = sgdbAccount.secret || settings.steamGridDbKey || '';
    if (sgdbKey && effectiveSystem) {
      const [icon, logo, cover] = await Promise.all([
        fetchSgdbAsset('icon', effectiveTitle, effectiveSystem, sgdbKey),
        fetchSgdbAsset('logo', effectiveTitle, effectiveSystem, sgdbKey),
        fetchSgdbAsset('grid', effectiveTitle, effectiveSystem, sgdbKey),
      ]);
      if (icon?.ok) payload.icon_path = icon.path;
      if (logo?.ok) payload.logo_path = logo.path;
      if (cover?.ok) payload.cover_path = cover.path;
    }
    return { ok: true, data: payload, source: 'packaged-metadata', cached: true };
  }

  const workerResult = await fetchWorkerGameEnrichment({
    identifier: `preview::${effectiveSystem || 'unknown'}::${effectiveTitle}`,
    title: effectiveTitle,
    system: effectiveSystem,
    provider,
    catalogIdentifier,
  });
  if (workerResult?.ok && workerResult.data) {
    const localized = await materializeEnrichmentAssets(workerResult.data, {
      identifier: `preview::${effectiveSystem || 'unknown'}::${effectiveTitle}`,
      title: effectiveTitle,
      system: effectiveSystem,
    });
    return { ok: true, data: localized, source: 'cloudflare-worker', cached: !!workerResult.cached };
  }

  const payload = {
    title: effectiveTitle,
    sort_title: sanitizeTitle(effectiveTitle),
    system: effectiveSystem,
    provider,
    catalog_identifier: catalogIdentifier,
    metadata_status: 'partial',
    metadata_source: 'local-providers',
  };

  const settings = loadSettings();
  const sgdbAccount = readThirdPartyAccount('steamgriddb');
  const sgdbKey = sgdbAccount.secret || settings.steamGridDbKey || '';
  if (sgdbKey && effectiveSystem) {
    const [icon, logo, cover] = await Promise.all([
      fetchSgdbAsset('icon', effectiveTitle, effectiveSystem, sgdbKey),
      fetchSgdbAsset('logo', effectiveTitle, effectiveSystem, sgdbKey),
      fetchSgdbAsset('grid', effectiveTitle, effectiveSystem, sgdbKey),
    ]);
    if (icon?.ok) payload.icon_path = icon.path;
    if (logo?.ok) payload.logo_path = logo.path;
    if (cover?.ok) payload.cover_path = cover.path;
  }

  const ra = effectiveSystem ? await fetchRaGameData(effectiveTitle, effectiveSystem) : { ok: false };
  if (ra?.ok && ra.data) {
    const raSlug = `${effectiveSystem || 'unknown'}_${ra.data.id}_${buildGameSlug(effectiveTitle)}`;
    const raIconPath = await cacheRemoteImage(ra.data.imageIcon, ART_PROVIDER_RA_DIR, `${raSlug}_icon`);
    payload.has_ra = true;
    payload.ra_game_id = String(ra.data.id);
    payload.retroachievements_game_id = String(ra.data.id);
    payload.ra_total_achievements = Number(ra.data.numAchievements || 0);
    payload.ra_total_points = Number(ra.data.totalPoints || 0);
    payload.ra_last_sync = Date.now();
    payload.achievements_unlocked = Array.isArray(ra.data.achievements)
      ? ra.data.achievements.filter(a => !!a.dateEarned).length
      : 0;
    payload.achievement_points_earned = Array.isArray(ra.data.achievements)
      ? ra.data.achievements.reduce((sum, a) => sum + (a.dateEarned ? Number(a.points || 0) : 0), 0)
      : 0;
    if (!payload.icon_path && raIconPath) payload.icon_path = raIconPath;
    if (raIconPath) payload.ra_badge_path = raIconPath;
  }

  if (
    payload.description ||
    payload.developer ||
    payload.publisher ||
    (Array.isArray(payload.genres) && payload.genres.length) ||
    payload.release_date ||
    payload.players ||
    payload.rating ||
    payload.age_rating
  ) {
    payload.metadata_status = 'ready';
  } else {
    payload.metadata_status = 'missing';
  }

  return { ok: true, data: payload, source: 'local-providers', cached: false, workerError: workerResult?.skipped ? null : workerResult?.error || null };
}

ipcMain.handle('metadata-preview-game', async (_, { title, system, provider = null, catalogIdentifier = null }) => {
  if (!title) return { ok: false, error: 'Missing title' };
  return buildGameEnrichmentPreview({ title, system, provider, catalogIdentifier });
});

ipcMain.handle('marketplace-packaged-metadata', async (_, { provider = null, system = null, catalogIdentifiers = [] } = {}) => {
  if (!provider || !system) return { ok: false, error: 'Missing provider or system.' };
  return getPackagedMarketplaceMetadataBundle(provider, system, catalogIdentifiers);
});

ipcMain.handle('marketplace-packaged-metadata-stats', async (_, { provider = null, system = null, catalogIdentifiers = [] } = {}) => {
  if (!provider || !system) return { ok: false, error: 'Missing provider or system.' };
  return getPackagedMarketplaceMetadataStats(provider, system, catalogIdentifiers);
});

ipcMain.handle('library-enrich-game', async (_, { identifier, title, system, force = false }) => {
  if (!db || !identifier) return { ok: false, error: 'Missing identifier' };
  const existing = hydrateGameRow(db.prepare('SELECT * FROM games WHERE identifier = ?').get(identifier));
  const effectiveTitle = title || existing?.title || identifier;
  const effectiveSystem = system || existing?.system || null;

  if (!force && existing?.metadata_status === 'ready' && (existing?.description || existing?.icon_path || existing?.cover_path || existing?.ra_game_id)) {
    return { ok: true, game: existing, cached: true };
  }

  const preview = await buildGameEnrichmentPreview({
    title: effectiveTitle,
    system: effectiveSystem,
    provider: existing?.provider || (existing?.source_type === 'local_scan' ? 'local' : existing?.provider),
    catalogIdentifier: existing?.catalog_identifier || null,
  });
  if (!preview?.ok || !preview.data) {
    return { ok: false, error: preview?.error || 'Could not enrich game metadata.' };
  }
  const game = upsertGameEnrichment(identifier, preview.data);
  return {
    ok: true,
    game,
    cached: !!preview.cached,
    source: preview.source || 'local-providers',
    workerError: preview.workerError || null,
  };
});

// ─── Collections IPC ──────────────────────────────────────────────────────────

ipcMain.handle('collections-get', () => {
  if (!db) return [];
  const cols = db.prepare('SELECT * FROM collections ORDER BY name').all();
  return cols.map(c => ({
    ...c,
    games: db.prepare('SELECT identifier FROM collection_games WHERE collection_id = ?')
             .all(c.id).map(r => r.identifier),
  }));
});

ipcMain.handle('collections-create', (_, { name }) => {
  if (!db) return { ok: false };
  try {
    const info = db.prepare('INSERT INTO collections (name, created_at) VALUES (?, ?)').run(name.trim(), Date.now());
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('collections-delete', (_, { id }) => {
  if (!db) return { ok: false };
  db.prepare('DELETE FROM collection_games WHERE collection_id = ?').run(id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return { ok: true };
});

ipcMain.handle('collections-rename', (_, { id, name }) => {
  if (!db) return { ok: false };
  try {
    db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name.trim(), id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('collections-set-color', (_, { id, color }) => {
  if (!db) return { ok: false };
  db.prepare('UPDATE collections SET color = ? WHERE id = ?').run(color || null, id);
  return { ok: true };
});

ipcMain.handle('collections-add-game', (_, { collectionId, identifier }) => {
  if (!db) return { ok: false };
  try {
    db.prepare('INSERT OR IGNORE INTO collection_games (collection_id, identifier) VALUES (?, ?)').run(collectionId, identifier);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('collections-remove-game', (_, { collectionId, identifier }) => {
  if (!db) return { ok: false };
  db.prepare('DELETE FROM collection_games WHERE collection_id = ? AND identifier = ?').run(collectionId, identifier);
  return { ok: true };
});

// ─── Thumbnail cache ──────────────────────────────────────────────────────────

// Returns a file:// URL from disk cache, downloading from archive.org if not
// yet cached. Falls back to the live URL on any error so UI always shows something.
ipcMain.handle('get-thumb', async (_, { identifier }) => {
  const liveUrl   = `https://archive.org/services/img/${identifier}`;
  const cachePath = path.join(THUMB_CACHE_DIR, `${identifier}.jpg`);
  const cacheUrl  = 'file:///' + cachePath.replace(/\\/g, '/');

  // Serve from cache if it already exists and looks like a real image (>1 KB)
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1024) {
    return cacheUrl;
  }

  return new Promise((resolve) => {
    const doRequest = (url, redirects) => {
      if (redirects > 5) return resolve(liveUrl);
      https.get(url, { headers: { 'User-Agent': 'RohanKar-Launcher/1.1' } }, (res) => {
        const { statusCode, headers: resHeaders } = res;

        if ([301,302,303,307,308].includes(statusCode) && resHeaders.location) {
          res.resume();
          let next = resHeaders.location;
          if (next.startsWith('/')) {
            const base = new URL(url);
            next = `${base.protocol}//${base.host}${next}`;
          }
          return doRequest(next, redirects + 1);
        }

        // Only cache real image responses
        const ct = resHeaders['content-type'] || '';
        if (statusCode !== 200 || !ct.startsWith('image/')) {
          res.resume();
          return resolve(liveUrl);
        }

        const file = fs.createWriteStream(cachePath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          try {
            if (fs.statSync(cachePath).size > 1024) return resolve(cacheUrl);
          } catch {}
          resolve(liveUrl);
        });
        file.on('error', () => {
          try { fs.unlinkSync(cachePath); } catch {}
          resolve(liveUrl);
        });
      }).on('error', () => resolve(liveUrl));
    };
    doRequest(liveUrl, 0);
  });
});

// ─── Download ─────────────────────────────────────────────────────────────────

const http  = require('http');
const activeDownloads = new Map();

function archiveUrlRequiresAuth(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'archive.org' || host.endsWith('.archive.org');
  } catch {
    return false;
  }
}

async function buildArchiveCookieHeader() {
  try {
    const cookies = await getArchiveSessionCookies();
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

function archiveDownloadHeaders(cookieHeader = '', referer = 'https://archive.org/details/ni-roms') {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/zip,application/octet-stream,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

const MARKETPLACE_THEME_SOURCES = [
  {
    id: 'xbox360-themes',
    label: 'Xbox 360 Themes',
    url: 'https://archive.org/download/Xbox_360_Themes_Archivev.1/Xbox%20360%20Themes/',
    isCustom: false,
  },
  {
    id: 'xbox360-custom-themes',
    label: 'Xbox 360 Custom Themes',
    url: 'https://archive.org/download/Xbox_360_Themes_Archivev.1/Xbox%20360%20Themes/Custom%20Themes/',
    isCustom: true,
  },
];
let marketplaceThemesCatalogCache = null;
let marketplaceThemesCatalogCacheAt = 0;

function decodeHtmlEntityText(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function safeDecodeUriComponent(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function fetchArchiveText(url, referer = 'https://archive.org/details/Xbox_360_Themes_Archivev.1') {
  const cookieHeader = archiveUrlRequiresAuth(url) ? await buildArchiveCookieHeader() : '';
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl, redirectCount) => {
      if (redirectCount > 10) return reject(new Error('Too many redirects'));
      let parsed;
      try {
        parsed = new URL(requestUrl);
      } catch (err) {
        return reject(err);
      }
      const protocol = parsed.protocol === 'https:' ? https : http;
      const req = protocol.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: archiveDownloadHeaders(cookieHeader, referer),
        timeout: 30000,
      }, (res) => {
        const { statusCode, headers } = res;
        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          res.resume();
          let next = headers.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          doRequest(next, redirectCount + 1);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${statusCode} from ${parsed.hostname}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });
      req.on('error', reject);
      req.end();
    };
    doRequest(url, 0);
  });
}

function parseArchiveThemeDirectory(html, source) {
  const items = [];
  const seen = new Set();
  const hrefRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const rawHref = decodeHtmlEntityText(match[1] || '').trim();
    if (!rawHref || rawHref === '../' || rawHref.startsWith('?') || rawHref.startsWith('#')) continue;
    let url;
    try {
      url = new URL(rawHref, source.url);
    } catch {
      continue;
    }
    if (!url.href.startsWith(source.url)) continue;
    if (!url.pathname.endsWith('/')) continue;
    const folderName = safeDecodeUriComponent(path.posix.basename(url.pathname.replace(/\/+$/, '')));
    if (!folderName || folderName === '.' || folderName === '..') continue;
    if (!source.isCustom && /^custom themes$/i.test(folderName)) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const titleIdMatch = folderName.match(/\(([0-9A-Fa-f]{8})\)\s*$/);
    const titleId = titleIdMatch?.[1]?.toUpperCase() || '';
    const title = folderName.replace(/\s*\(([0-9A-Fa-f]{8})\)\s*$/, '').trim() || folderName;
    items.push({
      id: `${source.id}:${folderName}`,
      title,
      folderName,
      titleId,
      type: source.isCustom ? 'Custom Theme' : 'Theme',
      meta: source.isCustom ? 'Custom theme' : (titleId ? `Title ID ${titleId}` : 'Official theme folder'),
      isCustom: !!source.isCustom,
      source: source.id,
      sourceLabel: source.label,
      folderUrl: url.href,
      thumbnailUrl: '',
      previewImageUrls: [],
      status: source.isCustom
        ? 'Custom Xbox 360 dashboard theme from the Archive.org custom theme folder.'
        : 'Xbox 360 dashboard theme from the Archive.org themes archive.',
      notes: 'Individual theme file and preview-image detection will be wired after we inspect this folder.',
    });
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

function parseArchiveFolderListing(html, folderUrl) {
  const directories = [];
  const files = [];
  const seen = new Set();
  const hrefRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const rawHref = decodeHtmlEntityText(match[1] || '').trim();
    if (!rawHref || rawHref === '../' || rawHref.startsWith('?') || rawHref.startsWith('#')) continue;
    let url;
    try {
      url = new URL(rawHref, folderUrl);
    } catch {
      continue;
    }
    if (!url.href.startsWith(folderUrl)) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const isDir = url.pathname.endsWith('/');
    const name = safeDecodeUriComponent(path.posix.basename(url.pathname.replace(/\/+$/, '')));
    if (!name || name === '.' || name === '..') continue;
    const entry = {
      name,
      url: url.href,
      extension: isDir ? '' : path.extname(name).toLowerCase(),
    };
    if (isDir) directories.push(entry);
    else files.push(entry);
  }
  return {
    directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function classifyThemeFolderFiles(files = []) {
  const imageFiles = files.filter(file => ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(file.extension));
  const thumbnail = imageFiles.find(file => /thumb|thumbnail/i.test(file.name)) || null;
  const mainImages = imageFiles
    .filter(file => file.url !== thumbnail?.url)
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aNum = Number((aName.match(/\d+/) || [999])[0]);
      const bNum = Number((bName.match(/\d+/) || [999])[0]);
      if (aNum !== bNum) return aNum - bNum;
      return a.name.localeCompare(b.name);
    });
  const themeFile = files.find(file => !imageFiles.some(image => image.url === file.url)) || null;
  return {
    thumbnail,
    mainImages: mainImages.slice(0, 4),
    images: imageFiles,
    themeFile,
  };
}

function filePathToFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function safeThemeIdFromItem(item = {}, title = '') {
  const raw = item.parentTitle && item.title
    ? `${item.parentTitle} - ${item.title}`
    : (title || item.title || item.id || 'Xbox 360 Theme');
  return sanitizeFolderName(raw).slice(0, 120);
}

function sortThemeImages(files = []) {
  return [...files].sort((a, b) => {
    const aName = String(a.name || '').toLowerCase();
    const bName = String(b.name || '').toLowerCase();
    const aNum = Number((aName.match(/\d+/) || [999])[0]);
    const bNum = Number((bName.match(/\d+/) || [999])[0]);
    if (aNum !== bNum) return aNum - bNum;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function rebuildDownloadedThemeManifest(manifest = {}, manifestDir = '') {
  const files = Array.isArray(manifest.files) ? manifest.files.map(file => {
    const name = file?.name || (file?.filePath ? path.basename(file.filePath) : '');
    const filePath = file?.filePath || (name ? path.join(manifestDir, sanitizeFolderName(name)) : '');
    const extension = String(file?.extension || path.extname(name || filePath)).toLowerCase();
    return {
      ...file,
      name,
      extension,
      filePath,
      fileUrl: filePath && fs.existsSync(filePath) ? filePathToFileUrl(filePath) : (file?.fileUrl || ''),
    };
  }) : [];

  const imageFiles = files.filter(file => ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(file.extension));
  const thumbnail = imageFiles.find(file => /thumb|thumbnail/i.test(file.name)) || null;
  const mainImages = sortThemeImages(imageFiles.filter(file => file.filePath !== thumbnail?.filePath)).slice(0, 4);
  const nonImageFiles = files.filter(file => !imageFiles.some(image => image.filePath === file.filePath));
  const themeFile = nonImageFiles.find(file => file.fileUrl) || null;

  return {
    ...manifest,
    installDir: manifest.installDir || manifestDir,
    thumbnail: thumbnail?.fileUrl || mainImages[0]?.fileUrl || manifest.thumbnail || '',
    themeFile: themeFile?.fileUrl || manifest.themeFile || '',
    backgrounds: {
      ...(manifest.backgrounds || {}),
      image1: mainImages[0]?.fileUrl || manifest.backgrounds?.image1 || '',
      image2: mainImages[1]?.fileUrl || manifest.backgrounds?.image2 || '',
      image3: mainImages[2]?.fileUrl || manifest.backgrounds?.image3 || '',
      image4: mainImages[3]?.fileUrl || manifest.backgrounds?.image4 || '',
    },
    files,
  };
}

function migrateDownloadedThemeManifest(rawManifest = {}, manifestDir = '') {
  const cleanId = safeThemeIdFromItem({}, rawManifest.title || rawManifest.id || path.basename(manifestDir));
  const cleanDir = path.join(MARKETPLACE_THEMES_DIR, cleanId);
  if (!cleanId || path.resolve(cleanDir) === path.resolve(manifestDir)) {
    return { manifest: rawManifest, manifestDir };
  }

  const legacyDirName = path.basename(manifestDir);
  const shouldMigrate = legacyDirName.length > 120 || /%[0-9A-Fa-f]{2}/.test(legacyDirName) || legacyDirName.startsWith('theme-child_');
  if (!shouldMigrate) return { manifest: rawManifest, manifestDir };

  if (!fs.existsSync(cleanDir)) fs.mkdirSync(cleanDir, { recursive: true });
  const files = Array.isArray(rawManifest.files) ? rawManifest.files.map(file => {
    const name = file?.name || (file?.filePath ? path.basename(file.filePath) : '');
    if (!name) return file;
    const destFile = path.join(cleanDir, sanitizeFolderName(name));
    const sourceFile = file?.filePath && fs.existsSync(file.filePath)
      ? file.filePath
      : path.join(manifestDir, sanitizeFolderName(name));
    try {
      if (fs.existsSync(sourceFile) && !fs.existsSync(destFile)) {
        fs.copyFileSync(sourceFile, destFile);
      }
    } catch {}
    return {
      ...file,
      filePath: destFile,
      fileUrl: '',
    };
  }) : [];

  return {
    manifestDir: cleanDir,
    manifest: {
      ...rawManifest,
      id: cleanId,
      installDir: cleanDir,
      thumbnail: '',
      themeFile: '',
      backgrounds: {},
      files,
    },
  };
}

async function downloadArchiveFileToPath(url, destFile, referer = 'https://archive.org/details/Xbox_360_Themes_Archivev.1') {
  const cookieHeader = archiveUrlRequiresAuth(url) ? await buildArchiveCookieHeader() : '';
  if (!fs.existsSync(path.dirname(destFile))) fs.mkdirSync(path.dirname(destFile), { recursive: true });
  return new Promise((resolve) => {
    const doRequest = (requestUrl, redirectCount) => {
      if (redirectCount > 10) return resolve({ ok: false, error: 'Too many redirects', url });
      let parsed;
      try {
        parsed = new URL(requestUrl);
      } catch (err) {
        return resolve({ ok: false, error: err.message, url });
      }
      const protocol = parsed.protocol === 'https:' ? https : http;
      const req = protocol.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: archiveDownloadHeaders(cookieHeader, referer),
        timeout: 30000,
      }, (res) => {
        const { statusCode, headers } = res;
        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          res.resume();
          let next = headers.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          doRequest(next, redirectCount + 1);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          return resolve({ ok: false, error: `HTTP ${statusCode} from ${parsed.hostname}`, url });
        }
        const file = fs.createWriteStream(destFile);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve({ ok: true, filePath: destFile, url });
        });
        file.on('error', err => {
          fs.unlink(destFile, () => {});
          resolve({ ok: false, error: err.message, url });
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Connection timed out', url });
      });
      req.on('error', err => resolve({ ok: false, error: err.message, url }));
      req.end();
    };
    doRequest(url, 0);
  });
}

async function inspectMarketplaceThemeFolder({ folderUrl } = {}) {
  if (!folderUrl) return { ok: false, error: 'Missing theme folder URL.' };
  const html = await fetchArchiveText(folderUrl);
  const listing = parseArchiveFolderListing(html, folderUrl.endsWith('/') ? folderUrl : `${folderUrl}/`);
  const classified = classifyThemeFolderFiles(listing.files);
  return {
    ok: true,
    folderUrl,
    directories: listing.directories,
    files: listing.files,
    ...classified,
    mapping: {
      live: classified.mainImages[0]?.url || '',
      games: classified.mainImages[1]?.url || '',
      media: classified.mainImages[2]?.url || '',
      system: classified.mainImages[3]?.url || '',
      marketplace: classified.mainImages[3]?.url || '',
    },
  };
}

async function downloadMarketplaceThemeFolder({ item = {}, folderUrl = '', title = '', force = false } = {}) {
  const effectiveFolderUrl = folderUrl || item.folderUrl || item.sourceUrl || '';
  if (!effectiveFolderUrl) return { ok: false, error: 'Missing theme folder URL.' };
  const displayTitle = title || item.title || 'Xbox 360 Theme';
  const detail = await inspectMarketplaceThemeFolder({ folderUrl: effectiveFolderUrl });
  if (!detail?.ok) return detail;
  if (detail.directories?.length && !detail.files?.length) {
    return {
      ok: false,
      error: 'This is a parent folder. Open one of the child theme folders before downloading.',
      requiresChildFolder: true,
      detail,
    };
  }
  const files = detail.files || [];
  if (!files.length) return { ok: false, error: 'No downloadable files were found in this theme folder.', detail };

  const themeId = safeThemeIdFromItem(item, displayTitle);
  const destDir = path.join(MARKETPLACE_THEMES_DIR, themeId);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const downloaded = [];
  for (const file of files) {
    const destFile = path.join(destDir, sanitizeFolderName(file.name || path.basename(file.url)));
    if (!force && fs.existsSync(destFile)) {
      downloaded.push({ ...file, filePath: destFile, fileUrl: filePathToFileUrl(destFile), cached: true });
      continue;
    }
    const result = await downloadArchiveFileToPath(file.url, destFile, effectiveFolderUrl);
    if (!result?.ok) return { ok: false, error: result?.error || 'Could not download theme file.', failedFile: file, downloaded, detail };
    downloaded.push({ ...file, filePath: destFile, fileUrl: filePathToFileUrl(destFile), cached: false });
  }

  const downloadedByUrl = new Map(downloaded.map(file => [file.url, file]));
  const localFor = source => source?.url ? downloadedByUrl.get(source.url)?.fileUrl || '' : '';
  const localMainImages = (detail.mainImages || []).map(localFor);
  const theme = {
    id: themeId,
    title: displayTitle,
    source: 'archiveorg',
    folderUrl: effectiveFolderUrl,
    installDir: destDir,
    thumbnail: localFor(detail.thumbnail) || localMainImages[0] || '',
    themeFile: localFor(detail.themeFile) || '',
    backgrounds: {
      image1: localMainImages[0] || '',
      image2: localMainImages[1] || '',
      image3: localMainImages[2] || '',
      image4: localMainImages[3] || '',
    },
  };

  fs.writeFileSync(path.join(destDir, 'skald-theme.json'), JSON.stringify({
    ...theme,
    downloadedAt: Date.now(),
    files: downloaded.map(file => ({
      name: file.name,
      url: file.url,
      filePath: file.filePath,
      fileUrl: file.fileUrl,
      extension: file.extension,
    })),
  }, null, 2));

  return { ok: true, theme, installDir: destDir, files: downloaded, detail };
}

function listDownloadedMarketplaceThemes() {
  if (!fs.existsSync(MARKETPLACE_THEMES_DIR)) {
    return { ok: true, themes: [], baseDir: MARKETPLACE_THEMES_DIR };
  }
  const themesById = new Map();
  for (const entry of fs.readdirSync(MARKETPLACE_THEMES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(MARKETPLACE_THEMES_DIR, entry.name, 'skald-theme.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const migrated = migrateDownloadedThemeManifest(rawManifest, path.dirname(manifestPath));
      const manifestDir = migrated.manifestDir;
      const manifest = rebuildDownloadedThemeManifest(migrated.manifest, manifestDir);
      if (!manifest?.id || !manifest?.backgrounds) continue;
      try {
        fs.writeFileSync(path.join(manifestDir, 'skald-theme.json'), JSON.stringify(manifest, null, 2));
      } catch {}
      themesById.set(manifest.id, {
        id: manifest.id,
        title: manifest.title || entry.name,
        source: manifest.source || 'local',
        folderUrl: manifest.folderUrl || '',
        installDir: manifest.installDir || path.join(MARKETPLACE_THEMES_DIR, entry.name),
        thumbnail: manifest.thumbnail || '',
        themeFile: manifest.themeFile || '',
        backgrounds: manifest.backgrounds || {},
        downloadedAt: manifest.downloadedAt || 0,
      });
    } catch {}
  }
  const themes = [...themesById.values()];
  themes.sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0) || a.title.localeCompare(b.title));
  return { ok: true, themes, baseDir: MARKETPLACE_THEMES_DIR };
}

function deleteDownloadedMarketplaceTheme({ themeId = '', installDir = '' } = {}) {
  const requestedPath = installDir || (themeId ? path.join(MARKETPLACE_THEMES_DIR, themeId) : '');
  if (!requestedPath) return { ok: false, error: 'Missing theme to delete.' };
  let resolved;
  try {
    resolved = path.resolve(requestedPath);
  } catch (err) {
    return { ok: false, error: err.message || 'Invalid theme path.' };
  }
  const root = path.resolve(MARKETPLACE_THEMES_DIR);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return { ok: false, error: 'Theme folder is outside the SKALD theme cache.' };
  }
  const manifestPath = path.join(resolved, 'skald-theme.json');
  if (!fs.existsSync(resolved) || !fs.existsSync(manifestPath)) {
    return { ok: false, error: 'Downloaded theme was not found.' };
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return { ok: true, deleted: resolved };
}

async function fetchMarketplaceThemesCatalog({ force = false } = {}) {
  const maxAgeMs = 1000 * 60 * 15;
  if (!force && marketplaceThemesCatalogCache && Date.now() - marketplaceThemesCatalogCacheAt < maxAgeMs) {
    return { ...marketplaceThemesCatalogCache, cached: true };
  }
  const sourceResults = await Promise.allSettled(MARKETPLACE_THEME_SOURCES.map(async source => {
    const html = await fetchArchiveText(source.url);
    return { source, items: parseArchiveThemeDirectory(html, source) };
  }));
  const items = [];
  const errors = [];
  sourceResults.forEach(result => {
    if (result.status === 'fulfilled') {
      items.push(...result.value.items);
    } else {
      errors.push(result.reason?.message || String(result.reason || 'Unknown error'));
    }
  });
  const payload = {
    ok: items.length > 0 || errors.length === 0,
    items,
    errors,
    sources: MARKETPLACE_THEME_SOURCES.map(({ id, label, url, isCustom }) => ({ id, label, url, isCustom })),
    fetchedAt: Date.now(),
  };
  marketplaceThemesCatalogCache = payload;
  marketplaceThemesCatalogCacheAt = Date.now();
  return { ...payload, cached: false };
}

async function probeArchiveDownloadAccess(downloadUrl) {
  if (!downloadUrl) return { ok: false, error: 'Missing download URL.' };
  const cookieHeader = archiveUrlRequiresAuth(downloadUrl) ? await buildArchiveCookieHeader() : '';
  const status = archiveUrlRequiresAuth(downloadUrl) ? await getArchiveStatus() : { loggedIn: false };
  const redirects = [];

  return new Promise((resolve) => {
    const doRequest = (url, redirectCount) => {
      if (redirectCount > 10) {
        return resolve({ ok: false, error: 'Too many redirects', loggedIn: !!status?.loggedIn, hasCookieHeader: !!cookieHeader, redirects });
      }

      const parsed = new URL(url);
      const protocol = parsed.protocol === 'https:' ? https : http;
      const req = protocol.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          ...archiveDownloadHeaders(cookieHeader),
          'Range': 'bytes=0-0',
        },
        timeout: 30000,
      }, (res) => {
        const { statusCode, headers } = res;
        redirects.push({
          url,
          statusCode,
          location: headers.location || '',
          contentType: headers['content-type'] || '',
          contentLength: headers['content-length'] || '',
          contentRange: headers['content-range'] || '',
        });

        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          res.resume();
          let next = headers.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          doRequest(next, redirectCount + 1);
          return;
        }

        res.resume();
        resolve({
          ok: statusCode === 200 || statusCode === 206,
          statusCode,
          finalUrl: url,
          loggedIn: !!status?.loggedIn,
          username: status?.username || null,
          hasCookieHeader: !!cookieHeader,
          redirects,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Connection timed out', loggedIn: !!status?.loggedIn, hasCookieHeader: !!cookieHeader, redirects });
      });
      req.on('error', err => {
        resolve({ ok: false, error: err.message, loggedIn: !!status?.loggedIn, hasCookieHeader: !!cookieHeader, redirects });
      });
      req.end();
    };

    doRequest(downloadUrl, 0);
  });
}

async function performDownloadJob(event, { identifier, downloadUrl, fileName }) {
  const settings    = loadSettings();
  const downloadDir = settings.downloadPath || DEFAULT_GAMES_DIR;
  const destDir     = path.join(downloadDir, sanitizeFolderName(identifier));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const safeFileName = path.basename(fileName);
  const destFile     = path.join(destDir, safeFileName);
  const cookieHeader = archiveUrlRequiresAuth(downloadUrl) ? await buildArchiveCookieHeader() : '';

  return new Promise((resolve) => {
    let cancelled = false;

    activeDownloads.set(identifier, {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: 'Cancelled' });
      },
      req: null,
      file: null,
    });

    const doRequest = (url, redirectCount) => {
      if (cancelled) return;
      if (redirectCount > 10) {
        activeDownloads.delete(identifier);
        return resolve({ ok: false, error: 'Too many redirects' });
      }

      const parsed   = new URL(url);
      const isHttps  = parsed.protocol === 'https:';
      const protocol = isHttps ? https : http;

      const req = protocol.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: archiveDownloadHeaders(cookieHeader),
        timeout: 30000,
      }, (res) => {
        if (cancelled) { res.resume(); return; }

        const { statusCode, headers } = res;

        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          req.destroy();
          res.resume();
          let next = headers.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          doRequest(next, redirectCount + 1);
          return;
        }

        if (statusCode !== 200) {
          res.resume();
          activeDownloads.delete(identifier);
          return resolve({ ok: false, error: `HTTP ${statusCode} from ${parsed.hostname}` });
        }

        const total  = parseInt(headers['content-length'] || '0', 10);
        let received = 0;
        const file   = fs.createWriteStream(destFile);

        const entry = activeDownloads.get(identifier);
        if (entry) { entry.req = req; entry.file = file; }

        res.on('data', chunk => {
          if (cancelled) return;
          received += chunk.length;
          if (total > 0) {
            try {
              if (event?.sender && !event.sender.isDestroyed()) {
                event.sender.send('download-progress', { identifier, percent: Math.round(received / total * 100) });
              }
            } catch {}
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          if (cancelled) return;
          file.close();
          activeDownloads.delete(identifier);
          resolve({ ok: true, filePath: destFile });
        });

        file.on('error', err => {
          if (cancelled) return;
          fs.unlink(destFile, () => {});
          activeDownloads.delete(identifier);
          resolve({ ok: false, error: err.message });
        });
      });

      const entry = activeDownloads.get(identifier);
      if (entry) entry.req = req;

      req.on('timeout', () => {
        if (cancelled) return;
        req.destroy();
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: 'Connection timed out' });
      });

      req.on('error', err => {
        if (cancelled) return;
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: err.message });
      });

      req.end();
    };

    doRequest(downloadUrl, 0);
  });
}

async function extractArchiveInternal({ filePath, identifier, subFolder }) {
  const settings       = loadSettings();
  const installBase    = settings.installPath || DEFAULT_GAMES_DIR;
  const parentDir      = path.join(installBase, sanitizeFolderName(identifier));
  const destDir = subFolder
    ? path.join(parentDir, '_GAME_' + sanitizeFolderName(subFolder))
    : parentDir;

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const ext    = filePath.toLowerCase();
  const sevenZ = 'C:\\Program Files\\7-Zip\\7z.exe';

  const unblockAfterExtract = () => unblockDirectory(destDir);

  if ((ext.endsWith('.zip') || ext.endsWith('.7z') || ext.endsWith('.rar')) && fs.existsSync(sevenZ)) {
    return new Promise((resolve) => {
      execFile(sevenZ, ['x', filePath, `-o${destDir}`, '-y'], async (err) => {
        if (err) return resolve({ ok: false, error: err.message });
        await unblockAfterExtract();
        if (settings.deleteAfterInstall) {
          fs.unlink(filePath, () => {
            try { fs.rmdirSync(path.dirname(filePath)); } catch {}
          });
        }
        resolve({ ok: true, installDir: destDir, parentInstallDir: parentDir });
      });
    });
  }

  if (ext.endsWith('.zip')) {
    try {
      const extractZip = require('extract-zip');
      await extractZip(filePath, { dir: destDir });
      await unblockAfterExtract();
      if (settings.deleteAfterInstall) {
        fs.unlink(filePath, () => {
          try { fs.rmdirSync(path.dirname(filePath)); } catch {}
        });
      }
      return { ok: true, installDir: destDir, parentInstallDir: parentDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { ok: false, error: 'Unsupported archive format' };
}

function installGameRecord({ identifier, installDir, exePath, title = null, system = null, sourceType = 'marketplace_download', provider = null, catalogIdentifier = null, matchConfidence = 1 }) {
  if (!db) return { ok: false };
  db.prepare(`
    INSERT OR REPLACE INTO games (identifier, install_dir, exe_path, added_at)
    VALUES (?, ?, ?, ?)
  `).run(identifier, installDir, exePath || null, Date.now());
  db.prepare(`
    UPDATE games
    SET title = COALESCE(?, title),
        system = COALESCE(?, system),
        source_type = COALESCE(?, source_type),
        provider = COALESCE(?, provider),
        catalog_identifier = COALESCE(?, catalog_identifier),
        match_confidence = COALESCE(?, match_confidence),
        date_modified = ?
    WHERE identifier = ?
  `).run(title, system, sourceType, provider, catalogIdentifier, matchConfidence, Date.now(), identifier);
  return { ok: true };
}

async function marketplaceInstallJob(event, {
  identifier,
  downloadUrl,
  fileName,
  title = null,
  system = null,
  provider = null,
  sourceType = 'marketplace_download',
  catalogIdentifier = null,
  matchConfidence = 1,
  subFolder = null,
}) {
  if (!identifier || !downloadUrl || !fileName) {
    return { ok: false, error: 'Missing download information.' };
  }

  if (archiveUrlRequiresAuth(downloadUrl)) {
    const status = await getArchiveStatus();
    if (!status?.loggedIn) {
      return { ok: false, error: 'Archive.org sign-in is required before downloading this game.', requiresAuth: true, provider: 'archiveorg' };
    }
  }

  const downloadResult = await performDownloadJob(event, { identifier, downloadUrl, fileName });
  if (!downloadResult?.ok) return downloadResult;

  const settings = loadSettings();
  const directExts = ['.chd', '.cue', '.bin', '.img', '.sfc', '.smc', '.nes', '.gba', '.n64'];
  const shouldExtract = !!settings.extractArchive && !directExts.some(ext => downloadResult.filePath.toLowerCase().endsWith(ext));

  let installDir = downloadResult.filePath;
  let extractResult = null;
  if (shouldExtract) {
    try {
      if (event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('download-progress', { identifier, percent: 100, stage: 'extracting' });
      }
    } catch {}
    extractResult = await extractArchiveInternal({ filePath: downloadResult.filePath, identifier, subFolder });
    if (!extractResult?.ok) return extractResult;
    installDir = extractResult.installDir;
  }

  const installResult = installGameRecord({
    identifier,
    installDir,
    exePath: null,
    title,
    system,
    sourceType,
    provider,
    catalogIdentifier,
    matchConfidence,
  });
  if (!installResult?.ok) return installResult;

  return {
    ok: true,
    filePath: downloadResult.filePath,
    installDir,
    extracted: !!extractResult,
    parentInstallDir: extractResult?.parentInstallDir || null,
  };
}

// Fetch archive.org metadata/file list via main process (avoids renderer CSP issues)
ipcMain.handle('fetch-file-list', async (_, { identifier }) => {
  return new Promise((resolve) => {
    const url = `https://archive.org/metadata/${identifier}`;
    https.get(url, { headers: { 'User-Agent': 'RohanKar-Launcher/0.4' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ ok: true, files: json.files || [] });
        } catch (e) {
          resolve({ ok: false, error: e.message, files: [] });
        }
      });
    }).on('error', err => resolve({ ok: false, error: err.message, files: [] }));
  });
});

// Sanitize an archive.org identifier for safe use as a folder name.
// Windows forbids names ending with a dot or space.
function sanitizeFolderName(name) {
  return name.replace(/[.\s]+$/, '').replace(/[<>:"/\\|?*]/g, '_') || '_';
}

ipcMain.handle('download-start', async (event, { identifier, downloadUrl, fileName }) => {
  return performDownloadJob(event, { identifier, downloadUrl, fileName });
});

ipcMain.handle('archiveorg-probe-download', async (_, { downloadUrl }) => probeArchiveDownloadAccess(downloadUrl));
ipcMain.handle('marketplace-themes-catalog', async (_, opts = {}) => fetchMarketplaceThemesCatalog(opts));
ipcMain.handle('marketplace-theme-folder-inspect', async (_, opts = {}) => inspectMarketplaceThemeFolder(opts));
ipcMain.handle('marketplace-theme-folder-download', async (_, opts = {}) => downloadMarketplaceThemeFolder(opts));
ipcMain.handle('marketplace-themes-downloaded', async () => listDownloadedMarketplaceThemes());
ipcMain.handle('marketplace-theme-delete', async (_, opts = {}) => deleteDownloadedMarketplaceTheme(opts));

ipcMain.handle('download-cancel', (_, { identifier }) => {
  const dl = activeDownloads.get(identifier);
  if (dl) {
    // Call the cancel hook — resolves the promise and cleans up
    if (typeof dl.cancel === 'function') dl.cancel();
    // Also destroy req/file if they exist
    try { dl.req?.destroy(); }  catch {}
    try { dl.file?.close();  }  catch {}
    activeDownloads.delete(identifier);
  }
  return { ok: true };
});

// ─── Extract ──────────────────────────────────────────────────────────────────

ipcMain.handle('extract-archive', async (_, { filePath, identifier, subFolder }) => {
  return extractArchiveInternal({ filePath, identifier, subFolder });
});

// ─── Find executables in install dir ─────────────────────────────────────────
//
// File structure convention:
//   installDir/          ← e.g. at_20251025\
//     Alien Trilogy\     ← game subfolder (first non-ignored subdir)
//       Launch Alien Trilogy.exe   ← list these
//       DOSBoxPure.exe             ← list these
//       GAME\            ← do NOT recurse into this
//       saves\           ← do NOT recurse into this
//     Extras\            ← ignored (not the game subfolder)
//     hero.png           ← ignored
//     Readme.txt         ← ignored
//
// We return only the .exe files directly inside the game subfolder (depth 1).
// This prevents hundreds of DOSBox/game-internal exes from flooding the picker.

const IGNORED_SUBDIRS = new Set(['extras', 'extra', 'bonus', 'soundtrack', 'manuals', 'manual']);

ipcMain.handle('find-exes', (_, { installDir }) => {
  try {
    return findExesInDir(installDir);
  } catch { return []; }
});

// ─── Launch + playtime ────────────────────────────────────────────────────────

// Recursively delete Zone.Identifier alternate data streams from all files under a directory.
// This is what right-click → Unblock does on Windows, but done directly via Node fs.
function unblockDirectory(dir) {
  if (process.platform !== 'win32') return Promise.resolve();
  let count = 0;
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        // Delete the Zone.Identifier ADS — this is exactly what Unblock-File does
        try {
          fs.rmSync(full + ':Zone.Identifier');
          count++;
        } catch { /* stream doesn't exist or already removed — fine */ }
      }
    }
  }
  walk(dir);
  console.log(`[unblock] Removed Zone.Identifier from ${count} files in ${dir}`);
  return Promise.resolve();
}

ipcMain.handle('launch-game', (_, { identifier, exePath }) => {
  return new Promise(async (resolve) => {
    if (!fs.existsSync(exePath)) return resolve({ ok: false, error: 'Executable not found: ' + exePath });

    // Unblock the install directory on every launch — covers both freshly installed
    // games and games that were installed before this fix was added.
    const gameRow     = db?.prepare('SELECT install_dir FROM games WHERE identifier = ?').get(identifier);
    const unblockRoot = gameRow?.install_dir || path.dirname(exePath);
    await unblockDirectory(unblockRoot);

    const start = Date.now();

    // shell.openPath uses Windows ShellExecute — handles UAC elevation prompts
    // correctly, unlike execFile which just gets EACCES on elevated exes.
    shell.openPath(exePath).then((errMsg) => {
      if (errMsg) {
        resolve({ ok: false, error: errMsg });
      } else {
        if (identifier) markGamePlayed(identifier);
        // Track playtime roughly — we can't watch the process directly with openPath
        // so we record a start time and write it when the launcher is next focused.
        resolve({ ok: true });
        // Rich presence: update Stoat status with game being played
        const gameName = identifier.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        stoat.setPresence('Playing ' + gameName).catch(() => {});
      }
    });
  });
});

// ─── Open game location in Explorer ──────────────────────────────────────────

ipcMain.handle('open-game-location', (_, { installDir }) => {
  try {
    if (!fs.existsSync(installDir)) return { ok: false, error: 'Folder not found' };
    // Use 'explorer' on Windows, 'open' on Mac, 'xdg-open' on Linux
    const cmd = process.platform === 'darwin' ? 'open'
              : process.platform === 'linux'  ? 'xdg-open'
              : 'explorer';
    execFile(cmd, [installDir]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Read readme from install dir ────────────────────────────────────────────

ipcMain.handle('read-readme', (_, { installDir }) => {
  try {
    if (!fs.existsSync(installDir)) return { ok: false, text: null };

    const entries = fs.readdirSync(installDir, { withFileTypes: true });

    // Find a file whose name starts with "readme" (case-insensitive) in the root only
    const readmeEntry = entries.find(e =>
      e.isFile() && /^readme/i.test(e.name) && /\.(txt|md|nfo|doc|rtf|htm|html|1st)$/i.test(e.name)
    ) || entries.find(e =>
      // Also catch extensionless "README" files
      e.isFile() && /^readme$/i.test(e.name)
    );

    if (!readmeEntry) return { ok: true, text: null };

    const filePath = path.join(installDir, readmeEntry.name);
    const raw = fs.readFileSync(filePath, 'latin1'); // latin1 handles old DOS/Windows text files
    return { ok: true, text: raw, fileName: readmeEntry.name };
  } catch (e) {
    return { ok: false, error: e.message, text: null };
  }
});

// ─── Startup: validate installs + scan for pre-existing games ───────────────────
//
// Called once after the window is ready. Two jobs:
//   1. Validate — any DB row with install_dir that no longer exists on disk gets cleared.
//   2. Scan — look in the install/download dirs for folders matching known identifiers
//      that aren't already registered, and auto-register them.

// Walk a directory tree looking for .exe files.
// Strategy: scan the current directory for .exe files. If found, return them.
// If not, recurse into non-ignored subdirectories (breadth-first by level) and
// return the exes from the FIRST level that contains any. This handles installs
// that are nested arbitrarily deep (e.g. identifier/ -> Game Name/ -> Game Name/ -> .exe)
// Depth limit prevents runaway recursion on large installs.
function findExesInDir(installDir, _depth) {
  const MAX_DEPTH = 5;
  const depth = _depth || 0;
  if (depth > MAX_DEPTH) return [];

  try {
    let entries;
    try { entries = fs.readdirSync(installDir, { withFileTypes: true }); }
    catch { return []; }

    // ── Collection detection ─────────────────────────────────────────────────
    // If this folder contains _GAME_ prefixed subfolders, it's a multi-game
    // collection. Scan each _GAME_ subfolder and return ALL their exes so the
    // picker can list them grouped by game name.
    const gameFolders = entries.filter(
      e => e.isDirectory() && e.name.startsWith('_GAME_')
    );
    if (gameFolders.length > 0) {
      const allExes = [];
      for (const gf of gameFolders) {
        const gameDir  = path.join(installDir, gf.name);
        // Recurse into each game subfolder to find its exe
        const gameExes = findExesInDir(gameDir, depth + 1);
        allExes.push(...gameExes);
      }
      return allExes;
    }

    // ── Standard single-game detection ───────────────────────────────────────
    // Check for a 'bin' subfolder first — common pattern for some games
    const binEntry = entries.find(
      e => e.isDirectory() && e.name.toLowerCase() === 'bin'
    );
    if (binEntry) {
      const binExes = exesInDir(path.join(installDir, binEntry.name));
      if (binExes.length) return binExes;
    }

    // Collect .exe files directly in this folder
    const localExes = exesInDir(installDir);
    if (localExes.length) return localExes;

    // No exes here — recurse into non-ignored subdirectories
    const subdirs = entries.filter(
      e => e.isDirectory() && !IGNORED_SUBDIRS.has(e.name.toLowerCase())
    );

    for (const sub of subdirs) {
      const found = findExesInDir(path.join(installDir, sub.name), depth + 1);
      if (found.length) return found;
    }

    return [];
  } catch { return []; }
}

// Return .exe files directly inside a single directory (no recursion)
function exesInDir(dir) {
  try {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        results.push(path.join(dir, entry.name));
      }
    }
    return results;
  } catch { return []; }
}

function validateInstalls() {
  if (!db) return { cleared: 0 };
  const rows = db.prepare('SELECT identifier, install_dir FROM games WHERE install_dir IS NOT NULL').all();
  let cleared = 0;
  for (const row of rows) {
    if (!fs.existsSync(row.install_dir)) {
      db.prepare('UPDATE games SET install_dir = NULL, exe_path = NULL WHERE identifier = ?').run(row.identifier);
      console.log(`[validate] Cleared missing install: ${row.identifier}`);
      cleared++;
    }
  }
  if (cleared > 0) console.log(`[validate] Cleared ${cleared} missing installs`);
  return { cleared };
}

// Sanitize a game title into a safe Windows folder name the same way a browser
// download would (strips illegal chars, trims trailing dots/spaces).
function sanitizeTitle(title) {
  return String(title)
    .replace(/[<>:"/\\|?*]/g, '_')   // replace Windows-illegal chars with _
    .replace(/[.\s]+$/, '')           // strip trailing dots and spaces
    .trim();
}

function normalizeScanName(title) {
  return sanitizeTitle(title)
    // Strip common ROM set / release tags like [!], [a1], [T+Eng], etc.
    .replace(/\[[^\]]*\]/g, ' ')
    // Strip generic parenthetical tags commonly found in ROM names.
    .replace(/\((?:[A-Z]{1,5}|[A-Z]{1,5},\s*[A-Z]{1,5}|Rev[^)]*|Beta[^)]*|Proto[^)]*|Sample[^)]*|Demo[^)]*|Unl[^)]*|Pirate[^)]*|Aftermarket[^)]*|NTSC|PAL|USA|Europe|Japan|World|En(?:,[A-Za-z]+)?|Fr(?:,[A-Za-z]+)?|De(?:,[A-Za-z]+)?|Es(?:,[A-Za-z]+)?|It(?:,[A-Za-z]+)?|JU|U|J|E)\)/gi, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();
}

// Build a lookup: sanitized-title (lowercase) → original title
// so we can do case-insensitive folder-name matching.
function buildTitleLookup(titleMap) {
  const lookup = {}; // normalizedTitle → { original, identifier }
  for (const [title, identifier] of Object.entries(titleMap || {})) {
    const normalized = normalizeScanName(title);
    if (normalized) lookup[normalized] = { original: title, identifier };
  }
  return lookup;
}

// Scan a directory for pre-existing game installs.
// knownIdentifiers = array of identifier strings from the renderer.
// titleMap         = { gameTitle: identifier } for title-based matching.
// Returns { found: [ { identifier, installDir, exePath, matchedBy } ] }
ipcMain.handle('scan-for-games', (_, { scanDir, knownIdentifiers, titleMap, system = '' }) => {
  if (!db || !scanDir || !fs.existsSync(scanDir)) return { found: [] };

  const identifierSet  = new Set(knownIdentifiers);
  const titleLookup    = buildTitleLookup(titleMap);
  const found          = [];
  const ROM_EXTS       = new Set(['.sfc', '.smc', '.snes', '.nes', '.gba', '.gbc', '.gb', '.md', '.gen', '.smd', '.n64', '.z64', '.v64', '.nds', '.pce', '.chd', '.cue', '.bin', '.img', '.zip', '.iso', '.cso', '.pbp']);

  let entries;
  try { entries = fs.readdirSync(scanDir, { withFileTypes: true }); }
  catch { return { found: [] }; }

  function buildLocalIdentifier(rawName, entryPath) {
    const crypto = require('crypto');
    const digest = crypto.createHash('sha1').update(`${system}::${entryPath}`).digest('hex').slice(0, 10);
    return `local::${system || 'unknown'}::${sanitizeFolderName(rawName)}::${digest}`;
  }

  function matchEntryName(rawName) {
    let matchedId = null;
    let matchedBy = null;
    let matchedTitle = null;
    let matchConfidence = 0;

    if (identifierSet.has(rawName)) {
      matchedId = rawName;
      matchedBy = 'identifier';
      matchedTitle = rawName;
      matchConfidence = 1;
    }

    if (!matchedId) {
      for (const id of identifierSet) {
        if (sanitizeFolderName(id) === rawName) {
          matchedId = id;
          matchedBy = 'identifier-sanitized';
          matchedTitle = id;
          matchConfidence = 0.95;
          break;
        }
      }
    }

    if (!matchedId && titleLookup) {
        const normalized = normalizeScanName(rawName);
        const hit = titleLookup[normalized];
      if (hit) {
        matchedId = hit.identifier;
        matchedBy = 'title';
        matchedTitle = hit.original || hit.identifier;
        matchConfidence = 0.9;
      }
    }

    return { matchedId, matchedBy, matchedTitle, matchConfidence };
  }

  for (const entry of entries) {
    const entryPath = path.join(scanDir, entry.name);
    const entryNameForMatch = entry.isFile()
      ? path.parse(entry.name).name
      : entry.name;
      const { matchedId, matchedBy, matchedTitle, matchConfidence } = matchEntryName(entryNameForMatch);

      let installTarget = entryPath;
      let exePath = null;

      if (entry.isDirectory()) {
        const exes = findExesInDir(entryPath);
        exePath = exes.length === 1 ? exes[0] : null;
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ROM_EXTS.has(ext)) continue;
      } else {
        continue;
      }

      const identifier = matchedId || buildLocalIdentifier(entryNameForMatch, entryPath);
      const existing = db.prepare('SELECT install_dir FROM games WHERE identifier = ?').get(identifier);
      if (existing?.install_dir && fs.existsSync(existing.install_dir)) continue;

      const displayTitle = matchedTitle || entryNameForMatch;
      const sourceType = matchedId ? 'catalog_import' : 'local_scan';

      // Register it
      db.prepare(`
        INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)
      `).run(identifier, Date.now());
      db.prepare(`
        UPDATE games
        SET install_dir = ?, exe_path = ?, title = ?, system = ?, source_type = ?, provider = COALESCE(provider, ?), catalog_identifier = ?, match_confidence = ?, date_modified = ?
        WHERE identifier = ?
      `).run(installTarget, exePath, displayTitle, system || null, sourceType, sourceType === 'catalog_import' ? 'archiveorg' : 'local', matchedId || null, matchConfidence || 0, Date.now(), identifier);

      console.log(`[scan] Found ${matchedId ? 'catalog-linked' : 'local'} install (${matchedBy || 'filename'}): ${identifier} → ${installTarget}`);
      found.push({
        identifier,
        installDir: installTarget,
        exePath,
        matchedBy: matchedBy || 'filename',
        title: displayTitle,
        catalogIdentifier: matchedId || null,
        system: system || '',
        matchConfidence: matchConfidence || 0,
        sourceType,
      });
    }

  return { found };
});

// ─── Install / Delete ─────────────────────────────────────────────────────────

ipcMain.handle('install-game', (_, { identifier, installDir, exePath, title = null, system = null, sourceType = 'marketplace_download', provider = null, catalogIdentifier = null, matchConfidence = 1 }) => {
  return installGameRecord({ identifier, installDir, exePath, title, system, sourceType, provider, catalogIdentifier, matchConfidence });
});

ipcMain.handle('marketplace-install', async (event, payload) => marketplaceInstallJob(event, payload));

ipcMain.handle('set-exe-path', (_, { identifier, exePath }) => {
  if (!db) return { ok: false };
  ensureGameRow(identifier);
  db.prepare('UPDATE games SET exe_path = ?, date_modified = ? WHERE identifier = ?').run(exePath || null, Date.now(), identifier);
  return { ok: true };
});

ipcMain.handle('delete-game', async (_, { identifier, installDir }) => {
  try {
    console.log(`[delete] identifier=${identifier} installDir=${installDir}`);
    const existing = db ? db.prepare('SELECT install_dir, source_type FROM games WHERE identifier = ?').get(identifier) : null;
    const sourceType = existing?.source_type || null;
    const effectiveInstallDir = existing?.install_dir || installDir;
    if (effectiveInstallDir) {
      if (sourceType === 'local_scan') {
        console.log(`[delete] Local scan entry detected — removing from library only: ${effectiveInstallDir}`);
      } else if (effectiveInstallDir && fs.existsSync(effectiveInstallDir)) {
        // Use shell.trashItem to move to Recycle Bin — avoids EPERM on locked folders
        // and is safer than force-deleting since the user can recover files if needed.
        await shell.trashItem(effectiveInstallDir);
        console.log(`[delete] Moved to Recycle Bin: ${effectiveInstallDir}`);
      } else {
        console.log(`[delete] Folder not found on disk (already gone?): ${effectiveInstallDir}`);
      }
    } else {
      console.log(`[delete] No installDir provided — only clearing DB entry`);
    }
    if (db) db.prepare('DELETE FROM games WHERE identifier = ?').run(identifier);
    return { ok: true };
  } catch (e) {
    console.error(`[delete] Failed:`, e.message);
    return { ok: false, error: e.message };
  }
});

// ─── Archive.org Login ───────────────────────────────────────────────────────
//
// Opens a hidden BrowserWindow that POSTs to archive.org's xauthn login API.
// On success, archive.org sets logged-in-user and logged-in-sig cookies on the
// default Electron session, which are then sent automatically on all subsequent
// requests from both main process and renderer (including fetch() calls).

// Simple encryption for stored credentials using a machine-specific key.
// Not bank-vault security, but protects against casual file browsing.
function getCredentialKey() {
  const crypto = require('crypto');
  // Derive a consistent key from the userData path (machine-specific)
  return crypto.createHash('sha256').update(USER_DATA + 'skald-v1').digest();
}

function encryptCredential(plaintext) {
  const crypto = require('crypto');
  const iv  = crypto.randomBytes(16);
  const key = getCredentialKey();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptCredential(ciphertext) {
  try {
    const crypto = require('crypto');
    const [ivHex, encHex] = ciphertext.split(':');
    const iv        = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const key       = getCredentialKey();
    const decipher  = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch { return null; }
}

// Auto-login on startup: re-uses existing session cookies if still valid,
// otherwise logs in fresh with saved credentials.
ipcMain.handle('archiveorg-autologin', async () => restoreArchiveSession());

ipcMain.handle('archiveorg-save-credentials', (_, { email, password }) => {
  console.log('[save-credentials] archive.org email:', email ? email : '(null)', 'hasPassword:', !!password);
  return saveThirdPartyAccount('archiveorg', {
    login: email || '',
    secret: password || '',
    saveToProfile: !!(email && password),
  });
});

ipcMain.handle('archiveorg-get-credentials', () => {
  const acct = readThirdPartyAccount('archiveorg');
  if (!acct?.login || !acct?.secret) return { ok: false };
  return { ok: true, email: acct.login, password: acct.secret };
});

ipcMain.handle('archiveorg-login', async (_, { email, password }) => performArchiveLogin(email, password));

ipcMain.handle('archiveorg-logout', async () => logoutArchiveSession());

ipcMain.handle('archiveorg-check', async () => getArchiveStatus());

// ─── Auto-updater ────────────────────────────────────────────────────────────
//
// electron-updater checks GitHub releases on launch, downloads in background,
// and sends IPC events to the renderer so the UI can show a non-intrusive bar.
//
// In development (app.isPackaged === false) we skip the update check entirely
// so you don't get errors about missing release files.

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[updater] Dev mode — skipping update check');
    return;
  }

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.error('[updater] electron-updater not available:', e.message);
    return;
  }

  autoUpdater.autoDownload         = false; // don't auto-download — GitHub releases don't report progress
  autoUpdater.allowDowngrade        = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update…');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);

    // Fetch release notes from GitHub API
    const releaseUrl = `https://api.github.com/repos/Kilted-Kraken/SKALD/releases/tags/v${info.version}`;
    const fetchNotes = () => new Promise((resolve) => {
      https.get(releaseUrl, {
        headers: {
          'User-Agent':  'RohanKar-Launcher',
          'Accept':      'application/vnd.github+json',
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json  = JSON.parse(data);
            resolve(json.body || null);   // GitHub release body is markdown
          } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });

    fetchNotes().then((releaseNotes) => {
      mainWindow?.webContents.send('updater-status', {
        status:       'available',
        version:      info.version,
        releaseNotes: releaseNotes || null,
        releaseDate:  info.releaseDate || null,
      });
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Up to date.');
  });

  // No download-progress or update-downloaded handlers needed —
  // we send users to GitHub to download manually instead.

  autoUpdater.on('error', (err) => {
    const msg = err.message || '';
    // 404 = no GitHub release published yet, not a real error worth surfacing
    if (msg.includes('404')) {
      console.log('[updater] No published release found yet — skipping update check.');
      return;
    }
    console.error('[updater] Error:', msg);
    mainWindow?.webContents.send('updater-status', {
      status:  'error',
      message: msg,
    });
  });

  // Check after the window is ready so the user sees the UI first
  mainWindow?.once('ready-to-show', () => {
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
  });

}  

// IPC: renderer asks to download update — always registered, opens GitHub releases page
ipcMain.removeHandler('updater-install');
ipcMain.handle('updater-install', () => {
  shell.openExternal('https://github.com/Kilted-Kraken/SKALD/releases/latest');
});

// ─── Add to Steam ───────────────────────────────────────────────────────────
//
// Writes a non-Steam game shortcut into Steam's shortcuts.vdf binary file.
// This is the same approach used by Heroic Games Launcher.
// After writing, Steam must be restarted for the shortcut to appear.

function findSteamPath() {
  if (process.platform === 'win32') {
    // Try registry first
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
        { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
      );
      const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (match) {
        const p = match[1].trim();
        if (fs.existsSync(p)) return p;
      }
    } catch {}
    // Fallback to common paths
    const candidates = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      path.join(process.env.ProgramFiles || '', 'Steam'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Steam'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

function getSteamUserIds(steamPath) {
  const userdataDir = path.join(steamPath, 'userdata');
  if (!fs.existsSync(userdataDir)) return [];
  return fs.readdirSync(userdataDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d+$/.test(e.name) && e.name !== '0')
    .map(e => e.name);
}

// ─── Binary VDF shortcuts.vdf parser / writer ─────────────────────────────────
// Valve's binary VDF format (used for shortcuts.vdf):
//   \x00key\x00  = object/sub-map start
//   \x01key\x00value\x00 = string value
//   \x02key\x00<4-byte LE int32> = int32 value
//   \x08 = end of object

function readVdfShortcuts(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const buf = fs.readFileSync(filePath);
  const shortcuts = [];
  let i = 0;

  // Skip root object header (\x00shortcuts\x00)
  if (buf[i] === 0x00) {
    i++; // type byte
    while (i < buf.length && buf[i] !== 0x00) i++; // skip key string
    i++; // null terminator
  }

  while (i < buf.length) {
    if (buf[i] === 0x08) break; // end of root
    if (buf[i] !== 0x00) { i++; continue; } // unexpected byte — skip
    i++; // type 0x00 = object

    // Read index key (e.g. "0", "1", "2")
    while (i < buf.length && buf[i] !== 0x00) i++;
    i++; // null terminator after key

    // Read object fields until 0x08
    const entry = {};
    while (i < buf.length && buf[i] !== 0x08) {
      const type = buf[i]; i++;
      // Read key string
      let key = '';
      while (i < buf.length && buf[i] !== 0x00) { key += String.fromCharCode(buf[i]); i++; }
      i++; // null terminator

      if (type === 0x01) {
        // String value
        let val = '';
        while (i < buf.length && buf[i] !== 0x00) { val += String.fromCharCode(buf[i]); i++; }
        i++;
        entry[key] = val;
      } else if (type === 0x02) {
        // Int32 LE
        entry[key] = buf.readInt32LE(i);
        i += 4;
      } else if (type === 0x00) {
        // Nested object (e.g. tags) — read and skip
        const nested = {};
        while (i < buf.length && buf[i] !== 0x08) {
          const ntype = buf[i]; i++;
          let nkey = '';
          while (i < buf.length && buf[i] !== 0x00) { nkey += String.fromCharCode(buf[i]); i++; }
          i++;
          if (ntype === 0x01) {
            let nval = '';
            while (i < buf.length && buf[i] !== 0x00) { nval += String.fromCharCode(buf[i]); i++; }
            i++;
            nested[nkey] = nval;
          } else if (ntype === 0x02) {
            nested[nkey] = buf.readInt32LE(i); i += 4;
          }
        }
        i++; // 0x08 end of nested
        entry[key] = nested;
      } else {
        // Unknown type — stop parsing this entry
        break;
      }
    }
    if (buf[i] === 0x08) i++; // end of entry
    if (Object.keys(entry).length > 0) shortcuts.push(entry);
  }
  return shortcuts;
}

function writeVdfShortcuts(filePath, shortcuts) {
  const parts = [];

  const writeStr = (s) => {
    const b = Buffer.from(s + '\x00', 'latin1');
    parts.push(b);
  };
  const writeInt32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    parts.push(b);
  };
  const writeByte = (n) => parts.push(Buffer.from([n]));

  // Root object header: \x00 shortcuts \x00
  writeByte(0x00);
  writeStr('shortcuts');

  shortcuts.forEach((entry, idx) => {
    writeByte(0x00);          // type: object
    writeStr(String(idx));    // index key

    const writeField = (type, key, value) => {
      writeByte(type);
      writeStr(key);
      if (type === 0x01) writeStr(value);
      else if (type === 0x02) writeInt32(value);
    };

    writeField(0x02, 'appid',              entry.appid              || 0);
    writeField(0x01, 'appname',            entry.appname            || entry.AppName || '');
    writeField(0x01, 'Exe',                entry.Exe                || entry.exe     || '');
    writeField(0x01, 'StartDir',           entry.StartDir           || '');
    writeField(0x01, 'icon',               entry.icon               || '');
    writeField(0x01, 'ShortcutPath',       entry.ShortcutPath       || '');
    writeField(0x01, 'LaunchOptions',      entry.LaunchOptions      || '');
    writeField(0x02, 'IsHidden',           entry.IsHidden           || 0);
    writeField(0x02, 'AllowDesktopConfig', entry.AllowDesktopConfig !== undefined ? entry.AllowDesktopConfig : 1);
    writeField(0x02, 'AllowOverlay',       entry.AllowOverlay       !== undefined ? entry.AllowOverlay       : 1);
    writeField(0x02, 'OpenVR',             entry.OpenVR             || 0);
    writeField(0x02, 'Devkit',             entry.Devkit             || 0);
    writeField(0x01, 'DevkitGameID',       entry.DevkitGameID       || '');
    writeField(0x02, 'DevkitOverrideAppID',entry.DevkitOverrideAppID|| 0);
    writeField(0x02, 'LastPlayTime',       entry.LastPlayTime       || 0);
    writeField(0x01, 'FlatpakAppID',       entry.FlatpakAppID       || '');
    writeField(0x01, 'sortas',             '');

    // Tags sub-object
    writeByte(0x00);
    writeStr('tags');
    const tags = entry.tags || {};
    const tagEntries = typeof tags === 'object' && !Array.isArray(tags)
      ? Object.entries(tags)
      : (Array.isArray(tags) ? tags.map((v,i) => [String(i), v]) : []);
    for (const [tk, tv] of tagEntries) {
      writeByte(0x01);
      writeStr(tk);
      writeStr(tv);
    }
    writeByte(0x08); // end tags

    writeByte(0x08); // end entry
  });

  writeByte(0x08); // end shortcuts
  writeByte(0x08); // end root

  fs.writeFileSync(filePath, Buffer.concat(parts));
}

// Generate a stable non-Steam appid from exe path + app name.
// Steam's algorithm: CRC32(quotedExe + appName) | 0x80000000, as a signed int32.
// The exe string passed here must be the quoted form ("C:\path\game.exe")
// because that is what Steam itself stores in the Exe field.
function generateNonSteamAppId() {
  // Generate a random non-Steam appid matching exactly what Steam itself does:
  // a random 32-bit unsigned integer with the top bit set (non-Steam game range).
  const rand = Math.floor(Math.random() * 0x7FFFFFFF);
  return (rand | 0x80000000) >>> 0;
}

ipcMain.handle('add-to-steam', async (_, { appName, exePath, startDir, iconPath }) => {
  try {
    const steamPath = findSteamPath();
    if (!steamPath) return { ok: false, error: 'Steam installation not found.' };

    const userIds = getSteamUserIds(steamPath);
    if (!userIds.length) return { ok: false, error: 'No Steam user accounts found.' };

    // Exe field is stored with surrounding quotes in the VDF — Steam requires this.
    // The appID CRC is computed from the quoted exe string + appName, matching
    // what Steam ROM Manager, SteamTinkerLaunch, and the ICE project all use.
    const quotedExe = `"${exePath}"`;
    const appId     = generateNonSteamAppId();
    const updated = [];
    const skipped = [];

    for (const userId of userIds) {
      const configDir     = path.join(steamPath, 'userdata', userId, 'config');
      const shortcutsPath = path.join(configDir, 'shortcuts.vdf');

      // Ensure config dir exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Read existing shortcuts
      let shortcuts = [];
      try {
        shortcuts = readVdfShortcuts(shortcutsPath);
      } catch (e) {
        console.warn(`[add-to-steam] Could not read shortcuts.vdf for user ${userId}:`, e.message);
      }

      // Check if already added (match by exe or appid)
      const normalizedExe = exePath.replace(/\\/g, '/').toLowerCase();
      const alreadyExists = shortcuts.some(s => {
        const sExe = (s.Exe || s.exe || '').replace(/\\/g, '/').toLowerCase()
          .replace(/^"|"$/g, ''); // strip surrounding quotes for comparison
        return sExe === normalizedExe || s.appid === appId;
      });

      if (alreadyExists) {
        skipped.push(userId);
        continue;
      }

      // Backup the existing file before modifying
      if (fs.existsSync(shortcutsPath)) {
        try {
          fs.copyFileSync(shortcutsPath, shortcutsPath + '.bak');
        } catch {}
      }

      // Add the new shortcut.
      // Exe: quoted path (Steam requires this for the launch command).
      // StartDir: bare path WITHOUT quotes (quotes here break Steam's launch on Windows).
      // Ensure StartDir has a trailing backslash — Steam writes it this way
      const startDirSlashed = startDir.endsWith('\\') ? startDir : startDir + '\\';
      shortcuts.push({
        appid:              appId,
        appname:            appName,
        Exe:                quotedExe,
        StartDir:           startDirSlashed,
        icon:               '',
        ShortcutPath:       '',
        LaunchOptions:      '',
        IsHidden:           0,
        AllowDesktopConfig: 1,
        AllowOverlay:       1,
        OpenVR:             0,
        Devkit:             0,
        DevkitGameID:       '',
        DevkitOverrideAppID:0,
        LastPlayTime:       0,
        FlatpakAppID:       '',
        tags:               {},
      });

      writeVdfShortcuts(shortcutsPath, shortcuts);
      updated.push(userId);
      console.log(`[add-to-steam] Added "${appName}" for user ${userId}`);
    }

    if (updated.length === 0 && skipped.length > 0) {
      return { ok: true, alreadyAdded: true };
    }

    return { ok: true, alreadyAdded: false, updatedUsers: updated.length };
  } catch (e) {
    console.error('[add-to-steam] Error:', e.message);
    return { ok: false, error: e.message };
  }
});

// ─── ROM list fetcher (view_archive.php HTML parser) ────────────────────────

// ─── ROM list disk cache ─────────────────────────────────────────────────────
// Saves parsed ROM arrays to userData as JSON so subsequent launches are instant.
const ROM_CACHE_DIR = path.join(app.getPath('userData'), 'romcache');
if (!fs.existsSync(ROM_CACHE_DIR)) fs.mkdirSync(ROM_CACHE_DIR, { recursive: true });

function getRomCachePath(system) {
  return path.join(ROM_CACHE_DIR, `${system}.json`);
}

function loadRomDiskCache(system) {
  try {
    const p = getRomCachePath(system);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    // Expire cache after 7 days
    if (Date.now() - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
      fs.unlinkSync(p);
      return null;
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function saveRomDiskCache(system, roms) {
  try {
    fs.writeFileSync(getRomCachePath(system), JSON.stringify(roms), 'utf8');
  } catch (e) {
    console.warn('[rom-cache] Failed to save:', e.message);
  }
}

ipcMain.handle('clear-rom-cache', (_, { system }) => {
  try {
    const p = getRomCachePath(system);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    delete romListCache[system];
    delete romListCache[romListCacheKey('archiveorg', system)];
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

const SYSTEM_CONFIGS = {
  snes: {
    label: 'Super Nintendo (SNES)',
    archivePath: 'roms/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System.zip',
    downloadBase: 'https://archive.org/download/ni-roms/roms/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System.zip/',
  },
  psx: {
    label: 'PlayStation',
    // PSX uses multiple archive.org items — downloadUrl is per-ROM in the JSON
    archivePath: null,
    downloadBase: null,
  },
};

const romListCache = {};
const MARKETPLACE_PROVIDERS = {
  archiveorg: {
    id: 'archiveorg',
    name: 'Archive.org',
    status: 'active',
    systems: ['snes', 'psx'],
  },
};

function romListCacheKey(provider, system) {
  return `${provider}::${system}`;
}
function loadArchiveOrgRomList(system) {
  const cacheKey = romListCacheKey('archiveorg', system);
  if (romListCache[cacheKey]) {
    return { ok: true, roms: romListCache[cacheKey], cached: true, source: 'memory', provider: 'archiveorg' };
  }

  const romsFileName = `roms-${system}.json`;
  const devPath      = path.join(__dirname, '../../assets/roms', romsFileName);
  const packedPath   = path.join(process.resourcesPath || '', 'roms', romsFileName);
  const romsPath     = fs.existsSync(devPath) ? devPath : packedPath;

  if (!fs.existsSync(romsPath)) {
    return { ok: false, error: `ROM list file not found: ${romsPath}`, provider: 'archiveorg' };
  }

  try {
    console.log(`[marketplace-fetch-catalog] archiveorg loading from ${romsPath}`);
    const roms = JSON.parse(fs.readFileSync(romsPath, 'utf8'));
    console.log(`[marketplace-fetch-catalog] archiveorg loaded ${roms.length} ROMs`);
    romListCache[cacheKey] = roms;
    return { ok: true, roms, cached: false, source: 'bundled', provider: 'archiveorg' };
  } catch (e) {
    return { ok: false, error: `Failed to parse ROM list: ${e.message}`, provider: 'archiveorg' };
  }
}

function fetchMarketplaceCatalog(provider, system) {
  if (provider === 'archiveorg') return loadArchiveOrgRomList(system);
  return { ok: false, error: `Unknown provider: ${provider}`, provider };
}

// Debug: dump raw HTML to disk so we can inspect what the parser receives
ipcMain.handle('debug-dump-html', (_, { html, filename }) => {
  try {
    const dumpPath = path.join(app.getPath('userData'), filename || 'debug-dump.html');
    fs.writeFileSync(dumpPath, html);
    return { ok: true, path: dumpPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Backward-compatible Archive.org catalog fetch.
ipcMain.handle('fetch-rom-list', async (_, { system }) => fetchMarketplaceCatalog('archiveorg', system));
ipcMain.handle('marketplace-list-sources', async () => ({
  ok: true,
  providers: Object.values(MARKETPLACE_PROVIDERS).map(provider => ({
    id: provider.id,
    name: provider.name,
    status: provider.status,
    systems: provider.systems,
  })),
}));
ipcMain.handle('marketplace-fetch-catalog', async (_, { provider = 'archiveorg', system }) => {
  return await fetchMarketplaceCatalog(provider, system);
});

function parseViewArchiveHtml(html, downloadBase) {
  const roms = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const inner = trMatch[1];
    const linkRe = /<td[^>]*><a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/i;
    const linkMatch = linkRe.exec(inner);
    if (!linkMatch) continue;
    const href    = linkMatch[1];
    const rawName = decodeHtmlEntities(linkMatch[2].trim());
    if (!rawName || !rawName.toLowerCase().endsWith('.zip')) continue;
    if (rawName === '../' || rawName === 'Parent Directory') continue;
    const tdRe = /<td[^>]*>(.*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRe.exec(inner)) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    const timestamp = cells[2] || '';
    const sizeRaw   = cells[3] || '';
    const downloadUrl = href.startsWith('//') ? 'https:' + href : href;
    const { cleanName, region, tags } = parseRomFilename(rawName);
    const sizeBytes = parseInt(sizeRaw, 10) || 0;
    const size = sizeBytes ? formatSizeMain(sizeBytes) : '';
    roms.push({ name: rawName, cleanName, region, tags, size, sizeBytes, timestamp, downloadUrl });
  }
  return roms;
}

function formatSizeMain(bytes) {
  if (!bytes) return '';
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + ' GB';
  if (bytes >= 1_048_576)     return (bytes / 1_048_576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function parseRomFilename(filename) {
  const REGIONS = 'USA|Europe|Japan|World|Germany|France|Spain|Italy|Australia|Korea|China|Brazil|Netherlands|Sweden|Norway|Denmark|Finland|Russia|Poland|Canada|Mexico|Portugal|Greece|Hungary|Czech|Romania|Croatia|Serbia|Bulgaria|Ukraine|Israel|Turkey|India|Argentina|Chile|Colombia|Venezuela|Peru';
  const LANG    = 'En|Ja|De|Fr|Es|It|Nl|Pt|Sv|No|Da|Fi|Ru|Pl|Ko|Zh|Ar|He|Tr|Cs|Hu|Ro|Hr|Sr|Bg|Uk|El';
  const rBlk = `\\((?:(?:${REGIONS})(?:,\\s*(?:${REGIONS}))*|(?:${LANG})(?:,\\s*(?:${LANG}))*)\\)`;
  const tBlk = `\\((?:Beta|Proto|Sample|Demo|Rev\\s*\\d*|Hack|Alt|Unl|BIOS|Kiosk|Promo|Aftermarket|Pirate|Virtual Console|Switch Online|Classic Mini|v[\\d.]+)[^)]*\\)`;
  let base = filename.replace(/\.zip$/i, '');
  const firstRegion = base.match(new RegExp(rBlk, 'i'));
  const region = firstRegion ? firstRegion[0].replace(/[()]/g, '').trim() : '';
  const tags = [];
  let m;
  const tagRe = new RegExp(tBlk, 'gi');
  while ((m = tagRe.exec(base)) !== null) tags.push(m[0].replace(/[()]/g, '').trim());
  let cleanName = base
    .replace(new RegExp(rBlk, 'gi'), '')
    .replace(new RegExp(tBlk, 'gi'), '')
    .replace(/\s{2,}/g, ' ').trim();
  return { cleanName: cleanName || base, region, tags };
}

function decodeHtmlEntities(str) {
  return str.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
}

function parseSizeString(str) {
  const s = str.trim().toUpperCase();
  const m = s.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { B:1, KB:1024, MB:1024*1024, GB:1024*1024*1024, TB:1024*1024*1024*1024 };
  return Math.round(n * (mult[m[2] || 'B'] || 1));
}

// ─── ROM launch via RetroArch ───────────────────────────────────────────────

ipcMain.handle('launch-rom', async (_, { romPath, system, identifier = null }) => {
  const settings = loadSettings();
  const resolved = resolveLibretroLaunch(settings, system);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { raPath, corePath } = resolved;

  const ROM_EXTS = ['.sfc', '.smc', '.snes', '.nes', '.gba', '.gbc', '.gb', '.md', '.gen', '.smd', '.n64', '.z64', '.v64', '.nds', '.pce', '.chd', '.cue', '.bin', '.img', '.zip'];
  let actualRomPath = romPath;

  if (fs.existsSync(romPath) && fs.statSync(romPath).isDirectory()) {
    const entries = fs.readdirSync(romPath, { withFileTypes: true });
    // Prefer native ROM files; fall back to .zip if that's all there is
    const romFile = entries.find(e => e.isFile() && ROM_EXTS.filter(x => x !== '.zip').some(ext => e.name.toLowerCase().endsWith(ext)))
                 || entries.find(e => e.isFile() && e.name.toLowerCase().endsWith('.zip'));
    if (!romFile) return { ok: false, error: `No ROM file found in install directory: ${romPath}` };
    actualRomPath = path.join(romPath, romFile.name);
  }

  // When extractArchive is off, installDir is the .zip file path directly
  if (!fs.existsSync(actualRomPath)) return { ok: false, error: `ROM file not found: ${actualRomPath}` };

  return new Promise((resolve) => {
    execFile(raPath, ['-L', corePath, actualRomPath], (err) => {
      if (err && err.code !== null) console.error('[launch-rom] RetroArch exit:', err.message);
      if (!err && identifier) markGamePlayed(identifier);
      resolve({ ok: true });
    });
  });
});

// ─── HowLongToBeat ──────────────────────────────────────────────────────────

const HLTB_CACHE_DIR = path.join(app.getPath('userData'), 'hltbcache');
if (!fs.existsSync(HLTB_CACHE_DIR)) fs.mkdirSync(HLTB_CACHE_DIR, { recursive: true });

// Read all cached HLTB files and return a metadata index keyed by cleanName slug
ipcMain.handle('hltb-list-cache', () => {
  const index = {};
  console.log('[hltb-list-cache] reading from:', HLTB_CACHE_DIR);
  console.log('[hltb-list-cache] dir exists:', fs.existsSync(HLTB_CACHE_DIR));
  try {
    const files = fs.readdirSync(HLTB_CACHE_DIR);
    console.log('[hltb-list-cache] files found:', files);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw  = fs.readFileSync(path.join(HLTB_CACHE_DIR, file), 'utf8');
        const data = JSON.parse(raw);
        if (!data) { console.log('[hltb-list-cache] null data in', file); continue; }
        const slug = file.slice(0, -5);
        index[slug] = {
          developer:   data.developer   || null,
          publisher:   data.publisher   || null,
          genre:       data.genre       || null,
          releaseDate: data.releaseDate ? data.releaseDate.slice(0, 4) : null,
          esrb:        data.esrb        || null,
          pegi:        data.pegi        || null,
        };
        console.log('[hltb-list-cache] indexed:', slug, '->', index[slug]);
      } catch (e) { console.log('[hltb-list-cache] error on', file, e.message); }
    }
  } catch (e) { console.log('[hltb-list-cache] readdir error:', e.message); }
  console.log('[hltb-list-cache] returning', Object.keys(index).length, 'entries');
  return index;
});

// HLTB prefetch: fetch one title in the background, skip if already cached
// Returns { ok, skipped } — skipped=true means cache already existed
ipcMain.handle('hltb-prefetch-next', async (_, { cleanName }) => {
  const slug      = cleanName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const cachePath = path.join(HLTB_CACHE_DIR, `${slug}.json`);
  if (fs.existsSync(cachePath)) return { ok: true, skipped: true };

  const auth = await getHltbAuth();
  if (!auth?.token) return { ok: false, skipped: false, error: 'no token' };

  const bodyPayload = {
    searchType: 'games', searchTerms: cleanName.split(' ').filter(Boolean),
    searchPage: 1, size: 5,
    searchOptions: {
      games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main',
        rangeTime: { min: 0, max: 0 }, gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' }, modifier: '' },
      users: { sortCategory: 'postcount' }, lists: { sortCategory: 'follows' },
      filter: '', sort: 0, randomizer: 0,
    },
    useCache: true,
  };
  if (auth.hpKey) bodyPayload[auth.hpKey] = auth.hpVal;
  const body = JSON.stringify(bodyPayload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'howlongtobeat.com', path: '/api/find', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'Referer': 'https://howlongtobeat.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': '*/*',
        'x-auth-token': auth.token,
        'x-hp-key': auth.hpKey || '',
        'x-hp-val': auth.hpVal || '',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const games = (() => { try { return JSON.parse(data)?.data || []; } catch { return []; } })();
        if (!games.length) { fs.writeFileSync(cachePath, JSON.stringify(null)); return resolve({ ok: false, skipped: false }); }
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(cleanName);
        const best = games.map(g => {
          const t = normalize(g.game_name || '');
          return { ...g, _sim: t === target ? 1 : t.includes(target) || target.includes(t) ? 0.8 : 0.3 };
        }).sort((a, b) => b._sim - a._sim)[0];
        const secToHM = s => { if (!s) return null; const h = Math.floor(s/3600), m = Math.round((s%3600)/60); return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`; };
        // Fetch game page for metadata
        const fetchMeta = (gameId) => new Promise((rm) => {
          https.get(`https://howlongtobeat.com/game/${gameId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept': 'text/html' }
          }, (r) => {
            let html = '';
            r.on('data', c => html += c);
            r.on('end', () => {
              try {
                const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
                if (!match) return rm(null);
                const g = JSON.parse(match[1])?.props?.pageProps?.game?.data?.game?.[0];
                if (!g) return rm(null);
                rm({ developer: g.profile_dev||null, publisher: g.profile_pub||null, genre: g.profile_genre||null,
                  platform: g.profile_platform||null, releaseDate: g.release_world||null, summary: g.profile_summary||null,
                  esrb: g.rating_esrb||null, pegi: g.rating_pegi||null, reviewScore: g.review_score||null,
                  reviewCount: g.count_review||null, countPlaying: g.count_playing||0, countBacklog: g.count_backlog||0,
                  countCompleted: g.count_comp||0,
                  imageUrl: g.game_image ? `https://howlongtobeat.com/games/${g.game_image}` : null });
              } catch { rm(null); }
            });
          }).on('error', () => rm(null));
        });
        ;(async () => {
          try {
            const meta = await fetchMeta(best.game_id);
            const result = {
              id: String(best.game_id), title: best.game_name,
              main: secToHM(best.comp_main), mainExtra: secToHM(best.comp_plus), completionist: secToHM(best.comp_100),
              url: `https://howlongtobeat.com/game/${best.game_id}`,
              ...(meta || {}),
            };
            fs.writeFileSync(cachePath, JSON.stringify(result));
            resolve({ ok: true, skipped: false });
          } catch { fs.writeFileSync(cachePath, JSON.stringify(null)); resolve({ ok: false, skipped: false }); }
        })();
      });
    });
    req.on('error', () => resolve({ ok: false, skipped: false, error: 'request error' }));
    req.write(body); req.end();
  });
});

// HLTB token cache — valid for 55 minutes
let _hltbAuth = null;
let _hltbTokenExpiry = 0;

function getHltbAuth() {
  if (_hltbAuth?.token && Date.now() < _hltbTokenExpiry) return Promise.resolve(_hltbAuth);
  return new Promise((resolve) => {
    https.get(`https://howlongtobeat.com/api/find/init?t=${Date.now()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer':    'https://howlongtobeat.com/',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          _hltbAuth        = parsed.token ? { token: parsed.token, hpKey: parsed.hpKey || null, hpVal: parsed.hpVal || null } : null;
          _hltbTokenExpiry = Date.now() + 55 * 60 * 1000;
          console.log('[hltb] token ok:', !!_hltbAuth?.token);
        } catch { _hltbAuth = null; }
        resolve(_hltbAuth);
      });
    }).on('error', () => resolve(null));
  });
}

function getHltbToken() {
  return getHltbAuth().then(auth => auth?.token || null);
}

ipcMain.handle('hltb-search', async (_, { cleanName, force = false } = {}) => fetchHltbMetadata(cleanName, { force }));

// ─── RetroAchievements ──────────────────────────────────────────────────────
// SNES console ID on RA is 3. We cache the full game list for 24h to avoid
// hammering their API — it rarely changes and can be large.

const RA_CACHE_DIR = path.join(app.getPath('userData'), 'racache');
if (!fs.existsSync(RA_CACHE_DIR)) fs.mkdirSync(RA_CACHE_DIR, { recursive: true });

const RA_CONSOLE_MAP = { snes: 3, nes: 7, gba: 5, gbc: 6, gb: 4, genesis: 1, n64: 2, psx: 12 };
const LIBRETRO_SYSTEMS = [
  { id: 'snes', label: 'SNES', coreExample: 'bsnes_mercury_balanced_libretro.dll' },
  { id: 'nes', label: 'NES', coreExample: 'mesen_libretro.dll' },
  { id: 'gba', label: 'Game Boy Advance', coreExample: 'mgba_libretro.dll' },
  { id: 'gbc', label: 'Game Boy Color', coreExample: 'mgba_libretro.dll' },
  { id: 'gb', label: 'Game Boy', coreExample: 'gambatte_libretro.dll' },
  { id: 'genesis', label: 'Genesis / Mega Drive', coreExample: 'genesis_plus_gx_libretro.dll' },
  { id: 'n64', label: 'Nintendo 64', coreExample: 'mupen64plus_next_libretro.dll' },
  { id: 'nds', label: 'Nintendo DS', coreExample: 'melondsds_libretro.dll' },
  { id: 'pce', label: 'PC Engine / TurboGrafx-16', coreExample: 'mednafen_pce_fast_libretro.dll' },
  { id: 'psx', label: 'PlayStation', coreExample: 'mednafen_psx_libretro.dll' },
  { id: 'psp', label: 'PSP', coreExample: 'ppsspp_libretro.dll' },
  { id: 'dolphin', label: 'GameCube / Wii (Dolphin core)', coreExample: 'dolphin_libretro.dll' },
  { id: 'pcsx2', label: 'PlayStation 2 (PCSX2 core)', coreExample: 'pcsx2_libretro.dll' },
];

function getLibretroSystems() {
  return LIBRETRO_SYSTEMS.map(system => ({ ...system }));
}

async function fetchHltbMetadata(cleanName, { force = false } = {}) {
  const variants = hltbTitleVariants(cleanName);
  let lastResult = null;
  for (const variant of variants) {
    const result = await fetchHltbMetadataSingle(variant, { force });
    lastResult = result;
    if (result?.ok && result?.data) return { ...result, query: variant };
    if (result?.cached && result?.error === 'Cached miss') {
      const forced = await fetchHltbMetadataSingle(variant, { force: true });
      lastResult = forced;
      if (forced?.ok && forced?.data) return { ...forced, query: variant };
    }
  }
  return lastResult || { ok: false, error: 'No HLTB query variants available' };
}

async function fetchHltbMetadataSingle(cleanName, { force = false } = {}) {
  const slug      = buildGameSlug(cleanName);
  const cachePath = path.join(HLTB_CACHE_DIR, `${slug}.json`);

  if (!force && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached !== null) return { ok: true, data: cached, cached: true };
      const ageMs = Date.now() - fs.statSync(cachePath).mtimeMs;
      if (ageMs < 10 * 60 * 1000) return { ok: false, data: null, cached: true, error: 'Cached miss' };
    } catch {}
  }

  const auth = await getHltbAuth();
  if (!auth?.token) {
    return { ok: false, error: 'Could not get HLTB auth token' };
  }

  const bodyPayload = {
    searchType: 'games',
    searchTerms: cleanName.split(' ').filter(Boolean),
    searchPage: 1,
    size: 10,
    searchOptions: {
      games: {
        userId: 0, platform: '', sortCategory: 'popular',
        rangeCategory: 'main', rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' }, modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '', sort: 0, randomizer: 0,
    },
    useCache: true,
  };
  if (auth.hpKey) bodyPayload[auth.hpKey] = auth.hpVal;
  const body = JSON.stringify(bodyPayload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'howlongtobeat.com',
      path:     '/api/find',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Referer':        'https://howlongtobeat.com/',
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':         '*/*',
        'x-auth-token':   auth.token,
        'x-hp-key':       auth.hpKey || '',
        'x-hp-val':       auth.hpVal || '',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const games = (() => {
          try { return JSON.parse(data)?.data || []; }
          catch { return []; }
        })();

        if (!games.length) {
          fs.writeFileSync(cachePath, JSON.stringify(null));
          return resolve({ ok: false, error: 'No results found' });
        }

        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target    = normalize(cleanName);
        const best      = games
          .map(g => {
            const t = normalize(g.game_name || '');
            const sim = t === target ? 1 : t.includes(target) || target.includes(t) ? 0.8 : 0.3;
            return { ...g, _sim: sim };
          })
          .sort((a, b) => b._sim - a._sim)[0];

        const secToHM = s => {
          if (!s) return null;
          const h = Math.floor(s / 3600);
          const m = Math.round((s % 3600) / 60);
          return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
        };

        const fetchMeta = (gameId) => new Promise((resolveMeta) => {
          https.get(`https://howlongtobeat.com/game/${gameId}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
              'Accept': 'text/html',
            }
          }, (r) => {
            let html = '';
            r.on('data', c => html += c);
            r.on('end', () => {
              try {
                const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
                if (!match) return resolveMeta(null);
                const nd = JSON.parse(match[1]);
                const g  = nd?.props?.pageProps?.game?.data?.game?.[0];
                if (!g) return resolveMeta(null);
                resolveMeta({
                  developer:      g.profile_dev      || null,
                  publisher:      g.profile_pub      || null,
                  genre:          g.profile_genre    || null,
                  platform:       g.profile_platform || null,
                  releaseDate:    g.release_world    || null,
                  summary:        g.profile_summary  || null,
                  esrb:           g.rating_esrb      || null,
                  pegi:           g.rating_pegi      || null,
                  reviewScore:    g.review_score     || null,
                  reviewCount:    g.count_review     || null,
                  countPlaying:   g.count_playing    || 0,
                  countBacklog:   g.count_backlog    || 0,
                  countCompleted: g.count_comp       || 0,
                  imageUrl: g.game_image ? `https://howlongtobeat.com/games/${g.game_image}` : null,
                });
              } catch { resolveMeta(null); }
            });
          }).on('error', () => resolveMeta(null));
        });

        ;(async () => {
          try {
            const meta   = await fetchMeta(best.game_id);
            const result = {
              id:            String(best.game_id),
              title:         best.game_name,
              main:          secToHM(best.comp_main),
              mainExtra:     secToHM(best.comp_plus),
              completionist: secToHM(best.comp_100),
              url:           `https://howlongtobeat.com/game/${best.game_id}`,
              ...( meta || {} ),
            };
            fs.writeFileSync(cachePath, JSON.stringify(result));
            resolve({ ok: true, data: result, cached: false });
          } catch (e) {
            resolve({ ok: false, error: e.message });
          }
        })();
      });
    });
    req.on('error', err => resolve({ ok: false, error: err.message }));
    req.write(body);
    req.end();
  });
}

async function fetchRaGameData(cleanName, system) {
  const settings = loadSettings();
  const raAccount = readThirdPartyAccount('retroachievements');
  const apiKey   = raAccount.secret || settings.retroAchievementsKey || '';
  if (!apiKey) return { ok: false, error: 'no-key' };

  const consoleId = RA_CONSOLE_MAP[system] || RA_CONSOLE_MAP.snes;
  const slug      = buildGameSlug(cleanName);
  const extCache  = path.join(RA_CACHE_DIR, `ext_${consoleId}_${slug}.json`);
  const isValidRaExtendedCache = (cached) => {
    if (!cached || typeof cached !== 'object') return false;
    if (!cached.id && !cached.title && !cached.matchedTitle) return false;
    if (String(cached.gameUrl || '').includes('undefined')) return false;
    if (!Array.isArray(cached.achievements)) return false;
    return true;
  };
  if (fs.existsSync(extCache)) {
    try {
      const stat = fs.statSync(extCache);
      if (Date.now() - stat.mtimeMs < 7 * 24 * 60 * 60 * 1000) {
        const cached = JSON.parse(fs.readFileSync(extCache, 'utf8'));
        if (isValidRaExtendedCache(cached)) {
          return { ok: true, data: cached, cached: true };
        }
      }
    } catch {}
  }

  const games = await raGetGameList(consoleId, apiKey);
  if (!games) return { ok: false, error: 'Could not fetch RA game list' };

  const normalize = s => String(s || '')
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = s => normalize(s).replace(/[^a-z0-9]/g, '');
  const titleVariants = (value) => {
    const raw = String(value || '');
    const noParens = raw.replace(/[\[(][^\])]*[\])]/g, ' ');
    const commaArticle = noParens.replace(/^(.+),\s*(The|A|An)$/i, '$2 $1');
    return [...new Set([raw, noParens, commaArticle].map(normalize).filter(Boolean))];
  };
  const targets = titleVariants(cleanName);
  const targetCompacts = targets.map(compact).filter(Boolean);
  const scored    = games
    .map(g => {
      const title = normalize(g.Title || '');
      const titleCompact = compact(g.Title || '');
      let sim = 0;
      if (targets.includes(title) || targetCompacts.includes(titleCompact)) sim = 1;
      else if (targets.some(target => title.includes(target) || target.includes(title))) sim = 0.82;
      else if (targetCompacts.some(target => titleCompact.includes(target) || target.includes(titleCompact))) sim = 0.74;
      return { ...g, _sim: sim };
    })
    .filter(g => g._sim > 0.7)
    .sort((a, b) => b._sim - a._sim);

  if (!scored.length) {
    return {
      ok: false,
      error: 'Game not found on RetroAchievements',
      debug: {
        query: cleanName,
        system,
        consoleId,
        targets,
        sampleTitles: games.slice(0, 10).map(g => g.Title || ''),
      },
    };
  }
  const best = scored[0];
  const raUser = raAccount.login || settings.retroAchievementsUser || '';

  return new Promise((resolve) => {
    const userParam = raUser ? `&z=${encodeURIComponent(raUser)}` : '';
    const url = `https://retroachievements.org/API/API_GetGameExtended.php?y=${encodeURIComponent(apiKey)}&i=${best.ID}${userParam}`;
    https.get(url, { headers: { 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const ext = JSON.parse(data);
          const achievements = Object.values(ext.Achievements || {}).map(a => ({
            id:          a.ID,
            title:       a.Title,
            description: a.Description,
            points:      a.Points,
            badgeName:   a.BadgeName,
            numAwarded:  a.NumAwarded,
            type:        a.Type,
            dateEarned:  a.DateEarned || null,
          })).sort((a, b) => a.id - b.id);

          if (!achievements.length && Number(best.NumAchievements || 0) > 0) {
            try { fs.unlinkSync(extCache); } catch {}
            return resolve({
              ok: false,
              error: `RetroAchievements matched ${best.Title || cleanName} (#${best.ID}) but extended achievement data was empty`,
              debug: {
                matchedId: best.ID,
                matchedTitle: best.Title,
                expectedAchievements: best.NumAchievements,
                responseKeys: Object.keys(ext || {}),
              },
            });
          }

          const result = {
            id:              ext.ID || best.ID,
            title:           ext.Title || best.Title,
            matchedTitle:     best.Title || ext.Title,
            matchScore:       best._sim,
            consoleId,
            imageIcon:       (ext.ImageIcon || best.ImageIcon) ? `https://retroachievements.org${ext.ImageIcon || best.ImageIcon}` : null,
            numAchievements: achievements.length,
            totalPoints:     achievements.reduce((s, a) => s + (a.points || 0), 0) || Number(best.Points || 0),
            numPlayers:      ext.NumDistinctPlayersCasual || 0,
            achievements,
            gameUrl:         `https://retroachievements.org/game/${ext.ID || best.ID}`,
            hasUserProgress: !!raUser,
          };
          fs.writeFileSync(extCache, JSON.stringify(result));
          resolve({ ok: true, data: result, cached: false });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    }).on('error', err => resolve({ ok: false, error: err.message }));
  });
}

async function cacheRemoteImage(url, destDir, baseName) {
  if (!url) return null;
  const cleanBase = buildGameSlug(baseName);
  const webpPath = path.join(destDir, `${cleanBase}.webp`);
  if (fs.existsSync(webpPath) && fs.statSync(webpPath).size > 512) return webpPath;
  const ext = path.extname(new URL(url).pathname || '').toLowerCase() || '.png';
  const sourcePath = path.join(destDir, `${cleanBase}${ext}`);
  if (ext === '.webp' && fs.existsSync(sourcePath) && fs.statSync(sourcePath).size > 512) return sourcePath;
  if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).size > 512) {
    const converted = await convertImageToWebp(sourcePath, webpPath);
    return converted || sourcePath;
  }
  const ok = await downloadFile(url, sourcePath);
  if (!ok) return null;
  const converted = await convertImageToWebp(sourcePath, webpPath);
  return converted || sourcePath;
}

async function convertImageToWebp(sourcePath, webpPath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.webp') return sourcePath;
  if (!sharp) return null;
  try {
    await sharp(sourcePath).webp({ quality: 82 }).toFile(webpPath);
    if (fs.existsSync(webpPath) && fs.statSync(webpPath).size > 256) {
      try { fs.unlinkSync(sourcePath); } catch {}
      return webpPath;
    }
  } catch {}
  return null;
}

function walkFilesRecursive(rootDir, out = []) {
  if (!rootDir || !fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) walkFilesRecursive(fullPath, out);
    else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

async function migrateExistingArtCacheToWebpOnce() {
  if (!sharp) return { ok: false, skipped: true, reason: 'sharp unavailable' };
  const settings = loadSettings();
  if ((settings.webpArtMigrationVersion || 0) >= 1) {
    return { ok: true, skipped: true, reason: 'already migrated' };
  }

  const roots = [ART_ROOT_DIR, LEGACY_SGDB_CACHE_DIR];
  const allowedExts = new Set(['.png', '.jpg', '.jpeg']);
  let scanned = 0;
  let converted = 0;
  let failed = 0;

  for (const root of roots) {
    for (const filePath of walkFilesRecursive(root)) {
      const ext = path.extname(filePath).toLowerCase();
      if (!allowedExts.has(ext)) continue;
      scanned += 1;
      const webpPath = filePath.replace(/\.(png|jpe?g)$/i, '.webp');
      if (fs.existsSync(webpPath) && fs.statSync(webpPath).size > 256) {
        try { fs.unlinkSync(filePath); } catch {}
        continue;
      }
      const result = await convertImageToWebp(filePath, webpPath);
      if (result && result.toLowerCase().endsWith('.webp')) converted += 1;
      else failed += 1;
    }
  }

  settings.webpArtMigrationVersion = 1;
  settings.webpArtMigration = {
    version: 1,
    scanned,
    converted,
    failed,
    completedAt: Date.now(),
  };
  saveSettings(settings);
  console.log(`[art-migrate] WebP migration complete. scanned=${scanned} converted=${converted} failed=${failed}`);
  return { ok: true, scanned, converted, failed };
}

function clearDirectoryContents(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      clearDirectoryContents(fullPath);
      try { fs.rmdirSync(fullPath); } catch {}
    } else {
      try { fs.unlinkSync(fullPath); } catch {}
    }
  }
}

function clearAllRomCaches() {
  if (fs.existsSync(ROM_CACHE_DIR)) {
    for (const file of fs.readdirSync(ROM_CACHE_DIR)) {
      try { fs.unlinkSync(path.join(ROM_CACHE_DIR, file)); } catch {}
    }
  }
  for (const key of Object.keys(romListCache)) delete romListCache[key];
}

function openFolderPath(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return { ok: false, error: 'Folder not found' };
  try {
    const cmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'linux' ? 'xdg-open'
      : 'explorer';
    execFile(cmd, [targetPath]);
    return { ok: true, path: targetPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function requestJson(urlString, { method = 'GET', headers = {}, body = null, timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(urlString); }
    catch { return resolve({ ok: false, error: 'Invalid URL' }); }

    const transport = parsed.protocol === 'http:' ? require('http') : https;
    const options = {
      method,
      headers: {
        'User-Agent': 'SKALD-Launcher/0.1',
        ...headers,
      },
      timeout: timeoutMs,
    };
    const req = transport.request(parsed, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, data: json, status: res.statusCode });
          } else {
            resolve({ ok: false, error: json?.error || `HTTP ${res.statusCode}`, status: res.statusCode, data: json });
          }
        } catch (e) {
          resolve({ ok: false, error: e.message || 'Invalid JSON response', status: res.statusCode });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', err => resolve({ ok: false, error: err.message || 'Request failed' }));
    if (body) req.write(body);
    req.end();
  });
}

async function fetchWorkerGameEnrichment({ identifier, title, system, provider, catalogIdentifier }) {
  const settings = loadSettings();
  const cfg = getMetadataServiceSettings(settings);
  if (!cfg.enabled || !cfg.baseUrl) return { ok: false, skipped: true, error: 'Metadata service not configured' };

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
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const response = await requestJson(`${cfg.baseUrl}/metadata/game`, {
    method: 'POST',
    headers,
    body,
    timeoutMs: cfg.timeoutMs,
  });
  if (!response.ok) return response;
  return {
    ok: true,
    data: normalizeWorkerEnrichmentResponse(response.data, {
      title,
      system,
      provider,
      catalogIdentifier,
    }),
    source: 'cloudflare-worker',
  };
}

function isRemoteAsset(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

async function materializeEnrichmentAssets(payload, context = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const titleBase = context.title || payload.title || context.identifier || 'game';
  const systemBase = context.system || payload.system || 'unknown';
  const slugBase = `${systemBase}_${buildGameSlug(titleBase)}`;
  const next = { ...payload };

  const singleAssets = [
    ['cover_path', ART_COVERS_DIR, `${slugBase}_cover`],
    ['logo_path', ART_LOGOS_DIR, `${slugBase}_logo`],
    ['icon_path', ART_ICONS_DIR, `${slugBase}_icon`],
    ['background_path', ART_BACKGROUNDS_DIR, `${slugBase}_background`],
    ['ra_badge_path', ART_PROVIDER_RA_DIR, `${slugBase}_ra`],
  ];
  for (const [field, dir, name] of singleAssets) {
    if (isRemoteAsset(next[field])) {
      const local = await cacheRemoteImage(next[field], dir, name);
      if (local) next[field] = local;
    }
  }

  if (Array.isArray(next.screenshot_paths) && next.screenshot_paths.length) {
    const localized = [];
    for (let i = 0; i < next.screenshot_paths.length; i += 1) {
      const value = next.screenshot_paths[i];
      if (isRemoteAsset(value)) {
        const local = await cacheRemoteImage(value, ART_SCREENSHOTS_DIR, `${slugBase}_shot_${i + 1}`);
        if (local) localized.push(local);
      } else if (value) {
        localized.push(value);
      }
    }
    next.screenshot_paths = localized;
  }

  return next;
}

function resolveLibretroLaunch(settings, system) {
  const libretroSystem = LIBRETRO_SYSTEMS.find(entry => entry.id === system);
  const raPath = settings.retroarchPath || '';
  const corePath = (settings.cores || {})[system] || '';

  if (!libretroSystem) {
    return { ok: false, error: `System "${system}" is not registered as a libretro platform.` };
  }
  if (!raPath) {
    return { ok: false, error: 'RetroArch path not configured in Settings.' };
  }
  if (!corePath) {
    return { ok: false, error: `No RetroArch core configured for ${libretroSystem.label}. Set it in Settings.` };
  }
  if (!fs.existsSync(raPath)) {
    return { ok: false, error: `RetroArch not found: ${raPath}` };
  }
  if (!fs.existsSync(corePath)) {
    return { ok: false, error: `Core not found: ${corePath}` };
  }

  return { ok: true, system: libretroSystem, raPath, corePath };
}

ipcMain.handle('libretro-systems', () => getLibretroSystems());

async function raGetGameList(consoleId, apiKey) {
  const cachePath = path.join(RA_CACHE_DIR, `gamelist_${consoleId}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const stat = fs.statSync(cachePath);
      if (Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000) {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      }
    } catch {}
  }
  return new Promise((resolve) => {
    const url = `https://retroachievements.org/API/API_GetGameList.php?y=${encodeURIComponent(apiKey)}&i=${consoleId}&f=1`;
    https.get(url, { headers: { 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (Array.isArray(json)) {
            fs.writeFileSync(cachePath, JSON.stringify(json));
            resolve(json);
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function raFetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

ipcMain.handle('ra-user-summary', async () => {
  const settings = loadSettings();
  const raAccount = readThirdPartyAccount('retroachievements');
  const username = (raAccount.login || settings.retroAchievementsUser || '').trim();
  const apiKey = (raAccount.secret || settings.retroAchievementsKey || '').trim();
  if (!username) return { ok: false, error: 'no-user' };
  if (!apiKey) return { ok: false, error: 'no-key' };

  try {
    const pointsUrl = `https://retroachievements.org/API/API_GetUserPoints.php?u=${encodeURIComponent(username)}&y=${encodeURIComponent(apiKey)}`;
    const pointsJson = await raFetchJson(pointsUrl);
    const softcorePoints = Number(pointsJson?.SoftcorePoints ?? pointsJson?.softcorePoints ?? 0) || 0;

    let offset = 0;
    let total = Infinity;
    let unlockedAchievements = 0;
    while (offset < total) {
      const progressUrl = `https://retroachievements.org/API/API_GetUserCompletionProgress.php?u=${encodeURIComponent(username)}&y=${encodeURIComponent(apiKey)}&c=500&o=${offset}`;
      const progressJson = await raFetchJson(progressUrl);
      const results = Array.isArray(progressJson?.Results)
        ? progressJson.Results
        : (Array.isArray(progressJson?.results) ? progressJson.results : []);
      const count = Number(progressJson?.Count ?? progressJson?.count ?? results.length) || results.length;
      total = Number(progressJson?.Total ?? progressJson?.total ?? results.length) || results.length;
      unlockedAchievements += results.reduce((sum, entry) => sum + (Number(entry?.NumAwarded ?? entry?.numAwarded ?? 0) || 0), 0);
      if (!count) break;
      offset += count;
    }

    return {
      ok: true,
      data: {
        username,
        softcorePoints,
        unlockedAchievements,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message || 'ra-fetch-failed' };
  }
});

ipcMain.handle('ra-game-search', async (_, { cleanName, system }) => fetchRaGameData(cleanName, system));

// ─── ROM cover art via SteamGridDB ─────────────────────────────────────────

ipcMain.handle('list-art-cache', (_, { system }) => {
  const result = {};
  try {
    const prefix = system ? `${system}_` : '';
    for (const file of fs.readdirSync(SGDB_CACHE_DIR)) {
      if (!file.endsWith('.jpg') && !file.endsWith('.png')) continue;
      if (prefix && !file.startsWith(prefix)) continue;
      if (fs.statSync(path.join(SGDB_CACHE_DIR, file)).size <= 512) continue;
      const ext      = file.endsWith('.png') ? '.png' : '.jpg';
      const cacheKey = file.slice(0, -ext.length);
      const url = 'file:///' + path.join(SGDB_CACHE_DIR, file).replace(/\\/g, '/');
      result[cacheKey] = url;
    }
  } catch {}
  return result;
});

function sgdbSearch(cleanName, apiKey) {
  return new Promise((resolve) => {
    const url = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleanName)}`;
    https.get(url, { headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)?.data?.[0] || null); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    const doGet = (u, hops) => {
      if (hops > 5) return resolve(false);
      https.get(u, { headers: { 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return doGet(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(false); }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(true); });
        file.on('error', () => { try { fs.unlinkSync(destPath); } catch {} resolve(false); });
      }).on('error', () => resolve(false));
    };
    doGet(url, 0);
  });
}

async function fetchSgdbAsset(kind, cleanName, system, apiKey) {
  if (!apiKey) return { ok: false, error: 'No SteamGridDB API key configured' };
  const slug = buildGameSlug(cleanName);
  const cacheKey = `${system}_${kind}_${slug}`;
  const webpPath = path.join(SGDB_CACHE_DIR, `${cacheKey}.webp`);
  const legacyExt = kind === 'grid' ? '.jpg' : '.png';
  const legacyPath = path.join(SGDB_CACHE_DIR, `${cacheKey}${legacyExt}`);
  const cachePath = fs.existsSync(webpPath) ? webpPath : legacyPath;
  const cacheUrl = fileUrlFromPath(cachePath);
  const missingPath = path.join(SGDB_CACHE_DIR, `${cacheKey}.missing`);
  const minSize = kind === 'grid' ? 1024 : 512;

  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > minSize) {
    return { ok: true, url: cacheUrl, path: cachePath, cached: true };
  }
  if (fs.existsSync(legacyPath) && fs.statSync(legacyPath).size > minSize) {
    const converted = await convertImageToWebp(legacyPath, webpPath);
    if (converted && fs.existsSync(converted) && fs.statSync(converted).size > minSize) {
      return { ok: true, url: fileUrlFromPath(converted), path: converted, cached: true };
    }
    return { ok: true, url: fileUrlFromPath(legacyPath), path: legacyPath, cached: true };
  }
  if (kind !== 'grid' && fs.existsSync(missingPath)) {
    return { ok: false, error: `No ${kind} (cached miss)`, miss: true };
  }

  const game = await sgdbSearch(cleanName, apiKey);
  if (!game?.id) {
    if (kind !== 'grid') fs.writeFileSync(missingPath, '');
    return { ok: false, error: 'Game not found on SteamGridDB' };
  }

  const endpoint = kind === 'grid'
    ? `https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=600x900&limit=1`
    : kind === 'logo'
      ? `https://www.steamgriddb.com/api/v2/logos/game/${game.id}?limit=1`
      : `https://www.steamgriddb.com/api/v2/icons/game/${game.id}?limit=1`;

  return new Promise((resolve) => {
    https.get(endpoint, { headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', async () => {
        try {
          const imgUrl = JSON.parse(data)?.data?.[0]?.url;
          if (!imgUrl) {
            if (kind !== 'grid') fs.writeFileSync(missingPath, '');
            return resolve({ ok: false, error: `No ${kind} found`, miss: kind !== 'grid' });
          }
          const ok = await downloadFile(imgUrl, legacyPath);
          if (!ok) {
            return resolve({ ok: false, error: 'Download failed' });
          }
          const converted = await convertImageToWebp(legacyPath, webpPath);
          const finalPath = converted || legacyPath;
          resolve(
            fs.existsSync(finalPath)
              ? { ok: true, url: fileUrlFromPath(finalPath), path: finalPath, cached: false }
              : { ok: false, error: 'Download failed' }
          );
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    }).on('error', err => resolve({ ok: false, error: err.message }));
  });
}

ipcMain.handle('get-rom-art', async (_, { cleanName, system }) => {
  const settings = loadSettings();
  const sgdbAccount = readThirdPartyAccount('steamgriddb');
  const apiKey   = sgdbAccount.secret || settings.steamGridDbKey || '';
  return fetchSgdbAsset('grid', cleanName, system, apiKey);
});

ipcMain.handle('get-rom-logo', async (_, { cleanName, system }) => {
  const settings = loadSettings();
  const sgdbAccount = readThirdPartyAccount('steamgriddb');
  const apiKey   = sgdbAccount.secret || settings.steamGridDbKey || '';
  return fetchSgdbAsset('logo', cleanName, system, apiKey);
});

ipcMain.handle('get-rom-icon', async (_, { cleanName, system }) => {
  const settings = loadSettings();
  const sgdbAccount = readThirdPartyAccount('steamgriddb');
  const apiKey   = sgdbAccount.secret || settings.steamGridDbKey || '';
  return fetchSgdbAsset('icon', cleanName, system, apiKey);
});


// ─── Stoat Chat Integration ─────────────────────────────────────────────────

// Wire up Stoat event forwarding to all renderer windows
stoat.setSendToRenderer((channel, data) => {
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send(channel, data); } catch {}
  });
});

// Auto-connect on launch if we have a stored session
app.whenReady().then(async () => {
  const settings = loadSettings();
  if (settings.stoatSession) {
    console.log('[Stoat] Resuming saved session...');
    const result = await stoat.useExistingSession(settings.stoatSession);
    if (!result.ok) {
      console.log('[Stoat] Session resume failed, clearing stored session');
      delete settings.stoatSession;
      saveSettings(settings);
    }
  }
});

ipcMain.handle('stoat-login', async (_, { email, password }) => {
  const result = await stoat.login(email, password);
  if (result.ok && result.session) {
    // Persist session token in settings
    const settings = loadSettings();
    settings.stoatSession = result.session;
    saveSettings(settings);
  }
  return result;
});

ipcMain.handle('stoat-logout', () => {
  const settings = loadSettings();
  delete settings.stoatSession;
  saveSettings(settings);
  return stoat.logout();
});

ipcMain.handle('stoat-status', () => stoat.getStatus());

ipcMain.handle('stoat-servers', () => stoat.getServers());

ipcMain.handle('stoat-channels', (_, { serverId }) => stoat.getChannels(serverId));

ipcMain.handle('stoat-dm-channels', () => stoat.getDMChannels());

ipcMain.handle('stoat-messages', async (_, { channelId, limit }) => {
  return stoat.getMessages(channelId, limit);
});

ipcMain.handle('stoat-send-message', async (_, { channelId, content }) => {
  return stoat.sendMessage(channelId, content);
});

ipcMain.handle('stoat-open-dm', async (_, { userId }) => {
  return stoat.openDM(userId);
});

ipcMain.handle('stoat-friends', () => stoat.getFriends());

ipcMain.handle('stoat-server-members', (_, { serverId }) => stoat.getServerMembers(serverId));

ipcMain.handle('stoat-set-presence', async (_, { text }) => stoat.setPresence(text));

ipcMain.handle('stoat-clear-presence', () => stoat.clearPresence());
