// Test the correct HLTB endpoint discovered from howlongtobeat-ts (updated March 3, 2026)
// URL: /api/finder  (not /api/search which 404s)
// Auth: GET /api/finder/init?t={timestamp}  → { token: "..." }
// Search: POST /api/finder with x-auth-token header

const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer': 'https://howlongtobeat.com/',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function post(path, bodyStr, token) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(bodyStr);
    const req = https.request({
      hostname: 'howlongtobeat.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': buf.length,
        'Referer': 'https://howlongtobeat.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': '*/*',
        'x-auth-token': token,
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

(async () => {
  // Step 1: Get token from /api/finder/init
  console.log('=== Step 1: GET /api/finder/init ===');
  const ts = Date.now();
  const initRes = await get(`https://howlongtobeat.com/api/finder/init?t=${ts}`);
  console.log('Status:', initRes.status);
  console.log('Body:', initRes.body.slice(0, 200));

  let token = null;
  try {
    token = JSON.parse(initRes.body).token;
    console.log('Token:', token);
  } catch(e) {
    console.log('Parse error:', e.message);
    return;
  }

  if (!token) { console.log('No token received'); return; }

  // Step 2: POST /api/finder with token
  console.log('\n=== Step 2: POST /api/finder ===');
  const body = JSON.stringify({
    searchType: 'games',
    searchTerms: ['Super', 'Metroid'],
    searchPage: 1,
    size: 5,
    searchOptions: {
      games: {
        userId: 0, platform: '', sortCategory: 'popular',
        rangeCategory: 'main', rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' }, modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '', sort: 0, randomizer: 0,
    },
    useCache: true,
  });

  const r = await post('/api/finder', body, token);
  console.log('Status:', r.status);
  console.log('Body (first 500):', r.body.slice(0, 500));

  if (r.status === 200) {
    const j = JSON.parse(r.body);
    console.log('\n=== Results ===');
    console.log('Count:', j.data?.length);
    if (j.data?.[0]) {
      const g = j.data[0];
      const toH = s => s ? `${Math.floor(s/3600)}h ${Math.round((s%3600)/60)}m` : null;
      console.log('Best match:', g.game_name);
      console.log('Main Story:', toH(g.comp_main));
      console.log('Main+Extra:', toH(g.comp_plus));
      console.log('Completionist:', toH(g.comp_100));
    }
  }
})().catch(console.error);
