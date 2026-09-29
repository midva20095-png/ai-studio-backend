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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handleChat = async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({ 
        reply: 'Ошибка: Переменная GEMINI_API_KEY не задана на сервере Render.' 
      });
    }

    const { message, prompt } = req.body;
    const userMessage = message || prompt;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
      return res.status(400).json({ reply: 'Сообщение не передано или пустое.' });
    }

    // Используем актуальную рабочую модель gemini-3.8-flash
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
    
    let text = null;
    let lastError = null;

    // Делаем до 3 попыток с нарастающей задержкой на случай пиковой нагрузки Google (503/429)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await model.generateContent(userMessage.trim());
        const response = await result.response;
        text = response.text();
        if (text) break;
      } catch (err) {
        lastError = err;
        console.warn(`Попытка ${attempt} не удалась:`, err.message);
        
        // Если ошибка связана с перегрузкой (503 или 429), делаем паузу и пробуем снова
        if (attempt < 3 && err.message && (err.message.includes('503') || err.message.includes('429'))) {
          await delay(attempt * 2000); // 2 сек, затем 4 сек
        } else {
          break;
        }
      }
    }

    if (text) {
      return res.json({ reply: text });
    } else {
      throw lastError || new Error('Не удалось получить ответ от Gemini API.');
    }

  } catch (error) {
    console.error('Ошибка бэкенда:', error);
    // Выводим точный текст ошибки прямо в чат для отладки
    return res.status(500).json({ 
      reply: `Ошибка Gemini API: ${error.message || 'Неизвестная ошибка на сервере'}`
    });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
