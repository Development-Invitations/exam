const { assertGithubConfig, normalizeImageUrl } = require('../_lib/github');
const { getLog } = require('../_lib/telegram');

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        assertGithubConfig();
        const { sessionId } = req.query;
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({ error: 'sessionId обязателен' });
        }
        const messages = (await getLog(sessionId)).map(m =>
            m.imageUrl ? { ...m, imageUrl: normalizeImageUrl(m.imageUrl) } : m
        );
        return res.status(200).json({ messages });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
