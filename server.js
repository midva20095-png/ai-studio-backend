const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

process.on('uncaughtException', (err) => console.error('UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('UNHANDLED REJECTION:', reason));

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey.trim());
}

app.get('/', (req, res) => res.send('Server is running'));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handleChat = async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({ 
        reply: 'Ошибка: GEMINI_API_KEY не задан в Environment Variables на Render.' 
      });
    }

    const { message, prompt } = req.body;
    const userMessage = message || prompt;

    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      return res.status(400).json({ reply: 'Сообщение не передано или пустое.' });
    }

    // Список актуальных поддерживаемых моделей
    const modelsToTry = ['gemini-2.5-flash', 'gemini-3.8-flash'];
    let text = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      // До 2 попыток с небольшой паузой на случай лимитов частоты (429 / 503)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await model.generateContent(userMessage.trim());
          const response = await result.response;
          text = response.text();
          if (text) break;
        } catch (err) {
          lastError = err;
          const isRateLimit = err.message && (err.message.includes('429') || err.message.includes('503'));
          
          if (isRateLimit && attempt < 2) {
            console.warn(`Лимит частоты для ${modelName}, пауза 1 сек...`);
            await delay(1000);
          } else {
            console.warn(`Модель ${modelName} недоступна:`, err.message);
            break; // Переходим к следующей модели в списке
          }
        }
      }

      if (text) break; // Успех! Выходим из цикла по моделям
    }

    if (text) {
      return res.json({ reply: text });
    }

    // Если ошибки продолжаются
    const isQuotaExceeded = lastError?.message?.includes('429');
    if (isQuotaExceeded) {
      return res.status(429).json({
        reply: 'Исчерпан лимит бесплатных запросов Gemini API в сутки. Подключите платный ключ (Pay-as-you-go) на Render или повторите попытку позже.'
      });
    }

    throw lastError || new Error('Не удалось получить ответ от моделей.');

  } catch (error) {
    console.error('Ошибка бэкенда:', error);
    return res.status(500).json({ 
      reply: `Ошибка сервера: ${error.message || 'Неизвестный сбой'}`
    });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
