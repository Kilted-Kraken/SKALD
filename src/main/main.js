'use strict';
/**
 * RohanKar Launcher — main.js
 * Session 5: Auto-updater added (electron-updater + GitHub releases).
 */

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const net = require('net');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');
const extractZip = require('extract-zip');
const stoat = require('./stoat');
const { createEmulatorManager } = require('./emulator-manager');
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
const APP_ROOT_DIR      = app.getAppPath();
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
const XENIA_PROGRESS_LOG_PATH = path.join(USER_DATA, 'xenia-runtime-progress.log');
const XENIA_CONTENT_TRACE_PATH = path.join(USER_DATA, 'xenia-content-trace.json');
const RPCS3_INSTALL_MAP_PATH = path.join(USER_DATA, 'rpcs3-install-map.json');
const RPCS3_PKG_AUTOMATION_LOG_PATH = path.join(USER_DATA, 'rpcs3-pkg-automation.log');
const RPCS3_COMPATIBILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const RPCS3_FIRMWARE_URL = 'http://dus01.ps3.update.playstation.net/update/ps3/image/us/2026_0318_a2b60b6ac1d2e49e230144345616927c/PS3UPDAT.PUP';
const PS3_DISC_KEY_ARCHIVE_BASE = 'https://archive.org/download/sony-playstation-3-disc-keys-dat-cuesheets/Sony%20-%20PlayStation%203%20-%20Disc%20Keys%20%283388%29%20%282021-06-05%2001-59-33%29.zip';
const PS3_DISC_KEY_CATALOG_URL = 'https://ia800701.us.archive.org/view_archive.php?archive=/32/items/sony-playstation-3-disc-keys-dat-cuesheets/Sony%20-%20PlayStation%203%20-%20Disc%20Keys%20%283388%29%20%282021-06-05%2001-59-33%29.zip';
const BUNDLED_7ZIP_DIR  = app.isPackaged
  ? path.join(process.resourcesPath, 'tools', '7zip')
  : path.join(APP_ROOT_DIR, 'assets', 'tools', '7zip');
const MARKETPLACE_METADATA_CACHE = Object.create(null);
const LOCAL_XML_METADATA_CACHE = Object.create(null);
let latestEmulatorRuntimeProgress = { active: false, percent: 0, stage: '', message: '' };
const activeXeniaContentSnapshots = new Map();
const activeRPCS3InstallSnapshots = new Map();
const activeRPCS3AutoRelaunches = new Map();
const activeRPCS3PkgInstallWatchers = new Map();
const activeRPCS3WelcomeWatchers = new Map();
let skaldLaunchShieldTimer = null;
let skaldLaunchShieldState = null;
const activeRPCS3FirmwareWatchers = new Map();
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 90000;
let ps3DiscKeyIndexCache = null;
let rpcs3CompatibilityDbCache = null;
let latestUpdaterState = {
  status: app.isPackaged ? 'idle' : 'dev',
  currentVersion: app.getVersion(),
  version: '',
  releaseNotes: null,
  releaseDate: null,
  message: app.isPackaged ? '' : 'Update checks are disabled in development builds.',
  checkedAt: 0,
};
let updaterCheckNow = null;

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
      rating_esrb:   'TEXT',
      rating_acb:    'TEXT',
      rating_cero:   'TEXT',
      rating_pegi:   'TEXT',
      rating_usk:    'TEXT',
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
  const hydrated = {
    ...row,
    has_ra: !!row.has_ra,
    genres: fromJsonText(row.genres, row.genres || null),
    screenshot_paths: fromJsonText(row.screenshot_paths, []),
  };
  return attachRuntimeCompatibilityMetadata(hydrated);
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
    rating_esrb: payload.rating_esrb ?? null,
    rating_acb: payload.rating_acb ?? null,
    rating_cero: payload.rating_cero ?? null,
    rating_pegi: payload.rating_pegi ?? null,
    rating_usk: payload.rating_usk ?? null,
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
        rating_esrb = COALESCE(?, rating_esrb),
        rating_acb = COALESCE(?, rating_acb),
        rating_cero = COALESCE(?, rating_cero),
        rating_pegi = COALESCE(?, rating_pegi),
        rating_usk = COALESCE(?, rating_usk),
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
    normalized.rating_esrb,
    normalized.rating_acb,
    normalized.rating_cero,
    normalized.rating_pegi,
    normalized.rating_usk,
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
    rating_esrb: metadata.rating_esrb || data.rating_esrb || null,
    rating_acb: metadata.rating_acb || data.rating_acb || null,
    rating_cero: metadata.rating_cero || data.rating_cero || null,
    rating_pegi: metadata.rating_pegi || data.rating_pegi || null,
    rating_usk: metadata.rating_usk || data.rating_usk || null,
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

function localXmlMetadataDir(system) {
  if (!system) return null;
  const normalized = String(system || '').toLowerCase();
  const devPath = path.join(__dirname, '../../assets/metadata', normalized, 'xml');
  const packedPath = path.join(process.resourcesPath || '', 'metadata', normalized, 'xml');
  if (fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(packedPath)) return packedPath;
  return devPath;
}

function localImageMetadataDir(system, kind) {
  if (!system || !kind) return null;
  const normalizedSystem = String(system || '').toLowerCase();
  const normalizedKind = String(kind || '').toLowerCase();
  const devPath = path.join(__dirname, '../../assets/metadata', normalizedSystem, normalizedKind);
  const packedPath = path.join(process.resourcesPath || '', 'metadata', normalizedSystem, normalizedKind);
  if (fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(packedPath)) return packedPath;
  return devPath;
}

function localXmlMetadataCacheKey(system, fileName) {
  return `${String(system || 'unknown').toLowerCase()}::${String(fileName || '').toLowerCase()}`;
}

function localXmlMetadataIndexKey(system) {
  return `${String(system || 'unknown').toLowerCase()}::__index__`;
}

function localImageMetadataIndexKey(system, kind) {
  return `${String(system || 'unknown').toLowerCase()}::__images__::${String(kind || '').toLowerCase()}`;
}

function loadLocalXmlMetadataIndex(system) {
  const normalizedSystem = String(system || '').toLowerCase();
  const dir = localXmlMetadataDir(normalizedSystem);
  if (!dir || !fs.existsSync(dir)) return null;
  const cacheKey = localXmlMetadataIndexKey(normalizedSystem);
  try {
    const files = fs.readdirSync(dir).filter(name => /\.xml$/i.test(name));
    const statKey = files.map(name => {
      try {
        const stat = fs.statSync(path.join(dir, name));
        return `${name}:${stat.mtimeMs}`;
      } catch {
        return `${name}:0`;
      }
    }).join('|');
    const cached = LOCAL_XML_METADATA_CACHE[cacheKey];
    if (cached && cached.statKey === statKey) return cached.data;
    const byName = Object.create(null);
    for (const name of files) {
      const stem = String(name).replace(/\.xml$/i, '');
      const keys = [
        sanitizeTitle(stem).toLowerCase(),
        sanitizeTitle(parseRomFilename(stem).cleanName || stem).toLowerCase(),
        sanitizeTitle(sanitizeTitle(stem)).toLowerCase(),
        normalizeScanName(stem),
        normalizeScanName(parseRomFilename(stem).cleanName || stem),
      ].filter(Boolean);
      for (const key of keys) {
        if (key && !byName[key]) byName[key] = name;
      }
    }
    const index = { dir, byName };
    LOCAL_XML_METADATA_CACHE[cacheKey] = { statKey, data: index };
    return index;
  } catch {
    return null;
  }
}

function loadLocalImageMetadataIndex(system, kind) {
  const normalizedSystem = String(system || '').toLowerCase();
  const normalizedKind = String(kind || '').toLowerCase();
  const dir = localImageMetadataDir(normalizedSystem, normalizedKind);
  if (!dir || !fs.existsSync(dir)) return null;
  const cacheKey = localImageMetadataIndexKey(normalizedSystem, normalizedKind);
  try {
    const files = fs.readdirSync(dir).filter(name => /\.(webp|png|jpg|jpeg)$/i.test(name));
    const statKey = files.map(name => {
      try {
        const stat = fs.statSync(path.join(dir, name));
        return `${name}:${stat.mtimeMs}`;
      } catch {
        return `${name}:0`;
      }
    }).join('|');
    const cached = LOCAL_XML_METADATA_CACHE[cacheKey];
    if (cached && cached.statKey === statKey) return cached.data;
    const byName = Object.create(null);
    for (const name of files) {
      const stem = String(name).replace(/\.[^.]+$/i, '');
      const keys = [
        sanitizeTitle(stem).toLowerCase(),
        sanitizeTitle(parseRomFilename(stem).cleanName || stem).toLowerCase(),
        normalizeScanName(stem),
        normalizeScanName(parseRomFilename(stem).cleanName || stem),
      ].filter(Boolean);
      for (const key of keys) {
        if (!key) continue;
        if (normalizedKind === 'screenshots') {
          if (!Array.isArray(byName[key])) byName[key] = [];
          byName[key].push(name);
        } else if (!byName[key]) {
          byName[key] = name;
        }
      }
    }
    if (normalizedKind === 'screenshots') {
      Object.keys(byName).forEach((key) => {
        byName[key].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      });
    }
    const index = { dir, byName };
    LOCAL_XML_METADATA_CACHE[cacheKey] = { statKey, data: index };
    return index;
  } catch {
    return null;
  }
}

function loadLocalImageMetadata(system, catalogIdentifier, title) {
  const normalizedSystem = String(system || '').toLowerCase();
  if (normalizedSystem !== 'x360') return null;
  const lookupKeys = [
    catalogIdentifier ? String(catalogIdentifier).replace(/\.[^.]+$/, '') : '',
    title || '',
    catalogIdentifier ? parseRomFilename(String(catalogIdentifier).replace(/\.[^.]+$/, '')).cleanName : '',
  ]
    .filter(Boolean)
    .flatMap(value => [sanitizeTitle(value).toLowerCase(), normalizeScanName(value)])
    .filter(Boolean);
  const uniqueKeys = [...new Set(lookupKeys)];
  if (!uniqueKeys.length) return null;

  const findSingle = (kind) => {
    const index = loadLocalImageMetadataIndex(normalizedSystem, kind);
    if (!index?.dir || !index.byName) return null;
    for (const key of uniqueKeys) {
      const fileName = index.byName[key];
      if (fileName) return path.join(index.dir, fileName);
    }
    return null;
  };
  const findMany = (kind) => {
    const index = loadLocalImageMetadataIndex(normalizedSystem, kind);
    if (!index?.dir || !index.byName) return [];
    for (const key of uniqueKeys) {
      const fileNames = index.byName[key];
      if (Array.isArray(fileNames) && fileNames.length) {
        return fileNames.map(fileName => path.join(index.dir, fileName));
      }
    }
    return [];
  };

  const iconPath = findSingle('icons');
  const coverPath = findSingle('covers');
  const marqueePath = findSingle('marquees');
  const screenshotPaths = findMany('screenshots');
  if (!iconPath && !coverPath && !marqueePath && !screenshotPaths.length) return null;
  return {
    icon_path: iconPath || null,
    cover_path: coverPath || null,
    logo_path: marqueePath || null,
    screenshot_paths: screenshotPaths,
  };
}

function parseSimpleGameXmlMetadata(xmlText = '', context = {}) {
  const text = String(xmlText || '');
  if (!text.trim()) return null;
  const readTag = (tag) => {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match?.[1] ? decodeHtmlEntities(String(match[1]).trim()) : '';
  };
  const title = readTag('name') || context.title || null;
  const genreText = readTag('genre');
  const ratingEsrb = readTag('rating_esrb');
  const ratingAcb = readTag('rating_acb');
  const ratingCero = readTag('rating_cero');
  const ratingPegi = readTag('rating_pegi');
  const ratingUsk = readTag('rating_usk');
  const genres = genreText
    ? genreText.split(',').map(value => String(value || '').trim()).filter(Boolean)
    : [];
  const players = readTag('players');
  const payload = {
    title,
    sort_title: sanitizeTitle(title || context.title || ''),
    system: context.system || null,
    provider: context.provider || 'archiveorg',
    catalog_identifier: context.catalogIdentifier || null,
    match_confidence: 1,
    metadata_status: 'ready',
    metadata_source: 'local-xml',
    description: readTag('desc') || null,
    genres,
    developer: readTag('developer') || null,
    publisher: readTag('publisher') || null,
    release_date: readTag('releasedate') || null,
    players: players || null,
    rating: null,
    rating_esrb: ratingEsrb || null,
    rating_acb: ratingAcb || null,
    rating_cero: ratingCero || null,
    rating_pegi: ratingPegi || null,
    rating_usk: ratingUsk || null,
    age_rating: ratingEsrb || null,
    age_rating_label: ratingEsrb || null,
    age_rating_board: ratingEsrb ? 'ESRB' : null,
    last_metadata_refresh: Date.now(),
  };
  if (
    !payload.description &&
    !payload.developer &&
    !payload.publisher &&
    !payload.release_date &&
    !payload.rating_esrb &&
    !payload.rating_acb &&
    !payload.rating_cero &&
    !payload.rating_pegi &&
    !payload.rating_usk &&
    !payload.players &&
    !payload.genres.length
  ) {
    payload.metadata_status = 'missing';
  }
  return payload;
}

function loadLocalXmlMetadata(system, catalogIdentifier, title, provider = 'archiveorg') {
  const normalizedSystem = String(system || '').toLowerCase();
  if (normalizedSystem !== 'x360') return null;
  const index = loadLocalXmlMetadataIndex(normalizedSystem);
  if (!index?.dir || !index.byName) return null;
  const lookupKeys = [
    catalogIdentifier ? String(catalogIdentifier).replace(/\.[^.]+$/,'') : '',
    title || '',
    catalogIdentifier ? parseRomFilename(String(catalogIdentifier).replace(/\.[^.]+$/,'')).cleanName : '',
  ]
    .filter(Boolean)
    .flatMap(value => [sanitizeTitle(value).toLowerCase(), normalizeScanName(value)])
    .filter(Boolean);
  for (const key of lookupKeys) {
    const fileName = index.byName[key];
    if (!fileName) continue;
    const fullPath = path.join(index.dir, fileName);
    const cacheKey = localXmlMetadataCacheKey(normalizedSystem, fileName);
    try {
      const stat = fs.statSync(fullPath);
      const cached = LOCAL_XML_METADATA_CACHE[cacheKey];
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
      const xmlText = fs.readFileSync(fullPath, 'utf8');
      const parsed = parseSimpleGameXmlMetadata(xmlText, {
        system: normalizedSystem,
        provider,
        catalogIdentifier,
        title,
      });
      if (!parsed) return null;
      LOCAL_XML_METADATA_CACHE[cacheKey] = { mtimeMs: stat.mtimeMs, data: parsed };
      return parsed;
    } catch {}
  }
  return null;
}

function repoSystemMetadataDir(system) {
  if (!system) return null;
  return path.join(__dirname, '../../assets/metadata', String(system || '').toLowerCase());
}

function repoSystemHarvestDir(system) {
  const baseDir = repoSystemMetadataDir(system);
  return baseDir ? path.join(baseDir, 'harvest') : null;
}

function ensureRepoSystemHarvestDirs(system) {
  const harvestDir = repoSystemHarvestDir(system);
  if (!harvestDir) return null;
  const dirs = {
    root: harvestDir,
    icons: path.join(harvestDir, 'icons'),
    covers: path.join(harvestDir, 'covers'),
    marquees: path.join(harvestDir, 'marquees'),
    screenshots: path.join(harvestDir, 'screenshots'),
  };
  Object.values(dirs).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  return dirs;
}

function safeMetadataFileStem(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '') || 'Unknown Game';
}

function localPathFromAssetValue(value) {
  if (!value || typeof value !== 'string') return null;
  if (/^file:\/\/\//i.test(value)) {
    try {
      return decodeURIComponent(new URL(value).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z]:\\/.test(value) || value.startsWith('\\\\')) return value;
  return null;
}

function copyHarvestAsset(sourceValue, destDir, destStem, index = null) {
  const sourcePath = localPathFromAssetValue(sourceValue);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  const ext = path.extname(sourcePath) || '.webp';
  const suffix = Number.isFinite(index) ? `-${String(index + 1).padStart(2, '0')}` : '';
  const destPath = path.join(destDir, `${safeMetadataFileStem(destStem)}${suffix}${ext.toLowerCase()}`);
  try {
    if (!fs.existsSync(destPath)) fs.copyFileSync(sourcePath, destPath);
    return destPath;
  } catch {
    return null;
  }
}

function summarizePreviewMetadata(payload = {}) {
  return {
    title: payload.title || null,
    sort_title: payload.sort_title || null,
    description: payload.description || null,
    genres: Array.isArray(payload.genres) ? payload.genres : normalizeProviderArray(payload.genres) || [],
    developer: payload.developer || null,
    publisher: payload.publisher || null,
    release_date: payload.release_date || null,
    players: payload.players || null,
    rating: payload.rating || null,
    rating_esrb: payload.rating_esrb || null,
    rating_acb: payload.rating_acb || null,
    rating_cero: payload.rating_cero || null,
    rating_pegi: payload.rating_pegi || null,
    rating_usk: payload.rating_usk || null,
    age_rating: payload.age_rating || null,
    age_rating_label: payload.age_rating_label || null,
    age_rating_board: payload.age_rating_board || null,
    platform_name: payload.platform_name || null,
    metadata_source: payload.metadata_source || null,
  };
}

function buildVariantSummary(rom = {}) {
  return {
    name: rom.name || null,
    cleanName: rom.cleanName || null,
    region: rom.region || null,
    tags: Array.isArray(rom.tags) ? rom.tags : [],
    size: rom.size || null,
    sizeBytes: rom.sizeBytes ?? null,
    timestamp: rom.timestamp || null,
    downloadUrl: rom.downloadUrl || null,
  };
}

async function exportMarketplaceMetadataPack({ system, provider = 'archiveorg', limit = 0 } = {}) {
  const normalizedSystem = String(system || '').toLowerCase();
  if (!normalizedSystem) return { ok: false, error: 'Missing system.' };
  const harvestDirs = ensureRepoSystemHarvestDirs(normalizedSystem);
  if (!harvestDirs) return { ok: false, error: 'Could not prepare harvest directory.' };

  const catalog = await fetchMarketplaceCatalog(provider, normalizedSystem);
  const roms = Array.isArray(catalog?.roms) ? catalog.roms : [];
  if (!roms.length) return { ok: false, error: `No catalog entries available for ${normalizedSystem}.` };
  const sourceRoms = limit > 0 ? roms.slice(0, limit) : roms.slice();
  const groups = new Map();

  for (const rom of sourceRoms) {
    const canonicalTitle = String(rom?.cleanName || parseRomFilename(rom?.name || '').cleanName || rom?.name || 'Unknown Game').trim() || 'Unknown Game';
    const groupKey = sanitizeTitle(canonicalTitle).toLowerCase();
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        title: canonicalTitle,
        sort_title: sanitizeTitle(canonicalTitle),
        system: normalizedSystem,
        provider,
        metadata: null,
        art: {
          icon: null,
          cover: null,
          marquee: null,
          screenshots: [],
        },
        variants: [],
      };
      groups.set(groupKey, group);
    }
    group.variants.push(buildVariantSummary(rom));

    if (!group.metadata) {
      const preview = await buildGameEnrichmentPreview({
        title: canonicalTitle,
        system: normalizedSystem,
        provider,
        catalogIdentifier: rom?.name || null,
      });
      if (preview?.ok && preview.data) {
        group.metadata = summarizePreviewMetadata(preview.data);
        const stem = canonicalTitle;
        const iconPath = copyHarvestAsset(preview.data.icon_path, harvestDirs.icons, stem);
        const coverPath = copyHarvestAsset(preview.data.cover_path, harvestDirs.covers, stem);
        const logoPath = copyHarvestAsset(preview.data.logo_path, harvestDirs.marquees, stem);
        const screenshotPaths = Array.isArray(preview.data.screenshot_paths)
          ? preview.data.screenshot_paths
              .map((value, idx) => copyHarvestAsset(value, harvestDirs.screenshots, stem, idx))
              .filter(Boolean)
          : [];
        group.art = {
          icon: iconPath ? path.relative(harvestDirs.root, iconPath).replace(/\\/g, '/') : null,
          cover: coverPath ? path.relative(harvestDirs.root, coverPath).replace(/\\/g, '/') : null,
          marquee: logoPath ? path.relative(harvestDirs.root, logoPath).replace(/\\/g, '/') : null,
          screenshots: screenshotPaths.map(filePath => path.relative(harvestDirs.root, filePath).replace(/\\/g, '/')),
        };
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    system: normalizedSystem,
    provider,
    totalSourceEntries: sourceRoms.length,
    totalGroupedTitles: groups.size,
    items: [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
  };
  const manifestPath = path.join(harvestDirs.root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return {
    ok: true,
    system: normalizedSystem,
    provider,
    manifestPath,
    harvestDir: harvestDirs.root,
    totalSourceEntries: manifest.totalSourceEntries,
    totalGroupedTitles: manifest.totalGroupedTitles,
  };
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
    rating_esrb: entry.rating_esrb || null,
    rating_acb: entry.rating_acb || null,
    rating_cero: entry.rating_cero || null,
    rating_pegi: entry.rating_pegi || null,
    rating_usk: entry.rating_usk || null,
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
  return false;
}

// ─── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const parsed = emulatorManager.normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')));
      if (!parsed.metadataService || typeof parsed.metadataService !== 'object') {
        parsed.metadataService = {};
      }
      parsed.retroarchPath = parsed.retroarchPath || parsed.emulators?.retroarch?.executablePath || '';
      parsed.cores = { ...(parsed.cores || {}), ...(parsed.emulators?.retroarch?.cores || {}) };
      return parsed;
    }
  } catch {}
  return emulatorManager.normalizeSettings({ metadataService: {}, retroarchPath: '', cores: {} });
}

function saveSettings(data) {
  const normalized = emulatorManager.normalizeSettings(data);
  if (!normalized.metadataService || typeof normalized.metadataService !== 'object') {
    normalized.metadataService = {};
  }
  normalized.retroarchPath = normalized.emulators?.retroarch?.executablePath || normalized.retroarchPath || '';
  normalized.cores = { ...(normalized.cores || {}), ...(normalized.emulators?.retroarch?.cores || {}) };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(normalized, null, 2));
}

function syncManagedXeniaProfileIfPossible(settings = loadSettings()) {
  try {
    return emulatorManager.syncXeniaProfileConfig(settings);
  } catch (err) {
    console.warn('[xenia-profile] automatic sync failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err || 'Unknown error') };
  }
}

function getManagedXeniaContentRoot() {
  return path.join(USER_DATA, 'emulators', 'xenia', 'content');
}

function buildDirectorySnapshot(rootDir) {
  const snapshot = {};
  const normalizedRoot = String(rootDir || '').trim();
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) return snapshot;
  const walk = (currentDir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(normalizedRoot, fullPath).replace(/\\/g, '/');
      try {
        const stat = fs.statSync(fullPath);
        snapshot[relPath] = {
          isDirectory: stat.isDirectory(),
          size: stat.isFile() ? stat.size : 0,
          mtimeMs: Math.floor(stat.mtimeMs || 0),
        };
        if (stat.isDirectory()) walk(fullPath);
      } catch {}
    }
  };
  walk(normalizedRoot);
  return snapshot;
}

function diffDirectorySnapshots(before = {}, after = {}) {
  const created = [];
  const changed = [];
  const deleted = [];
  const beforeKeys = new Set(Object.keys(before || {}));
  const afterKeys = new Set(Object.keys(after || {}));
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      created.push(key);
      continue;
    }
    const prev = before[key] || {};
    const next = after[key] || {};
    if (
      !!prev.isDirectory !== !!next.isDirectory ||
      Number(prev.size || 0) !== Number(next.size || 0) ||
      Number(prev.mtimeMs || 0) !== Number(next.mtimeMs || 0)
    ) {
      changed.push(key);
    }
  }
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) deleted.push(key);
  }
  return { created, changed, deleted };
}

function writeXeniaContentTrace(record) {
  try {
    const nextRecord = record && typeof record === 'object' ? record : {};
    let payload = { history: [] };
    if (fs.existsSync(XENIA_CONTENT_TRACE_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(XENIA_CONTENT_TRACE_PATH, 'utf8'));
        if (parsed && Array.isArray(parsed.history)) payload = parsed;
      } catch {}
    }
    payload.last = nextRecord;
    payload.history = [nextRecord, ...(payload.history || [])].slice(0, 20);
    fs.writeFileSync(XENIA_CONTENT_TRACE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
}

const emulatorManager = createEmulatorManager({
  fs,
  path,
  spawn,
  userDataDir: USER_DATA,
  loadSettings,
  markGamePlayed: (identifier) => {
    try { markGamePlayed(identifier); } catch {}
  },
  onSessionsChanged: (sessions) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('emulator-sessions-changed', sessions); } catch {}
    }
  },
  onSessionStarted: (session) => {
    const emulatorId = String(session?.emulatorId || '');
    if (emulatorId === 'xenia') {
      const contentRoot = getManagedXeniaContentRoot();
      activeXeniaContentSnapshots.set(String(session.id || ''), {
        takenAt: Date.now(),
        contentRoot,
        snapshot: buildDirectorySnapshot(contentRoot),
        session,
      });
      return;
    }
    if (emulatorId === 'rpcs3') {
      const gameRoot = getManagedRPCS3GameRoot();
      const discRoot = getManagedRPCS3DiscRoot();
      const launchPath = String(session?.romPath || session?.sourcePath || '').trim();
      const isInstalledTitleLaunch = isRPCS3InstalledTitlePath(launchPath);
      publishEmulatorRuntimeProgress({
        stage: 'game-launching',
        percent: isInstalledTitleLaunch ? 92 : 38,
        message: isInstalledTitleLaunch ? 'Launching PlayStation 3 game…' : 'Preparing PlayStation 3 game…',
      });
      promoteSkaldLaunchShield(isInstalledTitleLaunch ? 8200 : 12000);
      activeRPCS3InstallSnapshots.set(String(session.id || ''), {
        takenAt: Date.now(),
        gameRoot,
        discRoot,
        snapshot: buildRPCS3InstalledTitleSnapshot(gameRoot),
        discSnapshot: buildRPCS3MountedDiscSnapshot(discRoot),
        mountedTitleId: '',
        session,
      });
      const sessionId = String(session.id || '');
      setTimeout(() => {
        const current = activeRPCS3InstallSnapshots.get(sessionId);
        if (!current) return;
        const latestDiscSnapshot = buildRPCS3MountedDiscSnapshot(current.discRoot || getManagedRPCS3DiscRoot());
        const mountedTitleId = pickRPCS3MountedTitleId(current.discSnapshot || {}, latestDiscSnapshot);
        activeRPCS3InstallSnapshots.set(sessionId, {
          ...current,
          discSnapshot: latestDiscSnapshot,
          mountedTitleId: mountedTitleId || current.mountedTitleId || '',
        });
      }, 8000);
      if (!isInstalledTitleLaunch) {
        setTimeout(() => promoteSkaldLaunchShield(12000), 1200);
        const keepSkaldFront = setInterval(() => promoteSkaldLaunchShield(12000), 1200);
        setTimeout(() => clearInterval(keepSkaldFront), 9000);
        setTimeout(() => {
          const currentStage = String(latestEmulatorRuntimeProgress?.stage || '');
          if (currentStage === 'pkg-installing') return;
          releaseSkaldLaunchShield();
          emulatorManager.focusSession(sessionId).catch(() => null);
        }, 6500);
        setTimeout(() => {
          const currentStage = String(latestEmulatorRuntimeProgress?.stage || '');
          if (currentStage === 'pkg-installing') return;
          publishEmulatorRuntimeProgress({ stage: 'complete', percent: 100, message: 'Game launched.' });
        }, 7600);
      } else {
        const keepSkaldFront = setInterval(() => promoteSkaldLaunchShield(8200), 900);
        setTimeout(() => clearInterval(keepSkaldFront), 5200);
        setTimeout(() => {
          releaseSkaldLaunchShield();
          emulatorManager.focusSession(sessionId).catch(() => null);
        }, 6500);
        setTimeout(() => publishEmulatorRuntimeProgress({ stage: 'complete', percent: 100, message: 'Game launched.' }), 7600);
      }
      // Firmware is installed through SKALD's setup flow before launch now.
      // Avoid steering RPCS3's missing-firmware file picker during gameplay.
      const rpcs3Setup = getRPCS3SetupStatus(loadSettings());
      if (!rpcs3Setup?.welcomeCompleted) startRPCS3WelcomeWatcher(session);
      startRPCS3PkgInstallWatcher(session);
    }
  },
  onSessionEnded: (session) => {
    const emulatorId = String(session?.emulatorId || '');
    if (emulatorId === 'xenia') {
      const sessionId = String(session?.id || '');
      const started = activeXeniaContentSnapshots.get(sessionId) || null;
      if (sessionId) activeXeniaContentSnapshots.delete(sessionId);
      const contentRoot = started?.contentRoot || getManagedXeniaContentRoot();
      const before = started?.snapshot || {};
      const after = buildDirectorySnapshot(contentRoot);
      const diff = diffDirectorySnapshots(before, after);
      writeXeniaContentTrace({
        generatedAt: Date.now(),
        session,
        contentRoot,
        beforeCount: Object.keys(before).length,
        afterCount: Object.keys(after).length,
        diff,
      });
      return;
    }
    if (emulatorId === 'rpcs3') {
      const sessionId = String(session?.id || '');
      logRPCS3PkgAutomation(`session-ended session=${sessionId} exit=${String(session?.exitCode ?? '')}`);
      clearRPCS3FirmwareWatcher(sessionId);
      clearRPCS3WelcomeWatcher(sessionId);
      clearRPCS3PkgInstallWatcher(sessionId);
      const started = activeRPCS3InstallSnapshots.get(sessionId) || null;
      if (sessionId) activeRPCS3InstallSnapshots.delete(sessionId);
      const gameRoot = started?.gameRoot || getManagedRPCS3GameRoot();
      const before = started?.snapshot || {};
      const after = buildRPCS3InstalledTitleSnapshot(gameRoot);
      const candidate = pickRPCS3InstalledTitleCandidate(before, after);
      const mountedTitleId = String(started?.mountedTitleId || '').trim();
      const mountedCandidate = mountedTitleId && after[mountedTitleId]
        ? { titleId: mountedTitleId, ...after[mountedTitleId] }
        : null;
      const remembered = candidate || mountedCandidate || null;
      if (remembered && session?.identifier) {
        rememberRPCS3InstalledTitle(session.identifier, remembered);
        maybeAutoRelaunchRPCS3InstalledTitle(session, remembered);
      }
    }
  },
});

const PROFILE_GAMERPICS_DIR = 'C:\\Projects\\RG-THEMES\\X360 BLADES\\XBMC360\\XBMC360\\03.Extras\\GamerPics';
function normalizeStoatProfiles(settings) {
  if (!Array.isArray(settings.stoatProfiles)) settings.stoatProfiles = [];
  settings.stoatProfiles = settings.stoatProfiles
    .filter(profile => profile && typeof profile === 'object' && profile.id && profile.session)
    .map(profile => ({
      id: String(profile.id),
      username: String(profile.username || ''),
      displayName: String(profile.displayName || profile.display_name || profile.username || ''),
      avatar: String(profile.avatar || ''),
      session: profile.session,
    }));
  return settings.stoatProfiles;
}
function upsertStoatProfile(settings, user, session) {
  const profiles = normalizeStoatProfiles(settings);
  const id = String(user?.id || user?.username || user?.email || Date.now());
  const next = {
    id,
    username: String(user?.username || ''),
    displayName: String(user?.displayName || user?.display_name || user?.username || ''),
    avatar: String(user?.avatar || ''),
    session,
  };
  const idx = profiles.findIndex(profile => String(profile.id) === id);
  if (idx >= 0) profiles[idx] = { ...profiles[idx], ...next };
  else profiles.push(next);
  return next;
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

async function getArchiveSessionDebugInfo() {
  try {
    const cookies = await getArchiveSessionCookies();
    const names = cookies.map(c => c.name).sort();
    return {
      cookieCount: cookies.length,
      hasLoggedInUser: names.includes('logged-in-user'),
      hasLoggedInSig: names.includes('logged-in-sig'),
      cookieNames: names,
    };
  } catch (err) {
    return {
      cookieCount: 0,
      hasLoggedInUser: false,
      hasLoggedInSig: false,
      cookieNames: [],
      error: err?.message || String(err),
    };
  }
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
  await restoreArchiveSession().catch(() => {});
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

ipcMain.handle('home-ads-list', async (_, opts = {}) => {
  const safeBlade = String(opts?.blade || 'games').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'games';
  const adsDir = path.join(APP_ROOT_DIR, 'assets', 'ads', safeBlade);
  const manifestPath = path.join(adsDir, 'ads.json');
  let manifest = [];
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    manifest = [];
  }
  if (!Array.isArray(manifest)) manifest = [];
  const ads = manifest.map((ad, index) => {
    const imageName = String(ad?.image || '').trim();
    const imagePath = path.isAbsolute(imageName) ? imageName : path.join(adsDir, imageName);
    let image = '';
    if (imageName && fs.existsSync(imagePath)) {
      image = pathToFileURL(imagePath).toString();
    }
    let url = '';
    try {
      const parsed = new URL(String(ad?.url || '').trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        url = parsed.toString();
      }
    } catch {}
    return {
      id: String(ad?.id || `ad-${index}`),
      title: String(ad?.title || 'Featured'),
      subtitle: String(ad?.subtitle || ''),
      description: String(ad?.description || ''),
      cta: String(ad?.cta || 'Open'),
      image,
      url,
    };
  }).filter(ad => ad.image && ad.url);
  return { ok: true, ads };
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
let guideOverlayWindow = null;
let youtubeVideoWindow = null;
let activeVlcProcess = null;
let activeVlcBounds = null;
let activeVlcControlPipe = '';
let activeVlcEventPipe = '';
let activeVlcEventServer = null;
let activeVlcFocusTimer = null;
let activeVlcAudioProcess = null;
let activeVlcAudioControlPipe = '';
let bladesOverlayState = {
  active: false,
  wasAlwaysOnTop: false,
  wasFullScreen: false,
};

function emitGuideOverlayState(active) {
  BrowserWindow.getAllWindows().forEach(win => {
    try {
      win.webContents.send('guide-overlay-state-changed', { active: !!active });
    } catch {}
  });
}

async function applyBladesGuideOverlayState(active) {
  if (!bladesWindow || bladesWindow.isDestroyed()) return { ok: false, error: 'Blades window is not open.' };
  const nextActive = !!active;
  if (nextActive === bladesOverlayState.active) return { ok: true };
  const activeSession = emulatorManager.getSessions().find(session => session.status === 'running' || session.status === 'suspended');
  if (nextActive) {
    bladesOverlayState = {
      active: true,
      wasAlwaysOnTop: bladesWindow.isAlwaysOnTop(),
      wasFullScreen: bladesWindow.isFullScreen(),
    };
    try {
      if (activeSession?.id) {
        await emulatorManager.minimizeSessionWindow(activeSession.id).catch(() => null);
        await emulatorManager.suspendSession(activeSession.id).catch(() => null);
      }
      bladesWindow.setAlwaysOnTop(true, 'screen-saver');
      bladesWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
      if (!bladesWindow.isFullScreen()) bladesWindow.setFullScreen(true);
      bladesWindow.show();
      bladesWindow.focus();
      bladesWindow.moveTop();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not promote the Guide overlay.' };
    }
  }
  try {
    if (activeSession?.id && activeSession.status === 'suspended') {
      await emulatorManager.resumeSession(activeSession.id).catch(() => null);
    }
    if (!bladesOverlayState.wasFullScreen && bladesWindow.isFullScreen()) bladesWindow.setFullScreen(false);
    bladesWindow.setAlwaysOnTop(!!bladesOverlayState.wasAlwaysOnTop);
    bladesWindow.setVisibleOnAllWorkspaces?.(false);
    if (activeSession?.id) {
      await emulatorManager.focusSession(activeSession.id).catch(() => null);
    }
    bladesOverlayState = {
      active: false,
      wasAlwaysOnTop: false,
      wasFullScreen: false,
    };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not restore the Blades window.' };
  }
}

function focusPreferredSkaldWindow() {
  const candidate = (!guideOverlayWindow?.isDestroyed() && guideOverlayWindow)
    || (!bladesWindow?.isDestroyed() && bladesWindow)
    || (!mainWindow?.isDestroyed() && mainWindow)
    || null;
  if (!candidate) return { ok: false, error: 'SKALD window is not available.' };
  try {
    candidate.show();
    candidate.focus();
    candidate.moveTop?.();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not focus SKALD.' };
  }
}

function promoteSkaldLaunchShield(durationMs = 8000) {
  const candidate = (!bladesWindow?.isDestroyed() && bladesWindow)
    || (!mainWindow?.isDestroyed() && mainWindow)
    || null;
  if (!candidate) return focusPreferredSkaldWindow();
  try {
    if (!skaldLaunchShieldState || skaldLaunchShieldState.window !== candidate) {
      skaldLaunchShieldState = {
        window: candidate,
        wasAlwaysOnTop: candidate.isAlwaysOnTop?.() || false,
      };
    }
    candidate.show();
    candidate.setAlwaysOnTop?.(true, 'screen-saver');
    candidate.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    candidate.focus();
    candidate.moveTop?.();
    if (skaldLaunchShieldTimer) clearTimeout(skaldLaunchShieldTimer);
    skaldLaunchShieldTimer = setTimeout(() => releaseSkaldLaunchShield(), Math.max(1000, Number(durationMs) || 8000));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not promote SKALD.' };
  }
}

function releaseSkaldLaunchShield() {
  if (skaldLaunchShieldTimer) {
    clearTimeout(skaldLaunchShieldTimer);
    skaldLaunchShieldTimer = null;
  }
  const state = skaldLaunchShieldState;
  skaldLaunchShieldState = null;
  try {
    const win = state?.window;
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop?.(!!state.wasAlwaysOnTop);
      win.setVisibleOnAllWorkspaces?.(false);
    }
  } catch {}
}

ipcMain.handle('blades-open', async () => {
  if (bladesWindow && !bladesWindow.isDestroyed()) {
    bladesWindow.focus();
    return { ok: true };
  }
  const ses = getSession();
  const displayBounds = screen.getPrimaryDisplay?.().bounds || { x: 0, y: 0, width: 1920, height: 1080 };
  bladesWindow = new BrowserWindow({
    x:               displayBounds.x,
    y:               displayBounds.y,
    width:           displayBounds.width,
    height:          displayBounds.height,
    frame:           false,
    transparent:     true,
    fullscreenable:  true,
    fullscreen:      false,
    resizable:       false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true,
      session:          ses,
    },
  });
  bladesWindow.setBounds(displayBounds);
  bladesWindow.show();
  bladesWindow.focus();
  bladesWindow.loadFile(path.join(__dirname, '../renderer/blades.html'));
  bladesWindow.on('closed', () => { bladesWindow = null; });
  return { ok: true };
});

ipcMain.handle('blades-close', () => {
  guideOverlayWindow?.close();
  bladesWindow?.close();
  return { ok: true };
});

ipcMain.handle('blades-guide-overlay-state', async (_, { active } = {}) => applyBladesGuideOverlayState(active));

ipcMain.handle('guide-overlay-open', async () => {
  const activeSession = emulatorManager.getSessions().find(session => session.status === 'running' || session.status === 'suspended');
  if (guideOverlayWindow && !guideOverlayWindow.isDestroyed()) {
    guideOverlayWindow.show();
    guideOverlayWindow.focus();
    guideOverlayWindow.moveTop();
    emitGuideOverlayState(true);
    return { ok: true };
  }
  if (activeSession?.id) {
    await emulatorManager.suspendSession(activeSession.id);
  }
  const ses = getSession();
  guideOverlayWindow = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    fullscreenable: true,
    fullscreen: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
    },
  });
  guideOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  guideOverlayWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  guideOverlayWindow.loadFile(path.join(__dirname, '../renderer/blades.html'), { query: { guideOverlay: '1' } });
  guideOverlayWindow.once('ready-to-show', () => {
    try {
      guideOverlayWindow.show();
      guideOverlayWindow.focus();
      guideOverlayWindow.moveTop();
      emitGuideOverlayState(true);
    } catch {}
  });
  guideOverlayWindow.on('closed', () => {
    guideOverlayWindow = null;
    emitGuideOverlayState(false);
  });
  return { ok: true };
});

ipcMain.handle('guide-overlay-close', async () => {
  const suspendedSession = emulatorManager.getSessions().find(session => session.status === 'suspended');
  if (suspendedSession?.id) {
    await emulatorManager.resumeSession(suspendedSession.id);
  }
  guideOverlayWindow?.close();
  return { ok: true };
});

ipcMain.handle('guide-overlay-command', async (_, command = {}) => {
  if (!guideOverlayWindow || guideOverlayWindow.isDestroyed()) return { ok: false, error: 'Guide overlay is not open.' };
  guideOverlayWindow.webContents.send('guide-overlay-command', command);
  return { ok: true };
});

ipcMain.handle('skald-shell-focus', async () => focusPreferredSkaldWindow());

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

function buildYouTubePlayerUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || '').trim())}&autoplay=1`;
}

ipcMain.handle('youtube-player-open', async (_, { videoId, title } = {}) => {
  const cleanVideoId = String(videoId || '').trim();
  if (!cleanVideoId) return { ok: false, error: 'Missing YouTube video id.' };
  const url = buildYouTubePlayerUrl(cleanVideoId);
  const parent = BrowserWindow.getFocusedWindow() || bladesWindow || mainWindow || null;

  if (youtubeVideoWindow && !youtubeVideoWindow.isDestroyed()) {
    youtubeVideoWindow.setTitle(title || 'SKALD Video Player');
    await youtubeVideoWindow.loadURL(url);
    youtubeVideoWindow.show();
    youtubeVideoWindow.focus();
    return { ok: true };
  }

  const ses = getSession();
  youtubeVideoWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    title: title || 'SKALD Video Player',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    parent: parent || undefined,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
    },
  });
  youtubeVideoWindow.removeMenu?.();
  youtubeVideoWindow.on('closed', () => { youtubeVideoWindow = null; });
  await youtubeVideoWindow.loadURL(url);
  youtubeVideoWindow.once('ready-to-show', () => {
    try { youtubeVideoWindow?.show(); } catch {}
    try { youtubeVideoWindow?.focus(); } catch {}
  });
  return { ok: true };
});

ipcMain.handle('youtube-player-close', () => {
  youtubeVideoWindow?.close();
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
function getDialogOwnerWindow() {
  return BrowserWindow.getFocusedWindow() || bladesWindow || mainWindow || null;
}
function scanMusicLibrary(dir) {
  try {
    if (!dir) return { ok: false, error: 'No music folder is set.' };
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) return { ok: false, error: 'Music folder does not exist.' };
    if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: 'Music path is not a folder.' };
    const extensions = new Set(['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.webm']);
    const tracks = [];
    const walk = (folder) => {
      const entries = fs.readdirSync(folder, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.has(ext)) continue;
        const relativePath = path.relative(resolved, fullPath);
        const parsed = path.parse(entry.name);
        tracks.push({
          id: relativePath.replace(/\\/g, '/').toLowerCase(),
          title: parsed.name,
          fileName: entry.name,
          path: fullPath,
          relativePath,
          url: pathToFileURL(fullPath).href,
        });
      }
    };
    walk(resolved);
    tracks.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
    return { ok: true, dir: resolved, tracks };
  } catch (e) {
    return { ok: false, error: e.message || 'Could not scan the music folder.' };
  }
}
ipcMain.handle('profile-gamerpics-list', async () => {
  try {
    if (!fs.existsSync(PROFILE_GAMERPICS_DIR)) return [];
    const files = fs.readdirSync(PROFILE_GAMERPICS_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .filter(name => /\.(png|jpe?g|webp|bmp)$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return files.map(name => {
      const fullPath = path.join(PROFILE_GAMERPICS_DIR, name);
      const normalized = fullPath.replace(/\\/g, '/');
      return {
        id: path.parse(name).name.toLowerCase(),
        title: path.parse(name).name,
        fileName: name,
        path: fullPath,
        url: `file:///${normalized}`,
      };
    });
  } catch {
    return [];
  }
});
ipcMain.handle('choose-folder', async () => {
  const res = await dialog.showOpenDialog(getDialogOwnerWindow(), { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('music-library-scan', async (_, { dir } = {}) => scanMusicLibrary(dir));
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
  const res = await dialog.showOpenDialog(getDialogOwnerWindow(), {
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
  const localXmlMetadata = provider === 'archiveorg' && effectiveSystem
    ? loadLocalXmlMetadata(effectiveSystem, catalogIdentifier, effectiveTitle, provider)
    : null;
  const packagedMetadata = provider === 'archiveorg' && effectiveSystem && shouldUsePackagedMarketplaceOnly(provider, effectiveSystem)
    ? normalizePackagedMarketplaceMetadata(
        getPackagedMarketplaceMetadata(provider, effectiveSystem, catalogIdentifier, effectiveTitle),
        { title: effectiveTitle, system: effectiveSystem, provider, catalogIdentifier }
      )
    : null;

  if (localXmlMetadata) {
    const localImages = loadLocalImageMetadata(effectiveSystem, catalogIdentifier, effectiveTitle);
    if (String(effectiveSystem || '').toLowerCase() === 'x360') {
      console.log('[x360-local-preview]', JSON.stringify({
        title: effectiveTitle,
        catalogIdentifier,
        localXml: true,
        localImages: !!localImages,
        cover: !!localImages?.cover_path,
        icon: !!localImages?.icon_path,
        logo: !!localImages?.logo_path,
        screenshots: Array.isArray(localImages?.screenshot_paths) ? localImages.screenshot_paths.length : 0,
      }));
    }
    if (localImages) {
      if (localImages.icon_path && !localXmlMetadata.icon_path) localXmlMetadata.icon_path = localImages.icon_path;
      if (localImages.logo_path && !localXmlMetadata.logo_path) localXmlMetadata.logo_path = localImages.logo_path;
      if (localImages.cover_path && !localXmlMetadata.cover_path) localXmlMetadata.cover_path = localImages.cover_path;
      if ((!Array.isArray(localXmlMetadata.screenshot_paths) || !localXmlMetadata.screenshot_paths.length) && Array.isArray(localImages.screenshot_paths) && localImages.screenshot_paths.length) {
        localXmlMetadata.screenshot_paths = localImages.screenshot_paths;
      }
    }
    const settings = loadSettings();
    const sgdbAccount = readThirdPartyAccount('steamgriddb');
    const sgdbKey = sgdbAccount.secret || settings.steamGridDbKey || '';
    if (sgdbKey && effectiveSystem) {
      const [icon, logo, cover] = await Promise.all([
        fetchSgdbAsset('icon', effectiveTitle, effectiveSystem, sgdbKey),
        fetchSgdbAsset('logo', effectiveTitle, effectiveSystem, sgdbKey),
        fetchSgdbAsset('grid', effectiveTitle, effectiveSystem, sgdbKey),
      ]);
      if (icon?.ok && !localXmlMetadata.icon_path) localXmlMetadata.icon_path = icon.path;
      if (logo?.ok && !localXmlMetadata.logo_path) localXmlMetadata.logo_path = logo.path;
      if (cover?.ok && !localXmlMetadata.cover_path) localXmlMetadata.cover_path = cover.path;
    }
    return { ok: true, data: normalizeEnrichmentAssetUrls(localXmlMetadata), source: 'local-xml', cached: true };
  }
  if (String(effectiveSystem || '').toLowerCase() === 'x360') {
    console.log('[x360-local-preview]', JSON.stringify({
      title: effectiveTitle,
      catalogIdentifier,
      localXml: false,
      localImages: false,
    }));
  }

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
    return { ok: true, data: normalizeEnrichmentAssetUrls(packagedMetadata), source: 'packaged-metadata', cached: true };
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
    return { ok: true, data: normalizeEnrichmentAssetUrls(payload), source: 'packaged-metadata', cached: true };
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
    return { ok: true, data: normalizeEnrichmentAssetUrls(localized), source: 'cloudflare-worker', cached: !!workerResult.cached };
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

  return { ok: true, data: normalizeEnrichmentAssetUrls(payload), source: 'local-providers', cached: false, workerError: workerResult?.skipped ? null : workerResult?.error || null };
}

ipcMain.handle('metadata-preview-game', async (_, { title, system, provider = null, catalogIdentifier = null }) => {
  if (!title) return { ok: false, error: 'Missing title' };
  return buildGameEnrichmentPreview({ title, system, provider, catalogIdentifier });
});

ipcMain.handle('metadata-export-system-pack', async (_, { system, provider = 'archiveorg', limit = 0 } = {}) => {
  return exportMarketplaceMetadataPack({ system, provider, limit });
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
    'Accept': 'application/octet-stream,application/zip,application/x-7z-compressed,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

function archiveHtmlHeaders(cookieHeader = '', referer = 'https://archive.org/') {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

function archiveDownloadReferer(downloadUrl = '') {
  try {
    const parsed = new URL(downloadUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const downloadIdx = parts.indexOf('download');
    if (downloadIdx >= 0 && parts[downloadIdx + 1]) {
      return `https://archive.org/details/${parts[downloadIdx + 1]}`;
    }
    const itemsIdx = parts.indexOf('items');
    if (itemsIdx >= 0 && parts[itemsIdx + 1]) {
      return `https://archive.org/details/${parts[itemsIdx + 1]}`;
    }
  } catch {}
  return 'https://archive.org/';
}

function archiveItemIdFromUrl(url = '') {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const downloadIdx = parts.indexOf('download');
    if (downloadIdx >= 0 && parts[downloadIdx + 1]) return parts[downloadIdx + 1];
    const itemsIdx = parts.indexOf('items');
    if (itemsIdx >= 0 && parts[itemsIdx + 1]) return parts[itemsIdx + 1];
  } catch {}
  return '';
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
        headers: archiveHtmlHeaders(cookieHeader, referer),
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

function assetPathToRendererUrl(value) {
  if (!value || typeof value !== 'string') return value;
  if (/^(https?:|file:)/i.test(value)) return value;
  try {
    if (fs.existsSync(value)) return filePathToFileUrl(value);
  } catch {}
  return value;
}

function normalizeEnrichmentAssetUrls(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  ['cover_path', 'logo_path', 'icon_path', 'background_path', 'ra_badge_path'].forEach(field => {
    next[field] = assetPathToRendererUrl(next[field]);
  });
  if (Array.isArray(next.screenshot_paths)) {
    next.screenshot_paths = next.screenshot_paths.map(assetPathToRendererUrl).filter(Boolean);
  }
  return next;
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

function getSevenZipExecutableCandidates() {
  if (process.platform !== 'win32') return [];
  const candidates = [
    path.join(BUNDLED_7ZIP_DIR, '7z.exe'),
    path.join(BUNDLED_7ZIP_DIR, '7za.exe'),
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  return candidates.filter(Boolean);
}

function resolveSevenZipExecutable() {
  return getSevenZipExecutableCandidates().find(candidate => fs.existsSync(candidate)) || '';
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function appendXeniaProgressLog(message) {
  try {
    fs.appendFileSync(XENIA_PROGRESS_LOG_PATH, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {}
}

function downloadFileToPath(url, destFile, { headers = {}, timeoutMs = 60000, onProgress = null } = {}) {
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
        headers: {
          'User-Agent': 'SKALD-Launcher/0.1',
          ...headers,
        },
        timeout: timeoutMs,
      }, (res) => {
        const { statusCode, headers: responseHeaders } = res;
        if ([301, 302, 303, 307, 308].includes(statusCode) && responseHeaders.location) {
          res.resume();
          let next = responseHeaders.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          doRequest(next, redirectCount + 1);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          return resolve({ ok: false, error: `HTTP ${statusCode} from ${parsed.hostname}`, url: requestUrl });
        }
        const total = Number(responseHeaders['content-length'] || 0) || 0;
        let received = 0;
        const file = fs.createWriteStream(destFile);
        res.on('data', (chunk) => {
          received += chunk?.length || 0;
          if (typeof onProgress === 'function') {
            const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : null;
            onProgress({ stage: 'downloading', received, total, percent, url: requestUrl });
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve({ ok: true, filePath: destFile, url: requestUrl });
        });
        file.on('error', (err) => {
          fs.unlink(destFile, () => {});
          resolve({ ok: false, error: err.message, url: requestUrl });
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Connection timed out', url: requestUrl });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message, url: requestUrl }));
      req.end();
    };
    doRequest(url, 0);
  });
}

function fetchText(url, { headers = {}, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl, redirectCount) => {
      if (redirectCount > 10) return reject(new Error('Too many redirects'));
      let parsed;
      try {
        parsed = new URL(requestUrl);
      } catch (err) {
        reject(err);
        return;
      }
      const protocol = parsed.protocol === 'https:' ? https : http;
      const req = protocol.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'SKALD-Launcher/0.1',
          ...headers,
        },
        timeout: timeoutMs,
      }, (res) => {
        const { statusCode, headers: responseHeaders } = res;
        if ([301, 302, 303, 307, 308].includes(statusCode) && responseHeaders.location) {
          res.resume();
          let next = responseHeaders.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          doRequest(next, redirectCount + 1);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${statusCode} from ${parsed.hostname}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
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

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...((options && options.headers) || {}),
    },
    timeoutMs: options?.timeoutMs || 30000,
  });
  return JSON.parse(text);
}

async function resolveRetroArchStableWindowsDownload() {
  const platformsUrl = 'https://retroarch.com/?page=platforms';
  const html = await fetchText(platformsUrl);
  const versionMatch = html.match(/The current stable version is:\s*([0-9]+\.[0-9]+\.[0-9]+)/i);
  const version = versionMatch?.[1] || '';
  if (!version) {
    return { ok: false, error: 'Could not determine the current RetroArch stable version from the official platforms page.' };
  }
  return {
    ok: true,
    version,
    archiveUrl: `https://buildbot.libretro.com/stable/${version}/windows/x86_64/RetroArch.7z`,
    sourcePage: platformsUrl,
  };
}

async function resolvePCSX2StableWindowsDownload() {
  const releasesUrl = 'https://api.github.com/repos/PCSX2/pcsx2/releases?per_page=10';
  const releases = await fetchJson(releasesUrl, { timeoutMs: 30000 });
  if (!Array.isArray(releases) || !releases.length) {
    return { ok: false, error: 'Could not read the current PCSX2 releases from GitHub.' };
  }
  const findWindowsAsset = (entry) => (entry?.assets || []).find(asset => {
    const name = String(asset?.name || '').toLowerCase();
    if (!name) return false;
    if (!(name.endsWith('.7z') || name.endsWith('.zip'))) return false;
    if (!name.includes('windows')) return false;
    if (!(name.includes('qt') || name.includes('x64') || name.includes('64bit'))) return false;
    if (name.includes('symbols') || name.includes('debug') || name.includes('src') || name.includes('source')) return false;
    return true;
  }) || null;
  const stableRelease = releases.find(entry => !entry?.draft && !entry?.prerelease && findWindowsAsset(entry)) || null;
  const fallbackRelease = releases.find(entry => !entry?.draft && findWindowsAsset(entry)) || null;
  const release = stableRelease || fallbackRelease;
  if (!release) {
    return { ok: false, error: 'Could not find a PCSX2 release with downloadable Windows assets.' };
  }
  const asset = findWindowsAsset(release);
  if (!asset?.browser_download_url) {
    return { ok: false, error: 'Could not find a Windows PCSX2 package in the current stable release assets.' };
  }
  return {
    ok: true,
    version: String(release.tag_name || release.name || '').trim(),
    archiveUrl: asset.browser_download_url,
    archiveFileName: asset.name,
    sourcePage: String(release.html_url || 'https://github.com/PCSX2/pcsx2/releases'),
    prerelease: !!release.prerelease,
  };
}

async function resolveRPCS3StableWindowsDownload() {
  const sourcePage = 'https://rpcs3.net/download';
  const latestWindowsUrl = 'https://rpcs3.net/latest-windows';
  const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

  const inspectHeaders = (targetUrl, redirectCount = 0, method = 'HEAD') => new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(targetUrl); }
    catch { return resolve({ ok: false, error: 'Invalid RPCS3 Windows download URL.' }); }

    const transport = parsed.protocol === 'http:' ? require('http') : https;
    const req = transport.request(parsed, {
      method,
      headers: {
        'User-Agent': browserUserAgent,
        Referer: sourcePage,
        Accept: '*/*',
      },
      timeout: 30000,
    }, (res) => {
      const statusCode = Number(res.statusCode || 0);
      const location = String(res.headers?.location || '').trim();
      if (statusCode >= 300 && statusCode < 400 && location && redirectCount < 6) {
        const nextUrl = new URL(location, parsed).toString();
        res.resume();
        resolve(inspectHeaders(nextUrl, redirectCount + 1, method));
        return;
      }
      res.resume();
      resolve({
        ok: statusCode >= 200 && statusCode < 400,
        statusCode,
        finalUrl: targetUrl,
        headers: res.headers || {},
        method,
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', (error) => resolve({ ok: false, error: error?.message || `Could not inspect the RPCS3 download headers with ${method}.` }));
    req.end();
  });

  let headerResult = await inspectHeaders(latestWindowsUrl, 0, 'HEAD');
  const headFailed = !headerResult?.ok;
  if (headFailed) {
    headerResult = await inspectHeaders(latestWindowsUrl, 0, 'GET');
  }
  if (!headerResult?.ok) {
    return {
      ok: false,
      error: headerResult?.error || 'Could not inspect the current official RPCS3 Windows build before download.',
    };
  }

  const contentDisposition = String(headerResult?.headers?.['content-disposition'] || '').trim();
  let archiveFileName = '';
  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = contentDisposition.match(/filename="?([^\";]+)"?/i);
  archiveFileName = decodeURIComponent(String(utfMatch?.[1] || plainMatch?.[1] || '').trim());
  if (!archiveFileName) {
    try {
      archiveFileName = path.basename(new URL(String(headerResult.finalUrl || latestWindowsUrl)).pathname);
    } catch {
      archiveFileName = 'rpcs3-win.7z';
    }
  }
  const version = archiveFileName
    .replace(/^rpcs3-/i, '')
    .replace(/_win.*$/i, '')
    .replace(/\.(7z|zip)$/i, '')
    .trim();

  return {
    ok: true,
    version: version || 'latest',
    archiveUrl: latestWindowsUrl,
    archiveFileName: archiveFileName || 'rpcs3-win.7z',
    sourcePage,
    userAgent: browserUserAgent,
  };
}

async function resolveVLCStableWindowsDownload() {
  const sourcePage = 'https://images.videolan.org/vlc/download-windows.html';
  const html = await fetchText(sourcePage, { timeoutMs: 30000 });
  const directMatch = html.match(/(?:https?:)?\/\/get\.videolan\.org\/vlc\/([0-9.]+)\/win64\/(vlc-\1-win64\.zip)/i);
  if (directMatch) {
    return {
      ok: true,
      version: String(directMatch[1] || '').trim(),
      archiveUrl: directMatch[0].startsWith('//') ? `https:${directMatch[0]}` : directMatch[0],
      archiveFileName: directMatch[2],
      sourcePage,
    };
  }
  const versionMatch =
    html.match(/Version(?:\s|&nbsp;|&#160;)+([0-9]+\.[0-9]+\.[0-9]+)/i)
    || html.match(/vlc-([0-9]+\.[0-9]+\.[0-9]+)-win64\.(?:zip|7z|msi|exe)/i);
  const version = String(versionMatch?.[1] || '').trim();
  if (!version) {
    return { ok: false, error: 'Could not determine the current VLC Windows version from the official VideoLAN download page.' };
  }
  return {
    ok: true,
    version,
    archiveUrl: `https://get.videolan.org/vlc/${version}/win64/vlc-${version}-win64.zip`,
    archiveFileName: `vlc-${version}-win64.zip`,
    sourcePage,
  };
}

async function resolveXeniaStableWindowsDownload() {
  const releasesUrl = 'https://api.github.com/repos/xenia-canary/xenia-canary-releases/releases?per_page=10';
  const releases = await fetchJson(releasesUrl, { headers: { 'User-Agent': 'SKALD Launcher' }, timeoutMs: 30000 });
  if (!Array.isArray(releases) || !releases.length) {
    return { ok: false, error: 'Could not read the current Xenia Canary releases from GitHub.' };
  }
  const release = releases.find(entry => !entry?.draft && /canary/i.test(String(entry?.name || entry?.tag_name || '')) && Array.isArray(entry?.assets) && entry.assets.length)
    || releases.find(entry => !entry?.draft && Array.isArray(entry?.assets) && entry.assets.length)
    || null;
  if (!release) {
    return { ok: false, error: 'Could not find a Xenia Canary release with downloadable Windows assets.' };
  }
  const asset = release.assets.find(entry => /xenia[_-]?canary[_-]?windows\.zip/i.test(String(entry?.name || '')))
    || release.assets.find(entry => /\.zip$/i.test(String(entry?.name || '')))
    || null;
  if (!asset?.browser_download_url) {
    return { ok: false, error: 'Could not find a Windows Xenia Canary package in the current release assets.' };
  }
  return {
    ok: true,
    version: String(release.tag_name || '').trim() || 'latest',
    archiveUrl: String(asset.browser_download_url || '').trim(),
    archiveFileName: String(asset.name || 'xenia_canary_windows.zip').trim(),
    archiveSize: Number(asset.size || 0) || 0,
    sourcePage: String(release.html_url || 'https://github.com/xenia-canary/xenia-canary-releases/releases'),
  };
}

function resolveRetroArchCoreDownload(systemId, coreFileName = '') {
  const system = (emulatorManager.getSystems() || []).find(entry => entry.id === systemId);
  if (!system?.coreExample) {
    return { ok: false, error: `System "${systemId}" is not registered for RetroArch core downloads.` };
  }
  const managedChoices = emulatorManager.getManagedCoreChoices?.(systemId) || [];
  const selectedChoice = managedChoices.find(choice => choice.fileName === String(coreFileName || '').trim())
    || managedChoices.find(choice => choice.fileName === system.coreExample)
    || managedChoices[0]
    || { fileName: system.coreExample, label: system.label };
  const buildbotBase = 'https://buildbot.libretro.com/nightly/windows/x86_64/latest/';
  return {
    ok: true,
    system: system.id,
    label: system.label,
    coreLabel: selectedChoice.label,
    coreFileName: selectedChoice.fileName,
    archiveFileName: `${selectedChoice.fileName}.zip`,
    archiveUrl: `${buildbotBase}${encodeURIComponent(selectedChoice.fileName)}.zip`,
    sourcePage: 'https://www.retroarch.com/',
  };
}

function findFileRecursive(dirPath, expectedName) {
  if (!dirPath || !expectedName || !fs.existsSync(dirPath)) return '';
  const queue = [dirPath];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()) return fullPath;
      if (entry.isDirectory()) queue.push(fullPath);
    }
  }
  return '';
}

async function downloadManagedRetroArchRuntime(onProgress = null) {
  const emitProgress = (payload = {}) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(payload); } catch {}
  };
  const runtimeStatus = emulatorManager.getRetroArchRuntimeStatus(loadSettings());
  const managedRuntimeDir = runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'retroarch');
  const stagingRoot = path.join(USER_DATA, 'emulators', 'downloads');
  const extractRoot = path.join(stagingRoot, 'retroarch-stable');
  const archivePath = path.join(stagingRoot, 'retroarch-stable.7z');
  const sevenZ = resolveSevenZipExecutable();

  if (!fs.existsSync(sevenZ)) {
    return { ok: false, error: 'SKALD could not find its 7-Zip runtime. Bundle the 7-Zip tools or install 7-Zip on Windows.' };
  }

  emitProgress({ stage: 'resolving', percent: 5, message: 'Checking the official RetroArch stable release…' });
  const release = await resolveRetroArchStableWindowsDownload();
  if (!release?.ok) return release;

  if (fs.existsSync(extractRoot)) {
    try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}
  }
  if (!fs.existsSync(stagingRoot)) fs.mkdirSync(stagingRoot, { recursive: true });

  emitProgress({ stage: 'downloading', percent: 8, message: `Downloading RetroArch ${release.version}…` });
  const downloadResult = await downloadFileToPath(release.archiveUrl, archivePath, {
    headers: {
      Referer: release.sourcePage,
      ...(release?.userAgent ? { 'User-Agent': release.userAgent } : {}),
    },
    timeoutMs: 120000,
    onProgress: ({ percent, received, total }) => {
      const scaled = percent == null
        ? Math.max(10, Math.min(55, 10 + Math.round((Number(received || 0) / (1024 * 1024)) * 2.1)))
        : Math.max(8, Math.min(55, 8 + Math.round(percent * 0.47)));
      emitProgress({
        stage: 'downloading',
        percent: scaled,
        received,
        total,
        message: total > 0
          ? `Downloading RetroArch ${release.version}… ${Math.round((received / total) * 100)}%`
          : `Downloading RetroArch ${release.version}…`,
      });
    },
  });
  if (!downloadResult?.ok) return downloadResult;

  emitProgress({ stage: 'extracting', percent: 58, message: 'Extracting the RetroArch package…' });
  const extractResult = await new Promise((resolve) => {
    execFile(sevenZ, ['x', archivePath, `-o${extractRoot}`, '-y'], (err) => {
      if (err) return resolve({ ok: false, error: err.message || 'Could not extract the RetroArch archive.' });
      resolve({ ok: true });
    });
  });
  if (!extractResult?.ok) return extractResult;

  const extractedExe = findFileRecursive(extractRoot, 'retroarch.exe');
  if (!extractedExe) {
    return { ok: false, error: 'RetroArch downloaded, but SKALD could not find retroarch.exe in the extracted package.' };
  }

  emitProgress({ stage: 'importing', percent: 68, message: 'Importing RetroArch into the SKALD managed runtime…' });
  const importResult = emulatorManager.importRetroArchRuntime(extractedExe);
  if (!importResult?.ok) return importResult;

  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      retroarch: {
        ...((settings.emulators || {}).retroarch || {}),
        mode: 'bundled',
        customExecutablePath: String(settings?.emulators?.retroarch?.customExecutablePath || settings.retroarchPath || '').trim(),
        cores: {
          ...(((settings.emulators || {}).retroarch || {}).cores || {}),
          ...(settings.cores || {}),
        },
      },
    },
  });
  saveSettings(next);

  try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
  try { if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}

  emitProgress({ stage: 'complete', percent: 100, message: `RetroArch ${release.version} is ready in SKALD.` });
  return {
    ok: true,
    version: release.version,
    archiveUrl: release.archiveUrl,
    managedRuntimeDir,
    executablePath: importResult.executablePath,
    status: emulatorManager.getRetroArchRuntimeStatus(loadSettings()),
  };
}

async function downloadManagedRetroArchCore(systemId, coreFileName = '', onProgress = null) {
  const emitProgress = (payload = {}) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(payload); } catch {}
  };
  const runtimeStatus = emulatorManager.getRetroArchRuntimeStatus(loadSettings());
  if (!runtimeStatus?.managedRuntimeDir) {
    return { ok: false, error: 'SKALD does not have a managed RetroArch runtime folder yet.' };
  }
  const managedRuntimeExe = emulatorManager.getRetroArchManagedExecutablePath?.() || path.join(runtimeStatus.managedRuntimeDir, 'retroarch.exe');
  if (!managedRuntimeExe || !fs.existsSync(managedRuntimeExe)) {
    return { ok: false, error: 'Install the SKALD managed RetroArch runtime before downloading cores.' };
  }

  const release = resolveRetroArchCoreDownload(systemId, coreFileName);
  if (!release?.ok) return release;

  const targetCoresDir = runtimeStatus?.managedCoresDir || path.join(runtimeStatus.managedRuntimeDir, 'cores');
  const stagingRoot = path.join(USER_DATA, 'emulators', 'downloads', 'cores');
  const archivePath = path.join(stagingRoot, release.archiveFileName);
  ensureDir(stagingRoot);
  ensureDir(targetCoresDir);

  emitProgress({ stage: 'resolving', percent: 5, message: `Checking the official ${release.coreLabel || release.label} core package…` });
  emitProgress({ stage: 'downloading', percent: 8, message: `Downloading ${release.coreLabel || release.label} core…` });
  const downloadResult = await downloadFileToPath(release.archiveUrl, archivePath, {
    headers: { Referer: release.sourcePage },
    timeoutMs: 120000,
    onProgress: ({ percent, received, total }) => {
      const scaled = percent == null
        ? Math.max(10, Math.min(60, 10 + Math.round((Number(received || 0) / (1024 * 1024)) * 4.5)))
        : Math.max(8, Math.min(60, 8 + Math.round(percent * 0.52)));
      emitProgress({
        stage: 'downloading',
        percent: scaled,
        received,
        total,
        message: total > 0
          ? `Downloading ${release.coreLabel || release.label} core… ${Math.round((received / total) * 100)}%`
          : `Downloading ${release.coreLabel || release.label} core…`,
      });
    },
  });
  if (!downloadResult?.ok) return downloadResult;

  emitProgress({ stage: 'extracting', percent: 68, message: `Installing ${release.coreLabel || release.label} into SKALD…` });
  try {
    await extractZip(archivePath, { dir: targetCoresDir });
  } catch (error) {
    return { ok: false, error: error?.message || `Could not extract the ${release.coreLabel || release.label} core package.` };
  }

  const extractedCorePath = findFileRecursive(targetCoresDir, release.coreFileName);
  if (!extractedCorePath) {
    return { ok: false, error: `SKALD downloaded ${release.coreLabel || release.label}, but could not find ${release.coreFileName} after extraction.` };
  }
  const normalizedCorePath = path.join(targetCoresDir, release.coreFileName);
  if (path.resolve(extractedCorePath) !== path.resolve(normalizedCorePath)) {
    try { fs.copyFileSync(extractedCorePath, normalizedCorePath); } catch {}
  }

  try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}

  emitProgress({ stage: 'complete', percent: 100, message: `${release.coreLabel || release.label} is ready in SKALD.` });
  return {
    ok: true,
    system: release.system,
    label: release.label,
    coreLabel: release.coreLabel,
    coreFileName: release.coreFileName,
    corePath: normalizedCorePath,
    status: emulatorManager.getLibretroCoreStatus(loadSettings())[release.system] || null,
  };
}

async function downloadManagedPCSX2Runtime(onProgress = null) {
  const emitProgress = (payload = {}) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(payload); } catch {}
  };
  const runtimeStatus = emulatorManager.getPCSX2RuntimeStatus(loadSettings());
  const managedRuntimeDir = runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'pcsx2');
  const stagingRoot = path.join(USER_DATA, 'emulators', 'downloads');
  const extractRoot = path.join(stagingRoot, 'pcsx2-stable');
  const sevenZ = resolveSevenZipExecutable();

  emitProgress({ stage: 'resolving', percent: 5, message: 'Checking the official PCSX2 stable release…' });
  const release = await resolvePCSX2StableWindowsDownload();
  if (!release?.ok) return release;

  const archivePath = path.join(stagingRoot, release.archiveFileName || 'pcsx2-stable.7z');
  if (fs.existsSync(extractRoot)) {
    try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}
  }
  ensureDir(stagingRoot);

  emitProgress({ stage: 'downloading', percent: 8, message: `Downloading PCSX2 ${release.version}…` });
  const downloadResult = await downloadFileToPath(release.archiveUrl, archivePath, {
    headers: { Referer: release.sourcePage },
    timeoutMs: 120000,
    onProgress: ({ percent, received, total }) => {
      const scaled = percent == null
        ? Math.max(10, Math.min(55, 10 + Math.round((Number(received || 0) / (1024 * 1024)) * 2.4)))
        : Math.max(8, Math.min(55, 8 + Math.round(percent * 0.47)));
      emitProgress({
        stage: 'downloading',
        percent: scaled,
        received,
        total,
        message: total > 0
          ? `Downloading PCSX2 ${release.version}… ${Math.round((received / total) * 100)}%`
          : `Downloading PCSX2 ${release.version}…`,
      });
    },
  });
  if (!downloadResult?.ok) return downloadResult;

  emitProgress({ stage: 'extracting', percent: 58, message: 'Extracting the PCSX2 package…' });
  const lowerArchive = String(archivePath || '').toLowerCase();
  if (lowerArchive.endsWith('.zip')) {
    try {
      await extractZip(archivePath, { dir: extractRoot });
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not extract the PCSX2 archive.' };
    }
  } else {
    if (!fs.existsSync(sevenZ)) {
      return { ok: false, error: 'SKALD could not find its 7-Zip runtime. Bundle the 7-Zip tools or install 7-Zip on Windows.' };
    }
    const extractResult = await new Promise((resolve) => {
      execFile(sevenZ, ['x', archivePath, `-o${extractRoot}`, '-y'], (err) => {
        if (err) return resolve({ ok: false, error: err.message || 'Could not extract the PCSX2 archive.' });
        resolve({ ok: true });
      });
    });
    if (!extractResult?.ok) return extractResult;
  }

  const extractedExe = findFileRecursive(extractRoot, 'pcsx2-qt.exe') || findFileRecursive(extractRoot, 'pcsx2.exe');
  if (!extractedExe) {
    return { ok: false, error: 'PCSX2 downloaded, but SKALD could not find pcsx2-qt.exe in the extracted package.' };
  }

  emitProgress({ stage: 'importing', percent: 68, message: 'Importing PCSX2 into the SKALD managed runtime…' });
  const importResult = emulatorManager.importPCSX2Runtime(extractedExe);
  if (!importResult?.ok) return importResult;

  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      pcsx2: {
        ...((settings.emulators || {}).pcsx2 || {}),
        mode: 'bundled',
        customExecutablePath: String(settings?.emulators?.pcsx2?.customExecutablePath || '').trim(),
        biosPath: String(settings?.emulators?.pcsx2?.biosPath || '').trim(),
      },
    },
  });
  saveSettings(next);

  try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
  try { if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}

  emitProgress({ stage: 'complete', percent: 100, message: `PCSX2 ${release.version} is ready in SKALD.` });
  return {
    ok: true,
    version: release.version,
    archiveUrl: release.archiveUrl,
    managedRuntimeDir,
    executablePath: importResult.executablePath,
    status: emulatorManager.getPCSX2RuntimeStatus(loadSettings()),
  };
}

async function downloadManagedRPCS3Runtime(onProgress = null) {
  const emitProgress = (payload = {}) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(payload); } catch {}
  };
  const runtimeStatus = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
  const managedRuntimeDir = runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'rpcs3');
  const stagingRoot = path.join(USER_DATA, 'emulators', 'downloads');
  const extractRoot = path.join(stagingRoot, 'rpcs3-stable');
  const sevenZ = resolveSevenZipExecutable();

  emitProgress({ stage: 'resolving', percent: 5, message: 'Checking the official RPCS3 Windows release…' });
  const release = await resolveRPCS3StableWindowsDownload();
  if (!release?.ok) return release;

  const archivePath = path.join(stagingRoot, release.archiveFileName || 'rpcs3-win.7z');
  if (fs.existsSync(extractRoot)) {
    try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}
  }
  ensureDir(stagingRoot);

  emitProgress({ stage: 'downloading', percent: 8, message: `Downloading RPCS3 ${release.version}…` });
  const downloadResult = await downloadFileToPath(release.archiveUrl, archivePath, {
    headers: { Referer: release.sourcePage },
    timeoutMs: 120000,
    onProgress: ({ percent, received, total }) => {
      const scaled = percent == null
        ? Math.max(10, Math.min(55, 10 + Math.round((Number(received || 0) / (1024 * 1024)) * 2.3)))
        : Math.max(8, Math.min(55, 8 + Math.round(percent * 0.47)));
      emitProgress({
        stage: 'downloading',
        percent: scaled,
        received,
        total,
        message: total > 0
          ? `Downloading RPCS3 ${release.version}… ${Math.round((received / total) * 100)}%`
          : `Downloading RPCS3 ${release.version}…`,
      });
    },
  });
  if (!downloadResult?.ok) return downloadResult;

  emitProgress({ stage: 'extracting', percent: 58, message: 'Extracting the RPCS3 package…' });
  const lowerArchive = String(archivePath || '').toLowerCase();
  if (lowerArchive.endsWith('.zip')) {
    try {
      await extractZip(archivePath, { dir: extractRoot });
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not extract the RPCS3 archive.' };
    }
  } else {
    if (!fs.existsSync(sevenZ)) {
      return { ok: false, error: 'SKALD could not find its 7-Zip runtime. Bundle the 7-Zip tools or install 7-Zip on Windows.' };
    }
    const extractResult = await new Promise((resolve) => {
      execFile(sevenZ, ['x', archivePath, `-o${extractRoot}`, '-y'], (err) => {
        if (err) return resolve({ ok: false, error: err.message || 'Could not extract the RPCS3 archive.' });
        resolve({ ok: true });
      });
    });
    if (!extractResult?.ok) return extractResult;
  }

  const extractedExe = findFileRecursive(extractRoot, 'rpcs3.exe');
  if (!extractedExe) {
    return { ok: false, error: 'RPCS3 downloaded, but SKALD could not find rpcs3.exe in the extracted package.' };
  }

  emitProgress({ stage: 'importing', percent: 68, message: 'Importing RPCS3 into the SKALD managed runtime…' });
  const importResult = emulatorManager.importRPCS3Runtime(extractedExe);
  if (!importResult?.ok) return importResult;

  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      rpcs3: {
        ...((settings.emulators || {}).rpcs3 || {}),
        mode: 'bundled',
        customExecutablePath: String(settings?.emulators?.rpcs3?.customExecutablePath || '').trim(),
      },
    },
  });
  saveSettings(next);

  const verifiedStatus = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
  if (!verifiedStatus?.ok || !verifiedStatus?.executablePath || !fs.existsSync(verifiedStatus.executablePath)) {
    return {
      ok: false,
      error: 'RPCS3 finished downloading, but SKALD could not verify the managed runtime after import.',
    };
  }
  const welcomeSync = syncRPCS3WelcomeConfigState({ markCompleted: true });
  if (!welcomeSync?.ok) return welcomeSync;

  try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
  try { if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}

  emitProgress({ stage: 'complete', percent: 100, message: `RPCS3 ${release.version} is ready in SKALD.` });
  return {
    ok: true,
    version: release.version,
    archiveUrl: release.archiveUrl,
    managedRuntimeDir,
    executablePath: importResult.executablePath,
      status: verifiedStatus,
    };
  }

  async function downloadManagedRPCS3Firmware(onProgress = null) {
  const emitProgress = (payload = {}) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(payload); } catch {}
  };
  const runtimeStatus = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
  const runtimeRoot = String(runtimeStatus?.runtimeRoot || runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'rpcs3')).trim();
  const firmwareDir = path.join(runtimeRoot, 'firmware');
  const firmwarePath = path.join(firmwareDir, 'PS3UPDAT.PUP');

  ensureDir(firmwareDir);

  emitProgress({ stage: 'downloading', percent: 5, message: 'Downloading PS3 firmware package…' });
  const result = await downloadFileToPath(RPCS3_FIRMWARE_URL, firmwarePath, {
    timeoutMs: 120000,
    onProgress: ({ percent, received, total }) => {
      const scaled = percent == null
        ? Math.max(5, Math.min(95, 5 + Math.round((Number(received || 0) / (1024 * 1024)) * 2.2)))
        : Math.max(5, Math.min(95, 5 + Math.round(percent * 0.9)));
      emitProgress({
        stage: 'downloading',
        percent: scaled,
        received,
        total,
        message: total > 0
          ? `Downloading PS3 firmware… ${Math.round((received / total) * 100)}%`
          : 'Downloading PS3 firmware…',
      });
    },
  });
  if (!result?.ok) return result;

  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      rpcs3: {
        ...((settings.emulators || {}).rpcs3 || {}),
        firmwarePackagePath: firmwarePath,
      },
    },
  });
  saveSettings(next);

    emitProgress({ stage: 'firmware-ready', percent: 92, message: 'PS3 firmware package is ready. Installing into RPCS3…' });
  return {
    ok: true,
    firmwarePath,
    sourceUrl: RPCS3_FIRMWARE_URL,
    status: emulatorManager.getRPCS3RuntimeStatus(loadSettings()),
    };
  }

  async function installManagedRPCS3Firmware(onProgress = null) {
    const emitProgress = (payload = {}) => {
      if (typeof onProgress !== 'function') return;
      try { onProgress(payload); } catch {}
    };
    const runtimeStatus = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
    if (!runtimeStatus?.ok || !runtimeStatus?.executablePath || !fs.existsSync(runtimeStatus.executablePath)) {
      return { ok: false, error: 'RPCS3 must be installed before SKALD can install PS3 firmware.' };
    }
    if (runtimeStatus?.firmwareInstalled) {
      emitProgress({ stage: 'complete', percent: 100, message: `PS3 firmware ${runtimeStatus.firmwareVersion || ''} is already installed.`.trim() });
      return { ok: true, alreadyInstalled: true, status: runtimeStatus };
    }

    const firmwarePath = getStoredRPCS3FirmwarePath();
    if (!firmwarePath || !fs.existsSync(firmwarePath)) {
      return { ok: false, error: 'SKALD does not have a PS3UPDAT.PUP firmware package ready yet.' };
    }

    if (!runtimeStatus?.firmwareInstalled && runtimeStatus?.firmwareVersionFile && fs.existsSync(runtimeStatus.firmwareVersionFile)) {
      const runtimeRoot = String(runtimeStatus.runtimeRoot || '').trim();
      const isManagedRoot = runtimeRoot && path.resolve(runtimeRoot).toLowerCase() === path.resolve(runtimeStatus.managedRuntimeDir || '').toLowerCase();
      if (isManagedRoot) {
        for (const dirName of ['dev_flash', 'dev_flash2', 'dev_flash3']) {
          const targetDir = path.join(runtimeRoot, dirName);
          try {
            if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
          } catch (error) {
            logRPCS3PkgAutomation(`firmware-install-cleanup-error path=${targetDir} error=${error?.message || error}`);
          }
        }
        logRPCS3PkgAutomation(`firmware-install-cleaned-partial missing=${(runtimeStatus.firmwareMissingFiles || []).join('|') || '<unknown>'}`);
      }
    }

    syncRPCS3WelcomeConfigState({ markCompleted: true });
    emitProgress({ stage: 'installing', percent: 8, message: 'Installing PS3 firmware into RPCS3…' });
    logRPCS3PkgAutomation(`firmware-install-start firmware=${firmwarePath}`);

    const child = spawn(runtimeStatus.executablePath, ['--installfw', firmwarePath], {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(runtimeStatus.executablePath),
    });

    let settled = false;
    child.once('exit', (code) => {
      settled = true;
      logRPCS3PkgAutomation(`firmware-install-process-exit pid=${child.pid || 0} code=${code}`);
    });
    child.once('error', (error) => {
      settled = true;
      logRPCS3PkgAutomation(`firmware-install-process-error pid=${child.pid || 0} error=${error?.message || error}`);
    });

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const startedAt = Date.now();
    const maxDurationMs = 240000;
    let clicked = false;
    let lastState = '';
    let lastProgress = 8;
    let confirmAttempts = 0;
    let lastConfirmDispatchAt = 0;
    let firmwareVerifiedAt = 0;
    let closeAfterVerifyRequested = false;
    let installLogSize = -1;
    let installLogStableSince = 0;

    while ((Date.now() - startedAt) < maxDurationMs) {
      const status = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
      if (status?.firmwareInstalled) {
        if (!firmwareVerifiedAt) {
          firmwareVerifiedAt = Date.now();
          lastProgress = Math.max(lastProgress, 96);
          emitProgress({ stage: 'compiling', percent: lastProgress, message: 'RPCS3 is compiling PS3 firmware PPU modules…' });
          logRPCS3PkgAutomation(`firmware-install-verified version=${status.firmwareVersion || '<unknown>'}`);
        }

        const compileElapsed = Date.now() - firmwareVerifiedAt;
        const installLogPath = status?.runtimeRoot ? path.join(status.runtimeRoot, 'log', 'RPCS3.log') : '';
        if (installLogPath && fs.existsSync(installLogPath)) {
          try {
            const currentLogSize = fs.statSync(installLogPath).size;
            if (currentLogSize !== installLogSize) {
              installLogSize = currentLogSize;
              installLogStableSince = Date.now();
            } else if (!installLogStableSince) {
              installLogStableSince = Date.now();
            }
          } catch {}
        }
        const logQuietMs = installLogStableSince ? Date.now() - installLogStableSince : 0;
        const shouldCloseAfterCompile = compileElapsed >= 5000 && logQuietMs >= 5000;
        const compileMaxWaitReached = compileElapsed >= 120000;
        if (!settled && child?.pid && !closeAfterVerifyRequested && (shouldCloseAfterCompile || compileMaxWaitReached)) {
          closeAfterVerifyRequested = true;
          try {
            if (!child.killed) child.kill();
            logRPCS3PkgAutomation(`firmware-install-close-after-verify pid=${child.pid || 0} elapsed=${Math.round(compileElapsed / 1000)}s logQuiet=${Math.round(logQuietMs / 1000)}s maxWait=${compileMaxWaitReached}`);
          } catch (error) {
            logRPCS3PkgAutomation(`firmware-install-close-after-verify-error pid=${child.pid || 0} error=${error?.message || error}`);
          }
        }

        if (settled || !child?.pid || closeAfterVerifyRequested) {
          emitProgress({ stage: 'complete', percent: 100, message: `PS3 firmware ${status.firmwareVersion || ''} installed.`.trim() });
          logRPCS3PkgAutomation(`firmware-install-complete version=${status.firmwareVersion || '<unknown>'}`);
          return { ok: true, status };
        }

        lastProgress = Math.max(lastProgress, Math.min(99, 96 + Math.floor(compileElapsed / 30000)));
        emitProgress({ stage: 'compiling', percent: lastProgress, message: 'RPCS3 is compiling PS3 firmware PPU modules…' });
        await sleep(1000);
        continue;
      }

      if (!clicked && child?.pid) {
        confirmAttempts += 1;
        if (confirmAttempts === 1) {
          logRPCS3PkgAutomation(`firmware-install-confirm-attempt pid=${child.pid}`);
        }
          logRPCS3PkgAutomation(`firmware-install-confirm-dispatch-enter pid=${child.pid}`);
          const click = dispatchRPCS3FirmwareConfirmWithNativeHelper(child.pid, {
            timeoutMs: 20000,
            logPrefix: 'firmware-install-confirm',
          });
          lastConfirmDispatchAt = Date.now();
          if (click?.ok) {
            logRPCS3PkgAutomation(`firmware-install-confirm-helper-spawned pid=${child.pid} helperPid=${Number(click?.pid || 0)} helper=${click.helperPath || '<none>'}`);
          } else {
            logRPCS3PkgAutomation(`firmware-install-confirm-dispatch-error pid=${child.pid} state=${click?.state || '<none>'} error=${String(click?.error || '').trim() || '<none>'}`);
          }
          lastState = String(click?.state || '').trim() || lastState;
        if (click?.ok) {
          clicked = true;
          lastProgress = 22;
          emitProgress({ stage: 'installing', percent: lastProgress, message: 'RPCS3 firmware install confirmed…' });
          logRPCS3PkgAutomation(`firmware-install-confirmed pid=${child.pid} state=${lastState || '<none>'} helperPid=${Number(click?.pid || 0)}`);
        } else if (confirmAttempts === 1 || confirmAttempts % 20 === 0) {
          logRPCS3PkgAutomation(`firmware-install-waiting pid=${child.pid || 0} state=${lastState || '<none>'}`);
        }
      } else if (clicked) {
        const elapsed = Date.now() - startedAt;
        lastProgress = Math.max(lastProgress, Math.min(96, 22 + Math.round((elapsed / maxDurationMs) * 74)));
        emitProgress({ stage: 'installing', percent: lastProgress, message: 'RPCS3 is unpacking and installing PS3 firmware…' });
        if (child?.pid && (Date.now() - lastConfirmDispatchAt) >= 5000) {
          confirmAttempts += 1;
          const retry = dispatchRPCS3FirmwareConfirmWithNativeHelper(child.pid, {
            timeoutMs: 12000,
            logPrefix: 'firmware-install-confirm-retry',
          });
          lastConfirmDispatchAt = Date.now();
          lastState = String(retry?.state || '').trim() || lastState;
          logRPCS3PkgAutomation(`firmware-install-confirm-retry pid=${child.pid || 0} attempt=${confirmAttempts} ok=${!!retry?.ok} state=${String(retry?.state || '').trim() || '<none>'} helperPid=${Number(retry?.pid || 0)} error=${String(retry?.error || '').trim() || '<none>'}`);
        }
        if (confirmAttempts > 0 && confirmAttempts % 15 === 0) {
          logRPCS3PkgAutomation(`firmware-install-verifying pid=${child.pid || 0} elapsed=${Math.round(elapsed / 1000)}s`);
        }
      }

      if (settled && !child?.pid) break;
      await sleep(clicked ? 1000 : 250);
    }

    try {
      if (child?.pid && !child.killed) child.kill();
    } catch {}
    emitProgress({ stage: 'failed', percent: lastProgress, message: 'RPCS3 firmware install did not complete.' });
    return {
      ok: false,
      state: lastState || 'timeout',
      error: clicked
        ? 'RPCS3 started the firmware install, but SKALD could not verify that firmware finished installing.'
        : 'SKALD could not confirm the RPCS3 firmware install prompt.',
      status: emulatorManager.getRPCS3RuntimeStatus(loadSettings()),
    };
  }

  async function uninstallManagedRPCS3Runtime() {
  const runtimeStatus = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
  const managedRuntimeDir = String(runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'rpcs3')).trim();
  const downloadsRoot = path.join(USER_DATA, 'emulators', 'downloads');
  const cleanupPaths = [
    managedRuntimeDir,
    path.join(downloadsRoot, 'rpcs3-stable'),
    path.join(downloadsRoot, 'rpcs3-win.7z'),
  ];

  for (const targetPath of cleanupPaths) {
    if (!targetPath || !fs.existsSync(targetPath)) continue;
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) await fs.promises.rm(targetPath, { recursive: true, force: true });
      else await fs.promises.rm(targetPath, { force: true });
    } catch (error) {
      return { ok: false, error: error?.message || `Could not remove ${targetPath}` };
    }
  }

  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      rpcs3: {
        ...((settings.emulators || {}).rpcs3 || {}),
        mode: 'bundled',
        firmwarePackagePath: '',
        welcomeCompleted: false,
      },
    },
  });
  saveSettings(next);

  try { if (fs.existsSync(RPCS3_INSTALL_MAP_PATH)) await fs.promises.rm(RPCS3_INSTALL_MAP_PATH, { force: true }); } catch {}
  try { if (fs.existsSync(RPCS3_PKG_AUTOMATION_LOG_PATH)) await fs.promises.rm(RPCS3_PKG_AUTOMATION_LOG_PATH, { force: true }); } catch {}
  rpcs3CompatibilityDbCache = null;

  return {
    ok: true,
    removedPath: managedRuntimeDir,
    status: emulatorManager.getRPCS3RuntimeStatus(loadSettings()),
  };
}

function getRPCS3SetupStatus(settings = loadSettings()) {
  const normalized = emulatorManager.normalizeSettings(settings);
  const runtime = emulatorManager.getRPCS3RuntimeStatus(normalized);
  const welcomeCompleted = normalized?.emulators?.rpcs3?.welcomeCompleted === true;
  let state = 'runtime_missing';
  if (runtime?.ok) {
    if (!welcomeCompleted) state = 'welcome_pending';
    else if (!runtime?.firmwareInstalled) state = 'firmware_missing';
    else state = 'ready';
  }
  return {
    ok: true,
    state,
    welcomeCompleted,
    runtime,
  };
}

function upsertIniKey(content, sectionName, key, value) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const sectionHeader = `[${sectionName}]`;
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (String(lines[i] || '').trim() === sectionHeader) {
      sectionStart = i;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s*\[.+\]\s*$/.test(lines[j] || '')) {
          sectionEnd = j;
          break;
        }
      }
      break;
    }
  }
  if (sectionStart === -1) {
    if (lines.length && String(lines[lines.length - 1] || '').trim() !== '') lines.push('');
    lines.push(sectionHeader);
    lines.push(`${key}=${value}`);
    return `${lines.join('\n').replace(/\n+$/,'')}\n`;
  }
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    const line = String(lines[i] || '');
    if (line.trim().startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      return `${lines.join('\n').replace(/\n+$/,'')}\n`;
    }
  }
  lines.splice(sectionEnd, 0, `${key}=${value}`);
  return `${lines.join('\n').replace(/\n+$/,'')}\n`;
}

function syncRPCS3WelcomeConfigState({ markCompleted = false } = {}) {
  const settings = loadSettings();
  const runtime = emulatorManager.getRPCS3RuntimeStatus(settings);
  const runtimeRoot = String(runtime?.runtimeRoot || runtime?.managedRuntimeDir || '').trim();
  if (!runtimeRoot || !fs.existsSync(runtimeRoot)) {
    return { ok: false, error: 'RPCS3 runtime is not available yet.' };
  }
  const guiConfigsDir = path.join(runtimeRoot, 'GuiConfigs');
  const currentSettingsPath = path.join(guiConfigsDir, 'CurrentSettings.ini');
  try {
    ensureDir(guiConfigsDir);
    let iniContent = '';
    try {
      if (fs.existsSync(currentSettingsPath)) iniContent = String(fs.readFileSync(currentSettingsPath, 'utf8') || '');
    } catch {}
      iniContent = upsertIniKey(iniContent, 'main_window', 'infoBoxEnabledWelcome', 'false');
      iniContent = upsertIniKey(iniContent, 'main_window', 'infoBoxEnabledInstallPUP', 'false');
      iniContent = upsertIniKey(iniContent, 'main_window', 'infoBoxEnabledInstallPKG', 'false');
    fs.writeFileSync(currentSettingsPath, iniContent, 'utf8');
    if (markCompleted) {
      const next = emulatorManager.normalizeSettings({
        ...settings,
        emulators: {
          ...(settings.emulators || {}),
          rpcs3: {
            ...((settings.emulators || {}).rpcs3 || {}),
            welcomeCompleted: true,
          },
        },
      });
      saveSettings(next);
      return {
        ok: true,
        currentSettingsPath,
        status: getRPCS3SetupStatus(next),
      };
    }
    return {
      ok: true,
      currentSettingsPath,
      status: getRPCS3SetupStatus(loadSettings()),
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not update RPCS3 welcome config.' };
  }
}

async function downloadManagedVLCRuntime(onProgress = null) {
  const emitProgress = (payload = {}) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(payload); } catch {}
  };
  const runtimeStatus = emulatorManager.getVLCRuntimeStatus(loadSettings());
  const managedRuntimeDir = runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'vlc');
  const stagingRoot = path.join(USER_DATA, 'emulators', 'downloads');
  const extractRoot = path.join(stagingRoot, 'vlc-stable');

  emitProgress({ stage: 'resolving', percent: 5, message: 'Checking the official VLC Windows download…' });
  const release = await resolveVLCStableWindowsDownload();
  if (!release?.ok) return release;

  const archivePath = path.join(stagingRoot, release.archiveFileName || 'vlc-stable.zip');
  if (fs.existsSync(extractRoot)) {
    try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}
  }
  ensureDir(stagingRoot);

  emitProgress({ stage: 'downloading', percent: 8, message: `Downloading VLC ${release.version}…` });
  const downloadResult = await downloadFileToPath(release.archiveUrl, archivePath, {
    headers: { Referer: release.sourcePage },
    timeoutMs: 120000,
    onProgress: ({ percent, received, total }) => {
      const scaled = percent == null
        ? Math.max(10, Math.min(55, 10 + Math.round((Number(received || 0) / (1024 * 1024)) * 2.3)))
        : Math.max(8, Math.min(55, 8 + Math.round(percent * 0.47)));
      emitProgress({
        stage: 'downloading',
        percent: scaled,
        received,
        total,
        message: total > 0
          ? `Downloading VLC ${release.version}… ${Math.round((received / total) * 100)}%`
          : `Downloading VLC ${release.version}…`,
      });
    },
  });
  if (!downloadResult?.ok) return downloadResult;

  emitProgress({ stage: 'extracting', percent: 58, message: 'Extracting the VLC package…' });
  try {
    await extractZip(archivePath, { dir: extractRoot });
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not extract the VLC archive.' };
  }

  const extractedExe = findFileRecursive(extractRoot, 'vlc.exe');
  if (!extractedExe) {
    return { ok: false, error: 'VLC downloaded, but SKALD could not find vlc.exe in the extracted package.' };
  }

  emitProgress({ stage: 'importing', percent: 68, message: 'Importing VLC into the SKALD managed runtime…' });
  const importResult = emulatorManager.importVLCRuntime(extractedExe);
  if (!importResult?.ok) return importResult;

  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      vlc: {
        ...((settings.emulators || {}).vlc || {}),
        mode: 'bundled',
        customExecutablePath: String(settings?.emulators?.vlc?.customExecutablePath || '').trim(),
      },
    },
  });
  saveSettings(next);

  try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
  try { if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}

  emitProgress({ stage: 'complete', percent: 100, message: `VLC ${release.version} is ready in SKALD.` });
  return {
    ok: true,
    version: release.version,
    archiveUrl: release.archiveUrl,
    managedRuntimeDir,
    executablePath: importResult.executablePath,
    status: emulatorManager.getVLCRuntimeStatus(loadSettings()),
  };
}

async function importManagedXeniaRuntime(sourceExecutablePath) {
  const sourcePath = String(sourceExecutablePath || '').trim();
  if (!sourcePath) return { ok: false, error: 'No Xenia Canary executable was selected.' };
  if (process.platform !== 'win32') {
    return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
  }
  if (!fs.existsSync(sourcePath)) {
    return { ok: false, error: `Xenia Canary executable not found: ${sourcePath}` };
  }
  if (!['xenia_canary.exe', 'xenia.exe'].includes(path.basename(sourcePath).toLowerCase())) {
    return { ok: false, error: 'Pick the Xenia Canary executable itself so SKALD can import the full runtime folder.' };
  }
  const runtimeStatus = emulatorManager.getXeniaRuntimeStatus(loadSettings());
  const managedRuntimeDir = runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'xenia');
  if (!managedRuntimeDir) {
    return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
  }

  const sourceDir = path.dirname(sourcePath);
  const targetParent = path.dirname(managedRuntimeDir);
  const backupDir = `${managedRuntimeDir}-backup`;
  try {
    ensureDir(targetParent);
    if (fs.existsSync(backupDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    }
    if (fs.existsSync(managedRuntimeDir)) {
      await fs.promises.rename(managedRuntimeDir, backupDir);
    }
    try {
      await fs.promises.cp(sourceDir, managedRuntimeDir, { recursive: true, force: true });
    } catch (copyError) {
      if (fs.existsSync(managedRuntimeDir)) {
        await fs.promises.rm(managedRuntimeDir, { recursive: true, force: true }).catch(() => {});
      }
      if (fs.existsSync(backupDir)) {
        await fs.promises.rename(backupDir, managedRuntimeDir).catch(() => {});
      }
      throw copyError;
    }
    if (fs.existsSync(backupDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    }
    const runtimeExe = emulatorManager.getXeniaManagedExecutablePath?.() || path.join(managedRuntimeDir, 'xenia_canary.exe');
    if (!runtimeExe || !fs.existsSync(runtimeExe)) {
      return { ok: false, error: 'Xenia Canary import finished, but SKALD could not find the emulator executable in the managed runtime.' };
    }
    return {
      ok: true,
      runtimeDir: managedRuntimeDir,
      executablePath: runtimeExe,
      status: emulatorManager.getXeniaRuntimeStatus(loadSettings()),
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not import the Xenia Canary runtime into SKALD.' };
  }
}

function flushUiProgressFrame(delayMs = 0) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function downloadFileWithCurl(url, destFile, { referer = '', userAgent = 'SKALD-Launcher/0.1', expectedSize = 0, onProgress = null } = {}) {
  return new Promise((resolve) => {
    if (!fs.existsSync(path.dirname(destFile))) fs.mkdirSync(path.dirname(destFile), { recursive: true });
    try { if (fs.existsSync(destFile)) fs.unlinkSync(destFile); } catch {}
    const args = ['-L', '--fail', '--silent', '--show-error', '-A', userAgent];
    if (referer) args.push('-e', referer);
    args.push('-o', destFile, url);
    const child = spawn('curl.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    const poller = setInterval(() => {
      try {
        const received = fs.existsSync(destFile) ? fs.statSync(destFile).size : 0;
        const total = Number(expectedSize || 0) || 0;
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : null;
        if (typeof onProgress === 'function') onProgress({ received, total, percent, url });
      } catch {}
    }, 200);
    child.stderr?.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.once('error', (error) => {
      clearInterval(poller);
      resolve({ ok: false, error: error?.message || 'Could not start curl.exe for download.', url });
    });
    child.once('exit', (code) => {
      clearInterval(poller);
      try {
        const received = fs.existsSync(destFile) ? fs.statSync(destFile).size : 0;
        const total = Number(expectedSize || 0) || 0;
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : null;
        if (typeof onProgress === 'function') onProgress({ received, total, percent, url });
      } catch {}
      if (code === 0 && fs.existsSync(destFile)) {
        resolve({ ok: true, filePath: destFile, url });
        return;
      }
      try { if (fs.existsSync(destFile)) fs.unlinkSync(destFile); } catch {}
      resolve({ ok: false, error: stderr.trim() || `curl exited with code ${code}`, url });
    });
  });
}

function cleanupDownloadedArchive(filePath) {
  const archivePath = String(filePath || '').trim();
  if (!archivePath) return;
  try {
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  } catch {}
  try {
    const downloadParentDir = path.dirname(archivePath);
    if (downloadParentDir && fs.existsSync(downloadParentDir) && !fs.readdirSync(downloadParentDir).length) {
      fs.rmdirSync(downloadParentDir);
    }
  } catch {}
}

function extractArchiveWithSevenZip(filePath, destDir, sevenZ, onProgress = null) {
  return new Promise((resolve) => {
    const child = spawn(sevenZ, ['x', filePath, `-o${destDir}`, '-y', '-bsp1'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let lastPercent = -1;
    const pushProgress = (chunk) => {
      const text = String(chunk || '');
      const match = text.match(/(\d{1,3})%/);
      if (!match) return;
      const percent = Math.max(0, Math.min(100, Number(match[1] || 0)));
      if (percent === lastPercent) return;
      lastPercent = percent;
      if (typeof onProgress === 'function') {
        try { onProgress({ percent, stage: 'extracting' }); } catch {}
      }
    };
    child.stdout?.on('data', pushProgress);
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
      pushProgress(chunk);
    });
    child.once('error', (error) => {
      resolve({ ok: false, error: error?.message || 'Could not start 7-Zip extraction.' });
    });
    child.once('exit', (code) => {
      if (typeof onProgress === 'function') {
        try { onProgress({ percent: 100, stage: 'extracting' }); } catch {}
      }
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({ ok: false, error: stderr.trim() || `7-Zip extraction failed with exit code ${code}` });
    });
  });
}

async function downloadManagedXeniaRuntime(onProgress = null) {
  appendXeniaProgressLog('entered downloadManagedXeniaRuntime body');
  const emitProgress = (payload = {}) => {
    appendXeniaProgressLog(`emit stage=${String(payload?.stage || '')} percent=${Number(payload?.percent || 0)} message=${JSON.stringify(String(payload?.message || ''))}`);
    if (typeof onProgress !== 'function') return;
    try { onProgress(payload); } catch {}
  };
  try { fs.writeFileSync(XENIA_PROGRESS_LOG_PATH, '', 'utf8'); } catch {}
  appendXeniaProgressLog('begin downloadManagedXeniaRuntime');
  appendXeniaProgressLog('before loadSettings');
  const currentSettings = loadSettings();
  appendXeniaProgressLog('after loadSettings');
  appendXeniaProgressLog('before getXeniaRuntimeStatus');
  const runtimeStatus = emulatorManager.getXeniaRuntimeStatus(currentSettings);
  appendXeniaProgressLog(`after getXeniaRuntimeStatus ok=${!!runtimeStatus?.ok} managedRuntimeDir=${JSON.stringify(String(runtimeStatus?.managedRuntimeDir || ''))}`);
  const managedRuntimeDir = runtimeStatus?.managedRuntimeDir || path.join(USER_DATA, 'emulators', 'xenia');
  const stagingRoot = path.join(USER_DATA, 'emulators', 'downloads');
  const extractRoot = path.join(stagingRoot, 'xenia-canary');

  appendXeniaProgressLog('before emit resolving');
  emitProgress({ stage: 'resolving', percent: 5, message: 'Checking the official Xenia Canary Windows release…' });
  appendXeniaProgressLog('after emit resolving');
  appendXeniaProgressLog('before resolveXeniaStableWindowsDownload');
  const release = await resolveXeniaStableWindowsDownload();
  appendXeniaProgressLog('after resolveXeniaStableWindowsDownload');
  appendXeniaProgressLog(`release ok=${!!release?.ok} version=${JSON.stringify(String(release?.version || ''))} url=${JSON.stringify(String(release?.archiveUrl || ''))}`);
  if (!release?.ok) return release;

  const archivePath = path.join(stagingRoot, release.archiveFileName || 'xenia_canary_windows.zip');
  if (fs.existsSync(extractRoot)) {
    try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}
  }
  ensureDir(stagingRoot);

  emitProgress({ stage: 'downloading', percent: 8, message: `Downloading Xenia Canary ${release.version}…` });
  const downloadResult = await downloadFileWithCurl(release.archiveUrl, archivePath, {
    referer: release.sourcePage,
    userAgent: 'SKALD Launcher',
    expectedSize: release.archiveSize || 0,
    onProgress: ({ percent, received, total }) => {
      const scaled = percent == null
        ? Math.max(10, Math.min(55, 10 + Math.round((Number(received || 0) / (1024 * 1024)) * 2.2)))
        : Math.max(8, Math.min(55, 8 + Math.round(percent * 0.47)));
      emitProgress({
        stage: 'downloading',
        percent: scaled,
        received,
        total,
        message: total > 0
          ? `Downloading Xenia Canary ${release.version}… ${Math.round((received / total) * 100)}%`
          : `Downloading Xenia Canary ${release.version}…`,
      });
    },
  });
  appendXeniaProgressLog(`downloadResult ok=${!!downloadResult?.ok} error=${JSON.stringify(String(downloadResult?.error || ''))} archivePath=${JSON.stringify(archivePath)}`);
  if (!downloadResult?.ok) return downloadResult;

  emitProgress({ stage: 'extracting', percent: 58, message: 'Extracting the Xenia Canary package…' });
  await flushUiProgressFrame(40);
  try {
    await extractZip(archivePath, { dir: extractRoot });
    appendXeniaProgressLog(`extract ok dir=${JSON.stringify(extractRoot)}`);
  } catch (error) {
    appendXeniaProgressLog(`extract error=${JSON.stringify(String(error?.message || ''))}`);
    return { ok: false, error: error?.message || 'Could not extract the Xenia Canary archive.' };
  }

  const extractedExe = findFileRecursive(extractRoot, 'xenia_canary.exe') || findFileRecursive(extractRoot, 'xenia.exe');
  appendXeniaProgressLog(`find xenia executable path=${JSON.stringify(extractedExe)}`);
  if (!extractedExe) {
    return { ok: false, error: 'Xenia Canary downloaded, but SKALD could not find the emulator executable in the extracted package.' };
  }

  emitProgress({ stage: 'importing', percent: 68, message: 'Preparing the Xenia Canary managed runtime…' });
  await flushUiProgressFrame(25);
  emitProgress({ stage: 'importing', percent: 76, message: 'Copying Xenia Canary into the SKALD managed runtime…' });
  await flushUiProgressFrame(40);
  const importResult = await importManagedXeniaRuntime(extractedExe);
  appendXeniaProgressLog(`importResult ok=${!!importResult?.ok} error=${JSON.stringify(String(importResult?.error || ''))} executablePath=${JSON.stringify(String(importResult?.executablePath || ''))}`);
  if (!importResult?.ok) return importResult;

  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      xenia: {
        ...((settings.emulators || {}).xenia || {}),
        mode: 'bundled',
        customExecutablePath: String(settings?.emulators?.xenia?.customExecutablePath || '').trim(),
      },
    },
  });
  saveSettings(next);

  try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
  try { if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true }); } catch {}

  emitProgress({ stage: 'importing', percent: 94, message: 'Finalizing the Xenia Canary runtime in SKALD…' });
  await flushUiProgressFrame(25);
  emitProgress({ stage: 'complete', percent: 100, message: `Xenia Canary ${release.version} is ready in SKALD.` });
  appendXeniaProgressLog('complete downloadManagedXeniaRuntime');
  return {
    ok: true,
    version: release.version,
    archiveUrl: release.archiveUrl,
    managedRuntimeDir,
    executablePath: importResult.executablePath,
    status: emulatorManager.getXeniaRuntimeStatus(loadSettings()),
  };
}

function getVlcHostExecutableCandidates() {
  const candidates = [];
  if (process.platform === 'win32') {
    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'tools', 'Skald.VlcHost', 'Skald.VlcHost.exe'));
      candidates.push(path.join(process.resourcesPath, 'Skald.VlcHost', 'Skald.VlcHost.exe'));
    } else {
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.VlcHost', 'bin', 'Release', 'net10.0-windows', 'win-x64', 'publish', 'Skald.VlcHost.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.VlcHost', 'bin', 'Release', 'net10.0-windows', 'publish', 'Skald.VlcHost.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.VlcHost', 'bin', 'Debug', 'net10.0-windows', 'win-x64', 'publish', 'Skald.VlcHost.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.VlcHost', 'bin', 'Debug', 'net10.0-windows', 'publish', 'Skald.VlcHost.exe'));
    }
  }
  return candidates.filter(Boolean);
}

function resolveVlcHostExecutable() {
  return getVlcHostExecutableCandidates().find(candidate => fs.existsSync(candidate)) || '';
}

function getRpcs3HelperExecutableCandidates() {
  const candidates = [];
  if (process.platform === 'win32') {
    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'tools', 'Skald.Rpcs3Helper', 'Skald.Rpcs3Helper.exe'));
      candidates.push(path.join(process.resourcesPath, 'Skald.Rpcs3Helper', 'Skald.Rpcs3Helper.exe'));
    } else {
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.Rpcs3Helper', 'bin', 'Release', 'net10.0-windows', 'win-x64', 'publish', 'Skald.Rpcs3Helper.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.Rpcs3Helper', 'bin', 'Release', 'net10.0-windows', 'win-x64', 'Skald.Rpcs3Helper.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.Rpcs3Helper', 'bin', 'Release', 'net10.0-windows', 'publish', 'Skald.Rpcs3Helper.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.Rpcs3Helper', 'bin', 'Debug', 'net10.0-windows', 'win-x64', 'publish', 'Skald.Rpcs3Helper.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.Rpcs3Helper', 'bin', 'Debug', 'net10.0-windows', 'win-x64', 'Skald.Rpcs3Helper.exe'));
      candidates.push(path.join(APP_ROOT_DIR, 'src', 'native', 'Skald.Rpcs3Helper', 'bin', 'Debug', 'net10.0-windows', 'publish', 'Skald.Rpcs3Helper.exe'));
    }
  }
  return candidates.filter(Boolean);
}

function resolveRpcs3HelperExecutable() {
  return getRpcs3HelperExecutableCandidates().find(candidate => fs.existsSync(candidate)) || '';
}

function dispatchRPCS3FirmwareConfirmWithNativeHelper(pid, { timeoutMs = 15000, logPrefix = 'firmware-install-confirm' } = {}) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 firmware installer pid is invalid.' };
  }
  const helperPath = resolveRpcs3HelperExecutable();
  if (!helperPath) {
    const candidates = getRpcs3HelperExecutableCandidates().join('; ');
    return { ok: false, state: 'helper-not-found', error: `Could not find Skald.Rpcs3Helper.exe. Checked: ${candidates}` };
  }

  try {
    const helper = spawn(helperPath, ['confirm-firmware', '--pid', String(numericPid), '--timeout-ms', String(timeoutMs)], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    helper.stdout?.on('data', chunk => {
      const text = String(chunk || '').trim();
      if (text) logRPCS3PkgAutomation(`${logPrefix}-helper-stdout pid=${numericPid} helperPid=${helper.pid || 0} output=${text}`);
    });
    helper.stderr?.on('data', chunk => {
      const text = String(chunk || '').trim();
      if (text) logRPCS3PkgAutomation(`${logPrefix}-helper-stderr pid=${numericPid} helperPid=${helper.pid || 0} output=${text}`);
    });
    helper.once('exit', code => {
      logRPCS3PkgAutomation(`${logPrefix}-helper-exit pid=${numericPid} helperPid=${helper.pid || 0} code=${code}`);
    });
    helper.once('error', error => {
      logRPCS3PkgAutomation(`${logPrefix}-helper-error pid=${numericPid} helperPid=${helper.pid || 0} error=${error?.message || error}`);
    });
    helper.unref();
    return { ok: true, state: 'native-helper-dispatched', pid: helper.pid || 0, helperPath };
  } catch (error) {
    return {
      ok: false,
      state: 'native-helper-error',
      error: error?.message || 'Could not launch the RPCS3 native helper.',
    };
  }
}

function getWindowHandleHex(win) {
  try {
    const buffer = win?.getNativeWindowHandle?.();
    if (!buffer || !Buffer.isBuffer(buffer)) return '';
    if (buffer.length >= 8) return buffer.readBigUInt64LE(0).toString(16);
    if (buffer.length >= 4) return buffer.readUInt32LE(0).toString(16);
  } catch {}
  return '';
}

function stopActiveVLCProcess() {
  if (activeVlcFocusTimer) {
    try { clearInterval(activeVlcFocusTimer); } catch {}
    activeVlcFocusTimer = null;
  }
  if (!activeVlcProcess?.pid) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(activeVlcProcess.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { activeVlcProcess.kill('SIGTERM'); } catch {}
    }
  } catch {}
  activeVlcProcess = null;
  activeVlcControlPipe = '';
  try {
    activeVlcEventServer?.close();
  } catch {}
  activeVlcEventServer = null;
  activeVlcEventPipe = '';
}

function startActiveVlcFocusAssist() {
  if (activeVlcFocusTimer) {
    try { clearInterval(activeVlcFocusTimer); } catch {}
    activeVlcFocusTimer = null;
  }
  if (!bladesWindow || bladesWindow.isDestroyed()) return;
  activeVlcFocusTimer = setInterval(() => {
    if (!activeVlcProcess?.pid || !bladesWindow || bladesWindow.isDestroyed()) {
      if (activeVlcFocusTimer) {
        try { clearInterval(activeVlcFocusTimer); } catch {}
        activeVlcFocusTimer = null;
      }
      return;
    }
    try {
      bladesWindow.focus();
      bladesWindow.moveTop();
    } catch {}
  }, 500);
}

function stopActiveVLCAudioProcess() {
  if (!activeVlcAudioProcess?.pid) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(activeVlcAudioProcess.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { activeVlcAudioProcess.kill('SIGTERM'); } catch {}
    }
  } catch {}
  activeVlcAudioProcess = null;
  activeVlcAudioControlPipe = '';
}

function makeVlcControlPipeName() {
  return `skald-vlc-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function startVlcEventPipe(pipeName) {
  try {
    activeVlcEventServer?.close();
  } catch {}
  activeVlcEventServer = null;
  activeVlcEventPipe = pipeName;
  const server = net.createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => {
      try {
        const payload = JSON.parse(data || '{}');
        const action = String(payload?.action || '').trim().toLowerCase();
        if (action) {
          BrowserWindow.getAllWindows().forEach((win) => {
            try { win.webContents.send('vlc-media-action', { action }); } catch {}
          });
        }
      } catch {}
    });
  });
  server.on('error', () => {});
  server.listen(`\\\\.\\pipe\\${pipeName}`);
  activeVlcEventServer = server;
}

function sendVlcControl(payload = {}) {
  return new Promise((resolve) => {
    const pipeName = String(activeVlcControlPipe || '').trim();
    if (!pipeName) return resolve({ ok: false, error: 'No active VLC control pipe.' });
    const socket = net.createConnection({ path: `\\\\.\\pipe\\${pipeName}` }, () => {
      try {
        socket.end(JSON.stringify(payload));
      } catch (error) {
        try { socket.destroy(); } catch {}
        resolve({ ok: false, error: error?.message || 'Could not send VLC control payload.' });
      }
    });
    socket.setTimeout(2000, () => {
      try { socket.destroy(); } catch {}
      resolve({ ok: false, error: 'Timed out talking to VLC.' });
    });
    socket.once('error', (error) => {
      try { socket.destroy(); } catch {}
      resolve({ ok: false, error: error?.message || 'Could not connect to VLC control pipe.' });
    });
    socket.once('close', () => resolve({ ok: true }));
  });
}

function sendVlcAudioControl(payload = {}) {
  return new Promise((resolve) => {
    const pipeName = String(activeVlcAudioControlPipe || '').trim();
    if (!pipeName) return resolve({ ok: false, error: 'No active VLC audio control pipe.' });
    const socket = net.createConnection({ path: `\\\\.\\pipe\\${pipeName}` }, () => {
      try {
        socket.end(JSON.stringify(payload));
      } catch (error) {
        try { socket.destroy(); } catch {}
        resolve({ ok: false, error: error?.message || 'Could not send VLC audio payload.' });
      }
    });
    socket.setTimeout(2000, () => {
      try { socket.destroy(); } catch {}
      resolve({ ok: false, error: 'Timed out talking to VLC audio.' });
    });
    socket.once('error', (error) => {
      try { socket.destroy(); } catch {}
      resolve({ ok: false, error: error?.message || 'Could not connect to VLC audio pipe.' });
    });
    socket.once('close', () => resolve({ ok: true }));
  });
}

async function launchManagedVLCMedia({ url, title = '' } = {}) {
  const mediaUrl = String(url || '').trim();
  if (!mediaUrl) return { ok: false, error: 'Missing media URL.' };
  const runtime = emulatorManager.getVLCRuntimeStatus(loadSettings());
  if (!runtime?.ok || !runtime.executablePath) {
    return { ok: false, error: 'VLC runtime is not available. Download it into SKALD or set a custom override first.' };
  }
  if (!fs.existsSync(runtime.executablePath)) {
    return { ok: false, error: `VLC executable not found: ${runtime.executablePath}` };
  }

  stopActiveVLCProcess();
  try {
    const hostExe = resolveVlcHostExecutable();
    const command = hostExe || runtime.executablePath;
    const controlPipe = hostExe ? makeVlcControlPipeName() : '';
    const eventPipe = hostExe ? makeVlcControlPipeName() : '';
    if (eventPipe) startVlcEventPipe(eventPipe);
    const args = hostExe
      ? [
          '--url', mediaUrl,
          '--title', String(title || 'SKALD Video Player').trim() || 'SKALD Video Player',
          ...(activeVlcBounds ? [
            '--x', String(activeVlcBounds.x),
            '--y', String(activeVlcBounds.y),
            '--width', String(activeVlcBounds.width),
            '--height', String(activeVlcBounds.height),
            '--borderless',
            '--topmost',
          ] : ['--topmost']),
          ...(controlPipe ? ['--control-pipe', controlPipe] : []),
          ...(eventPipe ? ['--event-pipe', eventPipe] : []),
        ]
      : ['--no-video-title-show', '--play-and-exit', mediaUrl];
    const child = spawn(command, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(command),
    });
    activeVlcProcess = child;
    activeVlcControlPipe = controlPipe;
    child.once('exit', () => {
      if (activeVlcProcess === child) {
        if (activeVlcFocusTimer) {
          try { clearInterval(activeVlcFocusTimer); } catch {}
          activeVlcFocusTimer = null;
        }
        activeVlcProcess = null;
        activeVlcControlPipe = '';
        try { activeVlcEventServer?.close(); } catch {}
        activeVlcEventServer = null;
        activeVlcEventPipe = '';
      }
    });
    child.once('error', () => {
      if (activeVlcProcess === child) {
        if (activeVlcFocusTimer) {
          try { clearInterval(activeVlcFocusTimer); } catch {}
          activeVlcFocusTimer = null;
        }
        activeVlcProcess = null;
        activeVlcControlPipe = '';
        try { activeVlcEventServer?.close(); } catch {}
        activeVlcEventServer = null;
        activeVlcEventPipe = '';
      }
    });
    child.unref();
    if (bladesWindow && !bladesWindow.isDestroyed()) {
      setTimeout(() => {
        try {
          bladesWindow.focus();
          bladesWindow.moveTop();
        } catch {}
      }, 150);
      startActiveVlcFocusAssist();
    }
    return {
      ok: true,
      hostExecutablePath: hostExe,
      executablePath: runtime.executablePath,
      title: String(title || '').trim(),
      url: mediaUrl,
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not launch VLC.' };
  }
}

async function launchManagedVLCAudio({ url, title = '' } = {}) {
  const mediaUrl = String(url || '').trim();
  if (!mediaUrl) return { ok: false, error: 'Missing media URL.' };
  const runtime = emulatorManager.getVLCRuntimeStatus(loadSettings());
  if (!runtime?.ok || !runtime.executablePath) {
    return { ok: false, error: 'VLC runtime is not available. Download it into SKALD or set a custom override first.' };
  }
  stopActiveVLCAudioProcess();
  try {
    const hostExe = resolveVlcHostExecutable();
    if (!hostExe) {
      return { ok: false, error: 'The native SKALD VLC host is not available for audio playback yet.' };
    }
    const controlPipe = makeVlcControlPipeName();
    const args = [
      '--url', mediaUrl,
      '--title', String(title || 'SKALD Audio Player').trim() || 'SKALD Audio Player',
      '--audio-only',
      '--control-pipe', controlPipe,
    ];
    const child = spawn(hostExe, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      cwd: path.dirname(hostExe),
    });
    activeVlcAudioProcess = child;
    activeVlcAudioControlPipe = controlPipe;
    child.once('exit', () => {
      if (activeVlcAudioProcess === child) {
        activeVlcAudioProcess = null;
        activeVlcAudioControlPipe = '';
      }
    });
    child.once('error', () => {
      if (activeVlcAudioProcess === child) {
        activeVlcAudioProcess = null;
        activeVlcAudioControlPipe = '';
      }
    });
    child.unref();
    return { ok: true, hostExecutablePath: hostExe, executablePath: runtime.executablePath, title: String(title || '').trim(), url: mediaUrl };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not launch VLC audio.' };
  }
}

async function controlActiveVLCAudio({ command, url, title } = {}) {
  const action = String(command || '').trim().toLowerCase();
  if (!action) return { ok: false, error: 'Missing VLC audio command.' };
  if (!activeVlcAudioProcess?.pid || !activeVlcAudioControlPipe) {
    return { ok: false, error: 'No active VLC audio session.' };
  }
  const allowed = new Set(['playpause', 'play', 'pause', 'stop', 'close', 'load']);
  if (!allowed.has(action)) return { ok: false, error: 'Unsupported VLC audio command.' };
  const payload = { command: action };
  if (action === 'load') {
    payload.url = String(url || '').trim();
    payload.title = String(title || '').trim();
    if (!payload.url) return { ok: false, error: 'Missing audio URL.' };
  }
  return sendVlcAudioControl(payload);
}

function updateVlcMediaBounds({ x, y, width, height, scaleFactor } = {}) {
  const nx = Number(x);
  const ny = Number(y);
  const nw = Number(width);
  const nh = Number(height);
  const ns = Number(scaleFactor);
  if (![nx, ny, nw, nh].every(Number.isFinite)) {
    activeVlcBounds = null;
    return { ok: false, error: 'Invalid VLC bounds.' };
  }
  const pixelScale = Number.isFinite(ns) && ns > 0 ? ns : 1;
  const hostWindow = bladesWindow && !bladesWindow.isDestroyed()
    ? bladesWindow
    : (BrowserWindow.getFocusedWindow() || null);
  const contentBounds = hostWindow?.getContentBounds?.() || hostWindow?.getBounds?.() || { x: 0, y: 0 };
  activeVlcBounds = {
    x: Math.round(contentBounds.x + (nx * pixelScale)),
    y: Math.round(contentBounds.y + (ny * pixelScale)),
    width: Math.max(320, Math.round(nw * pixelScale)),
    height: Math.max(180, Math.round(nh * pixelScale)),
  };
  if (activeVlcProcess?.pid && activeVlcControlPipe) {
    void sendVlcControl({ command: 'bounds', ...activeVlcBounds });
  }
  return { ok: true, bounds: activeVlcBounds };
}

async function controlActiveVLCMedia({ command } = {}) {
  const action = String(command || '').trim().toLowerCase();
  if (!action) return { ok: false, error: 'Missing VLC command.' };
  if (!activeVlcProcess?.pid || !activeVlcControlPipe) {
    return { ok: false, error: 'No active VLC session.' };
  }
  const allowed = new Set(['playpause', 'play', 'pause', 'stop', 'close', 'rewind', 'fastforward']);
  if (!allowed.has(action)) return { ok: false, error: 'Unsupported VLC command.' };
  return sendVlcControl({ command: action });
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
  if (archiveUrlRequiresAuth(downloadUrl)) {
    await restoreArchiveSession().catch(() => {});
  }
  const cookieHeader = archiveUrlRequiresAuth(downloadUrl) ? await buildArchiveCookieHeader() : '';
  const status = archiveUrlRequiresAuth(downloadUrl) ? await getArchiveStatus() : { loggedIn: false };
  const redirects = [];
  const referer = archiveDownloadReferer(downloadUrl);

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
          ...archiveDownloadHeaders(cookieHeader, referer),
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
        resolve({ ok: false, error: `Connection timed out\n${downloadUrl}`, loggedIn: !!status?.loggedIn, hasCookieHeader: !!cookieHeader, redirects });
      });
      req.on('error', err => {
        resolve({ ok: false, error: `${err.message}\n${downloadUrl}`, loggedIn: !!status?.loggedIn, hasCookieHeader: !!cookieHeader, redirects });
      });
      req.end();
    };

    doRequest(downloadUrl, 0);
  });
}

async function downloadArchiveViaBrowserWindow(event, { identifier, downloadUrl, destFile, progressStage = '' }) {
  const ses = getSession();
  return new Promise((resolve) => {
    let finished = false;
    let sawDownload = false;
    let itemRef = null;
    let win = null;
    let startTimeout = null;
    let inactivityTimeout = null;

    const resetInactivityTimeout = (url = downloadUrl) => {
      try { if (inactivityTimeout) clearTimeout(inactivityTimeout); } catch {}
      inactivityTimeout = setTimeout(() => {
        if (finished) return;
        try { itemRef?.cancel?.(); } catch {}
        finalize({ ok: false, error: `Download stalled after 90 seconds with no progress\n${url}` });
      }, DOWNLOAD_INACTIVITY_TIMEOUT_MS);
    };

    const cleanup = () => {
      try { if (startTimeout) clearTimeout(startTimeout); } catch {}
      try { if (inactivityTimeout) clearTimeout(inactivityTimeout); } catch {}
      try { ses.removeListener('will-download', onWillDownload); } catch {}
      try { if (win && !win.isDestroyed()) win.close(); } catch {}
      activeDownloads.delete(identifier);
    };

    const finalize = (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(result);
    };

    const onWillDownload = (_evt, item, webContents) => {
      if (!win || webContents !== win.webContents) return;
      sawDownload = true;
      itemRef = item;
      try { if (startTimeout) { clearTimeout(startTimeout); startTimeout = null; } } catch {}
      item.setSavePath(destFile);

      activeDownloads.set(identifier, {
        cancel: () => {
          try { item.cancel(); } catch {}
          finalize({ ok: false, error: 'Cancelled' });
        },
        req: null,
        file: null,
      });
      resetInactivityTimeout(item.getURL?.() || downloadUrl);

      item.on('updated', (_event, state) => {
        if (finished || state === 'interrupted') return;
        const total = Number(item.getTotalBytes?.() || 0);
        const received = Number(item.getReceivedBytes?.() || 0);
        resetInactivityTimeout(item.getURL?.() || downloadUrl);
        if (total > 0) {
          try {
            if (event?.sender && !event.sender.isDestroyed()) {
              event.sender.send('download-progress', { identifier, percent: Math.round(received / total * 100), stage: progressStage || undefined });
            }
          } catch {}
        }
      });

      item.once('done', (_event, state) => {
        if (state === 'completed') {
          finalize({ ok: true, filePath: destFile, finalUrl: item.getURL?.() || downloadUrl });
        } else {
          finalize({ ok: false, error: `Browser download ${state}\n${item.getURL?.() || downloadUrl}` });
        }
      });
    };

    ses.on('will-download', onWillDownload);

    win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        session: ses,
      },
    });

    startTimeout = setTimeout(() => {
      if (finished) return;
      finalize({ ok: false, error: `Timed out waiting for browser download\n${downloadUrl}` });
    }, 45000);
    try {
      win.webContents.downloadURL(downloadUrl);
    } catch (err) {
      try { if (startTimeout) { clearTimeout(startTimeout); startTimeout = null; } } catch {}
      finalize({ ok: false, error: `${err.message}\n${downloadUrl}` });
    }
  });
}

async function downloadArchiveViaSessionFetch(event, { identifier, downloadUrl, destFile, cookieHeader = '', referer = 'https://archive.org/', progressStage = '' }) {
  const ses = getSession();
  const headers = archiveDownloadHeaders(cookieHeader, referer);
  let response;
  try {
    response = await ses.fetch(downloadUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });
  } catch (err) {
    return { ok: false, error: `${err.message}\n${downloadUrl}` };
  }

  if (!response || !response.ok || !response.body) {
    return {
      ok: false,
      error: `HTTP ${response?.status || 0} from ${new URL(downloadUrl).hostname}\n${response?.url || downloadUrl}`,
    };
  }

  const finalUrl = response.url || downloadUrl;
  const total = parseInt(response.headers.get('content-length') || '0', 10);

  return new Promise((resolve) => {
    let cancelled = false;
    let received = 0;
    const file = fs.createWriteStream(destFile);
    const bodyStream = Readable.fromWeb(response.body);
    let inactivityTimeout = null;

    const clearInactivityTimeout = () => {
      try { if (inactivityTimeout) clearTimeout(inactivityTimeout); } catch {}
      inactivityTimeout = null;
    };
    const failForStall = () => {
      clearInactivityTimeout();
      if (cancelled) return;
      cancelled = true;
      try { bodyStream.destroy(new Error('Download stalled after 90 seconds with no progress')); } catch {}
      try { file.destroy(); } catch {}
      fs.unlink(destFile, () => {});
      activeDownloads.delete(identifier);
      resolve({ ok: false, error: `Download stalled after 90 seconds with no progress\n${finalUrl}` });
    };
    const resetInactivityTimeout = () => {
      clearInactivityTimeout();
      inactivityTimeout = setTimeout(failForStall, DOWNLOAD_INACTIVITY_TIMEOUT_MS);
    };

    activeDownloads.set(identifier, {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        clearInactivityTimeout();
        try { bodyStream.destroy(); } catch {}
        try { file.destroy(); } catch {}
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: 'Cancelled' });
      },
      req: null,
      file,
    });
    resetInactivityTimeout();

    bodyStream.on('data', chunk => {
      if (cancelled) return;
      received += chunk.length;
      resetInactivityTimeout();
      if (total > 0) {
        try {
          if (event?.sender && !event.sender.isDestroyed()) {
            event.sender.send('download-progress', { identifier, percent: Math.round(received / total * 100), stage: progressStage || undefined });
          }
        } catch {}
      }
    });

    bodyStream.on('error', err => {
      if (cancelled) return;
      clearInactivityTimeout();
      try { file.destroy(); } catch {}
      fs.unlink(destFile, () => {});
      activeDownloads.delete(identifier);
      resolve({ ok: false, error: `${err.message}\n${finalUrl}` });
    });

    file.on('finish', () => {
      if (cancelled) return;
      clearInactivityTimeout();
      file.close();
      activeDownloads.delete(identifier);
      resolve({ ok: true, filePath: destFile, finalUrl });
    });

    file.on('error', err => {
      if (cancelled) return;
      clearInactivityTimeout();
      try { bodyStream.destroy(); } catch {}
      fs.unlink(destFile, () => {});
      activeDownloads.delete(identifier);
      resolve({ ok: false, error: `${err.message}\n${finalUrl}` });
    });

    bodyStream.pipe(file);
  });
}

async function performDownloadJob(event, { identifier, downloadUrl, fileName, progressStage = '', system = '' }) {
  const settings    = loadSettings();
  const downloadDir = resolveSystemStorageRoot(settings.downloadPath || DEFAULT_GAMES_DIR, system);
  const destDir     = path.join(downloadDir, sanitizeFolderName(identifier));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const originalDownloadUrl = downloadUrl;

  const safeFileName = path.basename(fileName);
  const destFile     = path.join(destDir, safeFileName);
  let archiveStatus = { loggedIn: false, username: null };
  let archiveDebug = null;
  if (archiveUrlRequiresAuth(downloadUrl)) {
    await restoreArchiveSession().catch(() => {});
    archiveStatus = await getArchiveStatus().catch(() => ({ loggedIn: false, username: null }));
    archiveDebug = await getArchiveSessionDebugInfo().catch(() => null);
  }
  const cookieHeader = archiveUrlRequiresAuth(downloadUrl) ? await buildArchiveCookieHeader() : '';
  if (archiveUrlRequiresAuth(downloadUrl)) {
    const probe = await probeArchiveDownloadAccess(downloadUrl);
    if (probe?.ok && probe?.finalUrl) downloadUrl = probe.finalUrl;
  }
  const referer      = archiveDownloadReferer(downloadUrl);

  if (archiveUrlRequiresAuth(downloadUrl)) {
    const browserResult = await downloadArchiveViaBrowserWindow(event, { identifier, downloadUrl: originalDownloadUrl, destFile, referer: archiveDownloadReferer(originalDownloadUrl), progressStage });
    if (browserResult?.ok) return browserResult;
    const fetchResult = await downloadArchiveViaSessionFetch(event, { identifier, downloadUrl, destFile, cookieHeader, referer, progressStage });
    if (fetchResult?.ok) return fetchResult;
    const authLines = [
      `Archive login: ${archiveStatus?.loggedIn ? 'yes' : 'no'}`,
      archiveStatus?.username ? `Archive user: ${archiveStatus.username}` : '',
      archiveDebug ? `Archive cookies: ${archiveDebug.cookieCount || 0}` : '',
      archiveDebug ? `logged-in-user cookie: ${archiveDebug.hasLoggedInUser ? 'yes' : 'no'}` : '',
      archiveDebug ? `logged-in-sig cookie: ${archiveDebug.hasLoggedInSig ? 'yes' : 'no'}` : '',
      archiveDebug?.cookieNames?.length ? `Cookie names: ${archiveDebug.cookieNames.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const combinedError = [[browserResult?.error, fetchResult?.error].filter(Boolean).join('\n\nFallback:\n'), authLines].filter(Boolean).join('\n\n');
    console.error(`[archive-download-failed] ${identifier}\n${combinedError}`);
    return {
      ok: false,
      error: combinedError,
    };
  }

  return new Promise((resolve) => {
    let cancelled = false;
    let inactivityTimeout = null;

    const clearInactivityTimeout = () => {
      try { if (inactivityTimeout) clearTimeout(inactivityTimeout); } catch {}
      inactivityTimeout = null;
    };
    const failForStall = (url) => {
      clearInactivityTimeout();
      if (cancelled) return;
      cancelled = true;
      const entry = activeDownloads.get(identifier);
      try { entry?.req?.destroy(); } catch {}
      try { entry?.file?.destroy(); } catch {}
      try { if (fs.existsSync(destFile)) fs.unlinkSync(destFile); } catch {}
      activeDownloads.delete(identifier);
      resolve({ ok: false, error: `Download stalled after 90 seconds with no progress\n${url}` });
    };
    const resetInactivityTimeout = (url) => {
      clearInactivityTimeout();
      inactivityTimeout = setTimeout(() => failForStall(url), DOWNLOAD_INACTIVITY_TIMEOUT_MS);
    };

    activeDownloads.set(identifier, {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        clearInactivityTimeout();
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: 'Cancelled' });
      },
      req: null,
      file: null,
    });

    const doRequest = (url, redirectCount) => {
      if (cancelled) return;
      if (redirectCount > 10) {
        clearInactivityTimeout();
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
        headers: archiveDownloadHeaders(cookieHeader, referer),
        timeout: 30000,
      }, (res) => {
        if (cancelled) { res.resume(); return; }

        const { statusCode, headers } = res;
        resetInactivityTimeout(url);

        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          req.destroy();
          res.resume();
          clearInactivityTimeout();
          let next = headers.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          doRequest(next, redirectCount + 1);
          return;
        }

        if (statusCode !== 200) {
          clearInactivityTimeout();
          res.resume();
          activeDownloads.delete(identifier);
          return resolve({ ok: false, error: `HTTP ${statusCode} from ${parsed.hostname}\n${url}` });
        }

        const total  = parseInt(headers['content-length'] || '0', 10);
        let received = 0;
        const file   = fs.createWriteStream(destFile);

        const entry = activeDownloads.get(identifier);
        if (entry) { entry.req = req; entry.file = file; }

        res.on('data', chunk => {
          if (cancelled) return;
          received += chunk.length;
          resetInactivityTimeout(url);
          if (total > 0) {
            try {
              if (event?.sender && !event.sender.isDestroyed()) {
                event.sender.send('download-progress', { identifier, percent: Math.round(received / total * 100), stage: progressStage || undefined });
              }
            } catch {}
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          if (cancelled) return;
          clearInactivityTimeout();
          file.close();
          activeDownloads.delete(identifier);
          resolve({ ok: true, filePath: destFile });
        });

        file.on('error', err => {
          if (cancelled) return;
          clearInactivityTimeout();
          fs.unlink(destFile, () => {});
          activeDownloads.delete(identifier);
          resolve({ ok: false, error: `${err.message}\n${url}` });
        });
      });

      const entry = activeDownloads.get(identifier);
      if (entry) entry.req = req;

      req.on('timeout', () => {
        if (cancelled) return;
        clearInactivityTimeout();
        req.destroy();
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: `Connection timed out\n${url}` });
      });

      req.on('error', err => {
        if (cancelled) return;
        clearInactivityTimeout();
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: `${err.message}\n${url}` });
      });

      resetInactivityTimeout(url);
      req.end();
    };

    doRequest(downloadUrl, 0);
  });
}

async function extractArchiveInternal({ filePath, identifier, subFolder, extractRootDir = null, deleteSourceArchive = false, onProgress = null, system = '' }) {
  const settings       = loadSettings();
  const installBase    = resolveSystemStorageRoot(settings.installPath || DEFAULT_GAMES_DIR, system);
  const parentDir      = String(extractRootDir || '').trim() || path.join(installBase, sanitizeFolderName(identifier));
  const destDir = subFolder
    ? path.join(parentDir, '_GAME_' + sanitizeFolderName(subFolder))
    : parentDir;

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const ext    = filePath.toLowerCase();
  const sevenZ = resolveSevenZipExecutable();

  const unblockAfterExtract = () => unblockDirectory(destDir);
  const shouldDeleteArchive = !!settings.deleteAfterInstall || !!deleteSourceArchive;

  if ((ext.endsWith('.zip') || ext.endsWith('.7z') || ext.endsWith('.rar')) && sevenZ && fs.existsSync(sevenZ)) {
    const result = await extractArchiveWithSevenZip(filePath, destDir, sevenZ, onProgress);
    if (!result?.ok) return result;
    await unblockAfterExtract();
    if (shouldDeleteArchive) cleanupDownloadedArchive(filePath);
    return { ok: true, installDir: destDir, parentInstallDir: parentDir };
  }

  if (ext.endsWith('.zip')) {
    try {
      const extractZip = require('extract-zip');
      if (typeof onProgress === 'function') {
        try { onProgress({ percent: 15, stage: 'extracting' }); } catch {}
      }
      await extractZip(filePath, { dir: destDir });
      if (typeof onProgress === 'function') {
        try { onProgress({ percent: 100, stage: 'extracting' }); } catch {}
      }
      await unblockAfterExtract();
      if (shouldDeleteArchive) cleanupDownloadedArchive(filePath);
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

  const downloadResult = await performDownloadJob(event, { identifier, downloadUrl, fileName, system });
  if (!downloadResult?.ok) return downloadResult;

  const settings = loadSettings();
  const directExts = ['.chd', '.cue', '.bin', '.img', '.sfc', '.smc', '.nes', '.gba', '.n64'];
  const normalizedSystem = String(system || '').trim().toLowerCase();
  const lowerDownloadPath = String(downloadResult.filePath || '').toLowerCase();
  const isArchiveDownload = ['.zip', '.7z', '.rar'].some(ext => lowerDownloadPath.endsWith(ext));
  const shouldExtract = (normalizedSystem === 'x360' || normalizedSystem === 'ps3')
    ? isArchiveDownload
    : (!!settings.extractArchive && !directExts.some(ext => lowerDownloadPath.endsWith(ext)));

  let installDir = downloadResult.filePath;
  let extractResult = null;
  try {
    if (event?.sender && !event.sender.isDestroyed() && normalizedSystem === 'ps3' && !shouldExtract) {
      event.sender.send('download-progress', { identifier, percent: 5, stage: 'installing' });
    }
  } catch {}
  if (shouldExtract) {
    try {
      if (event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('download-progress', { identifier, percent: 100, stage: 'extracting' });
      }
    } catch {}
    extractResult = await extractArchiveInternal({
      filePath: downloadResult.filePath,
      identifier,
      subFolder,
      system,
      extractRootDir: (normalizedSystem === 'x360' || normalizedSystem === 'ps3') ? path.dirname(downloadResult.filePath) : null,
      deleteSourceArchive: normalizedSystem === 'x360',
      onProgress: ({ percent, stage }) => {
        try {
          if (event?.sender && !event.sender.isDestroyed()) {
            event.sender.send('download-progress', { identifier, percent: Number(percent || 0), stage: stage || 'extracting' });
          }
        } catch {}
      },
    });
    if (!extractResult?.ok) return extractResult;
    installDir = extractResult.installDir;
  }

  if (normalizedSystem === 'ps3') {
    const discKeyResult = await ensurePs3DiscKey(event, {
      identifier,
      installDir,
      originalDownloadPath: downloadResult.filePath,
    });
    if (!discKeyResult?.ok) return discKeyResult;
  }

  try {
    if (event?.sender && !event.sender.isDestroyed()) {
      event.sender.send('download-progress', { identifier, percent: 100, stage: 'installing' });
    }
  } catch {}

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

function systemInstallFolderName(system = '') {
  const normalized = String(system || '').trim().toLowerCase();
  if (!normalized) return '';
  const folderMap = {
    snes: 'Super Nintendo',
    genesis: 'Sega Genesis',
    psx: 'PlayStation',
    ps2: 'PlayStation 2',
    ps3: 'PlayStation 3',
    psp: 'PlayStation Portable',
    dc: 'Dreamcast',
    xbox: 'Xbox',
    x360: 'Xbox 360',
    nes: 'Nintendo Entertainment System',
    gba: 'Game Boy Advance',
    n64: 'Nintendo 64',
    gamecube: 'GameCube',
    wii: 'Wii',
    switch: 'Nintendo Switch',
    pc: 'PC',
  };
  return sanitizeFolderName(folderMap[normalized] || normalized.toUpperCase());
}

function resolveSystemStorageRoot(baseDir, system = '') {
  const root = String(baseDir || '').trim() || DEFAULT_GAMES_DIR;
  const systemFolder = systemInstallFolderName(system);
  return systemFolder ? path.join(root, systemFolder) : root;
}

function resolveUniquePath(targetPath) {
  const parsed = path.parse(String(targetPath || '').trim());
  if (!parsed.dir || !parsed.base) return targetPath;
  let attempt = targetPath;
  let index = 2;
  while (fs.existsSync(attempt)) {
    attempt = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return attempt;
}

function isSubPath(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || '').trim());
  const child = path.resolve(String(childPath || '').trim());
  if (!parent || !child) return false;
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveManagedGameDeleteTarget(installPath, system = '') {
  const targetPath = String(installPath || '').trim();
  if (!targetPath) return '';
  const settings = loadSettings();
  const gamesRoot = path.resolve(String(settings.installPath || DEFAULT_GAMES_DIR).trim() || DEFAULT_GAMES_DIR);
  const systemRoot = path.resolve(resolveSystemStorageRoot(gamesRoot, system));
  const resolvedTarget = path.resolve(targetPath);
  if (!fs.existsSync(resolvedTarget) || !isSubPath(gamesRoot, resolvedTarget)) return resolvedTarget;
  if (resolvedTarget === gamesRoot || resolvedTarget === systemRoot) return '';

  let stat = null;
  try { stat = fs.statSync(resolvedTarget); } catch {}
  if (!stat) return '';

  if (stat.isDirectory()) {
    return resolvedTarget;
  }

  const parentDir = path.dirname(resolvedTarget);
  if (parentDir && parentDir !== systemRoot && parentDir !== gamesRoot && isSubPath(systemRoot, parentDir)) {
    return parentDir;
  }
  return resolvedTarget;
}

function readRPCS3InstallMap() {
  try {
    if (!fs.existsSync(RPCS3_INSTALL_MAP_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(RPCS3_INSTALL_MAP_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRPCS3InstallMap(nextMap) {
  try {
    fs.writeFileSync(RPCS3_INSTALL_MAP_PATH, JSON.stringify(nextMap || {}, null, 2), 'utf8');
  } catch {}
}

function getManagedRPCS3CompatibilityDbPath() {
  try {
    const status = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
    const runtimeRoot = String(status?.runtimeRoot || '').trim();
    if (!runtimeRoot) return '';
    return path.join(runtimeRoot, 'GuiConfigs', 'compat_database.dat');
  } catch {
    return '';
  }
}

function loadRPCS3CompatibilityDb() {
  const dbPath = getManagedRPCS3CompatibilityDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return {};
  try {
    const stat = fs.statSync(dbPath);
    const cacheValid = rpcs3CompatibilityDbCache
      && rpcs3CompatibilityDbCache.path === dbPath
      && Number(rpcs3CompatibilityDbCache.mtimeMs || 0) === Number(stat.mtimeMs || 0)
      && (Date.now() - Number(rpcs3CompatibilityDbCache.loadedAt || 0)) < RPCS3_COMPATIBILITY_CACHE_TTL_MS;
    if (cacheValid) return rpcs3CompatibilityDbCache.results || {};
    const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const results = parsed?.results && typeof parsed.results === 'object' ? parsed.results : {};
    rpcs3CompatibilityDbCache = {
      path: dbPath,
      mtimeMs: Number(stat.mtimeMs || 0),
      loadedAt: Date.now(),
      results,
    };
    return results;
  } catch {
    return {};
  }
}

function getPs3ParamMetadataForTarget(targetPath = '') {
  const target = String(targetPath || '').trim();
  if (!target || !fs.existsSync(target)) return null;
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const directParam = path.join(target, 'PS3_GAME', 'PARAM.SFO');
      const nestedParam = path.join(target, 'PARAM.SFO');
      if (fs.existsSync(directParam)) return readPS3ParamSfoMetadata(directParam) || null;
      if (fs.existsSync(nestedParam)) return readPS3ParamSfoMetadata(nestedParam) || null;
      return null;
    }
    const lower = target.toLowerCase();
    if (lower.endsWith('param.sfo')) return readPS3ParamSfoMetadata(target) || null;
    const parent = path.dirname(target);
    if (!parent || parent === target) return null;
    return getPs3ParamMetadataForTarget(parent);
  } catch {
    return null;
  }
}

function getRPCS3CompatibilityForGame(identifier = '', installDir = '') {
  const compatDb = loadRPCS3CompatibilityDb();
  if (!compatDb || typeof compatDb !== 'object' || !Object.keys(compatDb).length) return null;
  let metadata = getPs3ParamMetadataForTarget(installDir);
  if ((!metadata?.titleId) && identifier) {
    const mapped = readRPCS3InstallMap()[String(identifier || '').trim()];
    if (mapped?.path) metadata = getPs3ParamMetadataForTarget(mapped.path) || metadata;
  }
  if ((!metadata?.titleId) && identifier) {
    const discovered = findMatchingRPCS3InstalledTitle(identifier, installDir);
    if (discovered?.path) metadata = getPs3ParamMetadataForTarget(discovered.path) || metadata;
  }
  const titleId = String(metadata?.titleId || '').trim();
  if (!titleId) return null;
  const entry = compatDb[titleId];
  if (!entry || typeof entry !== 'object') {
    return {
      titleId,
      status: '',
      date: '',
      update: '',
      title: String(metadata?.title || '').trim(),
    };
  }
  return {
    titleId,
    status: String(entry.status || '').trim(),
    date: String(entry.date || '').trim(),
    update: String(entry.update || '').trim(),
    title: String(metadata?.title || '').trim(),
  };
}

function attachRuntimeCompatibilityMetadata(row) {
  const next = row && typeof row === 'object' ? { ...row } : row;
  if (!next || String(next.system || '').trim().toLowerCase() !== 'ps3') return next;
  const compat = getRPCS3CompatibilityForGame(next.identifier, next.install_dir);
  next.ps3_game_id = String(compat?.titleId || '').trim();
  next.rpcs3_compatibility_status = String(compat?.status || '').trim();
  next.rpcs3_compatibility_date = String(compat?.date || '').trim();
  next.rpcs3_compatibility_update = String(compat?.update || '').trim();
  return next;
}

  function runPowerShellHidden(command, { timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = String(stdout || '');
          error.stderr = String(stderr || '');
          reject(error);
          return;
        }
        resolve({
          stdout: String(stdout || '').trim(),
          stderr: String(stderr || '').trim(),
        });
      },
      );
    });
  }

  function logRPCS3PkgAutomation(message = '') {
  const line = `${new Date().toISOString()} ${String(message || '').trim()}`.trim();
  try {
    fs.appendFileSync(RPCS3_PKG_AUTOMATION_LOG_PATH, `${line}\n`, 'utf8');
  } catch {}
  console.log(`[rpcs3-pkg] ${String(message || '').trim()}`);
}

function clearRPCS3PkgInstallWatcher(sessionId = '') {
  const key = String(sessionId || '').trim();
  if (!key) return;
  const watcher = activeRPCS3PkgInstallWatchers.get(key);
  if (watcher?.timer) clearTimeout(watcher.timer);
  activeRPCS3PkgInstallWatchers.delete(key);
}

function clearRPCS3WelcomeWatcher(sessionId = '') {
  const key = String(sessionId || '').trim();
  if (!key) return;
  const watcher = activeRPCS3WelcomeWatchers.get(key);
  if (watcher?.timer) clearTimeout(watcher.timer);
  activeRPCS3WelcomeWatchers.delete(key);
}

function clearRPCS3FirmwareWatcher(sessionId = '') {
  const key = String(sessionId || '').trim();
  if (!key) return;
  const watcher = activeRPCS3FirmwareWatchers.get(key);
  if (watcher?.timer) clearTimeout(watcher.timer);
  activeRPCS3FirmwareWatchers.delete(key);
}

  function getStoredRPCS3FirmwarePath() {
  try {
    const settings = loadSettings();
    return String(settings?.emulators?.rpcs3?.firmwarePackagePath || '').trim();
  } catch {
    return '';
  }
  }

  async function invokeRPCS3WelcomeContinueForPid(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 session pid is invalid.' };
  }
  const command = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$null = Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
$targetPid = ${numericPid}
$root = [System.Windows.Automation.AutomationElement]::RootElement

function Find-WelcomeDialog([System.Windows.Automation.AutomationElement]$scopeRoot, [bool]$requirePid) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($scopeRoot)
  while ($node -ne $null) {
    try {
      $name = [string]$node.Current.Name
      $controlType = $node.Current.ControlType
      $nodePid = [int]$node.Current.ProcessId
      $pidOk = (-not $requirePid) -or ($nodePid -eq $targetPid)
      if ($pidOk -and $controlType -eq [System.Windows.Automation.ControlType]::Window -and (($name -eq 'Welcome to RPCS3') -or ($name -like '*Welcome*RPCS3*'))) {
        return $node
      }
      $desc = Find-WelcomeDialog $node $requirePid
      if ($desc -ne $null) { return $desc }
    } catch {}
    $node = $walker.GetNextSibling($node)
  }
  return $null
}

function Find-ByControl([System.Windows.Automation.AutomationElement]$scopeRoot, [string]$nameNeedle, $controlTypeNeedle) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($scopeRoot)
  while ($node -ne $null) {
    try {
      $name = [string]$node.Current.Name
      $controlType = $node.Current.ControlType
      if ($controlType -eq $controlTypeNeedle -and $name -like $nameNeedle) {
        return $node
      }
      $desc = Find-ByControl $node $nameNeedle $controlTypeNeedle
      if ($desc -ne $null) { return $desc }
    } catch {}
    $node = $walker.GetNextSibling($node)
  }
  return $null
}

function Find-ByExactControl([System.Windows.Automation.AutomationElement]$scopeRoot, [string]$exactName, $controlTypeNeedle) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($scopeRoot)
  while ($node -ne $null) {
    try {
      $name = [string]$node.Current.Name
      $controlType = $node.Current.ControlType
      if ($controlType -eq $controlTypeNeedle -and $name -eq $exactName) {
        return $node
      }
      $desc = Find-ByExactControl $node $exactName $controlTypeNeedle
      if ($desc -ne $null) { return $desc }
    } catch {}
    $node = $walker.GetNextSibling($node)
  }
  return $null
}

function Set-CheckboxState([System.Windows.Automation.AutomationElement]$checkbox, [System.Windows.Automation.ToggleState]$desiredState) {
  if ($null -eq $checkbox) { return $false }
  try {
    $toggle = $checkbox.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($null -ne $toggle) {
      if ($toggle.Current.ToggleState -ne $desiredState) {
        $toggle.Toggle()
        Start-Sleep -Milliseconds 80
      }
      return $true
    }
  } catch {}
  try {
    $legacy = $checkbox.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
    if ($null -ne $legacy) {
      $legacy.DoDefaultAction()
      Start-Sleep -Milliseconds 80
      return $true
    }
  } catch {}
  return $false
}

function Send-SpaceToggle([System.Windows.Automation.AutomationElement]$checkbox, [int]$count) {
  if ($null -eq $checkbox) { return $false }
  try {
    $checkbox.SetFocus()
    Start-Sleep -Milliseconds 80
    for ($i = 0; $i -lt $count; $i++) {
      [System.Windows.Forms.SendKeys]::SendWait(' ')
      Start-Sleep -Milliseconds 120
    }
    return $true
  } catch {}
  return $false
}

$dialog = Find-WelcomeDialog $root $true
if ($null -eq $dialog) {
  $dialog = Find-WelcomeDialog $root $false
}
if ($null -eq $dialog) {
  Write-Output 'not-found'
  exit 0
}

$quickstart = Find-ByExactControl $dialog 'I have read the Quickstart guide' ([System.Windows.Automation.ControlType]::CheckBox)
if ($null -eq $quickstart) {
  $quickstart = Find-ByControl $dialog '*I have read*Quickstart guide*' ([System.Windows.Automation.ControlType]::CheckBox)
}
$doNotShow = Find-ByExactControl $dialog 'Do not show again' ([System.Windows.Automation.ControlType]::CheckBox)
$showAtStartup = Find-ByExactControl $dialog 'Show at startup' ([System.Windows.Automation.ControlType]::CheckBox)
if ($null -eq $showAtStartup) {
  $showAtStartup = Find-ByControl $dialog '*Show at startup*' ([System.Windows.Automation.ControlType]::CheckBox)
}
$continueButton = Find-ByExactControl $dialog 'Continue' ([System.Windows.Automation.ControlType]::Button)
if ($null -eq $continueButton) {
  $continueButton = Find-ByControl $dialog 'Continue' ([System.Windows.Automation.ControlType]::Button)
}

if ($null -ne $quickstart) {
  $toggled = Send-SpaceToggle $quickstart 2
  if (-not $toggled) {
    $null = Set-CheckboxState $quickstart ([System.Windows.Automation.ToggleState]::Off)
    Start-Sleep -Milliseconds 100
    $null = Set-CheckboxState $quickstart ([System.Windows.Automation.ToggleState]::On)
  }
  Start-Sleep -Milliseconds 160
}
if ($null -ne $doNotShow) {
  $null = Set-CheckboxState $doNotShow ([System.Windows.Automation.ToggleState]::On)
  Start-Sleep -Milliseconds 80
}
if ($null -ne $showAtStartup) {
  $null = Set-CheckboxState $showAtStartup ([System.Windows.Automation.ToggleState]::Off)
  Start-Sleep -Milliseconds 80
}

if ($null -eq $continueButton) {
  Write-Output 'continue-not-found'
  exit 0
}

for ($i = 0; $i -lt 12; $i++) {
  try {
    if ($continueButton.Current.IsEnabled) { break }
  } catch {}
  Start-Sleep -Milliseconds 150
}

if ($continueButton.Current.IsEnabled) {
  try {
    $invoke = $continueButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -ne $invoke) {
      $invoke.Invoke()
      Write-Output 'clicked'
      exit 0
    }
  } catch {}
  try {
    $legacy = $continueButton.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
    if ($null -ne $legacy) {
      $legacy.DoDefaultAction()
      Write-Output 'clicked-legacy'
      exit 0
    }
  } catch {}
}

try {
  $dialog.SetFocus()
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Write-Output 'clicked-enter'
  exit 0
} catch {}

if (-not $continueButton.Current.IsEnabled) {
  Write-Output 'continue-disabled'
  exit 0
}
Write-Output 'invoke-not-supported'
`.trim();
  try {
    const { stdout } = await runPowerShellHidden(command, { timeoutMs: 10000 });
    const state = String(stdout || '').trim().toLowerCase() || 'unknown';
    if (['clicked', 'clicked-legacy', 'clicked-enter'].includes(state)) return { ok: true, state };
    return { ok: false, state };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      error: error?.message || 'Could not inspect the RPCS3 Welcome dialog.',
      stderr: String(error?.stderr || '').trim(),
    };
  }
}

async function invokeRPCS3WelcomeClickSequenceForPid(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 session pid is invalid.' };
  }
  const command = `
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const int SW_RESTORE = 9;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@

$targetPid = ${numericPid}
$windowHandle = [IntPtr]::Zero
[Win32]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $procId = 0
  [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  if ($procId -ne $targetPid) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][Win32]::GetWindowTextW($hWnd, $sb, $sb.Capacity)
  $title = $sb.ToString()
  if ($title -like '*Welcome*RPCS3*') {
    $script:windowHandle = $hWnd
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($windowHandle -eq [IntPtr]::Zero) {
  Write-Output 'not-found'
  exit 0
}

$rect = New-Object RECT
if (-not [Win32]::GetWindowRect($windowHandle, [ref]$rect)) {
  Write-Output 'rect-failed'
  exit 0
}

[void][Win32]::ShowWindow($windowHandle, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 180

$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)

function Invoke-Click([double]$xRatio, [double]$yRatio) {
  $x = [int]([Math]::Round($rect.Left + ($width * $xRatio)))
  $y = [int]([Math]::Round($rect.Top + ($height * $yRatio)))
  [void][Win32]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 90
  [Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}

# 1. Uncheck "Show at startup"
Invoke-Click 0.806 0.935
# 2. Check "I have read the Quickstart guide"
Invoke-Click 0.392 0.935
Start-Sleep -Milliseconds 220
# 3. Click "Continue"
Invoke-Click 0.078 0.935

Write-Output 'clicked-sequence'
`.trim();
  try {
    const { stdout } = await runPowerShellHidden(command, { timeoutMs: 10000 });
    const state = String(stdout || '').trim().toLowerCase() || 'unknown';
    if (state === 'clicked-sequence') return { ok: true, state };
    return { ok: false, state };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      error: error?.message || 'Could not run the RPCS3 welcome click sequence.',
      stderr: String(error?.stderr || '').trim(),
    };
  }
}

async function invokeRPCS3WelcomeGuideActionForPid(pid, action = '') {
  const numericPid = Number(pid);
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 session pid is invalid.' };
  }
  if (!['show-startup-off', 'quickstart-on', 'continue', 'apply-all'].includes(normalizedAction)) {
    return { ok: false, state: 'invalid-action', error: 'RPCS3 welcome action is invalid.' };
  }
  if (normalizedAction === 'apply-all') {
    const direct = await invokeRPCS3WelcomeContinueForPid(numericPid);
    if (direct?.ok) return direct;
    const fallback = await invokeRPCS3WelcomeClickSequenceForPid(numericPid);
    if (fallback?.ok) return fallback;
  }
  if (normalizedAction === 'continue') {
    const direct = await invokeRPCS3WelcomeContinueForPid(numericPid);
    if (direct?.ok) return direct;
  }
const command = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const int SW_RESTORE = 9;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@

$targetPid = ${numericPid}
$guideAction = '${normalizedAction}'
$windowHandle = [IntPtr]::Zero
[Win32]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $procId = 0
  [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  if ($procId -ne $targetPid) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][Win32]::GetWindowTextW($hWnd, $sb, $sb.Capacity)
  $title = $sb.ToString()
  if ($title -like '*Welcome*RPCS3*') {
    $script:windowHandle = $hWnd
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($windowHandle -eq [IntPtr]::Zero) {
  Write-Output 'not-found'
  exit 0
}

$rect = New-Object RECT
if (-not [Win32]::GetWindowRect($windowHandle, [ref]$rect)) {
  Write-Output 'rect-failed'
  exit 0
}

[void][Win32]::ShowWindow($windowHandle, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 120

$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)

function Invoke-Click([double]$xRatio, [double]$yRatio) {
  $x = [int]([Math]::Round($rect.Left + ($width * $xRatio)))
  $y = [int]([Math]::Round($rect.Top + ($height * $yRatio)))
  [void][Win32]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 70
  [Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
  [Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}

switch ($guideAction) {
  'show-startup-off' {
    Invoke-Click 0.806 0.935
    Write-Output 'show-startup-off'
    exit 0
  }
  'quickstart-on' {
    Invoke-Click 0.392 0.935
    Write-Output 'quickstart-on'
    exit 0
  }
  'continue' {
    Invoke-Click 0.078 0.935
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Write-Output 'continue'
    exit 0
  }
  'apply-all' {
    Invoke-Click 0.806 0.935
    Invoke-Click 0.392 0.935
    Start-Sleep -Milliseconds 220
    Invoke-Click 0.078 0.935
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Write-Output 'apply-all'
    exit 0
  }
}
Write-Output 'unknown'
`.trim();
  try {
    const { stdout } = await runPowerShellHidden(command, { timeoutMs: 10000 });
    const state = String(stdout || '').trim().toLowerCase() || 'unknown';
    if (['show-startup-off', 'quickstart-on', 'continue', 'apply-all', 'clicked-sequence', 'clicked', 'clicked-legacy', 'clicked-enter'].includes(state)) {
      return { ok: true, state };
    }
    return { ok: false, state };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      error: error?.message || 'Could not run the RPCS3 welcome guide action.',
      stderr: String(error?.stderr || '').trim(),
    };
  }
}

async function invokeRPCS3PkgInstallButtonForPid(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 session pid is invalid.' };
  }
  const command = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$null = Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
$targetPid = ${numericPid}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$titleContains = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'PKG Installation')
$dialogIdCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'gui_application.pkg_install_dialog')
$windowTypeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$buttonTypeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
$dialog = $null

function Find-Dialog([System.Windows.Automation.AutomationElement]$scopeRoot, [bool]$requirePid) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($scopeRoot)
  while ($node -ne $null) {
    try {
      $name = [string]$node.Current.Name
      $automationId = [string]$node.Current.AutomationId
      $controlType = $node.Current.ControlType
      $nodePid = [int]$node.Current.ProcessId
      $pidOk = (-not $requirePid) -or ($nodePid -eq $targetPid)
      if ($pidOk -and $controlType -eq [System.Windows.Automation.ControlType]::Window -and (($name -eq 'PKG Installation') -or ($automationId -eq 'gui_application.pkg_install_dialog') -or ($name -like '*PKG*Installation*'))) {
        return $node
      }
      $desc = Find-Dialog $node $requirePid
      if ($desc -ne $null) { return $desc }
    } catch {}
    $node = $walker.GetNextSibling($node)
  }
  return $null
}

$dialog = Find-Dialog $root $true
if ($null -eq $dialog) {
  $dialog = Find-Dialog $root $false
}
if ($null -eq $dialog) {
  Write-Output 'not-found'
  exit 0
}

function Find-InstallButton([System.Windows.Automation.AutomationElement]$dialogRoot) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($dialogRoot)
  while ($node -ne $null) {
    try {
      $name = [string]$node.Current.Name
      $automationId = [string]$node.Current.AutomationId
      $controlType = $node.Current.ControlType
      if ($controlType -eq [System.Windows.Automation.ControlType]::Button -and (($name -eq 'Install') -or ($automationId -eq 'gui_application.pkg_install_dialog.QDialogButtonBox.QPushButton'))) {
        return $node
      }
      $desc = Find-InstallButton $node
      if ($desc -ne $null) { return $desc }
    } catch {}
    $node = $walker.GetNextSibling($node)
  }
  return $null
}

$button = Find-InstallButton $dialog
if ($button -ne $null -and $button.Current.IsEnabled) {
  try {
    $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -ne $invoke) {
      $invoke.Invoke()
      Write-Output 'clicked'
      exit 0
    }
  } catch {}
  try {
    $legacy = $button.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
    if ($null -ne $legacy) {
      $legacy.DoDefaultAction()
      Write-Output 'clicked-legacy'
      exit 0
    }
  } catch {}
}

try {
  $windowPattern = $dialog.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
  if ($null -ne $windowPattern) {
    $dialog.SetFocus()
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Write-Output 'clicked-enter'
    exit 0
  }
} catch {}

if ($button -eq $null) {
  Write-Output 'button-not-found'
  exit 0
}
if (-not $button.Current.IsEnabled) {
  Write-Output 'button-disabled'
  exit 0
}
Write-Output 'invoke-not-supported'
`.trim();
  try {
    const { stdout } = await runPowerShellHidden(command, { timeoutMs: 10000 });
    const state = String(stdout || '').trim().toLowerCase() || 'unknown';
    if (['clicked', 'clicked-legacy', 'clicked-enter'].includes(state)) return { ok: true, state };
    return { ok: false, state };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      error: error?.message || 'Could not inspect the RPCS3 PKG Installation dialog.',
      stderr: String(error?.stderr || '').trim(),
    };
  }
}

async function invokeRPCS3PkgInstallClickSequenceForPid(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 session pid is invalid.' };
  }
  const command = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const int SW_RESTORE = 9;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@

$targetPid = ${numericPid}
$windowHandle = [IntPtr]::Zero
[Win32]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $procId = 0
  [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  if ($procId -ne $targetPid) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][Win32]::GetWindowTextW($hWnd, $sb, $sb.Capacity)
  $title = $sb.ToString()
  if ($title -like '*PKG*Installation*') {
    $script:windowHandle = $hWnd
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($windowHandle -eq [IntPtr]::Zero) {
  Write-Output 'not-found'
  exit 0
}

[void][Win32]::ShowWindow($windowHandle, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 180

$rect = New-Object RECT
if (-not [Win32]::GetWindowRect($windowHandle, [ref]$rect)) {
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Write-Output 'clicked-enter-fallback'
  exit 0
}

$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$x = [int]([Math]::Round($rect.Left + ($width * 0.76)))
$y = [int]([Math]::Round($rect.Top + ($height * 0.93)))
[void][Win32]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 90
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 160
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Write-Output 'clicked-sequence'
`.trim();
  try {
    const { stdout } = await runPowerShellHidden(command, { timeoutMs: 10000 });
    const state = String(stdout || '').trim().toLowerCase() || 'unknown';
    if (['clicked-sequence', 'clicked-enter-fallback'].includes(state)) return { ok: true, state };
    return { ok: false, state };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      error: error?.message || 'Could not run the RPCS3 PKG click sequence.',
      stderr: String(error?.stderr || '').trim(),
    };
  }
}

async function invokeRPCS3FirmwareLocateSequenceForPid(pid, firmwarePath = '') {
  const numericPid = Number(pid);
  const targetPath = String(firmwarePath || '').trim();
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 session pid is invalid.' };
  }
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { ok: false, state: 'missing-firmware-path', error: 'SKALD does not have a stored PS3 firmware package ready.' };
  }
  const escapedPath = targetPath.replace(/'/g, "''");
  const command = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const int SW_RESTORE = 9;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@

$targetPid = ${numericPid}
$firmwarePath = '${escapedPath}'
$windowHandle = [IntPtr]::Zero

function Find-TopWindow([string]$titleLike, [bool]$requirePid) {
  $script:windowHandle = [IntPtr]::Zero
  [Win32]::EnumWindows({
    param($hWnd, $lParam)
    if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
    $procId = 0
    [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$procId)
    if ($requirePid -and $procId -ne $targetPid) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][Win32]::GetWindowTextW($hWnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
    if ($title -like $titleLike) {
      $script:windowHandle = $hWnd
      return $false
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  return $script:windowHandle
}

  $windowHandle = Find-TopWindow '*Missing Firmware*' $true
  if ($windowHandle -eq [IntPtr]::Zero) {
    $windowHandle = Find-TopWindow '*Missing Firmware*' $false
  }

if ($windowHandle -eq [IntPtr]::Zero) {
  Write-Output 'not-found'
  exit 0
}

$rect = New-Object RECT
if (-not [Win32]::GetWindowRect($windowHandle, [ref]$rect)) {
  Write-Output 'rect-failed'
  exit 0
}

[void][Win32]::ShowWindow($windowHandle, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 220

$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $x = [int]([Math]::Round($rect.Left + ($width * 0.69)))
  $y = [int]([Math]::Round($rect.Top + ($height * 0.82)))
[void][Win32]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 90
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 250

$openDialog = [IntPtr]::Zero
for ($i = 0; $i -lt 40; $i++) {
  $openDialog = Find-TopWindow 'Open' $false
  if ($openDialog -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 100
}

if ($openDialog -eq [IntPtr]::Zero) {
  Write-Output 'open-dialog-not-found'
  exit 0
}

  [void][Win32]::ShowWindow($openDialog, [Win32]::SW_RESTORE)
  [void][Win32]::SetForegroundWindow($openDialog)
  Start-Sleep -Milliseconds 180

  $openElement = [System.Windows.Automation.AutomationElement]::FromHandle($openDialog)
  $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $edits = $openElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
  $setValue = $false
  for ($i = 0; $i -lt $edits.Count; $i++) {
    try {
      $valuePattern = $edits.Item($i).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($null -ne $valuePattern) {
        $valuePattern.SetValue($firmwarePath)
        $setValue = $true
        break
      }
    } catch {}
  }
  if (-not $setValue) {
    [System.Windows.Forms.Clipboard]::SetText($firmwarePath)
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('^v')
  }
  Start-Sleep -Milliseconds 160
  $buttonCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $buttons = $openElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCond)
  for ($i = 0; $i -lt $buttons.Count; $i++) {
    try {
      $name = [string]$buttons.Item($i).Current.Name
      if ($name -eq 'Open' -or $name -eq '&Open') {
        $invoke = $buttons.Item($i).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        if ($null -ne $invoke) {
          $invoke.Invoke()
          Write-Output 'clicked-locate-open'
          exit 0
        }
      }
    } catch {}
  }
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Write-Output 'clicked-locate-open'
  `.trim();
  try {
    const { stdout } = await runPowerShellHidden(command, { timeoutMs: 12000 });
    const state = String(stdout || '').trim().toLowerCase() || 'unknown';
    if (state === 'clicked-locate-open') return { ok: true, state };
    return { ok: false, state };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      error: error?.message || 'Could not run the RPCS3 firmware locate sequence.',
      stderr: String(error?.stderr || '').trim(),
    };
  }
  }

  async function invokeRPCS3FirmwareMenuInstallSequenceForPid(pid, firmwarePath = '') {
  const numericPid = Number(pid);
  const targetPath = String(firmwarePath || '').trim();
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, state: 'invalid-pid', error: 'RPCS3 session pid is invalid.' };
  }

  function dispatchRPCS3FirmwareInstallYesForPid(pid) {
    const numericPid = Number(pid);
    if (!Number.isFinite(numericPid) || numericPid <= 0) {
      return { ok: false, state: 'invalid-pid', error: 'RPCS3 firmware installer pid is invalid.' };
    }
    return dispatchRPCS3FirmwareConfirmWithNativeHelper(numericPid, {
      timeoutMs: 15000,
      logPrefix: 'firmware-menu-install-confirm',
    });
  }
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { ok: false, state: 'missing-firmware-path', error: 'SKALD does not have a stored PS3 firmware package ready.' };
  }
  const escapedPath = targetPath.replace(/'/g, "''");
  const command = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  public const int SW_RESTORE = 9;
}
"@

$targetPid = ${numericPid}
$firmwarePath = '${escapedPath}'
$windowHandle = [IntPtr]::Zero

function Find-TopWindow([string]$titleLike, [bool]$requirePid) {
  $script:windowHandle = [IntPtr]::Zero
  [Win32]::EnumWindows({
    param($hWnd, $lParam)
    if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
    $procId = 0
    [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$procId)
    if ($requirePid -and $procId -ne $targetPid) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][Win32]::GetWindowTextW($hWnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
    if ($title -like $titleLike) {
      $script:windowHandle = $hWnd
      return $false
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  return $script:windowHandle
}

$windowHandle = Find-TopWindow '*RPCS3*' $true
if ($windowHandle -eq [IntPtr]::Zero) {
  Write-Output 'main-window-not-found'
  exit 0
}

[void][Win32]::ShowWindow($windowHandle, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 350
[System.Windows.Forms.SendKeys]::SendWait('%f')
Start-Sleep -Milliseconds 180
[System.Windows.Forms.SendKeys]::SendWait('i')

$openDialog = [IntPtr]::Zero
for ($i = 0; $i -lt 40; $i++) {
  $openDialog = Find-TopWindow 'Open' $false
  if ($openDialog -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 100
}

if ($openDialog -eq [IntPtr]::Zero) {
  Write-Output 'open-dialog-not-found'
  exit 0
}

[void][Win32]::ShowWindow($openDialog, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($openDialog)
Start-Sleep -Milliseconds 180

$openElement = [System.Windows.Automation.AutomationElement]::FromHandle($openDialog)
$editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$edits = $openElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
$setValue = $false
for ($i = 0; $i -lt $edits.Count; $i++) {
  try {
    $valuePattern = $edits.Item($i).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $valuePattern) {
      $valuePattern.SetValue($firmwarePath)
      $setValue = $true
      break
    }
  } catch {}
}
if (-not $setValue) {
  [System.Windows.Forms.Clipboard]::SetText($firmwarePath)
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait('%n')
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait('^v')
}
Start-Sleep -Milliseconds 160
$buttonCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $openElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCond)
for ($i = 0; $i -lt $buttons.Count; $i++) {
  try {
    $name = [string]$buttons.Item($i).Current.Name
    if ($name -eq 'Open' -or $name -eq '&Open') {
      $invoke = $buttons.Item($i).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if ($null -ne $invoke) {
        $invoke.Invoke()
        Write-Output 'firmware-menu-opened'
        exit 0
      }
    }
  } catch {}
}
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Write-Output 'firmware-menu-opened'
`.trim();
  try {
    const { stdout } = await runPowerShellHidden(command, { timeoutMs: 12000 });
    const state = String(stdout || '').trim().toLowerCase() || 'unknown';
    if (state === 'firmware-menu-opened') return { ok: true, state };
    return { ok: false, state };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      error: error?.message || 'Could not run the RPCS3 firmware menu install sequence.',
      stderr: String(error?.stderr || '').trim(),
    };
  }
}

  function isRPCS3AutoPkgInstallCandidateSession(session) {
  if (String(session?.emulatorId || '').trim().toLowerCase() !== 'rpcs3') return false;
  const launchPath = String(session?.romPath || session?.sourcePath || '').trim();
  if (!launchPath) return true;
  return path.extname(launchPath).toLowerCase() !== '.pkg';
}

function startRPCS3WelcomeWatcher(session) {
  const sessionId = String(session?.id || '').trim();
  if (!sessionId || String(session?.emulatorId || '').trim().toLowerCase() !== 'rpcs3' || !session?.pid) return;
  clearRPCS3WelcomeWatcher(sessionId);
  const startedAt = Date.now();
  const maxDurationMs = 120000;
  const watcher = {
    startedAt,
    attempts: 0,
    timer: null,
  };
  activeRPCS3WelcomeWatchers.set(sessionId, watcher);
  logRPCS3PkgAutomation(`welcome-watcher-start session=${sessionId} pid=${session.pid}`);

  const tick = async () => {
    const current = activeRPCS3WelcomeWatchers.get(sessionId);
    if (!current) return;
    if (!current.startedAt) current.startedAt = startedAt;
    current.attempts = Number(current.attempts || 0) + 1;

    let result = await invokeRPCS3WelcomeContinueForPid(session.pid);
    if (!result?.ok) {
      const clickFallback = await invokeRPCS3WelcomeClickSequenceForPid(session.pid);
      if (clickFallback?.ok) result = clickFallback;
    }
    if (result?.ok) {
      logRPCS3PkgAutomation(`welcome-clicked session=${sessionId} attempt=${current.attempts}`);
      clearRPCS3WelcomeWatcher(sessionId);
      return;
    }

    const state = String(result?.state || '').trim().toLowerCase();
    if (!['not-found', 'continue-disabled', 'continue-not-found'].includes(state)) {
      logRPCS3PkgAutomation(`welcome-watcher-stop session=${sessionId} attempt=${current.attempts} state=${state || 'unknown'} error=${String(result?.error || '').trim() || '<none>'}`);
      clearRPCS3WelcomeWatcher(sessionId);
      return;
    }

    if (current.attempts === 1 || current.attempts % 15 === 0) {
      logRPCS3PkgAutomation(`welcome-watcher-poll session=${sessionId} attempt=${current.attempts} state=${state}`);
    }

    if ((Date.now() - current.startedAt) >= maxDurationMs) {
      logRPCS3PkgAutomation(`welcome-watcher-timeout session=${sessionId} attempts=${current.attempts} window=${Math.round(maxDurationMs / 1000)}s`);
      clearRPCS3WelcomeWatcher(sessionId);
      return;
    }

    const attemptDelayMs = current.attempts <= 15 ? 100 : (current.attempts <= 30 ? 250 : 750);
    current.timer = setTimeout(() => {
      tick().catch((error) => {
        console.warn('[rpcs3-welcome] Watcher tick failed:', error?.message || error);
        clearRPCS3WelcomeWatcher(sessionId);
      });
    }, attemptDelayMs);
    activeRPCS3WelcomeWatchers.set(sessionId, current);
  };

  tick().catch((error) => {
    logRPCS3PkgAutomation(`welcome-watcher-error session=${sessionId} error=${error?.message || error}`);
    clearRPCS3WelcomeWatcher(sessionId);
  });
}

function startRPCS3FirmwareWatcher(session) {
  const sessionId = String(session?.id || '').trim();
  if (!sessionId || String(session?.emulatorId || '').trim().toLowerCase() !== 'rpcs3' || !session?.pid) return;
  const runtimeStatus = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
  const firmwarePath = getStoredRPCS3FirmwarePath();
  if (runtimeStatus?.firmwareInstalled || !firmwarePath || !fs.existsSync(firmwarePath)) return;

  clearRPCS3FirmwareWatcher(sessionId);
  const startedAt = Date.now();
  const maxDurationMs = 120000;
  const watcher = {
    startedAt,
    attempts: 0,
    timer: null,
  };
  activeRPCS3FirmwareWatchers.set(sessionId, watcher);
  logRPCS3PkgAutomation(`firmware-watcher-start session=${sessionId} pid=${session.pid} firmware=${firmwarePath}`);

  const tick = async () => {
    const current = activeRPCS3FirmwareWatchers.get(sessionId);
    if (!current) return;
    if (!current.startedAt) current.startedAt = startedAt;
    current.attempts = Number(current.attempts || 0) + 1;

      const launchPath = String(session?.romPath || session?.sourcePath || '').trim();
      const result = launchPath
        ? await invokeRPCS3FirmwareLocateSequenceForPid(session.pid, firmwarePath)
        : await invokeRPCS3FirmwareMenuInstallSequenceForPid(session.pid, firmwarePath);
      if (result?.ok) {
        logRPCS3PkgAutomation(`firmware-clicked session=${sessionId} attempt=${current.attempts}`);
        clearRPCS3FirmwareWatcher(sessionId);
        return;
      }

    const state = String(result?.state || '').trim().toLowerCase();
      if (!['not-found', 'rect-failed', 'main-window-not-found', 'open-dialog-not-found'].includes(state)) {
      logRPCS3PkgAutomation(`firmware-watcher-stop session=${sessionId} attempt=${current.attempts} state=${state || 'unknown'} error=${String(result?.error || '').trim() || '<none>'}`);
      clearRPCS3FirmwareWatcher(sessionId);
      return;
    }

    if (current.attempts === 1 || current.attempts % 15 === 0) {
      logRPCS3PkgAutomation(`firmware-watcher-poll session=${sessionId} attempt=${current.attempts} state=${state}`);
    }

    if ((Date.now() - current.startedAt) >= maxDurationMs) {
      logRPCS3PkgAutomation(`firmware-watcher-timeout session=${sessionId} attempts=${current.attempts} window=${Math.round(maxDurationMs / 1000)}s`);
      clearRPCS3FirmwareWatcher(sessionId);
      return;
    }

    const attemptDelayMs = current.attempts <= 15 ? 100 : (current.attempts <= 30 ? 250 : 750);
    current.timer = setTimeout(() => {
      tick().catch((error) => {
        console.warn('[rpcs3-firmware] Watcher tick failed:', error?.message || error);
        clearRPCS3FirmwareWatcher(sessionId);
      });
    }, attemptDelayMs);
    activeRPCS3FirmwareWatchers.set(sessionId, current);
  };

  tick().catch((error) => {
    logRPCS3PkgAutomation(`firmware-watcher-error session=${sessionId} error=${error?.message || error}`);
    clearRPCS3FirmwareWatcher(sessionId);
  });
}

function startRPCS3PkgInstallWatcher(session) {
  const sessionId = String(session?.id || '').trim();
  if (!sessionId || !isRPCS3AutoPkgInstallCandidateSession(session) || !session?.pid) return;
  clearRPCS3PkgInstallWatcher(sessionId);
  const startedAt = Date.now();
    const maxDurationMs = 300000;
  const watcher = {
    startedAt,
    attempts: 0,
    timer: null,
  };
  activeRPCS3PkgInstallWatchers.set(sessionId, watcher);
  logRPCS3PkgAutomation(`watcher-start session=${sessionId} pid=${session.pid} launch=${String(session?.romPath || session?.sourcePath || '').trim() || '<none>'}`);

  const tick = async () => {
    const current = activeRPCS3PkgInstallWatchers.get(sessionId);
    if (!current) return;
    if (!current.startedAt) current.startedAt = startedAt;
    current.attempts = Number(current.attempts || 0) + 1;

      let result = await invokeRPCS3PkgInstallClickSequenceForPid(session.pid);
      if (!result?.ok) {
        const automationResult = await invokeRPCS3PkgInstallButtonForPid(session.pid);
        if (automationResult?.ok) result = automationResult;
        else if (String(result?.state || '').trim().toLowerCase() === 'not-found') result = automationResult?.state === 'error' ? result : (automationResult || result);
      }
    if (result?.ok) {
      logRPCS3PkgAutomation(`clicked session=${sessionId} attempt=${current.attempts}`);
      publishEmulatorRuntimeProgress({
        stage: 'pkg-installing',
        percent: 78,
        message: 'RPCS3 is installing required PS3 game data…',
      });
      emulatorManager.minimizeSessionWindow(sessionId).catch(() => null);
      promoteSkaldLaunchShield(60000);
      clearRPCS3PkgInstallWatcher(sessionId);
      return;
    }

    const state = String(result?.state || '').trim().toLowerCase();
      if (!['not-found', 'button-not-found', 'button-disabled', 'error'].includes(state)) {
        logRPCS3PkgAutomation(`watcher-stop session=${sessionId} attempt=${current.attempts} state=${state || 'unknown'} error=${String(result?.error || '').trim() || '<none>'}`);
        clearRPCS3PkgInstallWatcher(sessionId);
        return;
      }

    if (current.attempts === 1 || current.attempts % 15 === 0) {
      logRPCS3PkgAutomation(`watcher-poll session=${sessionId} attempt=${current.attempts} state=${state}`);
    }

    if ((Date.now() - current.startedAt) >= maxDurationMs) {
      logRPCS3PkgAutomation(`watcher-timeout session=${sessionId} attempts=${current.attempts} window=${Math.round(maxDurationMs / 1000)}s`);
      clearRPCS3PkgInstallWatcher(sessionId);
      return;
    }

      const attemptDelayMs = current.attempts < 30 ? 250 : 1000;
      current.timer = setTimeout(() => {
      tick().catch((error) => {
        console.warn('[rpcs3-pkg] Watcher tick failed:', error?.message || error);
        clearRPCS3PkgInstallWatcher(sessionId);
      });
    }, attemptDelayMs);
    activeRPCS3PkgInstallWatchers.set(sessionId, current);
  };

  tick().catch((error) => {
    logRPCS3PkgAutomation(`watcher-error session=${sessionId} error=${error?.message || error}`);
    clearRPCS3PkgInstallWatcher(sessionId);
  });
}

function getManagedRPCS3GameRoot() {
  try {
    const status = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
    const runtimeRoot = String(status?.runtimeRoot || '').trim();
    if (!runtimeRoot) return '';
    return path.join(runtimeRoot, 'dev_hdd0', 'game');
  } catch {
    return '';
  }
}

function getManagedRPCS3DiscRoot() {
  try {
    const status = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
    const runtimeRoot = String(status?.runtimeRoot || '').trim();
    if (!runtimeRoot) return '';
    return path.join(runtimeRoot, 'dev_bdvd');
  } catch {
    return '';
  }
}

function isLaunchableRPCS3InstalledTitle(dirPath = '') {
  const base = String(dirPath || '').trim();
  if (!base || !fs.existsSync(base)) return false;
  try {
    const stat = fs.statSync(base);
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }
  return fs.existsSync(path.join(base, 'USRDIR', 'EBOOT.BIN')) || fs.existsSync(path.join(base, 'PARAM.SFO'));
}

function buildRPCS3InstalledTitleSnapshot(gameRoot = '') {
  const root = String(gameRoot || '').trim();
  const snapshot = {};
  if (!root || !fs.existsSync(root)) return snapshot;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return snapshot;
  }
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const titleId = String(entry.name || '').trim();
    if (!titleId) continue;
    const fullPath = path.join(root, titleId);
    if (!isLaunchableRPCS3InstalledTitle(fullPath)) continue;
    try {
      const stat = fs.statSync(fullPath);
      snapshot[titleId] = {
        path: fullPath,
        mtimeMs: Number(stat.mtimeMs || 0),
      };
    } catch {}
  }
  return snapshot;
}

function buildRPCS3MountedDiscSnapshot(discRoot = '') {
  const root = String(discRoot || '').trim();
  const snapshot = {};
  if (!root || !fs.existsSync(root)) return snapshot;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return snapshot;
  }
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const name = String(entry.name || '').trim();
    if (!name || name.toLowerCase() === 'shortcuts' || name === '＄locks') continue;
    const fullPath = path.join(root, name);
    try {
      const stat = fs.statSync(fullPath);
      snapshot[name] = {
        path: fullPath,
        mtimeMs: Number(stat.mtimeMs || 0),
      };
    } catch {}
  }
  return snapshot;
}

function readPS3ParamSfoMetadata(filePath = '') {
  const target = String(filePath || '').trim();
  if (!target || !fs.existsSync(target)) return null;
  try {
    const buffer = fs.readFileSync(target);
    if (buffer.length < 20) return null;
    if (buffer.toString('ascii', 0, 4) !== '\u0000PSF') return null;
    const keyTableStart = buffer.readUInt32LE(8);
    const dataTableStart = buffer.readUInt32LE(12);
    const entryCount = buffer.readUInt32LE(16);
    const out = {};
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = 20 + (index * 16);
      if (entryOffset + 16 > buffer.length) break;
      const keyOffset = buffer.readUInt16LE(entryOffset);
      const paramFmt = buffer.readUInt16LE(entryOffset + 2);
      const paramLen = buffer.readUInt32LE(entryOffset + 4);
      const dataOffset = buffer.readUInt32LE(entryOffset + 12);
      const keyStart = keyTableStart + keyOffset;
      if (keyStart >= buffer.length) continue;
      let keyEnd = keyStart;
      while (keyEnd < buffer.length && buffer[keyEnd] !== 0) keyEnd += 1;
      const key = buffer.toString('utf8', keyStart, keyEnd).trim();
      if (!key) continue;
      const valueStart = dataTableStart + dataOffset;
      const valueEnd = Math.min(buffer.length, valueStart + paramLen);
      if (valueStart >= buffer.length || valueEnd <= valueStart) continue;
      let value = '';
      if (paramFmt === 0x0204 || paramFmt === 0x0004) {
        value = buffer.toString('utf8', valueStart, valueEnd).replace(/\0+$/g, '').trim();
      } else if (paramLen === 4) {
        value = String(buffer.readUInt32LE(valueStart));
      } else if (paramLen === 8) {
        value = String(Number(buffer.readBigUInt64LE(valueStart)));
      } else {
        value = buffer.toString('hex', valueStart, valueEnd);
      }
      if (value) out[key] = value;
    }
    return {
      title: String(out.TITLE || '').trim(),
      titleId: String(out.TITLE_ID || '').trim(),
    };
  } catch {
    return null;
  }
}

function buildRPCS3InstalledTitleRecords(gameRoot = '') {
  const root = String(gameRoot || '').trim();
  if (!root || !fs.existsSync(root)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry?.isDirectory?.())
    .map((entry) => {
      const titleId = String(entry.name || '').trim();
      if (!titleId) return null;
      const fullPath = path.join(root, titleId);
      if (!isLaunchableRPCS3InstalledTitle(fullPath)) return null;
      const paramPath = path.join(fullPath, 'PARAM.SFO');
      const metadata = readPS3ParamSfoMetadata(paramPath) || null;
      let mtimeMs = 0;
      try { mtimeMs = Number(fs.statSync(fullPath).mtimeMs || 0); } catch {}
      return {
        titleId,
        path: fullPath,
        mtimeMs,
        title: String(metadata?.title || '').trim(),
        normalizedTitle: normalizeScanName(metadata?.title || titleId),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0));
}

function buildRPCS3LaunchLookupTerms(identifier, romPath) {
  const terms = [];
  const add = (value) => {
    const normalized = normalizeScanName(value);
    if (!normalized) return;
    if (!terms.includes(normalized)) terms.push(normalized);
  };
  const key = String(identifier || '').trim();
  if (db && key) {
    try {
      const row = db.prepare('SELECT title, install_dir FROM games WHERE identifier = ?').get(key);
      add(row?.title || '');
      if (row?.install_dir) add(path.basename(String(row.install_dir || '').replace(/[\\/]+$/, '')));
    } catch {}
  }
  const rawPath = String(romPath || '').trim();
  if (rawPath) {
    const baseName = path.basename(rawPath);
    const stem = baseName.replace(/\.[^.]+$/i, '');
    add(stem);
    add(parseRomFilename(stem).cleanName || stem);
  }
  add(key.replace(/\.[^.]+$/i, ''));
  add(parseRomFilename(String(key || '').replace(/\.[^.]+$/i, '')).cleanName || '');
  return terms;
}

function findMatchingRPCS3InstalledTitle(identifier, romPath) {
  const records = buildRPCS3InstalledTitleRecords(getManagedRPCS3GameRoot());
  if (!records.length) return null;
  const terms = buildRPCS3LaunchLookupTerms(identifier, romPath);
  if (!terms.length) return null;
  const exact = records.find(record => record.normalizedTitle && terms.includes(record.normalizedTitle));
  if (exact) return exact;
  const fuzzy = records.find((record) => {
    const target = String(record.normalizedTitle || '').trim();
    if (!target) return false;
    return terms.some(term => term.includes(target) || target.includes(term));
  });
  return fuzzy || null;
}

function pickRPCS3InstalledTitleCandidate(before = {}, after = {}) {
  const added = Object.entries(after)
    .filter(([titleId]) => !before[titleId])
    .map(([titleId, info]) => ({ titleId, ...info }))
    .sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0));
  if (added.length) return added[0];

  const changed = Object.entries(after)
    .filter(([titleId, info]) => before[titleId] && Number(info?.mtimeMs || 0) > Number(before[titleId]?.mtimeMs || 0))
    .map(([titleId, info]) => ({ titleId, ...info }))
    .sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0));
  if (changed.length) return changed[0];
  return null;
}

function pickRPCS3MountedTitleId(before = {}, after = {}) {
  const added = Object.entries(after)
    .filter(([titleId]) => !before[titleId])
    .map(([titleId, info]) => ({ titleId, ...info }))
    .sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0));
  if (added.length) return added[0].titleId;

  const current = Object.entries(after)
    .map(([titleId, info]) => ({ titleId, ...info }))
    .sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0));
  if (current.length === 1) return current[0].titleId;
  return '';
}

function rememberRPCS3InstalledTitle(identifier, candidate) {
  const key = String(identifier || '').trim();
  if (!key || !candidate?.path) return;
  const next = readRPCS3InstallMap();
  next[key] = {
    titleId: String(candidate.titleId || '').trim(),
    path: String(candidate.path || '').trim(),
    recordedAt: Date.now(),
  };
  writeRPCS3InstallMap(next);
}

function isRPCS3InstalledTitlePath(targetPath) {
  const normalized = path.resolve(String(targetPath || '').trim());
  if (!normalized) return false;
  const gameRoot = getManagedRPCS3GameRoot();
  if (!gameRoot) return false;
  const root = path.resolve(gameRoot);
  return normalized.toLowerCase() === root.toLowerCase()
    || normalized.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`);
}

function shouldAutoRelaunchRPCS3InstalledTitle(session, candidate) {
  const identifier = String(session?.identifier || '').trim();
  const targetPath = String(candidate?.path || '').trim();
  if (!identifier || !targetPath || !isLaunchableRPCS3InstalledTitle(targetPath)) return false;
  const launchedPath = String(session?.romPath || session?.sourcePath || '').trim();
  if (!launchedPath) return false;
  if (path.resolve(launchedPath).toLowerCase() === path.resolve(targetPath).toLowerCase()) return false;
  if (isRPCS3InstalledTitlePath(launchedPath)) return false;

  const previous = activeRPCS3AutoRelaunches.get(identifier) || null;
  const now = Date.now();
  if (previous?.targetPath && path.resolve(previous.targetPath).toLowerCase() === path.resolve(targetPath).toLowerCase() && (now - Number(previous.at || 0)) < 10 * 60 * 1000) {
    return false;
  }
  return true;
}

function maybeAutoRelaunchRPCS3InstalledTitle(session, candidate) {
  if (!shouldAutoRelaunchRPCS3InstalledTitle(session, candidate)) return;
  const identifier = String(session?.identifier || '').trim();
  const targetPath = String(candidate?.path || '').trim();
  const title = String(session?.title || candidate?.title || identifier || '').trim();
  activeRPCS3AutoRelaunches.set(identifier, { targetPath, at: Date.now() });
  publishEmulatorRuntimeProgress({
    percent: 98,
    stage: 'launching',
    message: 'Required PS3 game data installed. Launching game…',
  });
  promoteSkaldLaunchShield(10000);
  logRPCS3PkgAutomation(`auto-relaunch-scheduled identifier=${identifier} titleId=${candidate?.titleId || ''} path=${targetPath}`);
  setTimeout(() => {
    try {
      const result = emulatorManager.launchRPCS3Rom({
        romPath: targetPath,
        system: String(session?.system || 'ps3'),
        identifier,
        title,
      });
      logRPCS3PkgAutomation(`auto-relaunch-result identifier=${identifier} ok=${!!result?.ok} error=${String(result?.error || '').trim() || '<none>'}`);
    } catch (error) {
      logRPCS3PkgAutomation(`auto-relaunch-error identifier=${identifier} error=${error?.message || error}`);
    }
  }, 1200);
}

function resolvePreferredRPCS3LaunchPath(identifier, romPath) {
  const key = String(identifier || '').trim();
  if (!key) return String(romPath || '').trim();
  const current = readRPCS3InstallMap();
  const mapped = current[key];
  if (mapped?.path && isLaunchableRPCS3InstalledTitle(mapped.path)) {
    return String(mapped.path).trim();
  }
  if (mapped && (!mapped.path || !fs.existsSync(mapped.path))) {
    delete current[key];
    writeRPCS3InstallMap(current);
  }
  const discovered = findMatchingRPCS3InstalledTitle(key, romPath);
  if (discovered?.path && isLaunchableRPCS3InstalledTitle(discovered.path)) {
    rememberRPCS3InstalledTitle(key, discovered);
    return String(discovered.path).trim();
  }
  return String(romPath || '').trim();
}

function migrateInstalledGamesIntoSystemFolders() {
  if (!db) return { ok: false, error: 'Library database is not available.' };
  const settings = loadSettings();
  const gamesRoot = path.resolve(String(settings.installPath || DEFAULT_GAMES_DIR).trim() || DEFAULT_GAMES_DIR);
  ensureDir(gamesRoot);

  const rows = db.prepare(`
    SELECT identifier, install_dir, exe_path, system
    FROM games
    WHERE install_dir IS NOT NULL
      AND TRIM(install_dir) != ''
      AND system IS NOT NULL
      AND TRIM(system) != ''
  `).all();

  const updateStmt = db.prepare(`
    UPDATE games
    SET install_dir = ?, exe_path = ?, date_modified = ?
    WHERE identifier = ?
  `);

  const results = {
    ok: true,
    scanned: rows.length,
    migrated: 0,
    skipped: 0,
    errors: [],
    moves: [],
    gamesRoot,
  };

  const tx = db.transaction((entries) => {
    for (const row of entries) {
      const installDir = String(row.install_dir || '').trim();
      const system = String(row.system || '').trim();
      if (!installDir || !system || !fs.existsSync(installDir)) {
        results.skipped += 1;
        continue;
      }

      const sourcePath = path.resolve(installDir);
      const relFromRoot = path.relative(gamesRoot, sourcePath);
      if (!relFromRoot || relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
        results.skipped += 1;
        continue;
      }

      const targetSystemRoot = path.resolve(resolveSystemStorageRoot(gamesRoot, system));
      const relFromSystemRoot = path.relative(targetSystemRoot, sourcePath);
      if (!relFromSystemRoot.startsWith('..') && !path.isAbsolute(relFromSystemRoot)) {
        results.skipped += 1;
        continue;
      }

      ensureDir(targetSystemRoot);
      const targetPath = resolveUniquePath(path.join(targetSystemRoot, path.basename(sourcePath)));

      try {
        fs.renameSync(sourcePath, targetPath);
        let nextExePath = row.exe_path || null;
        if (nextExePath) {
          const exeRel = path.relative(sourcePath, path.resolve(String(nextExePath)));
          if (!exeRel.startsWith('..') && !path.isAbsolute(exeRel)) {
            nextExePath = path.join(targetPath, exeRel);
          }
        }
        updateStmt.run(targetPath, nextExePath, Date.now(), row.identifier);
        results.migrated += 1;
        results.moves.push({
          identifier: row.identifier,
          system,
          from: sourcePath,
          to: targetPath,
        });
      } catch (error) {
        results.errors.push({
          identifier: row.identifier,
          system,
          from: sourcePath,
          to: targetPath,
          error: error?.message || String(error),
        });
      }
    }
  });

  tx(rows);
  if (results.errors.length) results.ok = false;
  return results;
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
  const ROM_EXTS       = new Set(['.sfc', '.smc', '.snes', '.nes', '.gba', '.gbc', '.gb', '.md', '.gen', '.smd', '.n64', '.z64', '.v64', '.nds', '.pce', '.chd', '.cue', '.bin', '.img', '.zip', '.iso', '.cso', '.pbp', '.pkg', '.self', '.elf']);
  const visitedDirs    = new Set();
  const MAX_SCAN_DEPTH = 5;

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

  function hasPs3GameMarker(dirPath) {
    try {
      const directEboot = path.join(dirPath, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN');
      const directParam = path.join(dirPath, 'PS3_GAME', 'PARAM.SFO');
      const nestedEboot = path.join(dirPath, 'USRDIR', 'EBOOT.BIN');
      const nestedParam = path.join(dirPath, 'PARAM.SFO');
      return fs.existsSync(directEboot) || fs.existsSync(directParam) || fs.existsSync(nestedEboot) || fs.existsSync(nestedParam);
    } catch {
      return false;
    }
  }

  function hasDirectRomFile(dirPath) {
    try {
      const dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
      return dirEntries.some(entry => entry.isFile() && ROM_EXTS.has(path.extname(entry.name).toLowerCase()));
    } catch {
      return false;
    }
  }

  function registerFoundInstall({ entryPath, entryNameForMatch, matchedId, matchedBy, matchedTitle, matchConfidence, installTarget, exePath }) {
    const identifier = matchedId || buildLocalIdentifier(entryNameForMatch, entryPath);
    const displayTitle = matchedTitle || entryNameForMatch;
    const sourceType = matchedId ? 'catalog_import' : 'local_scan';
    const effectiveSystem = system || inferDetectedSystem({ entryPath, installTarget, exePath }) || null;
    const existing = db.prepare('SELECT install_dir, system FROM games WHERE identifier = ?').get(identifier);
    if (existing?.install_dir && fs.existsSync(existing.install_dir) && (existing.system || !effectiveSystem)) return;

    db.prepare(`
      INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)
    `).run(identifier, Date.now());
    db.prepare(`
      UPDATE games
      SET install_dir = ?, exe_path = ?, title = ?, system = ?, source_type = ?, provider = COALESCE(provider, ?), catalog_identifier = ?, match_confidence = ?, date_modified = ?
      WHERE identifier = ?
    `).run(installTarget, exePath, displayTitle, effectiveSystem, sourceType, sourceType === 'catalog_import' ? 'archiveorg' : 'local', matchedId || null, matchConfidence || 0, Date.now(), identifier);

    console.log(`[scan] Found ${matchedId ? 'catalog-linked' : 'local'} install (${matchedBy || 'filename'}): ${identifier} → ${installTarget}`);
    found.push({
      identifier,
      installDir: installTarget,
      exePath,
      matchedBy: matchedBy || 'filename',
      title: displayTitle,
      catalogIdentifier: matchedId || null,
      system: effectiveSystem || '',
      matchConfidence: matchConfidence || 0,
      sourceType,
    });
  }

  function inferDetectedSystem({ entryPath, installTarget, exePath }) {
    const normalizedPath = String(installTarget || entryPath || '').trim();
    if (!normalizedPath) return '';
    try {
      if (hasPs3GameMarker(normalizedPath)) return 'ps3';
      const stat = fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath) : null;
      if (stat?.isFile()) {
        const ext = path.extname(normalizedPath).toLowerCase();
        if (['.pkg', '.self', '.elf'].includes(ext)) return 'ps3';
      }
      if (exePath) return '';
    } catch {
      return '';
    }
    return '';
  }

  function walkDirectory(dirPath, depth = 0) {
    if (depth > MAX_SCAN_DEPTH) return;
    const normalizedDir = path.resolve(dirPath);
    if (visitedDirs.has(normalizedDir)) return;
    visitedDirs.add(normalizedDir);

    let dirEntries;
    try {
      dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      const entryPath = path.join(dirPath, entry.name);
      const entryNameForMatch = entry.isFile() ? path.parse(entry.name).name : entry.name;
      const { matchedId, matchedBy, matchedTitle, matchConfidence } = matchEntryName(entryNameForMatch);

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ROM_EXTS.has(ext)) continue;
        registerFoundInstall({
          entryPath,
          entryNameForMatch,
          matchedId,
          matchedBy,
          matchedTitle,
          matchConfidence,
          installTarget: entryPath,
          exePath: null,
        });
        continue;
      }

      if (!entry.isDirectory()) continue;

      const exes = findExesInDir(entryPath);
      const exePath = exes.length === 1 ? exes[0] : null;
      const isRecognizedGameDir = !!exePath || hasPs3GameMarker(entryPath) || hasDirectRomFile(entryPath) || !!matchedId;

      if (isRecognizedGameDir) {
        registerFoundInstall({
          entryPath,
          entryNameForMatch,
          matchedId,
          matchedBy,
          matchedTitle,
          matchConfidence,
          installTarget: entryPath,
          exePath,
        });
      }

      walkDirectory(entryPath, depth + 1);
    }
  }

  for (const entry of entries) {
    const entryPath = path.join(scanDir, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(entryPath, 0);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ROM_EXTS.has(ext)) continue;
      const entryNameForMatch = path.parse(entry.name).name;
      const { matchedId, matchedBy, matchedTitle, matchConfidence } = matchEntryName(entryNameForMatch);
      registerFoundInstall({
        entryPath,
        entryNameForMatch,
        matchedId,
        matchedBy,
        matchedTitle,
        matchConfidence,
        installTarget: entryPath,
        exePath: null,
      });
    }
  }

  return { found };
});

// ─── Install / Delete ─────────────────────────────────────────────────────────

ipcMain.handle('install-game', (_, { identifier, installDir, exePath, title = null, system = null, sourceType = 'marketplace_download', provider = null, catalogIdentifier = null, matchConfidence = 1 }) => {
  return installGameRecord({ identifier, installDir, exePath, title, system, sourceType, provider, catalogIdentifier, matchConfidence });
});

ipcMain.handle('marketplace-install', async (event, payload) => marketplaceInstallJob(event, payload));
ipcMain.handle('migrate-system-install-folders', () => migrateInstalledGamesIntoSystemFolders());

ipcMain.handle('set-exe-path', (_, { identifier, exePath }) => {
  if (!db) return { ok: false };
  ensureGameRow(identifier);
  db.prepare('UPDATE games SET exe_path = ?, date_modified = ? WHERE identifier = ?').run(exePath || null, Date.now(), identifier);
  return { ok: true };
});

ipcMain.handle('delete-game', async (_, { identifier, installDir }) => {
  try {
    console.log(`[delete] identifier=${identifier} installDir=${installDir}`);
    const existing = db ? db.prepare('SELECT install_dir, source_type, system FROM games WHERE identifier = ?').get(identifier) : null;
    const sourceType = existing?.source_type || null;
    const system = existing?.system || '';
    const effectiveInstallDir = existing?.install_dir || installDir;
    if (effectiveInstallDir) {
      if (sourceType === 'local_scan') {
        console.log(`[delete] Local scan entry detected — removing from library only: ${effectiveInstallDir}`);
      } else if (effectiveInstallDir && fs.existsSync(effectiveInstallDir)) {
        const deleteTarget = resolveManagedGameDeleteTarget(effectiveInstallDir, system);
        if (!deleteTarget) {
          console.warn(`[delete] Refusing to delete root/system folder for ${effectiveInstallDir}`);
        } else if (!fs.existsSync(deleteTarget)) {
          console.log(`[delete] Resolved delete target missing on disk: ${deleteTarget}`);
        } else {
        // Use shell.trashItem to move to Recycle Bin — avoids EPERM on locked folders
        // and is safer than force-deleting since the user can recover files if needed.
          await shell.trashItem(deleteTarget);
          console.log(`[delete] Moved to Recycle Bin: ${deleteTarget}`);
        }
      } else {
        console.log(`[delete] Folder not found on disk (already gone?): ${effectiveInstallDir}`);
      }
    } else {
      console.log(`[delete] No installDir provided — only clearing DB entry`);
    }
    if (identifier) {
      const installMap = readRPCS3InstallMap();
      if (installMap[identifier]) {
        delete installMap[identifier];
        writeRPCS3InstallMap(installMap);
      }
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
    latestUpdaterState = {
      ...latestUpdaterState,
      status: 'dev',
      currentVersion: app.getVersion(),
      message: 'Update checks are disabled in development builds.',
      checkedAt: Date.now(),
    };
    return;
  }

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.error('[updater] electron-updater not available:', e.message);
    latestUpdaterState = {
      ...latestUpdaterState,
      status: 'error',
      currentVersion: app.getVersion(),
      message: e.message || 'electron-updater is not available.',
      checkedAt: Date.now(),
    };
    return;
  }

  autoUpdater.autoDownload         = false; // don't auto-download — GitHub releases don't report progress
  autoUpdater.allowDowngrade        = false;
  autoUpdater.allowPrerelease        = /\d+\.\d+\.\d+-/.test(app.getVersion());

  const publishUpdaterState = (next = {}) => {
    latestUpdaterState = {
      ...latestUpdaterState,
      currentVersion: app.getVersion(),
      checkedAt: Date.now(),
      ...next,
    };
    const payload = { ...latestUpdaterState };
    mainWindow?.webContents.send('updater-status', payload);
    bladesWindow?.webContents.send('updater-status', payload);
  };

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update…');
    publishUpdaterState({ status: 'checking', message: 'Checking for updates…' });
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
      publishUpdaterState({
        status:       'available',
        version:      info.version,
        releaseNotes: releaseNotes || null,
        releaseDate:  info.releaseDate || null,
        message:      `SKALD Launcher v${info.version} is available.`,
      });
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Up to date.');
    publishUpdaterState({ status: 'current', version: app.getVersion(), message: 'SKALD is up to date.' });
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
    publishUpdaterState({
      status:  'error',
      message: msg,
    });
  });

  // Check after the window is ready so the user sees the UI first
  mainWindow?.once('ready-to-show', () => {
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
  });
  updaterCheckNow = () => autoUpdater.checkForUpdates();

}  

// IPC: renderer asks to download update — always registered, opens GitHub releases page
ipcMain.removeHandler('updater-status-get');
ipcMain.handle('updater-status-get', () => ({ ...latestUpdaterState, currentVersion: app.getVersion() }));

ipcMain.removeHandler('updater-check');
ipcMain.handle('updater-check', async () => {
  if (!app.isPackaged || typeof updaterCheckNow !== 'function') {
    latestUpdaterState = {
      ...latestUpdaterState,
      status: app.isPackaged ? 'unavailable' : 'dev',
      currentVersion: app.getVersion(),
      message: app.isPackaged ? 'Update checking is not ready yet.' : 'Update checks are disabled in development builds.',
      checkedAt: Date.now(),
    };
    return { ok: false, state: latestUpdaterState };
  }
  try {
    await updaterCheckNow();
    return { ok: true, state: latestUpdaterState };
  } catch (error) {
    latestUpdaterState = {
      ...latestUpdaterState,
      status: 'error',
      currentVersion: app.getVersion(),
      message: error?.message || 'Could not check for updates.',
      checkedAt: Date.now(),
    };
    return { ok: false, state: latestUpdaterState };
  }
});

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
    catalogUrl: 'https://ia802803.us.archive.org/view_archive.php?archive=/17/items/ni-roms/roms/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System.zip',
  },
  genesis: {
    label: 'Sega Genesis',
    archivePath: 'roms/Sega%20-%20Mega%20Drive%20-%20Genesis.zip',
    downloadBase: 'https://archive.org/download/ni-roms/roms/Sega%20-%20Mega%20Drive%20-%20Genesis.zip/',
    catalogUrl: 'https://ia802803.us.archive.org/view_archive.php?archive=/17/items/ni-roms/roms/Sega%20-%20Mega%20Drive%20-%20Genesis.zip',
  },
  psx: {
    label: 'PlayStation',
    // PSX uses multiple archive.org items — downloadUrl is per-ROM in the JSON
    archivePath: null,
    downloadBase: null,
  },
  ps2: {
    label: 'PlayStation 2',
    archivePath: null,
    downloadBase: null,
  },
  ps3: {
    label: 'PlayStation 3',
    archivePath: null,
    downloadBase: null,
  },
  psp: {
    label: 'PSP',
    archivePath: null,
    downloadBase: null,
  },
  dc: {
    label: 'Sega Dreamcast',
    archivePath: null,
    downloadBase: null,
  },
  xbox: {
    label: 'Xbox',
    archivePath: null,
    downloadBase: null,
  },
  x360: {
    label: 'Xbox 360',
    archivePath: null,
    downloadBase: null,
  },
};
const LIVE_ARCHIVE_SYSTEM_SOURCES = Object.freeze({
  ps2: {
    extensions: ['.chd'],
    urls: [
      'https://archive.org/download/sony-playstation-2-0-redump-collection/',
      'https://archive.org/download/sony-playstation-2-a-redump-collection/',
      'https://archive.org/download/sony-playstation-2-b-redump-collection/',
      'https://archive.org/download/sony-playstation-2-c-redump-collection/',
      'https://archive.org/download/sony-playstation-2-d0-dm-redump-collection/',
      'https://archive.org/download/sony-playstation-2-dn-dz-redump-collection/',
      'https://archive.org/download/sony-playstation-2-e-redump-collection/',
      'https://archive.org/download/sony-playstation-2-f-redump-collection/',
      'https://archive.org/download/sony-playstation-2-g-redump-collection/',
      'https://archive.org/download/sony-playstation-2-h-redump-collection/',
      'https://archive.org/download/sony-playstation-2-i-redump-collection/',
      'https://archive.org/download/sony-playstation-2-j-redump-collection/',
      'https://archive.org/download/sony-playstation-2-k-redump-collection/',
      'https://archive.org/download/sony-playstation-2-l-redump-collection/',
      'https://archive.org/download/sony-playstation-2-m0-mm-redump-collection/',
      'https://archive.org/download/sony-playstation-2-mn-mz-redump-collection/',
      'https://archive.org/download/sony-playstation-2-n-redump-collection/',
      'https://archive.org/download/sony-playstation-2-o0-om-redump-collection/',
      'https://archive.org/download/sony-playstation-2-on-oz-redump-collection/',
      'https://archive.org/download/sony-playstation-2-p-redump-collection/',
      'https://archive.org/download/sony-playstation-2-q-redump-collection/',
      'https://archive.org/download/sony-playstation-2-r-redump-collection/',
      'https://archive.org/download/sony-playstation-2-s0-sh-redump-collection/',
      'https://archive.org/download/sony-playstation-2-si-so-redump-collection/',
      'https://archive.org/download/sony-playstation-2-sr-sz-redump-collection/',
      'https://archive.org/download/sony-playstation-2-t-redump-collection/',
      'https://archive.org/download/sony-playstation-2-u-redump-collection/',
      'https://archive.org/download/sony-playstation-2-v-redump-collection/',
      'https://archive.org/download/sony-playstation-2-w-redump-collection/',
      'https://archive.org/download/sony-playstation-2-x-redump-collection/',
      'https://archive.org/download/sony-playstation-2-y-redump-collection/',
      'https://archive.org/download/sony-playstation-2-z-redump-collection/',
    ],
  },
  ps3: {
    referer: 'https://archive.org/details/sony_playstation3_a_part1',
    extensions: ['.zip', '.pkg', '.iso'],
    urls: [
      'https://archive.org/download/sony_playstation3_a_part1/',
      'https://archive.org/download/sony_playstation3_a_part2/',
      'https://archive.org/download/sony_playstation3_a_part3/',
      'https://archive.org/download/sony_playstation3_b_part1/',
      'https://archive.org/download/sony_playstation3_b_part2/',
      'https://archive.org/download/sony_playstation3_b_part3/',
      'https://archive.org/download/sony_playstation3_c_part1/',
      'https://archive.org/download/sony_playstation3_c_part2/',
      'https://archive.org/download/sony_playstation3_c_part3/',
      'https://archive.org/download/sony_playstation3_d_part1/',
      'https://archive.org/download/sony_playstation3_d_part2/',
      'https://archive.org/download/sony_playstation3_d_part3/',
      'https://archive.org/download/sony_playstation3_d_part4/',
      'https://archive.org/download/sony_playstation3_d_part5/',
      'https://archive.org/download/sony_playstation3_e/',
      'https://archive.org/download/sony_playstation3_f_part1/',
      'https://archive.org/download/sony_playstation3_f_part2/',
      'https://archive.org/download/sony_playstation3_f_part3/',
      'https://archive.org/download/sony_playstation3_g_part1/',
      'https://archive.org/download/sony_playstation3_g_part2/',
      'https://archive.org/download/sony_playstation3_g_part3/',
      'https://archive.org/download/sony_playstation3_h_part1/',
      'https://archive.org/download/sony_playstation3_h_part2/',
      'https://archive.org/download/sony_playstation3_i/',
      'https://archive.org/download/sony_playstation3_j/',
      'https://archive.org/download/sony_playstation3_k/',
      'https://archive.org/download/sony_playstation3_l_part1/',
      'https://archive.org/download/sony_playstation3_l_part2/',
      'https://archive.org/download/sony_playstation3_l_part3/',
      'https://archive.org/download/sony_playstation3_m_part1/',
      'https://archive.org/download/sony_playstation3_m_part2/',
      'https://archive.org/download/sony_playstation3_m_part3/',
      'https://archive.org/download/sony_playstation3_m_part4/',
      'https://archive.org/download/sony_playstation3_m_part5/',
      'https://archive.org/download/sony_playstation3_n_part1/',
      'https://archive.org/download/sony_playstation3_n_part2/',
      'https://archive.org/download/sony_playstation3_n_part3/',
      'https://archive.org/download/sony_playstation3_o_part1/',
      'https://archive.org/download/sony_playstation3_o_part2/',
      'https://archive.org/download/sony_playstation3_o_part3/',
      'https://archive.org/download/sony_playstation3_p_part1/',
      'https://archive.org/download/sony_playstation3_p_part2/',
      'https://archive.org/download/sony_playstation3_q/',
      'https://archive.org/download/sony_playstation3_r_part1/',
      'https://archive.org/download/sony_playstation3_r_part2/',
      'https://archive.org/download/sony_playstation3_r_part3/',
      'https://archive.org/download/sony_playstation3_r_part4/',
      'https://archive.org/download/sony_playstation3_s_part1/',
      'https://archive.org/download/sony_playstation3_s_part2/',
      'https://archive.org/download/sony_playstation3_s_part3/',
      'https://archive.org/download/sony_playstation3_s_part4/',
      'https://archive.org/download/sony_playstation3_s_part5/',
      'https://archive.org/download/sony_playstation3_s_part6/',
      'https://archive.org/download/sony_playstation3_t_part1/',
      'https://archive.org/download/sony_playstation3_t_part2/',
      'https://archive.org/download/sony_playstation3_t_part3/',
      'https://archive.org/download/sony_playstation3_t_part4/',
      'https://archive.org/download/sony_playstation3_u_part1/',
      'https://archive.org/download/sony_playstation3_u_part2/',
      'https://archive.org/download/sony_playstation3_v/',
      'https://archive.org/download/sony_playstation3_w_part1/',
      'https://archive.org/download/sony_playstation3_w_part2/',
      'https://archive.org/download/sony_playstation3_x/',
      'https://archive.org/download/sony_playstation3_y/',
      'https://archive.org/download/sony_playstation3_z/',
    ],
  },
  psp: {
    referer: 'https://archive.org/details/psp-chd-zstd-redump-part1',
    extensions: ['.chd'],
    urls: [
      'https://archive.org/download/psp-chd-zstd-redump-part1/psp-chd-zstd/',
      'https://archive.org/download/psp-chd-zstd-redump-part2/psp-chd-zstd/',
    ],
  },
  dc: {
    referer: 'https://archive.org/details/dc-chd-zstd-redump',
    extensions: ['.chd'],
    urls: [
      'https://archive.org/download/dc-chd-zstd-redump/dc-chd-zstd/',
    ],
  },
  xbox: {
    referer: 'https://archive.org/details/microsoft_xbox_numberssymbols',
    extensions: ['.zip'],
    urls: [
      'https://archive.org/download/microsoft_xbox_numberssymbols/',
      'https://archive.org/download/microsoft_xbox_a/',
      'https://archive.org/download/microsoft_xbox_b/',
      'https://archive.org/download/microsoft_xbox_c_part1/',
      'https://archive.org/download/microsoft_xbox_c_part2/',
      'https://archive.org/download/microsoft_xbox_d_part1/',
      'https://archive.org/download/microsoft_xbox_d_part2/',
      'https://archive.org/download/microsoft_xbox_e/',
      'https://archive.org/download/microsoft_xbox_f/',
      'https://archive.org/download/microsoft_xbox_g/',
      'https://archive.org/download/microsoft_xbox_h/',
      'https://archive.org/download/microsoft_xbox_i/',
      'https://archive.org/download/microsoft_xbox_j/',
      'https://archive.org/download/microsoft_xbox_k/',
      'https://archive.org/download/microsoft_xbox_l/',
      'https://archive.org/download/microsoft_xbox_m_part1/',
      'https://archive.org/download/microsoft_xbox_m_part2/',
      'https://archive.org/download/microsoft_xbox_n_part1/',
      'https://archive.org/download/microsoft_xbox_n_part2/',
      'https://archive.org/download/microsoft_xbox_o_part1/',
      'https://archive.org/download/microsoft_xbox_o_part2/',
      'https://archive.org/download/microsoft_xbox_p/',
      'https://archive.org/download/microsoft_xbox_q/',
      'https://archive.org/download/microsoft_xbox_r/',
      'https://archive.org/download/microsoft_xbox_s_part1/',
      'https://archive.org/download/microsoft_xbox_s_part2/',
      'https://archive.org/download/microsoft_xbox_t_part1/',
      'https://archive.org/download/microsoft_xbox_t_part2/',
      'https://archive.org/download/microsoft_xbox_u/',
      'https://archive.org/download/microsoft_xbox_v/',
      'https://archive.org/download/microsoft_xbox_w/',
      'https://archive.org/download/microsoft_xbox_x/',
      'https://archive.org/download/microsoft_xbox_y/',
      'https://archive.org/download/microsoft_xbox_z/',
    ],
  },
  x360: {
    referer: 'https://archive.org/details/microsoft_xbox360_numberssymbols',
    extensions: ['.zip'],
    urls: [
      'https://archive.org/download/microsoft_xbox360_numberssymbols/',
      'https://archive.org/download/microsoft_xbox360_a_part1/',
      'https://archive.org/download/microsoft_xbox360_a_part2/',
      'https://archive.org/download/microsoft_xbox360_b_part1/',
      'https://archive.org/download/microsoft_xbox360_b_part2/',
      'https://archive.org/download/microsoft_xbox360_c_part1/',
      'https://archive.org/download/microsoft_xbox360_c_part2/',
      'https://archive.org/download/microsoft_xbox360_d_part1/',
      'https://archive.org/download/microsoft_xbox360_d_part2/',
      'https://archive.org/download/microsoft_xbox360_d_part3/',
      'https://archive.org/download/microsoft_xbox360_e/',
      'https://archive.org/download/microsoft_xbox360_f_part1/',
      'https://archive.org/download/microsoft_xbox360_f_part2/',
      'https://archive.org/download/microsoft_xbox360_g/',
      'https://archive.org/download/microsoft_xbox360_h/',
      'https://archive.org/download/microsoft_xbox360_i/',
      'https://archive.org/download/microsoft_xbox360_j/',
      'https://archive.org/download/microsoft_xbox360_k/',
      'https://archive.org/download/microsoft_xbox360_l/',
      'https://archive.org/download/microsoft_xbox360_m_part1/',
      'https://archive.org/download/microsoft_xbox360_m_part2/',
      'https://archive.org/download/microsoft_xbox360_n_part1/',
      'https://archive.org/download/microsoft_xbox360_n_part2/',
      'https://archive.org/download/microsoft_xbox360_o/',
      'https://archive.org/download/microsoft_xbox360_p/',
      'https://archive.org/download/microsoft_xbox360_q/',
      'https://archive.org/download/microsoft_xbox360_r/',
      'https://archive.org/download/microsoft_xbox360_s_part1/',
      'https://archive.org/download/microsoft_xbox360_s_part2/',
      'https://archive.org/download/microsoft_xbox360_t_part1/',
      'https://archive.org/download/microsoft_xbox360_t_part2/',
      'https://archive.org/download/microsoft_xbox360_u/',
      'https://archive.org/download/microsoft_xbox360_v/',
      'https://archive.org/download/microsoft_xbox360_w/',
      'https://archive.org/download/microsoft_xbox360_x_part1/',
      'https://archive.org/download/microsoft_xbox360_x_part2/',
      'https://archive.org/download/microsoft_xbox360_y/',
      'https://archive.org/download/microsoft_xbox360_z/',
    ],
  },
});

const romListCache = {};
const MARKETPLACE_PROVIDERS = {
  archiveorg: {
    id: 'archiveorg',
    name: 'Archive.org',
    status: 'active',
    systems: ['snes', 'genesis', 'psx', 'ps2', 'ps3', 'psp', 'dc', 'xbox', 'x360'],
  },
};

function romListCacheKey(provider, system) {
  return `${provider}::${system}`;
}
async function loadArchiveOrgLiveRomList(system) {
  const config = LIVE_ARCHIVE_SYSTEM_SOURCES[String(system || '').toLowerCase()];
  if (!config) return { ok: false, error: `No live Archive.org source configured for ${system}.`, provider: 'archiveorg' };
  const normalizedSystem = String(system || '').toLowerCase();
  const cacheKey = romListCacheKey('archiveorg', normalizedSystem);
  let diskCached = loadRomDiskCache(normalizedSystem);
  if (normalizedSystem === 'ps3' && Array.isArray(diskCached) && diskCached.length) {
    diskCached = await filterPs3CatalogByDiscKeys(diskCached);
    saveRomDiskCache(normalizedSystem, diskCached);
  }
  if (normalizedSystem === 'x360' || normalizedSystem === 'xbox') {
    console.log(`[${normalizedSystem}-catalog] disk cache entries:`, Array.isArray(diskCached) ? diskCached.length : 0);
  }
  if (Array.isArray(diskCached) && diskCached.length) {
    romListCache[cacheKey] = diskCached;
  }
  try {
    if (normalizedSystem === 'x360' || normalizedSystem === 'xbox' || normalizedSystem === 'ps3') {
      const manifestPages = await Promise.all((config.urls || []).map(async (url) => {
        const itemId = archiveItemIdFromUrl(url);
        const manifestUrl = itemId ? `${url}${itemId}_files.xml` : '';
        if (!manifestUrl) return [];
        const manifestXml = await fetchArchiveText(manifestUrl, archiveDownloadReferer(url));
        return parseArchiveFilesXml(manifestXml, {
          extensions: config.extensions || ['.zip'],
          system: normalizedSystem,
          provider: 'archiveorg',
          sourceUrl: url,
        });
      }));
      let manifestRoms = manifestPages.flat();
      if (normalizedSystem === 'ps3') {
        manifestRoms = await filterPs3CatalogByDiscKeys(manifestRoms);
      }
      console.log(`[${normalizedSystem}-catalog] manifest entries:`, manifestRoms.length);
      console.log(`[${normalizedSystem}-catalog] first manifest entries:`, manifestRoms.slice(0, 8).map(r => r?.name).filter(Boolean));
      if (manifestRoms.length) {
        romListCache[cacheKey] = manifestRoms;
        saveRomDiskCache(normalizedSystem, manifestRoms);
        return { ok: true, roms: manifestRoms, cached: false, source: 'archive.org-manifest', provider: 'archiveorg' };
      }
    }
    const pages = await Promise.all(config.urls.map(url => fetchArchiveText(url, config.referer || archiveDownloadReferer(url))));
    if (normalizedSystem === 'x360' || normalizedSystem === 'xbox' || normalizedSystem === 'ps3' || normalizedSystem === 'genesis') {
      pages.forEach((html, idx) => {
        const sample = String(html || '').slice(0, 400).replace(/\s+/g, ' ').trim();
        console.log(`[${normalizedSystem}-catalog] page ${idx} length:`, String(html || '').length);
        console.log(`[${normalizedSystem}-catalog] page ${idx} sample:`, sample);
      });
    }
    const merged = pages.flatMap((html, sourceIdx) => parseArchiveDirectoryHtml(html, {
      extensions: config.extensions || ['.chd'],
      system: normalizedSystem,
      provider: 'archiveorg',
      sourceUrl: config.urls[sourceIdx],
    }));
    const filteredMerged = normalizedSystem === 'ps3'
      ? await filterPs3CatalogByDiscKeys(merged)
      : merged;
    filteredMerged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!filteredMerged.length && Array.isArray(diskCached) && diskCached.length) {
      console.warn(`[live-rom-cache] using cached ${normalizedSystem} catalog because fresh parse returned 0 entries`);
      return { ok: true, roms: diskCached, cached: true, source: 'disk-cache', provider: 'archiveorg' };
    }
    if (normalizedSystem === 'x360' || normalizedSystem === 'xbox' || normalizedSystem === 'ps3') {
      console.log(`[${normalizedSystem}-catalog] urls:`, config.urls.length);
      console.log(`[${normalizedSystem}-catalog] parsed entries:`, filteredMerged.length);
      console.log(`[${normalizedSystem}-catalog] first entries:`, filteredMerged.slice(0, 8).map(r => r?.name).filter(Boolean));
    }
    romListCache[cacheKey] = filteredMerged;
    saveRomDiskCache(normalizedSystem, filteredMerged);
    return { ok: true, roms: filteredMerged, cached: false, source: 'archive.org', provider: 'archiveorg' };
  } catch (e) {
    return { ok: false, error: e.message || `Failed to load ${normalizedSystem.toUpperCase()} catalog.`, provider: 'archiveorg' };
  }
}

async function loadArchiveOrgRomList(system) {
  if (LIVE_ARCHIVE_SYSTEM_SOURCES[String(system || '').toLowerCase()]) {
    return loadArchiveOrgLiveRomList(system);
  }
  const cacheKey = romListCacheKey('archiveorg', system);
  if (romListCache[cacheKey]) {
    return { ok: true, roms: romListCache[cacheKey], cached: true, source: 'memory', provider: 'archiveorg' };
  }

  const romsFileName = `roms-${system}.json`;
  const devPath      = path.join(__dirname, '../../assets/roms', romsFileName);
  const packedPath   = path.join(process.resourcesPath || '', 'roms', romsFileName);
  const romsPath     = fs.existsSync(devPath) ? devPath : packedPath;
  const config       = SYSTEM_CONFIGS[String(system || '').toLowerCase()];

  if (!fs.existsSync(romsPath) && config?.catalogUrl && config?.downloadBase) {
    try {
      const html = await fetchArchiveText(config.catalogUrl, archiveDownloadReferer(config.downloadBase));
      const roms = parseViewArchiveHtml(html, config.downloadBase).map(rom => ({
        ...rom,
        system: String(system || '').toLowerCase(),
        provider: 'archiveorg',
      }));
      console.log(`[marketplace-fetch-catalog] archiveorg loaded ${roms.length} ROMs from live view_archive for ${system}`);
      romListCache[cacheKey] = roms;
      saveRomDiskCache(String(system || '').toLowerCase(), roms);
      return { ok: true, roms, cached: false, source: 'archive.org', provider: 'archiveorg' };
    } catch (e) {
      return { ok: false, error: e.message || `Failed to load ${String(system || '').toUpperCase()} catalog.`, provider: 'archiveorg' };
    }
  }

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

async function fetchMarketplaceCatalog(provider, system) {
  if (provider === 'archiveorg') return await loadArchiveOrgRomList(system);
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

function parseArchiveDirectoryHtml(html, { extensions = ['.zip'], system = '', provider = 'archiveorg', sourceUrl = '' } = {}) {
  const roms = [];
  let restrictedFallbackCount = 0;
  const allowed = new Set(extensions.map(ext => String(ext || '').toLowerCase()));
  const baseHrefMatch = String(html || '').match(/<base\s+href="([^"]+)"/i);
  let resolvedBaseHref = '';
  if (baseHrefMatch?.[1]) {
    try {
      resolvedBaseHref = new URL(baseHrefMatch[1], sourceUrl || 'https://archive.org').toString();
    } catch {}
  }
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const inner = trMatch[1];
    const linkRe = /<td[^>]*><a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/i;
    const linkMatch = linkRe.exec(inner);
    const firstCellMatch = inner.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    const href    = linkMatch?.[1] || '';
    const rawName = decodeHtmlEntities((linkMatch?.[2] || firstCellMatch?.[1] || '').replace(/<[^>]+>/g, '').trim());
    const lowerName = String(rawName || '').toLowerCase();
    if (!rawName || ![...allowed].some(ext => lowerName.endsWith(ext))) continue;
    if (rawName === '../' || rawName === 'Parent Directory') continue;
    const tdRe = /<td[^>]*>(.*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRe.exec(inner)) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    const timestamp = cells.length >= 2 ? (cells[cells.length - 2] || '') : (cells[1] || '');
    const sizeRaw   = cells.length >= 1 ? (cells[cells.length - 1] || '') : '';
    let downloadUrl = href.startsWith('//') ? 'https:' + href : href;
    if (!downloadUrl) {
      try {
        downloadUrl = new URL(encodeURIComponent(rawName), resolvedBaseHref || sourceUrl || 'https://archive.org').toString();
      } catch {}
    } else if (downloadUrl.startsWith('/')) {
      try {
        const base = new URL(sourceUrl || 'https://archive.org');
        downloadUrl = `${base.protocol}//${base.host}${downloadUrl}`;
      } catch {}
    } else if (!/^https?:\/\//i.test(downloadUrl)) {
      try {
        downloadUrl = new URL(downloadUrl, resolvedBaseHref || sourceUrl || 'https://archive.org').toString();
      } catch {}
    }
    const { cleanName, region, tags } = parseRomFilename(rawName);
    const sizeBytes = parseSizeString(sizeRaw) || parseInt(sizeRaw, 10) || 0;
    const size = sizeBytes ? formatSizeMain(sizeBytes) : '';
    roms.push({ name: rawName, cleanName, region, tags, size, sizeBytes, timestamp, downloadUrl, system, provider });
  }
  if (!roms.length && String(html || '').includes('directory-listing-table')) {
    const restrictedRowRe = /<td[^>]*>([^<]+\.[A-Za-z0-9]{2,5})<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/gi;
    let rowMatch;
    while ((rowMatch = restrictedRowRe.exec(html)) !== null) {
      const rawName = decodeHtmlEntities(String(rowMatch[1] || '').trim());
      const lowerName = rawName.toLowerCase();
      if (!rawName || ![...allowed].some(ext => lowerName.endsWith(ext))) continue;
      if (rawName === '../' || rawName === 'Parent Directory') continue;
      const timestamp = String(rowMatch[2] || '').trim();
      const sizeRaw = String(rowMatch[3] || '').trim();
      let downloadUrl = '';
      try {
        downloadUrl = new URL(encodeURIComponent(rawName), resolvedBaseHref || sourceUrl || 'https://archive.org').toString();
      } catch {}
      const { cleanName, region, tags } = parseRomFilename(rawName);
      const sizeBytes = parseSizeString(sizeRaw) || parseInt(sizeRaw, 10) || 0;
      const size = sizeBytes ? formatSizeMain(sizeBytes) : '';
      roms.push({ name: rawName, cleanName, region, tags, size, sizeBytes, timestamp, downloadUrl, system, provider });
      restrictedFallbackCount += 1;
    }
  }
  if (!roms.length && String(html || '').includes('directory-listing-table')) {
    const tdMatches = [...String(html || '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match =>
      decodeHtmlEntities(String(match[1] || '').replace(/<[^>]+>/g, '').trim())
    );
    for (let i = 0; i + 2 < tdMatches.length; i += 1) {
      const rawName = tdMatches[i];
      const lowerName = String(rawName || '').toLowerCase();
      if (!rawName || ![...allowed].some(ext => lowerName.endsWith(ext))) continue;
      if (rawName === '../' || rawName === 'Parent Directory') continue;
      const timestamp = String(tdMatches[i + 1] || '').trim();
      const sizeRaw = String(tdMatches[i + 2] || '').trim();
      let downloadUrl = '';
      try {
        downloadUrl = new URL(encodeURIComponent(rawName), resolvedBaseHref || sourceUrl || 'https://archive.org').toString();
      } catch {}
      const { cleanName, region, tags } = parseRomFilename(rawName);
      const sizeBytes = parseSizeString(sizeRaw) || parseInt(sizeRaw, 10) || 0;
      const size = sizeBytes ? formatSizeMain(sizeBytes) : '';
      roms.push({ name: rawName, cleanName, region, tags, size, sizeBytes, timestamp, downloadUrl, system, provider });
      restrictedFallbackCount += 1;
    }
  }
  if (String(system || '').toLowerCase() === 'x360') {
    console.log('[x360-catalog] restricted fallback count:', restrictedFallbackCount);
  }
  return roms;
}

function parseViewArchiveHtml(html, downloadBase) {
  return parseArchiveDirectoryHtml(html, { extensions: ['.zip'], sourceUrl: downloadBase });
}

function parseArchiveFilesXml(xml, { extensions = ['.zip'], system = '', provider = 'archiveorg', sourceUrl = '' } = {}) {
  const roms = [];
  const allowed = new Set(extensions.map(ext => String(ext || '').toLowerCase()));
  const fileRe = /<file\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/file>/gi;
  let fileMatch;
  while ((fileMatch = fileRe.exec(String(xml || ''))) !== null) {
    const rawName = decodeHtmlEntities(String(fileMatch[1] || '').trim());
    const lowerName = rawName.toLowerCase();
    if (!rawName || ![...allowed].some(ext => lowerName.endsWith(ext))) continue;
    const body = fileMatch[2] || '';
    const sizeRaw = (body.match(/<size>([^<]+)<\/size>/i)?.[1] || '').trim();
    const timestamp = (body.match(/<mtime>([^<]+)<\/mtime>/i)?.[1] || '').trim();
    let downloadUrl = '';
    try {
      downloadUrl = new URL(encodeURIComponent(rawName), sourceUrl || 'https://archive.org').toString();
    } catch {}
    const { cleanName, region, tags } = parseRomFilename(rawName);
    const sizeBytes = parseSizeString(sizeRaw) || parseInt(sizeRaw, 10) || 0;
    const size = sizeBytes ? formatSizeMain(sizeBytes) : '';
    roms.push({ name: rawName, cleanName, region, tags, size, sizeBytes, timestamp, downloadUrl, system, provider });
  }
  return roms;
}

function normalizePs3DiscKeyStem(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return path.basename(raw, path.extname(raw)).trim().toLowerCase();
}

async function loadPs3DiscKeyIndex() {
  const now = Date.now();
  if (ps3DiscKeyIndexCache && (now - Number(ps3DiscKeyIndexCache.loadedAt || 0) < 6 * 60 * 60 * 1000)) {
    return ps3DiscKeyIndexCache.names;
  }
  try {
    const html = await fetchArchiveText(PS3_DISC_KEY_CATALOG_URL, 'https://archive.org/details/sony-playstation-3-disc-keys-dat-cuesheets');
    const names = new Set();
    for (const match of String(html || '').matchAll(/<a[^>]+>([^<]+\.key)<\/a>/gi)) {
      const rawName = decodeHtmlEntities(String(match[1] || '').trim());
      const normalized = normalizePs3DiscKeyStem(rawName);
      if (normalized) names.add(normalized);
    }
    if (!names.size) {
      console.warn('[ps3-catalog] disc key regex parser found 0 entries');
      return null;
    }
    ps3DiscKeyIndexCache = {
      loadedAt: now,
      names,
    };
    return names;
  } catch (error) {
    console.warn('[ps3-catalog] could not load disc key index:', error?.message || error);
    return null;
  }
}

async function filterPs3CatalogByDiscKeys(roms = []) {
  const keyNames = await loadPs3DiscKeyIndex();
  if (!(keyNames instanceof Set) || !keyNames.size) return roms;
  const filtered = roms.filter((rom) => {
    const rawName = String(rom?.name || '').trim();
    const ext = path.extname(rawName).toLowerCase();
    if (ext !== '.iso') return true;
    return keyNames.has(normalizePs3DiscKeyStem(rawName));
  });
  console.log('[ps3-catalog] filtered by disc keys:', roms.length, '->', filtered.length);
  return filtered;
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
  let base = filename.replace(/\.(zip|chd|cue|bin|img|iso|cso|pbp)$/i, '');
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
  const s = String(str || '').trim().toUpperCase().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*(B|K|KB|M|MB|G|GB|T|TB)?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'B';
  const mult = {
    B: 1,
    K: 1024, KB: 1024,
    M: 1024 * 1024, MB: 1024 * 1024,
    G: 1024 * 1024 * 1024, GB: 1024 * 1024 * 1024,
    T: 1024 * 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024,
  };
  return Math.round(n * (mult[unit] || 1));
}

// ─── ROM launch via emulator manager ────────────────────────────────────────

  ipcMain.handle('launch-rom', async (event, { romPath, system, identifier = null, title = null }) => {
  if (String(system || '').toLowerCase() === 'ps2') {
    return emulatorManager.launchPCSX2Rom({ romPath, system, identifier, title });
    }
    if (String(system || '').toLowerCase() === 'ps3') {
      const runtimeStatus = emulatorManager.getRPCS3RuntimeStatus(loadSettings());
      if (!runtimeStatus?.firmwareInstalled) {
        if (!runtimeStatus?.firmwarePackageAvailable) {
          return { ok: false, error: 'PS3 firmware is not installed yet. Open System > Emulators > RPCS3 and install firmware first.' };
        }
        const installed = await installManagedRPCS3Firmware(createEmulatorRuntimeProgressSender(event.sender));
        if (!installed?.ok) return installed;
      }
      const effectiveRomPath = resolvePreferredRPCS3LaunchPath(identifier, romPath);
      return emulatorManager.launchRPCS3Rom({ romPath: effectiveRomPath, system, identifier, title });
    }
  if (String(system || '').toLowerCase() === 'x360') {
    return emulatorManager.launchXeniaRom({ romPath, system, identifier, title });
  }
  return emulatorManager.launchLibretroRom({ romPath, system, identifier, title });
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

function findFirstFileRecursive(rootDir, matcher, depth = 0, maxDepth = 6) {
  if (!rootDir || depth > maxDepth || !fs.existsSync(rootDir)) return '';
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile() && matcher(fullPath, entry.name)) return fullPath;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = findFirstFileRecursive(path.join(rootDir, entry.name), matcher, depth + 1, maxDepth);
    if (nested) return nested;
  }
  return '';
}

function resolvePs3IsoPath(installDir, originalDownloadPath = '') {
  const installPath = String(installDir || '').trim();
  if (installPath && fs.existsSync(installPath)) {
    try {
      const stat = fs.statSync(installPath);
      if (stat.isFile() && path.extname(installPath).toLowerCase() === '.iso') return installPath;
      if (stat.isDirectory()) {
        const preferredBase = path.basename(String(originalDownloadPath || ''), path.extname(String(originalDownloadPath || ''))).toLowerCase();
        return findFirstFileRecursive(installPath, (fullPath, name) => {
          if (path.extname(name).toLowerCase() !== '.iso') return false;
          if (!preferredBase) return true;
          return path.basename(name, path.extname(name)).toLowerCase() === preferredBase;
        });
      }
    } catch {}
  }
  const originalPath = String(originalDownloadPath || '').trim();
  if (originalPath && fs.existsSync(originalPath) && path.extname(originalPath).toLowerCase() === '.iso') return originalPath;
  return '';
}

function buildPs3DiscKeyDownloadUrl(isoPath) {
  const isoBaseName = path.basename(String(isoPath || '').trim(), path.extname(String(isoPath || '').trim()));
  if (!isoBaseName) return '';
  return `${PS3_DISC_KEY_ARCHIVE_BASE}/${encodeURIComponent(isoBaseName)}.key`;
}

async function ensurePs3DiscKey(event, { identifier, installDir, originalDownloadPath = '' }) {
  const isoPath = resolvePs3IsoPath(installDir, originalDownloadPath);
  if (!isoPath) {
    return { ok: true, skipped: true, reason: 'No ISO file found for PS3 disc key download.' };
  }

  const targetDir = path.dirname(isoPath);
  const targetKeyPath = path.join(targetDir, `${path.basename(isoPath, path.extname(isoPath))}.key`);
  if (fs.existsSync(targetKeyPath)) {
    return { ok: true, skipped: true, filePath: targetKeyPath, existing: true };
  }

  const downloadUrl = buildPs3DiscKeyDownloadUrl(isoPath);
  if (!downloadUrl) {
    return { ok: false, error: 'Could not determine the matching PlayStation 3 disc key URL.' };
  }

  try {
    if (event?.sender && !event.sender.isDestroyed()) {
      event.sender.send('download-progress', { identifier, percent: 10, stage: 'installing' });
    }
  } catch {}

  const downloadResult = await performDownloadJob(event, {
    identifier,
    downloadUrl,
    fileName: path.basename(targetKeyPath),
    progressStage: 'installing',
    system: 'ps3',
  });
  if (!downloadResult?.ok) {
    return {
      ok: false,
      error: `Downloaded the PlayStation 3 ISO, but could not fetch the matching disc key.\n${downloadResult?.error || 'Unknown disc key error.'}`,
    };
  }

  const downloadedKeyPath = String(downloadResult.filePath || '').trim();
  if (downloadedKeyPath && path.resolve(downloadedKeyPath) !== path.resolve(targetKeyPath)) {
    try {
      ensureDir(targetDir);
      if (fs.existsSync(targetKeyPath)) fs.unlinkSync(targetKeyPath);
      fs.renameSync(downloadedKeyPath, targetKeyPath);
      try {
        if (event?.sender && !event.sender.isDestroyed()) {
          event.sender.send('download-progress', { identifier, percent: 85, stage: 'installing' });
        }
      } catch {}
    } catch (error) {
      return { ok: false, error: `Downloaded the PlayStation 3 disc key, but could not place it next to the ISO.\n${error?.message || error}` };
    }
  }

  try {
    if (event?.sender && !event.sender.isDestroyed()) {
      event.sender.send('download-progress', { identifier, percent: 95, stage: 'installing' });
    }
  } catch {}
  return { ok: true, filePath: targetKeyPath };
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
    const req = https.get(url, { headers: { 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return resolve({ ok: false, error: `RetroAchievements request failed (${res.statusCode})` });
      }
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
    });
    req.setTimeout(15000, () => req.destroy(new Error('RetroAchievements request timed out')));
    req.on('error', err => resolve({ ok: false, error: err.message }));
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

ipcMain.handle('libretro-systems', () => emulatorManager.getSystems());
ipcMain.handle('emulator-sessions-get', () => emulatorManager.getSessions());
ipcMain.handle('emulator-session-focus', async (_, { sessionId } = {}) => emulatorManager.focusSession(sessionId));
ipcMain.handle('emulator-session-close', async (_, { sessionId } = {}) => emulatorManager.terminateSession(sessionId));
ipcMain.handle('emulator-session-restart', async (_, { sessionId } = {}) => emulatorManager.restartSession(sessionId));
ipcMain.handle('emulator-launch-standalone', async (_, { emulatorId, args } = {}) => {
  if (String(emulatorId || '').trim().toLowerCase() === 'rpcs3') {
    syncRPCS3WelcomeConfigState({ markCompleted: true });
  }
  return emulatorManager.launchStandaloneEmulator(emulatorId, args);
});
ipcMain.handle('emulator-runtime-status', () => emulatorManager.getRetroArchRuntimeStatus(loadSettings()));
ipcMain.handle('pcsx2-runtime-status', () => emulatorManager.getPCSX2RuntimeStatus(loadSettings()));
ipcMain.handle('rpcs3-runtime-status', () => emulatorManager.getRPCS3RuntimeStatus(loadSettings()));
ipcMain.handle('rpcs3-setup-status', () => getRPCS3SetupStatus(loadSettings()));
ipcMain.handle('rpcs3-setup-update', async (_, { welcomeCompleted } = {}) => {
  const settings = loadSettings();
  const next = emulatorManager.normalizeSettings({
    ...settings,
    emulators: {
      ...(settings.emulators || {}),
      rpcs3: {
        ...((settings.emulators || {}).rpcs3 || {}),
        welcomeCompleted: welcomeCompleted === true,
      },
    },
  });
  saveSettings(next);
  return getRPCS3SetupStatus(next);
});
ipcMain.handle('rpcs3-welcome-guide-action', async (_, { action, pid } = {}) => {
  let targetPid = Number(pid);
  if (!Number.isFinite(targetPid) || targetPid <= 0) {
    const sessions = emulatorManager.getSessions();
    const active = [...sessions]
      .filter(session => String(session?.emulatorId || '').trim().toLowerCase() === 'rpcs3')
      .sort((a, b) => Number(b?.startedAt || 0) - Number(a?.startedAt || 0))[0];
    targetPid = Number(active?.pid || 0);
  }
  logRPCS3PkgAutomation(`welcome-guide-action-start action=${String(action || '').trim()} pid=${String(targetPid || 0)}`);
  const result = await invokeRPCS3WelcomeGuideActionForPid(targetPid, action);
  logRPCS3PkgAutomation(`welcome-guide-action-result action=${String(action || '').trim()} pid=${String(targetPid || 0)} ok=${!!result?.ok} state=${String(result?.state || '').trim() || '<none>'} error=${String(result?.error || '').trim() || '<none>'}`);
  return result;
});
ipcMain.handle('vlc-runtime-status', () => emulatorManager.getVLCRuntimeStatus(loadSettings()));
ipcMain.handle('xenia-runtime-status', () => emulatorManager.getXeniaRuntimeStatus(loadSettings()));
ipcMain.handle('xenia-profile-status', () => emulatorManager.getXeniaProfileStatus(loadSettings()));
ipcMain.handle('xenia-profile-sync', () => emulatorManager.syncXeniaProfileConfig(loadSettings()));
ipcMain.handle('xenia-content-trace-get', () => {
  try {
    if (!fs.existsSync(XENIA_CONTENT_TRACE_PATH)) return { ok: true, trace: null };
    return { ok: true, trace: JSON.parse(fs.readFileSync(XENIA_CONTENT_TRACE_PATH, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not read the Xenia content trace.' };
  }
});
ipcMain.handle('pcsx2-runtime-sync', () => emulatorManager.syncPCSX2PortableConfig(loadSettings()));
ipcMain.handle('libretro-core-status', () => emulatorManager.getLibretroCoreStatus(loadSettings()));
function createEmulatorRuntimeProgressSender(webContents) {
  let lastSentAt = 0;
  let lastStage = '';
  let lastPercentBucket = -1;
  return (progress = {}) => {
    try {
      const stage = String(progress?.stage || '');
      const percent = Number(progress?.percent || 0);
      latestEmulatorRuntimeProgress = {
        active: stage !== 'complete' && stage !== 'failed' && stage !== 'error' && !!stage,
        percent,
        stage,
        message: String(progress?.message || ''),
      };
      const now = Date.now();
      const percentBucket = Math.max(0, Math.min(100, Math.round(percent)));
      const shouldSend =
        stage === 'complete'
        || stage !== lastStage
        || percentBucket !== lastPercentBucket
        || (now - lastSentAt) >= 150;
      if (!shouldSend) return;
      lastSentAt = now;
      lastStage = stage;
      lastPercentBucket = percentBucket;
      webContents.send('emulator-runtime-progress', progress);
    } catch {}
  };
}
function publishEmulatorRuntimeProgress(progress = {}) {
  try {
    const stage = String(progress?.stage || '');
    latestEmulatorRuntimeProgress = {
      active: stage !== 'complete' && stage !== 'failed' && stage !== 'error' && !!stage,
      percent: Number(progress?.percent || 0),
      stage,
      message: String(progress?.message || ''),
    };
    for (const candidate of [mainWindow, bladesWindow, guideOverlayWindow]) {
      try {
        if (candidate && !candidate.isDestroyed()) candidate.webContents.send('emulator-runtime-progress', latestEmulatorRuntimeProgress);
      } catch {}
    }
  } catch {}
}
ipcMain.handle('emulator-runtime-progress-get', () => latestEmulatorRuntimeProgress);
ipcMain.handle('emulator-runtime-download', async (event) => downloadManagedRetroArchRuntime(createEmulatorRuntimeProgressSender(event.sender)));
ipcMain.handle('pcsx2-runtime-download', async (event) => downloadManagedPCSX2Runtime(createEmulatorRuntimeProgressSender(event.sender)));
  ipcMain.handle('rpcs3-runtime-download', async (event) => downloadManagedRPCS3Runtime(createEmulatorRuntimeProgressSender(event.sender)));
  ipcMain.handle('rpcs3-runtime-uninstall', async () => uninstallManagedRPCS3Runtime());
  ipcMain.handle('rpcs3-firmware-download', async (event) => downloadManagedRPCS3Firmware(createEmulatorRuntimeProgressSender(event.sender)));
  ipcMain.handle('rpcs3-firmware-install', async (event) => installManagedRPCS3Firmware(createEmulatorRuntimeProgressSender(event.sender)));
  ipcMain.handle('vlc-runtime-download', async (event) => downloadManagedVLCRuntime(createEmulatorRuntimeProgressSender(event.sender)));
ipcMain.handle('xenia-runtime-download', async (event) => downloadManagedXeniaRuntime(createEmulatorRuntimeProgressSender(event.sender)));
ipcMain.handle('emulator-core-download', async (event, { system, coreFileName } = {}) => downloadManagedRetroArchCore(system, coreFileName, createEmulatorRuntimeProgressSender(event.sender)));
ipcMain.handle('emulator-runtime-import', async (_, { executablePath } = {}) => {
  const result = emulatorManager.importRetroArchRuntime(executablePath);
  if (result?.ok) {
    const settings = loadSettings();
    const next = emulatorManager.normalizeSettings({
      ...settings,
      emulators: {
        ...(settings.emulators || {}),
        retroarch: {
          ...((settings.emulators || {}).retroarch || {}),
          mode: 'bundled',
          customExecutablePath: String(settings?.emulators?.retroarch?.customExecutablePath || settings.retroarchPath || '').trim(),
          cores: {
            ...(((settings.emulators || {}).retroarch || {}).cores || {}),
            ...(settings.cores || {}),
          },
        },
      },
    });
    saveSettings(next);
  }
  return result;
});
ipcMain.handle('pcsx2-runtime-import', async (_, { executablePath } = {}) => {
  const result = emulatorManager.importPCSX2Runtime(executablePath);
  if (result?.ok) {
    const settings = loadSettings();
    const next = emulatorManager.normalizeSettings({
      ...settings,
      emulators: {
        ...(settings.emulators || {}),
        pcsx2: {
          ...((settings.emulators || {}).pcsx2 || {}),
          mode: 'bundled',
          customExecutablePath: String(settings?.emulators?.pcsx2?.customExecutablePath || '').trim(),
          biosPath: String(settings?.emulators?.pcsx2?.biosPath || '').trim(),
        },
      },
    });
    saveSettings(next);
  }
  return result;
});
ipcMain.handle('rpcs3-runtime-import', async (_, { executablePath } = {}) => {
  const result = emulatorManager.importRPCS3Runtime(executablePath);
  if (result?.ok) {
    const welcomeSync = syncRPCS3WelcomeConfigState({ markCompleted: true });
    if (!welcomeSync?.ok) return welcomeSync;
    const settings = loadSettings();
    const next = emulatorManager.normalizeSettings({
      ...settings,
      emulators: {
        ...(settings.emulators || {}),
        rpcs3: {
          ...((settings.emulators || {}).rpcs3 || {}),
          mode: 'bundled',
          customExecutablePath: String(settings?.emulators?.rpcs3?.customExecutablePath || '').trim(),
        },
      },
    });
    saveSettings(next);
  }
  return result;
});
ipcMain.handle('vlc-runtime-import', async (_, { executablePath } = {}) => {
  const result = emulatorManager.importVLCRuntime(executablePath);
  if (result?.ok) {
    const settings = loadSettings();
    const next = emulatorManager.normalizeSettings({
      ...settings,
      emulators: {
        ...(settings.emulators || {}),
        vlc: {
          ...((settings.emulators || {}).vlc || {}),
          mode: 'bundled',
          customExecutablePath: String(settings?.emulators?.vlc?.customExecutablePath || '').trim(),
        },
      },
    });
    saveSettings(next);
  }
  return result;
});
ipcMain.handle('xenia-runtime-import', async (_, { executablePath } = {}) => {
  const result = await importManagedXeniaRuntime(executablePath);
  if (result?.ok) {
    const settings = loadSettings();
    const next = emulatorManager.normalizeSettings({
      ...settings,
      emulators: {
        ...(settings.emulators || {}),
        xenia: {
          ...((settings.emulators || {}).xenia || {}),
          mode: 'bundled',
          customExecutablePath: String(settings?.emulators?.xenia?.customExecutablePath || '').trim(),
        },
      },
    });
    saveSettings(next);
  }
  return result;
});
ipcMain.handle('vlc-media-launch', async (_, opts = {}) => launchManagedVLCMedia(opts));
ipcMain.handle('vlc-media-bounds', async (_, opts = {}) => updateVlcMediaBounds(opts));
ipcMain.handle('vlc-media-control', async (_, opts = {}) => controlActiveVLCMedia(opts));
ipcMain.handle('vlc-audio-launch', async (_, opts = {}) => launchManagedVLCAudio(opts));
ipcMain.handle('vlc-audio-control', async (_, opts = {}) => controlActiveVLCAudio(opts));

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
    const req = https.get(url, { headers: { 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return resolve(null);
      }
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
    });
    req.setTimeout(15000, () => req.destroy(new Error('RetroAchievements game list request timed out')));
    req.on('error', () => resolve(null));
  });
}

function raFetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`RetroAchievements request failed (${res.statusCode})`));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('RetroAchievements request timed out')));
    req.on('error', reject);
  });
}

function extractEmbeddedJson(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf('{', markerIndex);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function deepFindAll(node, predicate, acc = []) {
  if (!node) return acc;
  if (predicate(node)) acc.push(node);
  if (Array.isArray(node)) {
    node.forEach(item => deepFindAll(item, predicate, acc));
    return acc;
  }
  if (typeof node === 'object') {
    Object.values(node).forEach(value => deepFindAll(value, predicate, acc));
  }
  return acc;
}

function ytText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (value.simpleText) return String(value.simpleText).trim();
  if (Array.isArray(value.runs)) return value.runs.map(run => String(run?.text || '')).join('').trim();
  return '';
}

async function fetchYouTubePlaylistDetails(playlistId) {
  if (!playlistId) return { ok: false, error: 'Missing YouTube playlist id.' };
  return new Promise((resolve) => {
    const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&persist_hl=1`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return resolve({ ok: false, error: `YouTube playlist request failed (${res.statusCode})` });
      }
      let html = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { html += chunk; });
      res.on('end', () => {
        try {
          const jsonText = extractEmbeddedJson(html, 'ytInitialData') || extractEmbeddedJson(html, 'var ytInitialData');
          if (!jsonText) return resolve({ ok: false, error: 'Could not read YouTube playlist data.' });
          const initialData = JSON.parse(jsonText);
          const renderers = deepFindAll(initialData, value => !!value?.playlistVideoRenderer)
            .map(value => value.playlistVideoRenderer);
          const episodes = renderers
            .map((renderer, idx) => {
              const videoId = String(renderer?.videoId || '').trim();
              if (!videoId) return null;
              const thumbnails = renderer?.thumbnail?.thumbnails || [];
              const bestThumb = thumbnails[thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
              const indexText = ytText(renderer?.index);
              const index = Number(indexText || (idx + 1)) || (idx + 1);
              return {
                id: videoId,
                title: ytText(renderer?.title) || `Episode ${index}`,
                index,
                thumb: String(bestThumb).replace(/&amp;/g, '&'),
                duration: ytText(renderer?.lengthText),
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.index - b.index);
          const title =
            ytText(initialData?.metadata?.playlistMetadataRenderer?.title) ||
            ytText(initialData?.sidebar?.playlistSidebarRenderer?.items?.[0]?.playlistSidebarPrimaryInfoRenderer?.title) ||
            `YouTube Playlist`;
          if (!episodes.length) {
            return resolve({ ok: false, error: 'No playlist episodes were found.' });
          }
          resolve({ ok: true, data: { playlistId, title, episodes } });
        } catch (error) {
          resolve({ ok: false, error: error?.message || 'Could not parse YouTube playlist.' });
        }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('YouTube playlist request timed out')));
    req.on('error', error => resolve({ ok: false, error: error?.message || 'Could not load YouTube playlist.' }));
  });
}


function archiveMediaTitleFromName(name = '', fallback = 'Episode') {
  const stem = String(name || '').replace(/\.[^.]+$/, '');
  return stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

async function fetchArchiveCollectionEntries(identifier) {
  const cleanId = String(identifier || '').trim();
  if (!cleanId) return { ok: false, error: 'Missing Archive identifier.' };
  const query = `collection:${cleanId} AND mediatype:movies`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=mediatype&fl[]=date&sort[]=titleSorter asc&rows=1000&page=1&output=json`;
  const result = await requestJson(url, { timeoutMs: 15000 });
  if (!result?.ok || !result.data) {
    return { ok: false, error: result?.error || 'Could not load Archive collection entries.' };
  }
  const docs = Array.isArray(result?.data?.response?.docs) ? result.data.response.docs : [];
  const episodes = docs
    .map((doc, idx) => {
      const childId = String(doc?.identifier || '').trim();
      if (!childId) return null;
      return {
        id: childId,
        archiveIdentifier: childId,
        title: String(doc?.title || childId).trim() || `Episode ${idx + 1}`,
        index: idx + 1,
        thumb: `https://archive.org/services/img/${encodeURIComponent(childId)}`,
        duration: '',
        mime: 'video/mp4',
      };
    })
    .filter(Boolean);
  if (!episodes.length) {
    return { ok: false, error: 'No playable collection entries were found for this Archive item.' };
  }
  return {
    ok: true,
    data: {
      identifier: cleanId,
      title: cleanId,
      episodes,
    },
  };
}

async function fetchArchiveVideoCollectionDetails(identifier) {
  const cleanId = String(identifier || '').trim();
  if (!cleanId) return { ok: false, error: 'Missing Archive identifier.' };
  const result = await requestJson(`https://archive.org/metadata/${encodeURIComponent(cleanId)}`, { timeoutMs: 15000 });
  if (!result?.ok || !result.data) {
    return { ok: false, error: result?.error || 'Could not load Archive metadata.' };
  }
  const meta = result.data || {};
  const mediaHost = String(meta?.d1 || meta?.server || 'archive.org').trim();
  const mediaDir = String(meta?.dir || `/download/${cleanId}`).trim();
  const files = Array.isArray(meta.files) ? meta.files : [];
  const episodes = files
    .filter(file => {
      const name = String(file?.name || '');
      const format = String(file?.format || '');
      return !!name && /\.(mp4|m4v|webm|ogv)$/i.test(name) && !/thumb|sample/i.test(format);
    })
    .map((file, idx) => {
      const name = String(file.name || '').trim();
      const title = archiveMediaTitleFromName(name, `Episode ${idx + 1}`);
      const encodedName = String(name || '')
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');
      const directUrl = `https://${mediaHost}${mediaDir}/${encodedName}`;
      return {
        id: name,
        archiveIdentifier: cleanId,
        title,
        index: idx + 1,
        url: directUrl,
        embedFile: String(file?.original || name || ''),
        thumb: `https://archive.org/download/${encodeURIComponent(cleanId)}/__ia_thumb.jpg`,
        duration: String(file?.length || '').trim(),
        mime: 'video/mp4',
      };
    });
  if (!episodes.length) {
    if (String(meta?.metadata?.mediatype || meta?.mediatype || '').trim().toLowerCase() === 'collection') {
      const collectionResult = await fetchArchiveCollectionEntries(cleanId);
      if (collectionResult?.ok) return collectionResult;
    }
    return { ok: false, error: 'No playable video files were found for this Archive item.' };
  }
  return {
    ok: true,
    data: {
      identifier: cleanId,
      title: String(meta?.metadata?.title || cleanId),
      episodes,
    },
  };
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

ipcMain.handle('ra-recent-unlocks', async (_, { minutes = 10 } = {}) => {
  const settings = loadSettings();
  const raAccount = readThirdPartyAccount('retroachievements');
  const username = (raAccount.login || settings.retroAchievementsUser || '').trim();
  const apiKey = (raAccount.secret || settings.retroAchievementsKey || '').trim();
  if (!username) return { ok: false, error: 'no-user' };
  if (!apiKey) return { ok: false, error: 'no-key' };
  const lookbackMinutes = Math.max(1, Math.min(120, Number(minutes || 10) || 10));
  try {
    const url = `https://retroachievements.org/API/API_GetUserRecentAchievements.php?u=${encodeURIComponent(username)}&y=${encodeURIComponent(apiKey)}&m=${lookbackMinutes}`;
    const json = await raFetchJson(url);
    const rows = Array.isArray(json) ? json : [];
    return {
      ok: true,
      data: rows.map(row => ({
        id: row.AchievementID ?? row.achievementId ?? row.ID ?? row.id,
        title: row.Title ?? row.title ?? 'Achievement Unlocked',
        description: row.Description ?? row.description ?? '',
        points: Number(row.Points ?? row.points ?? 0) || 0,
        badgeName: row.BadgeName ?? row.badgeName ?? '',
        badgeUrl: row.BadgeURL ?? row.badgeUrl ?? '',
        date: row.Date ?? row.date ?? '',
        gameId: row.GameID ?? row.gameId ?? null,
        gameTitle: row.GameTitle ?? row.gameTitle ?? '',
        consoleName: row.ConsoleName ?? row.consoleName ?? '',
        hardcore: Boolean(Number(row.HardcoreMode ?? row.hardcoreMode ?? 0)),
      })),
    };
  } catch (e) {
    return { ok: false, error: e.message || 'ra-recent-fetch-failed' };
  }
});

ipcMain.handle('ra-game-search', async (_, { cleanName, system }) => fetchRaGameData(cleanName, system));
ipcMain.handle('youtube-playlist-details', async (_, { playlistId } = {}) => fetchYouTubePlaylistDetails(playlistId));
ipcMain.handle('archive-video-details', async (_, { identifier } = {}) => fetchArchiveVideoCollectionDetails(identifier));

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
    } else {
      syncManagedXeniaProfileIfPossible(settings);
    }
  }
});

ipcMain.handle('stoat-login', async (_, { email, password }) => {
  const result = await stoat.login(email, password);
  if (result.ok && result.session) {
    const settings = loadSettings();
    settings.stoatSession = result.session;
    if (result.user) upsertStoatProfile(settings, result.user, result.session);
    saveSettings(settings);
    syncManagedXeniaProfileIfPossible(settings);
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
ipcMain.handle('stoat-list-profiles', () => {
  const settings = loadSettings();
  return normalizeStoatProfiles(settings);
});
ipcMain.handle('stoat-switch-profile', async (_, { profileId }) => {
  const settings = loadSettings();
  const profiles = normalizeStoatProfiles(settings);
  const profile = profiles.find(entry => String(entry.id) === String(profileId || ''));
  if (!profile) return { ok: false, error: 'Profile not found' };
  const result = await stoat.useExistingSession(profile.session);
  if (result.ok) {
    settings.stoatSession = profile.session;
    if (result.user) upsertStoatProfile(settings, result.user, profile.session);
    saveSettings(settings);
    syncManagedXeniaProfileIfPossible(settings);
  }
  return result;
});

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
