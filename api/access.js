// Публичный эндпоинт для посетителя с временным кодом доступа. Никакого
// пароля кабинета тут не нужно — только код, который выдал администратор
// на конкретный шаблон и ограниченный срок.
const { assertGithubConfig, getFile, normalizeImageUrl } = require('./_lib/github');
const { validateAccessCode } = require('./_lib/admin');

const BAZA_DIR = 'baza';

function normalizeQuestionScreenshots(data) {
    if (!Array.isArray(data)) return data;
    return data.map(item => {
        if (!item || !Array.isArray(item.screenshots)) return item;
        return { ...item, screenshots: item.screenshots.map(s => ({ ...s, url: normalizeImageUrl(s.url) })) };
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' });
    try {
        assertGithubConfig();
        const { code } = req.body || {};
        if (!code) return res.status(400).json({ error: 'Код обязателен' });

        const result = await validateAccessCode(code);
        if (!result) return res.status(403).json({ error: 'Код недействителен или истёк' });
        const { template, expiresAt } = result;

        const file = await getFile(`${BAZA_DIR}/${template}`);
        if (!file) return res.status(404).json({ error: 'Шаблон не найден' });

        let data;
        try { data = JSON.parse(file.content); } catch {
            return res.status(500).json({ error: 'Файл шаблона повреждён' });
        }

        return res.status(200).json({ template, expiresAt, data: normalizeQuestionScreenshots(Array.isArray(data) ? data : []) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
