const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const users = {};

// Ваш актуальный ключ API (также продублируем в process.env для надежности SDK)
const GEMINI_API_KEY = "AQ.Ab8RN6J-Eh5MOdZcZMBpaAduvIlEex5EvTB2-4oYF07uOtLk5A";
process.env.GEMINI_API_KEY = GEMINI_API_KEY;

// Инициализация клиента Google GenAI с явной передачей ключа
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const DEFAULT_MODEL = "gemini-2.5-flash";

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { ws: ws, coins: 10, model: DEFAULT_MODEL };
    } else {
        users[clientId].ws = ws;
    }

    ws.send(`COINS_UPDATE:${users[clientId].coins}`);

    ws.on('message', async (message) => {
        const text = message.toString().trim();
        const user = users[clientId];

        if (text.startsWith("SET_MODEL:")) {
            const requestedModel = text.split(":")[1];
            if (["gemini-2.5-flash", "gemini-2.5-pro"].includes(requestedModel)) {
                user.model = requestedModel;
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
            // Корректный вызов генерации контента через SDK @google/genai
            const response = await ai.models.generateContent({
                model: user.model,
                contents: [text],
            });

            // Извлекаем текст ответа согласно структуре SDK
            const aiReply = response.text || (response.candidates && response.candidates[0]?.content?.parts[0]?.text) || "Извините, не удалось получить ответ от ИИ.";
            ws.send(aiReply);
            
        } catch (error) {
            console.error("SDK Error details:", error);
            ws.send(`❌ Ошибка API (${user.model}): ${error.message || 'Не удалось обработать запрос'}`);
        }
    });
});

app.get('/', (req, res) => {
    res.send('AI Studio WebSocket Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
