const express = require('express');
const path = require('path');
const { put, list, del } = require('@vercel/blob');

const app = express();
const PORT = process.env.PORT || 3000;
const BLOB_PREFIX = 'baza/';

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeName(name) {
    let filename = path.basename(String(name || ''));
    if (!filename.endsWith('.json')) filename += '.json';
    return filename;
}

// API: Получить список всех баз
app.get('/api/dbs', async (req, res) => {
    try {
        const { blobs } = await list({ prefix: BLOB_PREFIX });
        const jsonFiles = blobs.map(blob => blob.pathname.replace(BLOB_PREFIX, ''));
        res.json(jsonFiles);
    } catch (err) {
        res.status(500).json({ error: 'Не удалось прочитать базы: ' + err.message });
    }
});

// API: Получить содержимое конкретной базы
app.get('/api/dbs/:name', async (req, res) => {
    try {
        const filename = normalizeName(req.params.name);
        const { blobs } = await list({ prefix: BLOB_PREFIX + filename });
        if (blobs.length === 0) {
            return res.status(404).json({ error: 'База не найдена' });
        }
        const response = await fetch(blobs[0].url, {
            headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка чтения: ' + err.message });
    }
});

// API: Создать или обновить базу
app.post('/api/dbs', async (req, res) => {
    try {
        const { name, data } = req.body;
        if (!name) return res.status(400).json({ error: 'Имя базы обязательно' });
        if (!Array.isArray(data)) return res.status(400).json({ error: 'Данные базы должны быть массивом' });

        const filename = normalizeName(name);
        await put(BLOB_PREFIX + filename, JSON.stringify(data, null, 2), {
            access: 'public',
            contentType: 'application/json',
            addRandomSuffix: false
        });

        res.json({ success: true, filename });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сохранения: ' + err.message });
    }
});

// API: Удалить базу
app.delete('/api/dbs/:name', async (req, res) => {
    try {
        const filename = normalizeName(req.params.name);
        const { blobs } = await list({ prefix: BLOB_PREFIX + filename });
        if (blobs.length === 0) {
            return res.status(404).json({ error: 'Файл не найден' });
        }
        await del(blobs[0].url);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка удаления: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен! Откройте в браузере: http://localhost:${PORT}`);
});
