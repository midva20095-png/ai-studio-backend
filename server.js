const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

// Инициализация Firebase
if (fs.existsSync('./firebase-key.json')) {
    const serviceAccount = require('./firebase-key.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase успешно подключен!');
} else {
    console.warn('ВНИМАНИЕ: Файл firebase-key.json не найден!');
}

const db = admin.firestore();

// Инициализация Google Gen AI с переменной окружения из Render
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const bot = new Telegraf(BOT_TOKEN);

const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';

// Работа с балансом через Firestore
async function getBalance(userId) {
    try {
        const userRef = db.collection('users').doc(String(userId));
        const doc = await userRef.get();
        if (!doc.exists) {
            await userRef.set({ balance: 5, created_at: new Date() });
            return 5;
        }
        return doc.data().balance || 0;
    } catch (error) {
        console.error('Ошибка чтения баланса:', error);
        return 5;
    }
}

async function updateBalance(userId, amount) {
    try {
        const userRef = db.collection('users').doc(String(userId));
        const doc = await userRef.get();
        let currentBalance = 5;
        if (doc.exists) {
            currentBalance = doc.data().balance || 0;
        }
        const newBalance = currentBalance + amount;
        await userRef.set({ balance: newBalance, updated_at: new Date() }, { merge: true });
        return newBalance;
    } catch (error) {
        console.error('Ошибка обновления баланса:', error);
        return 0;
    }
}

// Создание платежа ЮKassa
async function createYooKassaPayment(userId, amountCoins, priceRub) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const body = {
        amount: { value: `${priceRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: 'https://t.me/' + (await bot.telegram.getMe()).username },
        capture: true,
        description: `Покупка ${amountCoins} монет в ИИ-боте`,
        metadata: { user_id: String(userId), coins: String(amountCoins) }
    };

    try {
        const response = await axios.post(url, body, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Idempotence-Key': Math.random().toString(36).substring(7)
            }
        });
        return response.data.confirmation.confirmation_url;
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.response?.data || error.message);
        return null;
    }
}

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const balance = await getBalance(userId);
    ctx.reply(
        `Привет! Я твой ИИ-помощник на базе Gemini.\n` +
        `Твой баланс: ${balance} 🪙\n\n` +
        `Напиши мне любой вопрос, и я отвечу (списывается 1 монета).`,
        Markup.inlineKeyboard([
            [Markup.button.callback('💳 Купить 100 монет (100 руб)', 'buy_100')]
        ])
    );
});

bot.action('buy_100', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    const paymentUrl = await createYooKassaPayment(userId, 100, 100);
    if (paymentUrl) {
        ctx.reply(
            `Ссылка на оплату сформирована! 🎉`,
            Markup.inlineKeyboard([[Markup.button.url('🔗 Оплатить 100 руб.', paymentUrl)]])
        );
    } else {
        ctx.reply('Ошибка создания платежа.');
    }
});

// Обработка текстовых сообщений через Gemini API
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const balance = await getBalance(userId);
    const text = ctx.message.text;

    if (balance <= 0) {
        ctx.reply(
            'У тебя закончились монеты! 🪙 Пополни баланс:',
            Markup.inlineKeyboard([[Markup.button.callback('💳 Купить монеты', 'buy_100')]])
        );
        return;
    }

    try {
        // Отправка запроса к актуальной модели Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: text,
        });

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';

        // Списываем 1 монету после успешного ответа
        const newBalance = await updateBalance(userId, -1);

        ctx.reply(`${aiReply}\n\n*(Списана 1 монета. Остаток: ${newBalance} 🪙)*`);
    } catch (error) {
        console.error('Ошибка обращения к Gemini AI:', error);
        ctx.reply('Произошла ошибка при обращении к искусственному интеллекту. Попробуй позже.');
    }
});

bot.launch().then(() => {
    console.log('Telegram бот с Gemini успешно запущен!');
});

app.post('/yookassa-webhook', async (req, res) => {
    const event = req.body;
    if (event.event === 'payment.succeeded') {
        const payment = event.object;
        const metadata = payment.metadata;
        if (metadata && metadata.user_id && metadata.coins) {
            const userId = parseInt(metadata.user_id);
            const coins = parseInt(metadata.coins);
            const newBalance = await updateBalance(userId, coins);
            bot.telegram.sendMessage(
                userId,
                `Оплата прошла успешно! 🎉 Начислено монет: ${coins}.\nТекущий баланс: ${newBalance} 🪙`
            ).catch(err => console.error(err));
        }
    }
    res.status(200).send('OK');
});

app.get('/', (req, res) => {
    res.send('Server is running with Gemini AI, Telegram & Firebase!');
});

app.listen(PORT, () => {
    console.log(`Web server is running on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
