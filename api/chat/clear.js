const { assertGithubConfig } = require('../_lib/github');
const { clearLog } = require('../_lib/telegram');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        assertGithubConfig();
        const { sessionId } = req.body || {};
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({ error: 'sessionId обязателен' });
        }
        await clearLog(sessionId);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
