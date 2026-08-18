// Отдаёт прикреплённый файл любого типа из GitHub через сервер — как
// вложение для скачивания, а не для отображения в браузере (в отличие
// от api/image.js). Всегда application/octet-stream + Content-Disposition:
// attachment, даже для .html/.svg и т.п. — иначе такой файл мог бы
// выполниться как активный контент прямо в браузере при открытии ссылки.
const { assertGithubConfig, getBinaryFile } = require('./_lib/github');

// Пускаем только собственную папку files/ — как и в api/image.js, чтобы
// через ?path= нельзя было прочитать произвольный файл репозитория.
const ALLOWED_PATH = /^files\/[a-zA-Z0-9_.-]+$/;

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

        const displayName = (typeof name === 'string' && name.trim()) ? name.trim() : path.split('/').pop();
        const asciiFallback = displayName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(displayName)}`
        );
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.status(200).send(buffer);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
