/**
 * Ulric-X MD FINAL CLEAN - Multi-User Pairing Manager
 *
 * This file uses the EXACT same Baileys config that worked in the user's
 * single-user index.js (Shah Empire MD). The only change: extended to
 * support multiple users, each with their own session folder.
 *
 * KEY: Minimal Baileys config. No browser override, no markOnlineOnConnect,
 * no generateHighQualityLinkPreview. Just like the working reference.
 *
 * The user reported that this config generated REAL pair codes AND sent
 * REAL push notifications. The only issue was login not completing —
 * which we fix by keeping the socket alive longer (5 min heartbeat).
 */
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const chalk = require('chalk');
const baileys = require('@whiskeysockets/baileys');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = baileys;

const config = require('./config');
const store  = require('./lib/store');
const status = require('./lib/status');
const session = require('./lib/session');
const owner   = require('./lib/owner');

// Active connections: jid -> { sock, status, lastSeen }
const connections = new Map();
// Pending pairing sessions: jid -> { sock, heartbeat, expiresAt }
const pendingPairs = new Map();
// Heartbeat intervals for connected users
const heartbeats = new Map();

/**
 * Generate pair code for a phone number.
 * Uses EXACT same Baileys config as the working single-user reference.
 */
async function generatePairCode(phoneNumber) {
  const clean = String(phoneNumber).replace(/\D/g, '');

  if (clean.length < 7 || clean.length > 15) {
    throw new Error('Invalid phone number length (need 7-15 digits)');
  }
  if (clean.startsWith('0')) {
    throw new Error('Remove leading 0, use country code (e.g. 923xxx)');
  }

  const jid = clean + '@s.whatsapp.net';
  const sessionPath = path.join(config.SESSIONS_DIR, jid);

  // Already paired?
  if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
    console.log(chalk.blue(`[PAIR] ${jid} already paired, reconnecting...`));
    status.setStatus(jid, 'connected');
    startConnection(jid).catch(e => console.error(e.message));
    throw new Error('Already paired. Reconnecting. Send .menu to your WhatsApp.');
  }

  // Duplicate check
  if (status.isPairingInProgress(jid)) {
    const s = status.getStatus(jid);
    if (s.code) {
      return { code: s.code, jid, expiresAt: s.expiresAt, existing: true };
    }
    throw new Error('Pairing already in progress. Please wait.');
  }

  // Limit check
  if (store.getUsers().length >= config.MAX_PAIR_USERS) {
    throw new Error('Pairing limit reached.');
  }

  status.setStatus(jid, 'connecting');
  session.logEvent('PAIR_REQUESTED', jid, { number: clean });

  try {
    fs.mkdirSync(sessionPath, { recursive: true });

    // ═══════════════════════════════════════════════════════════════
    // EXACT same config as user's working single-user index.js:
    //   - version, logger, auth, printQRInTerminal: false
    //   - connectTimeoutMs: 30000
    //   - defaultQueryTimeoutMs: 30000
    //   - keepAliveIntervalMs: 30000
    //
    // NO browser field (uses Baileys default) — this is what gave
    // REAL pair codes + REAL push notifications in the working reference.
    // We must NOT change this. Adding browser: [...] broke notifications.
    // ═══════════════════════════════════════════════════════════════
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
      keepAliveIntervalMs: 30000,
    });

    // Heartbeat (same as reference: 60s, sendPresenceUpdate 'available')
    const heartbeat = setInterval(() => {
      try {
        if (sock.ws && sock.ws.readyState === 1) {
          sock.sendPresenceUpdate('available');
        }
      } catch (e) {}
    }, 60000);

    let everConnected = false;
    let pairCode = null;
    let authReceived = false;
    let registered = false;
    let pairingLock = false;        // ← TRUE during 5-min pairing window (ignore close events)
    let retry515Count = 0;          // ← Count 515 retries (max 2)
    let activeSocket = sock;        // ← Track current socket for clean destroy

    sock.ev.on('creds.update', () => {
      try { saveCreds(); } catch (e) {}
      // Detect auth progression stages
      const wasRegistered = registered;
      if (state.creds && state.creds.registered) {
        registered = true;
      }
      // Log session saves (without spamming — only first 3)
      const saveCount = (sock._saveCount || 0) + 1;
      sock._saveCount = saveCount;
      if (saveCount <= 3) {
        session.logEvent('CREDS_UPDATED', jid, {
          saveCount,
          registered: state.creds?.registered || false,
          hasMe: !!(state.creds?.me)
        });
      }
      // Log REGISTERED event (the moment WhatsApp confirms registration)
      if (!wasRegistered && registered) {
        session.logEvent('REGISTERED', jid, { saveCount });
        console.log(chalk.green(`[PAIR] 📋 Device REGISTERED for ${jid}`));
      }
    });

    // Track connection.update with receivedPendingNotifications = true
    // This event fires when WhatsApp has accepted the device link request.
    // It happens BEFORE connection.open and signals auth is progressing.
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, receivedPendingNotifications } = update;

      // AUTH_RECEIVED: WhatsApp accepted our credentials (pre-open stage)
      if (receivedPendingNotifications && !authReceived) {
        authReceived = true;
        session.logEvent('AUTH_RECEIVED', jid);
        console.log(chalk.cyan(`[PAIR] 🔐 Auth received for ${jid} (pending notifications)`));
      }

      if (connection === 'open') {
        everConnected = true;
        pairingLock = false;  // Pairing complete — release lock
        connections.set(jid, { sock: activeSocket, status: 'open', lastSeen: Date.now() });
        console.log(chalk.green(`[PAIR] ✅ CONNECTED: ${jid}`));
        status.setStatus(jid, 'connected');
        session.logEvent('CONNECTION_OPENED', jid);

        // ═══════════════════════════════════════════════════════════════
        // CRITICAL FIX: Mark session as successfully linked.
        // Writes linked.json marker so on restart we know
        // this session is FULLY valid (not just pairing started).
        // ═══════════════════════════════════════════════════════════════
        session.markLinked(jid, { pairedVia: 'code' });
        session.resetFailCount(jid);
        session.logEvent('SESSION_LINKED', jid, { linkedAt: new Date().toISOString() });

        // SESSION_VERIFIED: Confirm session is fully valid (creds + linked marker)
        const verification = session.validateSession(jid);
        if (verification.valid) {
          session.logEvent('SESSION_VERIFIED', jid, { reason: verification.reason });
          console.log(chalk.green(`[PAIR] ✅ Session VERIFIED for ${jid}`));
        } else {
          console.log(chalk.red(`[PAIR] ⚠️ Session verification FAILED for ${jid}: ${verification.reason}`));
        }

        // ═══════════════════════════════════════════════════════════════
        // Assign owner (first user to pair becomes owner)
        // ═══════════════════════════════════════════════════════════════
        const wasAssigned = owner.assignOwner(jid, { pairedVia: 'code' });
        if (wasAssigned) {
          session.logEvent('OWNER_ASSIGNED', jid, { number: clean });
        }

        // Move from pending to permanent
        const pending = pendingPairs.get(jid);
        if (pending) {
          heartbeats.set(jid, pending.heartbeat);
          pendingPairs.delete(jid);
        } else {
          heartbeats.set(jid, heartbeat);
        }

        // Save user
        store.addUser(jid, {
          pairedAt: Date.now(),
          country: getCountryFromNumber(clean),
          isOwner: owner.isOwner(jid)
        });

        // Broadcast notification
        try { await onPair(jid, activeSocket); } catch (e) {}
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || 'unknown';
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(chalk.yellow(`[PAIR] Closed ${jid} (code=${statusCode}). Reconnect: ${shouldReconnect}`));
        session.logEvent('CONNECTION_CLOSED', jid, { statusCode, everConnected, shouldReconnect });
        session.logEvent('CLOSE_REASON', jid, { statusCode, message: errorMessage });

        try { clearInterval(heartbeat); } catch (e) {}
        const hb = heartbeats.get(jid);
        if (hb) { clearInterval(hb); heartbeats.delete(jid); }

        // ═══════════════════════════════════════════════════════════════
        // PAIRING LOCK: If pairing is in progress (pairCode set, within
        // 5-min window), IGNORE close events. Don't reconnect, don't
        // destroy session. The user is still entering the code.
        // ═══════════════════════════════════════════════════════════════
        if (pairingLock && pairCode && !everConnected) {
          console.log(chalk.cyan(`[PAIR] Pairing lock active for ${jid}. Ignoring close event (code ${statusCode}).`));
          session.logEvent('PAIRING_LOCK_IGNORE', jid, { statusCode });

          // SPECIAL: For 515, attempt max 2 silent reconnects with SAME session
          // (don't call startConnection — that validates and destroys!)
          if (statusCode === 515 && retry515Count < 2) {
            retry515Count++;
            console.log(chalk.yellow(`[PAIR] 515 retry ${retry515Count}/2 for ${jid}. Recreating socket with same creds...`));
            session.logEvent('RECONNECT_ATTEMPT_515', jid, { retry: retry515Count });

            // Wait 5 seconds, then create a fresh socket with SAME session path
            // (creds.json is already saved with registered=true)
            setTimeout(async () => {
              try {
                // Destroy old socket completely
                try { activeSocket.end(new Error('515 retry')); } catch (e) {}
                try { activeSocket.ws.close(); } catch (e) {}

                // Reuse the SAME session folder (creds are valid!)
                const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(sessionPath);
                const { version: newVersion } = await fetchLatestBaileysVersion();

                const newSock = makeWASocket({
                  version: newVersion,
                  logger: pino({ level: 'silent' }),
                  auth: newState,
                  printQRInTerminal: false,
                  connectTimeoutMs: 30000,
                  defaultQueryTimeoutMs: 30000,
                  keepAliveIntervalMs: 30000,
                });
                activeSocket = newSock;

                // Re-attach handlers (will fire open event if creds valid)
                newSock.ev.on('creds.update', newSaveCreds);
                newSock.ev.on('connection.update', async (upd) => {
                  if (upd.connection === 'open') {
                    everConnected = true;
                    pairingLock = false;
                    connections.set(jid, { sock: newSock, status: 'open', lastSeen: Date.now() });
                    console.log(chalk.green(`[PAIR] ✅ CONNECTED (after 515 retry): ${jid}`));
                    status.setStatus(jid, 'connected');
                    session.logEvent('CONNECTION_OPENED', jid, { afterRetry515: true });
                    session.markLinked(jid, { pairedVia: 'code' });
                    session.logEvent('SESSION_LINKED', jid, {});
                    session.logEvent('SESSION_VERIFIED', jid, {});
                    if (owner.assignOwner(jid, { pairedVia: 'code' })) {
                      session.logEvent('OWNER_ASSIGNED', jid, { number: clean });
                    }
                    store.addUser(jid, { pairedAt: Date.now(), country: getCountryFromNumber(clean), isOwner: owner.isOwner(jid) });
                  }
                  if (upd.connection === 'close' && pairingLock) {
                    // Still in pairing window — keep ignoring
                    console.log(chalk.yellow(`[PAIR] Close during 515 retry for ${jid}. Ignoring.`));
                  }
                });

                const handlerMod = require('./handler');
                newSock.ev.on('messages.upsert', async ({ messages }) => {
                  try { await handlerMod.onMessage(newSock, messages[0]); } catch (e) {}
                });

                console.log(chalk.green(`[PAIR] 515 retry socket created for ${jid}. Waiting for open...`));
              } catch (retryErr) {
                console.error(chalk.red(`[PAIR] 515 retry failed for ${jid}: ${retryErr.message}`));
              }
            }, 5000);
          }
          return;  // Don't proceed to normal handling
        }

        if (everConnected) {
          // Was connected → auto reconnect (session is valid)
          connections.set(jid, { sock, status: 'reconnecting', lastSeen: Date.now() });
          // Track reconnect failures — if too many, destroy session
          const result = session.recordReconnectFailure(jid, 3);
          if (result.deleted) {
            console.log(chalk.red(`[PAIR] Session destroyed after ${result.failCount} failures: ${jid}`));
            connections.delete(jid);
          } else {
            setTimeout(() => startConnection(jid).catch(e => console.error(e.message)), 5000);
          }
        } else if (!pairCode) {
          // Closed before pair code → fail + clean up incomplete session
          status.setStatus(jid, 'failed', { error: `Connection closed (code ${statusCode})` });
          pendingPairs.delete(jid);
          // Only destroy if not yet linked (don't destroy valid sessions!)
          const validation = session.validateSession(jid);
          if (!validation.valid) {
            session.destroySession(jid);
          }
        }
        // If pairCode exists but connection closed (non-515) → keep session alive
        // (user may still enter code; WhatsApp will retry)
      }
    });  // ← end of connection.update handler

    // Message handler
    const handler = require('./handler');
    sock.ev.on('messages.upsert', async ({ messages }) => {
      try { await handler.onMessage(sock, messages[0]); } catch (e) {}
    });

    // Anti-delete + anti-edit handler
    sock.ev.on('messages.update', async (updates) => {
      try { await handler.onMessagesUpdate(sock, updates); } catch (e) {}
    });

    sock.ev.on('group-participants.update', async (ev) => {
      try { await handler.onGroupUpdate(sock, ev); } catch (e) {}
    });

    // ═══════════════════════════════════════════════════════════════
    // Wait 5 seconds (same as reference: setTimeout 5000)
    // Then request pair code
    // ═══════════════════════════════════════════════════════════════
    await new Promise(r => setTimeout(r, 5000));

    if (state.creds.registered) {
      throw new Error('Already registered.');
    }

    status.setStatus(jid, 'requesting');

    // Request pair code
    const code = await sock.requestPairingCode(clean);
    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
    pairCode = formatted;
    pairingLock = true;  // ← Activate pairing lock — ignore close events for 5 min

    console.log(chalk.green(`\n========================================`));
    console.log(chalk.green(`   YOUR PAIRING CODE: ${formatted}`));
    console.log(chalk.green(`   For: ${clean}`));
    console.log(chalk.green(`========================================\n`));
    session.logEvent('PAIR_CODE_GENERATED', jid, { code: formatted });
    session.logEvent('PAIRING_LOCK_ACTIVATED', jid, { duration: '5min' });

    const expiresAt = Date.now() + 5 * 60 * 1000;
    status.setStatus(jid, 'code_generated', { code: formatted, expiresAt });

    // Keep socket alive for 5 minutes
    pendingPairs.set(jid, { sock, heartbeat, expiresAt });

    // Auto cleanup after 5 min
    setTimeout(() => {
      if (pendingPairs.has(jid) && !connections.has(jid)) {
        console.log(chalk.yellow(`[PAIR] Expired ${jid}`));
        try { clearInterval(heartbeat); } catch (e) {}
        try { sock.end(); } catch (e) {}
        pendingPairs.delete(jid);
        if (!store.isPaired(jid)) {
          status.setStatus(jid, 'expired');
          try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {}
        }
      }
    }, 5 * 60 * 1000);

    return { code: formatted, rawCode: formatted.replace(/-/g, ''), jid, expiresAt };

  } catch (error) {
    console.error(chalk.red(`[PAIR] Error ${jid}: ${error.message}`));
    status.setStatus(jid, 'failed', { error: error.message });
    throw error;
  }
}

/**
 * Start connection for already-paired user (on boot or reconnect).
 * Uses SAME minimal config.
 */
async function startConnection(jid) {
  const sessionPath = path.join(config.SESSIONS_DIR, jid);

  // ═══════════════════════════════════════════════════════════════
  // CRITICAL FIX: Validate session before loading.
  // Prevents loading corrupt/incomplete sessions which cause
  // the "Could not link devices" error on reconnect.
  // ═══════════════════════════════════════════════════════════════
  const validation = session.validateSession(jid);
  if (!validation.valid) {
    console.log(chalk.red(`[CONN] Invalid session for ${jid}: ${validation.reason}`));
    console.log(chalk.red(`[CONN] Destroying corrupt session, user must re-pair`));
    session.destroySession(jid);
    session.logEvent('SESSION_REJECTED', jid, { reason: validation.reason });
    return null;
  }
  const info = session.getSessionInfo(jid);
  console.log(chalk.green(`[CONN] Session valid for ${jid} (linked since ${info.linkedAtISO || 'unknown'})`));
  session.logEvent('SESSION_LOADED', jid, { reason: validation.reason });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    // SAME config as pairing — no browser field (default Baileys behavior)
    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
      keepAliveIntervalMs: 30000,
    });

    connections.set(jid, { sock, status: 'connecting', lastSeen: Date.now() });

    const heartbeat = setInterval(() => {
      try {
        if (sock.ws && sock.ws.readyState === 1) {
          sock.sendPresenceUpdate('available');
        }
      } catch (e) {}
    }, 60000);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        connections.set(jid, { sock, status: 'open', lastSeen: Date.now() });
        heartbeats.set(jid, heartbeat);
        session.resetFailCount(jid);
        console.log(chalk.green(`[CONN] ✅ ${jid}`));
        session.logEvent('CONNECTION_OPENED', jid, { context: 'reconnect' });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        session.logEvent('CONNECTION_CLOSED', jid, { statusCode, context: 'reconnect' });

        const hb = heartbeats.get(jid);
        if (hb) { clearInterval(hb); heartbeats.delete(jid); }

        if (shouldReconnect) {
          // Track failures — destroy after 3 to prevent infinite loop
          const result = session.recordReconnectFailure(jid, 3);
          if (result.deleted) {
            console.log(chalk.red(`[CONN] Session destroyed after ${result.failCount} failures: ${jid}`));
            connections.delete(jid);
          } else {
            connections.set(jid, { sock, status: 'reconnecting', lastSeen: Date.now() });
            setTimeout(() => startConnection(jid).catch(e => console.error(e.message)), 5000);
          }
        } else {
          // Logged out by WhatsApp → destroy session
          session.logEvent('SESSION_LOGOUT', jid, { statusCode });
          unpairUser(jid, true);
        }
      }
    });

    const handler = require('./handler');
    sock.ev.on('messages.upsert', async ({ messages }) => {
      try { await handler.onMessage(sock, messages[0]); } catch (e) {}
    });

    // Anti-delete + anti-edit handler (for reconnects too)
    sock.ev.on('messages.update', async (updates) => {
      try { await handler.onMessagesUpdate(sock, updates); } catch (e) {}
    });

    sock.ev.on('group-participants.update', async (ev) => {
      try { await handler.onGroupUpdate(sock, ev); } catch (e) {}
    });

    return sock;
  } catch (e) {
    console.error(chalk.red(`[CONN] Failed ${jid}: ${e.message}`));
    return null;
  }
}

async function onPair(jid, sock) {
  // ═══════════════════════════════════════════════════════════════
  // CONNECTED MESSAGE: Send to the user who just paired (their "yourself" chat)
  // Uses verified WhatsApp-style reply with the bot logo image.
  // ═══════════════════════════════════════════════════════════════
  try {
    const verified = require('./lib/verifiedReply');
    const connectedText = config.BOT_CONNECTED_MSG || '✅ Bot Connected';
    await verified.sendVerified(sock, jid, {
      image: { url: config.BOT_LOGO },
      caption: connectedText,
      contextInfo: verified.verifiedContext()
    });
    console.log(chalk.green(`[PAIR] ✅ Connected message sent to ${jid}`));
  } catch (e) {
    console.error(chalk.red(`[PAIR] Failed to send connected message: ${e.message}`));
    // Fallback: text-only
    try {
      await sock.sendMessage(jid, { text: config.BOT_CONNECTED_MSG || '✅ Bot Connected' });
    } catch {}
  }

  // Wait a moment then send a welcome hint
  await new Promise(r => setTimeout(r, 1500));
  try {
    const verified = require('./lib/verifiedReply');
    await verified.sendVerified(sock, jid, {
      text: `👋 Welcome to ${config.BOT_NAME}!\n\nType .menu to see all ${require('./handler').getTotalCommands()} commands.\nType .allmenu for the full list.\n\n> ${config.BOT_FOOTER}`
    });
  } catch (e) {}

  // Broadcast to owner (existing behavior)
  if (!config.BCAST_ON_PAIR) return;
  const text = config.BCAST_TEXT_ON_PAIR(jid);
  try { await sock.sendMessage(config.BOT_OWNER_JID, { text }); } catch (e) {}
  try {
    const ownerConn = connections.get(config.BOT_OWNER_JID);
    const ownerSock = ownerConn?.sock || sock;
    const groups = await ownerSock.groupFetchAllWhitelist?.().catch(() => []) || [];
    for (const g of groups.slice(0, 5)) {
      try { await ownerSock.sendMessage(g.id, { text }); } catch (e) {}
    }
  } catch (e) {}
}

function unpairUser(jid, deleteSessionFlag = true) {
  const conn = connections.get(jid);
  if (conn?.sock) { try { conn.sock.end(); } catch (e) {} }
  const pending = pendingPairs.get(jid);
  if (pending) { try { clearInterval(pending.heartbeat); } catch (e) {} try { pending.sock.end(); } catch (e) {} pendingPairs.delete(jid); }
  const hb = heartbeats.get(jid);
  if (hb) { clearInterval(hb); heartbeats.delete(jid); }

  connections.delete(jid);
  status.clearStatus(jid);
  store.removeUser(jid);

  if (deleteSessionFlag) {
    session.destroySession(jid);
    session.logEvent('SESSION_DESTROYED', jid, { reason: 'unpair' });
  }
  return true;
}

async function autoLoadAllPaired(onProgress) {
  const entries = fs.existsSync(config.SESSIONS_DIR)
    ? fs.readdirSync(config.SESSIONS_DIR, { withFileTypes: true })
    : [];
  const allDirs = entries
    .filter(d => d.isDirectory() && d.name.endsWith('@s.whatsapp.net'))
    .map(d => d.name);

  // ═══════════════════════════════════════════════════════════════
  // CRITICAL FIX: Only load VALID sessions (creds.json + linked.json).
  // Invalid sessions (pairing started but never completed) are destroyed.
  // ═══════════════════════════════════════════════════════════════
  const validDirs = [];
  const destroyedDirs = [];
  for (const jid of allDirs) {
    const v = session.validateSession(jid);
    if (v.valid) {
      validDirs.push(jid);
    } else {
      console.log(chalk.yellow(`[AUTOLOAD] Destroying invalid session ${jid}: ${v.reason}`));
      session.destroySession(jid);
      destroyedDirs.push(jid);
    }
  }

  console.log(chalk.cyan(`[AUTOLOAD] ${validDirs.length} valid session(s), ${destroyedDirs.length} destroyed`));
  if (destroyedDirs.length > 0) {
    console.log(chalk.yellow(`[AUTOLOAD] Destroyed: ${destroyedDirs.join(', ')}`));
  }

  // Log owner info on boot
  const ownerInfo = owner.getOwnerInfo();
  if (ownerInfo) {
    console.log(chalk.green(`[AUTOLOAD] 👑 Owner: ${ownerInfo.jid} (since ${ownerInfo.assignedAtISO})`));
  } else {
    console.log(chalk.yellow(`[AUTOLOAD] No owner assigned yet (first user to pair will become owner)`));
  }

  for (let i = 0; i < validDirs.length; i++) {
    const jid = validDirs[i];
    try {
      console.log(chalk.blue(`[AUTOLOAD] ${i+1}/${validDirs.length} ${jid}`));
      await startConnection(jid);
      if (onProgress) onProgress(i + 1, validDirs.length, jid);
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(chalk.red(`[AUTOLOAD] Failed ${jid}: ${e.message}`));
    }
  }
  console.log(chalk.green(`[AUTOLOAD] Done. ${connections.size} active.`));
}

async function broadcastAll(text) {
  const targets = [];
  for (const [jid, info] of connections.entries()) {
    if (info.status !== 'open') continue;
    try {
      await info.sock.sendMessage(jid, { text });
      targets.push(jid);
    } catch (e) {}
  }
  return targets;
}

async function broadcastOwnerGroups(text) {
  const ownerConn = connections.get(config.BOT_OWNER_JID);
  if (!ownerConn || ownerConn.status !== 'open') return [];
  const targets = [];
  const groups = await ownerConn.sock.groupFetchAllWhitelist?.().catch(() => []) || [];
  for (const g of groups) {
    try { await ownerConn.sock.sendMessage(g.id, { text }); targets.push(g.id); } catch (e) {}
  }
  return targets;
}

function getCountryFromNumber(num) {
  const { getCountry } = require('./lib/utils');
  return getCountry(num);
}

function getConnection(jid) { return connections.get(jid); }
function getAllConnections() { return Array.from(connections.values()); }

function gracefulShutdown() {
  console.log(chalk.yellow('[SHUTDOWN] Closing all...'));
  for (const [jid, info] of connections.entries()) {
    try { info.sock.end(); } catch (e) {}
  }
  for (const [jid, p] of pendingPairs.entries()) {
    try { clearInterval(p.heartbeat); } catch (e) {}
    try { p.sock.end(); } catch (e) {}
  }
  for (const [jid, hb] of heartbeats.entries()) {
    try { clearInterval(hb); } catch (e) {}
  }
}

process.on('SIGINT', () => { gracefulShutdown(); process.exit(0); });
process.on('SIGTERM', () => { gracefulShutdown(); process.exit(0); });

module.exports = {
  generatePairCode,
  startConnection,
  unpairUser,
  getConnection,
  getAllConnections,
  autoLoadAllPaired,
  broadcastAll,
  broadcastOwnerGroups
};
