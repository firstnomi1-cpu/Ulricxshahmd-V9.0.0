/**
 * Ulric-X MD - Anti Delete + Anti Edit System
 *
 * Modes per chat (PM/group):
 * - off:        anti system disabled
 * - pm:         forward originals to bot owner's PM
 * - public:     send originals in the SAME chat where deletion/edit happened
 *
 * Anti-delete: detects protocolMessage type 0 (REVOKE), retrieves original
 *              from messageStore, resends it with a "deleted" notice.
 * Anti-edit:   detects protocolMessage type 15 (EDIT_MESSAGE), retrieves
 *              original, resends with "edited" notice.
 *
 * Media support: text, image, video, audio, sticker, document — all resent.
 */
const config = require('../config');
const messageStore = require('./messageStore');
const verified = require('./verifiedReply');

// Per-chat anti settings: chatJid -> { delete: 'off'|'pm'|'public', edit: 'off'|'pm'|'public' }
const antiSettings = new Map();
// Track processed message IDs to prevent loops/duplicates
const processedIds = new Set();
const MAX_PROCESSED = 500;

function getSettings(jid) {
  return antiSettings.get(jid) || { delete: 'off', edit: 'off' };
}

function setDeleteMode(jid, mode) {
  const s = getSettings(jid);
  s.delete = mode;
  antiSettings.set(jid, s);
  return s;
}

function setEditMode(jid, mode) {
  const s = getSettings(jid);
  s.edit = mode;
  antiSettings.set(jid, s);
  return s;
}

function setModeAll(jid, mode) {
  const s = { delete: mode, edit: mode };
  antiSettings.set(jid, s);
  return s;
}

function markProcessed(id) {
  processedIds.add(id);
  if (processedIds.size > MAX_PROCESSED) {
    // Clear oldest half
    const arr = [...processedIds];
    processedIds.clear();
    arr.slice(-MAX_PROCESSED / 2).forEach(x => processedIds.add(x));
  }
}

function isProcessed(id) {
  return processedIds.has(id);
}

/**
 * Process incoming messages.update events (deletions + edits).
 * Returns true if handled, false if not an anti event.
 */
async function handleMessagesUpdate(sock, updates) {
  for (const update of updates) {
    try {
      // Skip if already processed (prevent loops)
      if (update.key?.id && isProcessed(update.key.id)) continue;

      const jid = update.key?.remoteJid;
      if (!jid) continue;

      // Detect DELETE: protocolMessage.type === 0
      if (update.message?.protocolMessage?.type === 0) {
        await handleDelete(sock, update, jid);
      }
      // Detect EDIT: protocolMessage.type === 15
      else if (update.message?.protocolMessage?.type === 15) {
        await handleEdit(sock, update, jid);
      }
    } catch (e) {
      console.error('[ANTI] Update error:', e.message);
    }
  }
}

async function handleDelete(sock, update, jid) {
  const settings = getSettings(jid);
  if (settings.delete === 'off') return;

  const deletedMsgId = update.message.protocolMessage.key?.id;
  const targetJid = update.message.protocolMessage.key?.remoteJid || jid;
  if (!deletedMsgId) return;

  markProcessed(deletedMsgId);

  // Get original message from store
  const original = messageStore.getMessage(targetJid, deletedMsgId);
  if (!original) {
    console.log('[ANTI-DELETE] Original not in store, cannot recover');
    return;
  }

  const sender = original.sender || update.key.participant || jid;
  const senderNum = sender.split('@')[0];

  const notice = `🛡️ *ANTI-DELETE*\n\n` +
    `👤 Sender: @${senderNum}\n` +
    `🗑️ Deleted at: ${new Date().toLocaleString()}\n` +
    `💬 Original message:`;

  // Determine target chat
  const targetChat = settings.delete === 'pm' ? config.BOT_OWNER_JID : jid;

  // Send notice first
  try {
    await verified.sendVerified(sock, targetChat, {
      text: notice,
      mentions: [sender]
    });
  } catch (e) {}

  // Resend original message content
  await resendMessage(sock, targetChat, original.message, original.key);
}

async function handleEdit(sock, update, jid) {
  const settings = getSettings(jid);
  if (settings.edit === 'off') return;

  const editedMsgId = update.message.protocolMessage.key?.id;
  const targetJid = update.message.protocolMessage.key?.remoteJid || jid;
  if (!editedMsgId) return;

  markProcessed(editedMsgId + '-edit');

  const original = messageStore.getMessage(targetJid, editedMsgId);
  if (!original) {
    console.log('[ANTI-EDIT] Original not in store, cannot recover');
    return;
  }

  const sender = original.sender || update.key.participant || jid;
  const senderNum = sender.split('@')[0];

  const notice = `📝 *ANTI-EDIT*\n\n` +
    `👤 Sender: @${senderNum}\n` +
    `✏️ Edited at: ${new Date().toLocaleString()}\n` +
    `💬 Original (before edit):`;

  const targetChat = settings.edit === 'pm' ? config.BOT_OWNER_JID : jid;

  try {
    await verified.sendVerified(sock, targetChat, {
      text: notice,
      mentions: [sender]
    });
  } catch (e) {}

  await resendMessage(sock, targetChat, original.message, original.key);
}

/**
 * Resend a message based on its type (text, image, video, audio, sticker, document).
 */
async function resendMessage(sock, jid, message, originalKey) {
  if (!message) {
    await verified.sendVerified(sock, jid, { text: '_(empty message)_' });
    return;
  }

  try {
    // Text message
    if (message.conversation) {
      await verified.sendVerified(sock, jid, { text: message.conversation });
      return;
    }
    if (message.extendedTextMessage?.text) {
      await verified.sendVerified(sock, jid, { text: message.extendedTextMessage.text });
      return;
    }

    // Image
    if (message.imageMessage) {
      const buffer = await downloadMedia(sock, message, 'image');
      if (buffer) {
        await sock.sendMessage(jid, {
          image: buffer,
          caption: message.imageMessage.caption || '',
          contextInfo: verified.verifiedContext()
        });
      }
      return;
    }

    // Video
    if (message.videoMessage) {
      const buffer = await downloadMedia(sock, message, 'video');
      if (buffer) {
        await sock.sendMessage(jid, {
          video: buffer,
          caption: message.videoMessage.caption || '',
          contextInfo: verified.verifiedContext()
        });
      }
      return;
    }

    // Audio
    if (message.audioMessage) {
      const buffer = await downloadMedia(sock, message, 'audio');
      if (buffer) {
        await sock.sendMessage(jid, {
          audio: buffer,
          mimetype: message.audioMessage.mimetype || 'audio/mpeg',
          ptt: message.audioMessage.ptt || false,
          contextInfo: verified.verifiedContext()
        });
      }
      return;
    }

    // Sticker
    if (message.stickerMessage) {
      const buffer = await downloadMedia(sock, message, 'sticker');
      if (buffer) {
        await sock.sendMessage(jid, {
          sticker: buffer,
          contextInfo: verified.verifiedContext()
        });
      }
      return;
    }

    // Document
    if (message.documentMessage) {
      const buffer = await downloadMedia(sock, message, 'document');
      if (buffer) {
        await sock.sendMessage(jid, {
          document: buffer,
          fileName: message.documentMessage.fileName || 'document',
          mimetype: message.documentMessage.mimetype || 'application/octet-stream',
          contextInfo: verified.verifiedContext()
        });
      }
      return;
    }

    // Unknown type - send raw text representation
    await verified.sendVerified(sock, jid, {
      text: '_(Unsupported message type)_'
    });
  } catch (e) {
    console.error('[ANTI] Resend failed:', e.message);
    try {
      await verified.sendVerified(sock, jid, {
        text: `⚠️ Failed to recover media: ${e.message}\n\nOriginal text: ${messageStore.extractText(message)}`
      });
    } catch {}
  }
}

async function downloadMedia(sock, message, type) {
  try {
    const baileys = require('@whiskeysockets/baileys');
    const { downloadContentFromMessage } = baileys;
    const m = message[type + 'Message'] || message[type === 'sticker' ? 'stickerMessage' : type + 'Message'];
    if (!m) return null;
    const stream = await downloadContentFromMessage(m, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (e) {
    console.error('[ANTI] Media download failed:', e.message);
    return null;
  }
}

function getStatus(jid) {
  return getSettings(jid);
}

function getAllSettings() {
  const result = {};
  for (const [jid, s] of antiSettings.entries()) {
    result[jid] = s;
  }
  return result;
}

module.exports = {
  handleMessagesUpdate,
  setDeleteMode,
  setEditMode,
  setModeAll,
  getSettings,
  getStatus,
  getAllSettings
};
