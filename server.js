const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const users = {};

// Ваш точный ключ API
const GEMINI_API_KEY = "AQ.Ab8RN6J-Eh5MOdZcZMBpaAduvIlEex5EvTB2-4oYF07uOtLk5A";

// Правильная инициализация клиента Google GenAI
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL_NAME = "gemini-2.5-flash";

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { ws: ws, coins: 10, model: MODEL_NAME };
    } else {
        users[clientId].ws = ws;
    }

    ws.send(`COINS_UPDATE:${users[clientId].coins}`);

    ws.on('message', async (message) => {
        const text = message.toString().trim();
        const user = users[clientId];

        if (text.startsWith("SET_MODEL:")) {
            const reqModel = text.split(":")[1];
            if (["gemini-2.5-flash", "gemini-2.5-pro"].includes(reqModel)) {
                user.model = reqModel;
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
            // Запрос через актуальный SDK
            const response = await ai.models.generateContent({
                model: user.model,
                contents: text,
            });

            const replyText = response.text || "Извините, не удалось получить ответ от ИИ.";
            ws.send(replyText);
            
        } catch (error) {
            console.error("SDK Error:", error);
            ws.send(`❌ Ошибка API: ${error.message || 'Не удалось обработать запрос'}`);
        }
    });
});

app.get('/', (req, res) => {
    res.send('AI WebSocket Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
