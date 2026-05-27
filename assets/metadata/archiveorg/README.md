# Archive.org Marketplace Metadata Packs

These files provide local-first text metadata for the Archive.org Marketplace flow. The Marketplace should read these packs before any live metadata service so browsing stays fast and console-like.

## SNES Workflow

1. Generate coverage reports:

```powershell
npm run report:pack -- archiveorg snes --write
```

2. Build grouped curation candidates:

```powershell
npm run report:pack:candidates -- archiveorg snes --write
```

3. Create a small editable batch:

```powershell
npm run create:pack:batch -- --provider archiveorg --system snes --count 10 --offset 0
```

This also creates a Markdown companion file next to the JSON batch for easier review. Edit the JSON batch, not the Markdown guide.

To target a specific title:

```powershell
npm run create:pack:batch -- --provider archiveorg --system snes --search "Jurassic Park" --count 1
```

4. Fill in the batch metadata fields in the JSON file.

5. Validate the curated batch:

```powershell
npm run validate:pack:batch -- reports\archiveorg-snes-pack.batch-0-9.json --provider archiveorg --system snes
```

6. Merge the curated batch:

```powershell
npm run merge:pack -- reports\archiveorg-snes-pack.batch-0-9.json --provider archiveorg --system snes
```

7. Re-run the coverage report and verify the local pack count increased.

8. Validate the full pack:

```powershell
npm run validate:pack -- archiveorg snes
```

9. Generate a pack quality report when you want to review missing-but-nonblocking fields:

```powershell
npm run report:pack:quality -- archiveorg snes --write
```

10. Create a fix-up batch from a quality bucket:

```powershell
npm run create:pack:quality-batch -- --provider archiveorg --system snes --bucket missingAgeRating --count 10
```

11. Build a ScreenScraper-backed batch when credentials are configured:

```powershell
$env:SCREENSCRAPER_DEVID="..."
$env:SCREENSCRAPER_DEVPASSWORD="..."
$env:SCREENSCRAPER_SOFTNAME="SKALD"
$env:SCREENSCRAPER_SSID="..."
$env:SCREENSCRAPER_SSPASSWORD="..."
npm run fetch:pack:screenscraper -- --provider archiveorg --system snes --count 10 --offset 0
```

Use `--dry-run` to verify selection/output without calling ScreenScraper, or `--cache-only` to rebuild from cached raw responses.

Check the credential environment without fetching:

```powershell
npm run fetch:pack:screenscraper -- --system snes --check-credentials
```

The script also reads `.env` from the project root. Keep that file local and ignored by git.

## Notes

- Metadata packs should contain text metadata only, not image payloads.
- Use exact Archive.org filenames as identifiers whenever possible.
- Keep Marketplace text metadata local-first; SGDB art can still be fetched and cached separately.
- Use `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` for `release_date`.
- Use ESRB shorthand for `age_rating`: `EC`, `E`, `E10`, `E10+`, `T`, `M`, `AO`, or `RP`.
- Store `genres` as an array of non-empty strings.

