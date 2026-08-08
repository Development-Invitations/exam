const { assertGithubConfig } = require('../_lib/github');
const { getAdminChatIds, assertTelegramConfig, telegramApi, appendMessage, rememberMessageSessions } = require('../_lib/telegram');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        assertTelegramConfig();
        assertGithubConfig();
        const { sessionId, text, imageUrl } = req.body || {};
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({ error: 'sessionId обязателен' });
        }
        const trimmed = String(text || '').trim();
        if (!trimmed && !imageUrl) return res.status(400).json({ error: 'Пустое сообщение' });
        if (trimmed.length > 4000) return res.status(400).json({ error: 'Сообщение слишком длинное (макс. 4000 символов)' });

        const shortId = sessionId.slice(0, 8);
        const adminChatIds = getAdminChatIds();
        const caption = trimmed
            ? `💬 Вопрос с сайта [${shortId}]:\n\n${trimmed}`
            : `💬 Скриншот от посетителя [${shortId}]`;

        // Рассылаем во все настроенные чаты (несколько личных чатов или ID группы)
        // и одновременно пишем свою же реплику в лог — параллельно, а не по очереди,
        // чтобы не копить задержку на каждый лишний чат/GitHub-запрос.
        const [results, { entry }] = await Promise.all([
            Promise.allSettled(
                adminChatIds.map(chatId => imageUrl
                    ? telegramApi('sendPhoto', { chat_id: chatId, photo: imageUrl, caption })
                    : telegramApi('sendMessage', { chat_id: chatId, text: caption }))
            ),
            appendMessage(sessionId, 'user', trimmed, null, imageUrl || undefined),
        ]);

        const pairs = [];
        let delivered = 0;
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
                delivered++;
                pairs.push({ chatId: adminChatIds[i], messageId: r.value.message_id });
            } else {
                console.error(`Не удалось отправить в чат ${adminChatIds[i]}:`, r.reason && r.reason.message);
            }
        });
        if (delivered === 0) {
            throw new Error('Не удалось доставить сообщение ни в один Telegram-чат: ' + (results[0].reason && results[0].reason.message));
        }

        // Привязка message_id -> сессия нужна только для маршрутизации ответа
        // администратора — это вспомогательная запись, а не сама отправка.
        // Сбой здесь не должен превращать реально доставленное сообщение
        // в ошибку на стороне сайта.
        try {
            await rememberMessageSessions(pairs, sessionId);
        } catch (err) {
            console.error('Не удалось сохранить привязку сессии (не критично):', err.message);
        }

        return res.status(200).json({ success: true, entry });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
