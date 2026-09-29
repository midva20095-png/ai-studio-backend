const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// 1. Инициализация Google Gemini SDK с вашим ключом
const apiKey = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KLi2evYUWy-k5spZcT3H9URzBfjm1GRYQrd1xc06JIJQ";

const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { ws: ws, coins: 10 };
    } else {
        users[clientId].ws = ws;
    }

    ws.send(`COINS_UPDATE:${users[clientId].coins}`);

    ws.on('message', async (message) => {
        const text = message.toString().trim();
        const user = users[clientId];

        // Определение типа запроса и расчёт стоимости
        const isImageRequest = text.toLowerCase().startsWith('/img') || 
                               text.toLowerCase().startsWith('нарисуй') || 
                               text.toLowerCase().startsWith('/нарисуй');

        const cost = isImageRequest ? 5 : 1;

        if (user.coins < cost) {
            ws.send(`⚠️ Недостаточно монет. Требуется: ${cost} 🪙, у вас: ${user.coins} 🪙. Пополните баланс!`);
            return;
        }

        user.coins -= cost;
        ws.send(`COINS_UPDATE:${user.coins}`);

        if (isImageRequest) {
            ws.send("🎨 Генерирую изображение...");
            const prompt = text.replace(/^(\/img|\/нарисуй|нарисуй)\s*/i, '');
            await generateImage(ws, prompt);
        } else {
            ws.send("⏳ Думаю над ответом...");
            await generateText(ws, text);
        }
    });
});

// Генерация текста
async function generateText(ws, textPrompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: textPrompt }] }],
            config: {
                systemInstruction: 'Ты — мудрый и полезный AI-помощник. Отвечай на русском языке.',
                temperature: 0.7,
            },
        });

        const aiReply = response.text || "Извините, не удалось получить ответ от ИИ.";
        ws.send(aiReply);

    } catch (error) {
        console.error("Ошибка вызова Gemini:", error);
        ws.send(`❌ Ошибка API: ${error.message || 'Не удалось обработать запрос'}`);
    }
}

// Генерация изображений
async function generateImage(ws, prompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { text: `High quality detailed digital art illustration of: ${prompt}` }
                ],
            },
            config: {
                responseModalities: ['IMAGE'],
            },
        });

        const base64Image = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (base64Image) {
            ws.send(`IMAGE_URL:data:image/png;base64,${base64Image}`);
        } else {
            ws.send("❌ Не удалось получить изображение от нейросети.");
        }

    } catch (error) {
        console.error("Ошибка генерации картинки:", error);
        ws.send(`❌ Ошибка генерации картинки: ${error.message || 'Не удалось создать изображение'}`);
    }
}

app.get('/', (req, res) => {
    res.send('AI Studio Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
