'use strict';

function createSaveManager({
  fs,
  path,
  userDataDir,
  loadSettings,
  getActiveProfileId,
  getActiveProfileName,
}) {
  const SAVE_ROOT = userDataDir ? path.join(userDataDir, 'saves') : '';
  const SESSION_ROOT = SAVE_ROOT ? path.join(SAVE_ROOT, '_sessions') : '';

  const SUPPORTED_EMULATORS = {
    pcsx2: {
      label: 'PCSX2',
      system: 'ps2',
      runtimeFolder: 'pcsx2',
      vaultStrategy: 'game',
      folders: [
        { id: 'memcards', label: 'Memory Cards', relativePath: 'memcards' },
        { id: 'sstates', label: 'Save States', relativePath: 'sstates' },
      ],
    },
    duckstation: {
      label: 'DuckStation',
      system: 'psx',
      runtimeFolder: 'duckstation',
      vaultStrategy: 'game',
      folders: [
        { id: 'memcards', label: 'Memory Cards', relativePath: 'memcards' },
        { id: 'savestates', label: 'Save States', relativePath: 'savestates' },
      ],
    },
    dolphin: {
      label: 'Dolphin',
      system: 'gamecube',
      vaultStrategy: 'system',
      resolveRuntimeRoot(settings = {}) {
        const dolphin = settings?.emulators?.dolphin || {};
        const customExecutablePath = String(dolphin.customExecutablePath || '').trim();
        if (customExecutablePath) return path.dirname(customExecutablePath);
        return path.join(userDataDir, 'emulators', 'dolphin-stable');
      },
      folders: [
        { id: 'gc', label: 'GameCube Saves', relativePath: path.join('User', 'GC') },
        { id: 'wii', label: 'Wii Saves', relativePath: path.join('User', 'Wii') },
        { id: 'statesaves', label: 'Save States', relativePath: path.join('User', 'StateSaves') },
      ],
    },
    cemu: {
      label: 'Cemu',
      system: 'wiiu',
      vaultStrategy: 'system',
      resolveRuntimeRoot(settings = {}) {
        const cemu = settings?.emulators?.cemu || {};
        const customExecutablePath = String(cemu.customExecutablePath || '').trim();
        if (customExecutablePath) return path.dirname(customExecutablePath);
        return path.join(userDataDir, 'emulators', 'cemu');
      },
      folders: [
        { id: 'savedata', label: 'Save Data', relativePath: path.join('portable', 'mlc01', 'usr', 'save') },
      ],
    },
  };

  function sanitizeSegment(value, fallback = 'unknown') {
    const clean = String(value || '')
      .trim()
      .replace(/^local:/i, 'local-')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
    return clean || fallback;
  }

  function ensureDir(dirPath) {
    if (!dirPath) return;
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  }

  function copyDirectoryContents(sourceDir, targetDir) {
    if (!sourceDir || !targetDir || !fs.existsSync(sourceDir)) return { copied: 0, bytes: 0 };
    ensureDir(targetDir);
    let copied = 0;
    let bytes = 0;
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        const nested = copyDirectoryContents(sourcePath, targetPath);
        copied += nested.copied;
        bytes += nested.bytes;
      } else if (entry.isFile()) {
        ensureDir(path.dirname(targetPath));
        fs.copyFileSync(sourcePath, targetPath);
        copied += 1;
        try { bytes += fs.statSync(sourcePath).size || 0; } catch {}
      }
    }
    return { copied, bytes };
  }

  function clearDirectoryContents(dirPath) {
    if (!dirPath) return { removedFiles: 0, removedDirs: 0 };
    ensureDir(dirPath);
    let removedFiles = 0;
    let removedDirs = 0;
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return { removedFiles, removedDirs };
    }
    for (const entry of entries) {
      const targetPath = path.join(dirPath, entry.name);
      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
        if (entry.isDirectory()) removedDirs += 1;
        else removedFiles += 1;
      } catch {}
    }
    return { removedFiles, removedDirs };
  }

  function getDirectoryStats(dirPath) {
    const stats = {
      exists: !!dirPath && fs.existsSync(dirPath),
      fileCount: 0,
      dirCount: 0,
      totalBytes: 0,
      lastModifiedMs: 0,
    };
    if (!stats.exists) return stats;
    const walk = (currentDir) => {
      let entries = [];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stats.dirCount += 1;
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        stats.fileCount += 1;
        try {
          const fileStat = fs.statSync(fullPath);
          stats.totalBytes += Number(fileStat.size || 0);
          stats.lastModifiedMs = Math.max(stats.lastModifiedMs, Math.round(fileStat.mtimeMs || 0));
        } catch {}
      }
    };
    walk(dirPath);
    return stats;
  }

  function buildDirectorySnapshot(dirPath) {
    const snapshot = {};
    if (!dirPath || !fs.existsSync(dirPath)) return snapshot;
    const walk = (currentDir) => {
      let entries = [];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            const rel = path.relative(dirPath, fullPath).replace(/\\/g, '/');
            snapshot[rel] = { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
          } catch {}
        }
      }
    };
    walk(dirPath);
    return snapshot;
  }

  function diffSnapshots(before = {}, after = {}) {
    const created = [];
    const changed = [];
    const deleted = [];
    for (const [file, info] of Object.entries(after || {})) {
      if (!before[file]) created.push(file);
      else if (before[file].size !== info.size || before[file].mtimeMs !== info.mtimeMs) changed.push(file);
    }
    for (const file of Object.keys(before || {})) {
      if (!after[file]) deleted.push(file);
    }
    return { created, changed, deleted };
  }

  function getActiveProfileKey() {
    const profileId = typeof getActiveProfileId === 'function' ? getActiveProfileId() : '';
    return sanitizeSegment(profileId, 'default-profile');
  }

  function getActiveProfileNameKey() {
    const profileName = typeof getActiveProfileName === 'function' ? getActiveProfileName() : '';
    return sanitizeSegment(profileName, '');
  }

  function getProfileFolderName(profileKey = getActiveProfileKey(), profileNameKey = getActiveProfileNameKey()) {
    const safeKey = sanitizeSegment(profileKey, 'default-profile');
    const safeName = sanitizeSegment(profileNameKey, '');
    return safeName ? `${safeName}__${safeKey}` : safeKey;
  }

  function getGameKey(session = {}) {
    return sanitizeSegment(session.identifier || session.title || session.romPath || session.sourcePath, 'unknown-game');
  }

  function getProfileSaveRoot(profileKey = getActiveProfileKey(), profileNameKey = getActiveProfileNameKey()) {
    return SAVE_ROOT ? path.join(SAVE_ROOT, 'profiles', getProfileFolderName(profileKey, profileNameKey)) : '';
  }

  function getProfileSaveRootFromFolderName(profileFolderName = '', profileKey = getActiveProfileKey()) {
    if (!SAVE_ROOT) return '';
    const normalizedFolderName = sanitizeSegment(profileFolderName, '');
    if (normalizedFolderName) return path.join(SAVE_ROOT, 'profiles', normalizedFolderName);
    return path.join(SAVE_ROOT, 'profiles', sanitizeSegment(profileKey, 'default-profile'));
  }

  function getLegacyProfileSaveRoots(profileKey = getActiveProfileKey()) {
    if (!SAVE_ROOT) return [];
    const safeKey = sanitizeSegment(profileKey, 'default-profile');
    return [
      path.join(SAVE_ROOT, 'profiles', safeKey),
    ];
  }

  function getExistingVaultDir(primaryDir, fallbackDirs = []) {
    if (primaryDir && fs.existsSync(primaryDir)) return primaryDir;
    for (const candidate of fallbackDirs) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return primaryDir;
  }

  function getCloudSettings(settings = loadSettings()) {
    const saveCloud = settings?.saveCloud && typeof settings.saveCloud === 'object' ? settings.saveCloud : {};
    return {
      enabled: saveCloud.enabled === true,
      provider: String(saveCloud.provider || '').trim(),
      autoBackup: saveCloud.autoBackup !== false,
      lastConfiguredAt: saveCloud.lastConfiguredAt || null,
    };
  }

  function getTrackedTargets(session = {}) {
    const emulatorId = String(session.emulatorId || session.type || '').trim().toLowerCase();
    const spec = SUPPORTED_EMULATORS[emulatorId];
    if (!spec || !userDataDir) return [];
    const settings = loadSettings();
    const runtimeRoot = typeof spec.resolveRuntimeRoot === 'function'
      ? String(spec.resolveRuntimeRoot(settings, session) || '').trim()
      : path.join(userDataDir, 'emulators', spec.runtimeFolder);
    const profileKey = getActiveProfileKey();
    const profileNameKey = getActiveProfileNameKey();
    const gameKey = getGameKey(session);
    const primaryProfileRoot = getProfileSaveRoot(profileKey, profileNameKey);
    const legacyProfileRoots = getLegacyProfileSaveRoots(profileKey);
    const vaultRoot = spec.vaultStrategy === 'system'
      ? path.join(primaryProfileRoot, spec.system, emulatorId)
      : path.join(primaryProfileRoot, spec.system, gameKey, emulatorId);
    return spec.folders.map(folder => ({
      emulatorId,
      emulatorLabel: spec.label,
      system: spec.system,
      profileKey,
      profileFolderName: getProfileFolderName(profileKey, profileNameKey),
      gameKey,
      folderId: folder.id,
      label: folder.label,
      sourceDir: path.join(runtimeRoot, folder.relativePath),
      vaultDir: path.join(vaultRoot, folder.id),
      legacyVaultDirs: legacyProfileRoots.map((profileRoot) => {
        const legacyVaultRoot = spec.vaultStrategy === 'system'
          ? path.join(profileRoot, spec.system, emulatorId)
          : path.join(profileRoot, spec.system, gameKey, emulatorId);
        return path.join(legacyVaultRoot, folder.id);
      }),
    }));
  }

  function writeJson(filePath, payload) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  function readJson(filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  function sessionStatePath(sessionId) {
    return SESSION_ROOT ? path.join(SESSION_ROOT, `${sanitizeSegment(sessionId)}.json`) : '';
  }

  function prepareSessionLaunch(session = {}) {
    if (!SAVE_ROOT) return { ok: true, skipped: true, reason: 'save manager unavailable' };
    const targets = getTrackedTargets(session);
    if (!targets.length) return { ok: true, skipped: true, reason: 'unsupported emulator' };
    const restoredFolders = [];
    let restoredFiles = 0;
    let restoredBytes = 0;
    for (const target of targets) {
      ensureDir(target.sourceDir);
      const cleared = clearDirectoryContents(target.sourceDir);
      const restoreVaultDir = getExistingVaultDir(target.vaultDir, target.legacyVaultDirs);
      const copied = fs.existsSync(restoreVaultDir)
        ? copyDirectoryContents(restoreVaultDir, target.sourceDir)
        : { copied: 0, bytes: 0 };
      restoredFiles += copied.copied;
      restoredBytes += copied.bytes;
      restoredFolders.push({
        folderId: target.folderId,
        label: target.label,
        sourceDir: target.sourceDir,
        vaultDir: target.vaultDir,
        restoreVaultDir,
        cleared,
        copied,
        hasVault: !!restoreVaultDir && fs.existsSync(restoreVaultDir),
      });
    }
    return {
      ok: true,
      profileKey: targets[0]?.profileKey || getActiveProfileKey(),
      profileFolderName: targets[0]?.profileFolderName || getProfileFolderName(),
      gameKey: targets[0]?.gameKey || getGameKey(session),
      emulatorId: targets[0]?.emulatorId || String(session.emulatorId || session.type || ''),
      system: targets[0]?.system || String(session.system || ''),
      restoredFolders,
      restoredFiles,
      restoredBytes,
    };
  }

  function onSessionStarted(session = {}) {
    if (!SAVE_ROOT || !session?.id) return { ok: true, skipped: true, reason: 'save manager unavailable' };
    const targets = getTrackedTargets(session);
    if (!targets.length) return { ok: true, skipped: true, reason: 'unsupported emulator' };
    const snapshots = {};
    for (const target of targets) {
      ensureDir(target.vaultDir);
      snapshots[target.folderId] = buildDirectorySnapshot(target.sourceDir);
    }
    const record = {
      sessionId: String(session.id),
      startedAt: Date.now(),
      profileKey: targets[0]?.profileKey || getActiveProfileKey(),
      profileFolderName: targets[0]?.profileFolderName || getProfileFolderName(),
      gameKey: targets[0]?.gameKey || getGameKey(session),
      emulatorId: targets[0]?.emulatorId || String(session.emulatorId || ''),
      system: targets[0]?.system || String(session.system || ''),
      title: String(session.title || ''),
      identifier: session.identifier || null,
      targets: targets.map(target => ({
        folderId: target.folderId,
        label: target.label,
        sourceDir: target.sourceDir,
        vaultDir: target.vaultDir,
      })),
      snapshots,
    };
    writeJson(sessionStatePath(session.id), record);
    return { ok: true, tracked: targets.length, record };
  }

  function onSessionEnded(session = {}) {
    if (!SAVE_ROOT || !session?.id) return { ok: true, skipped: true, reason: 'save manager unavailable' };
    const record = readJson(sessionStatePath(session.id));
    const targets = getTrackedTargets(session);
    if (!record && !targets.length) return { ok: true, skipped: true, reason: 'unsupported emulator' };
    const effectiveTargets = targets.length ? targets : (record?.targets || []);
    const changedFolders = [];
    let copiedFiles = 0;
    let copiedBytes = 0;
    for (const target of effectiveTargets) {
      const sourceDir = target.sourceDir;
      const vaultDir = target.vaultDir;
      const before = record?.snapshots?.[target.folderId] || {};
      const after = buildDirectorySnapshot(sourceDir);
      const diff = diffSnapshots(before, after);
      const changed = diff.created.length || diff.changed.length || diff.deleted.length;
      if (!changed) continue;
      const copied = copyDirectoryContents(sourceDir, vaultDir);
      copiedFiles += copied.copied;
      copiedBytes += copied.bytes;
      changedFolders.push({
        folderId: target.folderId,
        label: target.label,
        sourceDir,
        vaultDir,
        diff,
        copied,
      });
    }
    const backupRecord = {
      backedUpAt: Date.now(),
      sessionId: String(session.id),
      profileKey: record?.profileKey || targets[0]?.profileKey || getActiveProfileKey(),
      profileFolderName: record?.profileFolderName || targets[0]?.profileFolderName || getProfileFolderName(),
      gameKey: record?.gameKey || targets[0]?.gameKey || getGameKey(session),
      emulatorId: record?.emulatorId || targets[0]?.emulatorId || String(session.emulatorId || ''),
      system: record?.system || targets[0]?.system || String(session.system || ''),
      title: String(session.title || record?.title || ''),
      identifier: session.identifier || record?.identifier || null,
      changedFolders,
      copiedFiles,
      copiedBytes,
      cloud: getCloudSettings(),
    };
    if (changedFolders.length) {
      const manifestPath = path.join(
        getProfileSaveRootFromFolderName(backupRecord.profileFolderName, backupRecord.profileKey),
        backupRecord.system || 'unknown-system',
        backupRecord.gameKey || 'unknown-game',
        backupRecord.emulatorId || 'unknown-emulator',
        'manifest.json',
      );
      writeJson(manifestPath, backupRecord);
    }
    try { fs.rmSync(sessionStatePath(session.id), { force: true }); } catch {}
    return { ok: true, ...backupRecord };
  }

  function getStatus(settings = loadSettings()) {
    const profileKey = getActiveProfileKey();
    const profileRoot = getProfileSaveRoot(profileKey);
    const cloud = getCloudSettings(settings);
    const supported = Object.entries(SUPPORTED_EMULATORS).map(([id, spec]) => ({
      id,
      label: spec.label,
      system: spec.system,
      vaultStrategy: spec.vaultStrategy || 'game',
      folders: spec.folders.map(folder => folder.id),
    }));
    return {
      ok: true,
      saveRoot: SAVE_ROOT,
      profileKey,
      profileFolderName: getProfileFolderName(profileKey),
      profileRoot,
      cloud,
      supported,
      profileRootExists: !!profileRoot && fs.existsSync(profileRoot),
    };
  }

  function listProfileSaves(settings = loadSettings()) {
    const profileKey = getActiveProfileKey();
    const profileNameKey = getActiveProfileNameKey();
    const profileFolderName = getProfileFolderName(profileKey, profileNameKey);
    const profileRoot = getProfileSaveRoot(profileKey, profileNameKey);
    const cloud = getCloudSettings(settings);
    const emulators = Object.entries(SUPPORTED_EMULATORS).map(([id, spec]) => {
      const systemRoot = profileRoot ? path.join(profileRoot, spec.system) : '';
      let gameCount = 0;
      let fileCount = 0;
      let totalBytes = 0;
      let lastModifiedMs = 0;
      let rootPath = '';
      let recentTitle = '';
      if (spec.vaultStrategy === 'system') {
        rootPath = systemRoot ? path.join(systemRoot, id) : '';
        const rootStats = getDirectoryStats(rootPath);
        fileCount = rootStats.fileCount;
        totalBytes = rootStats.totalBytes;
        lastModifiedMs = rootStats.lastModifiedMs;
        if (rootStats.exists && (rootStats.fileCount || rootStats.dirCount)) gameCount = 1;
      } else {
        rootPath = systemRoot;
        if (systemRoot && fs.existsSync(systemRoot)) {
          let gameDirs = [];
          try { gameDirs = fs.readdirSync(systemRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()); } catch {}
          for (const entry of gameDirs) {
            const emulatorRoot = path.join(systemRoot, entry.name, id);
            const emulatorStats = getDirectoryStats(emulatorRoot);
            if (!emulatorStats.exists || (!emulatorStats.fileCount && !emulatorStats.dirCount)) continue;
            gameCount += 1;
            fileCount += emulatorStats.fileCount;
            totalBytes += emulatorStats.totalBytes;
            lastModifiedMs = Math.max(lastModifiedMs, emulatorStats.lastModifiedMs);
            const manifestPath = path.join(emulatorRoot, 'manifest.json');
            const manifest = readJson(manifestPath);
            const manifestTime = Number(manifest?.backedUpAt || 0);
            if (manifestTime >= lastModifiedMs && manifest?.title) recentTitle = String(manifest.title || '').trim();
          }
        }
      }
      return {
        id,
        label: spec.label,
        system: spec.system,
        vaultStrategy: spec.vaultStrategy || 'game',
        rootPath,
        available: !!rootPath && fs.existsSync(rootPath),
        folderCount: spec.folders.length,
        gameCount,
        fileCount,
        totalBytes,
        lastModifiedMs,
        recentTitle: recentTitle || '',
      };
    });
    const totalFiles = emulators.reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0);
    const totalBytes = emulators.reduce((sum, entry) => sum + Number(entry.totalBytes || 0), 0);
    const totalGames = emulators.reduce((sum, entry) => sum + Number(entry.gameCount || 0), 0);
    const lastModifiedMs = emulators.reduce((latest, entry) => Math.max(latest, Number(entry.lastModifiedMs || 0)), 0);
    return {
      ok: true,
      saveRoot: SAVE_ROOT,
      profileKey,
      profileFolderName,
      profileRoot,
      profileRootExists: !!profileRoot && fs.existsSync(profileRoot),
      cloud,
      emulators,
      summary: {
        emulatorCount: emulators.filter(entry => entry.available || entry.gameCount > 0).length,
        gameCount: totalGames,
        fileCount: totalFiles,
        totalBytes,
        lastModifiedMs,
      },
    };
  }

  return {
    prepareSessionLaunch,
    getStatus,
    listProfileSaves,
    onSessionStarted,
    onSessionEnded,
    getProfileSaveRoot,
  };
}

module.exports = { createSaveManager };
