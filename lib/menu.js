/**
 * Ulric-X MD - Verified Menu Builder
 *
 * Builds the WhatsApp-style verified menu with:
 * - Bot image (logo)
 * - Owner info, runtime, total users, total commands
 * - All categories listed
 * - All commands in each category (readMore format)
 * - Channel integration (View Channel / Mute Channel / Verified badge)
 */
const config = require('../config');
const verified = require('./verifiedReply');
const utils = require('./utils');

// ReadMore separator — used by WhatsApp to collapse long messages
const READMORE = '\u200E'.repeat(4000);

function buildHeader(runtime, totalUsers, totalCommands) {
  return `╭━━❖ 𝐔𝐋𝐑𝐈𝐂-𝐗 𝐌𝐃 ❖━┈⊷
┃╭────────────────
┃│ 👑 𝐎𝐰𝐧𝐞𝐫 : ${config.BOT_OWNER}
┃│ 🤖 𝐁𝐨𝐭   : ${config.BOT_NAME}
┃│ 📦 𝐕𝐞𝐫   : ${config.BOT_VERSION}
┃│ ⏱️ 𝐔𝐩   : ${runtime}
┃│ 👥 𝐔𝐬𝐞𝐫 : ${totalUsers}
┃│ 📦 𝐂𝐦𝐝 : ${totalCommands}
┃╰────────────────
╰━━━━━━━━━━━━━━━┈⊷`;
}

function buildChannelSection() {
  return `╭━━❖ 📢 𝐂𝐇𝐀𝐍𝐍𝐄𝐋 ❖━┈⊷
┃╭────────────────
┃│ ✓ ${config.BOT_CHANNEL_NAME}
┃│ 🆔 ${config.BOT_CHANNEL_ID}
┃│ 🔗 ${config.BOT_CHANNEL_URL}
┃╰────────────────
╰━━━━━━━━━━━━━━━┈⊷

> Tap "View Channel" below to open our verified WhatsApp channel`;
}

function buildCategorySection(catName, commands, prefix) {
  const emoji = getCategoryEmoji(catName);
  let out = `\n╭━━❖ ${emoji} ${catName.toUpperCase()} ❖━┈⊷\n`;
  for (const c of commands) {
    out += `┃ └ ${prefix}${c.name}\n`;
  }
  out += `╰━━━━━━━━━━━━━━━┈⊷`;
  return out;
}

function getCategoryEmoji(cat) {
  const map = {
    main: '📋', owner: '👑', group: '👥', download: '📥', sticker: '🎭',
    fun: '🎮', game: '🎯', anime: '🌸', ai: '🤖', logo: '🎨',
    voice: '🔊', image: '🖼️', media: '🎬', utility: '🛠️', religion: '🕌',
    info: 'ℹ️', text: '📝', random: '🎲', reaction: '💫', convert: '🔄',
    search: '🔍', database: '💾', misc: '📌'
  };
  return map[cat] || '📌';
}

/**
 * Build the FULL menu text (all commands).
 * Used by .allmenu
 */
function buildAllMenu(prefix, runtime, totalUsers, totalCommands, categories) {
  let text = buildHeader(runtime, totalUsers, totalCommands);
  text += '\n\n';
  text += READMORE;  // Collapses everything below in WhatsApp
  text += '\n';

  // Sort categories alphabetically
  const sortedCats = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [catName, cmds] of sortedCats) {
    text += buildCategorySection(catName, cmds, prefix);
    text += '\n';
  }

  text += '\n' + buildChannelSection();
  text += `\n\n> ${config.BOT_FOOTER}`;
  return text;
}

/**
 * Build the SHORT menu (categories only, no commands listed).
 * Used by .menu
 */
function buildShortMenu(prefix, runtime, totalUsers, totalCommands, categories) {
  let text = buildHeader(runtime, totalUsers, totalCommands);
  text += '\n\n';
  text += `╭━━❖ 📂 𝐂𝐀𝐓𝐄𝐆𝐎𝐑𝐈𝐄𝐒 ❖━┈⊷\n`;
  const sortedCats = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [catName, cmds] of sortedCats) {
    const emoji = getCategoryEmoji(catName);
    text += `┃ └ ${emoji} ${prefix}${catName}menu (${cmds.length})\n`;
  }
  text += `╰━━━━━━━━━━━━━━━┈⊷\n\n`;

  text += `╭━━❖ ⚡ 𝐐𝐔𝐈𝐂𝐊 ❖━┈⊷\n`;
  text += `┃ └ ${prefix}allmenu - Show ALL ${totalCommands} commands\n`;
  text += `┃ └ ${prefix}ping - Bot speed test\n`;
  text += `┃ └ ${prefix}owner - Owner info\n`;
  text += `┃ └ ${prefix}alive - Check bot status\n`;
  text += `╰━━━━━━━━━━━━━━━┈⊷\n\n`;

  text += buildChannelSection();
  text += `\n\n> ${config.BOT_FOOTER}`;
  return text;
}

/**
 * Build category-specific menu.
 * Used by .ownermenu, .groupmenu, .downloadmenu, etc.
 */
function buildCategoryMenu(prefix, catName, cmds) {
  const emoji = getCategoryEmoji(catName);
  let text = `╭━━❖ ${emoji} ${catName.toUpperCase()} 𝐌𝐄𝐍𝐔 ❖━┈⊷\n`;
  text += `┃╭────────────────\n`;
  text += `┃│ 📦 Total: ${cmds.length} commands\n`;
  text += `┃╰────────────────\n`;
  text += `╰━━━━━━━━━━━━━━━┈⊷\n\n`;

  text += buildCategorySection(catName, cmds, prefix);
  text += `\n\n> ${config.BOT_FOOTER}`;
  return text;
}

/**
 * Send menu with verified badge + channel buttons.
 * Uses externalAdReply + forwardedNewsletterMessageInfo for verified look.
 */
async function sendVerifiedMenu(sock, jid, menuText, quoted, withChannelButtons = true) {
  const messageContent = {
    image: { url: config.BOT_LOGO },
    caption: menuText,
    contextInfo: verified.verifiedContext()
  };

  // Add channel buttons if requested
  if (withChannelButtons) {
    messageContent.buttons = [
      {
        buttonId: `${config.BOT_CHANNEL_URL}`,
        buttonText: { displayText: '📢 View Channel' },
        type: 1
      },
      {
        buttonId: `mute_channel_${config.BOT_CHANNEL_JID}`,
        buttonText: { displayText: '🔇 Mute Channel' },
        type: 1
      }
    ];
    messageContent.headerType = 4;
  }

  return sock.sendMessage(jid, messageContent, { quoted });
}

module.exports = {
  buildHeader,
  buildChannelSection,
  buildCategorySection,
  buildAllMenu,
  buildShortMenu,
  buildCategoryMenu,
  sendVerifiedMenu,
  getCategoryEmoji,
  READMORE
};
