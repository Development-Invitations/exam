const { verifyAdminPassword } = require('../_lib/admin');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        const { password } = req.body || {};
        const ok = await verifyAdminPassword(password);
        if (!ok) return res.status(401).json({ error: 'Неверный пароль' });
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
