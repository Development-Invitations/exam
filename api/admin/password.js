const { verifyAdminPassword, setAdminPassword } = require('../_lib/admin');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (!(await verifyAdminPassword(currentPassword))) {
            return res.status(401).json({ error: 'Текущий пароль неверен' });
        }
        await setAdminPassword(newPassword);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
