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

    // Список моделей по приоритету (если первая перегружена, сработает следующая)
    const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-3.8-flash'];
    let text = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(userMessage.trim());
        const response = await result.response;
        text = response.text();
        if (text) break; // Ответ успешно получен!
      } catch (err) {
        console.warn(`Модель ${modelName} недоступна, пробуем следующую...`, err.message);
        lastError = err;
      }
    }

    if (text) {
      return res.json({ reply: text });
    } else {
      throw lastError || new Error('Сервисы Google сейчас перегружены.');
    }

  } catch (error) {
    console.error('Детали ошибки Gemini API:', error);
    return res.status(500).json({ 
      reply: 'Сервер сейчас очень загружен. Попробуйте повторить запрос через 10–15 секунд.'
    });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
