const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш рабочий ключ
const GEMINI_API_KEY = "AQ.Ab8RN6KxbKwBa5hwD6WDEht-weNmDKeLi8cO06Nf-h-Zd8jJxw";

// Доступные модели для переключения из виджета
const AVAILABLE_MODELS = {
    "flash": "gemini-1.5-flash",
    "flash2": "gemini-2.0-flash",
    "flash-latest": "gemini-flash-latest"
};

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        // По умолчанию ставим самую стабильную 1.5-flash для гарантии ответа
        users[clientId] = { ws: ws, coins: 10, model: "gemini-1.5-flash" };
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
            // Функция отправки запроса с вашими рабочими заголовками
            const sendRequest = async (modelName) => {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-goog-api-key': GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: text }] }]
                    })
                });
                return await response.json();
            };

            // Делаем запрос для выбранной пользователем модели
            let data = await sendRequest(user.model);

            // Если модель вернула ошибку и это была не 1.5-flash, страхуем стабильной версией
            if (data.error && user.model !== "gemini-1.5-flash") {
                console.warn(`Модель ${user.model} сбоит, переключаемся на gemini-1.5-flash...`);
                data = await sendRequest("gemini-1.5-flash");
            }

            if (data.error) {
                console.error("API Error details:", data.error);
                ws.send(`❌ Ошибка API: ${data.error.message || 'Не удалось обработать запрос'}`);
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
    res.send('AI Studio Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
