// Test: fetch HLTB game page and extract __NEXT_DATA__ metadata
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  // Super Metroid game page
  const r = await get('https://howlongtobeat.com/game/9390');
  console.log('Status:', r.status, '| Length:', r.body.length);

  // Extract __NEXT_DATA__
  const m = r.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) { console.log('No __NEXT_DATA__ found'); return; }

  const nd   = JSON.parse(m[1]);
  const game = nd?.props?.pageProps?.game?.data?.game?.[0];

  if (!game) { console.log('No game data. Keys:', Object.keys(nd?.props?.pageProps || {})); return; }

  console.log('\n=== Game metadata available in __NEXT_DATA__ ===');
  console.log('Name:      ', game.game_name);
  console.log('Developer: ', game.profile_dev);
  console.log('Publisher: ', game.profile_pub);
  console.log('Platform:  ', game.profile_platform);
  console.log('Genre:     ', game.profile_genre);
  console.log('Released:  ', game.release_world);
  console.log('Summary:   ', game.profile_summary?.slice(0, 100));
  console.log('ESRB:      ', game.rating_esrb);
  console.log('PEGI:      ', game.rating_pegi);
  console.log('Score:     ', game.review_score, '(', game.count_review, 'reviews)');
  console.log('Playing:   ', game.count_playing);
  console.log('Backlog:   ', game.count_backlog);
  console.log('Completed: ', game.count_comp);
  console.log('Image:     ', game.game_image);
})().catch(console.error);
