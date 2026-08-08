// Telegram вызывает этот URL при каждом новом сообщении в чате с ботом
// (регистрируется один раз через setWebhook, см. инструкцию в README/чате).
const { assertGithubConfig } = require('./_lib/github');
const { appendMessage, resolveSessionForReply, isAllowedTelegramUser, telegramDisplayName, getTelegramFileUrl } = require('./_lib/telegram');

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();

    // Защита от подделанных запросов — Telegram присылает этот заголовок,
    // только если он задан при вызове setWebhook с тем же secret_token.
    if (WEBHOOK_SECRET) {
        const incoming = req.headers['x-telegram-bot-api-secret-token'];
        if (incoming !== WEBHOOK_SECRET) {
            // Безопасный отпечаток в СЕРВЕРНЫЙ лог (не в ответ Telegram) — длины
            // и первые символы, не сами секреты целиком. Чтобы наконец увидеть,
            // что сервер реально сравнивает, вместо гадания вслепую.
            console.warn('Webhook secret mismatch:', {
                incomingPresent: incoming !== undefined,
                incomingLength: incoming ? incoming.length : 0,
                incomingPrefix: incoming ? incoming.slice(0, 3) : null,
                expectedLength: WEBHOOK_SECRET.length,
                expectedPrefix: WEBHOOK_SECRET.slice(0, 3),
            });
            return res.status(401).end();
        }
    }

    try {
        assertGithubConfig();
        const update = req.body || {};
        const message = update.message;
        if (!message || !message.from || (!message.text && !message.photo)) {
            return res.status(200).end(); // нечего обрабатывать, но Telegram ждёт 200
        }

        if (!isAllowedTelegramUser(message.from.id)) {
            console.warn('Отклонено сообщение от неразрешённого Telegram ID:', message.from.id);
            return res.status(200).end();
        }

        const sessionId = await resolveSessionForReply(update);
        if (!sessionId) {
            return res.status(200).end(); // некому маршрутизировать ответ
        }

        const authorName = telegramDisplayName(message.from);
        if (message.photo && message.photo.length > 0) {
            // Telegram присылает несколько размеров одного фото — берём самое крупное
            const largest = message.photo[message.photo.length - 1];
            const imageUrl = await getTelegramFileUrl(largest.file_id);
            await appendMessage(sessionId, 'admin', message.caption || '', authorName, imageUrl);
        } else {
            await appendMessage(sessionId, 'admin', message.text, authorName);
        }
        return res.status(200).end();
    } catch (err) {
        console.error(err);
        return res.status(200).end(); // Telegram ретраит на не-2xx — гасим, чтобы не спамило
    }
};
