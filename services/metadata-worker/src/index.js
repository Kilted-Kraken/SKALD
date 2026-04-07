let igdbTokenCache = {
  accessToken: null,
  expiresAt: 0,
};
const CACHE_VERSION = 'v4';
let tgdbLookupCache = {
  genres: null,
  developers: null,
  publishers: null,
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (url.pathname === '/health') {
        return json({
          ok: true,
          service: 'skald-metadata-worker',
          igdbConfigured: !!(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET),
          theGamesDbConfigured: !!env.THEGAMESDB_API_KEY,
          steamGridConfigured: !!env.STEAMGRIDDB_API_KEY,
          hasApiKeyGate: !!env.SKALD_API_KEY,
          primaryMetadataSource: env.THEGAMESDB_API_KEY ? 'thegamesdb' : ((env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) ? 'igdb' : null),
        });
      }

      if (env.SKALD_API_KEY) {
        const auth = request.headers.get('authorization') || '';
        const token = auth.replace(/^Bearer\s+/i, '').trim();
        if (!token || token !== env.SKALD_API_KEY) {
          return json({ error: 'Unauthorized' }, 401);
        }
      }

      if (url.pathname === '/metadata/game' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body?.title) return json({ error: 'Missing title' }, 400);

        const title = String(body.title || '').trim();
        const system = String(body.system || '').trim();
        const provider = String(body.provider || '').trim() || null;
        const catalogIdentifier = String(body.catalog_identifier || '').trim() || null;
        const cacheKey = await makeCacheKey('metadata-game', { title, system, provider, catalogIdentifier });
        const cached = await readCache(cacheKey);
        if (cached) return cached;

        const metadata = await enrichGame({ title, system }, env);
        const hasMetadata = hasUsefulMetadata(metadata);
        const response = json({
          title,
          system,
          provider,
          catalog_identifier: catalogIdentifier,
          metadata_status: hasMetadata ? 'ready' : 'missing',
          metadata_source: 'cloudflare-worker',
          metadata: metadata?.metadata || {},
          art: metadata?.art || {},
          retroachievements: metadata?.retroachievements || {},
        });
        ctx.waitUntil(writeCache(cacheKey, response, hasMetadata ? 86400 : 900));
        return response;
      }

      if (url.pathname === '/metadata/search' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body?.title) return json({ error: 'Missing title' }, 400);
        const cacheKey = await makeCacheKey('metadata-search', {
          title: String(body.title || ''),
          system: String(body.system || ''),
        });
        const cached = await readCache(cacheKey);
        if (cached) return cached;
        const result = await searchIgdb(String(body.title || ''), String(body.system || ''), env);
        const response = json({ ok: true, result });
        ctx.waitUntil(writeCache(cacheKey, response, result ? 43200 : 900));
        return response;
      }

      if (url.pathname === '/art/search' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body?.title) return json({ error: 'Missing title' }, 400);
        const cacheKey = await makeCacheKey('art-search', {
          title: String(body.title || ''),
          system: String(body.system || ''),
        });
        const cached = await readCache(cacheKey);
        if (cached) return cached;
        const art = await fetchSgdbArt(String(body.title || ''), String(body.system || ''), env);
        const response = json({ ok: true, art });
        ctx.waitUntil(writeCache(cacheKey, response, 43200));
        return response;
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: error.message || 'Worker error' }, 500);
    }
  },
};

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  };
}

function hasUsefulMetadata(result) {
  const metadata = result?.metadata || {};
  if (!metadata || typeof metadata !== 'object') return false;
  return !!(
    metadata.igdb_id ||
    metadata.description ||
    metadata.publisher ||
    metadata.developer ||
    (Array.isArray(metadata.genres) && metadata.genres.length) ||
    metadata.age_rating ||
    metadata.cover_url ||
    metadata.background_url ||
    (Array.isArray(result?.art?.screenshot_urls) && result.art.screenshot_urls.length)
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

async function makeCacheKey(prefix, payload) {
  const normalized = JSON.stringify(sortObject(payload));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${CACHE_VERSION}:${prefix}:${normalized}`));
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://cache.skald.local/${prefix}/${hash}`, { method: 'GET' });
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = sortObject(value[key]);
    return acc;
  }, {});
}

async function readCache(cacheKey) {
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  return hit || null;
}

async function writeCache(cacheKey, response, maxAgeSeconds) {
  if (!response || response.status !== 200) return;
  const cache = caches.default;
  const clone = response.clone();
  clone.headers.set('Cache-Control', `public, max-age=${maxAgeSeconds}`);
  await cache.put(cacheKey, clone);
}

const IGDB_PLATFORM_MAP = {
  snes: 19,
  psx: 7,
  nes: 18,
  gba: 24,
  gbc: 22,
  gb: 33,
  genesis: 29,
  n64: 4,
  nds: 20,
  psp: 38,
  pcsx2: 8,
  dolphin: 21,
};
const TGDB_PLATFORM_MAP = {
  snes: 6,
  psx: 10,
  nes: 7,
  genesis: 18,
  n64: 3,
  gb: 4,
  gbc: 41,
  gba: 5,
  nds: 8,
  psp: 9,
};
const PLATFORM_NAME_ALIASES = {
  snes: ['super nintendo entertainment system', 'super nintendo', 'snes'],
  psx: ['playstation', 'sony playstation', 'ps1'],
  nes: ['nintendo entertainment system', 'nes'],
  gba: ['game boy advance', 'gba'],
  gbc: ['game boy color', 'gbc'],
  gb: ['game boy', 'gb'],
  genesis: ['sega genesis', 'genesis', 'mega drive', 'sega mega drive'],
  n64: ['nintendo 64', 'n64'],
  nds: ['nintendo ds', 'nds', 'ds'],
  psp: ['playstation portable', 'psp'],
};

async function enrichGame(input, env) {
  const [primaryMetadata, sgdb] = await Promise.all([
    fetchPrimaryMetadata(input.title, input.system, env),
    fetchSgdbArt(input.title, input.system, env),
  ]);
  const ageRating = primaryMetadata?.metadata?.age_rating
    ? {
        code: primaryMetadata.metadata.age_rating,
        label: primaryMetadata.metadata.age_rating_label || primaryMetadata.metadata.age_rating,
        board: primaryMetadata.metadata.age_rating_board || null,
      }
    : null;

  return {
    metadata: primaryMetadata?.metadata ? {
      ...primaryMetadata.metadata,
      age_rating: ageRating?.code || primaryMetadata.metadata.age_rating || null,
      age_rating_label: ageRating?.label || primaryMetadata.metadata.age_rating_label || null,
      age_rating_board: ageRating?.board || primaryMetadata.metadata.age_rating_board || null,
    } : {},
    art: {
      cover_url: primaryMetadata?.art?.cover_url || null,
      background_url: primaryMetadata?.art?.background_url || null,
      screenshot_urls: Array.isArray(primaryMetadata?.art?.screenshot_urls) ? primaryMetadata.art.screenshot_urls : [],
      icon_url: sgdb?.icon_url || null,
      logo_url: sgdb?.logo_url || primaryMetadata?.art?.logo_url || null,
    },
    retroachievements: {},
  };
}

async function fetchPrimaryMetadata(title, system, env) {
  if (env.THEGAMESDB_API_KEY) {
    const tgdb = await searchTheGamesDb(title, system, env);
    if (tgdb?.metadata) return tgdb;
  }
  if (env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) {
    const igdb = await searchIgdb(title, system, env);
    const igdbWithDetails = igdb?.id ? (await fetchIgdbGameDetails(igdb.id, env)) || igdb : igdb;
    const ageRating = pickPreferredAgeRating(igdbWithDetails);
    if (igdbWithDetails) {
      return {
        metadata: {
          title: igdbWithDetails.name || title,
          description: igdbWithDetails.summary || null,
          genres: Array.isArray(igdbWithDetails.genres) ? igdbWithDetails.genres.map(g => g.name).filter(Boolean) : [],
          developer: firstCompanyName(igdbWithDetails, 'developer'),
          publisher: firstCompanyName(igdbWithDetails, 'publisher'),
          release_date: igdbWithDetails.first_release_date ? new Date(igdbWithDetails.first_release_date * 1000).toISOString() : null,
          players: null,
          rating: igdbWithDetails.aggregated_rating ? `${Math.round(igdbWithDetails.aggregated_rating)}` : null,
          age_rating: ageRating?.code || null,
          age_rating_label: ageRating?.label || null,
          age_rating_board: ageRating?.board || null,
          platform_name: Array.isArray(igdbWithDetails.platforms) ? igdbWithDetails.platforms.map(p => p.name).filter(Boolean).join(', ') : null,
          igdb_id: igdbWithDetails.id ? String(igdbWithDetails.id) : null,
          thegamesdb_id: null,
          match_score: typeof igdb?._score === 'number' ? igdb._score : null,
          matched_title: igdb?.name || null,
        },
        art: {
          cover_url: igdbWithDetails?.cover?.url ? normalizeIgdbImageUrl(igdbWithDetails.cover.url, 'cover_big') : null,
          background_url: Array.isArray(igdbWithDetails?.screenshots) && igdbWithDetails.screenshots[0]?.url
            ? normalizeIgdbImageUrl(igdbWithDetails.screenshots[0].url, 'screenshot_big')
            : null,
          screenshot_urls: Array.isArray(igdbWithDetails?.screenshots)
            ? igdbWithDetails.screenshots.slice(0, 4).map(s => normalizeIgdbImageUrl(s.url, 'screenshot_big')).filter(Boolean)
            : [],
          logo_url: null,
        },
      };
    }
  }
  return null;
}

async function getIgdbAccessToken(env) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  if (igdbTokenCache.accessToken && Date.now() < igdbTokenCache.expiresAt) {
    return igdbTokenCache.accessToken;
  }
  const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
  tokenUrl.searchParams.set('client_id', env.IGDB_CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', env.IGDB_CLIENT_SECRET);
  tokenUrl.searchParams.set('grant_type', 'client_credentials');
  const response = await fetch(tokenUrl.toString(), { method: 'POST' });
  if (!response.ok) return null;
  const json = await response.json();
  igdbTokenCache = {
    accessToken: json?.access_token || null,
    expiresAt: Date.now() + Math.max((Number(json?.expires_in || 0) - 120), 60) * 1000,
  };
  return igdbTokenCache.accessToken;
}

async function searchIgdb(title, system, env) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  const token = await getIgdbAccessToken(env);
  if (!token) return null;
  const platformId = IGDB_PLATFORM_MAP[String(system || '').toLowerCase()] || null;
  const searchTitles = buildIgdbSearchCandidates(title);
  let best = null;
  for (const searchTitle of searchTitles) {
    const strictResults = await runIgdbSearch(searchTitle, token, env, platformId);
    const strictBest = pickBestIgdbMatch(title, strictResults, platformId);
    if (isGoodIgdbMatch(strictBest)) return strictBest;
    if (!best || (strictBest?._score || 0) > (best?._score || 0)) best = strictBest || best;

    if (platformId) {
      const broadResults = await runIgdbSearch(searchTitle, token, env, null);
      const broadBest = pickBestIgdbMatch(title, broadResults, platformId);
      if (isGoodIgdbMatch(broadBest)) return broadBest;
      if (!best || (broadBest?._score || 0) > (best?._score || 0)) best = broadBest || best;
    }
  }
  for (const slug of buildIgdbSlugCandidates(title)) {
    const slugStrict = await runIgdbSlugSearch(slug, token, env, platformId);
    const slugStrictBest = pickBestIgdbMatch(title, slugStrict, platformId);
    if (isGoodIgdbMatch(slugStrictBest)) return slugStrictBest;
    if (!best || (slugStrictBest?._score || 0) > (best?._score || 0)) best = slugStrictBest || best;

    if (platformId) {
      const slugBroad = await runIgdbSlugSearch(slug, token, env, null);
      const slugBroadBest = pickBestIgdbMatch(title, slugBroad, platformId);
      if (isGoodIgdbMatch(slugBroadBest)) return slugBroadBest;
      if (!best || (slugBroadBest?._score || 0) > (best?._score || 0)) best = slugBroadBest || best;
    }
  }
  return best;
}

async function runIgdbSearch(title, token, env, platformId = null) {
  const body = [
    'fields id,name,slug,summary,first_release_date,aggregated_rating,cover.url,screenshots.url,platforms.name,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher;',
    `search "${escapeIgdbSearch(title)}";`,
    'limit 20;',
  ].join('\n');

  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });
  if (!response.ok) return [];
  const json = await response.json().catch(() => []);
  const results = Array.isArray(json) ? json : [];
  if (!platformId) return results;
  const platformMatches = results.filter(item => platformMatchesSystem(item, platformId));
  return platformMatches.length ? platformMatches : results;
}
async function runIgdbSlugSearch(slug, token, env, platformId = null) {
  const body = [
    'fields name,slug,summary,first_release_date,aggregated_rating,cover.url,screenshots.url,platforms.name,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher;',
    platformId
      ? `where slug = "${escapeIgdbSearch(slug)}" & platforms = ${platformId};`
      : `where slug = "${escapeIgdbSearch(slug)}";`,
    'limit 6;',
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });
  if (!response.ok) return [];
  const json = await response.json().catch(() => []);
  return Array.isArray(json) ? json : [];
}
async function fetchIgdbGamesByIds(ids, token, env, platformId = null) {
  const body = [
    'fields name,slug,summary,first_release_date,aggregated_rating,cover.url,screenshots.url,platforms.name,platforms,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,genres.name,age_ratings.category,age_ratings.organization,age_ratings.rating,age_ratings.rating_category,age_ratings.rating_cover_url;',
    platformId
      ? `where id = (${ids.join(',')}) & platforms = ${platformId};`
      : `where id = (${ids.join(',')});`,
    `limit ${Math.min(ids.length, 10)};`,
  ].join('\n');
  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });
  if (!response.ok) return [];
  const json = await response.json().catch(() => []);
  return Array.isArray(json) ? json : [];
}
async function fetchIgdbGameDetails(id, env) {
  if (!id || !env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  const token = await getIgdbAccessToken(env);
  if (!token) return null;
  const body = [
    'fields name,slug,summary,first_release_date,aggregated_rating,cover.url,screenshots.url,platforms.name,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,age_ratings.category,age_ratings.organization,age_ratings.rating,age_ratings.rating_category,age_ratings.rating_cover_url;',
    `where id = ${Number(id)};`,
    'limit 1;',
  ].join('\n');
  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });
  if (!response.ok) return null;
  const json = await response.json().catch(() => []);
  return Array.isArray(json) && json[0] ? json[0] : null;
}

async function fetchSgdbArt(title, system, env) {
  if (!env.STEAMGRIDDB_API_KEY) return null;
  const searchResponse = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`, {
    headers: {
      'Authorization': `Bearer ${env.STEAMGRIDDB_API_KEY}`,
      'User-Agent': 'SKALD-Metadata-Worker/0.1',
    },
  });
  if (!searchResponse.ok) return null;
  const searchJson = await searchResponse.json();
  const game = searchJson?.data?.[0];
  if (!game?.id) return null;

  const [iconJson, logoJson] = await Promise.all([
    fetch(`https://www.steamgriddb.com/api/v2/icons/game/${game.id}?limit=1`, {
      headers: { 'Authorization': `Bearer ${env.STEAMGRIDDB_API_KEY}`, 'User-Agent': 'SKALD-Metadata-Worker/0.1' },
    }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`https://www.steamgriddb.com/api/v2/logos/game/${game.id}?limit=1`, {
      headers: { 'Authorization': `Bearer ${env.STEAMGRIDDB_API_KEY}`, 'User-Agent': 'SKALD-Metadata-Worker/0.1' },
    }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  return {
    system,
    icon_url: iconJson?.data?.[0]?.url || null,
    logo_url: logoJson?.data?.[0]?.url || null,
  };
}

async function searchTheGamesDb(title, system, env) {
  if (!env.THEGAMESDB_API_KEY) return null;
  const platformId = TGDB_PLATFORM_MAP[String(system || '').toLowerCase()] || null;
  const searchTitles = buildIgdbSearchCandidates(title);
  let best = null;
  for (const searchTitle of searchTitles) {
    const results = await runTgdbSearch(searchTitle, platformId, env);
    const hit = pickBestTgdbMatch(title, results, platformId);
    if (isGoodTgdbMatch(hit)) {
      const enriched = await hydrateTgdbGame(hit, env);
      if (enriched?.metadata) return enriched;
    }
    if (!best || (hit?._score || 0) > (best?._score || 0)) best = hit || best;
  }
  if (best?.id) return hydrateTgdbGame(best, env);
  return null;
}

async function runTgdbSearch(title, platformId, env) {
  const params = new URLSearchParams({
    apikey: env.THEGAMESDB_API_KEY,
    name: title,
    fields: 'players,publishers,genres,overview,last_updated,rating,platform',
    include: 'boxart',
    page: '1',
  });
  if (platformId) params.set('filter[platform]', String(platformId));
  const response = await fetch(`https://api.thegamesdb.net/v1/Games/ByGameName?${params.toString()}`);
  if (!response.ok) return [];
  const json = await response.json().catch(() => null);
  const games = Array.isArray(json?.data?.games) ? json.data.games : [];
  return games;
}

async function hydrateTgdbGame(game, env) {
  const detail = await fetchTgdbGameDetails(game?.id, env);
  const source = detail || game;
  if (!source?.id) return null;
  const [genresMap, developersMap, publishersMap, images] = await Promise.all([
    getTgdbLookup('genres', env),
    getTgdbLookup('developers', env),
    getTgdbLookup('publishers', env),
    fetchTgdbImages(source.id, env),
  ]);
  const age = parseTgdbAgeRating(source.rating);
  const screenshots = collectTgdbImageUrls(images, ['screenshot', 'fanart']).slice(0, 4);
  const cover = pickTgdbBoxart(images);
  const logo = collectTgdbImageUrls(images, ['clearlogo', 'logo']).find(Boolean) || null;
  return {
    metadata: {
      title: source.game_title || source.gameTitle || source.name || null,
      description: source.overview || null,
      genres: resolveTgdbIds(source.genres, genresMap),
      developer: resolveTgdbIds(source.developers, developersMap)[0] || null,
      publisher: resolveTgdbIds(source.publishers, publishersMap)[0] || null,
      release_date: source.release_date || null,
      players: source.players ? String(source.players) : null,
      rating: null,
      age_rating: age?.code || null,
      age_rating_label: age?.label || null,
      age_rating_board: age ? 'ESRB' : null,
      platform_name: null,
      igdb_id: null,
      thegamesdb_id: String(source.id),
      match_score: typeof game?._score === 'number' ? game._score : null,
      matched_title: game?.game_title || game?.name || null,
    },
    art: {
      cover_url: cover,
      background_url: screenshots[0] || null,
      screenshot_urls: screenshots,
      logo_url: logo,
    },
  };
}

async function fetchTgdbGameDetails(id, env) {
  if (!id || !env.THEGAMESDB_API_KEY) return null;
  const params = new URLSearchParams({
    apikey: env.THEGAMESDB_API_KEY,
    id: String(id),
    fields: 'players,publishers,genres,overview,last_updated,rating,platform',
    include: 'boxart',
  });
  const response = await fetch(`https://api.thegamesdb.net/v1/Games/ByGameID?${params.toString()}`);
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  const games = Array.isArray(json?.data?.games) ? json.data.games : [];
  return games[0] || null;
}

async function fetchTgdbImages(id, env) {
  if (!id || !env.THEGAMESDB_API_KEY) return null;
  const params = new URLSearchParams({
    apikey: env.THEGAMESDB_API_KEY,
    games_id: String(id),
  });
  const response = await fetch(`https://api.thegamesdb.net/v1/Games/Images?${params.toString()}`);
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function getTgdbLookup(kind, env) {
  if (tgdbLookupCache[kind]) return tgdbLookupCache[kind];
  const endpointMap = {
    genres: 'Genres',
    developers: 'Developers',
    publishers: 'Publishers',
  };
  const endpoint = endpointMap[kind];
  if (!endpoint || !env.THEGAMESDB_API_KEY) return {};
  const params = new URLSearchParams({ apikey: env.THEGAMESDB_API_KEY });
  const response = await fetch(`https://api.thegamesdb.net/v1/${endpoint}?${params.toString()}`);
  if (!response.ok) return {};
  const json = await response.json().catch(() => null);
  const list = Array.isArray(json?.data?.[kind]) ? json.data[kind] : [];
  const mapped = list.reduce((acc, item) => {
    const id = item?.id != null ? String(item.id) : null;
    const name = item?.name ? String(item.name) : null;
    if (id && name) acc[id] = name;
    return acc;
  }, {});
  tgdbLookupCache[kind] = mapped;
  return mapped;
}

function resolveTgdbIds(value, map) {
  const items = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return items.map(item => {
    if (item == null) return null;
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) return null;
      return map?.[trimmed] || trimmed;
    }
    if (typeof item === 'number') {
      return map?.[String(item)] || null;
    }
    if (typeof item === 'object') {
      const directName = item.name || item.genre || item.publisher || item.developer || null;
      if (directName) return String(directName);
      const id = item.id ?? item.genre_id ?? item.publisher_id ?? item.developer_id ?? null;
      if (id != null) return map?.[String(id)] || null;
    }
    return null;
  }).filter(Boolean);
}

function collectTgdbImageUrls(images, keys) {
  const base = images?.data?.base_url?.original || images?.data?.base_url?.thumb || '';
  const bucket = images?.data?.images || images?.data || {};
  const out = [];
  for (const key of keys) {
    const entries = bucket?.[key];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const file = entry?.filename || entry?.file_name || entry?.url || entry?.thumb;
        if (!file) continue;
        out.push(file.startsWith('http') ? file : `${base}${file}`);
      }
    }
  }
  return [...new Set(out.filter(Boolean))];
}

function pickTgdbBoxart(images) {
  const urls = collectTgdbImageUrls(images, ['boxart']);
  return urls[0] || null;
}

function pickBestTgdbMatch(title, candidates, platformId = null) {
  return [...(Array.isArray(candidates) ? candidates : [])]
    .map(item => {
      const titleValue = item?.game_title || item?.name || '';
      const platformBoost = platformId && Number(item?.platform) === Number(platformId) ? 0.08 : 0;
      return { ...item, _score: Math.min(1, scoreTitleMatch(title, titleValue) + platformBoost) };
    })
    .sort((a, b) => b._score - a._score)[0] || null;
}

function isGoodTgdbMatch(match) {
  return !!match && Number(match._score || 0) >= 0.72;
}

function parseTgdbAgeRating(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('everyone 10')) return { code: 'E10', label: 'Everyone 10+' };
  if (text === 'e' || text.includes('everyone')) return { code: 'E', label: 'Everyone' };
  if (text === 't' || text.includes('teen')) return { code: 'T', label: 'Teen' };
  if (text === 'm' || text.includes('mature')) return { code: 'M', label: 'Mature 17+' };
  if (text.includes('adults only') || text === 'ao') return { code: 'AO', label: 'Adults Only 18+' };
  if (text.includes('rating pending') || text === 'rp') return { code: 'RP', label: 'Rating Pending' };
  if (text.includes('early childhood') || text === 'ec') return { code: 'EC', label: 'Early Childhood' };
  return null;
}

function normalizeIgdbImageUrl(url, size) {
  if (!url) return null;
  const full = url.startsWith('//') ? `https:${url}` : url;
  return full.replace('/t_thumb/', `/t_${size}/`);
}

function firstCompanyName(igdb, type) {
  const companies = Array.isArray(igdb?.involved_companies) ? igdb.involved_companies : [];
  const hit = companies.find(c => !!c?.[type]);
  return hit?.company?.name || null;
}

function escapeIgdbSearch(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}
function buildIgdbSearchCandidates(title) {
  const raw = String(title || '').trim();
  const set = new Set();
  const push = value => {
    const clean = String(value || '').trim().replace(/\s+/g, ' ');
    if (clean) set.add(clean);
  };
  push(raw);
  push(raw.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' '));
  push(raw.replace(/[:\-–]+/g, ' '));
  push(raw.replace(/\b(the|a|an)\b/gi, ' '));
  push(raw.replace(/[^A-Za-z0-9\s]+/g, ' '));
  return [...set].slice(0, 5);
}
function buildIgdbSlugCandidates(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!base) return [];
  const set = new Set([base]);
  for (let i = 1; i <= 3; i += 1) {
    set.add(`${base}--${i}`);
  }
  return [...set];
}

function scoreTitleMatch(target, candidate) {
  const a = normalizeMatchText(target);
  const b = normalizeMatchText(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  let prefix = 0;
  const len = Math.min(a.length, b.length);
  while (prefix < len && a[prefix] === b[prefix]) prefix += 1;
  return prefix / Math.max(a.length, b.length);
}

function pickBestIgdbMatch(title, candidates, platformId = null) {
  return [...candidates]
    .map(item => {
      const platformBoost = platformId && platformMatchesSystem(item, platformId) ? 0.08 : 0;
      return { ...item, _score: Math.min(1, scoreTitleMatch(title, item?.name || '') + platformBoost) };
    })
    .sort((a, b) => b._score - a._score || Number(b?.aggregated_rating || 0) - Number(a?.aggregated_rating || 0))[0] || null;
}
function platformMatchesSystem(item, platformId) {
  const systemKey = Object.entries(IGDB_PLATFORM_MAP).find(([, id]) => Number(id) === Number(platformId))?.[0];
  const aliases = PLATFORM_NAME_ALIASES[systemKey] || [];
  const names = Array.isArray(item?.platforms)
    ? item.platforms.map(p => String(p?.name || '').toLowerCase()).filter(Boolean)
    : [];
  return names.some(name => aliases.some(alias => name.includes(alias)));
}
function isGoodIgdbMatch(match) {
  return !!match && Number(match._score || 0) >= 0.78;
}
function pickPreferredAgeRating(igdb) {
  const ratings = Array.isArray(igdb?.age_ratings) ? igdb.age_ratings : [];
  const esrb = ratings.find(entry => {
    const org = Number(entry?.organization ?? entry?.category);
    const code = resolveEsrbCode(entry);
    return org === 1 && !!code;
  });
  if (esrb) {
    const mapped = resolveEsrbCode(esrb);
    if (!mapped) return null;
    return { board: 'ESRB', ...mapped };
  }
  return null;
}
function resolveEsrbCode(entry) {
  const fromRating = ESRB_RATING_MAP[Number(entry?.rating)];
  if (fromRating) return fromRating;
  const fromCategory = ESRB_RATING_CATEGORY_MAP[Number(entry?.rating_category)];
  if (fromCategory) return fromCategory;
  const cover = String(entry?.rating_cover_url || '').toLowerCase();
  if (cover.includes('esrb_e10')) return ESRB_RATING_MAP[9];
  if (cover.includes('esrb_rp')) return ESRB_RATING_MAP[6];
  if (cover.includes('esrb_ao')) return ESRB_RATING_MAP[12];
  if (cover.includes('esrb_m')) return ESRB_RATING_MAP[11];
  if (cover.includes('esrb_t')) return ESRB_RATING_MAP[10];
  if (cover.includes('esrb_e')) return ESRB_RATING_MAP[8];
  return null;
}
const ESRB_RATING_MAP = {
  6: { code: 'RP', label: 'Rating Pending' },
  7: { code: 'E', label: 'Early Childhood' },
  8: { code: 'E', label: 'Everyone' },
  9: { code: 'E10+', label: 'Everyone 10+' },
  10: { code: 'T', label: 'Teen' },
  11: { code: 'M', label: 'Mature 17+' },
  12: { code: 'AO', label: 'Adults Only 18+' },
};
const ESRB_RATING_CATEGORY_MAP = {
  6: ESRB_RATING_MAP[6],
  7: ESRB_RATING_MAP[7],
  8: ESRB_RATING_MAP[8],
  9: ESRB_RATING_MAP[9],
  10: ESRB_RATING_MAP[10],
  11: ESRB_RATING_MAP[11],
  12: ESRB_RATING_MAP[12],
};
