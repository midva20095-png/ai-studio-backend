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
        reply: 'Ошибка: Переменная GEMINI_API_KEY не задана на сервере Render.' 
      });
    }

    const { message, prompt } = req.body;
    const userMessage = message || prompt;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
      return res.status(400).json({ reply: 'Сообщение не передано или пустое.' });
    }

    // Пробуем сначала gemini-3.8-flash
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
      const result = await model.generateContent(userMessage.trim());
      const response = await result.response;
      const text = response.text();
      if (text) return res.json({ reply: text });
    } catch (err1) {
      console.warn('Ошибка gemini-3.8-flash:', err1.message);

      // Если 3.8 не сработала, сразу пробуем gemini-1.5-flash
      try {
        const modelBackup = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const resultBackup = await modelBackup.generateContent(userMessage.trim());
        const responseBackup = await resultBackup.response;
        const textBackup = responseBackup.text();
        if (textBackup) return res.json({ reply: textBackup });
      } catch (err2) {
        console.warn('Ошибка gemini-1.5-flash:', err2.message);
        // Возвращаем детали обеих ошибок для диагностики
        return res.status(500).json({ 
          reply: `Ошибка M1 (3.8): ${err1.message} | Ошибка M2 (1.5): ${err2.message}` 
        });
      }
    }

  } catch (error) {
    console.error('Критическая ошибка бэкенда:', error);
    return res.status(500).json({ 
      reply: `Критическая ошибка: ${error.message}`
    });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
