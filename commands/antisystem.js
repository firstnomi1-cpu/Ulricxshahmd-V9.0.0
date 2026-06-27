/**
 * Ulric-X MD - Anti-System Commands
 * .anti mode on             → enable ALL anti features (delete + edit) in public mode
 * .anti mode off            → disable ALL anti features
 * .anti delete on pm        → anti-delete → forward to owner PM
 * .anti delete on public    → anti-delete → show in same chat
 * .anti delete off          → disable anti-delete
 * .anti edit on pm          → anti-edit → forward to owner PM
 * .anti edit on public      → anti-edit → show in same chat
 * .anti edit off            → disable anti-edit
 * .anti status              → show current anti settings
 */
const antiSystem = require('../lib/antiSystem');

module.exports = [
  {
    name: 'anti', alias: ['antisystem'], category: 'owner', desc: 'Anti-delete + anti-edit control',
    handler: async (ctx) => {
      if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply('❌ Admin only');
      const sub = (ctx.args[0] || '').toLowerCase();
      const mode = (ctx.args[1] || '').toLowerCase();
      const target = (ctx.args[2] || '').toLowerCase();

      // .anti mode on / off
      if (sub === 'mode') {
        if (mode === 'on') {
          antiSystem.setModeAll(ctx.jid, 'public');
          return ctx.reply(`╭━━❖ 🛡️ 𝐀𝐍𝐓𝐈 𝐒𝐘𝐒𝐓𝐄𝐌 ❖━┈⊷
┃
┃ ✅ ALL anti features ENABLED
┃ • Anti-delete: PUBLIC (same chat)
┃ • Anti-edit:   PUBLIC (same chat)
┃ • View-once protection: ON
┃
╰━━━━━━━━━━━━━━━┈⊷`);
        } else if (mode === 'off') {
          antiSystem.setModeAll(ctx.jid, 'off');
          return ctx.reply(`╭━━❖ 🛡️ 𝐀𝐍𝐓𝐈 𝐒𝐘𝐒𝐓𝐄𝐌 ❖━┈⊷
┃
┃ ❌ ALL anti features DISABLED
┃
╰━━━━━━━━━━━━━━━┈⊷`);
        }
      }

      // .anti delete on pm / public / off
      if (sub === 'delete') {
        if (mode === 'on' && (target === 'pm' || target === 'public')) {
          antiSystem.setDeleteMode(ctx.jid, target);
          return ctx.reply(`✅ Anti-delete: ON (${target.toUpperCase()})
📨 Deleted messages will be sent to ${target === 'pm' ? 'your PM' : 'the same chat'}.`);
        } else if (mode === 'off') {
          antiSystem.setDeleteMode(ctx.jid, 'off');
          return ctx.reply('❌ Anti-delete: OFF');
        }
      }

      // .anti edit on pm / public / off
      if (sub === 'edit') {
        if (mode === 'on' && (target === 'pm' || target === 'public')) {
          antiSystem.setEditMode(ctx.jid, target);
          return ctx.reply(`✅ Anti-edit: ON (${target.toUpperCase()})
📝 Edited messages' originals will be sent to ${target === 'pm' ? 'your PM' : 'the same chat'}.`);
        } else if (mode === 'off') {
          antiSystem.setEditMode(ctx.jid, 'off');
          return ctx.reply('❌ Anti-edit: OFF');
        }
      }

      // .anti status
      if (sub === 'status' || sub === 'info') {
        const s = antiSystem.getStatus(ctx.jid);
        return ctx.reply(`╭━━❖ 🛡️ 𝐀𝐍𝐓𝐈 𝐒𝐓𝐀𝐓𝐔𝐒 ❖━┈⊷
┃
┃ Chat: ${ctx.jid}
┃ • Anti-delete: ${s.delete.toUpperCase()}
┃ • Anti-edit:   ${s.edit.toUpperCase()}
┃
┃ Commands:
┃ • .anti mode on/off
┃ • .anti delete on pm/public
┃ • .anti delete off
┃ • .anti edit on pm/public
┃ • .anti edit off
┃
╰━━━━━━━━━━━━━━━┈⊷`);
      }

      // Help
      return ctx.reply(`╭━━❖ 🛡️ 𝐀𝐍𝐓𝐈 𝐒𝐘𝐒𝐓𝐄𝐌 ❖━┈⊷
┃
┃ 📌 MASTER CONTROL:
┃ • .anti mode on    → enable all (public)
┃ • .anti mode off   → disable all
┃
┃ 🗑️ ANTI-DELETE:
┃ • .anti delete on pm       → send to PM
┃ • .anti delete on public   → show in chat
┃ • .anti delete off
┃
┃ ✏️ ANTI-EDIT:
┃ • .anti edit on pm         → send to PM
┃ • .anti edit on public     → show in chat
┃ • .anti edit off
┃
┃ ℹ️ .anti status            → show settings
┃
╰━━━━━━━━━━━━━━━┈⊷`);
    }
  }
];
