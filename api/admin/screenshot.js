// Загрузка скриншота ИЛИ произвольного файла-вложения из кабинета —
// объединены в одну функцию (а не в отдельные screenshot.js/file.js),
// т.к. на Vercel Hobby-плане жёсткий лимит 12 serverless-функций в /api/.
const { assertGithubConfig, putBinaryFile, getImageUrl } = require('../_lib/github');
const { verifyAdminPassword } = require('../_lib/admin');

const SCREENSHOTS_DIR = 'screenshots';
const FILES_DIR = 'files';
// Vercel Serverless Functions режут тело запроса на уровне платформы —
// жёсткий лимит 4.5 МБ, не настраивается даже на платных планах. Base64
// раздувает исходный файл примерно в 1.33 раза, плюс небольшой отступ на
// служебные поля JSON — отсюда границы ниже (иначе сервер отвечает 413
// ещё до того, как код функции вообще запустится).
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 МБ исходного файла ≈ 4 МБ в base64
const MAX_FILE_BYTES = 3 * 1024 * 1024;

function extFromMime(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    return null;
}

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

        const { imageDataUrl, fileDataUrl, filename } = req.body || {};

        if (imageDataUrl) {
            const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(imageDataUrl);
            if (!match) return res.status(400).json({ error: 'Ожидается изображение (PNG/JPEG/WEBP/GIF) в виде data URL' });

            const [, mime, base64] = match;
            const ext = extFromMime(mime);
            const buffer = Buffer.from(base64, 'base64');
            if (buffer.length > MAX_IMAGE_BYTES) {
                return res.status(400).json({ error: `Файл слишком большой (макс. ${MAX_IMAGE_BYTES / 1024 / 1024} МБ)` });
            }

            const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const path = `${SCREENSHOTS_DIR}/${fname}`;
            await putBinaryFile(path, base64, `Кабинет: загрузка скриншота ${fname}`);
            return res.status(200).json({ success: true, url: getImageUrl(path), path });
        }

        if (fileDataUrl) {
            const match = /^data:([^;]*);base64,(.+)$/.exec(fileDataUrl);
            if (!match) return res.status(400).json({ error: 'Некорректный файл' });

            const [, , base64] = match;
            const buffer = Buffer.from(base64, 'base64');
            if (buffer.length > MAX_FILE_BYTES) {
                return res.status(400).json({ error: `Файл слишком большой (макс. ${MAX_FILE_BYTES / 1024 / 1024} МБ)` });
            }

            const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeStorageName(filename)}`;
            const path = `${FILES_DIR}/${storedName}`;
            await putBinaryFile(path, base64, `Кабинет: загрузка файла ${storedName}`);

            const displayName = String(filename || storedName).slice(0, 200);
            const url = `${getImageUrl(path)}&name=${encodeURIComponent(displayName)}`;
            return res.status(200).json({ success: true, url, name: displayName, size: buffer.length });
        }

        return res.status(400).json({ error: 'Не передан файл' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
