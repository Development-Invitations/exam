const { verifyAdminPassword, listAccessCodes, createAccessCode, revokeAccessCode } = require('../_lib/admin');

module.exports = async (req, res) => {
    try {
        const password = req.headers['x-admin-password'];
        if (!(await verifyAdminPassword(password))) {
            return res.status(401).json({ error: 'Неверный пароль кабинета' });
        }

        if (req.method === 'GET') {
            const codes = await listAccessCodes();
            return res.status(200).json(codes);
        }

        if (req.method === 'POST') {
            const { template, label, expiresAt, days } = req.body || {};
            const entry = await createAccessCode({ template, label, expiresAt, days });
            return res.status(200).json(entry);
        }

        if (req.method === 'DELETE') {
            const { code } = req.query;
            if (!code) return res.status(400).json({ error: 'Код обязателен' });
            await revokeAccessCode(code);
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Метод не поддерживается' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
