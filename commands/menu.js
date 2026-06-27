/**
 * Ulric-X MD - Menu Commands (Verified)
 * .menu       → Short menu (categories + quick commands)
 * .allmenu    → Full menu (ALL 1659 commands, readMore format)
 * .<cat>menu  → Category-specific menu (e.g. .ownermenu, .groupmenu)
 */
const config = require('../config');
const menu   = require('../lib/menu');
const handler= require('../handler');
const utils  = require('../lib/utils');
const verified = require('../lib/verifiedReply');

// Generic category menu builder
function makeCategoryMenuCommand(category, aliases = []) {
  return {
    name: `${category}menu`,
    alias: aliases,
    category: 'main',
    desc: `Show ${category} commands`,
    handler: async (ctx) => {
      const cmds = handler.getCommandsByCategory(category);
      if (!cmds.length) return ctx.reply(`No commands in category: ${category}`);
      const text = menu.buildCategoryMenu(ctx.prefix, category, cmds);
      await menu.sendVerifiedMenu(ctx.sock, ctx.jid, text, ctx.m);
    }
  };
}

module.exports = [
  // ─── Main menu ─────────────────────────────────────────────
  {
    name: 'menu', alias: ['listmenu','help','h','?'], category: 'main', desc: 'Show main menu',
    handler: async (ctx) => {
      const runtime = utils.runtime(process.uptime());
      const totalUsers = ctx.store.getUsers().length;
      const totalCommands = handler.getTotalCommands();
      const categories = new Map();
      for (const cat of handler.getAllCategories()) {
        categories.set(cat, handler.getCommandsByCategory(cat));
      }
      const text = menu.buildShortMenu(ctx.prefix, runtime, totalUsers, totalCommands, categories);
      await menu.sendVerifiedMenu(ctx.sock, ctx.jid, text, ctx.m);
    }
  },
  // ─── All commands menu ─────────────────────────────────────
  {
    name: 'allmenu', alias: ['allcmds','menu2','commands'], category: 'main', desc: 'Show all commands',
    handler: async (ctx) => {
      const runtime = utils.runtime(process.uptime());
      const totalUsers = ctx.store.getUsers().length;
      const totalCommands = handler.getTotalCommands();
      const categories = new Map();
      for (const cat of handler.getAllCategories()) {
        categories.set(cat, handler.getCommandsByCategory(cat));
      }
      const text = menu.buildAllMenu(ctx.prefix, runtime, totalUsers, totalCommands, categories);
      await menu.sendVerifiedMenu(ctx.sock, ctx.jid, text, ctx.m);
    }
  },
  // ─── Category menus ────────────────────────────────────────
  makeCategoryMenuCommand('owner', ['om']),
  makeCategoryMenuCommand('group', ['gm']),
  makeCategoryMenuCommand('download', ['dlmenu']),
  makeCategoryMenuCommand('sticker', ['smenu','stmenu']),
  makeCategoryMenuCommand('fun', ['fmenu']),
  makeCategoryMenuCommand('game', ['gmenu']),
  makeCategoryMenuCommand('anime', ['amenu']),
  makeCategoryMenuCommand('ai', ['aim']),
  makeCategoryMenuCommand('logo', ['lgmenu']),
  makeCategoryMenuCommand('voice', ['vmenu']),
  makeCategoryMenuCommand('image', ['imenu']),
  makeCategoryMenuCommand('media', ['medmenu']),
  makeCategoryMenuCommand('utility', ['umenu','utilmenu']),
  makeCategoryMenuCommand('religion', ['rmenu','islammenu']),
  makeCategoryMenuCommand('info', ['imenu2']),
  makeCategoryMenuCommand('text', ['tmenu']),
  makeCategoryMenuCommand('random', ['rdmenu']),
  makeCategoryMenuCommand('reaction', ['rcmenu']),
  makeCategoryMenuCommand('convert', ['cmenu']),
  makeCategoryMenuCommand('search', ['smenu2']),
  makeCategoryMenuCommand('database', ['dbmenu']),
  // ─── Channel info command ──────────────────────────────────
  {
    name: 'channel', alias: ['ch','newsletter'], category: 'main', desc: 'Show channel info',
    handler: async (ctx) => {
      const text = `╭━━❖ 📢 𝐎𝐅𝐅𝐈𝐂𝐈𝐀𝐋 𝐂𝐇𝐀𝐍𝐍𝐄𝐋 ❖━┈⊷
┃╭────────────────
┃│ ✓ ${config.BOT_CHANNEL_NAME}
┃│ 🆔 Channel ID: ${config.BOT_CHANNEL_ID}
┃│ 🆔 LID: ${config.BOT_CHANNEL_LID}
┃│ 🔗 ${config.BOT_CHANNEL_URL}
┃╰────────────────
╰━━━━━━━━━━━━━━━┈⊷

> Tap "View Channel" to open in WhatsApp

> ${config.BOT_FOOTER}`;
      await menu.sendVerifiedMenu(ctx.sock, ctx.jid, text, ctx.m);
    }
  },
  // ─── Mute channel command ──────────────────────────────────
  {
    name: 'mutechannel', alias: ['mutech'], category: 'main', desc: 'Mute the official channel',
    handler: async (ctx) => {
      try {
        // Try to mute the channel via Baileys
        await ctx.sock.newsletterMute(config.BOT_CHANNEL_JID);
        await ctx.reply(`✅ Channel muted: ${config.BOT_CHANNEL_NAME}`);
      } catch (e) {
        await ctx.reply(`⚠️ Could not mute channel automatically.\n\nManual: Open WhatsApp → Channels → ${config.BOT_CHANNEL_NAME} → Mute`);
      }
    }
  },
  // ─── Unmute channel ────────────────────────────────────────
  {
    name: 'unmutechannel', alias: ['unmutech'], category: 'main', desc: 'Unmute the channel',
    handler: async (ctx) => {
      try {
        await ctx.sock.newsletterUnmute(config.BOT_CHANNEL_JID);
        await ctx.reply(`✅ Channel unmuted: ${config.BOT_CHANNEL_NAME}`);
      } catch (e) {
        await ctx.reply(`⚠️ Could not unmute automatically.\n\nManual: Open WhatsApp → Channels → ${config.BOT_CHANNEL_NAME} → Unmute`);
      }
    }
  }
];
