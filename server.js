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
    console.error('КРИТИЧЕСКАЯ ОШИБКА: Ключ Firebase не найден! База данных не будет работать.');
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

// Жесткая работа с базой данных для каждого пользователя (Личный кабинет)
async function getOrCreateUser(userId, username = '') {
    try {
        const userRef = db.collection('users').doc(String(userId));
        const doc = await userRef.get();
        
        if (!doc.exists) {
            // Новый пользователь — даем стартовые 5 токенов и фиксируем в базе
            const initialData = {
                userId: String(userId),
                username: username || 'unknown',
                balance: 5,
                created_at: new Date()
            };
            await userRef.set(initialData);
            console. зарегистрирован новый пользователь: ${userId}`);
            return 5;
        }
        
        return Number(doc.data().balance) || 0;
    } catch (error) {
        console.error('Ошибка работы с Firestore (getBalance):', error);
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
        await userRef.set({ 
            balance: newBalance, 
            updated_at: new Date() 
        }, { merge: true });
        
        console.log(`Баланс пользователя ${userId} изменен на ${amount}. Итог в базе: ${newBalance}`);
        return newBalance;
    } catch (error) {
        console.error('Ошибка обновления баланса в базе:', error);
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
                    [Markup.button.callback(`🔙 На главную`, `menu_main`)]
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

// Стартовая команда /start (Регистрация в базе + личный кабинет)
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    
    const balance = await getOrCreateUser(userId, username);
    const currentModelKey = userModels[userId] || 'flash';
    
    ctx.reply(
        `👋 Добро пожаловать в личный кабинет, *${username}*!\n\n` +
        `🆔 Ваш ID в системе: \`${userId}\`\n` +
        `💰 Ваш баланс: *${balance} 🪙* токенов\n` +
        `🤖 Текущая модель: *${MODELS[currentModelKey].name}*\n\n` +
        `Вы зарегистрированы в базе данных. Выбирайте модель или пополняйте баланс:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('⚡ Gemini 3.8 Flash (1 токен)', 'set_model_flash')],
                [Markup.button.callback('🧠 Nano Banana Pro (5 токенов)', 'set_model_pro')],
                [Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]
            ])
        }
    );
});

bot.action('set_model_flash', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'flash';
    await ctx.answerCbQuery('Выбрана модель Gemini 3.8 Flash');
    ctx.reply('✅ Активна модель **Gemini 3.8 Flash**.');
});

bot.action('set_model_pro', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'pro';
    await ctx.answerCbQuery('Выбрана модель Nano Banana Pro');
    ctx.reply('🧠 Активна премиум-модель **Nano Banana Pro**.');
});

bot.action('menu_buy', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await getOrCreateUser(userId);

    ctx.reply(
        `💳 *Личный кабинет и пополнение баланса*\n\n` +
        `👤 ID: \`${userId}\`\n` +
        `💰 Текущий баланс: *${balance} 🪙*\n\n` +
        `Выберите пакет токенов для покупки:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💎 1 рубль (1 токен - тест)', 'pay_1')],
                [Markup.button.callback('🪙 50 руб (10 токенов)', 'pay_50'), Markup.button.callback('🪙 100 руб (20 токенов)', 'pay_100')],
                [Markup.button.callback('🪙 500 руб (100 токенов)', 'pay_500'), Markup.button.callback('🪙 1000 руб (200 токенов)', 'pay_1000')],
                [Markup.button.callback('🚀 5000 руб (1000 токенов)', 'pay_5000')],
                [Markup.button.callback('🔙 На главную', 'menu_main')]
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

bot.action('menu_main', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await getOrCreateUser(userId);
    const currentModelKey = userModels[userId] || 'flash';
    
    ctx.reply(
        `🏠 Главное меню\n\n` +
        `💰 Баланс: *${balance} 🪙*\n` +
        `🤖 Модель: *${MODELS[currentModelKey].name}*`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('⚡ Gemini 3.8 Flash (1 токен)', 'set_model_flash')],
                [Markup.button.callback('🧠 Nano Banana Pro (5 токенов)', 'set_model_pro')],
                [Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]
            ])
        }
    );
});

// ПРОВЕРКА ОПЛАТЫ С ЗАЩИТОЙ И СОХРАНЕНИЕМ В БАЗУ
bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const userId = ctx.from.id;

    await ctx.answerCbQuery('Проверяем платеж в системе...');

    // Защита от повторного использования чека
    const paymentRef = db.collection('processed_payments').doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (paymentDoc.exists) {
        return ctx.reply('❌ Этот чек уже был активирован ранее! Повторно получить токены по нему нельзя.');
    }

    const paymentInfo = await checkPaymentStatus(paymentId);
    if (!paymentInfo) {
        return ctx.reply('❌ Не удалось связаться с ЮKassa. Попробуйте позже.');
    }

    // ЕСЛИ ОПЛАТИЛ УСПЕШНО
    if (paymentInfo.status === 'succeeded') {
        const coins = parseInt(paymentInfo.metadata?.coins) || 1;
        const amountPaid = paymentInfo.amount?.value || '';

        // Фиксируем чек в базе, чтобы сжечь его от повторного юза
        await paymentRef.set({
            userId: userId,
            coins: coins,
            used_at: new Date()
        });

        // Начисляем токены НАПРЯМУЮ В FIRESTORE
        const newBalance = await updateBalance(userId, coins);

        return ctx.reply(
            `✅ Успешная оплата!\n` +
            `Вы купили ${coins} токенов этой херни (Сумма: ${amountPaid} руб.).\n` +
            `🎉 Баланс в личном кабинете успешно пополнен!\n\n` +
            `💰 Ваш текущий баланс: *${newBalance} 🪙*`,
            { parse_mode: 'Markdown' }
        );
    } 
    // ЕСЛИ НЕ ОПЛАТИЛ
    else {
        return ctx.reply(
            `❌ Вы не оплатили нихуя! Платеж не прошел или имеет статус: ${paymentInfo.status}.\n` +
            `Деньги не списаны, токены не начислены.`
        );
    }
});

// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (Общение с ИИ с проверкой базы)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    // Защита от левых типов: если пользователя нет в базе (не нажал /start), отправляем нахуй регистрироваться
    const balance = await getOrCreateUser(userId, ctx.from.username);

    const modelKey = userModels[userId] || 'flash';
    const selectedModel = MODELS[modelKey];

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ Недостаточно токенов в личном кабинете!\n\n` +
            `🤖 Модель: ${selectedModel.name}\n` +
            `📉 Требуется: ${selectedModel.cost} 🪙\n` +
            `💰 Ваш баланс: ${balance} 🪙\n\n` +
            `Пожалуйста, пополните баланс в личном кабинете:`,
            Markup.inlineKeyboard([[Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]])
        );
    }

    try {
        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: text,
        });

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
        
        // Списываем токены прямо в базе данных Firestore
        const newBalance = await updateBalance(userId, -selectedModel.cost);

        ctx.reply(`${aiReply}\n\n*(${selectedModel.name} | Списано: ${selectedModel.cost} 🪙 | Остаток в ЛК: ${newBalance} 🪙)*`, { parse_mode: 'Markdown' });
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
    res.send('Server is running with Firestore user profiles & payment check!');
});

app.listen(PORT, () => {
    console.log(`Web server is running on port ${PORT}`);
});
