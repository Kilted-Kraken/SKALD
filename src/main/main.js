'use strict';
/**
 * RohanKar Launcher — main.js
 * Session 5: Auto-updater added (electron-updater + GitHub releases).
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const { execFile, spawn } = require('child_process');
const stoat = require('./stoat');

// Force consistent userData in dev — Electron uses 'Electron' as app name in dev,
// giving a different folder from production and breaking saved settings/credentials.
if (!app.isPackaged) {
  const pkg = require('../../package.json');
  app.setPath('userData', path.join(app.getPath('appData'), pkg.name));
  console.log('[userData] dev path:', app.getPath('userData'));
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const USER_DATA        = app.getPath('userData');
const DEFAULT_GAMES_DIR = path.join(USER_DATA, 'games');
const LEGACY_DB_PATH   = path.join(USER_DATA, 'library.json');
const SETTINGS_PATH    = path.join(USER_DATA, 'settings.json');

const THUMB_CACHE_DIR  = path.join(USER_DATA, 'thumbcache');

[DEFAULT_GAMES_DIR, THUMB_CACHE_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

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

// ─── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {}
  return {};
}

function saveSettings(data) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
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
  for (const r of rows) out[r.identifier] = r;
  return out;
});

ipcMain.handle('library-get-game', (_, { identifier }) => {
  if (!db) return null;
  return db.prepare('SELECT * FROM games WHERE identifier = ?').get(identifier) || null;
});

ipcMain.handle('library-set-category', (_, { identifier, category }) => {
  if (!db) return { ok: false };
  db.prepare('UPDATE games SET category = ? WHERE identifier = ?').run(category, identifier);
  return { ok: true };
});

ipcMain.handle('library-set-favorite', (_, { identifier, isFavorite }) => {
  if (!db) return { ok: false };
  // Ensure the row exists (game may not be installed yet)
  db.prepare(`INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)`).run(identifier, Date.now());
  db.prepare('UPDATE games SET is_favorite = ? WHERE identifier = ?').run(isFavorite ? 1 : 0, identifier);
  return { ok: true };
});

ipcMain.handle('library-set-notes', (_, { identifier, notes }) => {
  if (!db) return { ok: false };
  db.prepare(`INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)`).run(identifier, Date.now());
  db.prepare('UPDATE games SET notes = ? WHERE identifier = ?').run(notes || null, identifier);
  return { ok: true };
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
  const settings    = loadSettings();
  const downloadDir = settings.downloadPath || DEFAULT_GAMES_DIR;
  const destDir     = path.join(downloadDir, sanitizeFolderName(identifier));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const safeFileName = path.basename(fileName);
  const destFile     = path.join(destDir, safeFileName);

  return new Promise((resolve) => {
    // Track whether cancel has been called so we resolve exactly once
    let cancelled = false;

    // Register a cancel hook immediately — before any HTTP request is made.
    // This lets download-cancel work even during redirects or slow connections.
    activeDownloads.set(identifier, {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: 'Cancelled' });
      },
      req:  null,
      file: null,
    });

    // Build cookie header from stored session cookies for archive.org auth
    const buildCookieHeader = async () => {
      try {
        const ses = getSession();
        const c1 = await ses.cookies.get({ domain: 'archive.org' });
        const c2 = await ses.cookies.get({ domain: '.archive.org' });
        const c3 = await ses.cookies.get({ url: 'https://archive.org' });
        const cookies = [...new Map([...c1,...c2,...c3].map(c => [c.name+c.domain, c])).values()];
        return cookies.map(c => `${c.name}=${c.value}`).join('; ');
      } catch { return ''; }
    };

    buildCookieHeader().then(cookieHeader => {

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
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Cookie':     cookieHeader,
        },
        timeout: 30000,
      }, (res) => {
        if (cancelled) { res.resume(); return; }

        const { statusCode, headers } = res;

        // Follow redirects — keep Cookie header attached across CDN hops
        if ([301,302,303,307,308].includes(statusCode) && headers.location) {
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

        // Update the active download entry with the live req and file
        const entry = activeDownloads.get(identifier);
        if (entry) { entry.req = req; entry.file = file; }

        res.on('data', chunk => {
          if (cancelled) return;
          received += chunk.length;
          if (total > 0) {
            try {
              if (!event.sender.isDestroyed()) {
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

      // Store req so cancel can destroy it
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
    }); // end buildCookieHeader().then
  });
});

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
  const settings       = loadSettings();
  const installBase    = settings.installPath || DEFAULT_GAMES_DIR;
  // parentDir = the identifier's root folder (e.g. ni-ghts-into-dreams_202511)
  const parentDir      = path.join(installBase, sanitizeFolderName(identifier));
  // destDir   = where this specific archive extracts to
  //   - Single game:       parentDir  (e.g. .../ni-ghts-into-dreams_202511/)
  //   - Collection item:   parentDir/subFolder  (e.g. .../ni-ghts-into-dreams_202511/Crazy Taxi/)
  // Collection game subfolders are prefixed with _GAME_ so findExesInDir
  // can identify them and list their executables grouped by game name.
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

  // fallback: extract-zip for .zip
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

// Build a lookup: sanitized-title (lowercase) → original title
// so we can do case-insensitive folder-name matching.
function buildTitleLookup(titleMap) {
  const lookup = {}; // normalizedTitle → { original, identifier }
  for (const [title, identifier] of Object.entries(titleMap || {})) {
    const normalized = sanitizeTitle(title).toLowerCase();
    if (normalized) lookup[normalized] = { original: title, identifier };
  }
  return lookup;
}

// Scan a directory for pre-existing game installs.
// knownIdentifiers = array of identifier strings from the renderer.
// titleMap         = { gameTitle: identifier } for title-based matching.
// Returns { found: [ { identifier, installDir, exePath, matchedBy } ] }
ipcMain.handle('scan-for-games', (_, { scanDir, knownIdentifiers, titleMap }) => {
  if (!db || !scanDir || !fs.existsSync(scanDir)) return { found: [] };

  const identifierSet  = new Set(knownIdentifiers);
  const titleLookup    = buildTitleLookup(titleMap);
  const found          = [];

  let entries;
  try { entries = fs.readdirSync(scanDir, { withFileTypes: true }); }
  catch { return { found: [] }; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    const folderPath = path.join(scanDir, folderName);

    let matchedId  = null;
    let matchedBy  = null;

    // ─ Pass 1: exact identifier match ──────────────────────────────────────
    if (identifierSet.has(folderName)) {
      matchedId = folderName;
      matchedBy = 'identifier';
    }

    // ─ Pass 2: sanitized identifier match ──────────────────────────────
    if (!matchedId) {
      for (const id of identifierSet) {
        if (sanitizeFolderName(id) === folderName) {
          matchedId = id;
          matchedBy = 'identifier-sanitized';
          break;
        }
      }
    }

    // ─ Pass 3: game title match (case-insensitive) ──────────────────────
    // Handles folders named "Zoo Tycoon - Complete Collection" downloaded directly
    // from archive.org, where the folder name mirrors the game title not the identifier.
    if (!matchedId && titleLookup) {
      const normalizedFolder = sanitizeTitle(folderName).toLowerCase();
      const hit = titleLookup[normalizedFolder];
      if (hit) {
        matchedId = hit.identifier;
        matchedBy = 'title';
      }
    }

    if (!matchedId) continue;

    // Skip if already registered with a valid install_dir
    const existing = db.prepare('SELECT install_dir FROM games WHERE identifier = ?').get(matchedId);
    if (existing?.install_dir && fs.existsSync(existing.install_dir)) continue;

    // Find an exe
    const exes    = findExesInDir(folderPath);
    const exePath = exes.length === 1 ? exes[0] : null;

    // Register it
    db.prepare(`
      INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)
    `).run(matchedId, Date.now());
    db.prepare('UPDATE games SET install_dir = ?, exe_path = ? WHERE identifier = ?')
      .run(folderPath, exePath, matchedId);

    console.log(`[scan] Found pre-existing install (${matchedBy}): ${matchedId} → ${folderPath}`);
    found.push({ identifier: matchedId, installDir: folderPath, exePath, matchedBy });
  }

  return { found };
});

// ─── Install / Delete ─────────────────────────────────────────────────────────

ipcMain.handle('install-game', (_, { identifier, installDir, exePath }) => {
  if (!db) return { ok: false };
  db.prepare(`
    INSERT OR REPLACE INTO games (identifier, install_dir, exe_path, added_at)
    VALUES (?, ?, ?, ?)
  `).run(identifier, installDir, exePath || null, Date.now());
  return { ok: true };
});

ipcMain.handle('set-exe-path', (_, { identifier, exePath }) => {
  if (!db) return { ok: false };
  db.prepare('UPDATE games SET exe_path = ? WHERE identifier = ?').run(exePath || null, identifier);
  return { ok: true };
});

ipcMain.handle('delete-game', async (_, { identifier, installDir }) => {
  try {
    console.log(`[delete] identifier=${identifier} installDir=${installDir}`);
    if (installDir) {
      if (fs.existsSync(installDir)) {
        // Use shell.trashItem to move to Recycle Bin — avoids EPERM on locked folders
        // and is safer than force-deleting since the user can recover files if needed.
        await shell.trashItem(installDir);
        console.log(`[delete] Moved to Recycle Bin: ${installDir}`);
      } else {
        console.log(`[delete] Folder not found on disk (already gone?): ${installDir}`);
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
ipcMain.handle('archiveorg-autologin', async () => {
  // Check if already logged in from a previous session
  const ses = getSession();
  const c1      = await ses.cookies.get({ domain: 'archive.org' });
  const c2      = await ses.cookies.get({ domain: '.archive.org' });
  const c3      = await ses.cookies.get({ url: 'https://archive.org' });
  const cookies = [...new Map([...c1,...c2,...c3].map(c => [c.name+c.domain, c])).values()];
  const alreadyIn = cookies.some(c => c.name === 'logged-in-sig' || c.name === 'logged-in-user');
  if (alreadyIn) {
    const s = loadSettings();
    console.log('[autologin] already logged in as', s.archiveOrgUser || '(unknown)');
    return { ok: true, username: s.archiveOrgUser || null, method: 'cookie' };
  }

  // Not logged in — try saved credentials
  const acct = readThirdPartyAccount('archiveorg');
  console.log('[autologin] account check: hasLogin=', !!acct?.login, 'hasSecret=', !!acct?.secret, 'stoatUser=', acct?.stoatUserId || '(none)');
  if (!acct?.login || !acct?.secret) {
    return { ok: false, reason: 'no-credentials' };
  }
  const email = acct.login;
  const password = acct.secret;
  if (!password) return { ok: false, reason: 'decrypt-failed' };

  console.log('[autologin] logging in as', email);
  // Re-use the login handler logic inline
  return new Promise((resolve) => {
    const postBody = new URLSearchParams({
      email,
      password,
      remember:     'CHECKED',
      referer:      'https://archive.org/',
      login:        'true',
      submit_by_js: 'true',
    }).toString();
    const reqOptions = {
      hostname: 'archive.org',
      path:     '/services/xauthn/?op=login',
      method:   'POST',
      headers: {
        'Content-Type':     'application/x-www-form-urlencoded',
        'Content-Length':   Buffer.byteLength(postBody),
        'Referer':          'https://archive.org/account/login',
        'Origin':           'https://archive.org',
        'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':           'application/json, text/plain, */*',
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
            console.warn('[autologin] failed:', json.values?.reason || json.error);
            return resolve({ ok: false, reason: 'bad-credentials', error: json.values?.reason || json.error });
          }
          // Inject cookies
          for (const cookieStr of (res.headers['set-cookie'] || [])) {
            const parts    = cookieStr.split(';').map(x => x.trim());
            const [nv, ...attrs] = parts;
            const eqIdx   = nv.indexOf('=');
            if (eqIdx < 0) continue;
            const name    = nv.slice(0, eqIdx).trim();
            const value   = nv.slice(eqIdx + 1).trim();
            const attrMap = {};
            attrs.forEach(a => { const ai = a.indexOf('='); const k = (ai >= 0 ? a.slice(0, ai) : a).trim().toLowerCase(); attrMap[k] = ai >= 0 ? a.slice(ai+1).trim() : ''; });
            try {
              await ses.cookies.set({
                url: `https://archive.org${attrMap['path'] || '/'}`,
                name, value,
                domain:   attrMap['domain'] || '.archive.org',
                path:     attrMap['path']   || '/',
                secure:   'secure'   in attrMap,
                httpOnly: 'httponly' in attrMap,
              });
            } catch {}
          }
          await ses.cookies.flushStore();
            const username = json.values?.screenname || json.values?.username || email;
            const cfg = loadSettings();
            cfg.archiveOrgUser = username;
            saveSettings(cfg);
          console.log('[autologin] success as', username);
          resolve({ ok: true, username, method: 'credentials' });
        } catch (e) {
          resolve({ ok: false, reason: 'error', error: e.message });
        }
      });
    });
    req.on('error', err => resolve({ ok: false, reason: 'error', error: err.message }));
    req.write(postBody);
    req.end();
  });
});

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

ipcMain.handle('archiveorg-login', async (_, { email, password }) => {
  // Use Node's https module so we can capture Set-Cookie headers manually
  // and inject them into Electron's session. The net module doesn't reliably
  // persist response cookies back into the session cookie store.
  return new Promise((resolve) => {
    const postBody = new URLSearchParams({
      email,
      password,
      remember:     'CHECKED',
      referer:      'https://archive.org/',
      login:        'true',
      submit_by_js: 'true',
    }).toString();

    const reqOptions = {
      hostname: 'archive.org',
      path:     '/services/xauthn/?op=login',
      method:   'POST',
      headers: {
        'Content-Type':     'application/x-www-form-urlencoded',
        'Content-Length':   Buffer.byteLength(postBody),
        'Referer':          'https://archive.org/account/login',
        'Origin':           'https://archive.org',
        'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':           'application/json, text/plain, */*',
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
            return resolve({ ok: false, error: msg });
          }

          // Parse and inject all Set-Cookie headers into Electron's session
          const ses = getSession();
          const setCookieHeaders = res.headers['set-cookie'] || [];

          for (const cookieStr of setCookieHeaders) {
            // Parse "name=value; Path=/; Domain=.archive.org; ..."
            const parts = cookieStr.split(';').map(s => s.trim());
            const [nameVal, ...attrs] = parts;
            const eqIdx = nameVal.indexOf('=');
            if (eqIdx < 0) continue;
            const name  = nameVal.slice(0, eqIdx).trim();
            const value = nameVal.slice(eqIdx + 1).trim();

            const attrMap = {};
            for (const attr of attrs) {
              const ai = attr.indexOf('=');
              const k  = (ai >= 0 ? attr.slice(0, ai) : attr).trim().toLowerCase();
              const v  = ai >= 0 ? attr.slice(ai + 1).trim() : '';
              attrMap[k] = v;
            }

            const cookieDomain = attrMap['domain'] || '.archive.org';
            const cookiePath   = attrMap['path']   || '/';
            const secure       = 'secure' in attrMap;

            try {
              await ses.cookies.set({
                url:    `https://archive.org${cookiePath}`,
                name,
                value,
                domain: cookieDomain,
                path:   cookiePath,
                secure,
                httpOnly: 'httponly' in attrMap,
              });
            } catch (ce) {
              console.warn('[login] Failed to set cookie:', name, ce.message);
            }
          }

          // Flush cookies to disk
          await ses.cookies.flushStore();

          // Verify they landed
          const verify = await ses.cookies.get({ url: 'https://archive.org' });
          console.log('[login] cookies after flush:', verify.map(c => `${c.name}@${c.domain}`));

          const username = json.values?.screenname || json.values?.username || email;
          const s = loadSettings();
          s.archiveOrgUser = username;
          saveSettings(s);
          resolve({ ok: true, username });
        } catch (e) {
          resolve({ ok: false, error: `Parse error: ${e.message} | body: ${body.slice(0, 200)}` });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(postBody);
    req.end();
  });
});

ipcMain.handle('archiveorg-logout', async () => {
  const ses = getSession();
  // Clear archive.org cookies
  const cookies = await ses.cookies.get({ domain: '.archive.org' });
  for (const cookie of cookies) {
    const cookieUrl = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
    await ses.cookies.remove(cookieUrl, cookie.name);
  }
  const s = loadSettings();
  delete s.archiveOrgUser;
  saveSettings(s);
  return { ok: true };
});

ipcMain.handle('archiveorg-check', async () => {
  const ses = getSession();
  // Query both with and without leading dot — Electron is inconsistent
  const c1 = await ses.cookies.get({ domain: 'archive.org' });
  const c2 = await ses.cookies.get({ domain: '.archive.org' });
  const c3 = await ses.cookies.get({ url: 'https://archive.org' });
  const cookies = [...new Map([...c1,...c2,...c3].map(c => [c.name+c.domain, c])).values()];
  console.log('[archiveorg-check] all archive.org cookies:', cookies.map(c => `${c.name}@${c.domain}`));
  const loggedIn = cookies.some(c => c.name === 'logged-in-sig' || c.name === 'logged-in-user');
  const s = loadSettings();
  return { loggedIn, username: s.archiveOrgUser || null };
});

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

// fetch-rom-list: loads from bundled static JSON asset (assets/roms/roms-snes.json).
// The ROM list is pre-built and shipped with the app — no network fetch, no login needed.
// Individual ROM downloads still go to archive.org via the URLs in the JSON.
ipcMain.handle('fetch-rom-list', async (_, { system }) => {
  // Memory cache — same session
  if (romListCache[system]) {
    return { ok: true, roms: romListCache[system], cached: true, source: 'memory' };
  }

  // Resolve path to bundled ROM list
  // Dev:     assets/roms/roms-snes.json  (relative to project root)
  // Packaged: resources/roms/roms-snes.json
  const romsFileName = `roms-${system}.json`;
  const devPath      = path.join(__dirname, '../../assets/roms', romsFileName);
  const packedPath   = path.join(process.resourcesPath || '', 'roms', romsFileName);
  const romsPath     = fs.existsSync(devPath) ? devPath : packedPath;

  if (!fs.existsSync(romsPath)) {
    return { ok: false, error: `ROM list file not found: ${romsPath}` };
  }

  try {
    console.log(`[fetch-rom-list] loading from ${romsPath}`);
    const roms = JSON.parse(fs.readFileSync(romsPath, 'utf8'));
    console.log(`[fetch-rom-list] loaded ${roms.length} ROMs`);
    romListCache[system] = roms;
    return { ok: true, roms, cached: false, source: 'bundled' };
  } catch (e) {
    return { ok: false, error: `Failed to parse ROM list: ${e.message}` };
  }
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

ipcMain.handle('launch-rom', async (_, { romPath, system }) => {
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

  const token = await getHltbToken();
  if (!token) return { ok: false, skipped: false, error: 'no token' };

  const body = JSON.stringify({
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
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'howlongtobeat.com', path: '/api/finder', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'Referer': 'https://howlongtobeat.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': '*/*', 'x-auth-token': token,
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
let _hltbToken = null;
let _hltbTokenExpiry = 0;

function getHltbToken() {
  if (_hltbToken && Date.now() < _hltbTokenExpiry) return Promise.resolve(_hltbToken);
  return new Promise((resolve) => {
    https.get(`https://howlongtobeat.com/api/finder/init?t=${Date.now()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer':    'https://howlongtobeat.com/',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          _hltbToken       = JSON.parse(data).token || null;
          _hltbTokenExpiry = Date.now() + 55 * 60 * 1000;
          console.log('[hltb] token ok:', !!_hltbToken);
        } catch { _hltbToken = null; }
        resolve(_hltbToken);
      });
    }).on('error', () => resolve(null));
  });
}

ipcMain.handle('hltb-search', async (_, { cleanName }) => {
  const slug      = cleanName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const cachePath = path.join(HLTB_CACHE_DIR, `${slug}.json`);

  // Serve from disk cache
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return { ok: cached !== null, data: cached, cached: true };
    } catch {}
  }

  const token = await getHltbToken();
  if (!token) {
    fs.writeFileSync(cachePath, JSON.stringify(null));
    return { ok: false, error: 'Could not get HLTB auth token' };
  }

  const body = JSON.stringify({
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
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'howlongtobeat.com',
      path:     '/api/finder',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Referer':        'https://howlongtobeat.com/',
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':         '*/*',
        'x-auth-token':   token,
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

        // Fetch game page for SSR metadata (__NEXT_DATA__)
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

        // async IIFE so we can await fetchMeta inside this sync callback
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
            console.log('[hltb] found:', result.title, result.main, result.mainExtra, result.completionist);
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
});

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

ipcMain.handle('ra-game-search', async (_, { cleanName, system }) => {
  const settings = loadSettings();
  const raAccount = readThirdPartyAccount('retroachievements');
  const apiKey   = raAccount.secret || settings.retroAchievementsKey || '';
  if (!apiKey) return { ok: false, error: 'no-key' };

  const consoleId = RA_CONSOLE_MAP[system] || RA_CONSOLE_MAP.snes;

  const slug      = cleanName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const extCache  = path.join(RA_CACHE_DIR, `ext_${consoleId}_${slug}.json`);
  if (fs.existsSync(extCache)) {
    try {
      const stat = fs.statSync(extCache);
      if (Date.now() - stat.mtimeMs < 7 * 24 * 60 * 60 * 1000) {
        const cached = JSON.parse(fs.readFileSync(extCache, 'utf8'));
        return { ok: true, data: cached, cached: true };
      }
    } catch {}
  }

  const games = await raGetGameList(consoleId, apiKey);
  if (!games) return { ok: false, error: 'Could not fetch RA game list' };

  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target    = normalize(cleanName);
  const scored    = games
    .map(g => {
      const t = normalize(g.Title || '');
      const sim = t === target ? 1 : t.includes(target) || target.includes(t) ? 0.8 : 0.3;
      return { ...g, _sim: sim };
    })
    .filter(g => g._sim > 0.3)
    .sort((a, b) => b._sim - a._sim);

  if (!scored.length) return { ok: false, error: 'Game not found on RetroAchievements' };
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

          const result = {
            id:              ext.ID,
            title:           ext.Title,
            imageIcon:       ext.ImageIcon ? `https://retroachievements.org${ext.ImageIcon}` : null,
            numAchievements: achievements.length,
            totalPoints:     achievements.reduce((s, a) => s + (a.points || 0), 0),
            numPlayers:      ext.NumDistinctPlayersCasual || 0,
            achievements,
            gameUrl:         `https://retroachievements.org/game/${ext.ID}`,
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
});

// ─── ROM cover art via SteamGridDB ─────────────────────────────────────────

const SGDB_CACHE_DIR = path.join(app.getPath('userData'), 'artcache');
if (!fs.existsSync(SGDB_CACHE_DIR)) fs.mkdirSync(SGDB_CACHE_DIR, { recursive: true });

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

ipcMain.handle('get-rom-art', async (_, { cleanName, system }) => {
  const settings = loadSettings();
  const sgdbAccount = readThirdPartyAccount('steamgriddb');
  const apiKey   = sgdbAccount.secret || settings.steamGridDbKey || '';
  if (!apiKey) return { ok: false, error: 'No SteamGridDB API key configured' };

  const slug      = cleanName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const cacheKey  = `${system}_grid_${slug}`;
  const cachePath = path.join(SGDB_CACHE_DIR, `${cacheKey}.jpg`);
  const cacheUrl  = 'file:///' + cachePath.replace(/\\/g, '/');

  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1024)
    return { ok: true, url: cacheUrl, cached: true };

  const game = await sgdbSearch(cleanName, apiKey);
  if (!game?.id) return { ok: false, error: 'Game not found on SteamGridDB' };

  return new Promise((resolve) => {
    const artUrl = `https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=600x900&limit=1`;
    https.get(artUrl, { headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', async () => {
        try {
          const imgUrl = JSON.parse(data)?.data?.[0]?.url;
          if (!imgUrl) return resolve({ ok: false, error: 'No grid art found' });
          const ok = await downloadFile(imgUrl, cachePath);
          resolve(ok ? { ok: true, url: cacheUrl, cached: false } : { ok: false, error: 'Download failed' });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    }).on('error', err => resolve({ ok: false, error: err.message }));
  });
});

ipcMain.handle('get-rom-logo', async (_, { cleanName, system }) => {
  const settings = loadSettings();
  const sgdbAccount = readThirdPartyAccount('steamgriddb');
  const apiKey   = sgdbAccount.secret || settings.steamGridDbKey || '';
  if (!apiKey) return { ok: false, error: 'No SteamGridDB API key configured' };

  const slug      = cleanName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const cacheKey  = `${system}_logo_${slug}`;
  const cachePath = path.join(SGDB_CACHE_DIR, `${cacheKey}.png`);
  const cacheUrl  = 'file:///' + cachePath.replace(/\\/g, '/');
  const missingPath = path.join(SGDB_CACHE_DIR, `${cacheKey}.missing`);

  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 512)
    return { ok: true, url: cacheUrl, cached: true };
  if (fs.existsSync(missingPath))
    return { ok: false, error: 'No logo (cached miss)', miss: true };

  const game = await sgdbSearch(cleanName, apiKey);
  if (!game?.id) {
    fs.writeFileSync(missingPath, '');
    return { ok: false, error: 'Game not found' };
  }

  return new Promise((resolve) => {
    const logoUrl = `https://www.steamgriddb.com/api/v2/logos/game/${game.id}?limit=1`;
    https.get(logoUrl, { headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'SKALD-Launcher/0.1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', async () => {
        try {
          const imgUrl = JSON.parse(data)?.data?.[0]?.url;
          if (!imgUrl) {
            fs.writeFileSync(missingPath, '');
            return resolve({ ok: false, error: 'No logo found', miss: true });
          }
          const ok = await downloadFile(imgUrl, cachePath);
          if (ok) resolve({ ok: true, url: cacheUrl, cached: false });
          else    resolve({ ok: false, error: 'Download failed' });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    }).on('error', err => resolve({ ok: false, error: err.message }));
  });
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
