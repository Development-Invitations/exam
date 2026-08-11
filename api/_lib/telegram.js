// Общие хелперы для Telegram-виджета. Секреты — только из переменных окружения Vercel.
// Хранилище переписки — тот же GitHub-репозиторий (переиспользуем уже настроенный
// GITHUB_TOKEN), отдельная папка chat-sessions/, чтобы не заводить ещё один сервис.

const { getJson, updateJson, deleteFile, getFile } = require('./github');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ALLOWED_IDS = String(process.env.TELEGRAM_ALLOWED_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// Поддерживаем несколько получателей: TELEGRAM_ADMIN_CHAT_ID,
// TELEGRAM_ADMIN_CHAT_ID_2, TELEGRAM_ADMIN_CHAT_ID_3, ... — вопрос с сайта
// уходит во все сразу (личка нескольким людям или, лучше, ID группы —
// см. рекомендацию в чате).
function getAdminChatIds() {
    const ids = [];
    if (process.env.TELEGRAM_ADMIN_CHAT_ID) ids.push(process.env.TELEGRAM_ADMIN_CHAT_ID);
    for (let i = 2; i <= 10; i++) {
        const v = process.env[`TELEGRAM_ADMIN_CHAT_ID_${i}`];
        if (v) ids.push(v);
    }
    return ids;
}

const CHAT_DIR = 'chat-sessions';
const MSG_MAP_PATH = `${CHAT_DIR}/_msgmap.json`;
const LAST_SESSION_PATH = `${CHAT_DIR}/_last-session.json`;
const PROCESSED_UPDATES_PATH = `${CHAT_DIR}/_processed-updates.json`;
const MAX_MESSAGES = 100;
const MSG_MAP_MAX_ENTRIES = 100;
const PROCESSED_UPDATES_MAX_ENTRIES = 200;

function assertTelegramConfig() {
    if (!TELEGRAM_BOT_TOKEN || getAdminChatIds().length === 0) {
        throw new Error('Telegram-чат не настроен: задайте TELEGRAM_BOT_TOKEN и хотя бы TELEGRAM_ADMIN_CHAT_ID в переменных окружения Vercel');
    }
}

async function getTelegramFileUrl(fileId) {
    const file = await telegramApi('getFile', { file_id: fileId });
    return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
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

async function appendMessage(sessionId, from, text, authorName, imageUrl) {
    const path = sessionLogPath(sessionId);
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from, text: text || '', ts: Date.now(),
        ...(authorName ? { authorName } : {}),
        ...(imageUrl ? { imageUrl } : {}),
    };
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

// Сопоставление "chatId:messageId" (в Telegram) -> sessionId, чтобы понимать,
// кому адресован ответ, если администратор использует "Reply" в Telegram.
// chatId нужен в ключе, т.к. message_id уникален только в рамках одного чата —
// у разных получателей (при рассылке в несколько чатов) он может совпасть.
function mapKey(chatId, messageId) {
    return `${chatId}:${messageId}`;
}

// Принимает массив { chatId, messageId } — одним запросом к GitHub записывает
// привязку сразу для всех получателей (иначе рассылка в N чатов означала бы
// N последовательных чтений/записей одного и того же файла и заметно тормозила
// бы отправку сообщения из виджета).
async function rememberMessageSessions(pairs, sessionId) {
    if (pairs.length === 0) return;
    await Promise.all([
        updateJson(
            MSG_MAP_PATH, {},
            map => {
                const entries = Object.entries(map).slice(-(MSG_MAP_MAX_ENTRIES - pairs.length));
                pairs.forEach(({ chatId, messageId }) => {
                    entries.push([mapKey(chatId, messageId), { sessionId, ts: Date.now() }]);
                });
                return Object.fromEntries(entries);
            },
            `Чат: привязка сообщений к сессии ${sessionId.slice(0, 8)}`
        ),
        updateJson(LAST_SESSION_PATH, {}, () => ({ sessionId, ts: Date.now() }), 'Чат: последняя активная сессия'),
    ]);
}

async function resolveSessionForReply(update) {
    const msg = update.message;
    const replyTo = msg && msg.reply_to_message;
    if (replyTo && msg.chat) {
        const { data: map } = await getJson(MSG_MAP_PATH, {});
        const found = map[mapKey(msg.chat.id, replyTo.message_id)];
        if (found) return found.sessionId;
    }
    const { data: last } = await getJson(LAST_SESSION_PATH, {});
    return last.sessionId || null;
}

// Telegram гарантирует лишь доставку "как минимум один раз": если наш
// вебхук не ответил достаточно быстро, тот же самый update присылается
// повторно. Раньше это приводило к задвоению ответа администратора в чате
// на сайте. Запоминаем обработанные update_id и пропускаем повторные —
// возвращает true, если update новый (и его нужно обработать), false —
// если уже обрабатывали.
async function claimUpdate(updateId) {
    if (updateId === undefined || updateId === null) return true;
    const { data } = await getJson(PROCESSED_UPDATES_PATH, []);
    const seen = Array.isArray(data) ? data : [];
    if (seen.includes(updateId)) return false;
    await updateJson(
        PROCESSED_UPDATES_PATH, [],
        arr => {
            const trimmed = (Array.isArray(arr) ? arr : []).slice(-(PROCESSED_UPDATES_MAX_ENTRIES - 1));
            return trimmed.includes(updateId) ? trimmed : [...trimmed, updateId];
        },
        `Чат: отметка обработанного Telegram-update ${updateId}`
    );
    return true;
}

function isAllowedTelegramUser(userId) {
    return TELEGRAM_ALLOWED_IDS.includes(String(userId));
}

function telegramDisplayName(from) {
    if (!from) return 'Аноним';
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
    return name || (from.username ? '@' + from.username : 'Аноним');
}

module.exports = {
    getAdminChatIds,
    assertTelegramConfig,
    telegramApi,
    appendMessage,
    getLog,
    clearLog,
    rememberMessageSessions,
    resolveSessionForReply,
    claimUpdate,
    isAllowedTelegramUser,
    telegramDisplayName,
    getTelegramFileUrl,
};
