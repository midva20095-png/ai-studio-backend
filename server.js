const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Отлавливаем критические ошибки
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

// Инициализация Gemini API
const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey.trim());
} else {
  console.warn('ВНИМАНИЕ: GEMINI_API_KEY не задан в переменной окружения!');
}

app.get('/', (req, res) => {
  res.send('Server is running');
});

// Поддерживаем обработку запросов как на /chat, так и на /api/chat
const handleChat = async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({ 
        error: 'Сервер не настроен: отсутствует GEMINI_API_KEY в Environment Variables.' 
      });
    }

    const { message, prompt } = req.body;
    const userMessage = message || prompt;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
      return res.status(400).json({ error: 'Сообщение не передано или пустое.' });
    }

    // Запрос к актуальной модели Gemini 2.5 Flash
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(userMessage.trim());
    const response = await result.response;
    const text = response.text();

    return res.json({ reply: text, text: text });
  } catch (error) {
    console.error('Ошибка при вызове Gemini API:', error);
    return res.status(500).json({ 
      error: 'Ошибка обработки запроса на сервере.', 
      details: error.message || String(error)
    });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
