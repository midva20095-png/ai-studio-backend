const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Render автоматически передает PORT через process.env.PORT
const PORT = process.env.PORT || 10000;

// Разрешаем CORS-запросы
app.use(cors());
app.use(express.json());

// Отлавливаем критические ошибки, чтобы процесс не завершался аварийно
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

// Инициализируем клиент Gemini
let genAI = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else {
  console.warn('ВНИМАНИЕ: Переменная GEMINI_API_KEY не задана в Environment!');
}

// Проверка работоспособности (Healthcheck для Render)
app.get('/', (req, res) => {
  res.status(200).send('AI Backend is active and running.');
});

// Эндпоинт для чата
app.post('/api/chat', async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({ 
        error: 'Сервер не настроен: отсутствует GEMINI_API_KEY.' 
      });
    }

    const { message } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Сообщение не должно быть пустым.' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(message);
    const response = await result.response;
    const text = response.text();

    return res.json({ reply: text });
  } catch (error) {
    console.error('Ошибка при вызове Gemini API:', error);
    return res.status(500).json({ 
      error: 'Ошибка обработки запроса на сервере.',
      details: error.message 
    });
  }
});

// Обязательно слушаем хост 0.0.0.0 для Cloud-сервисов
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
