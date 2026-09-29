const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey.trim());
}

app.get('/', (req, res) => {
  res.send('Server is running');
});

// Вспомогательная функция задержки
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Функция запроса к модели с повторными попытками при ошибках 503/429
async function generateWithRetry(modelName, prompt, retries = 2) {
  const model = genAI.getGenerativeModel({ model: modelName });
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      if (text) return text;
    } catch (err) {
      const isRateLimitOrOverload = err.message && (err.message.includes('503') || err.message.includes('429'));
      if (isRateLimitOrOverload && attempt < retries) {
        console.warn(`Модель ${modelName} перегружена (попытка ${attempt + 1}). Ждем 1 сек...`);
        await delay(1000);
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Не удалось получить ответ от ${modelName}`);
}

const handleChat = async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({ 
        reply: 'Ошибка: Переменная GEMINI_API_KEY не задана на сервере.' 
      });
    }

    const { message, prompt } = req.body;
    const userMessage = message || prompt;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
      return res.status(400).json({ reply: 'Сообщение не передано или пустое.' });
    }

    // Список моделей по приоритету стабильности
    const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-3.8-flash'];
    let text = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        text = await generateWithRetry(modelName, userMessage.trim());
        if (text) break;
      } catch (err) {
        console.warn(`Ошибка с моделью ${modelName}:`, err.message);
        lastError = err;
      }
    }

    if (text) {
      return res.json({ reply: text });
    } else {
      throw lastError || new Error('Сервисы Google временно недоступны.');
    }

  } catch (error) {
    console.error('Ошибка бэкенда:', error);
    return res.status(500).json({ 
      reply: 'Сервер перегружен. Пожалуйста, повторите попытку через пару секунд.'
    });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
