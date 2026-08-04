// Serverless-функция (Vercel Node runtime) — прокси между фронтендом и GitHub Contents API.
// Токен GitHub хранится ТОЛЬКО в переменных окружения Vercel (Project Settings → Environment
// Variables), никогда не попадает в код и не коммитится в репозиторий.

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const BAZA_DIR = 'baza';
const MANIFEST_PATH = `${BAZA_DIR}/manifest.json`;
const GH_API = 'https://api.github.com';

function assertConfig() {
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        throw new Error('Сервер не настроен: задайте GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO в переменных окружения Vercel');
    }
}

function encodeGithubPath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}

function b64encode(str) { return Buffer.from(str, 'utf-8').toString('base64'); }
function b64decode(str) { return Buffer.from(str, 'base64').toString('utf-8'); }

async function ghFetch(path, options = {}) {
    return fetch(`${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'exam-baza-app',
            ...(options.headers || {}),
        },
    });
}

async function getFile(path) {
    const res = await ghFetch(`${encodeGithubPath(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API (${res.status}) при чтении "${path}": ${await res.text()}`);
    const json = await res.json();
    if (Array.isArray(json)) throw new Error(`"${path}" — это папка, а не файл`);
    return { sha: json.sha, content: b64decode(String(json.content || '').replace(/\n/g, '')) };
}

async function putFile(path, content, message, sha) {
    const body = { message, content: b64encode(content), branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;
    const res = await ghFetch(encodeGithubPath(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ошибка сохранения "${path}" (${res.status}): ${await res.text()}`);
    return res.json();
}

async function deleteFile(path, message, sha) {
    const res = await ghFetch(encodeGithubPath(path), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sha, branch: GITHUB_BRANCH }),
    });
    if (!res.ok) throw new Error(`Ошибка удаления "${path}" (${res.status}): ${await res.text()}`);
    return res.json();
}

function normalizeName(name) {
    let filename = String(name || '').split('/').pop().split('\\').pop();
    if (!filename.endsWith('.json')) filename += '.json';
    return filename;
}

async function getManifest() {
    const file = await getFile(MANIFEST_PATH);
    if (!file) return { list: [], sha: null };
    try {
        const list = JSON.parse(file.content);
        return { list: Array.isArray(list) ? list : [], sha: file.sha };
    } catch {
        return { list: [], sha: file.sha };
    }
}

async function updateManifest(mutate, message) {
    const { list, sha } = await getManifest();
    const newList = mutate(list.slice());
    await putFile(MANIFEST_PATH, JSON.stringify(newList, null, 2) + '\n', message, sha || undefined);
}

module.exports = async (req, res) => {
    try {
        assertConfig();

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
            return res.status(200).json(Array.isArray(data) ? data : []);
        }

        if (req.method === 'POST') {
            const { name, data } = req.body || {};
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

            if (!existing) {
                await updateManifest(
                    list => (list.includes(filename) ? list : [...list, filename]),
                    `Добавление "${filename}" в manifest`
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
            await updateManifest(
                list => list.filter(n => n !== filename),
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
