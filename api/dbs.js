// Serverless-функция (Vercel Node runtime) — прокси между фронтендом и GitHub Contents API.
// Токен GitHub хранится ТОЛЬКО в переменных окружения Vercel (Project Settings → Environment
// Variables), никогда не попадает в код и не коммитится в репозиторий.

const { assertGithubConfig, getFile, putFile, deleteFile, updateJson, normalizeImageUrl } = require('./_lib/github');
const { verifyAdminPassword } = require('./_lib/admin');

const BAZA_DIR = 'baza';
const MANIFEST_PATH = `${BAZA_DIR}/manifest.json`;

// Скриншоты, сохранённые до перехода на прокси-ссылки, могли содержать прямые
// raw.githubusercontent.com URL — приводим их к /api/image на лету при чтении.
function normalizeQuestionScreenshots(data) {
    if (!Array.isArray(data)) return data;
    return data.map(item => {
        if (!item || !Array.isArray(item.screenshots)) return item;
        return { ...item, screenshots: item.screenshots.map(s => ({ ...s, url: normalizeImageUrl(s.url) })) };
    });
}

function normalizeName(name) {
    let filename = String(name || '').split('/').pop().split('\\').pop();
    if (!filename.endsWith('.json')) filename += '.json';
    return filename;
}

// Запись манифеста поддерживает старый формат (просто строка-имя файла)
// и новый — { name, category } — для обратной совместимости.
function normalizeManifestEntry(entry) {
    if (typeof entry === 'string') return { name: entry, category: '' };
    return { name: entry.name, category: entry.category || '' };
}

async function getManifest() {
    const file = await getFile(MANIFEST_PATH);
    if (!file) return { list: [], sha: null };
    try {
        const raw = JSON.parse(file.content);
        const list = Array.isArray(raw) ? raw.map(normalizeManifestEntry) : [];
        return { list, sha: file.sha };
    } catch {
        return { list: [], sha: file.sha };
    }
}

// Этот эндпоинт — часть кабинета (полный список/содержимое/правка любого
// шаблона). Публичный просмотр по коду доступа идёт через отдельный
// api/access.js, который отдаёт только ОДИН конкретный разрешённый шаблон.
module.exports = async (req, res) => {
    try {
        assertGithubConfig();

        const password = req.headers['x-admin-password'];
        if (!(await verifyAdminPassword(password))) {
            return res.status(401).json({ error: 'Неверный пароль кабинета' });
        }

        if (req.method === 'GET' && !req.query.name) {
            const { list } = await getManifest();
            return res.status(200).json(list);
        }

        if (req.method === 'GET' && req.query.name) {
            const filename = normalizeName(req.query.name);
            const file = await getFile(`${BAZA_DIR}/${filename}`);
            if (!file) return res.status(404).json({ error: 'База не найдена' });
            let data;
            try { data = JSON.parse(file.content); } catch {
                return res.status(500).json({ error: 'Файл базы повреждён (невалидный JSON)' });
            }
            return res.status(200).json(normalizeQuestionScreenshots(Array.isArray(data) ? data : []));
        }

        if (req.method === 'POST') {
            const { name, data, category } = req.body || {};
            if (!name) return res.status(400).json({ error: 'Имя базы обязательно' });
            if (!Array.isArray(data)) return res.status(400).json({ error: 'Данные базы должны быть массивом' });

            const filename = normalizeName(name);
            const filePath = `${BAZA_DIR}/${filename}`;
            const existing = await getFile(filePath);
            await putFile(
                filePath,
                JSON.stringify(data, null, 2) + '\n',
                `Обновление базы "${filename}" через веб-интерфейс`,
                existing ? existing.sha : undefined
            );

            // Манифест трогаем только когда реально нужно — новая база или явное
            // изменение категории (иначе на каждое добавление/удаление вопроса
            // уходил бы лишний коммит с неизменным manifest.json)
            const { list: currentManifest } = await getManifest();
            const manifestEntry = currentManifest.find(e => e.name === filename);
            if (!manifestEntry) {
                await updateJson(
                    MANIFEST_PATH, [],
                    list => [...list.map(normalizeManifestEntry), { name: filename, category: category || '' }],
                    `Добавление "${filename}" в manifest`
                );
            } else if (category !== undefined && category !== manifestEntry.category) {
                await updateJson(
                    MANIFEST_PATH, [],
                    list => list.map(normalizeManifestEntry).map(e => (e.name === filename ? { ...e, category: category || '' } : e)),
                    `Изменение категории "${filename}" в manifest`
                );
            }

            return res.status(200).json({ success: true, filename });
        }

        if (req.method === 'DELETE') {
            if (!req.query.name) return res.status(400).json({ error: 'Имя базы обязательно' });
            const filename = normalizeName(req.query.name);
            const filePath = `${BAZA_DIR}/${filename}`;
            const existing = await getFile(filePath);
            if (!existing) return res.status(404).json({ error: 'Файл не найден' });

            await deleteFile(filePath, `Удаление базы "${filename}" через веб-интерфейс`, existing.sha);
            await updateJson(
                MANIFEST_PATH, [],
                list => list.map(normalizeManifestEntry).filter(e => e.name !== filename),
                `Удаление "${filename}" из manifest`
            );
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Метод не поддерживается' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};
