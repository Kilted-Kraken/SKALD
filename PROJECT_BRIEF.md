# SKALD Launcher — Project Brief

## Current Version: 0.1.0 — Session 1 Complete

## What This Is
A desktop ROM launcher built with Electron (Windows), sourcing ROMs from archive.org's ni-roms collection.
Forked from RohanKar Launcher v1.4.1. The RohanKar project at C:\Projects\RohanKar-Launcher must never be touched.

## Product Direction
- The Xbox 360 Blades interface is the target primary experience for SKALD.
- The legacy non-Blades interface should be treated as a temporary bridge while feature parity and stability are completed.
- New user-facing flows should prefer the Blades shell first whenever practical.
- Once Blades reaches stable parity with the base launcher, the base interface is planned for removal.

## Emulator Integration Roadmap
- Phase 1: libretro-first foundation
  - Treat SKALD as a future frontend shell, not just a launcher for emulator windows.
  - Build around RetroArch/libretro where possible.
  - Prioritize clean core-based integration for RetroArch systems first.
  - Use libretro paths for PPSSPP, PCSX2, and Dolphin only if their compatibility/performance is good enough for production.
- Phase 2: managed external emulator adapters
  - Integrate standalone emulators through stable adapter layers when no clean libretro path exists.
  - Target this model for RPCS3, DuckStation, Xenia, xemu, and shadPS4.
  - Prefer process/config/profile management over window-reparenting hacks.
- Phase 3: Guide and in-play experience
  - Reuse the new Guide shell system for future in-session surfaces.
  - Only pursue true in-play embedded Guide behavior where SKALD controls the render surface.
  - Avoid fragile overlay/reparenting hacks as the primary strategy.

## Emulator Integration Evaluation
- Best long-term foundation: RetroArch / libretro
- Good libretro candidates if production quality is acceptable: PPSSPP, PCSX2, Dolphin
- Better as managed standalone integrations: RPCS3, DuckStation, Xenia, xemu, shadPS4
- Do not build core architecture around unstable or unclear Switch emulator paths until the ecosystem is more stable

## RetroArch Bundle Integration Plan
- Goal: ship a curated, SKALD-managed RetroArch runtime so emulator behavior is seamless, stable, and isolated from any user-owned RetroArch install.

### Folder Layout
- `assets/retroarch-runtime/`
- `assets/retroarch-runtime/retroarch.exe`
- `assets/retroarch-runtime/cores/`
- `assets/retroarch-runtime/info/`
- `assets/retroarch-runtime/assets/`
- `assets/retroarch-runtime/shaders/`
- `assets/retroarch-runtime/retroarch-skald.cfg`
- `assets/retroarch-runtime/manifest.json`

### Runtime User Data Layout
- `%APPDATA%/skald-launcher/retroarch/config`
- `%APPDATA%/skald-launcher/retroarch/saves`
- `%APPDATA%/skald-launcher/retroarch/states`
- `%APPDATA%/skald-launcher/retroarch/system`
- `%APPDATA%/skald-launcher/retroarch/playlists`
- `%APPDATA%/skald-launcher/retroarch/thumbnails`
- `%APPDATA%/skald-launcher/retroarch/logs`

### Build and Package Changes
- Include `assets/retroarch-runtime/**` in the packaged app resources.
- Resolve bundled runtime from `process.resourcesPath` in packaged builds and from `assets/retroarch-runtime` in development.
- Prefer bundled RetroArch by default.
- Keep external RetroArch support only as an advanced override.
- Replace the current "RetroArch executable" setup requirement with bundled-runtime-first behavior plus optional external override.

### Runtime Path Resolver
- Add a dedicated main-process resolver layer:
  - `getBundledRetroarchRoot()`
  - `getBundledRetroarchExe()`
  - `getBundledCorePath(system)`
  - `getRetroarchUserDataRoot()`
  - `ensureRetroarchUserDirs()`
  - `getSkaldRetroarchConfigPath()`
- Launch order:
  - use external RetroArch only if the user explicitly selects it
  - otherwise use bundled RetroArch
  - always resolve mutable paths into SKALD userData
  - always launch with explicit `--config`

### First Bundled-Core Manifest
- Create `assets/retroarch-runtime/manifest.json`
- First curated core set:
  - `snes`
  - `nes`
  - `gba`
  - `gbc`
  - `gb`
  - `genesis`
  - `psx`
- Add heavier or more experimental libretro targets later only after validation:
  - `psp`
  - `dolphin`
  - `pcsx2`

### Phase Order
- Phase 1: add bundled runtime folder and manifest
- Phase 2: add main-process resolver and user-data directory bootstrap
- Phase 3: update `launch-rom` to use resolved runtime/core/config paths
- Phase 4: generate and maintain a SKALD-owned RetroArch config
- Phase 5: update settings UI to bundled-runtime-first behavior
- Phase 6: expand curated bundled cores only after each target is validated

### Guardrails
- Do not bundle every available core.
- Do not rely on RetroArch's self-updater for the main shipped experience.
- Do not mix bundled runtime files with mutable saves/config/state.
- Do not make PS2 / Dolphin / PSP bundled-core defaults until they are tested against SKALD quality expectations.

## RGSX Integration Plan
- Goal: treat RGSX as a Marketplace source provider for SKALD, not as an embedded or launched companion app.

### Provider Model
- Create a source provider abstraction in SKALD:
  - `archiveorg`
  - `rgsx`
  - future sources
- Keep SKALD responsible for:
  - installs
  - library entries
  - metadata merge
  - UI
  - download queue state

### RGSX Ingestion Paths
- Support two ingestion paths for RGSX:
  - direct remote source zip ingestion
  - local RGSX cache import as a compatibility bridge

### Normalized SKALD Source Schema
- Normalize all imported source rows into a SKALD-owned shape:
  - `source_id`
  - `system`
  - `title`
  - `identifier`
  - `download_url`
  - `art`
  - `logo`
  - `icon`
  - `metadata`
  - `provider`

### RGSX Files To Inspect First
- `rgsx_settings.json`
- `systems_list.json`
- `games/`
- `images/`
- `history.json` later only if activity/history import is useful

### Adapter Direction
- `Archive.org` remains the current live provider.
- `RGSX` becomes the next provider in the `Discover Games` source picker.
- Build an `RGSX source adapter`, not an `RGSX app integration`.

### Immediate Next Step
- Inspect the actual `RGSX_full_latest.zip` contents and identify:
  - exact catalog file formats
  - per-system game record shape
  - image naming/layout
  - whether `games.zip` is directly reusable by SKALD

### Schema Findings
- `systems_list.json` is a JSON list of platform entries.
- Expected platform entry keys observed in code:
  - `platform_name`
  - `folder`
  - `platform_image`
- `games/` contains one JSON file per platform.
- Platform game files may be:
  - a flat list
  - a `{ "games": [...] }` wrapper
  - a single object row
- Individual game rows may be:
  - arrays like `[name, url, size]`
  - objects using fields like `game_name`, `name`, `title`, `game`
  - URL fields like `download_url`, `torrent_url`, `url`, `download`, `link`, `href`
- RGSX also supports torrent-manifest source rows that expand into individual downloadable entries in its own runtime.

### Current Integration Status
- SKALD now has a Marketplace provider abstraction with:
  - `archiveorg`
  - `rgsx`
- First-pass `rgsx` support is now a local-cache bridge:
  - reads `rgsxCachePath`
  - validates `systems_list.json` + `games/`
  - maps supported systems into SKALD
  - parses per-system game JSON into SKALD catalog rows
- SKALD also supports a local Sources-Manager-style package path:
  - reads `rgsxPackagePath`
  - extracts `games.zip` into SKALD user data
  - then uses the same normalized adapter path
- Current supported RGSX system mappings in SKALD:
  - `snes`
  - `psx`
- Remote/custom URL ingestion is still planned, not implemented yet.

## Metadata and Art Enrichment Roadmap
- Goal: keep user setup friction low by centralizing provider credentials in SKALD infrastructure while permanently storing enriched metadata and art inside each local SKALD install.

### Cloudflare Worker Direction
- Use a thin Worker as the public SKALD enrichment backend.
- Keep provider credentials server-side:
  - IGDB
  - SteamGridDB
- Initial Worker endpoints:
  - `/metadata/search`
  - `/metadata/game`
  - `/art/search`
  - `/health`
- Users should never need their own IGDB or SteamGridDB accounts.
- Worker scaffold now lives in:
  - `services/metadata-worker/`
- Current scaffolded endpoints:
  - `GET /health`
  - `POST /metadata/game`
  - `POST /metadata/search`
  - `POST /art/search`
- Current launcher contract:
  - SKALD sends `title`, `system`, `provider`, and `catalog_identifier`
  - Worker returns normalized metadata and remote art URLs
  - SKALD localizes those art URLs into permanent local files before saving them into the library DB

### Local SKALD Source of Truth
- After a game is enriched once, SKALD stores metadata and art permanently in local user data.
- APIs are enrichment sources, not runtime dependencies for ordinary browsing.

### Local Storage Layout
- Library metadata:
  - `%APPDATA%/skald-launcher/library/`
- Permanent art cache:
  - `%APPDATA%/skald-launcher/art/covers`
  - `%APPDATA%/skald-launcher/art/logos`
  - `%APPDATA%/skald-launcher/art/icons`
  - `%APPDATA%/skald-launcher/art/backgrounds`
  - `%APPDATA%/skald-launcher/art/screenshots`
  - `%APPDATA%/skald-launcher/art/achievements`
  - `%APPDATA%/skald-launcher/art/providers/igdb`
  - `%APPDATA%/skald-launcher/art/providers/steamgriddb`
  - `%APPDATA%/skald-launcher/art/providers/retroachievements`
  - `%APPDATA%/skald-launcher/art/providers/archiveorg`

### Per-Game Enrichment Fields
- identity:
  - `title`
  - `sort_title`
  - `system`
  - `provider`
  - `catalog_identifier`
  - `match_confidence`
- metadata:
  - `description`
  - `genres`
  - `developer`
  - `publisher`
  - `release_date`
  - `players`
  - `rating`
  - `platform_name`
  - `igdb_id`
  - `thegamesdb_id`
  - `retroachievements_game_id`
- art:
  - `cover_path`
  - `logo_path`
  - `icon_path`
  - `background_path`
  - `screenshot_paths`
- RetroAchievements:
  - `has_ra`
  - `ra_console_id`
  - `ra_game_id`
  - `ra_badge_path`
  - `ra_total_achievements`
  - `ra_total_points`
  - `ra_last_sync`
- user/library state:
  - `achievements_unlocked`
  - `achievement_points_earned`
  - `play_count`
  - `play_time_minutes`
  - `last_played`
  - `last_metadata_refresh`
  - `date_modified`

### Enrichment Order
- import/scan local game first
- normalize filename/title
- check SKALD local library/art first
- if missing:
  - fetch metadata from Worker-backed IGDB adapter
  - fetch art from Worker-backed SteamGridDB adapter
  - fetch achievement data/art from RetroAchievements
- save all results locally
- render UI from local storage

### Refresh Policy
- persistent local storage by default
- manual metadata refresh later
- no repeated live provider calls during ordinary browsing

## Blades Cutover Checklist
- Goal: make Blades the primary and then only launcher interface without losing core user functionality that still exists in the legacy renderer.

### Current Recommendation
- Move to `Blades-first` before moving to `Blades-only`.
- Keep the legacy renderer hidden behind a fallback/dev switch until the checklist below is green.

### Legacy-Only Or Risky Areas
- Collections, favorites, and notes management still primarily live in:
  - `src/renderer/renderer.js`
- Legacy settings still expose some deeper/power-user flows that Blades has only partially replaced.
- Media blade sections are still placeholder-level in Blades:
  - `Music`
  - `Pictures`
  - `Videos`
  - `Media Center`
- Games blade sections still needing fuller implementation:
  - `Achievements`
  - `Played Games`
  - `Demos & More`
- Family Settings is now a native Blade panel, but is still intentionally a placeholder for future controls.

### Required Validation Before Blades-Only
- End-to-end launch flow from:
  - `Games -> My Games`
  - `Marketplace -> Archive.org`
  - `Marketplace -> Retro Game Sets`
- End-to-end scan/import flow from:
  - `Games -> Scan for Games`
- End-to-end account and setup flow from:
  - `System -> Emulators`
  - `System -> Storage`
  - `System -> 3rd Party Accounts`
  - `System -> Network Settings`
  - Guide/Guide v2 keyboard and account-entry overlays
- Controller validation:
  - blade-to-blade navigation
  - subpanel back behavior
  - left/right pane switching in game lists
  - left/right pane switching in Network Settings
  - keyboard overlay focus/dismissal

### Feature Decisions Needed Before Legacy Removal
- Decide whether to:
  - port collections to Blades
  - port favorites to Blades
  - port notes to Blades
  - port or intentionally retire the old downloads modal behavior
  - port or intentionally retire advanced legacy settings sections
- Decide whether the following Blade placeholders must be implemented before cutover or can ship as inactive sections:
  - `Games -> Achievements`
  - `Games -> Played Games`
  - `Games -> Demos & More`
  - `Media`
  - `Family Settings`

### Cutover Sequence
1. Finish the validation pass on all critical Blades-only user jobs.
2. Resolve or explicitly defer legacy-only features.
3. Make Blades the default UI.
4. Keep legacy behind a hidden fallback temporarily.
5. Run a short real-world stabilization pass.
6. Remove user-facing legacy entry points.
7. Delete dead legacy renderer code after Blades-only stability is confirmed.

### Definition Of Ready For Blades-Only
- Blades covers all core user jobs:
  - browse
  - download
  - scan/import
  - launch
  - account setup
  - emulator setup
  - storage/settings maintenance
- No critical user workflow still depends on `src/renderer/renderer.js`
- Remaining placeholder panels are either implemented or intentionally accepted as inactive

## Archive.org Refactor Plan
- Goal: treat Archive.org as a provider service, not as the center of launcher flow, while preserving current working download access during the transition.

### Phase 1: Unify Archive Auth Service
- Replace duplicated `archiveorg-autologin` and `archiveorg-login` logic with one shared backend path.
- Consolidate:
  - cookie lookup
  - cookie injection
  - session restore
  - login request
  - logout cleanup
  - status check
- Target shared backend helpers:
  - `getArchiveSessionCookies()`
  - `hasArchiveSession()`
  - `setArchiveResponseCookies(setCookieHeaders)`
  - `performArchiveLogin(email, password)`
  - `restoreArchiveSession()`
  - `logoutArchiveSession()`
  - `getArchiveStatus()`
- Keep renderer-facing IPC stable during this phase:
  - `archiveorg-autologin`
  - `archiveorg-login`
  - `archiveorg-logout`
  - `archiveorg-check`

### Phase 2: Remove Login-Gated Browse Behavior
- Legacy and Blades should both be able to browse bundled/local Archive.org catalogs without requiring login first.
- Archive login should only be required at the point of protected download.
- Replace browse-time auth gating with:
  - browse always available
  - clear per-item/provider auth messaging in Marketplace/Game details

### Phase 3: Replace Legacy Download Flow With Provider-Owned Main-Process Jobs
- Move download/extract/install orchestration out of renderer-led chained calls.
- Renderer should request a provider install job and observe progress/state updates only.
- Archive provider should own:
  - auth requirement checks
  - cookie/header injection
  - redirect handling
  - file download
  - extraction when needed
  - install registration
- Future target API shape:
  - `queueMarketplaceInstall({ provider, system, itemId })`
  - `cancelMarketplaceInstall({ jobId })`
  - progress events emitted from main process

### Current Recommendation
- Implement in order:
  1. unify Archive auth service
  2. remove login-gated browse behavior
  3. migrate downloads to provider-owned jobs
- Keep current working Archive download behavior intact until the provider-owned job path is ready.

## GitHub
- Repo: https://github.com/Kilted-Kraken/SKALD
- Release workflow: git add -A → git commit → git push origin main → git tag vX.X.X → git push origin vX.X.X

## Stack
- Electron (frameless window, Windows desktop)
- Vanilla JS + CSS (no React/Vue)
- better-sqlite3 (SQLite) for ROM library state
- archive.org ni-roms collection as ROM source
- SteamGridDB API for cover art
- RetroArch as the emulator for all systems

## Source Details
- Archive identifier: ni-roms
- SNES ROM list URL: https://ia802803.us.archive.org/view_archive.php?archive=/17/items/ni-roms/roms/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System.zip
- ROM download base: https://archive.org/download/ni-roms/roms/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System.zip/
- Total SNES ROMs: ~4,123

## Architecture
- ROM list: fetched by parsing view_archive.php HTML table (main process IPC: fetch-rom-list)
- ROM metadata: parsed from filename — clean title, region (USA/Japan/Europe), tags (Beta/Rev/etc.)
- Download: single ROM ZIP downloaded from archive.org → extracted → ROM file inside launched via RetroArch
- Cover art: SteamGridDB API (search by clean title → fetch grid art → cache locally)
- Library tracking: SQLite — identifier = raw ROM filename (e.g. "Super Mario World (USA).zip")
- Launch: retroarch.exe -L [core_path] [rom_path] (main process finds ROM file inside install dir)

## What Is Built (Session 1)
- [x] Project renamed from rohankar-launcher to skald-launcher
- [x] package.json: name, appId, productName, version (0.1.0), GitHub repo all updated
- [x] Titlebar: "SKALD"

## Post-Blades Phase Roadmap
- Goal: preserve the strongest ideas from later Claude planning and treat them as the next major phases after Marketplace and Games blade work is stable.

### Phase A: Emulator Manager
- Build a real `EmulatorManager` abstraction so SKALD owns emulator launch, config preparation, save-root isolation, and future update handling.
- Keep RetroArch/libretro as the cleanest first-class path.
- Add structured support later for non-libretro emulators like Xenia, RPCS3, Dolphin, PCSX2, and Cemu through per-user config swapping where needed.

### Phase B: Per-User Save Isolation
- Make per-user save/config scoping a core SKALD rule across emulators.
- For RetroArch:
  - use per-user save/state/config paths at launch time.
- For non-libretro emulators:
  - manage per-user config files and emulator-specific save roots through SKALD before launch.

### Phase C: Emulator Registry And Updates
- Expand the current emulator direction into a generalized registry:
  - emulator id
  - executable path
  - supported systems
  - config format
  - save path strategy
  - update source
- Use that registry as the base for future emulator update management and install validation.

### Phase D: Save Backup And Restore
- Evaluate `SaveState` as a silent backend integration rather than a visible app dependency.
- Use it, or its ideas, for:
  - emulator save path detection
  - backup-before-launch / backup-after-close hooks
  - restore flows from SKALD UI
  - future Guide-based save management
- Keep this behind SKALD’s own UI rather than exposing a separate SaveState interface.

### Phase E: Media Blade
- Keep Kodi as the leading backend candidate for a future Media blade.
- Best rollout:
  - first launch Kodi externally from SKALD
  - later evaluate Kodi JSON-RPC for a truly native Media blade experience

### Phase F: Background Music
- Keep the hidden Electron audio engine concept in backlog for an Xbox-like shell music experience.
- Long-term goal:
  - music continues across launcher navigation and emulator launches
  - Guide/overlay music controls
  - per-user library and playlist handling

### Notes
- Some of the Claude ideas are already partially covered elsewhere in this brief, especially around RetroArch, provider abstraction, and per-user architecture.
- Treat the items in this section as the next major phases after Marketplace and Games are stable enough to stop reshaping daily.
- [x] Reviews tab replaced with Files tab (ROM metadata display)
- [x] System selector dropdown in sidebar (SNES only)
- [x] fetch-rom-list IPC: fetches view_archive.php HTML, parses into ROM array
- [x] ROM filename parser: extracts cleanName, region, tags
- [x] launch-rom IPC: RetroArch -L [core] [rom], handles install dir or direct file path
- [x] get-rom-art IPC: SteamGridDB search → grid art → local cache (artcache/)
- [x] choose-file IPC: file picker for RetroArch exe + core .dll
- [x] Settings modal: RetroArch path, SNES core path, SteamGridDB API key fields
- [x] Full renderer.js rewrite: ROM-centric architecture
- [x] Download → extract → install → launch flow
- [x] Collections, Favorites, Notes, Downloads modal all ported
- [x] Home screen adapted for ROMs
- [x] CSS: system selector, settings section headings, ROM file table, card region badge
- [x] CSP updated for steamgriddb.com + ia802803.us.archive.org

## What Is Next (Session 2)
- [ ] Launch and test the app — confirm ROM list loads from view_archive.php
- [ ] Debug HTML parser if needed (regex may need tweaks against live response)
- [ ] Test settings: save/load RetroArch path + core + SteamGridDB key
- [ ] Test download → extract → launch flow end to end
- [ ] Cover art loading validation
- [ ] Strip unused RohanKar IPC handlers from main.js when confirmed unused
  - fetch-file-list (RohanKar archive.org metadata)
  - add-to-steam (not needed for ROM launcher)
  - find-exes (not needed — ROMs don't have .exe files)
- [ ] Consider: rom list count display / loading state in sidebar
- [ ] Add NES as second system once SNES is confirmed working

## File Structure
```
src/
  main/
    main.js         — Electron main process (all IPC handlers)
    preload.js      — Context bridge (exposes electronAPI to renderer)
  renderer/
    index.html      — App shell (system selector, settings fields, tabs)
    style.css       — All styles (including new ROM-specific styles)
    renderer.js     — UI logic (ROM-centric, full rewrite from RohanKar)
assets/
  icons/
    rk-logo.jpg     — Placeholder logo (replace with SKALD logo later)
config/             — (planned) per-system emulator config
PROJECT_BRIEF.md    — This file
CHANGELOG.md        — Version history
```

## Settings Schema (settings.json)
```json
{
  "downloadPath": "",
  "installPath": "",
  "deleteAfterInstall": false,
  "installedFirst": false,
  "showInstalledBadge": true,
  "retroarchPath": "C:\\RetroArch\\retroarch.exe",
  "cores": {
    "snes": "C:\\RetroArch\\cores\\bsnes_mercury_balanced_libretro.dll"
  },
  "steamGridDbKey": ""
}
```

## ROM Library DB Schema
- identifier = raw ROM filename (e.g. "Super Mario World (USA).zip")
- install_dir = path to folder where ROM was extracted
- No exe_path — ROMs launch via RetroArch, not exe

## Revert Command
```
git checkout HEAD -- src/renderer/index.html src/renderer/renderer.js src/renderer/style.css src/main/main.js src/main/preload.js
```

## Design Direction
- Dark cinematic aesthetic
- Near-black backgrounds (#0f0f13, #17171e, #1e1e28)
- Red/orange accents (#d93025)
- Fonts: Rajdhani (headings) + Segoe UI / Inter (body)
- Glass-surface card styling
- Consistent with RohanKar visual language but adapted for ROM browser UI
