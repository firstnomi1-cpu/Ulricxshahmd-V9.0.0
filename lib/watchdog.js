/**
 * Ulric-X MD - Watchdog / Stability Monitor
 *
 * 1. Tracks message processing time. If a command takes >30s, log warning.
 * 2. Tracks memory usage. If RSS > 500MB, force GC.
 * 3. Tracks last message processed timestamp. If no messages in 5 min AND
 *    no connections, restart bot.
 * 4. Wraps command handlers in try/catch with fallback reply.
 */
const config = require('../config');
const chalk = require('chalk');

let lastMessageAt = Date.now();
let commandsProcessed = 0;
let errorsCount = 0;
let startTime = Date.now();

function trackMessage() {
  lastMessageAt = Date.now();
}

function trackCommand() {
  commandsProcessed++;
}

function trackError() {
  errorsCount++;
}

function getStats() {
  return {
    uptime: Date.now() - startTime,
    commandsProcessed,
    errorsCount,
    lastMessageAgo: Date.now() - lastMessageAt,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  };
}

/**
 * Wrap a command handler with try/catch + fallback reply.
 */
function safeHandler(handler) {
  return async (ctx) => {
    try {
      // Set 30s timeout for command
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Command timeout (30s)')), 30000);
      });
      await Promise.race([handler(ctx), timeoutPromise]);
    } catch (e) {
      trackError();
      console.error(chalk.red(`[SAFE] ${ctx.command}: ${e.message}`));
      try {
        await ctx.reply(`⚠️ System busy, retry...\n\nError: ${e.message.slice(0, 100)}`);
      } catch {}
    }
  };
}

/**
 * Memory check - if RSS > 400MB, force garbage collection.
 */
function checkMemory() {
  const mem = process.memoryUsage();
  const rssMB = mem.rss / 1024 / 1024;
  if (rssMB > 400) {
    console.log(chalk.yellow(`[WATCHDOG] High memory: ${Math.round(rssMB)}MB, forcing GC`));
    if (global.gc) {
      global.gc();
      console.log(chalk.green('[WATCHDOG] GC done'));
    } else {
      console.log(chalk.yellow('[WATCHDOG] GC not available (run with --expose-gc)'));
    }
  }
  return rssMB;
}

/**
 * Start watchdog interval.
 */
function startWatchdog(pairMgr) {
  setInterval(() => {
    try {
      const stats = getStats();
      const mem = checkMemory();

      // Log stats every 5 minutes
      console.log(chalk.gray(`[WATCHDOG] up=${Math.round(stats.uptime/1000)}s | cmds=${stats.commandsProcessed} | errs=${stats.errorsCount} | mem=${Math.round(mem)}MB | lastMsg=${Math.round(stats.lastMessageAgo/1000)}s ago`));

      // If no messages in 10 minutes AND no active connections, something is wrong
      const conns = pairMgr.getAllConnections();
      const activeConns = conns.filter(c => c.status === 'open');
      if (stats.lastMessageAgo > 10 * 60 * 1000 && activeConns.length === 0 && conns.length > 0) {
        console.log(chalk.red('[WATCHDOG] ⚠️ No messages in 10min and no active connections. Forcing reconnect...'));
        // Try to reconnect all
        for (const conn of conns) {
          try {
            require('../pair').startConnection(conn.jid).catch(() => {});
          } catch {}
        }
      }
    } catch (e) {
      console.error(chalk.red('[WATCHDOG] Error: ' + e.message));
    }
  }, 5 * 60 * 1000);  // Every 5 minutes
}

module.exports = {
  trackMessage,
  trackCommand,
  trackError,
  getStats,
  safeHandler,
  checkMemory,
  startWatchdog
};
