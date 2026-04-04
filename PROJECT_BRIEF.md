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
