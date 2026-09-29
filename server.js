const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Логирование критических ошибок сервера
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

// Инициализация Google Generative AI
const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
} else {
  console.warn('ВНИМАНИЕ: Переменная GEMINI_API_KEY не найдена в окружении!');
}

// Проверка статуса сервера
app.get('/', (req, res) => {
  res.send('Server is running');
});

// Основной эндпоинт чата
app.post('/chat', async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({ error: 'Сервер не настроен: отсутствует GEMINI_API_KEY.' });
    }

    const { message, prompt } = req.body;
    const userMessage = message || prompt;

    if (!userMessage) {
      return res.status(400).json({ error: 'Сообщение не передано.' });
    }

    // Запрос к модели Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(userMessage);
    const response = await result.response;
    const text = response.text();

    res.json({ reply: text, text: text, response: text });
  } catch (error) {
    console.error('Ошибка Gemini API:', error);
    res.status(500).json({ 
      error: 'Ошибка обработки запроса на сервере.', 
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
