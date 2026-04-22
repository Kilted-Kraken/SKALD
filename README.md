# SKALD

**SKALD is a console-style retro gaming platform for the desktop, built around the spirit of the Xbox 360 Blades dashboard.**

It is not trying to be a generic ROM folder browser. SKALD is a living-room shell: a launcher, library, marketplace, achievement viewer, metadata system, and future social/media hub wrapped in a controller-first interface that feels like it belongs on a console.

SKALD is early, opinionated, and moving fast. The goal is simple: make retro gaming on PC feel less like managing files and more like stepping into a real platform.

---

## The Vision

SKALD is built around a few core ideas:

- **Console-first experience:** navigate with a controller, read clear prompts, move through blades, and keep the UI responsive.
- **Xbox 360 Blades identity:** the primary shell is inspired by the original Blades dashboard, with future shell styles planned after the Blades experience is stable.
- **Local-first speed:** metadata and library data should load instantly wherever possible instead of blocking the UI on live scraping.
- **Marketplace plus personal library:** Marketplace is for curated discovery and downloads; Games is for the user's installed and scanned library.
- **Extensible platform direction:** SKALD is designed to grow into a broader shell with achievements, community, media, save/music features, and additional interface styles over time.

---

## Current Highlights

### Blades Shell

SKALD's main interface is an Xbox 360 Blades-inspired dashboard with dedicated blades for:

- **Marketplace**
- **SKALD LIVE**
- **Games**
- **Media**
- **System**

The shell includes controller navigation, blade switching, contextual control legends, toast notifications, nested subpanels, and console-style visual treatments.

### Marketplace

The Marketplace flow is currently focused on Archive.org-backed retro game browsing and downloads.

Current direction:

- Archive.org is the primary Marketplace source.
- Systems open into console-style game lists.
- Super Nintendo is the current end-to-end test system.
- Downloaded Marketplace games are registered into the local Games library.
- Archive.org signed-in download probing is supported for sources that require session access.

### Local Metadata Packs

SKALD is moving away from live per-row text scraping during Marketplace browsing.

The active direction is:

- package text metadata locally per Marketplace system
- load metadata instantly from disk
- use cloud/live providers only for enrichment, misses, or tooling
- cache heavy image assets locally instead of shipping huge image packs

The SNES metadata pack workflow includes reporting, candidate generation, validation, batch merging, and quality reports.

### Achievements

The Games blade includes an Achievements flow backed by RetroAchievements matching.

Current behavior includes:

- system selection from the Achievements panel
- installed game achievement browsing
- full achievement badge grids
- auto-scroll for long achievement lists
- right-column achievement selection with D-pad/left-stick navigation
- modal achievement detail view opened with `A` and closed with `B`
- RetroAchievements match debugging and cache safeguards

### Control Legend

The footer Control Legend is context-aware.

It uses local Xbox-style control icons for:

- `A`, `B`, `X`, `Y`
- Menu, View, Guide
- D-pad variants
- bumpers and triggers
- left/right stick directions and presses

`B = Back` is the constant baseline, while other actions change depending on the current panel.

### System Settings

System settings currently include areas for:

- emulator/runtime configuration
- network/service settings
- Archive.org status/testing
- cloud metadata service override/testing
- third-party account/service hooks
- launcher/version/license information

The production goal is to hide unnecessary backend details from normal users and keep advanced overrides available only where they make sense.

---

## Development Status

SKALD is under active development.

The current priority is proving the Super Nintendo Marketplace flow end to end before expanding to more systems:

1. browse Marketplace system/game lists
2. load local packaged metadata instantly
3. download from Archive.org through SKALD
4. register the game in the local library
5. launch from the Games blade
6. view achievements from the Achievements flow

Once the SNES flow is solid, the same pattern can be expanded to additional systems.

---

## Repository Structure

Key areas:

- `src/main/` - Electron main process, backend services, IPC, downloading, launching, metadata plumbing
- `src/renderer/` - Blades UI and legacy renderer code
- `assets/roms/` - packaged Marketplace catalog snapshots
- `assets/metadata/archiveorg/` - local Marketplace metadata packs and metadata-pack docs
- `assets/icons/Controls/` - Control Legend button/stick/D-pad icons
- `assets/icons/Ratings/` - rating badge assets
- `assets/icons/Systems/` - system logo assets
- `services/metadata-worker/` - Cloudflare metadata worker
- `scripts/` - metadata pack, report, validation, and ScreenScraper tooling
- `reports/` - generated metadata-pack and source-analysis reports

---

## Development Commands

Install dependencies:

```powershell
npm install
```

Run SKALD in development:

```powershell
npm start
```

Build the app:

```powershell
npm run build
```

Validate the current Archive.org metadata pack:

```powershell
npm run validate:pack -- archiveorg snes
```

Report SNES metadata-pack coverage:

```powershell
npm run report:pack -- archiveorg snes --write
```

Generate grouped SNES metadata candidates:

```powershell
npm run report:pack:candidates -- --provider archiveorg --system snes --write
```

---

## Tech Stack

- [Electron](https://www.electronjs.org/)
- [Node.js](https://nodejs.org/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [electron-builder](https://www.electron.build/)
- [Cloudflare Workers](https://workers.cloudflare.com/) for optional metadata service infrastructure
- [Archive.org](https://archive.org/) as the current Marketplace download source
- [RetroAchievements](https://retroachievements.org/) for achievement data
- [SteamGridDB](https://www.steamgriddb.com/) and local caches for artwork enrichment

---

## Notes

SKALD is not affiliated with Microsoft, Xbox, Archive.org, RetroAchievements, SteamGridDB, ScreenScraper, or any console manufacturer.

All games, ROMs, metadata, artwork, and trademarks belong to their respective owners. SKALD is a launcher/platform shell and does not claim ownership of third-party content.

---

## License

License details are still being finalized as SKALD moves away from its original launcher foundation and into its own platform identity.
