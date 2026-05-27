'use strict';

const crypto = require('crypto');
const http = require('http');

function createDropboxAuthManager({
  shell,
  loadSettings,
  readAccount,
  saveAccount,
}) {
  const PROVIDER_ID = 'savecloud-dropbox';
  const AUTH_BASE = 'https://www.dropbox.com/oauth2/authorize';
  const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
  const ACCOUNT_URL = 'https://api.dropboxapi.com/2/users/get_current_account';
  const SCOPES = ['account_info.read', 'files.metadata.write', 'files.metadata.read', 'files.content.write', 'files.content.read'];

  function getConfig(settings = loadSettings()) {
    const cfg = settings?.dropboxAuth && typeof settings.dropboxAuth === 'object' ? settings.dropboxAuth : {};
    const requestedRedirect = String(cfg.redirectUri || process.env.SKALD_DROPBOX_REDIRECT_URI || '').trim();
    let normalizedRedirect = requestedRedirect || 'http://127.0.0.1:53682/dropbox-callback';
    if (/^http:\/\/127\.0\.0\.1$/i.test(normalizedRedirect) || /^http:\/\/localhost$/i.test(normalizedRedirect)) {
      normalizedRedirect = 'http://127.0.0.1:53682/dropbox-callback';
    }
    return {
      appKey: String(cfg.appKey || process.env.SKALD_DROPBOX_APP_KEY || '').trim(),
      redirectUri: normalizedRedirect,
    };
  }

  function ensureConfigured() {
    const config = getConfig();
    if (!config.appKey) {
      return {
        ok: false,
        error: 'SKALD Dropbox OAuth is not configured yet. Add dropboxAuth.appKey to settings.json or set SKALD_DROPBOX_APP_KEY before using native Dropbox sign-in.',
      };
    }
    return { ok: true, config };
  }

  function parseStoredSecret(secret = '') {
    const raw = String(secret || '').trim();
    if (!raw) return { kind: 'none' };
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.kind === 'dropbox-pkce-v1' && parsed?.refreshToken) {
        return {
          kind: 'dropbox-pkce-v1',
          refreshToken: String(parsed.refreshToken || '').trim(),
          accessToken: String(parsed.accessToken || '').trim(),
          expiresAt: Number(parsed.expiresAt || 0) || 0,
          accountId: String(parsed.accountId || '').trim(),
          email: String(parsed.email || '').trim(),
          connectedAt: Number(parsed.connectedAt || 0) || 0,
        };
      }
    } catch {}
    return { kind: 'raw-token', accessToken: raw };
  }

  function serializeTokenPayload(data = {}) {
    return JSON.stringify({
      kind: 'dropbox-pkce-v1',
      refreshToken: String(data.refreshToken || '').trim(),
      accessToken: String(data.accessToken || '').trim(),
      expiresAt: Number(data.expiresAt || 0) || 0,
      accountId: String(data.accountId || '').trim(),
      email: String(data.email || '').trim(),
      connectedAt: Date.now(),
    });
  }

  function base64Url(buffer) {
    return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function createPkcePair() {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
  }

  function buildAuthUrl({ config, challenge, state, redirectUri }) {
    const url = new URL(AUTH_BASE);
    url.searchParams.set('client_id', config.appKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', SCOPES.join(' '));
    return url.toString();
  }

  function requestForm(url, params = {}) {
    const target = new URL(url);
    const body = new URLSearchParams(params).toString();
    return new Promise((resolve) => {
      const req = require('https').request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        timeout: 45000,
      }, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const statusCode = Number(res.statusCode || 0);
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch {}
          if (statusCode >= 200 && statusCode < 300) {
            return resolve({ ok: true, data: parsed || {}, statusCode });
          }
          resolve({
            ok: false,
            statusCode,
            error: parsed?.error_description || parsed?.error_summary || parsed?.error || `HTTP ${statusCode} from Dropbox OAuth`,
            raw: text,
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      req.on('error', (error) => resolve({ ok: false, error: error?.message || 'Dropbox OAuth request failed.' }));
      req.write(body);
      req.end();
    });
  }

  function requestJson(method, url, accessToken, body = null, extraHeaders = {}) {
    const target = new URL(url);
    const payload = Buffer.from(body == null ? 'null' : JSON.stringify(body), 'utf8');
    return new Promise((resolve) => {
      const req = require('https').request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': String(payload.length),
          ...extraHeaders,
        },
        timeout: 45000,
      }, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const statusCode = Number(res.statusCode || 0);
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch {}
          if (statusCode >= 200 && statusCode < 300) {
            return resolve({ ok: true, data: parsed || {}, statusCode });
          }
          resolve({
            ok: false,
            statusCode,
            error: parsed?.error_summary || parsed?.error || `HTTP ${statusCode} from Dropbox API`,
            raw: text,
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      req.on('error', (error) => resolve({ ok: false, error: error?.message || 'Dropbox API request failed.' }));
      req.write(payload);
      req.end();
    });
  }

  async function getCurrentAccount(accessToken) {
    return requestJson('POST', ACCOUNT_URL, accessToken, null);
  }

  function persistSession({ login = '', refreshToken = '', accessToken = '', expiresIn = 0, account = null } = {}) {
    const expiresAt = expiresIn ? Date.now() + (Number(expiresIn) * 1000) - 60000 : 0;
    return saveAccount(PROVIDER_ID, {
      login: String(login || account?.email || account?.name?.display_name || '').trim(),
      secret: serializeTokenPayload({
        refreshToken,
        accessToken,
        expiresAt,
        accountId: account?.account_id || '',
        email: account?.email || '',
      }),
      saveToProfile: true,
    });
  }

  async function connectInteractive({ login = '' } = {}) {
    const configured = ensureConfigured();
    if (!configured.ok) return configured;
    const state = base64Url(crypto.randomBytes(24));
    const { verifier, challenge } = createPkcePair();
    const urlBase = new URL(configured.config.redirectUri);
    const server = http.createServer();
    const expectedPath = (urlBase.pathname || '/').trim() || '/';
    const authResult = await new Promise((resolve) => {
      server.on('request', (req, res) => {
        try {
          const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
          if (requestUrl.pathname !== expectedPath) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
          }
          const code = String(requestUrl.searchParams.get('code') || '').trim();
          const incomingState = String(requestUrl.searchParams.get('state') || '').trim();
          const error = String(requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error') || '').trim();
          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body style="font-family:Segoe UI,sans-serif;background:#111;color:#f4f4f4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div><h2>Dropbox sign-in failed</h2><p>You can close this window and return to SKALD.</p></div></body></html>');
            resolve({ ok: false, error });
            return;
          }
          if (!code || incomingState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body style="font-family:Segoe UI,sans-serif;background:#111;color:#f4f4f4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div><h2>Dropbox sign-in failed</h2><p>You can close this window and return to SKALD.</p></div></body></html>');
            resolve({ ok: false, error: 'Dropbox did not return a valid authorization code.' });
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body style="font-family:Segoe UI,sans-serif;background:#111;color:#f4f4f4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div><h2>Dropbox connected</h2><p>You can close this window and return to SKALD.</p></div></body></html>');
          resolve({ ok: true, code });
        } catch (error) {
          resolve({ ok: false, error: error?.message || 'Dropbox sign-in failed.' });
        }
      });
      const listenPort = Number(urlBase.port || 80);
      server.listen(listenPort, urlBase.hostname || '127.0.0.1', async () => {
        const authUrl = buildAuthUrl({ config: configured.config, challenge, state, redirectUri: configured.config.redirectUri });
        try {
          await shell.openExternal(authUrl);
        } catch (error) {
          resolve({ ok: false, error: error?.message || 'Could not open Dropbox sign-in.' });
        }
      });
      server.on('error', (error) => resolve({ ok: false, error: error?.message || 'Could not start the Dropbox callback listener.' }));
      setTimeout(() => resolve({ ok: false, error: 'Dropbox sign-in timed out.' }), 180000);
    });
    try { server.close(); } catch {}
    if (!authResult?.ok || !authResult?.code) return authResult;
    const tokenResult = await requestForm(TOKEN_URL, {
      grant_type: 'authorization_code',
      code: authResult.code,
      client_id: configured.config.appKey,
      code_verifier: verifier,
      redirect_uri: configured.config.redirectUri,
    });
    if (!tokenResult.ok) return { ok: false, error: tokenResult.error || 'Could not exchange the Dropbox authorization code.' };

    const accessToken = String(tokenResult.data?.access_token || '').trim();
    const refreshToken = String(tokenResult.data?.refresh_token || '').trim();
    if (!accessToken || !refreshToken) {
      return { ok: false, error: 'Dropbox did not return the expected access and refresh tokens.' };
    }
    const accountResult = await getCurrentAccount(accessToken);
    if (!accountResult.ok) return { ok: false, error: accountResult.error || 'Dropbox connected, but account validation failed.' };
    const saved = persistSession({
      login,
      refreshToken,
      accessToken,
      expiresIn: Number(tokenResult.data?.expires_in || 0) || 0,
      account: accountResult.data,
    });
    if (!saved?.ok) return saved;
    return {
      ok: true,
      login: String(login || accountResult.data?.email || accountResult.data?.name?.display_name || '').trim(),
      account: {
        accountId: String(accountResult.data?.account_id || '').trim(),
        email: String(accountResult.data?.email || '').trim(),
      },
      message: 'Dropbox connected.',
    };
  }

  async function refreshAccessToken(refreshToken, appKey) {
    const result = await requestForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      accessToken: String(result.data?.access_token || '').trim(),
      expiresIn: Number(result.data?.expires_in || 0) || 0,
    };
  }

  async function getAccessToken({ rawToken = '', forceRefresh = false } = {}) {
    const raw = String(rawToken || '').trim();
    if (raw) {
      const parsedRaw = parseStoredSecret(raw);
      if (parsedRaw.kind === 'raw-token' && parsedRaw.accessToken) {
        return { ok: true, accessToken: parsedRaw.accessToken, source: 'manual-token' };
      }
    }
    const configured = ensureConfigured();
    if (!configured.ok) return configured;
    const account = readAccount(PROVIDER_ID) || null;
    const parsed = parseStoredSecret(account?.secret || '');
    if (parsed.kind === 'raw-token' && parsed.accessToken) {
      return { ok: true, accessToken: parsed.accessToken, source: 'manual-token' };
    }
    if (parsed.kind !== 'dropbox-pkce-v1' || !parsed.refreshToken) {
      return { ok: false, error: 'Connect Dropbox first.' };
    }
    if (!forceRefresh && parsed.accessToken && parsed.expiresAt && parsed.expiresAt > Date.now()) {
      return { ok: true, accessToken: parsed.accessToken, source: 'cached-token' };
    }
    const refreshed = await refreshAccessToken(parsed.refreshToken, configured.config.appKey);
    if (!refreshed.ok || !refreshed.accessToken) {
      return { ok: false, error: refreshed.error || 'Could not refresh the Dropbox access token.' };
    }
    const currentAccount = await getCurrentAccount(refreshed.accessToken);
    if (!currentAccount.ok) return { ok: false, error: currentAccount.error || 'Dropbox token refreshed, but account validation failed.' };
    const saved = persistSession({
      login: account?.login || currentAccount.data?.email || '',
      refreshToken: parsed.refreshToken,
      accessToken: refreshed.accessToken,
      expiresIn: refreshed.expiresIn,
      account: currentAccount.data,
    });
    if (!saved?.ok) return saved;
    return { ok: true, accessToken: refreshed.accessToken, source: 'refresh-token' };
  }

  async function validateConnection(rawToken = '') {
    const tokenResult = String(rawToken || '').trim()
      ? await getAccessToken({ rawToken: String(rawToken || '').trim() })
      : await getAccessToken();
    if (!tokenResult?.ok || !tokenResult?.accessToken) {
      return { ok: false, error: tokenResult?.error || 'Connect Dropbox first.' };
    }
    const account = await getCurrentAccount(tokenResult.accessToken);
    if (!account.ok) return { ok: false, error: account.error || 'Could not validate the Dropbox account.' };
    return {
      ok: true,
      provider: PROVIDER_ID,
      accountId: String(account.data?.account_id || '').trim(),
      email: String(account.data?.email || '').trim(),
      displayName: String(account.data?.name?.display_name || '').trim(),
      remoteRootPath: '/Save Vaults',
      message: 'Dropbox is reachable and ready for SKALD save backup.',
    };
  }

  return {
    getConfig,
    parseStoredSecret,
    connectInteractive,
    getAccessToken,
    validateConnection,
  };
}

module.exports = { createDropboxAuthManager };
