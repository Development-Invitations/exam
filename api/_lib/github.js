// Общие хелперы для работы с GitHub Contents API.
// Токен — только из переменных окружения Vercel, никогда в коде/репозитории.

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GH_API = 'https://api.github.com';

function assertGithubConfig() {
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

// Безопасная диагностика: показывает первые символы и длину токена, но не сам
// секрет (реальная энтропия токена — в оставшихся ~80 символах). Нужно, чтобы
// проверить, действительно ли до сервера долетает нормальный токен, а не
// пустая строка/обрезанное значение — не раскрывая его целиком в логах/тостах.
function tokenFingerprint() {
    if (!GITHUB_TOKEN) return '(пусто/undefined)';
    return `"${GITHUB_TOKEN.slice(0, 12)}..." (длина: ${GITHUB_TOKEN.length})`;
}

// 403 с этим текстом — почти всегда означает, что у GITHUB_TOKEN нет права
// записи (Contents: Read-only вместо Read and write), а не проблему в коде.
function friendlyWriteErrorHint(status, text) {
    if (status === 403 && /Resource not accessible/i.test(text)) {
        return ` — похоже, у GITHUB_TOKEN нет прав на запись, ЛИБО это не тот токен, что вы проверяли на GitHub. Fingerprint токена, который реально видит сервер: ${tokenFingerprint()}. Проверьте, что это совпадает с началом вашего токена в GitHub (Settings → Developer settings → Fine-grained tokens).`;
    }
    return '';
}

async function putFile(path, content, message, sha) {
    const body = { message, content: b64encode(content), branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;
    const res = await ghFetch(encodeGithubPath(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ошибка сохранения "${path}" (${res.status}): ${text}${friendlyWriteErrorHint(res.status, text)}`);
    }
    return res.json();
}

async function deleteFile(path, message, sha) {
    const res = await ghFetch(encodeGithubPath(path), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sha, branch: GITHUB_BRANCH }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ошибка удаления "${path}" (${res.status}): ${text}${friendlyWriteErrorHint(res.status, text)}`);
    }
    return res.json();
}

// Читает JSON-файл, при 404 отдаёт fallback. Возвращает { data, sha }.
async function getJson(path, fallback) {
    const file = await getFile(path);
    if (!file) return { data: fallback, sha: null };
    try {
        return { data: JSON.parse(file.content), sha: file.sha };
    } catch {
        return { data: fallback, sha: file.sha };
    }
}

function isShaConflict(err) {
    return /\(409\)/.test(err.message);
}

// Читает-изменяет-пишет JSON-файл. При гонке (409 — файл изменился между
// чтением sha и записью, например два сообщения чата почти одновременно)
// перечитывает актуальный sha и повторяет попытку, а не падает сразу —
// иначе любая параллельная активность в одном файле теряла бы данные.
async function updateJson(path, fallback, mutate, message, attempt = 1) {
    const { data, sha } = await getJson(path, fallback);
    const newData = mutate(data);
    try {
        await putFile(path, JSON.stringify(newData, null, 2) + '\n', message, sha || undefined);
        return newData;
    } catch (err) {
        if (isShaConflict(err) && attempt < 3) {
            return updateJson(path, fallback, mutate, message, attempt + 1);
        }
        throw err;
    }
}

module.exports = {
    assertGithubConfig,
    encodeGithubPath,
    getFile,
    putFile,
    deleteFile,
    getJson,
    updateJson,
};
