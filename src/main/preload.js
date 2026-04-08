'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: ()      => ipcRenderer.send('window-minimize'),
  windowMaximize: ()      => ipcRenderer.send('window-maximize'),
  windowClose:    ()      => ipcRenderer.send('window-close'),

  // Settings
  getSettings:    ()      => ipcRenderer.invoke('settings-get'),
  saveSettings:   (s)     => ipcRenderer.invoke('settings-save', s),
  chooseFolder:   ()      => ipcRenderer.invoke('choose-folder'),
  listFolders:    (opts)  => ipcRenderer.invoke('folder-browser-list', opts),
  listProfileGamerPics: () => ipcRenderer.invoke('profile-gamerpics-list'),
  rerunArtMigration: ()   => ipcRenderer.invoke('storage-rerun-art-migration'),
  clearCatalogCache: ()   => ipcRenderer.invoke('storage-clear-catalog-cache'),
  clearArtCache:    ()    => ipcRenderer.invoke('storage-clear-art-cache'),
  openStoragePath:  (opts)=> ipcRenderer.invoke('storage-open-path', opts),

  // Library
  getLibrary:     ()      => ipcRenderer.invoke('library-get'),
  getLibraryGame: (opts)  => ipcRenderer.invoke('library-get-game',    opts),
  upsertLibraryMetadata: (opts) => ipcRenderer.invoke('library-upsert-metadata', opts),
  enrichLibraryGame: (opts) => ipcRenderer.invoke('library-enrich-game', opts),
  previewGameMetadata: (opts) => ipcRenderer.invoke('metadata-preview-game', opts),
  getPackagedMarketplaceMetadata: (opts) => ipcRenderer.invoke('marketplace-packaged-metadata', opts),
  getPackagedMarketplaceMetadataStats: (opts) => ipcRenderer.invoke('marketplace-packaged-metadata-stats', opts),
  markLibraryPlayed: (opts) => ipcRenderer.invoke('library-mark-played', opts),
  checkMetadataService: () => ipcRenderer.invoke('metadata-service-health'),
  setCategory:    (opts)  => ipcRenderer.invoke('library-set-category', opts),
  setFavorite:    (opts)  => ipcRenderer.invoke('library-set-favorite', opts),
  setNotes:       (opts)  => ipcRenderer.invoke('library-set-notes',    opts),

  // Collections
  getCollections:       ()     => ipcRenderer.invoke('collections-get'),
  createCollection:     (opts) => ipcRenderer.invoke('collections-create',     opts),
  deleteCollection:     (opts) => ipcRenderer.invoke('collections-delete',     opts),
  renameCollection:     (opts) => ipcRenderer.invoke('collections-rename',     opts),
  addGameToCollection:  (opts) => ipcRenderer.invoke('collections-add-game',   opts),
  removeGameFromCollection: (opts) => ipcRenderer.invoke('collections-remove-game', opts),
  setCollectionColor:   (opts) => ipcRenderer.invoke('collections-set-color',  opts),

  // Download
  fetchFileList:  (opts)  => ipcRenderer.invoke('fetch-file-list', opts),
  downloadStart:  (opts)  => ipcRenderer.invoke('download-start',  opts),
  downloadCancel: (opts)  => ipcRenderer.invoke('download-cancel', opts),
  marketplaceInstall: (opts) => ipcRenderer.invoke('marketplace-install', opts),
  archiveProbeDownload: (opts) => ipcRenderer.invoke('archiveorg-probe-download', opts),
  fetchMarketplaceThemesCatalog: (opts) => ipcRenderer.invoke('marketplace-themes-catalog', opts),
  inspectMarketplaceThemeFolder: (opts) => ipcRenderer.invoke('marketplace-theme-folder-inspect', opts),
  downloadMarketplaceThemeFolder: (opts) => ipcRenderer.invoke('marketplace-theme-folder-download', opts),
  listDownloadedMarketplaceThemes: () => ipcRenderer.invoke('marketplace-themes-downloaded'),
  deleteMarketplaceTheme: (opts) => ipcRenderer.invoke('marketplace-theme-delete', opts),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, data) => cb(data)),

  // Extract / Install / Delete
  extractArchive: (opts)  => ipcRenderer.invoke('extract-archive', opts),
  installGame:    (opts)  => ipcRenderer.invoke('install-game',    opts),
  setExePath:     (opts)  => ipcRenderer.invoke('set-exe-path',    opts),
  deleteGame:     (opts)  => ipcRenderer.invoke('delete-game',     opts),
  findExes:       (opts)  => ipcRenderer.invoke('find-exes',       opts),

  // Launch
  launchGame:     (opts)  => ipcRenderer.invoke('launch-game',         opts),
  openGameLocation: (opts)=> ipcRenderer.invoke('open-game-location',  opts),
  readReadme:     (opts)  => ipcRenderer.invoke('read-readme',         opts),

  // ROM list + launch
  fetchRomList:       (opts)  => ipcRenderer.invoke('fetch-rom-list', opts),
  listMarketplaceSources: (opts) => ipcRenderer.invoke('marketplace-list-sources', opts),
  fetchMarketplaceCatalog: (opts) => ipcRenderer.invoke('marketplace-fetch-catalog', opts),
  onRomFetchProgress: (cb)   => ipcRenderer.on('rom-fetch-progress', (_, d) => cb(d)),
  clearRomCache:  (opts)  => ipcRenderer.invoke('clear-rom-cache',  opts), // opts: { system }
  launchRom:      (opts)  => ipcRenderer.invoke('launch-rom',     opts),
  hltbSearch:     (opts)  => ipcRenderer.invoke('hltb-search',      opts),
  listHltbCache:    ()      => ipcRenderer.invoke('hltb-list-cache'),
  hltbPrefetchNext: (opts)  => ipcRenderer.invoke('hltb-prefetch-next', opts),
  getLibretroSystems: ()    => ipcRenderer.invoke('libretro-systems'),
  raGameSearch:   (opts)  => ipcRenderer.invoke('ra-game-search',   opts),
  raUserSummary:  ()      => ipcRenderer.invoke('ra-user-summary'),
  listArtCache:   (opts)  => ipcRenderer.invoke('list-art-cache',  opts),
  getRomIcon:     (opts)  => ipcRenderer.invoke('get-rom-icon',    opts),
  getRomArt:      (opts)  => ipcRenderer.invoke('get-rom-art',     opts),
  getRomLogo:     (opts)  => ipcRenderer.invoke('get-rom-logo',    opts),

  // File picker (for RetroArch exe + core paths)
  chooseFile:     (opts)  => ipcRenderer.invoke('choose-file',   opts),

  // Archive.org login
  debugDumpHtml:          (opts) => ipcRenderer.invoke('debug-dump-html', opts),
  archiveAutoLogin:       ()     => ipcRenderer.invoke('archiveorg-autologin'),
  archiveSaveCredentials: (opts) => ipcRenderer.invoke('archiveorg-save-credentials', opts),
  archiveGetCredentials:  ()     => ipcRenderer.invoke('archiveorg-get-credentials'),
  archiveLogin:           (opts) => ipcRenderer.invoke('archiveorg-login',  opts),
  archiveLogout:          ()     => ipcRenderer.invoke('archiveorg-logout'),
  archiveCheck:           ()     => ipcRenderer.invoke('archiveorg-check'),

  // Auto-updater
  onUpdaterStatus: (cb) => ipcRenderer.on('updater-status', (_, data) => cb(data)),
  updaterInstall:  ()   => ipcRenderer.invoke('updater-install'),

  // Thumbnail cache
  getThumb:        (opts) => ipcRenderer.invoke('get-thumb', opts),

  // Scan for pre-existing installs
  scanForGames:    (opts) => ipcRenderer.invoke('scan-for-games', opts),

  // Add to Steam
  addToSteam:      (opts) => ipcRenderer.invoke('add-to-steam', opts),

  // App info
  getAppVersion:   () => ipcRenderer.invoke('app-version'),
  getHeroesPath:   () => ipcRenderer.invoke('heroes-path'),
  checkGameHero:   (opts) => ipcRenderer.invoke('check-game-hero', opts),
  openExternal:    (url) => ipcRenderer.send('open-external', url),

  // Blades theme
  openBladesWindow:    ()      => ipcRenderer.invoke('blades-open'),
  closeBladesWindow:   ()      => ipcRenderer.invoke('blades-close'),
  bladesSelectSystem:  (opts)  => ipcRenderer.invoke('blades-select-system', opts),
  onBladesSystemSelected: (cb) => ipcRenderer.on('blades-system-selected', (_, data) => cb(data)),
  openThirdPartyAccountWindow: (opts) => ipcRenderer.invoke('thirdparty-open-window', opts),
  closeThirdPartyAccountWindow: () => ipcRenderer.invoke('thirdparty-close-window'),
  getThirdPartyAccount: (opts) => ipcRenderer.invoke('thirdparty-get-account', opts),
  saveThirdPartyAccount: (opts) => ipcRenderer.invoke('thirdparty-save-account', opts),
  clearThirdPartyAccount: (opts) => ipcRenderer.invoke('thirdparty-clear-account', opts),

  // Stoat Chat
  stoatLogin:          (opts)  => ipcRenderer.invoke('stoat-login',          opts),
  stoatLogout:         ()      => ipcRenderer.invoke('stoat-logout'),
  stoatStatus:         ()      => ipcRenderer.invoke('stoat-status'),
  stoatListProfiles:   ()      => ipcRenderer.invoke('stoat-list-profiles'),
  stoatSwitchProfile:  (opts)  => ipcRenderer.invoke('stoat-switch-profile', opts),
  stoatServers:        ()      => ipcRenderer.invoke('stoat-servers'),
  stoatChannels:       (opts)  => ipcRenderer.invoke('stoat-channels',       opts),
  stoatDMChannels:     ()      => ipcRenderer.invoke('stoat-dm-channels'),
  stoatMessages:       (opts)  => ipcRenderer.invoke('stoat-messages',       opts),
  stoatSendMessage:    (opts)  => ipcRenderer.invoke('stoat-send-message',   opts),
  stoatOpenDM:         (opts)  => ipcRenderer.invoke('stoat-open-dm',        opts),
  stoatFriends:        ()      => ipcRenderer.invoke('stoat-friends'),
  stoatServerMembers:  (opts)  => ipcRenderer.invoke('stoat-server-members', opts),
  stoatSetPresence:    (opts)  => ipcRenderer.invoke('stoat-set-presence',   opts),
  stoatClearPresence:  ()      => ipcRenderer.invoke('stoat-clear-presence'),
  onStoatReady:        (cb)    => ipcRenderer.on('stoat-ready',          (_, d) => cb(d)),
  onStoatMessage:      (cb)    => ipcRenderer.on('stoat-message',        (_, d) => cb(d)),
  onStoatMessageUpdate:(cb)    => ipcRenderer.on('stoat-message-update', (_, d) => cb(d)),
  onStoatMessageDelete:(cb)    => ipcRenderer.on('stoat-message-delete', (_, d) => cb(d)),
  onStoatTypingStart:  (cb)    => ipcRenderer.on('stoat-typing-start',   (_, d) => cb(d)),
  onStoatTypingStop:   (cb)    => ipcRenderer.on('stoat-typing-stop',    (_, d) => cb(d)),
});
