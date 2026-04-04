'use strict';
/**
 * SKALD Launcher — renderer.js
 * Session 1: Foundation build.
 * - System selector (SNES first)
 * - ROM list fetch via view_archive.php parser (IPC)
 * - ROM filename parsing (clean title, region, tags)
 * - Sidebar grid with search + filter
 * - Detail panel: ROM info, download → extract → launch via RetroArch
 * - SteamGridDB cover art (with local cache)
 * - Settings: RetroArch path, per-system core path, SteamGridDB API key
 * - Collections, Favorites, Downloads modal, Auto-updater — all inherited
 */

// ─── State ────────────────────────────────────────────────────────────────────

let allRoms       = [];    // full ROM list for current system
let library       = {};    // SQLite library (identifier = rom.name)
let collections   = [];
let selectedRom   = null;
let currentSystem = 'snes';
let sortOrder     = 'az';
let activeFilter     = 'all';
let activeCollection = '';
let installedFirst   = false;
let libretroSystems  = [];

// HLTB metadata filter state
let hltbMetaIndex   = {};  // slug → { developer, genre, releaseDate, esrb, pegi }
let filterGenre     = '';
let filterDeveloper = '';
let filterReleased  = '';
let filterEsrb      = '';
let filterPegi      = '';
let showInstalledBadge = true;

// Art caches: romId → url
const artCache  = {}; // grid (portrait box art) — for detail panel
const logoCache = {}; // logo (transparent PNG) — for sidebar cards
// null sentinel: we already tried and got nothing

function slugify(cleanName) {
  return cleanName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}
function gridCacheKey(cleanName, system) {
  return `${system}_grid_${slugify(cleanName)}`;
}
function logoCacheKey(cleanName, system) {
  return `${system}_logo_${slugify(cleanName)}`;
}

function renderLibretroCoreSettings(systems) {
  const host = document.getElementById('libretro-core-settings');
  if (!host) return;
  host.innerHTML = systems.map(system => `
    <div class="settings-row">
      <label for="setting-core-${system.id}">${system.label} core (.dll) <span style="font-size:11px;color:var(--text-dim);">e.g. ${system.coreExample}</span></label>
      <div class="settings-path-row">
        <input id="setting-core-${system.id}" type="text" placeholder="e.g. ${system.coreExample}" />
        <button type="button" class="btn-choose-core" data-system="${system.id}">Browse…</button>
      </div>
    </div>
  `).join('');

  host.querySelectorAll('.btn-choose-core').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = await window.electronAPI.chooseFile({
        filters: [{ name: 'RetroArch Cores', extensions: ['dll'] }, { name: 'All Files', extensions: ['*'] }],
      });
      if (!p) return;
      const target = document.getElementById(`setting-core-${btn.dataset.system}`);
      if (target) target.value = p;
    });
  });
}

// Download queue: romName → { romName, title, percent, status }
const downloadQueue = new Map();
const downloadHistory = [];

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const updateBar        = document.getElementById('update-bar');
const updateMsg        = document.getElementById('update-msg');
const btnUpdateInstall = document.getElementById('btn-update-install');
const btnUpdateDismiss = document.getElementById('btn-update-dismiss');

const aboutModal          = document.getElementById('about-modal');
const aboutVersion        = document.getElementById('about-version');
const btnAbout            = document.getElementById('btn-about');
const btnCloseAbout       = document.getElementById('btn-close-about');
const btnCloseAboutFooter = document.getElementById('btn-close-about-footer');

const changelogModal      = document.getElementById('changelog-modal');
const changelogHeading    = document.getElementById('changelog-heading');
const changelogBadge      = document.getElementById('changelog-version-badge');
const changelogDate       = document.getElementById('changelog-date');
const changelogBody       = document.getElementById('changelog-body');
const btnCloseChangelog   = document.getElementById('btn-close-changelog');
const btnChangelogInstall = document.getElementById('btn-changelog-install');
const btnChangelogClose   = document.getElementById('btn-changelog-close');

const btnMinimize             = document.getElementById('btn-minimize');
const btnMaximize             = document.getElementById('btn-maximize');
const btnClose                = document.getElementById('btn-close');
const searchInput             = document.getElementById('search-input');
const libraryGrid             = document.getElementById('library-grid');
const heroEl                  = document.getElementById('hero');
const heroImage               = document.getElementById('hero-image');
const heroLocal               = document.getElementById('hero-local');
const heroTitle               = document.getElementById('hero-title');
const detailPanel             = document.getElementById('detail-panel');
const detailCover             = document.getElementById('detail-cover');
const detailTitle             = document.getElementById('detail-title');
const detailMeta              = document.getElementById('detail-meta');
const detailExtra             = document.getElementById('detail-extra');
const detailRating            = document.getElementById('detail-rating');
const detailPlaytime          = document.getElementById('detail-playtime');
const detailDescArchive       = document.getElementById('detail-desc-archive');
const sortFilter              = document.getElementById('sort-filter');
const btnDownload             = document.getElementById('btn-download');
const btnLaunch               = document.getElementById('btn-launch');
const btnDelete               = document.getElementById('btn-delete');
const btnOpenLocation         = document.getElementById('btn-open-location');
const btnClearDefault         = document.getElementById('btn-clear-default');
const progressWrap            = document.getElementById('progress-wrap');
const progressBar             = document.getElementById('progress-bar');
const progressText            = document.getElementById('progress-text');
const btnCancelDownload       = document.getElementById('btn-cancel-download');
const tabButtons              = document.querySelectorAll('.tab-btn');
const tabPanels               = document.querySelectorAll('.tab-panel');
const settingsBtn             = document.getElementById('btn-settings');
const settingsModal           = document.getElementById('settings-modal');
const settingsCloseBtn        = document.getElementById('btn-close-settings');
const downloadPathInput       = document.getElementById('setting-download-path');
const installPathInput        = document.getElementById('setting-install-path');
const extractArchiveCheck     = document.getElementById('setting-extract-archive');
const deleteAfterInstallCheck = document.getElementById('setting-delete-after-install');
const installedFirstCheck     = document.getElementById('setting-installed-first');
const showInstalledBadgeCheck = document.getElementById('setting-show-installed-badge');
const btnChooseDownload       = document.getElementById('btn-choose-download');
const btnChooseInstall        = document.getElementById('btn-choose-install');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRomTitle(rom) {
  return rom.cleanName || rom.name || 'Unknown';
}

// Use the ROM's .name (raw filename) as the DB identifier
function getRomId(rom) {
  return rom.name;
}

function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return null;
  const b = Number(bytes);
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(2) + ' GB';
  if (b >= 1_048_576)     return (b / 1_048_576).toFixed(1) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}

function formatPlaytime(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatPlaytimeLong(secs) {
  const t = formatPlaytime(secs);
  return t ? `${t} played` : '';
}

function setHeroImage(src) {
  heroEl.classList.remove('has-local-hero');
  heroLocal.classList.add('hidden');
  heroLocal.src = '';
  heroImage.style.backgroundImage = src ? `url("${src}")` : 'none';
}

function setDetailCover(src) {
  if (src) {
    detailCover.src = src;
    detailCover.classList.remove('hidden');
  } else {
    detailCover.classList.add('hidden');
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max).trimEnd() + '…';
}

// ─── Sort / filter ────────────────────────────────────────────────────────────

// Groups ROMs by cleanName, returning one representative entry per title.
// Each entry gets a .versions array with all variants (USA, Japan, etc).
function groupRomsByTitle(roms) {
  const map = new Map(); // cleanName -> [rom, ...]
  for (const rom of roms) {
    const key = rom.cleanName.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rom);
  }

  // For each group pick the best representative:
  // prefer USA > World > Europe > Japan > first
  const REGION_PREF = ['USA', 'World', 'Europe', 'Australia', 'Japan'];
  const reps = [];
  for (const [, versions] of map) {
    let rep = versions.find(r => r.region === 'USA')
           || versions.find(r => r.region === 'World')
           || versions.find(r => r.region === 'Europe')
           || versions[0];
    // Attach all versions to the representative
    rep = { ...rep, versions };
    reps.push(rep);
  }
  return reps;
}

function getSortedRoms(roms) {
  const query = searchInput.value.toLowerCase().trim();

  // Filter out Pirate-tagged ROMs entirely (tag check, not title check)
  const clean = roms.filter(r => !r.tags?.includes('Pirate'));

  // Group into unique titles first
  let grouped = groupRomsByTitle(clean);

  // Apply search across title
  if (query) {
    grouped = grouped.filter(r => getRomTitle(r).toLowerCase().includes(query));
  }

  // Apply filters — check if ANY version in the group matches
  if (activeFilter === 'favorites') {
    grouped = grouped.filter(r =>
      r.versions.some(v => library[getRomId(v)]?.is_favorite)
    );
  } else if (activeFilter === 'installed') {
    grouped = grouped.filter(r =>
      r.versions.some(v => !!library[getRomId(v)]?.install_dir)
    );
  }

  if (activeCollection) {
    const col = collections.find(c => String(c.id) === String(activeCollection));
    if (col) {
      const set = new Set(col.games);
      grouped = grouped.filter(r => r.versions.some(v => set.has(getRomId(v))));
    }
  }

  // HLTB metadata filters — match against the cached metadata index
  if (filterGenre || filterDeveloper || filterReleased || filterEsrb || filterPegi) {
    grouped = grouped.filter(r => {
      const slug = getRomTitle(r).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const m    = hltbMetaIndex[slug];
      if (!m) return false;
      if (filterGenre     && !(m.genre      || '').toLowerCase().includes(filterGenre.toLowerCase()))     return false;
      if (filterDeveloper && !(m.developer  || '').toLowerCase().includes(filterDeveloper.toLowerCase())) return false;
      if (filterReleased  && m.releaseDate  !== filterReleased)  return false;
      if (filterEsrb      && m.esrb         !== filterEsrb)       return false;
      if (filterPegi      && m.pegi         !== filterPegi)       return false;
      return true;
    });
  }

  switch (sortOrder) {
    case 'az': grouped.sort((a, b) => getRomTitle(a).localeCompare(getRomTitle(b))); break;
    case 'za': grouped.sort((a, b) => getRomTitle(b).localeCompare(getRomTitle(a))); break;
  }

  if (installedFirst) {
    grouped.sort((a, b) => {
      const ai = a.versions.some(v => library[getRomId(v)]?.install_dir) ? 1 : 0;
      const bi = b.versions.some(v => library[getRomId(v)]?.install_dir) ? 1 : 0;
      return bi - ai;
    });
  }

  return grouped;
}

// ─── Cover art ────────────────────────────────────────────────────────────────

function applyRomArt(imgEl, rom) {
  const id = getRomId(rom);
  if (artCache[id]) { imgEl.src = artCache[id]; return; }
  // Placeholder gradient while loading
  imgEl.src = '';
  window.electronAPI.getRomArt({ cleanName: rom.cleanName, system: currentSystem }).then(result => {
    if (result.ok) {
      artCache[id] = result.url;
      imgEl.src = result.url;
    }
  }).catch(() => {});
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  libretroSystems = await window.electronAPI.getLibretroSystems().catch(() => []);
  renderLibretroCoreSettings(libretroSystems);

  btnMinimize.addEventListener('click', () => window.electronAPI.windowMinimize());
  btnMaximize.addEventListener('click', () => window.electronAPI.windowMaximize());
  btnClose.addEventListener('click',    () => window.electronAPI.windowClose());

  searchInput.addEventListener('input', () => {
    renderLibraryGrid();
    updateSearchClear();
  });
  const btnSearchClear = document.getElementById('btn-search-clear');
  if (btnSearchClear) {
    btnSearchClear.addEventListener('click', () => {
      searchInput.value = '';
      renderLibraryGrid();
      updateSearchClear();
      searchInput.focus();
    });
  }

  sortFilter.addEventListener('change', () => { sortOrder = sortFilter.value; renderLibraryGrid(); });

  // Tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById('tab-' + btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });

  document.addEventListener('keydown', onGlobalKeydown);

  btnDownload.addEventListener('click', onDownload);
  btnLaunch.addEventListener('click',   onLaunch);
  btnDelete.addEventListener('click',   onDelete);
  btnOpenLocation?.addEventListener('click', onOpenLocation);
  btnClearDefault?.addEventListener('click', onClearDefault);
  btnCancelDownload.addEventListener('click', onCancelDownload);

  // Filter & Sort modal
  document.getElementById('btn-filter-sort').addEventListener('click', openFilterSortModal);
  document.getElementById('btn-close-filter-sort').addEventListener('click', closeFilterSortModal);
  document.getElementById('filter-sort-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('filter-sort-modal')) closeFilterSortModal();
  });
  document.getElementById('btn-filter-sort-done').addEventListener('click', closeFilterSortModal);
  document.getElementById('btn-filter-sort-reset').addEventListener('click', () => {
    activeFilter = 'all'; activeCollection = ''; sortOrder = 'az';
    filterGenre = ''; filterDeveloper = ''; filterReleased = ''; filterEsrb = ''; filterPegi = '';
    document.getElementById('sort-filter').value = 'az';
    // Reset all selects
    ['fs-collection-select','fs-genre-select','fs-developer-select','fs-released-select','fs-esrb-select','fs-pegi-select']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    syncFilterSortModal(); renderFsCollectionPills(); renderFsMetaPills(); applyFilterSort(); updateFilterSortLabel();
  });

  // Collections
  document.getElementById('btn-manage-collections').addEventListener('click', openCollectionsModal);
  document.getElementById('btn-close-collections').addEventListener('click', closeCollectionsModal);
  document.getElementById('btn-close-collections-footer').addEventListener('click', closeCollectionsModal);
  document.getElementById('collections-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('collections-modal')) closeCollectionsModal();
  });
  document.getElementById('btn-create-collection').addEventListener('click', onCreateCollection);
  document.getElementById('new-collection-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onCreateCollection();
  });
  document.getElementById('btn-favorite').addEventListener('click', onToggleFavorite);
  document.getElementById('btn-add-to-collection').addEventListener('click', onAddToCollection);
  document.getElementById('btn-close-add-collection').addEventListener('click', closeAddCollectionModal);
  document.getElementById('btn-close-add-collection-footer').addEventListener('click', closeAddCollectionModal);
  document.getElementById('add-collection-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-collection-modal')) closeAddCollectionModal();
  });
  document.getElementById('btn-save-notes').addEventListener('click', onSaveNotes);

  // Downloads modal
  document.getElementById('btn-downloads').addEventListener('click', openDownloadsModal);
  document.getElementById('btn-close-downloads').addEventListener('click', closeDownloadsModal);
  document.getElementById('btn-clear-download-history').addEventListener('click', () => {
    const keep = downloadHistory.filter(e => e.status === 'downloading' || e.status === 'extracting');
    downloadHistory.length = 0;
    keep.forEach(e => downloadHistory.push(e));
    renderDownloadsModal();
  });
  document.getElementById('downloads-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('downloads-modal')) closeDownloadsModal();
  });

  // Settings
  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  btnChooseDownload.addEventListener('click', async () => {
    const p = await window.electronAPI.chooseFolder();
    if (p) downloadPathInput.value = p;
  });
  btnChooseInstall.addEventListener('click', async () => {
    const p = await window.electronAPI.chooseFolder();
    if (p) installPathInput.value = p;
  });

  // RetroArch exe browse
  document.getElementById('btn-choose-retroarch')?.addEventListener('click', async () => {
    const p = await window.electronAPI.chooseFile({
      filters: [{ name: 'Executables', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (p) document.getElementById('setting-retroarch-path').value = p;
  });

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-scan-games').addEventListener('click', onScanForGames);
  document.getElementById('btn-refresh-rom-list')?.addEventListener('click', async () => {
    const btn    = document.getElementById('btn-refresh-rom-list');
    const status = document.getElementById('rom-cache-status');
    btn.disabled = true;
    if (status) status.textContent = 'Clearing cache…';
    await window.electronAPI.clearRomCache({ system: currentSystem });
    allRoms = [];
    closeSettings();
    fetchRoms();
  });

  // Version picker
  document.getElementById('btn-close-version-picker')?.addEventListener('click', () => {
    document.getElementById('version-picker-modal').classList.add('hidden');
  });
  document.getElementById('version-picker-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('version-picker-modal'))
      document.getElementById('version-picker-modal').classList.add('hidden');
  });

  // Archive.org login
  document.getElementById('btn-archive-login')?.addEventListener('click', onArchiveLogin);
  document.getElementById('btn-archive-logout')?.addEventListener('click', onArchiveLogout);
  document.getElementById('setting-archive-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onArchiveLogin();
  });

  // Blades Mode
  document.getElementById('btn-blades-mode')?.addEventListener('click', () => {
    window.electronAPI.openBladesWindow();
  });
  // When Blades Mode selects a system, switch to it on return
  window.electronAPI.onBladesSystemSelected?.(({ system }) => {
    const systemSelect = document.getElementById('system-select');
    if (systemSelect && systemSelect.value !== system) {
      systemSelect.value = system;
      currentSystem = system;
      selectedRom   = null;
      allRoms       = [];
      Object.keys(artCache).forEach(k  => delete artCache[k]);
      Object.keys(logoCache).forEach(k => delete logoCache[k]);
      showHomeView();
      fetchRoms();
    }
  });

  // About
  btnAbout.addEventListener('click', openAbout);
  btnCloseAbout.addEventListener('click', closeAbout);
  btnCloseAboutFooter.addEventListener('click', closeAbout);
  aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) closeAbout(); });
  document.querySelectorAll('#about-links a').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); window.electronAPI.openExternal(a.href); });
  });

  // Changelog
  btnCloseChangelog?.addEventListener('click', closeChangelog);
  btnChangelogClose?.addEventListener('click', closeChangelog);
  btnChangelogInstall?.addEventListener('click', () => { closeChangelog(); window.electronAPI.updaterInstall(); });
  changelogModal?.addEventListener('click', (e) => { if (e.target === changelogModal) closeChangelog(); });

  // Update bar
  btnUpdateInstall.addEventListener('click', () => window.electronAPI.updaterInstall());
  btnUpdateDismiss.addEventListener('click', () => updateBar.classList.add('hidden'));

  // Home button
  document.getElementById('btn-home').addEventListener('click', showHomeView);
  document.getElementById('home-btn-reroll').addEventListener('click', () => {
    homeRandomRom = null;
    renderHomeRandomPick(true);
  });

  // System selector
  const systemSelect = document.getElementById('system-select');
  systemSelect?.addEventListener('change', () => {
    currentSystem = systemSelect.value;
    selectedRom   = null;
    allRoms       = [];
    // Clear art caches when switching systems
    Object.keys(artCache).forEach(k => delete artCache[k]);
    Object.keys(logoCache).forEach(k => delete logoCache[k]);
    showHomeView();
    fetchRoms();
  });

  // Download progress IPC
  window.electronAPI.onDownloadProgress(({ identifier, percent }) => {
    const entry = downloadQueue.get(identifier);
    if (!entry || entry.status !== 'downloading') return;
    dqSet(identifier, { percent });
    if (selectedRom && getRomId(selectedRom) === identifier) {
      progressBar.style.width  = percent + '%';
      progressText.textContent = percent + '%';
    }
  });

  // Auto-updater
  window.electronAPI.onUpdaterStatus((data) => {
    if (!updateBar) return;
    updateBar.classList.remove('error');
    btnUpdateInstall.classList.add('hidden');
    let btnNotes = document.getElementById('btn-update-notes');
    if (!btnNotes) {
      btnNotes = document.createElement('button');
      btnNotes.id = 'btn-update-notes';
      btnNotes.textContent = 'Release Notes';
      btnNotes.addEventListener('click', openChangelog);
      document.getElementById('update-actions').insertBefore(btnNotes, btnUpdateInstall);
    }
    switch (data.status) {
      case 'available':
        pendingUpdateInfo = { version: data.version, releaseNotes: data.releaseNotes || null, releaseDate: data.releaseDate || null, isReady: true };
        updateMsg.textContent = `✨ Update v${data.version} available`;
        btnNotes.classList.remove('hidden');
        btnUpdateInstall.classList.remove('hidden');
        updateBar.classList.remove('hidden');
        break;
      case 'error': {
        if (data.message && data.message.includes('404')) break;
        updateBar.classList.add('error');
        updateMsg.textContent = `Update error: ${data.message}`;
        btnNotes?.classList.add('hidden');
        updateBar.classList.remove('hidden');
        break;
      }
    }
  });

  const initSettings = await window.electronAPI.getSettings();
  installedFirst     = !!initSettings.installedFirst;
  showInstalledBadge = initSettings.showInstalledBadge !== false;
  applyInstalledBadgeSetting();

  collections = await window.electronAPI.getCollections();
  renderCollectionFilter();

  library = await window.electronAPI.getLibrary();

  showHomeView();

  // Load ROM list immediately (bundled JSON, no network needed)
  fetchRoms();

  // Auto-login in background (needed for ROM downloads, not for the list)
  window.electronAPI.archiveAutoLogin().then(r => {
    if (r.ok) console.log('[autologin] signed in as', r.username, 'via', r.method);
    else      console.log('[autologin] not logged in:', r.reason);
  });
}

// ─── Fetch ROM list ───────────────────────────────────────────────────────────

async function fetchRoms() {
  renderSkeletonCards(12);

  // Load HLTB metadata index first — independent of login status
  hltbMetaIndex = await window.electronAPI.listHltbCache().catch(() => ({}));
  console.log(`[hltb-meta] loaded ${Object.keys(hltbMetaIndex).length} entries`);

  // Check archive.org login first — required to download ROMs
  const loginStatus = await window.electronAPI.archiveCheck();
  if (!loginStatus.loggedIn) {
    showLoginPrompt();
    // Still load ROM data in background so it’s ready when they log in
    window.electronAPI.fetchRomList({ system: currentSystem }).then(r => {
      if (r.ok) {
        allRoms = r.roms;
        if (currentView === 'home') renderHomeScreen();
        startHltbPrefetch();
      }
    });
    return;
  }

  // Populate filter dropdowns with whatever is already cached
  renderFsMetaPills();

  const result = await window.electronAPI.fetchRomList({ system: currentSystem });

  if (!result.ok) {
    libraryGrid.innerHTML = `<p class="loading-msg error">Failed to load ROMs: ${result.error}</p>`;
    return;
  }

  allRoms = result.roms;
  library = await window.electronAPI.getLibrary();

  // Load HLTB metadata index from cached files
  hltbMetaIndex = await window.electronAPI.listHltbCache().catch(() => ({}));
  console.log(`[hltb-meta] loaded ${Object.keys(hltbMetaIndex).length} entries`);

  // Pre-populate art/logo caches from disk — zero API calls for already-downloaded art
  const diskCache = await window.electronAPI.listArtCache({ system: currentSystem });
  let preGrid = 0, preLogo = 0;
  for (const rom of allRoms) {
    const id = getRomId(rom);
    const gk = gridCacheKey(rom.cleanName, currentSystem);
    const lk = logoCacheKey(rom.cleanName, currentSystem);
    if (diskCache[gk] && !artCache[id])  { artCache[id]  = diskCache[gk]; preGrid++; }
    if (diskCache[lk] && !logoCache[id]) { logoCache[id] = diskCache[lk]; preLogo++; }
  }
  console.log(`[art-cache] pre-populated ${preGrid} grids, ${preLogo} logos from disk`);

  renderLibraryGrid();
  updateFilterSortLabel();
  renderHomeScreen();

  // Start background HLTB prefetch once ROMs are loaded
  startHltbPrefetch();
}

function showLoginPrompt() {
  libraryGrid.innerHTML = `
    <div class="login-prompt">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C9.24 2 7 4.24 7 7v2H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V11c0-1.1-.9-2-2-2h-2V7c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v2H9V7c0-1.66 1.34-3 3-3zm0 9c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z" fill="currentColor"/>
      </svg>
      <p>Sign in to archive.org to download ROMs</p>
      <button id="btn-prompt-login">Sign In via Settings</button>
    </div>`;
  document.getElementById('btn-prompt-login')?.addEventListener('click', openSettings);
}

function renderSkeletonCards(count) {
  libraryGrid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.innerHTML = `
      <div class="skeleton-thumb"></div>
      <div class="skeleton-text-col">
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line badge"></div>
      </div>
    `;
    libraryGrid.appendChild(card);
  }
}

// ─── Lazy art fetcher ───────────────────────────────────────────────
//
// Fetches logos (and grid art as fallback) for visible cards that don’t
// have art yet. Processes one at a time to avoid hammering SteamGridDB.

let _artFetchQueue   = [];
let _artFetchRunning = false;

function scheduleArtFetch(roms) {
  for (const rom of roms) {
    const id = getRomId(rom);
    // Skip if already cached or already in-flight (null sentinel)
    if (logoCache[id] !== undefined) continue;
    if (_artFetchQueue.some(r => getRomId(r) === id)) continue;
    _artFetchQueue.push(rom);
  }
  if (!_artFetchRunning) processArtQueue();
}

async function processArtQueue() {
  if (_artFetchQueue.length === 0) { _artFetchRunning = false; return; }
  _artFetchRunning = true;

  const rom = _artFetchQueue.shift();
  const id  = getRomId(rom);

  // Mark in-flight so we don’t re-queue
  logoCache[id] = null;

  try {
    const logoResult = await window.electronAPI.getRomLogo({
      cleanName: rom.cleanName,
      system:    currentSystem,
    });

    if (logoResult.ok) {
      logoCache[id] = logoResult.url;
      applyArtToCard(id, logoResult.url);
    } else {
      // No logo — try grid art as fallback
      if (!artCache[id]) {
        const gridResult = await window.electronAPI.getRomArt({
          cleanName: rom.cleanName,
          system:    currentSystem,
        });
        if (gridResult.ok) {
          artCache[id]  = gridResult.url;
          logoCache[id] = gridResult.url; // use grid in sidebar too
          applyArtToCard(id, gridResult.url);
        }
      } else {
        logoCache[id] = artCache[id];
        applyArtToCard(id, artCache[id]);
      }
    }
  } catch {}

  // Small delay between requests to be polite to the API
  setTimeout(processArtQueue, 150);
}

function applyArtToCard(romId, url) {
  if (!url) return;
  const card = libraryGrid.querySelector(`[data-rom-id="${CSS.escape(romId)}"]`);
  if (!card) return;
  const thumb = card.querySelector('.game-thumb');
  if (!thumb) return;
  thumb.src = url;
  thumb.style.visibility = '';
}

// ─── Virtual scrolling library grid ──────────────────────────────────────────
//
// Renders only the cards visible in the sidebar viewport plus a buffer.
// A single tall spacer div gives the scrollbar the correct total height.
// Card height is measured once and cached.

const VS = {
  CARD_HEIGHT:  58,    // estimated px per card (measured after first render)
  BUFFER:       15,    // extra cards to render above/below viewport
  sorted:       [],    // current filtered+sorted ROM array
  scrollTop:    0,
  containerH:   0,
  spacerTop:    null,  // div above rendered cards
  spacerBottom: null,  // div below rendered cards
  renderStart:  0,     // index of first rendered card
  renderEnd:    0,     // index of last rendered card (exclusive)
  scheduled:    false,
};

// Full rebuild — call when the list contents change (new search/filter/system).
// Resets scroll to top.
function renderLibraryGrid() {
  // Cancel any pending lazy art fetches from the previous list
  _artFetchQueue   = [];
  _artFetchRunning = false;

  VS.sorted      = getSortedRoms(allRoms);
  VS.renderStart = -1;
  VS.renderEnd   = -1;
  VS.CARD_HEIGHT = 58;
  libraryGrid.innerHTML = '';

  if (!VS.sorted.length) {
    libraryGrid.innerHTML = '<p class="loading-msg">No ROMs found.</p>';
    return;
  }

  VS.spacerTop    = document.createElement('div');
  VS.spacerBottom = document.createElement('div');
  libraryGrid.appendChild(VS.spacerTop);
  libraryGrid.appendChild(VS.spacerBottom);

  libraryGrid.scrollTop = 0;

  vsRender();

  libraryGrid.onscroll = () => {
    if (VS.scheduled) return;
    VS.scheduled = true;
    requestAnimationFrame(() => { VS.scheduled = false; vsRender(); });
  };
}

// Lightweight re-render — only updates selected state on visible cards.
// Call this instead of renderLibraryGrid() when only the selection changes.
function refreshSelectedCard() {
  if (!VS.spacerTop) return;
  let node = VS.spacerTop.nextSibling;
  while (node && node !== VS.spacerBottom) {
    const romName = node.dataset?.romId;
    if (romName) {
      const isSelected = selectedRom && getRomId(selectedRom) === romName;
      node.classList.toggle('selected', isSelected);
    }
    node = node.nextSibling;
  }
}

function vsRender() {
  if (!VS.sorted.length || !VS.spacerTop) return;

  const scrollTop   = libraryGrid.scrollTop;
  const containerH  = libraryGrid.clientHeight;
  const totalItems  = VS.sorted.length;
  const cardH       = VS.CARD_HEIGHT;

  const firstVisible = Math.floor(scrollTop / cardH);
  const visibleCount = Math.ceil(containerH / cardH);
  const start = Math.max(0, firstVisible - VS.BUFFER);
  const end   = Math.min(totalItems, firstVisible + visibleCount + VS.BUFFER);

  // Skip re-render if window hasn't changed
  if (start === VS.renderStart && end === VS.renderEnd) return;
  VS.renderStart = start;
  VS.renderEnd   = end;

  // Update spacers
  VS.spacerTop.style.height    = (start * cardH) + 'px';
  VS.spacerBottom.style.height = ((totalItems - end) * cardH) + 'px';

  // Remove old cards (everything between the two spacers)
  const toRemove = [];
  let node = VS.spacerTop.nextSibling;
  while (node && node !== VS.spacerBottom) {
    toRemove.push(node);
    node = node.nextSibling;
  }
  toRemove.forEach(n => n.remove());

  // Render the visible slice
  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    frag.appendChild(makeCard(VS.sorted[i]));
  }
  libraryGrid.insertBefore(frag, VS.spacerBottom);

  // Lazy-fetch art for visible cards that don't have it yet
  scheduleArtFetch(VS.sorted.slice(start, end));

  // Measure real card height after first render and re-render with accurate value
  requestAnimationFrame(() => {
    const firstCard = VS.spacerTop?.nextSibling;
    if (firstCard && firstCard !== VS.spacerBottom) {
      const measured = firstCard.getBoundingClientRect().height;
      if (measured > 10 && Math.abs(measured - VS.CARD_HEIGHT) > 1) {
        VS.CARD_HEIGHT = measured;
        VS.renderStart = -1;
        VS.renderEnd   = -1;
        vsRender();
      }
    }
  });
}

function makeCard(rom) {
  const card = document.createElement('div');
  card.className = 'game-card';
  card.dataset.romId = getRomId(rom);
  if (selectedRom && getRomId(selectedRom) === getRomId(rom)) card.classList.add('selected');

  const libEntry  = library[getRomId(rom)];
  const installed = !!libEntry?.install_dir;
  const isFav     = !!libEntry?.is_favorite;

  if (installed) card.classList.add('is-installed');

  const img = document.createElement('img');
  img.className = 'game-thumb';
  img.alt       = getRomTitle(rom);
  img.loading   = 'lazy';
  const id = getRomId(rom);
  // Only set src if we already have the image — otherwise leave blank (no broken icon)
  if (logoCache[id])       img.src = logoCache[id];
  else if (artCache[id])   img.src = artCache[id];
  else                     img.style.visibility = 'hidden';

  if (installed) {
    const installedLabel = document.createElement('span');
    installedLabel.className   = 'card-installed-label';
    installedLabel.textContent = 'Installed';
    card.appendChild(installedLabel);
  }

  card.appendChild(img);

  const textCol = document.createElement('div');
  textCol.className = 'card-text-col';

  if (isFav) {
    const badgeStrip = document.createElement('div');
    badgeStrip.className = 'card-badges';
    const fav = document.createElement('span');
    fav.className = 'card-fav';
    fav.innerHTML = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M26.9 2.6 L33.3 13.1 45.3 15.9 Q46.5 16.3 47.2 17.3 48 18.2 48 19.4 47.9 20.6 47.1 21.6 L39.1 31 40.1 43.2 Q40.2 44.5 39.5 45.4 38.8 46.5 37.6 46.8 L35.3 46.7 24 42 12.6 46.7 10.3 46.8 Q9.1 46.5 8.4 45.4 7.7 44.5 7.8 43.2 L8.8 31 0.8 21.6 Q0 20.6 0 19.4 -0.1 18.2 0.7 17.3 1.4 16.3 2.6 15.9 L14.6 13.1 21 2.6 Q21.7 1.6 22.8 1.2 24 0.8 25.1 1.2 26.3 1.6 26.9 2.6"/></svg>`;
    badgeStrip.appendChild(fav);
    textCol.appendChild(badgeStrip);
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'card-title-row';

  const label = document.createElement('span');
  label.className   = 'card-label';
  label.textContent = getRomTitle(rom);
  titleRow.appendChild(label);

  // Show versions badge if more than one variant exists
  if (rom.versions && rom.versions.length > 1) {
    const vBadge = document.createElement('span');
    vBadge.className   = 'card-versions-badge';
    vBadge.textContent = `${rom.versions.length}`;
    vBadge.title       = rom.versions.map(v => v.region || v.name).join(', ');
    titleRow.appendChild(vBadge);
  }

  textCol.appendChild(titleRow);

  // Show representative region only
  if (rom.region && (!rom.versions || rom.versions.length === 1)) {
    const regionBadge = document.createElement('span');
    regionBadge.className   = 'card-region';
    regionBadge.textContent = rom.region;
    textCol.appendChild(regionBadge);
  }

  card.appendChild(textCol);
  card.addEventListener('click', () => showDetailView(rom));
  return card;
}

// ─── Select ROM (detail panel) ────────────────────────────────────────────────

async function selectRom(rom) {
  selectedRom = rom;
  refreshSelectedCard(); // just toggle selected class, no scroll reset

  const title  = getRomTitle(rom);
  heroTitle.textContent = title;
  setHeroImage(artCache[getRomId(rom)] || null);

  detailTitle.textContent = title;

  // Meta row
  const sizeStr = rom.size ? rom.size : (rom.sizeBytes ? formatSize(rom.sizeBytes) : '');
  const regionStr = rom.region || '—';
  const tags    = rom.tags?.length ? rom.tags.join(', ') : '';
  detailMeta.innerHTML =
    `<span>Region: <strong>${regionStr}</strong></span>` +
    (sizeStr ? `<span>Size: <strong>${sizeStr}</strong></span>` : '') +
    (tags ? `<span>Tags: <strong>${tags}</strong></span>` : '');

  detailExtra.textContent = '';
  detailRating?.classList.add('hidden');

  const libEntry = library[getRomId(rom)];
  if (libEntry?.playtime_secs) {
    detailPlaytime.textContent = formatPlaytimeLong(libEntry.playtime_secs);
    detailPlaytime.classList.remove('hidden');
  } else {
    detailPlaytime.classList.add('hidden');
  }

  // Info tab — filename only initially; summary prepended once HLTB loads
  detailDescArchive.dataset.romName = rom.name || '';
  detailDescArchive.textContent = rom.name || '';

  // Files tab
  const romFileInfo = document.getElementById('rom-file-info');
  if (romFileInfo) {
    romFileInfo.innerHTML = `
      <table class="rom-file-table">
        <tr><td>Filename</td><td>${rom.name}</td></tr>
        ${rom.region ? `<tr><td>Region</td><td>${rom.region}</td></tr>` : ''}
        ${rom.tags?.length ? `<tr><td>Tags</td><td>${rom.tags.join(', ')}</td></tr>` : ''}
        ${sizeStr ? `<tr><td>Size</td><td>${sizeStr}</td></tr>` : ''}
        ${rom.timestamp ? `<tr><td>Archived</td><td>${rom.timestamp}</td></tr>` : ''}
        <tr><td>Download URL</td><td style="word-break:break-all;font-size:11px;">${rom.downloadUrl}</td></tr>
      </table>
    `;
  }

  // Cover art — grid for detail panel, logo for sidebar card
  const id = getRomId(rom);

  // Show whatever we already have immediately
  const currentGrid = artCache[id];
  setHeroImage(currentGrid || null);
  setDetailCover(currentGrid || null);

  // Fetch grid (detail panel) if not cached
  if (!artCache[id]) {
    window.electronAPI.getRomArt({ cleanName: rom.cleanName, system: currentSystem }).then(r => {
      if (r.ok) {
        artCache[id] = r.url;
        if (selectedRom && getRomId(selectedRom) === id) {
          setHeroImage(r.url);
          setDetailCover(r.url);
        }
      }
    }).catch(() => {});
  }

  // Fetch logo (sidebar card) if not yet tried
  if (logoCache[id] === undefined) {
    logoCache[id] = null; // mark as in-flight to avoid duplicate requests
    window.electronAPI.getRomLogo({ cleanName: rom.cleanName, system: currentSystem }).then(r => {
      if (r.ok) {
        logoCache[id] = r.url;
        // Update the visible card thumbnail if this ROM is currently rendered
        const card = libraryGrid.querySelector(`[data-rom-id="${CSS.escape(id)}"]`);
        if (card) {
          const thumb = card.querySelector('.game-thumb');
          if (thumb) thumb.src = r.url;
        }
      } else {
        // No logo — fall back to grid art in the card
        logoCache[id] = artCache[id] || null;
        const card = libraryGrid.querySelector(`[data-rom-id="${CSS.escape(id)}"]`);
        if (card && artCache[id]) {
          const thumb = card.querySelector('.game-thumb');
          if (thumb && !thumb.src) thumb.src = artCache[id];
        }
      }
    }).catch(() => {});
  }

  loadNotesForRom(getRomId(rom));

  // Reset HLTB tab
  const hltbContent = document.getElementById('hltb-content');
  const hltbEmpty   = document.getElementById('hltb-empty');
  const hltbLoading = document.getElementById('hltb-loading');
  if (hltbContent) hltbContent.innerHTML = '';
  if (hltbEmpty)   hltbEmpty.style.display = 'none';
  if (hltbLoading) hltbLoading.style.display = 'none';

  loadHltbData(rom);

  // Reset HLTB meta panel in Info tab
  const hltbMetaSection = document.getElementById('hltb-meta-section');
  const hltbMetaContent = document.getElementById('hltb-meta-content');
  if (hltbMetaSection) hltbMetaSection.classList.add('hidden');
  if (hltbMetaContent) hltbMetaContent.innerHTML = '';

  // Reset + load RetroAchievements
  const raSection = document.getElementById('ra-section');
  const raContent = document.getElementById('ra-content');
  const raLoading = document.getElementById('ra-loading');
  if (raSection) raSection.classList.add('hidden');
  if (raContent) raContent.innerHTML = '';
  if (raLoading) raLoading.classList.remove('hidden');
  loadRaData(rom);

  refreshButtonStates();
  resetProgressUI();

  detailPanel.classList.remove('hidden');
}

// ─── Readme ───────────────────────────────────────────────────────────────────

async function loadHltbData(rom) {
  const content = document.getElementById('hltb-content');
  const empty   = document.getElementById('hltb-empty');
  const loading = document.getElementById('hltb-loading');
  if (!content) return;

  content.innerHTML = '';
  empty.style.display   = 'none';
  loading.style.display = 'block';

  try {
    const result = await window.electronAPI.hltbSearch({ cleanName: rom.cleanName });
    loading.style.display = 'none';
    if (!result.ok || !result.data) { empty.style.display = 'block'; return; }

    const d = result.data;

    // Completion time rows
    const timeRows = [
      { label: 'Main Story',    icon: '⏱', value: d.main },
      { label: 'Main + Extras', icon: '➕', value: d.mainExtra },
      { label: 'Completionist', icon: '🏆', value: d.completionist },
    ].filter(r => r.value);

    if (!timeRows.length) { empty.style.display = 'block'; return; }

    // Community stats
    const stats = [
      { label: 'Score',      value: d.reviewScore ? `${d.reviewScore}/100` : null, sub: d.reviewCount ? `${d.reviewCount.toLocaleString()} reviews` : null },
      { label: 'Playing',    value: d.countPlaying    ? d.countPlaying.toLocaleString()    : null },
      { label: 'Backlog',    value: d.countBacklog    ? d.countBacklog.toLocaleString()    : null },
      { label: 'Completed',  value: d.countCompleted  ? d.countCompleted.toLocaleString()  : null },
    ].filter(r => r.value);

    const statsHtml = stats.length ? `
      <div class="hltb-stats-row">
        ${stats.map(r => `
          <div class="hltb-stat-chip">
            <span class="hltb-stat-num">${escHtml(r.value)}</span>
            <span class="hltb-stat-label">${r.label}</span>
            ${r.sub ? `<span class="hltb-stat-sub">${r.sub}</span>` : ''}
          </div>
        `).join('')}
      </div>` : '';

    content.innerHTML = `
      <div class="hltb-title">${escHtml(d.title)}</div>
      <div class="hltb-rows">
        ${timeRows.map(r => `
          <div class="hltb-row">
            <span class="hltb-icon">${r.icon}</span>
            <span class="hltb-label">${r.label}</span>
            <span class="hltb-value">${r.value}</span>
          </div>
        `).join('')}
      </div>
      ${statsHtml}
      <a class="hltb-link" href="${d.url}">↗ View on HowLongToBeat</a>
    `;

    content.querySelector('.hltb-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(d.url);
    });

    // Refresh HLTB meta index so new data is immediately filterable
    if (!result.cached) {
      window.electronAPI.listHltbCache().then(idx => { hltbMetaIndex = idx; renderFsMetaPills(); });
    }

    // ── Also populate the Info tab meta panel ──────────────────────────────
    const metaSection = document.getElementById('hltb-meta-section');
    const metaContent = document.getElementById('hltb-meta-content');
    if (metaSection && metaContent) {
      const infoMetaRows = [
        { label: 'Developer',  value: d.developer },
        { label: 'Publisher',  value: d.publisher !== d.developer ? d.publisher : null },
        { label: 'Genre',      value: d.genre },
        { label: 'Released',   value: d.releaseDate ? d.releaseDate.slice(0, 4) : null },
        { label: 'ESRB',       value: d.esrb },
        { label: 'PEGI',       value: d.pegi },
      ].filter(r => r.value);

      // Put summary above the ROM filename in the same box
      if (d.summary) {
        const romName = detailDescArchive.dataset.romName || detailDescArchive.textContent;
        detailDescArchive.innerHTML =
          `<span class="rom-desc-summary">${escHtml(d.summary)}</span>` +
          `<span class="rom-desc-filename">${escHtml(romName)}</span>`;
      }

      if (infoMetaRows.length) {
        metaContent.innerHTML = `
          <div class="hltb-meta-grid">
            ${infoMetaRows.map(r => `
              <div class="hltb-meta-row">
                <span class="hltb-meta-label">${r.label}</span>
                <span class="hltb-meta-value">${escHtml(r.value)}</span>
              </div>
            `).join('')}
          </div>`;
        metaSection.classList.remove('hidden');
      }
    }

  } catch {
    loading.style.display = 'none';
    empty.style.display   = 'block';
  }
}

// ─── RetroAchievements ───────────────────────────────────────────────────────

async function loadRaData(rom) {
  const section = document.getElementById('ra-section');
  const content = document.getElementById('ra-content');
  const loading = document.getElementById('ra-loading');
  if (!section || !content) return;

  try {
    const result = await window.electronAPI.raGameSearch({
      cleanName: rom.cleanName,
      system:    currentSystem || 'snes',
    });

    if (loading) loading.classList.add('hidden');
    if (!result.ok) return; // no key or not found — show nothing silently

    const d = result.data;
    const badgeBase  = 'https://media.retroachievements.org/Badge/';
    const hasProgress = d.hasUserProgress;

    // Sort: earned first (by date desc), then locked by id
    const earned  = d.achievements.filter(a => a.dateEarned).sort((a, b) => new Date(b.dateEarned) - new Date(a.dateEarned));
    const locked  = d.achievements.filter(a => !a.dateEarned);
    const sorted  = [...earned, ...locked];

    const earnedCount   = earned.length;
    const earnedPoints  = earned.reduce((s, a) => s + (a.points || 0), 0);

    const achHtml = sorted.map(a => {
      const isEarned  = !!a.dateEarned;
      const typeClass = a.type === 'progression'   ? 'ra-ach-progression'
                      : a.type === 'win_condition' ? 'ra-ach-win'
                      : a.type === 'missable'      ? 'ra-ach-missable'
                      : '';
      const lockedClass = (!isEarned && hasProgress) ? 'ra-ach-locked' : '';
      const badgeSuffix = (!isEarned && hasProgress) ? '_lock' : '';
      return `
        <div class="ra-achievement ${typeClass} ${lockedClass}" title="${escHtml(a.description || '')}">
          <img class="ra-badge" src="${badgeBase}${a.badgeName}${badgeSuffix}.png"
               onerror="this.src='${badgeBase}${a.badgeName}.png'" alt="" loading="lazy" />
          <div class="ra-ach-info">
            <span class="ra-ach-title">${escHtml(a.title)}</span>
            <span class="ra-ach-desc">${escHtml(a.description || '')}</span>
            <div class="ra-ach-meta">
              <span class="ra-ach-pts">${a.points}pts</span>
              ${isEarned ? `<span class="ra-ach-earned">✓ Earned</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Progress bar if user progress available
    const progressHtml = hasProgress && d.numAchievements > 0 ? `
      <div class="ra-progress-row">
        <div class="ra-progress-bar-bg">
          <div class="ra-progress-bar-fill" style="width:${Math.round(earnedCount / d.numAchievements * 100)}%"></div>
        </div>
        <span class="ra-progress-label">${earnedCount}/${d.numAchievements} &nbsp;·&nbsp; ${earnedPoints}/${d.totalPoints}pts</span>
      </div>
    ` : '';

    content.innerHTML = `
      <div class="ra-header">
        ${d.imageIcon ? `<img class="ra-game-icon" src="${d.imageIcon}" alt="" />` : ''}
        <div class="ra-header-info">
          <div class="ra-header-title">
            <img class="ra-logo" src="../../assets/icons/RA-logo.svg" alt="RA" />
            RetroAchievements
          </div>
          <div class="ra-stats">
            <span class="ra-stat"><span class="ra-stat-num">${d.numAchievements}</span> achievements</span>
            <span class="ra-stat-sep">·</span>
            <span class="ra-stat"><span class="ra-stat-num">${d.totalPoints}</span> points</span>
            <span class="ra-stat-sep">·</span>
            <span class="ra-stat"><span class="ra-stat-num">${d.numPlayers.toLocaleString()}</span> players</span>
          </div>
        </div>
      </div>
      ${progressHtml}
      <div class="ra-achievements-list">${achHtml}</div>
      <a class="ra-link" href="${d.gameUrl}">↗ View on RetroAchievements</a>
    `;

    content.querySelector('.ra-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(d.gameUrl);
    });

    section.classList.remove('hidden');
  } catch {
    if (loading) loading.classList.add('hidden');
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Button states ────────────────────────────────────────────────────────────

async function refreshButtonStates() {
  const btnFavorite        = document.getElementById('btn-favorite');
  const btnAddToCollection = document.getElementById('btn-add-to-collection');

  if (!selectedRom) {
    btnDownload.disabled = true;
    btnLaunch.disabled   = true;
    btnDelete.disabled   = true;
    btnOpenLocation?.classList.add('hidden');
    btnClearDefault?.classList.add('hidden');
    btnFavorite?.classList.add('hidden');
    btnAddToCollection?.classList.add('hidden');
    renderCollectionChips(null);
    return;
  }

  btnFavorite?.classList.remove('hidden');
  updateFavoriteButton();
  btnAddToCollection?.classList.remove('hidden');
  renderCollectionChips(getRomId(selectedRom));

  const lib       = library[getRomId(selectedRom)];
  const installed = !!lib?.install_dir;
  const inQueue   = downloadQueue.has(getRomId(selectedRom));

  btnDownload.disabled = installed || inQueue;
  btnLaunch.disabled   = !installed;
  btnDelete.disabled   = !installed;

  if (installed) {
    btnOpenLocation?.classList.remove('hidden');
  } else {
    btnOpenLocation?.classList.add('hidden');
  }
  btnClearDefault?.classList.add('hidden');

  // Hide Steam and Add-to-steam for ROM launcher
  document.getElementById('btn-add-to-steam')?.classList.add('hidden');
}

function resetProgressUI() {
  progressWrap.classList.add('hidden');
  progressBar.style.width  = '0%';
  progressText.textContent = '0%';
}

async function onClearDefault() {}
async function onOpenLocation() {
  if (!selectedRom) return;
  const lib = library[getRomId(selectedRom)];
  if (!lib?.install_dir) return;
  await window.electronAPI.openGameLocation({ installDir: lib.install_dir });
}

// ─── Download ROM ─────────────────────────────────────────────────────────────

function openVersionPicker(rom) {
  const modal    = document.getElementById('version-picker-modal');
  const list     = document.getElementById('version-picker-list');
  const titleEl  = document.getElementById('version-picker-title');
  titleEl.textContent = getRomTitle(rom);
  list.innerHTML = '';

  // Sort versions: USA first, then alphabetically by region
  const sorted = [...rom.versions].sort((a, b) => {
    const order = ['USA','World','Europe','Australia','Japan'];
    const ai = order.indexOf(a.region);
    const bi = order.indexOf(b.region);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return (a.region || a.name).localeCompare(b.region || b.name);
  });

  for (const version of sorted) {
    const id        = getRomId(version);
    const libEntry  = library[id];
    const installed = !!libEntry?.install_dir;
    const inQueue   = downloadQueue.has(id);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 6px;border-radius:6px;margin-bottom:4px;background:var(--bg3);';

    const info = document.createElement('div');
    info.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

    const regionEl = document.createElement('span');
    regionEl.style.cssText = 'font-weight:600;font-size:13px;font-family:Rajdhani,sans-serif;';
    regionEl.textContent = version.region || 'Unknown';

    const metaEl = document.createElement('span');
    metaEl.style.cssText = 'font-size:11px;color:var(--text-dim);';
    const parts = [];
    if (version.tags?.length) parts.push(version.tags.join(', '));
    if (version.size) parts.push(version.size);
    metaEl.textContent = parts.join(' · ');

    info.appendChild(regionEl);
    if (parts.length) info.appendChild(metaEl);

    const btn = document.createElement('button');
    if (installed) {
      btn.textContent = '✓ Installed';
      btn.style.cssText = 'font-size:12px;padding:5px 12px;background:var(--success,#4caf50);color:#fff;opacity:0.7;cursor:default;';
      btn.disabled = true;
    } else if (inQueue) {
      btn.textContent = 'Queued…';
      btn.style.cssText = 'font-size:12px;padding:5px 12px;opacity:0.5;cursor:default;';
      btn.disabled = true;
    } else {
      btn.textContent = '↓ Install';
      btn.style.cssText = 'font-size:12px;padding:5px 12px;background:var(--accent);color:#fff;';
      btn.addEventListener('click', () => {
        modal.classList.add('hidden');
        // Select the chosen version and trigger download
        selectedRom = version;
        startDownload(version);
      });
    }

    row.appendChild(info);
    row.appendChild(btn);
    list.appendChild(row);
  }

  modal.classList.remove('hidden');
}

async function onDownload() {
  if (!selectedRom) return;
  const rom  = selectedRom;

  // If multiple versions exist, show the picker instead
  if (rom.versions && rom.versions.length > 1) {
    openVersionPicker(rom);
    return;
  }

  startDownload(rom);
}

async function startDownload(rom) {
  const id   = getRomId(rom);
  if (downloadQueue.has(id)) return;

  const title = getRomTitle(rom);

  dqSet(id, { romName: id, title, percent: 0, status: 'downloading', startedAt: Date.now() });
  btnDownload.disabled = true;
  progressWrap.classList.remove('hidden');
  progressBar.style.width  = '0%';
  progressText.textContent = '0%';

  const result = await window.electronAPI.downloadStart({
    identifier:  id,
    downloadUrl: rom.downloadUrl,
    fileName:    rom.name,
  });

  if (!downloadQueue.has(id)) {
    progressWrap.classList.add('hidden');
    refreshButtonStates();
    return;
  }

  if (!result.ok) {
    dqSet(id, { status: 'error', finishedAt: Date.now() });
    setTimeout(() => { downloadQueue.delete(id); updateDownloadsButton(); }, 4000);
    progressWrap.classList.add('hidden');
    refreshButtonStates();
    return;
  }

  const settings = await window.electronAPI.getSettings();
  // Never extract if the downloaded file is already a native ROM format
  const ROM_DIRECT_EXTS = ['.chd', '.cue', '.bin', '.img', '.sfc', '.smc', '.nes', '.gba', '.n64'];
  const isDirectRom = ROM_DIRECT_EXTS.some(ext => result.filePath.toLowerCase().endsWith(ext));
  const shouldExtract = !!settings.extractArchive && !isDirectRom;

  let installDir;

  if (shouldExtract) {
    dqSet(id, { status: 'extracting', percent: 100 });
    progressBar.style.width  = '100%';
    progressText.textContent = '100%';

    const extractResult = await window.electronAPI.extractArchive({
      filePath:   result.filePath,
      identifier: id,
      subFolder:  null,
    });

    progressWrap.classList.add('hidden');

    if (!extractResult.ok) {
      dqSet(id, { status: 'error' });
      setTimeout(() => { downloadQueue.delete(id); }, 4000);
      return;
    }

    installDir = extractResult.installDir;
  } else {
    // No extraction — register the .zip itself as the install path
    progressWrap.classList.add('hidden');
    installDir = result.filePath;
  }

  await window.electronAPI.installGame({
    identifier: id,
    installDir,
    exePath:    null,
  });

  library = await window.electronAPI.getLibrary();
  dqDone(id);

  if (selectedRom && getRomId(selectedRom) === id) {
    refreshButtonStates();
  }
  renderLibraryGrid();
  renderHomeStats();
}

async function onCancelDownload() {
  if (!selectedRom) return;
  const id = getRomId(selectedRom);
  downloadQueue.delete(id);
  const hi = downloadHistory.findIndex(h => h.identifier === id);
  if (hi >= 0) { downloadHistory[hi].status = 'error'; downloadHistory[hi].finishedAt = Date.now(); }
  updateDownloadsButton();
  progressWrap.classList.add('hidden');
  refreshButtonStates();
  await window.electronAPI.downloadCancel({ identifier: id });
}

// ─── Launch ROM via RetroArch ─────────────────────────────────────────────────

async function onLaunch() {
  if (!selectedRom) return;
  const lib = library[getRomId(selectedRom)];
  if (!lib?.install_dir) return;

  // Find the actual ROM file inside the install dir (extracted from the ZIP)
  const { execFile } = { execFile: null }; // can't use child_process in renderer
  // We pass the installDir — main process will find the ROM file inside it
  const result = await window.electronAPI.launchRom({
    romPath: lib.install_dir,  // main process expects the dir; it finds the ROM inside
    system:  currentSystem,
  });

  if (!result.ok) {
    showToast('⚠ ' + result.error);
  }
}

// ─── Delete ROM ────────────────────────────────────────────────────────────────

async function onDelete() {
  if (!selectedRom) return;
  const id  = getRomId(selectedRom);
  const lib = library[id];
  if (!confirm(`Delete ${getRomTitle(selectedRom)}? This will remove all files from disk.`)) return;
  await window.electronAPI.deleteGame({ identifier: id, installDir: lib?.install_dir || null });
  library = await window.electronAPI.getLibrary();
  refreshButtonStates();
  renderLibraryGrid();
  renderHomeStats();
}

// ─── Download queue helpers ───────────────────────────────────────────────────

function dqSet(identifier, fields) {
  const existing = downloadQueue.get(identifier) || {};
  const updated  = { ...existing, ...fields };
  downloadQueue.set(identifier, updated);
  syncToHistory(identifier, updated);
  updateDownloadsButton();
}

function dqDone(identifier) {
  dqSet(identifier, { status: 'done', percent: 100, finishedAt: Date.now() });
  setTimeout(() => {
    downloadQueue.delete(identifier);
    updateDownloadsButton();
  }, 3000);
}

function syncToHistory(identifier, entry) {
  const idx = downloadHistory.findIndex(h => h.identifier === identifier);
  const record = { identifier, title: entry.title || identifier, status: entry.status, percent: entry.percent ?? 0, startedAt: entry.startedAt || Date.now(), finishedAt: entry.finishedAt || null };
  if (idx >= 0) downloadHistory[idx] = record;
  else          downloadHistory.unshift(record);
  if (!document.getElementById('downloads-modal').classList.contains('hidden')) {
    updateDownloadsModalProgress(identifier, entry);
  }
}

function updateDownloadsModalProgress(identifier, entry) {
  const activeList = document.getElementById('downloads-active-list');
  if (!activeList) return;
  const item = activeList.querySelector(`[data-identifier="${CSS.escape(identifier)}"]`);
  if (!item) { renderDownloadsModal(); return; }
  const bar = item.querySelector('.dm-bar');
  if (bar) bar.style.width = `${entry.percent ?? 0}%`;
  const meta = item.querySelector('.dm-meta');
  if (meta) meta.textContent = entry.status === 'extracting' ? 'Extracting…' : `${entry.percent ?? 0}%`;
}

function updateDownloadsButton() {
  const btn    = document.getElementById('btn-downloads');
  const active = [...downloadQueue.values()].filter(e => e.status === 'downloading' || e.status === 'extracting');
  btn.querySelector('.dl-badge')?.remove();
  if (active.length > 0) {
    btn.classList.add('has-active');
    const badge = document.createElement('span');
    badge.className = 'dl-badge';
    badge.textContent = active.length;
    btn.appendChild(badge);
  } else {
    btn.classList.remove('has-active');
  }
}

function openDownloadsModal()  { renderDownloadsModal(); document.getElementById('downloads-modal').classList.remove('hidden'); }
function closeDownloadsModal() { document.getElementById('downloads-modal').classList.add('hidden'); }

function renderDownloadsModal() {
  const activeSection = document.getElementById('downloads-active-section');
  const activeList    = document.getElementById('downloads-active-list');
  const active = [...downloadQueue.values()].filter(e => e.status === 'downloading' || e.status === 'extracting');
  if (!active.length) {
    activeSection.classList.add('hidden');
  } else {
    activeSection.classList.remove('hidden');
    activeList.innerHTML = '';
    active.forEach(entry => activeList.appendChild(makeDmItem(entry, true)));
  }

  const historyList = document.getElementById('downloads-history-list');
  const countEl     = document.getElementById('downloads-history-count');
  const history = downloadHistory.filter(e => e.status !== 'downloading' && e.status !== 'extracting');
  countEl.textContent = history.length ? `(${history.length})` : '';
  historyList.innerHTML = '';
  if (!history.length) {
    historyList.innerHTML = '<div class="dm-empty">No downloads this session yet.</div>';
    return;
  }
  history.forEach(entry => historyList.appendChild(makeDmItem(entry, false)));
}

function makeDmItem(entry, isActive) {
  const item = document.createElement('div');
  item.className = 'dm-item' + (entry.status === 'done' ? ' done' : '') + (entry.status === 'error' ? ' error' : '') + (isActive ? ' active' : '');
  item.dataset.identifier = entry.identifier;

  const info = document.createElement('div');
  info.className = 'dm-info';
  const title = document.createElement('div');
  title.className = 'dm-title';
  title.textContent = entry.title;
  const meta = document.createElement('div');
  meta.className = 'dm-meta';
  if (isActive) {
    meta.textContent = entry.status === 'extracting' ? 'Extracting…' : `${entry.percent ?? 0}%`;
  } else {
    const when = entry.finishedAt ? new Date(entry.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    meta.innerHTML = `<span>${entry.status === 'done' ? '✓ Installed' : '✕ Failed'}</span>${when ? `<span>${when}</span>` : ''}`;
  }
  const barWrap = document.createElement('div');
  barWrap.className = 'dm-bar-wrap';
  const bar = document.createElement('div');
  bar.className = 'dm-bar';
  bar.style.width = isActive ? `${entry.percent ?? 0}%` : (entry.status === 'done' ? '100%' : `${entry.percent ?? 0}%`);
  barWrap.appendChild(bar);
  info.appendChild(title);
  info.appendChild(meta);
  if (isActive || entry.status === 'error') info.appendChild(barWrap);

  const status = document.createElement('span');
  status.className = 'dm-status';
  status.textContent = isActive ? (entry.status === 'extracting' ? 'Extracting' : `${entry.percent ?? 0}%`) : (entry.status === 'done' ? 'Done' : 'Error');

  item.appendChild(info);
  item.appendChild(status);

  if (isActive) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dm-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', async () => {
      const id = entry.identifier;
      downloadQueue.delete(id);
      const hi = downloadHistory.findIndex(h => h.identifier === id);
      if (hi >= 0) { downloadHistory[hi].status = 'error'; downloadHistory[hi].finishedAt = Date.now(); }
      renderDownloadsModal();
      updateDownloadsButton();
      if (selectedRom && getRomId(selectedRom) === id) {
        progressWrap.classList.add('hidden');
        refreshButtonStates();
      }
      renderLibraryGrid();
      await window.electronAPI.downloadCancel({ identifier: id });
    });
    item.appendChild(cancelBtn);
  } else {
    const rom = allRoms.find(r => getRomId(r) === entry.identifier);
    if (rom) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'dm-view';
      viewBtn.textContent = 'View';
      viewBtn.addEventListener('click', () => { closeDownloadsModal(); showDetailView(rom); });
      item.appendChild(viewBtn);
    }
  }

  return item;
}

// ─── Favorites ────────────────────────────────────────────────────────────────

async function onToggleFavorite() {
  if (!selectedRom) return;
  const id  = getRomId(selectedRom);
  const lib = library[id];
  const newVal = lib?.is_favorite ? 0 : 1;
  await window.electronAPI.setFavorite({ identifier: id, isFavorite: !!newVal });
  library = await window.electronAPI.getLibrary();
  updateFavoriteButton();
  renderLibraryGrid();
}

const SVG_FAVORITE = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M26.9 2.6 L33.3 13.1 45.3 15.9 Q46.5 16.3 47.2 17.3 48 18.2 48 19.4 47.9 20.6 47.1 21.6 L39.1 31 40.1 43.2 Q40.2 44.5 39.5 45.4 38.8 46.5 37.6 46.8 L35.3 46.7 24 42 12.6 46.7 10.3 46.8 Q9.1 46.5 8.4 45.4 7.7 44.5 7.8 43.2 L8.8 31 0.8 21.6 Q0 20.6 0 19.4 -0.1 18.2 0.7 17.3 1.4 16.3 2.6 15.9 L14.6 13.1 21 2.6 Q21.7 1.6 22.8 1.2 24 0.8 25.1 1.2 26.3 1.6 26.9 2.6"/></svg>`;

function updateFavoriteButton() {
  const btn = document.getElementById('btn-favorite');
  if (!btn || !selectedRom) return;
  const isFav = !!library[getRomId(selectedRom)]?.is_favorite;
  btn.innerHTML = SVG_FAVORITE;
  btn.classList.toggle('is-favorite', isFav);
}

// ─── Notes ────────────────────────────────────────────────────────────────────

async function onSaveNotes() {
  if (!selectedRom) return;
  const notesInput = document.getElementById('notes-input');
  const indicator  = document.getElementById('notes-saved-indicator');
  await window.electronAPI.setNotes({ identifier: getRomId(selectedRom), notes: notesInput.value });
  library = await window.electronAPI.getLibrary();
  indicator.textContent = '✓ Saved';
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 2000);
}

function loadNotesForRom(identifier) {
  const notesInput = document.getElementById('notes-input');
  const indicator  = document.getElementById('notes-saved-indicator');
  if (!notesInput) return;
  notesInput.value = library[identifier]?.notes || '';
  if (indicator) { indicator.textContent = ''; indicator.classList.remove('show'); }
}

// ─── Collections ──────────────────────────────────────────────────────────────

function renderCollectionFilter() {
  const sel = document.getElementById('collection-filter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Collections</option>';
  collections.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name + (c.games.length ? ` (${c.games.length})` : '');
    sel.appendChild(opt);
  });
  sel.value = prev;
  renderFsCollectionPills();
}

function renderFsCollectionPills() {
  const sel = document.getElementById('fs-collection-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">All Collections</option>';
  collections.forEach(c => {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = `${c.name} (${c.games.length})`;
    sel.appendChild(opt);
  });
  sel.value = activeCollection ? String(activeCollection) : '';
  if (!sel._wired) {
    sel._wired = true;
    sel.addEventListener('change', () => {
      activeCollection = sel.value;
      if (activeCollection) activeFilter = 'all';
      syncFilterSortModal();
      applyFilterSort();
      updateFilterSortLabel();
    });
  }
}

function renderCollectionChips(identifier) {
  const container = document.getElementById('detail-collection-chips');
  if (!container) return;
  container.innerHTML = '';
  if (!identifier) return;
  collections.filter(c => c.games.includes(identifier)).forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'detail-collection-chip';
    chip.textContent = c.name;
    if (c.color) { chip.style.borderColor = c.color; chip.style.color = c.color; }
    container.appendChild(chip);
  });
}

function openFilterSortModal()  {
  syncFilterSortModal();
  renderFsCollectionPills();
  renderFsMetaPills();
  document.getElementById('filter-sort-modal').classList.remove('hidden');
}
function closeFilterSortModal() { document.getElementById('filter-sort-modal').classList.add('hidden'); }

// Render dynamic HLTB metadata filter dropdowns from the index
function renderFsMetaPills() {
  const dims = [
    { key: 'genre',       stateKey: 'filterGenre',     selId: 'fs-genre-select',     sectionId: 'fs-genre-section',     blank: 'All Genres',      getVal: m => (m.genre || '').split(',').map(s => s.trim()).filter(Boolean) },
    { key: 'developer',   stateKey: 'filterDeveloper', selId: 'fs-developer-select', sectionId: 'fs-developer-section', blank: 'All Developers',  getVal: m => m.developer ? [m.developer] : [] },
    { key: 'releaseDate', stateKey: 'filterReleased',  selId: 'fs-released-select',  sectionId: 'fs-released-section',  blank: 'All Years',       getVal: m => m.releaseDate ? [m.releaseDate] : [] },
    { key: 'esrb',        stateKey: 'filterEsrb',      selId: 'fs-esrb-select',      sectionId: 'fs-esrb-section',      blank: 'All Ratings',     getVal: m => m.esrb ? [m.esrb] : [] },
    { key: 'pegi',        stateKey: 'filterPegi',      selId: 'fs-pegi-select',      sectionId: 'fs-pegi-section',      blank: 'All Ratings',     getVal: m => m.pegi ? [m.pegi] : [] },
  ];

  const getState = key => ({ filterGenre, filterDeveloper, filterReleased, filterEsrb, filterPegi })[key];
  const setState = (key, val) => {
    if      (key === 'filterGenre')     filterGenre     = val;
    else if (key === 'filterDeveloper') filterDeveloper = val;
    else if (key === 'filterReleased')  filterReleased  = val;
    else if (key === 'filterEsrb')      filterEsrb      = val;
    else if (key === 'filterPegi')      filterPegi      = val;
  };

  for (const dim of dims) {
    const sel     = document.getElementById(dim.selId);
    const section = document.getElementById(dim.sectionId);
    if (!sel || !section) continue;

    // Collect unique values
    const vals = new Set();
    for (const m of Object.values(hltbMetaIndex)) {
      for (const v of dim.getVal(m)) if (v) vals.add(v);
    }

    if (!vals.size) { section.style.display = 'none'; continue; }
    section.style.display = '';

    // Sort: years descending, else alphabetically
    const sorted = [...vals].sort((a, b) =>
      dim.key === 'releaseDate' ? b.localeCompare(a) : a.localeCompare(b)
    );

    // Rebuild options
    sel.innerHTML = `<option value="">${dim.blank}</option>`;
    sorted.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    });
    sel.value = getState(dim.stateKey) || '';

    // Wire change handler once
    if (!sel._wired) {
      sel._wired = true;
      sel.addEventListener('change', () => {
        setState(dim.stateKey, sel.value);
        applyFilterSort();
        updateFilterSortLabel();
      });
    }
  }
}

function syncFilterSortModal() {
  document.querySelectorAll('.fs-pill[data-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === activeFilter);
    btn.onclick = () => {
      activeFilter = btn.dataset.filter; activeCollection = '';
      document.querySelectorAll('.fs-pill[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFsCollectionPills(); applyFilterSort(); updateFilterSortLabel();
    };
  });
  document.querySelectorAll('.fs-pill[data-sort]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortOrder);
    btn.onclick = () => {
      sortOrder = btn.dataset.sort;
      document.getElementById('sort-filter').value = sortOrder;
      document.querySelectorAll('.fs-pill[data-sort]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilterSort(); updateFilterSortLabel();
    };
  });
}

function applyFilterSort() { renderLibraryGrid(); }

function updateFilterSortLabel() {
  const label = document.getElementById('filter-sort-label');
  const btn   = document.getElementById('btn-filter-sort');
  if (!label) return;
  const sortLabels = { az: 'A → Z', za: 'Z → A' };
  const filterLabel = activeFilter === 'favorites' ? '★ Fav' : activeFilter === 'installed' ? 'Installed' : 'All';
  const collectionLabel = activeCollection ? (collections.find(c => String(c.id) === String(activeCollection))?.name || '') : '';
  const show = collectionLabel || filterLabel;
  const isDefault = activeFilter === 'all' && !activeCollection && sortOrder === 'az';
  label.textContent = isDefault ? 'ADV Filtering' : `${show} · ${sortLabels[sortOrder] || 'A → Z'}`;
  btn.classList.toggle('is-active', !isDefault);
}

function openCollectionsModal()  { renderCollectionsList(); document.getElementById('collections-modal').classList.remove('hidden'); }
function closeCollectionsModal() { document.getElementById('collections-modal').classList.add('hidden'); }

function renderCollectionsList() {
  const list = document.getElementById('collections-list');
  list.innerHTML = '';
  if (!collections.length) {
    list.innerHTML = '<li style="padding:12px;color:var(--text-dim);font-size:13px;">No collections yet. Create one above.</li>';
    return;
  }
  collections.forEach(c => {
    const li = document.createElement('li');
    li.className = 'collection-item';
    const nameSpan  = document.createElement('span');
    nameSpan.className = 'collection-name'; nameSpan.textContent = c.name;
    const countSpan = document.createElement('span');
    countSpan.className = 'collection-count'; countSpan.textContent = `${c.games.length} ROM${c.games.length !== 1 ? 's' : ''}`;
    const colorInput = document.createElement('input');
    colorInput.type = 'color'; colorInput.className = 'collection-color-input'; colorInput.value = c.color || '#888899';
    if (!c.color) colorInput.dataset.unset = 'true';
    colorInput.addEventListener('change', async () => {
      delete colorInput.dataset.unset;
      await window.electronAPI.setCollectionColor({ id: c.id, color: colorInput.value });
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter(); renderCollectionChips(selectedRom ? getRomId(selectedRom) : null);
    });
    const renameBtn = document.createElement('button');
    renameBtn.className = 'collection-rename-btn'; renameBtn.textContent = '✏ Rename';
    renameBtn.addEventListener('click', async () => {
      const newName = prompt(`Rename "${c.name}" to:`, c.name);
      if (!newName || newName.trim() === c.name) return;
      await window.electronAPI.renameCollection({ id: c.id, name: newName });
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter(); renderCollectionsList();
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'collection-delete-btn'; deleteBtn.textContent = '🗑 Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete collection "${c.name}"?`)) return;
      await window.electronAPI.deleteCollection({ id: c.id });
      if (String(activeCollection) === String(c.id)) activeCollection = '';
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter(); renderCollectionsList(); renderLibraryGrid();
    });
    li.appendChild(colorInput); li.appendChild(nameSpan); li.appendChild(countSpan);
    li.appendChild(renameBtn); li.appendChild(deleteBtn);
    list.appendChild(li);
  });
}

async function onCreateCollection() {
  const input = document.getElementById('new-collection-input');
  const name  = input.value.trim();
  if (!name) return;
  const result = await window.electronAPI.createCollection({ name });
  if (!result.ok) { alert('Could not create collection: ' + (result.error || 'name already exists')); return; }
  input.value = '';
  collections = await window.electronAPI.getCollections();
  renderCollectionFilter(); renderCollectionsList();
}

async function onAddToCollection() {
  if (!selectedRom || !collections.length) {
    if (!collections.length) alert('Create a collection first.');
    return;
  }
  const modal = document.getElementById('add-collection-modal');
  const list  = document.getElementById('add-collection-list');
  const label = document.getElementById('add-collection-game-name');
  label.textContent = getRomTitle(selectedRom);
  list.innerHTML = '';
  for (const c of collections) {
    const isInCol = c.games.includes(getRomId(selectedRom));
    const li = document.createElement('li');
    li.className = 'add-coll-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = isInCol;
    const span = document.createElement('span');
    span.textContent = c.name;
    cb.addEventListener('change', async () => {
      if (cb.checked) await window.electronAPI.addGameToCollection({ collectionId: c.id, identifier: getRomId(selectedRom) });
      else            await window.electronAPI.removeGameFromCollection({ collectionId: c.id, identifier: getRomId(selectedRom) });
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter(); renderCollectionChips(getRomId(selectedRom));
      if (activeCollection) renderLibraryGrid();
    });
    li.addEventListener('click', (e) => { if (e.target !== cb) cb.click(); });
    li.appendChild(cb); li.appendChild(span);
    list.appendChild(li);
  }
  modal.classList.remove('hidden');
}

function closeAddCollectionModal() { document.getElementById('add-collection-modal').classList.add('hidden'); }

// ─── Settings ─────────────────────────────────────────────────────────────────

async function openSettings() {
  const s = await window.electronAPI.getSettings();
  downloadPathInput.value           = s.downloadPath      || '';
  installPathInput.value            = s.installPath       || '';
  extractArchiveCheck.checked       = !!s.extractArchive;
  deleteAfterInstallCheck.checked   = !!s.deleteAfterInstall;
  installedFirstCheck.checked       = !!s.installedFirst;
  showInstalledBadgeCheck.checked   = s.showInstalledBadge !== false;
  const retroarchInput = document.getElementById('setting-retroarch-path');
  if (retroarchInput) retroarchInput.value = s.retroarchPath || '';
  libretroSystems.forEach(system => {
    const input = document.getElementById(`setting-core-${system.id}`);
    if (input) input.value = (s.cores || {})[system.id] || '';
  });
  const sgdbInput = document.getElementById('setting-sgdb-key');
  if (sgdbInput) sgdbInput.value = s.steamGridDbKey || '';
  const raKeyInput  = document.getElementById('setting-ra-key');
  const raUserInput = document.getElementById('setting-ra-user');
  if (raKeyInput)  raKeyInput.value  = s.retroAchievementsKey  || '';
  if (raUserInput) raUserInput.value = s.retroAchievementsUser || '';
  // Populate saved credentials if any
  const savedCreds = await window.electronAPI.archiveGetCredentials();
  const saveCheck  = document.getElementById('setting-archive-save');
  const emailInput = document.getElementById('setting-archive-email');
  if (savedCreds.ok && emailInput) {
    emailInput.value = savedCreds.email || '';
    if (saveCheck) saveCheck.checked = true;
  } else {
    // Default to checked so new users save by default
    if (saveCheck) saveCheck.checked = true;
  }
  // Refresh archive.org login status
  await refreshArchiveLoginStatus();
  // Auto-open archive section if not logged in
  const archiveSection = document.getElementById('settings-section-archive');
  if (archiveSection) {
    const loggedIn = document.getElementById('archiveorg-status-text')?.textContent?.startsWith('✓');
    if (!loggedIn) archiveSection.setAttribute('open', '');
    else archiveSection.removeAttribute('open');
  }
  settingsModal.classList.remove('hidden');
}

async function refreshArchiveLoginStatus() {
  const result = await window.electronAPI.archiveCheck();
  const statusText  = document.getElementById('archiveorg-status-text');
  const loginForm   = document.getElementById('archiveorg-login-form');
  const logoutBtn   = document.getElementById('btn-archive-logout');
  if (!statusText) return;
  if (result.loggedIn) {
    statusText.textContent = `✓ Logged in as ${result.username || 'unknown'}`;
    statusText.style.color = 'var(--success, #4caf50)';
    loginForm?.classList.add('hidden');
    logoutBtn?.classList.remove('hidden');

    // Show the "save login" checkbox in the logged-in state
    const savedCredsDiv = document.getElementById('archiveorg-saved-creds');
    const saveLoggedIn  = document.getElementById('setting-archive-save-loggedin');
    if (savedCredsDiv) savedCredsDiv.classList.remove('hidden');
    if (saveLoggedIn) {
      // Reflect current saved state
      const creds = await window.electronAPI.archiveGetCredentials();
      saveLoggedIn.checked = creds.ok;
      // Wire up toggle (remove old listener first)
      const newBox = saveLoggedIn.cloneNode(true);
      saveLoggedIn.parentNode.replaceChild(newBox, saveLoggedIn);
      newBox.checked = creds.ok;
      newBox.addEventListener('change', async () => {
        if (newBox.checked) {
          // Need email+password to save — prompt re-entry
          loginForm?.classList.remove('hidden');
          savedCredsDiv?.classList.add('hidden');
          showToast('Enter your password below to save credentials');
        } else {
          await window.electronAPI.archiveSaveCredentials({ email: null, password: null });
          showToast('Saved credentials cleared');
        }
      });
    }

    // Show load button if ROMs aren't loaded yet
    let loadBtn = document.getElementById('btn-load-roms-now');
    if (!loadBtn) {
      loadBtn = document.createElement('button');
      loadBtn.id = 'btn-load-roms-now';
      loadBtn.textContent = '▶ Load ROM Library';
      loadBtn.style.cssText = 'margin-top:8px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);padding:8px 16px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:13px;cursor:pointer;width:100%;';
      loadBtn.addEventListener('click', () => { closeSettings(); fetchRoms(); });
      logoutBtn?.parentNode?.insertBefore(loadBtn, logoutBtn);
    }
    loadBtn.style.display = allRoms.length ? 'none' : 'block';
  } else {
    const savedCredsDiv = document.getElementById('archiveorg-saved-creds');
    if (savedCredsDiv) savedCredsDiv.classList.add('hidden');
    statusText.textContent = 'Not logged in — required to access ROM library';
    statusText.style.color = 'var(--text-dim)';
    loginForm?.classList.remove('hidden');
    logoutBtn?.classList.add('hidden');
  }
}

async function onArchiveLogin() {
  const email    = document.getElementById('setting-archive-email')?.value?.trim();
  const password = document.getElementById('setting-archive-password')?.value;
  const saveIt   = document.getElementById('setting-archive-save')?.checked ?? false;
  const errorEl  = document.getElementById('archive-login-error');
  const btn      = document.getElementById('btn-archive-login');
  if (!email || !password) { if (errorEl) errorEl.textContent = 'Enter email and password.'; return; }
  if (errorEl) errorEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Logging in…';
  const result = await window.electronAPI.archiveLogin({ email, password });
  btn.disabled = false; btn.textContent = 'Log In';
  if (result.ok) {
    console.log('[login] saveIt checkbox =', saveIt, '| email =', email);
    if (saveIt) {
      console.log('[login] calling archiveSaveCredentials with credentials');
      const saveResult = await window.electronAPI.archiveSaveCredentials({ email, password });
      console.log('[login] archiveSaveCredentials result:', saveResult);
    } else {
      await window.electronAPI.archiveSaveCredentials({ email: null, password: null });
    }
    document.getElementById('setting-archive-password').value = '';
    await refreshArchiveLoginStatus();
    showToast(`✓ Logged in as ${result.username}${saveIt ? ' — credentials saved' : ''}`);
    // If ROM list was gated behind login, load it now
    if (!allRoms.length) {
      closeSettings();
      fetchRoms();
    }
  } else {
    if (errorEl) errorEl.textContent = result.error || 'Login failed';
  }
}

async function onArchiveLogout() {
  await window.electronAPI.archiveLogout();
  await window.electronAPI.archiveSaveCredentials({ email: null, password: null });
  await refreshArchiveLoginStatus();
  allRoms = [];
  renderLibraryGrid();
  renderHomeStats();
  showToast('Logged out of archive.org');
}

function closeSettings() { settingsModal.classList.add('hidden'); }

async function saveSettings() {
  const cores = {};
  libretroSystems.forEach(system => {
    cores[system.id] = document.getElementById(`setting-core-${system.id}`)?.value?.trim() || '';
  });
  await window.electronAPI.saveSettings({
    downloadPath:       downloadPathInput.value.trim(),
    installPath:        installPathInput.value.trim(),
    extractArchive:     extractArchiveCheck.checked,
    deleteAfterInstall: deleteAfterInstallCheck.checked,
    installedFirst:     installedFirstCheck.checked,
    showInstalledBadge: showInstalledBadgeCheck.checked,
    retroarchPath:      document.getElementById('setting-retroarch-path')?.value?.trim() || '',
    cores,
    steamGridDbKey:          document.getElementById('setting-sgdb-key')?.value?.trim() || '',
    retroAchievementsKey:     document.getElementById('setting-ra-key')?.value?.trim()  || '',
    retroAchievementsUser:    document.getElementById('setting-ra-user')?.value?.trim() || '',
  });
  installedFirst     = installedFirstCheck.checked;
  showInstalledBadge = showInstalledBadgeCheck.checked;
  applyInstalledBadgeSetting();
  if (allRoms.length) renderLibraryGrid(); // only re-render if ROMs are loaded
  closeSettings();
}

function applyInstalledBadgeSetting() {
  if (showInstalledBadge) libraryGrid.classList.remove('hide-installed-badge');
  else                    libraryGrid.classList.add('hide-installed-badge');
}

async function onScanForGames() {
  const resultEl = document.getElementById('scan-result');
  const btn      = document.getElementById('btn-scan-games');
  if (!allRoms.length) { resultEl.textContent = 'ROMs not loaded yet.'; return; }
  const s       = await window.electronAPI.getSettings();
  const scanDir = s.installPath || s.downloadPath || null;
  if (!scanDir) { resultEl.textContent = 'Set an Install Folder first.'; return; }
  btn.disabled = true; btn.textContent = '⏳ Scanning…'; resultEl.textContent = '';
  const knownIdentifiers = allRoms.map(r => getRomId(r));
  const titleMap = {};
  for (const rom of allRoms) titleMap[rom.cleanName] = getRomId(rom);
  const result = await window.electronAPI.scanForGames({ scanDir, knownIdentifiers, titleMap });
  btn.disabled = false; btn.textContent = '🔍 Scan Install Folder';
  if (!result.found.length) { resultEl.textContent = 'No new ROMs found.'; return; }
  library = await window.electronAPI.getLibrary();
  renderLibraryGrid(); renderHomeStats();
  resultEl.textContent = `✓ Found ${result.found.length} ROM${result.found.length !== 1 ? 's' : ''}!`;
}

// ─── About + Changelog ────────────────────────────────────────────────────────

let pendingUpdateInfo = null;

async function openAbout() {
  if (!aboutModal) return;
  if (!aboutVersion.textContent) {
    const v = await window.electronAPI.getAppVersion();
    aboutVersion.textContent = `Version ${v}`;
  }
  aboutModal.classList.remove('hidden');
}

function closeAbout() { aboutModal?.classList.add('hidden'); }

function markdownToHtml(md) {
  if (!md) return '<p class="changelog-no-notes">No release notes provided.</p>';
  let html = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  html = html.replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code>$1</code>');
  html = html.replace(/^[\-\*] (.+)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g,m=>`<ul>${m}</ul>`);
  return html;
}

function openChangelog() {
  if (!changelogModal || !pendingUpdateInfo) return;
  const { version, releaseNotes, releaseDate, isReady } = pendingUpdateInfo;
  changelogBadge.textContent = `v${version}`;
  if (releaseDate) { changelogDate.textContent = `Released ${new Date(releaseDate).toLocaleDateString()}`; changelogDate.style.display = 'block'; }
  else             { changelogDate.style.display = 'none'; }
  changelogBody.innerHTML = markdownToHtml(releaseNotes);
  if (isReady) btnChangelogInstall?.classList.remove('hidden');
  else         btnChangelogInstall?.classList.add('hidden');
  changelogModal.classList.remove('hidden');
}

function closeChangelog() { changelogModal?.classList.add('hidden'); }

// ─── Search clear ─────────────────────────────────────────────────────────────

function updateSearchClear() {
  const btn = document.getElementById('btn-search-clear');
  if (!btn) return;
  btn.classList.toggle('visible', searchInput.value.length > 0);
}

// ─── Keyboard navigation ──────────────────────────────────────────────────────

let currentView = 'home';

function onGlobalKeydown(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape' && currentView === 'detail') showHomeView();
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, duration = 3500) {
  document.getElementById('app-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, duration);
}

// ─── Home screen ──────────────────────────────────────────────────────────────

let homeFeaturedRom  = null;
let homeRandomRom    = null;
let bannerRotateTimer = null;

function showHomeView() {
  currentView = 'home';
  document.getElementById('home-view').classList.remove('hidden');
  document.getElementById('detail-panel').classList.add('hidden');
  document.getElementById('hero').style.display = 'none';
  document.getElementById('btn-home').classList.add('active');
  renderHomeScreen();
}

function showDetailView(rom) {
  currentView = 'detail';
  document.getElementById('home-view').classList.add('hidden');
  document.getElementById('detail-panel').classList.remove('hidden');
  document.getElementById('hero').style.display = '';
  document.getElementById('btn-home').classList.remove('active');
  selectRom(rom);
}

function renderHomeScreen() {
  renderHomeBanner();
  renderHomeStats();
  renderHomeRecentRow();
  renderHomePlayedRow();
  renderHomeRandomPick();
  startBannerRotation();
}

function renderHomeBanner(rom) {
  if (!allRoms.length) return;
  if (!rom) {
    if (!homeFeaturedRom) homeFeaturedRom = allRoms[Math.floor(Math.random() * allRoms.length)];
    rom = homeFeaturedRom;
  }
  const title = getRomTitle(rom);
  document.getElementById('home-banner-title').textContent = title;
  const bannerBg = document.getElementById('home-banner-bg');
  const id = getRomId(rom);
  const bannerUrl = artCache[id] || logoCache[id] || null;
  if (bannerUrl) {
    bannerBg.style.backgroundImage = `url("${bannerUrl}")`;
  } else {
    bannerBg.style.backgroundImage = 'none';
    window.electronAPI.getRomArt({ cleanName: rom.cleanName, system: currentSystem }).then(r => {
      if (r.ok) {
        artCache[id] = r.url;
        if (homeFeaturedRom && getRomId(homeFeaturedRom) === id) bannerBg.style.backgroundImage = `url("${r.url}")`;
      }
    }).catch(() => {});
  }
  const btnView = document.getElementById('home-banner-btn');
  const newBtn  = btnView.cloneNode(true);
  btnView.parentNode.replaceChild(newBtn, btnView);
  newBtn.addEventListener('click', (e) => { e.stopPropagation(); showDetailView(rom); });
  document.getElementById('home-banner').onclick = () => showDetailView(rom);
}

function startBannerRotation() {
  if (bannerRotateTimer) clearInterval(bannerRotateTimer);
  bannerRotateTimer = setInterval(() => {
    if (currentView !== 'home' || allRoms.length < 2) return;
    let next;
    do { next = allRoms[Math.floor(Math.random() * allRoms.length)]; }
    while (next.name === homeFeaturedRom?.name && allRoms.length > 1);
    homeFeaturedRom = next;
    renderHomeBanner(next);
  }, 18000);
}

function renderHomeStats() {
  const libEntries = Object.values(library);
  document.getElementById('stat-total').textContent       = allRoms.length || '—';
  document.getElementById('stat-installed').textContent   = libEntries.filter(e => e.install_dir).length;
  document.getElementById('stat-favorites').textContent   = libEntries.filter(e => e.is_favorite).length;
  document.getElementById('stat-collections').textContent = collections.length;
}

function renderHomeRecentRow() {
  const row = document.getElementById('home-row-recent');
  row.innerHTML = '';
  const recent = allRoms.slice(0, 20);
  if (!recent.length) { row.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">Loading…</span>'; return; }
  recent.forEach(rom => row.appendChild(makeHomeRomCard(rom, null)));
}

function renderHomePlayedRow() {
  const section = document.getElementById('home-section-played');
  const row     = document.getElementById('home-row-played');
  row.innerHTML = '';
  const played = Object.entries(library)
    .filter(([, e]) => e.playtime_secs > 0)
    .sort(([, a], [, b]) => (b.last_played_at || 0) - (a.last_played_at || 0))
    .slice(0, 20)
    .map(([id]) => allRoms.find(r => getRomId(r) === id))
    .filter(Boolean);
  if (!played.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  played.forEach(rom => row.appendChild(makeHomeRomCard(rom, 'playtime')));
}

function makeHomeRomCard(rom, mode) {
  const card = document.createElement('div');
  card.className = 'home-game-card';
  const img = document.createElement('img');
  img.className = 'home-game-thumb'; img.alt = getRomTitle(rom); img.loading = 'lazy';
  const id = getRomId(rom);
  if      (logoCache[id])  { img.src = logoCache[id]; }
  else if (artCache[id])   { img.src = artCache[id]; }
  else {
    img.style.visibility = 'hidden';
    scheduleArtFetch([rom]);
    // When art arrives, update this specific img element
    const checkInterval = setInterval(() => {
      const url = logoCache[id] || artCache[id];
      if (url) {
        img.src = url;
        img.style.visibility = '';
        clearInterval(checkInterval);
      } else if (logoCache[id] === null && !artCache[id]) {
        // fetch finished with nothing
        clearInterval(checkInterval);
      }
    }, 200);
  }
  const label = document.createElement('span');
  label.className = 'home-game-label'; label.textContent = getRomTitle(rom);
  card.appendChild(img); card.appendChild(label);
  if (mode === 'playtime') {
    const lib = library[id];
    if (lib?.playtime_secs) {
      const ptEl = document.createElement('span');
      ptEl.className = 'home-game-playtime'; ptEl.innerHTML = `⏱ ${formatPlaytime(lib.playtime_secs)}`;
      card.appendChild(ptEl);
    }
  }
  card.addEventListener('click', () => showDetailView(rom));
  return card;
}

function pickRandomRom() {
  const installed = allRoms.filter(r => library[getRomId(r)]?.install_dir);
  const unplayed  = installed.filter(r => !library[getRomId(r)]?.playtime_secs);
  const pool = unplayed.length ? unplayed : installed.length ? installed : allRoms;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function renderHomeRandomPick(forceNew) {
  const section = document.getElementById('home-section-random');
  const wrap    = document.getElementById('home-random-card');
  wrap.innerHTML = '';
  if (forceNew || !homeRandomRom) homeRandomRom = pickRandomRom();
  const rom = homeRandomRom;
  if (!rom) { section.style.display = 'none'; return; }
  section.style.display = '';

  const id        = getRomId(rom);
  const installed = !!library[id]?.install_dir;
  const title     = getRomTitle(rom);

  const card = document.createElement('div');
  card.className = 'random-pick';
  const img = document.createElement('img');
  img.className = 'random-pick-thumb'; img.alt = title;
  // Play Something shows the grid (portrait box art), not the logo
  if (artCache[id]) {
    img.src = artCache[id];
  } else {
    img.style.visibility = 'hidden';
    // Fetch grid art directly
    window.electronAPI.getRomArt({ cleanName: rom.cleanName, system: currentSystem }).then(r => {
      if (r.ok) {
        artCache[id] = r.url;
        img.src = r.url;
        img.style.visibility = '';
      }
    }).catch(() => {});
  }

  const info = document.createElement('div');
  info.className = 'random-pick-info';
  const titleEl = document.createElement('div');
  titleEl.className = 'random-pick-title'; titleEl.textContent = title;
  info.appendChild(titleEl);

  if (rom.region) {
    const metaEl = document.createElement('div');
    metaEl.className = 'random-pick-meta'; metaEl.textContent = rom.region;
    info.appendChild(metaEl);
  }

  if (installed) {
    const badge = document.createElement('span');
    badge.className = 'random-pick-installed'; badge.textContent = 'Installed';
    info.appendChild(badge);
  }

  const actionBtn = document.createElement('button');
  actionBtn.className = 'random-pick-launch';
  if (installed) {
    actionBtn.textContent = '▶ Launch';
    actionBtn.addEventListener('click', (e) => { e.stopPropagation(); showDetailView(rom); setTimeout(() => onLaunch(), 100); });
  } else {
    actionBtn.textContent = 'View ROM';
    actionBtn.addEventListener('click', (e) => { e.stopPropagation(); showDetailView(rom); });
  }

  card.appendChild(img); card.appendChild(info); card.appendChild(actionBtn);
  card.addEventListener('click', () => showDetailView(rom));
  wrap.appendChild(card);
}

// ─── HLTB background prefetch ───────────────────────────────────────────
// Prefetches HLTB data for ALL systems, not just the currently selected one.
// ROM lists are loaded directly via IPC so this works regardless of which
// system is visible in the sidebar.

// All system identifiers — add new systems here as they're added
const ALL_SYSTEMS = ['snes', 'psx'];

let _prefetchRunning  = false;
let _prefetchDismissed = false;

async function startHltbPrefetch() {
  if (_prefetchRunning || _prefetchDismissed) return;

  // Collect unique clean names across ALL systems
  const titleMap = new Map(); // cleanName.toLowerCase() -> cleanName

  for (const system of ALL_SYSTEMS) {
    try {
      const r = await window.electronAPI.fetchRomList({ system });
      if (!r.ok) continue;
      for (const rom of r.roms) {
        if (rom.tags?.includes('Pirate')) continue;
        const key = rom.cleanName.toLowerCase();
        if (!titleMap.has(key)) titleMap.set(key, rom.cleanName);
      }
    } catch {}
  }

  const titles = [...titleMap.values()];
  if (!titles.length) return;

  const total   = titles.length;
  let done      = 0;
  let fetched   = 0;

  const bar     = document.getElementById('hltb-prefetch-bar');
  const fill    = document.getElementById('hltb-prefetch-fill');
  const label   = document.getElementById('hltb-prefetch-label');
  const dismiss = document.getElementById('hltb-prefetch-dismiss');
  if (!bar) return;

  // Wire dismiss button once
  if (!dismiss._wired) {
    dismiss._wired = true;
    dismiss.addEventListener('click', () => {
      _prefetchDismissed = true;
      bar.classList.add('hidden');
    });
  }

  bar.classList.remove('hidden');
  bar.style.display = 'block';
  _prefetchRunning = true;

  const updateUI = () => {
    const pct = total ? Math.round(done / total * 100) : 0;
    fill.style.width  = pct + '%';
    label.textContent = `HLTB data: ${done.toLocaleString()} / ${total.toLocaleString()}`;
  };
  updateUI();

  // Wait two animation frames so the browser actually paints the bar before the loop runs
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const DELAY_MS   = 350;  // between real fetches — polite rate
  const BATCH_SKIP = 50;   // yield to UI every N cached titles

  let skipStreak = 0;

  for (const cleanName of titles) {
    if (_prefetchDismissed) break;

    const result = await window.electronAPI.hltbPrefetchNext({ cleanName });
    done++;

    if (result.skipped) {
      skipStreak++;
      if (skipStreak % BATCH_SKIP === 0) {
        updateUI();
        await new Promise(r => setTimeout(r, 4)); // small yield to keep UI alive
      }
    } else {
      skipStreak = 0;
      fetched++;
      updateUI();
      // Refresh the filter index every 10 new fetches
      if (fetched % 10 === 0) {
        hltbMetaIndex = await window.electronAPI.listHltbCache().catch(() => hltbMetaIndex);
        renderFsMetaPills();
      }
      // Polite delay between actual network requests
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Final index refresh
  hltbMetaIndex = await window.electronAPI.listHltbCache().catch(() => hltbMetaIndex);
  renderFsMetaPills();

  _prefetchRunning = false;
  fill.style.width  = '100%';
  label.textContent = fetched > 0
    ? `HLTB data: complete (${fetched} new across all systems)`
    : `HLTB data: up to date`;

  // Auto-hide after 4 seconds when done, but only if all were cached (instant run)
  setTimeout(() => bar.classList.add('hidden'), fetched > 0 ? 5000 : 2000);
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init();
});
