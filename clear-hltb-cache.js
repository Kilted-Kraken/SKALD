// Delete all hltb cache files so stale 404 results are re-fetched with the new auth token
const fs = require('fs');
const path = require('path');
const os = require('os');

const cacheDir = path.join(os.homedir(), 'AppData', 'Roaming', 'skald-launcher', 'hltbcache');
if (fs.existsSync(cacheDir)) {
  const files = fs.readdirSync(cacheDir);
  let deleted = 0;
  for (const f of files) {
    fs.unlinkSync(path.join(cacheDir, f));
    deleted++;
  }
  console.log(`Deleted ${deleted} cached HLTB files from ${cacheDir}`);
} else {
  console.log('HLTB cache dir not found:', cacheDir);
}
