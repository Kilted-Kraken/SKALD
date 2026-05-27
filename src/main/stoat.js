'use strict';
/**
 * stoat.js — Stoat (formerly Revolt) chat integration for SKALD Launcher
 * 
 * Provides: login/logout, friends list, server channels, messaging, presence.
 * Uses the stoat.js SDK (https://github.com/stoatchat/javascript-client-sdk).
 * 
 * The Stoat client runs in the main process. State is forwarded to renderers via IPC.
 */

const { Client } = require('stoat.js');

let client = null;
let isReady = false;
let sessionData = null; // { token, _id, user_id } for session reuse

// Callback to forward events to renderer(s)
let _sendToRenderer = null;

function setSendToRenderer(fn) { _sendToRenderer = fn; }

function send(channel, data) {
  if (_sendToRenderer) _sendToRenderer(channel, data);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeUser(u) {
  if (!u) return null;
  let avatar = null;
  try {
    if (typeof u.generateAvatarURL === 'function') {
      avatar = u.generateAvatarURL({ max_side: 128 });
    } else if (u.avatar?.url) {
      avatar = u.avatar.url;
    } else if (typeof u.avatar === 'string') {
      avatar = u.avatar;
    }
  } catch {}
  return {
    id:       u.id,
    username: u.username,
    avatar,
    status:   u.status ?? null,
    online:   u.online ?? false,
    badges:   u.badges ?? 0,
  };
}

function safeAssetUrl(target, methodName, args) {
  if (!target || typeof target !== 'object') return null;
  const method = target[methodName];
  if (typeof method !== 'function') return null;
  try {
    return method.call(target, args);
  } catch {
    return null;
  }
}

function normalizeIdList(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value.values()];
  if (value && typeof value.values === 'function') {
    try { return [...value.values()]; } catch {}
  }
  if (value && typeof value === 'object') {
    return Object.values(value);
  }
  return [];
}

function serializeChannel(ch) {
  if (!ch) return null;
  return {
    id:          ch.id,
    type:        ch.type,
    name:        ch.name ?? null,
    description: ch.description ?? null,
    serverId:    ch.serverId ?? null,
    icon:        ch.icon ? safeAssetUrl(ch, 'generateIconURL', { max_side: 64 }) : null,
    lastMessageId: ch.lastMessageId ?? null,
  };
}

function serializeMessage(msg) {
  if (!msg) return null;
  return {
    id:        msg.id,
    content:   msg.content ?? '',
    authorId:  msg.authorId,
    author:    msg.author ? serializeUser(msg.author) : null,
    channelId: msg.channelId,
    createdAt: msg.createdAt?.getTime() ?? Date.now(),
    editedAt:  msg.editedAt?.getTime() ?? null,
    attachments: msg.attachments?.map(a => ({
      id: a.id, filename: a.filename, size: a.size,
      url: a.url ?? null,
    })) ?? [],
  };
}

function serializeServer(srv) {
  if (!srv) return null;
  return {
    id:          srv.id,
    name:        srv.name,
    icon:        srv.icon ? safeAssetUrl(srv, 'generateIconURL', { max_side: 128 }) : null,
    banner:      srv.banner ? safeAssetUrl(srv, 'generateBannerURL', { max_side: 480 }) : null,
    description: srv.description ?? null,
    channelIds:  normalizeIdList(srv.channelIds),
    ownerId:     srv.ownerId ?? null,
  };
}

// ─── Client lifecycle ─────────────────────────────────────────────────────────

function createClient() {
  if (client) {
    try { client.removeAllListeners(); } catch {}
  }
  client = new Client();
  isReady = false;

  client.on('ready', () => {
    isReady = true;
    console.log('[Stoat] Connected as', client.user?.username);
    send('stoat-ready', { user: serializeUser(client.user) });
  });

  client.on('error', (err) => {
    const msg =
      err?.message ||
      err?.error?.message ||
      err?.type ||
      'Stoat connection error';
    console.error('[Stoat] Client error:', msg, err);
    send('stoat-error', { error: msg });
  });

  client.on('connecting', () => {
    console.log('[Stoat] Connecting...');
  });

  client.on('connected', () => {
    console.log('[Stoat] WebSocket connected');
  });

  client.on('disconnected', () => {
    isReady = false;
    console.log('[Stoat] Disconnected');
    send('stoat-disconnected', {});
  });

  client.on('message', (msg) => {
    send('stoat-message', serializeMessage(msg));
  });

  client.on('messageUpdate', (msg) => {
    send('stoat-message-update', serializeMessage(msg));
  });

  client.on('messageDelete', (id, msg) => {
    send('stoat-message-delete', { id, channelId: msg?.channelId ?? null });
  });

  // Typing indicators
  client.on('channelStartTyping', (channelId, userId) => {
    send('stoat-typing-start', { channelId, userId });
  });
  client.on('channelStopTyping', (channelId, userId) => {
    send('stoat-typing-stop', { channelId, userId });
  });

  return client;
}

function waitForReady(timeoutMs = 15000) {
  if (isReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
    const onReady = () => {
      clearTimeout(timeout);
      try { client?.off?.('ready', onReady); } catch {}
      resolve();
    };
    try {
      client?.on?.('ready', onReady);
    } catch {
      clearTimeout(timeout);
      reject(new Error('Stoat client not initialized'));
    }
  });
}

/**
 * Login with email + password — creates a new session.
 * Returns { ok, user, session } or { ok: false, error, mfa_ticket? }
 */
async function login(email, password) {
  createClient();
  try {
    const readyPromise = waitForReady();
    await client.login({
      email,
      password,
      friendly_name: 'SKALD Launcher',
    });
    client.connect();
    await readyPromise;

    // Save session for reuse
    sessionData = {
      token:   client.authenticationHeader?.[1],
      _id:     client.sessionId,
      user_id: client.user?.id,
    };

    return {
      ok: true,
      user: serializeUser(client.user),
      session: sessionData,
    };
  } catch (err) {
    console.error('[Stoat] Login error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Resume session from stored token.
 */
async function useExistingSession(session) {
  createClient();
  try {
    const readyPromise = waitForReady();
    client.useExistingSession(session);
    client.connect();
    await readyPromise;

    sessionData = session;
    return { ok: true, user: serializeUser(client.user) };
  } catch (err) {
    console.error('[Stoat] Session resume error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Disconnect and clear session.
 */
function logout() {
  isReady = false;
  sessionData = null;
  if (client) {
    try { client.removeAllListeners(); } catch {}
    // The SDK doesn't have a clean disconnect method, but removing listeners
    // and dropping the reference effectively disconnects the WebSocket.
    client = null;
  }
  return { ok: true };
}

// ─── Data accessors ───────────────────────────────────────────────────────────

function getStatus() {
  return {
    connected: isReady,
    user: isReady ? serializeUser(client?.user) : null,
    session: sessionData,
  };
}

function getServers() {
  if (!isReady || !client) return [];
  return [...client.servers.values()].map(serializeServer);
}

function getChannels(serverId) {
  if (!isReady || !client) return [];
  const server = client.servers.get(serverId);
  if (!server) return [];
  return normalizeIdList(server.channelIds)
    .map(id => client.channels.get(id))
    .filter(Boolean)
    .filter(ch => ch.type === 'TextChannel')
    .map(serializeChannel);
}

function getDMChannels() {
  if (!isReady || !client) return [];
  return [...client.channels.values()]
    .filter(ch => ch.type === 'DirectMessage' || ch.type === 'Group')
    .map(serializeChannel);
}

async function getMessages(channelId, limit = 50) {
  if (!isReady || !client) return [];
  const channel = client.channels.get(channelId);
  if (!channel) return [];
  try {
    const msgs = await channel.fetchMessages({ limit });
    return msgs.map(serializeMessage).reverse(); // oldest first
  } catch (err) {
    console.error('[Stoat] Fetch messages error:', err.message);
    return [];
  }
}

async function sendMessage(channelId, content) {
  if (!isReady || !client) return { ok: false, error: 'Not connected' };
  const channel = client.channels.get(channelId);
  if (!channel) return { ok: false, error: 'Channel not found' };
  try {
    const msg = await channel.sendMessage({ content });
    return { ok: true, message: serializeMessage(msg) };
  } catch (err) {
    console.error('[Stoat] Send message error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function openDM(userId) {
  if (!isReady || !client) return { ok: false, error: 'Not connected' };
  const user = client.users.get(userId);
  if (!user) return { ok: false, error: 'User not found' };
  try {
    const channel = await user.openDM();
    return { ok: true, channel: serializeChannel(channel) };
  } catch (err) {
    console.error('[Stoat] Open DM error:', err.message);
    return { ok: false, error: err.message };
  }
}

function getFriends() {
  if (!isReady || !client) return [];
  // Friends are users with a specific relationship status
  return [...client.users.values()]
    .filter(u => u.relationship === 'Friend')
    .map(serializeUser);
}

function getServerMembers(serverId) {
  if (!isReady || !client) return [];
  return [...client.serverMembers.values()]
    .filter(m => m.id?.serverId === serverId || m.serverId === serverId)
    .map(m => {
      const user = client.users.get(m.id?.userId ?? m.userId);
      return {
        userId:   m.id?.userId ?? m.userId,
        nickname: m.nickname ?? null,
        user:     user ? serializeUser(user) : null,
        roles:    m.roleIds ?? [],
      };
    })
    .filter(m => m.user);
}

async function setPresence(text) {
  if (!isReady || !client?.user) return { ok: false, error: 'Not connected' };
  try {
    await client.api.patch('/users/@me', {
      status: { text, presence: 'Online' },
    });
    return { ok: true };
  } catch (err) {
    console.error('[Stoat] Set presence error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function clearPresence() {
  if (!isReady || !client?.user) return { ok: false };
  try {
    await client.api.patch('/users/@me', {
      status: { text: null, presence: 'Online' },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  setSendToRenderer,
  login,
  useExistingSession,
  logout,
  getStatus,
  getServers,
  getChannels,
  getDMChannels,
  getMessages,
  sendMessage,
  openDM,
  getFriends,
  getServerMembers,
  setPresence,
  clearPresence,
};
