const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш актуальный ключ AQ. из Google AI Studio
const GEMINI_API_KEY = "AQ.Ab8RN6LL4eTaqqIp5LBp-CvaoFlv4-4nd4bqGOC1ye8cg_Wvqq";

// Инициализируем официальный SDK Google для работы с новыми ключами
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Доступные модели для переключения через кнопки в виджете Tilda
const AVAILABLE_MODELS = {
    "flash": "gemini-1.5-flash",
    "flash2": "gemini-2.0-flash",
    "flash-latest": "gemini-flash-latest"
};

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { 
            ws: ws, 
            coins: 10, 
            model: "gemini-1.5-flash" 
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
            // Официальный метод генерации через SDK, который обходит ошибки блокировки ключей
            const response = await ai.models.generateContent({
                model: user.model,
                contents: text,
            });

            const aiReply = response.text || "Извините, не удалось получить ответ от ИИ.";
            ws.send(aiReply);
            
        } catch (error) {
            console.error("SDK Error details:", error);
            
            if (error.status === 429 || error.message?.includes('RESOURCE_EXHAUSTED')) {
                ws.send(`⚠️ Модель ${user.model} перегружена. Попробуйте другую кнопку.`);
            } else {
                ws.send(`❌ Ошибка ИИ (${user.model}): ${error.message || 'Не удалось обработать запрос'}`);
            }
        }
    });
});

app.get('/', (req, res) => {
    res.send('AI Studio SDK Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
