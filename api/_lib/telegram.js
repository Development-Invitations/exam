// Общие хелперы для Telegram-виджета. Секреты — только из переменных окружения Vercel.
// Хранилище переписки — тот же GitHub-репозиторий (переиспользуем уже настроенный
// GITHUB_TOKEN), отдельная папка chat-sessions/, чтобы не заводить ещё один сервис.

const { getJson, updateJson, deleteFile, getFile } = require('./github');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const TELEGRAM_ALLOWED_IDS = String(process.env.TELEGRAM_ALLOWED_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const CHAT_DIR = 'chat-sessions';
const MSG_MAP_PATH = `${CHAT_DIR}/_msgmap.json`;
const LAST_SESSION_PATH = `${CHAT_DIR}/_last-session.json`;
const MAX_MESSAGES = 100;
const MSG_MAP_MAX_ENTRIES = 50;

function assertTelegramConfig() {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
        throw new Error('Telegram-чат не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_ADMIN_CHAT_ID в переменных окружения Vercel');
    }
}

async function telegramApi(method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram API (${method}): ${json.description || res.status}`);
    return json.result;
}

function sessionLogPath(sessionId) {
    // sessionId генерируется клиентом как UUID/случайная строка — на всякий случай
    // защищаемся от путей вида "../.." при формировании имени файла.
    const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '');
    return `${CHAT_DIR}/${safe}.json`;
}

async function appendMessage(sessionId, from, text) {
    const path = sessionLogPath(sessionId);
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, from, text, ts: Date.now() };
    const newLog = await updateJson(
        path, [],
        log => [...(Array.isArray(log) ? log : []), entry].slice(-MAX_MESSAGES),
        `Чат [${sessionId.slice(0, 8)}]: сообщение от ${from}`
    );
    return { entry, newLog };
}

async function getLog(sessionId) {
    const { data } = await getJson(sessionLogPath(sessionId), []);
    return Array.isArray(data) ? data : [];
}

async function clearLog(sessionId) {
    const file = await getFile(sessionLogPath(sessionId));
    if (file) await deleteFile(sessionLogPath(sessionId), `Чат [${sessionId.slice(0, 8)}]: очистка`, file.sha);
}

// Сопоставление message_id (в Telegram) -> sessionId, чтобы понимать, кому
// адресован ответ администратора, если он использует "Reply" в Telegram.
async function rememberMessageSession(telegramMessageId, sessionId) {
    await updateJson(
        MSG_MAP_PATH, {},
        map => {
            const entries = Object.entries(map).slice(-(MSG_MAP_MAX_ENTRIES - 1));
            entries.push([String(telegramMessageId), { sessionId, ts: Date.now() }]);
            return Object.fromEntries(entries);
        },
        `Чат: привязка сообщения ${telegramMessageId} к сессии`
    );
    await updateJson(LAST_SESSION_PATH, {}, () => ({ sessionId, ts: Date.now() }), 'Чат: последняя активная сессия');
}

async function resolveSessionForReply(update) {
    const replyTo = update.message && update.message.reply_to_message;
    if (replyTo) {
        const { data: map } = await getJson(MSG_MAP_PATH, {});
        const found = map[String(replyTo.message_id)];
        if (found) return found.sessionId;
    }
    const { data: last } = await getJson(LAST_SESSION_PATH, {});
    return last.sessionId || null;
}

function isAllowedTelegramUser(userId) {
    return TELEGRAM_ALLOWED_IDS.includes(String(userId));
}

module.exports = {
    TELEGRAM_ADMIN_CHAT_ID,
    assertTelegramConfig,
    telegramApi,
    appendMessage,
    getLog,
    clearLog,
    rememberMessageSession,
    resolveSessionForReply,
    isAllowedTelegramUser,
};
