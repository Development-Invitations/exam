// Отдаёт скриншот или прикреплённый файл из GitHub через сервер (не
// напрямую с raw.githubusercontent.com), поэтому файлы продолжают
// открываться даже если репозиторий приватный — сервер обращается к
// GitHub со своим токеном, вне зависимости от видимости репо.
//
// Раздача файлов из files/ (произвольные вложения) специально объединена
// в эту же функцию, а не вынесена в отдельный api/file.js — на Vercel
// Hobby-плане жёсткий лимит 12 serverless-функций в /api/, и отдельный
// файл на каждый новый эндпоинт быстро в него упирается.
const { assertGithubConfig, getBinaryFile } = require('./_lib/github');

// Пускаем только наши собственные папки — иначе через ?path= можно было
// бы читать произвольные файлы репозитория (например api/_lib/*).
const ALLOWED_PATH = /^(screenshots|chat-screenshots|files)\/[a-zA-Z0-9_.-]+$/;

const MIME_BY_EXT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).end();
    try {
        assertGithubConfig();
        const { path, name } = req.query;
        if (!path || typeof path !== 'string' || !ALLOWED_PATH.test(path)) {
            return res.status(400).json({ error: 'Некорректный путь к файлу' });
        }

        const buffer = await getBinaryFile(path);
        if (!buffer) return res.status(404).json({ error: 'Файл не найден' });

        if (path.startsWith('files/')) {
            // Произвольное вложение — всегда как файл для скачивания, а не для
            // отображения в браузере (иначе .html/.svg и т.п. могли бы
            // выполниться как активный контент прямо по прямой ссылке).
            const displayName = (typeof name === 'string' && name.trim()) ? name.trim() : path.split('/').pop();
            const asciiFallback = displayName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(displayName)}`
            );
        } else {
            const ext = path.split('.').pop().toLowerCase();
            res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
        }
        // Имя файла содержит случайную часть — можно кэшировать надолго и на клиенте, и на CDN.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.status(200).send(buffer);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
