/**
 * Ulric-X MD - Verified WhatsApp-Style Reply
 *
 * Uses contextInfo with forwardedNewsletterMessageInfo to display
 * the "WhatsApp ✓" verified badge above bot replies.
 *
 * Uses the official WhatsApp newsletter JID pattern that triggers
 * the verified blue checkmark in WhatsApp clients.
 */
const config = require('../config');

// Use the channel JID from config for the verified badge
const WHATSAPP_NEWSLETTER_JID = config.BOT_CHANNEL_JID || '120363404551577200@newsletter';
const WHATSAPP_NEWSLETTER_NAME = 'WhatsApp';

/**
 * Build verified context info for a message.
 */
function verifiedContext(extra = {}) {
  return {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: WHATSAPP_NEWSLETTER_JID,
      newsletterName: WHATSAPP_NEWSLETTER_NAME,
      serverMessageId: -1,
      ...extra
    },
    // externalAdReply gives a thumbnail + title above the message
    externalAdReply: {
      title: 'Ulric-X MD',
      body: 'Verified WhatsApp Bot',
      thumbnailUrl: config.BOT_LOGO,
      sourceUrl: config.BOT_CHANNEL_URL || 'https://whatsapp.com',
      mediaType: 1,
      renderLargerThumbnail: false,
      showAdAttribution: false
    }
  };
}

/**
 * Send a verified WhatsApp-style message.
 */
async function sendVerified(sock, jid, messageContent, opts = {}) {
  const finalMessage = { ...messageContent };
  finalMessage.contextInfo = {
    ...(messageContent.contextInfo || {}),
    ...verifiedContext()
  };
  return sock.sendMessage(jid, finalMessage, opts);
}

/**
 * Wrap ctx.reply to use verified context.
 */
function makeVerifiedReply(sock, jid, m) {
  return async (txt, opts = {}) => {
    if (typeof txt !== 'string') txt = String(txt ?? '');
    return sendVerified(sock, jid, {
      text: txt,
      mentions: (txt.match(/@\d{5,16}/g) || []).map(s => s.slice(1) + '@s.whatsapp.net')
    }, { quoted: m, ...opts });
  };
}

module.exports = {
  verifiedContext,
  sendVerified,
  makeVerifiedReply,
  WHATSAPP_NEWSLETTER_JID,
  WHATSAPP_NEWSLETTER_NAME
};
