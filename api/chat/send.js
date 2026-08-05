const { assertGithubConfig } = require('../_lib/github');
const { TELEGRAM_ADMIN_CHAT_ID, assertTelegramConfig, telegramApi, appendMessage, rememberMessageSession } = require('../_lib/telegram');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        assertTelegramConfig();
        assertGithubConfig();
        const { sessionId, text } = req.body || {};
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({ error: 'sessionId обязателен' });
        }
        const trimmed = String(text || '').trim();
        if (!trimmed) return res.status(400).json({ error: 'Пустое сообщение' });
        if (trimmed.length > 4000) return res.status(400).json({ error: 'Сообщение слишком длинное (макс. 4000 символов)' });

        const shortId = sessionId.slice(0, 8);
        const sent = await telegramApi('sendMessage', {
            chat_id: TELEGRAM_ADMIN_CHAT_ID,
            text: `💬 Вопрос с сайта [${shortId}]:\n\n${trimmed}`,
        });

        await rememberMessageSession(sent.message_id, sessionId);
        const { entry } = await appendMessage(sessionId, 'user', trimmed);

        return res.status(200).json({ success: true, entry });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
