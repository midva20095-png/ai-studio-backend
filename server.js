const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш новый актуальный ключ API
const GEMINI_API_KEY = "AQ.Ab8RN6J-Eh5MOdZcZMBpaAduvIlEex5EvTB2-4oYF07uOtLk5A";

// Инициализация клиента Google GenAI
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Актуальная стабильная модель
const MODEL_NAME = "gemini-3.8-flash";

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
            user.model = MODEL_NAME;
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
            // Запрос через современный Interactions API
            const interaction = await ai.interactions.create({
                model: user.model,
                input: text
            });

            const aiReply = interaction.output_text || "Извините, не удалось получить ответ от ИИ.";
            ws.send(aiReply);
            
        } catch (error) {
            console.error("SDK Error details:", error);
            ws.send(`❌ Ошибка API (${user.model}): ${error.message || 'Не удалось обработать запрос'}`);
        }
    });
});

app.get('/', (req, res) => {
    res.send('AI Studio Modern Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
