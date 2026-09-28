const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = {}; 

// Ваш ключ API
const GEMINI_API_KEY = "AQ.Ab8RN6IEFV-SuUH53CPd-pp_PvmpZo-lPK-KVwQmGflAbvWJ9Q";

// Список доступных бесплатных моделей Flash (и список для справки)
const AVAILABLE_MODELS = {
    "flash": "gemini-1.5-flash",
    "flash2": "gemini-2.0-flash",
    "flash3": "gemini-3-flash-preview"
};

wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const clientId = urlParts[urlParts.length - 1];

    if (!users[clientId]) {
        users[clientId] = { 
            ws: ws, 
            coins: 10, 
            model: "gemini-1.5-flash" // Модель по умолчанию
        };
    } else {
        users[clientId].ws = ws;
    }

    ws.send(`COINS_UPDATE:${users[clientId].coins}`);
    ws.send(`🤖 Текущая модель ИИ: ${users[clientId].model}\n💡 Чтобы сменит модель, отправьте команду: /model flash или /model flash2`);

    ws.on('message', async (message) => {
        const text = message.toString().trim();
        const user = users[clientId];

        // Обработка команд смены модели прямо из чата
        if (text.startsWith('/model')) {
            const parts = text.split(' ');
            const arg = parts[1]?.toLowerCase();
            
            if (AVAILABLE_MODELS[arg]) {
                user.model = AVAILABLE_MODELS[arg];
                ws.send(`✅ Модель успешно изменена на: ${user.model}`);
            } else {
                ws.send(`⚠️ Неверная модель. Доступные варианты:\n- /model flash (gemini-1.5-flash)\n- /model flash2 (gemini-2.0-flash)\n- /model flash3 (gemini-3-flash-preview)`);
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
            // Динамически подставляем выбранную пользователем модель в URL
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${user.model}:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-goog-api-key': GEMINI_API_KEY
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
    res.send('AI Studio Multi-Model Backend is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
