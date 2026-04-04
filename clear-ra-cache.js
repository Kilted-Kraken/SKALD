// Clear RA extended cache (not the game list cache — that's fine to keep)
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const cacheDir = path.join(os.homedir(), 'AppData', 'Roaming', 'skald-launcher', 'racache');
if (fs.existsSync(cacheDir)) {
  let deleted = 0;
  for (const f of fs.readdirSync(cacheDir)) {
    if (f.startsWith('ext_')) {        // only delete extended-data caches, keep gamelist
      fs.unlinkSync(path.join(cacheDir, f));
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} RA extended cache files from ${cacheDir}`);
} else {
  console.log('RA cache dir not found:', cacheDir);
}
