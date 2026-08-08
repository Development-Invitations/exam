const { assertGithubConfig, putBinaryFile, getImageUrl } = require('../_lib/github');
const { verifyAdminPassword } = require('../_lib/admin');

const SCREENSHOTS_DIR = 'screenshots';
const MAX_BYTES = 5 * 1024 * 1024; // 5 МБ — с запасом хватает для скриншота

function extFromMime(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    return null;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        assertGithubConfig();
        const password = req.headers['x-admin-password'];
        if (!(await verifyAdminPassword(password))) {
            return res.status(401).json({ error: 'Неверный пароль кабинета' });
        }

        const { imageDataUrl } = req.body || {};
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(imageDataUrl || '');
        if (!match) return res.status(400).json({ error: 'Ожидается изображение (PNG/JPEG/WEBP/GIF) в виде data URL' });

        const [, mime, base64] = match;
        const ext = extFromMime(mime);
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > MAX_BYTES) {
            return res.status(400).json({ error: `Файл слишком большой (макс. ${MAX_BYTES / 1024 / 1024} МБ)` });
        }

        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const path = `${SCREENSHOTS_DIR}/${filename}`;

        await putBinaryFile(path, base64, `Кабинет: загрузка скриншота ${filename}`);

        return res.status(200).json({ success: true, url: getImageUrl(path), path });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
