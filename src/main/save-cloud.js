'use strict';

function createSaveCloudManager({
  fs,
  path,
  https,
  loadSettings,
  saveSettings,
  getDropboxAccessToken,
  saveManager,
}) {
  const DROPBOX_API = 'https://api.dropboxapi.com/2';
  const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2';
  const DROPBOX_PROVIDER = 'savecloud-dropbox';
  const REMOTE_ROOT = '/Save Vaults';

  let transferState = {
    active: false,
    provider: '',
    action: '',
    message: '',
    percent: 0,
    updatedAt: 0,
    error: '',
    remotePath: '',
    lastBackupAt: 0,
    lastRestoreAt: 0,
    lastErrorAt: 0,
    lastError: '',
    lastSnapshotPath: '',
  };

  function normalizeSaveCloudSettings(settings = loadSettings()) {
    const saveCloud = settings?.saveCloud && typeof settings.saveCloud === 'object' ? settings.saveCloud : {};
    const provider = String(saveCloud.provider || '').trim();
    const normalizedProvider = provider === DROPBOX_PROVIDER ? provider : '';
    return {
      enabled: normalizedProvider ? saveCloud.enabled === true : false,
      provider: normalizedProvider,
      autoBackup: saveCloud.autoBackup !== false,
      lastConfiguredAt: saveCloud.lastConfiguredAt || null,
      lastBackupAt: Number(saveCloud.lastBackupAt || 0) || 0,
      lastRestoreAt: Number(saveCloud.lastRestoreAt || 0) || 0,
      lastErrorAt: Number(saveCloud.lastErrorAt || 0) || 0,
      lastError: String(saveCloud.lastError || '').trim(),
      lastSnapshotPath: String(saveCloud.lastSnapshotPath || '').trim(),
    };
  }

  function persistCloudState(patch = {}) {
    if (typeof saveSettings !== 'function') return;
    try {
      const settings = loadSettings();
      const current = normalizeSaveCloudSettings(settings);
      settings.saveCloud = {
        ...current,
        ...patch,
      };
      saveSettings(settings);
    } catch {}
  }

  function setTransferState(next = {}) {
    transferState = {
      ...transferState,
      ...next,
      updatedAt: Date.now(),
    };
  }

  function getStatus(settings = loadSettings()) {
    const persisted = normalizeSaveCloudSettings(settings);
    return {
      ok: true,
      saveCloud: persisted,
      transfer: {
        ...transferState,
        lastBackupAt: transferState.lastBackupAt || persisted.lastBackupAt || 0,
        lastRestoreAt: transferState.lastRestoreAt || persisted.lastRestoreAt || 0,
        lastErrorAt: transferState.lastErrorAt || persisted.lastErrorAt || 0,
        lastError: transferState.lastError || persisted.lastError || '',
        lastSnapshotPath: transferState.lastSnapshotPath || persisted.lastSnapshotPath || '',
      },
    };
  }

  function ensureDir(dirPath) {
    if (!dirPath) return;
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  }

  function clearDirectoryContents(dirPath) {
    if (!dirPath) return;
    ensureDir(dirPath);
    let entries = [];
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const targetPath = path.join(dirPath, entry.name);
      try { fs.rmSync(targetPath, { recursive: true, force: true }); } catch {}
    }
  }

  function walkLocalFiles(rootDir) {
    const files = [];
    if (!rootDir || !fs.existsSync(rootDir)) return files;
    const walk = (currentDir) => {
      let entries = [];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        let stat = null;
        try { stat = fs.statSync(fullPath); } catch {}
        files.push({
          fullPath,
          relativePath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
          size: Number(stat?.size || 0),
          mtimeMs: Number(Math.round(stat?.mtimeMs || 0)),
        });
      }
    };
    walk(rootDir);
    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  function countManifest(files = []) {
    return {
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
      generatedAt: Date.now(),
      skald: 'dropbox-v1',
      files: files.map((file) => ({
        relativePath: file.relativePath,
        size: Number(file.size || 0),
        mtimeMs: Number(file.mtimeMs || 0),
      })),
    };
  }

  function describeDropboxError(parsed, fallback) {
    if (!parsed || typeof parsed !== 'object') return fallback;
    if (typeof parsed.error_summary === 'string' && parsed.error_summary.trim()) return parsed.error_summary.trim();
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    try {
      return JSON.stringify(parsed.error || parsed);
    } catch {}
    return fallback;
  }

  function dropboxRpc(endpoint, accessToken, payload = {}) {
    const target = new URL(`${DROPBOX_API}/${endpoint}`);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    return new Promise((resolve) => {
      const req = https.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
        },
        timeout: 60000,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const statusCode = Number(res.statusCode || 0);
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch {}
          if (statusCode >= 200 && statusCode < 300) {
            return resolve({ ok: true, statusCode, data: parsed || {} });
          }
          resolve({
            ok: false,
            statusCode,
            error: describeDropboxError(parsed, `Dropbox API ${endpoint} failed (${statusCode}).`),
            raw: text,
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Dropbox request timed out.')));
      req.on('error', (error) => resolve({ ok: false, error: error?.message || `Dropbox API ${endpoint} failed.` }));
      req.write(body);
      req.end();
    });
  }

  function dropboxUpload(accessToken, remotePath, buffer) {
    const target = new URL(`${DROPBOX_CONTENT}/files/upload`);
    return new Promise((resolve) => {
      const req = https.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            path: remotePath,
            mode: 'overwrite',
            autorename: false,
            mute: true,
          }),
          'Content-Length': String(buffer.length),
        },
        timeout: 120000,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const statusCode = Number(res.statusCode || 0);
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch {}
          if (statusCode >= 200 && statusCode < 300) {
            return resolve({ ok: true, statusCode, data: parsed || {} });
          }
          resolve({
            ok: false,
            statusCode,
            error: describeDropboxError(parsed, `Dropbox upload failed (${statusCode}).`),
            raw: text,
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Dropbox upload timed out.')));
      req.on('error', (error) => resolve({ ok: false, error: error?.message || 'Dropbox upload failed.' }));
      req.write(buffer);
      req.end();
    });
  }

  function dropboxDownload(accessToken, remotePath) {
    const target = new URL(`${DROPBOX_CONTENT}/files/download`);
    return new Promise((resolve) => {
      const req = https.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: remotePath }),
        },
        timeout: 120000,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const statusCode = Number(res.statusCode || 0);
          const apiResultHeader = res.headers['dropbox-api-result'];
          let metadata = null;
          try { metadata = apiResultHeader ? JSON.parse(String(apiResultHeader)) : null; } catch {}
          if (statusCode >= 200 && statusCode < 300) {
            return resolve({ ok: true, statusCode, data: buffer, metadata });
          }
          const text = buffer.toString('utf8');
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch {}
          resolve({
            ok: false,
            statusCode,
            error: describeDropboxError(parsed, `Dropbox download failed (${statusCode}).`),
            raw: text,
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Dropbox download timed out.')));
      req.on('error', (error) => resolve({ ok: false, error: error?.message || 'Dropbox download failed.' }));
      req.end();
    });
  }

  async function dropboxListFolderRecursive(accessToken, remotePath) {
    let result = await dropboxRpc('files/list_folder', accessToken, {
      path: remotePath,
      recursive: true,
      include_deleted: false,
      include_non_downloadable_files: false,
    });
    if (!result.ok) return result;
    const entries = [...(result.data?.entries || [])];
    let cursor = String(result.data?.cursor || '').trim();
    let hasMore = result.data?.has_more === true;
    while (hasMore && cursor) {
      result = await dropboxRpc('files/list_folder/continue', accessToken, { cursor });
      if (!result.ok) return result;
      entries.push(...(result.data?.entries || []));
      cursor = String(result.data?.cursor || '').trim();
      hasMore = result.data?.has_more === true;
    }
    return { ok: true, entries };
  }

  async function ensureActiveDropbox(rawToken = '') {
    const status = normalizeSaveCloudSettings(loadSettings());
    if (!status.enabled || status.provider !== DROPBOX_PROVIDER) {
      return { ok: false, error: 'Select Dropbox as the active save backup provider first.' };
    }
    const tokenResult = await getDropboxAccessToken({ rawToken });
    if (!tokenResult?.ok || !tokenResult?.accessToken) {
      return { ok: false, error: tokenResult?.error || 'Connect Dropbox first.' };
    }
    return { ok: true, accessToken: tokenResult.accessToken, settings: status };
  }

  function getProfileSnapshot() {
    const status = saveManager.getStatus(loadSettings());
    const profileRoot = String(status?.profileRoot || '').trim();
    const profileFolderName = String(status?.profileFolderName || '').trim();
    if (!profileRoot || !profileFolderName) {
      return { ok: false, error: 'No active SKALD profile save vault is available yet.' };
    }
    return {
      ok: true,
      profileRoot,
      profileFolderName,
      remoteProfileRoot: `${REMOTE_ROOT}/${profileFolderName}`,
    };
  }

  async function validateDropboxConnection(rawToken = '') {
    const tokenResult = await getDropboxAccessToken({ rawToken });
    if (!tokenResult?.ok || !tokenResult?.accessToken) {
      return { ok: false, error: tokenResult?.error || 'Connect Dropbox first.' };
    }
    return {
      ok: true,
      provider: DROPBOX_PROVIDER,
      remoteRootPath: REMOTE_ROOT,
      message: 'Dropbox is reachable and ready for SKALD save backup.',
    };
  }

  async function backupNow() {
    const active = await ensureActiveDropbox();
    if (!active.ok) {
      setTransferState({
        active: false,
        provider: DROPBOX_PROVIDER,
        action: 'backup',
        message: '',
        percent: 0,
        error: active.error || 'Dropbox is not ready.',
      });
      return active;
    }
    const profile = getProfileSnapshot();
    if (!profile.ok) {
      setTransferState({
        active: false,
        provider: DROPBOX_PROVIDER,
        action: 'backup',
        message: '',
        percent: 0,
        error: profile.error || 'No active profile vault is available.',
        lastErrorAt: Date.now(),
        lastError: profile.error || 'No active profile vault is available.',
      });
      return profile;
    }

    setTransferState({
      active: true,
      provider: DROPBOX_PROVIDER,
      action: 'backup',
      message: 'Scanning local save vault…',
      percent: 5,
      error: '',
      remotePath: profile.remoteProfileRoot,
    });

    const localFiles = walkLocalFiles(profile.profileRoot);
    const manifest = countManifest(localFiles);
    const manifestPayload = Buffer.from(JSON.stringify({
      ...manifest,
      profileFolderName: profile.profileFolderName,
    }, null, 2), 'utf8');
    const snapshotStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotRoot = `${REMOTE_ROOT}/_history/${profile.profileFolderName}/${snapshotStamp}`;
    const allFiles = [
      ...localFiles,
      {
        fullPath: '',
        relativePath: 'skald-cloud-backup.json',
        size: manifestPayload.length,
        mtimeMs: Date.now(),
        buffer: manifestPayload,
      },
    ];

    let uploaded = 0;
    for (const file of allFiles) {
      const nextPercent = 12 + Math.round((uploaded / Math.max(allFiles.length, 1)) * 84);
      setTransferState({
        active: true,
        provider: DROPBOX_PROVIDER,
        action: 'backup',
        message: `Uploading ${file.relativePath}…`,
        percent: nextPercent,
        error: '',
        remotePath: profile.remoteProfileRoot,
      });
      const buffer = file.buffer || fs.readFileSync(file.fullPath);
      const relativePath = file.relativePath.replace(/^\/+/, '');
      const remoteTargets = [
        `${profile.remoteProfileRoot}/${relativePath}`,
        `${snapshotRoot}/${relativePath}`,
      ];
      for (const remotePath of remoteTargets) {
        const upload = await dropboxUpload(active.accessToken, remotePath, buffer);
        if (!upload.ok) {
          const uploadError = upload.error || `Could not upload ${file.relativePath}.`;
          const rawDetail = String(upload.raw || '').trim();
          const finalError = rawDetail ? `${uploadError}\n${rawDetail}` : uploadError;
          setTransferState({
            active: false,
            provider: DROPBOX_PROVIDER,
            action: 'backup',
            message: '',
            percent: 0,
            error: finalError,
            remotePath: profile.remoteProfileRoot,
            lastErrorAt: Date.now(),
            lastError: finalError,
          });
          persistCloudState({
            lastErrorAt: Date.now(),
            lastError: finalError,
          });
          return {
            ok: false,
            error: rawDetail ? `${uploadError}\nPath: ${remotePath}\n${rawDetail}` : `${uploadError}\nPath: ${remotePath}`,
          };
        }
      }
      uploaded += 1;
    }

    persistCloudState({
      lastBackupAt: Date.now(),
      lastErrorAt: 0,
      lastError: '',
      lastSnapshotPath: snapshotRoot,
    });
    setTransferState({
      active: false,
      provider: DROPBOX_PROVIDER,
      action: 'backup',
      message: 'Backup complete.',
      percent: 100,
      error: '',
      remotePath: profile.remoteProfileRoot,
      lastBackupAt: Date.now(),
      lastErrorAt: 0,
      lastError: '',
      lastSnapshotPath: snapshotRoot,
    });
    return {
      ok: true,
      provider: DROPBOX_PROVIDER,
      remotePath: profile.remoteProfileRoot,
      snapshotPath: snapshotRoot,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      message: 'Dropbox save backup complete.',
    };
  }

  async function restoreNow() {
    const active = await ensureActiveDropbox();
    if (!active.ok) {
      setTransferState({
        active: false,
        provider: DROPBOX_PROVIDER,
        action: 'restore',
        message: '',
        percent: 0,
        error: active.error || 'Dropbox is not ready.',
      });
      return active;
    }
    const profile = getProfileSnapshot();
    if (!profile.ok) {
      setTransferState({
        active: false,
        provider: DROPBOX_PROVIDER,
        action: 'restore',
        message: '',
        percent: 0,
        error: profile.error || 'No active profile vault is available.',
      });
      return profile;
    }

    setTransferState({
      active: true,
      provider: DROPBOX_PROVIDER,
      action: 'restore',
      message: 'Checking Dropbox backup…',
      percent: 6,
      error: '',
      remotePath: profile.remoteProfileRoot,
    });

    const listed = await dropboxListFolderRecursive(active.accessToken, profile.remoteProfileRoot);
    if (!listed.ok) {
      setTransferState({
        active: false,
        provider: DROPBOX_PROVIDER,
        action: 'restore',
        message: '',
        percent: 0,
        error: listed.error || 'Could not read the Dropbox save vault.',
        remotePath: profile.remoteProfileRoot,
      });
      return { ok: false, error: listed.error || 'Could not read the Dropbox save vault.' };
    }
    let manifestEntry = null;
    const files = (listed.entries || [])
      .filter((entry) => entry && entry['.tag'] === 'file')
      .map((entry) => {
        const remotePath = String(entry.path_display || entry.path_lower || '').trim();
        const relativePath = String(entry.path_display || '').replace(profile.remoteProfileRoot, '').replace(/^\/+/, '');
        const normalized = {
          remotePath,
          relativePath,
        };
        if (relativePath === 'skald-cloud-backup.json') manifestEntry = normalized;
        return normalized;
      })
      .filter((entry) => entry.relativePath && entry.relativePath !== 'skald-cloud-backup.json');
    let expectedFiles = files;
    if (manifestEntry?.remotePath) {
      const manifestDownload = await dropboxDownload(active.accessToken, manifestEntry.remotePath);
      if (manifestDownload.ok) {
        try {
          const parsedManifest = JSON.parse(manifestDownload.data.toString('utf8'));
          if (Array.isArray(parsedManifest?.files) && parsedManifest.files.length) {
            expectedFiles = parsedManifest.files.map((file) => ({
              remotePath: `${profile.remoteProfileRoot}/${String(file.relativePath || '').replace(/^\/+/, '')}`,
              relativePath: String(file.relativePath || '').replace(/^\/+/, ''),
            })).filter((entry) => entry.relativePath);
          }
        } catch {}
      }
    }
    if (!expectedFiles.length) {
      setTransferState({
        active: false,
        provider: DROPBOX_PROVIDER,
        action: 'restore',
        message: '',
        percent: 0,
        error: 'No Dropbox save backup was found for this profile yet.',
        remotePath: profile.remoteProfileRoot,
        lastErrorAt: Date.now(),
        lastError: 'No Dropbox save backup was found for this profile yet.',
      });
      persistCloudState({
        lastErrorAt: Date.now(),
        lastError: 'No Dropbox save backup was found for this profile yet.',
      });
      return { ok: false, error: 'No Dropbox save backup was found for this profile yet.' };
    }
    if (!files.length && !expectedFiles.length) {
      setTransferState({
        active: false,
        provider: DROPBOX_PROVIDER,
        action: 'restore',
        message: '',
        percent: 0,
        error: 'No Dropbox save backup was found for this profile yet.',
        remotePath: profile.remoteProfileRoot,
      });
      return { ok: false, error: 'No Dropbox save backup was found for this profile yet.' };
    }

    clearDirectoryContents(profile.profileRoot);
    ensureDir(profile.profileRoot);

    let restored = 0;
    for (const file of expectedFiles) {
      const nextPercent = 14 + Math.round((restored / Math.max(expectedFiles.length, 1)) * 82);
      setTransferState({
        active: true,
        provider: DROPBOX_PROVIDER,
        action: 'restore',
        message: `Restoring ${file.relativePath}…`,
        percent: nextPercent,
        error: '',
        remotePath: profile.remoteProfileRoot,
      });
      const download = await dropboxDownload(active.accessToken, file.remotePath);
      if (!download.ok) {
        const finalError = download.error || `Could not restore ${file.relativePath}.`;
        setTransferState({
          active: false,
          provider: DROPBOX_PROVIDER,
          action: 'restore',
          message: '',
          percent: 0,
          error: finalError,
          remotePath: profile.remoteProfileRoot,
          lastErrorAt: Date.now(),
          lastError: finalError,
        });
        persistCloudState({
          lastErrorAt: Date.now(),
          lastError: finalError,
        });
        return { ok: false, error: finalError };
      }
      const localPath = path.join(profile.profileRoot, file.relativePath.replace(/\//g, path.sep));
      ensureDir(path.dirname(localPath));
      fs.writeFileSync(localPath, download.data);
      restored += 1;
    }

    persistCloudState({
      lastRestoreAt: Date.now(),
      lastErrorAt: 0,
      lastError: '',
    });
    setTransferState({
      active: false,
      provider: DROPBOX_PROVIDER,
      action: 'restore',
      message: 'Restore complete.',
      percent: 100,
      error: '',
      remotePath: profile.remoteProfileRoot,
      lastRestoreAt: Date.now(),
      lastErrorAt: 0,
      lastError: '',
    });
    return {
      ok: true,
      provider: DROPBOX_PROVIDER,
      remotePath: profile.remoteProfileRoot,
      fileCount: restored,
      message: 'Dropbox save restore complete.',
    };
  }

  async function autoBackupForSession(session = {}, backupRecord = null) {
    const settings = normalizeSaveCloudSettings(loadSettings());
    if (!settings.enabled || settings.provider !== DROPBOX_PROVIDER || settings.autoBackup === false) {
      return { ok: false, skipped: true, reason: 'auto backup disabled' };
    }
    if (transferState.active) {
      return { ok: false, skipped: true, reason: 'transfer already active' };
    }
    const emulatorId = String(session?.emulatorId || session?.type || '').trim().toLowerCase();
    const supported = new Set(['pcsx2', 'duckstation', 'dolphin', 'cemu']);
    if (!supported.has(emulatorId)) {
      return { ok: false, skipped: true, reason: 'unsupported emulator for auto backup' };
    }
    const changedFolders = Array.isArray(backupRecord?.changedFolders) ? backupRecord.changedFolders.length : 0;
    if (!changedFolders) {
      return { ok: false, skipped: true, reason: 'no save changes detected' };
    }
    return backupNow();
  }

  return {
    getStatus,
    backupNow,
    restoreNow,
    validateDropboxConnection,
    autoBackupForSession,
  };
}

module.exports = { createSaveCloudManager };
