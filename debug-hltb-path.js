// Debug: show exactly what path the hltb-list-cache handler would use
const { app } = require('electron');
const path = require('path');
const os = require('os');

// This is how main.js computes the path
// But in dev mode, app.getPath('userData') uses 'Electron' not the app name
// unless the override at the top of main.js ran first

// Check what userData would be WITHOUT the override
const withoutOverride = path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'hltbcache');
const withOverride    = path.join(os.homedir(), 'AppData', 'Roaming', 'skald-launcher', 'hltbcache');
const fs = require('fs');

console.log('--- Path check ---');
console.log('WITH pkg.name override:   ', withOverride,    '| exists:', fs.existsSync(withOverride));
console.log('WITHOUT override (Electron):', withoutOverride, '| exists:', fs.existsSync(withoutOverride));

// Also check what clear-hltb-cache.js uses (os.homedir + hardcoded path)
const clearScriptPath = path.join(os.homedir(), 'AppData', 'Roaming', 'skald-launcher', 'hltbcache');
console.log('\nclear-hltb-cache.js path:', clearScriptPath, '| exists:', fs.existsSync(clearScriptPath));
if (fs.existsSync(clearScriptPath)) {
  const files = fs.readdirSync(clearScriptPath);
  console.log('Files there:', files);
}
