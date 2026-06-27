/**
 * Ulric-X MD - Command Audit Script
 * Loads every command file, reports any errors, and validates structure.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'commands');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

let totalCommands = 0;
let totalLoaded = 0;
let totalFailed = 0;
let failedList = [];
let loadedList = [];
let allCommands = new Map();
let allCategories = new Map();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  ULRIC-X MD - COMMAND AUDIT');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log(`Scanning ${files.length} command files...\n`);

for (const f of files) {
  const filePath = path.join(dir, f);
  try {
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);

    if (!Array.isArray(mod)) {
      failedList.push({ file: f, reason: 'Module is not an array', count: 0 });
      totalFailed++;
      continue;
    }

    let fileLoaded = 0;
    let fileFailed = 0;

    for (const cmd of mod) {
      totalCommands++;
      // Validate structure
      if (!cmd || typeof cmd !== 'object') {
        failedList.push({ file: f, reason: 'Command is not an object', name: '?' });
        totalFailed++;
        fileFailed++;
        continue;
      }
      if (!cmd.name || typeof cmd.name !== 'string') {
        failedList.push({ file: f, reason: 'Missing name', name: cmd.name });
        totalFailed++;
        fileFailed++;
        continue;
      }
      if (typeof cmd.handler !== 'function') {
        failedList.push({ file: f, reason: 'Missing/invalid handler', name: cmd.name });
        totalFailed++;
        fileFailed++;
        continue;
      }

      // Test handler is callable
      try {
        if (cmd.handler.constructor.name !== 'AsyncFunction' && typeof cmd.handler !== 'function') {
          throw new Error('Handler not callable');
        }
      } catch (e) {
        failedList.push({ file: f, reason: 'Handler not callable: ' + e.message, name: cmd.name });
        totalFailed++;
        fileFailed++;
        continue;
      }

      // Register
      const names = [cmd.name, ...(cmd.alias || [])].map(s => String(s).toLowerCase());
      for (const n of names) {
        if (!allCommands.has(n)) allCommands.set(n, { ...cmd, file: f });
      }
      const cat = cmd.category || 'misc';
      if (!allCategories.has(cat)) allCategories.set(cat, []);
      allCategories.get(cat).push({ ...cmd, file: f });

      totalLoaded++;
      fileLoaded++;
    }

    console.log(`✅ ${f}: ${fileLoaded} loaded${fileFailed > 0 ? `, ${fileFailed} failed` : ''}`);
  } catch (e) {
    failedList.push({ file: f, reason: 'LOAD ERROR: ' + e.message, count: 0 });
    totalFailed++;
    console.log(`❌ ${f}: LOAD ERROR - ${e.message}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  AUDIT REPORT');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log(`Total commands defined: ${totalCommands}`);
console.log(`✅ Successfully loaded:  ${totalLoaded}`);
console.log(`❌ Failed to load:       ${totalFailed}`);
console.log(`📂 Categories:           ${allCategories.size}`);
console.log(`🔗 Unique names+aliases: ${allCommands.size}\n`);

console.log('Category breakdown:');
for (const [cat, cmds] of allCategories) {
  console.log(`  ${cat.padEnd(12)} ${cmds.length} commands`);
}

if (failedList.length > 0) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FAILED COMMANDS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  for (const f of failedList) {
    console.log(`❌ ${f.file}${f.name ? ` → ${f.name}` : ''}: ${f.reason}`);
  }
} else {
  console.log('\n✅ ALL COMMANDS LOADED SUCCESSFULLY — no failures');
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
