const express = require('express');
const path = require('path');
const { put, list, del } = require('@vercel/blob');

const app = express();
const PORT = process.env.PORT || 3000;
const PREFIX = 'baza/';

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeName(name) {
    let filename = path.basename(String(name || ''));
    if (!filename.endsWith('.json')) filename += '.json';
    return filename;
}

async function findBlob(filename) {
    const { blobs } = await list({ prefix: PREFIX + filename, limit: 1 });
    return blobs.find(b => b.pathname === PREFIX + filename) || null;
}

// API: Получить список всех баз
app.get('/api/dbs', async (req, res) => {
    try {
        const { blobs } = await list({ prefix: PREFIX });
        const names = blobs
            .map(b => b.pathname.slice(PREFIX.length))
            .filter(name => name.endsWith('.json'));
        res.json(names);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Не удалось получить список баз: ' + err.message });
    }
});

// API: Получить содержимое конкретной базы данных
app.get('/api/dbs/:name', async (req, res) => {
    try {
        const filename = normalizeName(req.params.name);
        const blob = await findBlob(filename);
        if (!blob) return res.status(404).json({ error: 'База не найдена' });

        const fileRes = await fetch(blob.url);
        if (!fileRes.ok) return res.status(502).json({ error: 'Не удалось загрузить файл базы' });
        const data = await fileRes.json();
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Не удалось прочитать базу: ' + err.message });
    }
});

// API: Создать или сохранить/обновить базу данных
app.post('/api/dbs', async (req, res) => {
    try {
        const { name, data } = req.body;
        if (!name) return res.status(400).json({ error: 'Имя базы обязательно' });
        if (!Array.isArray(data)) return res.status(400).json({ error: 'Данные базы должны быть массивом' });

        const filename = normalizeName(name);
        await put(PREFIX + filename, JSON.stringify(data, null, 2), {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
        });
        res.json({ success: true, filename });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сохранения базы: ' + err.message });
    }
});

// API: Удалить базу данных
app.delete('/api/dbs/:name', async (req, res) => {
    try {
        const filename = normalizeName(req.params.name);
        const blob = await findBlob(filename);
        if (!blob) return res.status(404).json({ error: 'Файл не найден' });

        await del(blob.url);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка удаления: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен! Откройте в браузере: http://localhost:${PORT}`);
});
