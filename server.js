const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BAZA_DIR = path.join(__dirname, 'baza');

// Убедимся, что папка baza существует
if (!fs.existsSync(BAZA_DIR)) {
    fs.mkdirSync(BAZA_DIR, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeName(name) {
    let filename = path.basename(String(name || ''));
    if (!filename.endsWith('.json')) filename += '.json';
    return filename;
}

// API: Получить список всех баз (имена файлов из папки baza)
app.get('/api/dbs', (req, res) => {
    fs.readdir(BAZA_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Не удалось прочитать папку база' });
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        res.json(jsonFiles);
    });
});

// API: Получить содержимое конкретной базы данных
app.get('/api/dbs/:name', (req, res) => {
    const filename = normalizeName(req.params.name);
    const filePath = path.join(BAZA_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'База не найдена' });
    }
    res.sendFile(filePath);
});

// API: Создать или сохранить/обновить базу данных на сервере
app.post('/api/dbs', (req, res) => {
    const { name, data } = req.body;
    if (!name) return res.status(400).json({ error: 'Имя базы обязательно' });
    if (!Array.isArray(data)) return res.status(400).json({ error: 'Данные базы должны быть массивом' });

    const filename = normalizeName(name);
    const filePath = path.join(BAZA_DIR, filename);

    fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сохранения файла' });
        res.json({ success: true, filename });
    });
});

// API: Удалить базу данных с сервера
app.delete('/api/dbs/:name', (req, res) => {
    const filename = normalizeName(req.params.name);
    const filePath = path.join(BAZA_DIR, filename);
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) return res.status(500).json({ error: 'Ошибка удаления' });
            res.json({ success: true });
        });
    } else {
        res.status(404).json({ error: 'Файл не найден' });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен! Откройте в браузере: http://localhost:${PORT}`);
});
