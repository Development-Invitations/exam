// Загрузка произвольного файла (не только изображения) как вложения к
// вопросу — только из кабинета, доступно на скачивание через api/file.js.
const { assertGithubConfig, putBinaryFile } = require('../_lib/github');
const { verifyAdminPassword } = require('../_lib/admin');

const FILES_DIR = 'files';
const MAX_BYTES = 20 * 1024 * 1024; // 20 МБ — предел GitHub Contents API на файл через base64

// Имя на диске (в репозитории) должно быть безопасно для Windows/URL —
// оригинальное имя пользователя может содержать что угодно (те же
// проблемы, что были с ":" в названии раздела). Показывать пользователю
// при скачивании будем настоящее имя — оно передаётся отдельно через
// параметр "name" в ссылке, само хранение это не затрагивает.
function sanitizeStorageName(name) {
    const base = String(name || 'file').split('/').pop().split('\\').pop();
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return (safe || 'file').slice(-80);
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        assertGithubConfig();
        const password = req.headers['x-admin-password'];
        if (!(await verifyAdminPassword(password))) {
            return res.status(401).json({ error: 'Неверный пароль кабинета' });
        }

        const { fileDataUrl, filename } = req.body || {};
        const match = /^data:([^;]*);base64,(.+)$/.exec(fileDataUrl || '');
        if (!match) return res.status(400).json({ error: 'Некорректный файл' });

        const [, , base64] = match;
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > MAX_BYTES) {
            return res.status(400).json({ error: `Файл слишком большой (макс. ${MAX_BYTES / 1024 / 1024} МБ)` });
        }

        const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeStorageName(filename)}`;
        const path = `${FILES_DIR}/${storedName}`;
        await putBinaryFile(path, base64, `Кабинет: загрузка файла ${storedName}`);

        const displayName = String(filename || storedName).slice(0, 200);
        const url = `/api/file?path=${encodeURIComponent(path)}&name=${encodeURIComponent(displayName)}`;
        return res.status(200).json({ success: true, url, name: displayName, size: buffer.length });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
