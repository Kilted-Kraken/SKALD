# SKALD Launcher — Changelog

## v0.1.0 — Session 1 (2026-03-25)

### Foundation Build

This is the initial session — forked from RohanKar Launcher v1.4.1 and repurposed as a ROM launcher.

**What was done:**

- Renamed project from `rohankar-launcher` to `skald-launcher` in package.json
- Titlebar updated to "SKALD"
- About modal rebranded to SKALD with correct GitHub repo link
- Reviews tab replaced with Files tab (shows ROM metadata)
- Added system selector dropdown to sidebar (SNES only for now)
- Added new Settings fields: RetroArch path, SNES core path (.dll), SteamGridDB API key
- Added `fetch-rom-list` IPC — fetches + parses view_archive.php HTML table for SNES ROM list (~4,123 ROMs)
- Added `parse-rom-filename` logic (main process) — extracts clean title, region, tags from ROM filenames
- Added `launch-rom` IPC — launches ROM via `retroarch.exe -L [core] [rom]`; handles install dir or direct file path
- Added `get-rom-art` IPC — queries SteamGridDB API for cover art, caches locally to artcache/
- Added `choose-file` IPC — file picker dialog for RetroArch exe + core paths
- Full renderer.js rewrite for ROM launcher architecture:
  - `allRoms` replaces `allGames`
  - `getRomId()` uses raw filename as DB key
  - ROM list fetched via `electronAPI.fetchRomList()`
  - Cover art loaded via `electronAPI.getRomArt()`
  - Download → extract → install flow using existing download/extract IPC
  - Launch via `electronAPI.launchRom()`
  - Collections, Favorites, Notes, Downloads modal — all ported over
  - Home screen adapted for ROMs (no archive.org dates, region shown instead)
- CSP updated to allow steamgriddb.com and ia802803.us.archive.org

**What's left for Session 2:**
- Test full flow: launch app → load SNES ROM list → download → extract → launch via RetroArch
- Debug HTML parser against live view_archive.php response (may need regex adjustments)
- Verify settings save/load for RetroArch + core paths
- Cover art loading (SteamGridDB API key flow)
- Style pass: ROM list cards look good with region badge
- Strip unused RohanKar IPC handlers (fetch-file-list, add-to-steam, find-exes, etc.) from main.js when confirmed unused
