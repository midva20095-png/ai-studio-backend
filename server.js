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
        reply: 'Ошибка: Переменная GEMINI_API_KEY не задана в Environment Variables на Render.' 
      });
    }

    const { message, prompt } = req.body;
    const userMessage = message || prompt;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
      return res.status(400).json({ reply: 'Ошибка: Сообщение не передано или пустое.' });
    }

    // Перешли на актуальную модель gemini-3.8-flash
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
    const result = await model.generateContent(userMessage.trim());
    const response = await result.response;
    const text = response.text();

    return res.json({ reply: text });
  } catch (error) {
    console.error('Детали ошибки Gemini API:', error);
    return res.status(500).json({ 
      reply: `Ошибка API: ${error.message || 'Неизвестная ошибка на сервере'}`
    });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
