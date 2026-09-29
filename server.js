const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш API-ключ
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KLi2evYUWy-k5spZcT3H9URzBfjm1GRYQrd1xc06JIJQ";

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

        if (user.coins <= 0) {
            ws.send("⚠️ У вас закончились монеты. Пополните баланс!");
            return;
        }

        user.coins -= 1;
        ws.send(`COINS_UPDATE:${user.coins}`);

        // Определение типа запроса: генерация изображения или текст
        const isImageRequest = text.toLowerCase().startsWith('/img') || 
                               text.toLowerCase().startsWith('нарисуй') || 
                               text.toLowerCase().startsWith('/нарисуй');

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

// Запрос текста
async function generateText(ws, textPrompt) {
    try {
        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-goog-api-key': GEMINI_API_KEY
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: textPrompt }] }]
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            console.error("Gemini API Error:", data.error);
            ws.send(`❌ Ошибка API: ${data.error.message || 'Не удалось обработать запрос'}`);
            return;
        }

        const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Извините, не удалось получить ответ от ИИ.";
        ws.send(aiReply);

    } catch (error) {
        console.error("Fetch Error:", error);
        ws.send("❌ Произошла сетевая ошибка при обращении к нейросети.");
    }
}

// Запрос генерации картинки (Imagen 3)
async function generateImage(ws, prompt) {
    try {
        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-goog-api-key': GEMINI_API_KEY
                },
                body: JSON.stringify({
                    instances: [{ prompt: prompt }],
                    parameters: { sampleCount: 1, aspectRatio: "1:1" }
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            console.error("Imagen API Error:", data.error);
            ws.send(`❌ Ошибка генерации картинки: ${data.error.message || 'Не удалось создать изображение'}`);
            return;
        }

        const base64Image = data.predictions?.[0]?.bytesBase64Encoded;
        if (base64Image) {
            ws.send(`IMAGE_URL:data:image/png;base64,${base64Image}`);
        } else {
            ws.send("❌ Не удалось получить изображение от нейросети.");
        }

    } catch (error) {
        console.error("Image Fetch Error:", error);
        ws.send("❌ Произошла ошибка при запросе генерации картинки.");
    }
}

app.get('/', (req, res) => {
    res.send('AI Studio Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
