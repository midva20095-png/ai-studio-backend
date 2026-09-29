const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш актуальный ключ
const GEMINI_API_KEY = "AQ.Ab8RN6K8r-5-gRNYmczuTwZIatq_k_el2V1ySLGRnaWr-vQn8Q";

// Инициализация официального клиента Google GenAI
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Актуальная модель
const AVAILABLE_MODELS = {
    "flash": "gemini-3.8-flash",
    "flash2": "gemini-3.8-flash",
    "flash-latest": "gemini-3.8-flash"
};

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { ws: ws, coins: 10, model: "gemini-3.8-flash" };
    } else {
        users[clientId].ws = ws;
    }

    ws.send(`COINS_UPDATE:${users[clientId].coins}`);

    ws.on('message', async (message) => {
        const text = message.toString().trim();
        const user = users[clientId];

        // Обработка переключения моделей с кнопок Тилды
        if (text.startsWith("SET_MODEL:")) {
            const modelKey = text.split(":")[1];
            if (AVAILABLE_MODELS[modelKey]) {
                user.model = AVAILABLE_MODELS[modelKey];
                ws.send(`MODEL_UPDATED:${user.model}`);
            }
            return;
        }

        if (user.coins <= 0) {
            ws.send("⚠️ У вас закончились монеты. Пополните баланс!");
            return;
        }

        user.coins -= 1;
        ws.send(`COINS_UPDATE:${user.coins}`);
        ws.send("⏳ Думаю над ответом...");

        try {
            // Стабильный запрос через официальный SDK
            const response = await ai.models.generateContent({
                model: user.model,
                contents: text,
            });

            const aiReply = response.text || "Извините, не удалось получить ответ от ИИ.";
            ws.send(aiReply);
            
        } catch (error) {
            console.error("SDK Error:", error);
            ws.send(`❌ Ошибка API (${user.model}): ${error.message || 'Не удалось обработать запрос'}`);
        }
    });
});

app.get('/', (req, res) => {
    res.send('AI Studio Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
