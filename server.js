const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш бесплатный ключ с префиксом AQ.
const GEMINI_API_KEY = "AQ.Ab8RN6IEFV-SuUH53CPd-pp_PvmpZo-lPK-KVwQmGflAbvWJ9Q";

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { 
            ws: ws, 
            coins: 10, 
            model: "gemini-2.0-flash" // Используем актуальную модель
        };
    } else {
        users[clientId].ws = ws;
    }

    ws.send(`COINS_UPDATE:${users[clientId].coins}`);

    ws.on('message', async (message) => {
        const text = message.toString().trim();
        const user = users[clientId];

        // Обработка смены модели через кнопки в виджете
        if (text.startsWith("SET_MODEL:")) {
            const modelKey = text.split(":")[1];
            if (modelKey === "flash") user.model = "gemini-1.5-flash";
            if (modelKey === "flash2") user.model = "gemini-2.0-flash";
            if (modelKey === "flash-latest") user.model = "gemini-flash-latest";
            ws.send(`MODEL_UPDATED:${user.model}`);
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
            // Отправляем запрос через эндпоинт, совместимый с новыми AQ-ключами
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${user.model}:generateContent`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GEMINI_API_KEY}` // Новые AQ-ключи передаются как Bearer-токен
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: text }] }]
                })
            });

            const data = await response.json();
            
            if (data.error) {
                console.error("API Error details:", data.error);
                ws.send(`❌ Ошибка API (${user.model}): ${data.error.message || 'Не удалось обработать запрос'}`);
                return;
            }

            const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Извините, не удалось получить ответ от ИИ.";
            ws.send(aiReply);
            
        } catch (error) {
            console.error("Fetch Error:", error);
            ws.send("❌ Произошла сетевая ошибка при обращении к нейросети.");
        }
    });
});

app.get('/', (req, res) => {
    res.send('AI Studio Bearer-Key Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
