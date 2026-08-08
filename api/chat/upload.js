// Публичная загрузка скриншота для виджета чата — паролем НЕ гейтится
// (чат доступен всем посетителям, как и отправка текстовых сообщений).
const { assertGithubConfig, putBinaryFile, getImageUrl } = require('../_lib/github');

const CHAT_SCREENSHOTS_DIR = 'chat-screenshots';
const MAX_BYTES = 5 * 1024 * 1024;

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
        const { imageDataUrl } = req.body || {};
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(imageDataUrl || '');
        if (!match) return res.status(400).json({ error: 'Ожидается изображение (PNG/JPEG/WEBP/GIF)' });

        const [, mime, base64] = match;
        const ext = extFromMime(mime);
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > MAX_BYTES) {
            return res.status(400).json({ error: `Файл слишком большой (макс. ${MAX_BYTES / 1024 / 1024} МБ)` });
        }

        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const path = `${CHAT_SCREENSHOTS_DIR}/${filename}`;
        await putBinaryFile(path, base64, `Чат: скриншот ${filename}`);

        return res.status(200).json({ url: getImageUrl(path) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
