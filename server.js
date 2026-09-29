const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

// Инициализация Firebase
if (process.env.FIREBASE_CONFIG_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase успешно подключен через переменные окружения!');
} else if (fs.existsSync('./firebase-key.json')) {
    const serviceAccount = require('./firebase-key.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase успешно подключен из локального файла!');
} else {
    console.warn('ВНИМАНИЕ: Ключ Firebase не найден ни в файле, ни в переменных окружения!');
}

const db = admin.firestore();

// Инициализация Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const bot = new Telegraf(BOT_TOKEN);

const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';

const MODELS = {
    'flash': { name: '⚡ Gemini 3.8 Flash (Быстрая)', modelId: 'gemini-3.8-flash', cost: 1 },
    'pro': { name: '🧠 Nano Banana Pro / Gemini 3.1 Pro', modelId: 'gemini-3.1-pro-preview', cost: 5 }
};

const userModels = {};

async function getBalance(userId) {
    try {
        const userRef = db.collection('users').doc(String(userId));
        const doc = await userRef.get();
        if (!doc.exists) {
            await userRef.set({ balance: 5, created_at: new Date() });
            return 5;
        }
        return Number(doc.data().balance) || 0;
    } catch (error) {
        console.error('Ошибка чтения баланса:', error);
        return 0;
    }
}

async function updateBalance(userId, amount) {
    try {
        const userRef = db.collection('users').doc(String(userId));
        const doc = await userRef.get();
        let currentBalance = 0;
        if (doc.exists) {
            currentBalance = Number(doc.data().balance) || 0;
        }
        const newBalance = currentBalance + amount;
        await userRef.set({ balance: newBalance, updated_at: new Date() }, { merge: true });
        return newBalance;
    } catch (error) {
        console.error('Ошибка обновления баланса:', error);
        return 0;
    }
}

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
        return {
            confirmationUrl: response.data.confirmation.confirmation_url,
            paymentId: response.data.id
        };
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.response?.data || error.message);
        return null;
    }
}

async function checkPaymentStatus(paymentId) {
    const url = `https://api.yookassa.ru/v3/payments/${paymentId}`;
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Basic ${authString}` }
        });
        return response.data;
    } catch (error) {
        console.error('Ошибка проверки статуса платежа:', error.response?.data || error.message);
        return null;
    }
}

function getTopUpKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('💳 50 руб. (10 монет)', 'buy_50'), Markup.button.callback('💳 200 руб. (40 монет)', 'buy_200')],
        [Markup.button.callback('💳 500 руб. (100 монет)', 'buy_500'), Markup.button.callback('💳 1000 руб. (200 монет)', 'buy_1000')],
        [Markup.button.callback('🚀 5000 руб. (1000 монет)', 'buy_5000')],
        [Markup.button.callback('🔙 Назад в меню', 'back_to_main')]
    ]);
}

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const balance = await getBalance(userId);
    const currentModelKey = userModels[userId] || 'flash';
    
    ctx.reply(
        `Привет! Я твой продвинутый ИИ-помощник с поддержкой моделей Gemini.\n\n` +
        `💰 Твой баланс: ${balance} 🪙 (1 монета = 5 руб)\n` +
        `🤖 Текущая модель: *${MODELS[currentModelKey].name}* (Стоимость: ${MODELS[currentModelKey].cost} монета(ы) за запрос)\n\n` +
        `Выбери нужную модель или пополни баланс:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Gemini 3.8 Flash (1 монета)', 'set_model_flash')],
            [Markup.button.callback('🧠 Nano Banana Pro (5 монет)', 'set_model_pro')],
            [Markup.button.callback('💳 Пополнить баланс', 'menu_buy')]
        ])
    );
});

bot.action('set_model_flash', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'flash';
    await ctx.answerCbQuery('Выбрана модель Gemini 3.8 Flash');
    ctx.reply('✅ Успешно! Теперь активна модель **Gemini 3.8 Flash** (списание: 1 монета / 5 рублей за запрос).');
});

bot.action('set_model_pro', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'pro';
    await ctx.answerCbQuery('Выбрана модель Nano Banana Pro');
    ctx.reply('🧠 Успешно! Теперь активна премиум-модель **Nano Banana Pro / Gemini 3.1 Pro** (списание: 5 монет / 25 рублей за запрос).');
});

bot.action('menu_buy', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Выберите сумму пополнения баланса:', getTopUpKeyboard());
});

bot.action('back_to_main', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await getBalance(userId);
    const currentModelKey = userModels[userId] || 'flash';
    ctx.reply(
        `💰 Твой баланс: ${balance} 🪙\n🤖 Текущая модель: *${MODELS[currentModelKey].name}*\n\nВыбери модель или пополни баланс:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Gemini 3.8 Flash (1 монета)', 'set_model_flash')],
            [Markup.button.callback('🧠 Nano Banana Pro (5 монет)', 'set_model_pro')],
            [Markup.button.callback('💳 Пополнить баланс', 'menu_buy')]
        ])
    );
});

const tariffs = [
    { action: 'buy_50', coins: 10, price: 50 },
    { action: 'buy_200', coins: 40, price: 200 },
    { action: 'buy_500', coins: 100, price: 500 },
    { action: 'buy_1000', coins: 200, price: 1000 },
    { action: 'buy_5000', coins: 1000, price: 5000 }
];

tariffs.forEach(tariff => {
    bot.action(tariff.action, async (ctx) => {
        const userId = ctx.from.id;
        await ctx.answerCbQuery();
        const paymentData = await createYooKassaPayment(userId, tariff.coins, tariff.price);
        
        if (paymentData && paymentData.confirmationUrl) {
            ctx.reply(
                `💳 Ссылка на оплату пакета (${tariff.coins} монет за ${tariff.price} руб) сформирована:\n\n` +
                `⚠️ *Если оплатили, но монеты не зачислились автоматически, нажмите кнопку ниже:*`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.url(`🔗 Оплатить ${tariff.price} руб.`, paymentData.confirmationUrl)],
                        [Markup.button.callback(`🔄 Проверить оплату`, `check_${paymentData.paymentId}`)]
                    ])
                }
            );
        } else {
            ctx.reply('Ошибка создания платежа. Попробуйте позже.');
        }
    });
});

bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const userId = ctx.from.id;

    await ctx.answerCbQuery('Проверяем статус платежа...');

    const paymentInfo = await checkPaymentStatus(paymentId);
    if (!paymentInfo) {
        return ctx.reply('❌ Не удалось связаться с ЮKassa для проверки. Попробуйте позже.');
    }

    if (paymentInfo.status === 'succeeded') {
        const coins = parseInt(paymentInfo.metadata?.coins) || 0;
        
        if (coins <= 0) {
            return ctx.reply('❌ Ошибка: не удалось определить количество монет для этого платежа.');
        }

        const newBalance = await updateBalance(userId, coins);
        return ctx.reply(`🎉 Оплата прошла успешно! Начислено монет: ${coins}.\n💰 Ваш текущий баланс: ${newBalance} 🪙`);
    } else if (paymentInfo.status === 'pending') {
        return ctx.reply('⏳ Платеж еще не оплачен или обрабатывается банком. Завершите оплату по ссылке и нажмите кнопку снова.');
    } else {
        return ctx.reply(`❌ Статус платежа: ${paymentInfo.status}. Оплата не прошла.`);
    }
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    const modelKey = userModels[userId] || 'flash';
    const selectedModel = MODELS[modelKey];

    const balance = await getBalance(userId);

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ Недостаточно монет!\n\n` +
            `🤖 Модель: ${selectedModel.name}\n` +
            `📉 Требуется: ${selectedModel.cost} 🪙\n` +
            `💰 Ваш баланс: ${balance} 🪙\n\n` +
            `Пожалуйста, пополните баланс, выбрав сумму ниже:`,
            getTopUpKeyboard()
        );
    }

    try {
        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: text,
        });

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
        const newBalance = await updateBalance(userId, -selectedModel.cost);

        ctx.reply(`${aiReply}\n\n*(${selectedModel.name} | Списано: ${selectedModel.cost} 🪙 | Остаток: ${newBalance} 🪙)*`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка обращения к Gemini AI:', error);
        ctx.reply('Произошла ошибка при обращении к искусственному интеллекту. Попробуй позже.');
    }
});

// Настройка вебхука для Telegram вместо bot.launch() (убирает ошибку 409 навсегда)
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL; // Render сам предоставляет этот URL
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Telegram webhook успешно установлен на ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    console.warn('ВНИМАНИЕ: Переменная RENDER_EXTERNAL_URL не найдена. Вебхук Telegram не установлен!');
}

// Вебхук от ЮKassa
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
    res.send('Server is running with webhooks, multi-model Gemini AI & Firebase!');
});

app.listen(PORT, () => {
    console.log(`Web server is running on port ${PORT}`);
});
