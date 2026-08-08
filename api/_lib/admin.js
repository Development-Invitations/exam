// Пароль кабинета и коды доступа к шаблонам — хранятся в GitHub (как и всё
// остальное), проверяются ТОЛЬКО на сервере. Раньше пароль проверялся лишь в
// браузере — это ничего не защищало: запрос на удаление/правку можно было
// отправить напрямую, минуя интерфейс. Теперь без верного пароля/кода сервер
// сам отказывает, вне зависимости от того, что показывает страница.

const { getJson, updateJson } = require('./github');

const SETTINGS_PATH = 'admin/settings.json';
const CODES_PATH = 'admin/access-codes.json';
const DEFAULT_PASSWORD = '0404';

async function getAdminPassword() {
    const { data } = await getJson(SETTINGS_PATH, { password: DEFAULT_PASSWORD });
    return data.password || DEFAULT_PASSWORD;
}

async function verifyAdminPassword(password) {
    const current = await getAdminPassword();
    return typeof password === 'string' && password === current;
}

async function setAdminPassword(newPassword) {
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 3) {
        throw new Error('Новый пароль должен быть не короче 3 символов');
    }
    await updateJson(SETTINGS_PATH, { password: DEFAULT_PASSWORD }, () => ({ password: newPassword }), 'Кабинет: смена пароля');
}

function randomCode() {
    // Без визуально похожих символов (0/O, 1/I) — легче диктовать/вводить вручную
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
}

async function listAccessCodes() {
    const { data } = await getJson(CODES_PATH, []);
    return Array.isArray(data) ? data : [];
}

async function createAccessCode({ template, label, expiresAt, days }) {
    if (!template) throw new Error('Не указан шаблон для кода доступа');
    // expiresAt — точная дата/время окончания (мс), приходит с клиента (datetime-local).
    // days оставлен как резервный способ (на случай старых вызовов) — N дней от сейчас.
    let expiry = Number(expiresAt);
    if (!expiry || expiry <= Date.now()) {
        const durationDays = Number(days) > 0 ? Number(days) : 7;
        expiry = Date.now() + durationDays * 24 * 60 * 60 * 1000;
    }
    const entry = {
        code: randomCode(),
        template,
        label: label || '',
        createdAt: Date.now(),
        expiresAt: expiry,
    };
    await updateJson(CODES_PATH, [], list => [...list, entry], `Кабинет: новый код доступа для "${template}"`);
    return entry;
}

async function revokeAccessCode(code) {
    await updateJson(CODES_PATH, [], list => list.filter(e => e.code !== code), `Кабинет: отзыв кода доступа ${code}`);
}

// Возвращает имя шаблона, если код существует и не истёк, иначе null.
async function validateAccessCode(code) {
    if (!code) return null;
    const codes = await listAccessCodes();
    const entry = codes.find(e => e.code === String(code).toUpperCase());
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) return null;
    return entry.template;
}

module.exports = {
    getAdminPassword,
    verifyAdminPassword,
    setAdminPassword,
    listAccessCodes,
    createAccessCode,
    revokeAccessCode,
    validateAccessCode,
};
