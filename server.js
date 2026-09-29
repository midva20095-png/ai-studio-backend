const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

// Разрешаем CORS для Тилды
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Ваш точный ключ API
const GEMINI_API_KEY = "AQ.Ab8RN6J-Eh5MOdZcZMBpaAduvIlEex5EvTB2-4oYF07uOtLk5A";
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL_NAME = "gemini-2.5-flash"; // Актуальная стабильная модель для SDK

app.post('/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Пустое сообщение' });
    }

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: message,
        });

        const reply = response.text || "Извините, не удалось получить ответ.";
        res.json({ reply });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: error.message || 'Ошибка сервера' });
    }
});

app.get('/', (req, res) => {
    res.send('AI Backend is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
