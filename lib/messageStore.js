/**
 * Ulric-X MD - Message Store
 * Stores last 100 messages per chat for anti-delete / anti-edit recovery.
 */
const store = new Map();
const MAX_PER_CHAT = 100;

function storeMessage(jid, key, message) {
  if (!store.has(jid)) store.set(jid, new Map());
  const chat = store.get(jid);
  chat.set(key.id, {
    key,
    message,
    timestamp: Date.now(),
    sender: key.participant || key.remoteJid,
    text: extractText(message)
  });

  // Trim to last 100
  if (chat.size > MAX_PER_CHAT) {
    const oldest = [...chat.entries()][0];
    chat.delete(oldest[0]);
  }
}

function getMessage(jid, msgId) {
  return store.get(jid)?.get(msgId) || null;
}

function extractText(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  return '';
}

function clearChat(jid) {
  store.delete(jid);
}

function getStats() {
  let total = 0;
  for (const [, chat] of store) total += chat.size;
  return { chats: store.size, totalMessages: total };
}

module.exports = { storeMessage, getMessage, clearChat, getStats };
