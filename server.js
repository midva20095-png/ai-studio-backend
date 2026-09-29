const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

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
        console.log(`Баланс пользователя ${userId} изменен на ${amount}. Итог: ${newBalance}`);
        return newBalance;
    } catch (error) {
        console.error('Ошибка обновления баланса:', error);
        return 0;
    }
}

// Генерация ссылки на оплату
async function generatePaymentLink(ctx, userId, amountRub, coinsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const body = {
        amount: { value: `${amountRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: 'https://t.me/' + (await bot.telegram.getMe()).username },
        capture: true,
        description: `Покупка ${coinsCount} токенов (Сумма: ${amountRub} руб)`,
        metadata: { user_id: String(userId), coins: String(coinsCount) }
    };

    try {
        const response = await axios.post(url, body, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Idempotence-Key': Math.random().toString(36).substring(7)
            }
        });

        const paymentData = {
            confirmationUrl: response.data.confirmation.confirmation_url,
            paymentId: response.data.id
        };

        return ctx.reply(
            `💳 Ссылка на оплату создана!\n\n` +
            `💵 Сумма: ${amountRub} руб.\n` +
            `🪙 Токенов к зачислению: ${coinsCount}\n\n` +
            `⚠️ *Оплатите по ссылке, а затем нажмите кнопку «🔄 Проверить оплату»:*`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(`🔗 Оплатить ${amountRub} руб.`, paymentData.confirmationUrl)],
                    [Markup.button.callback(`🔄 Проверить оплату`, `check_${paymentData.paymentId}`)],
                    [Markup.button.callback(`🔙 Назад`, `menu_buy`)]
                ])
            }
        );
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.response?.data || error.message);
        return ctx.reply('❌ Ошибка создания платежа в ЮKassa. Попробуйте позже.');
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

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const balance = await getBalance(userId);
    const currentModelKey = userModels[userId] || 'flash';
    
    ctx.reply(
        `Привет! Я твой ИИ-помощник.\n\n` +
        `💰 Твой баланс: ${balance} 🪙\n` +
        `🤖 Текущая модель: *${MODELS[currentModelKey].name}*\n\n` +
        `Выбери нужную модель или пополни баланс:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Gemini 3.8 Flash (1 токен)', 'set_model_flash')],
            [Markup.button.callback('🧠 Nano Banana Pro (5 токенов)', 'set_model_pro')],
            [Markup.button.callback('💳 Пополнить баланс', 'menu_buy')]
        ])
    );
});

bot.action('set_model_flash', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'flash';
    await ctx.answerCbQuery('Выбрана модель Gemini 3.8 Flash');
    ctx.reply('✅ Успешно! Активна модель **Gemini 3.8 Flash**.');
});

bot.action('set_model_pro', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'pro';
    await ctx.answerCbQuery('Выбрана модель Nano Banana Pro');
    ctx.reply('🧠 Успешно! Активна премиум-модель **Nano Banana Pro**.');
});

bot.action('menu_buy', async (ctx) => {
    await ctx.answerCbQuery();
    
    ctx.reply(
        `💳 *Пополнение баланса*\n\n` +
        `Выберите пакет токенов:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💎 1 рубль (1 токен - тест)', 'pay_1')],
                [Markup.button.callback('🪙 50 руб (10 токенов)', 'pay_50'), Markup.button.callback('🪙 100 руб (20 токенов)', 'pay_100')],
                [Markup.button.callback('🪙 500 руб (100 токенов)', 'pay_500'), Markup.button.callback('🪙 1000 руб (200 токенов)', 'pay_1000')],
                [Markup.button.callback('🚀 5000 руб (1000 токенов)', 'pay_5000')],
                [Markup.button.callback('🔙 На главную', 'back_to_main')]
            ])
        }
    );
});

// Кнопки пополнения
bot.action('pay_1', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1, 1); });
bot.action('pay_50', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 50, 10); });
bot.action('pay_100', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 100, 20); });
bot.action('pay_500', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 500, 100); });
bot.action('pay_1000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1000, 200); });
bot.action('pay_5000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 5000, 1000); });

bot.action('back_to_main', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await getBalance(userId);
    const currentModelKey = userModels[userId] || 'flash';
    ctx.reply(
        `💰 Твой баланс: ${balance} 🪙\n🤖 Текущая модель: *${MODELS[currentModelKey].name}*`,
        Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Gemini 3.8 Flash (1 токен)', 'set_model_flash')],
            [Markup.button.callback('🧠 Nano Banana Pro (5 токенов)', 'set_model_pro')],
            [Markup.button.callback('💳 Пополнить баланс', 'menu_buy')]
        ])
    );
});

// ПРОВЕРКА С ЗАЩИТОЙ ОТ ПОВТОРНОГО ИСПОЛЬЗОВАНИЯ ПЛАТЕЖА
bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const userId = ctx.from.id;

    await ctx.answerCbQuery('Проверяем платеж...');

    // Защита: проверяем, не был ли этот платеж уже использован раньше
    const paymentRef = db.collection('processed_payments').doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (paymentDoc.exists) {
        return ctx.reply('❌ Этот платеж уже был использован ранее! Повторно получить токены по нему нельзя.');
    }

    const paymentInfo = await checkPaymentStatus(paymentId);
    if (!paymentInfo) {
        return ctx.reply('❌ Не удалось связаться с платежной системой. Попробуйте позже.');
    }

    // ЕСЛИ ОПЛАТИЛ УСПЕШНО
    if (paymentInfo.status === 'succeeded') {
        const coins = parseInt(paymentInfo.metadata?.coins) || 1;
        const amountPaid = paymentInfo.amount?.value || '';

        // Помечаем платеж как использованный в базе (защита от абуза)
        await paymentRef.set({
            userId: userId,
            coins: coins,
            used_at: new Date()
        });

        // Начисляем токены на баланс
        const newBalance = await updateBalance(userId, coins);

        return ctx.reply(
            `✅ Вы успешно купили ${coins} токенов этой херни! (Сумма: ${amountPaid} руб.)\n` +
            `🎉 Баланс успешно пополнен.\n` +
            `💰 Ваш текущий баланс: ${newBalance} 🪙`
        );
    } 
    // ЕСЛИ НЕ ОПЛАТИЛ НИХУЯ
    else {
        return ctx.reply(
            `❌ Вы не оплатили нихуя! Платеж не найден или находится в статусе: ${paymentInfo.status}.\n` +
            `Деньги не списаны, токены не начислены.`
        );
    }
});

// Обработка текстовых сообщений (общение с ИИ)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    const modelKey = userModels[userId] || 'flash';
    const selectedModel = MODELS[modelKey];
    const balance = await getBalance(userId);

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ Недостаточно токенов на балансе!\n\n` +
            `🤖 Модель: ${selectedModel.name}\n` +
            `📉 Требуется: ${selectedModel.cost} 🪙\n` +
            `💰 Ваш баланс: ${balance} 🪙\n\n` +
            `Пожалуйста, пополните баланс:`,
            Markup.inlineKeyboard([[Markup.button.callback('💳 Пополнить баланс', 'menu_buy')]])
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

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Telegram webhook успешно установлен на ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    console.warn('ВНИМАНИЕ: Переменная RENDER_EXTERNAL_URL не найдена. Вебхук Telegram не установлен!');
}

app.get('/', (req, res) => {
    res.send('Server is running safely!');
});

app.listen(PORT, () => {
    console.log(`Web server is running on port ${PORT}`);
});
