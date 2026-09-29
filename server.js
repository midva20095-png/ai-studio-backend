const express = require('express');

const app = express();

// Настройка CORS вручную (без сторонних библиотек)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Ваш API-ключ
const GEMINI_API_KEY = "AQ.Ab8RN6KfdaHQ_v1_rheuubC-nDQECRiG_mfRq2oG9KLhn6Labw";

app.post('/api/chat', async (req, res) => {
    const { message, model } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Сообщение не должно быть пустым" });
    }

    const selectedModel = model || "gemini-1.5-flash";

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${GEMINI_API_KEY}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: message }]
                    }
                ]
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error("Google API Error:", data.error);
            return res.status(data.error.code || 500).json({ 
                error: data.error.message || "Ошибка на стороне Google API" 
            });
        }

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Пустой ответ от нейросети.";
        return res.json({ reply });

    } catch (err) {
        console.error("Server Error:", err);
        return res.status(500).json({ error: "Внутренняя ошибка сервера" });
    }
});

app.get('/', (req, res) => {
    res.send('AI Studio Backend is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
