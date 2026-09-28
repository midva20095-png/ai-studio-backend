const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш новый ключ (начинающийся с AQ.)
const GEMINI_API_KEY = "AQ.Ab8RN6IEFV-SuUH53CPd-pp_PvmpZo-lPK-KVwQmGflAbvWJ9Q";

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { 
            ws: ws, 
            coins: 10, 
            model: "gemini-3.8-flash" // Актуальная модель для новых ключей
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
            if (modelKey === "flash") user.model = "gemini-3.8-flash";
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
            // Используем официальный защищенный эндпоинт для новых AQ-ключей
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': GEMINI_API_KEY
                },
                body: JSON.stringify({
                    model: user.model,
                    input: text
                })
            });

            const data = await response.json();
            
            if (data.error) {
                console.error("API Error details:", data.error);
                ws.send(`❌ Ошибка API: ${data.error.message || 'Не удалось обработать запрос'}`);
                return;
            }

            // Извлекаем ответ из нового формата ответа Google
            const aiReply = data.interaction?.outputText || data.output_text || "Извините, не удалось получить ответ от ИИ.";
            ws.send(aiReply);
            
        } catch (error) {
            console.error("Fetch Error:", error);
            ws.send("❌ Произошла сетевая ошибка при обращении к нейросети.");
        }
    });
});

app.get('/', (req, res) => {
    res.send('AI Studio Auth-Key Backend is running!');
});

The PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
