// Отдаёт скриншот из GitHub через сервер (не напрямую с raw.githubusercontent.com),
// поэтому картинки продолжают открываться даже если репозиторий приватный —
// сервер обращается к GitHub со своим токеном, вне зависимости от видимости репо.
const { assertGithubConfig, getBinaryFile } = require('./_lib/github');

// Пускаем только наши собственные папки со скриншотами — иначе через ?path=
// можно было бы читать произвольные файлы репозитория (например api/_lib/*).
const ALLOWED_PATH = /^(screenshots|chat-screenshots)\/[a-zA-Z0-9_.-]+$/;

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
        const { path } = req.query;
        if (!path || typeof path !== 'string' || !ALLOWED_PATH.test(path)) {
            return res.status(400).json({ error: 'Некорректный путь к файлу' });
        }

        const buffer = await getBinaryFile(path);
        if (!buffer) return res.status(404).json({ error: 'Файл не найден' });

        const ext = path.split('.').pop().toLowerCase();
        res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
        // Имя файла содержит случайную часть — можно кэшировать надолго и на клиенте, и на CDN.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.status(200).send(buffer);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
