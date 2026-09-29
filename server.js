const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
// Раздаем статику для Mini App (папка public)
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const bot = new Telegraf(BOT_TOKEN);

const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const MODELS = {
    'flash': { name: '⚡ Gemini 3.8 Flash (Быстрая)', modelId: 'gemini-3.8-flash', cost: 1 },
    'pro': { name: '🧠 Nano Banana Pro (Продвинутая)', modelId: 'gemini-3.1-pro-preview', cost: 5 }
};

const userModels = {};

async function callGoogleSheet(action, userId, username = '', amount = 0) {
    try {
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
            action: action,
            userId: String(userId),
            username: username,
            amount: amount
        });
        return response.data.balance;
    } catch (error) {
        console.error('Ошибка связи с Google Таблицей:', error.message);
        return null;
    }
}

// Главное меню с Mini App и кнопкой выбора моделей
async function sendMainMenu(ctx, edit = false) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const balance = await callGoogleSheet('get', userId, username);
    const modelKey = userModels[userId] || 'flash';
    const webAppUrl = process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}` : 'https://google.com';

    const text = 
        `✨ **AI Studio Control Center**\n\n` +
        `👤 Пользователь: *${username}*\n` +
        `💰 Баланс: *${balance !== null ? balance : '0'} 🪙*\n` +
        `🤖 Активная модель: *${MODELS[modelKey].name}*\n\n` +
        `👇 Управляй балансом в Mini App или выбери модель ниже:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.webApp('🌐 Открыть Личный Кабинет (Mini App)', webAppUrl)],
        [Markup.button.callback('⚡ Модель: Flash (1 токен)', 'set_flash'), Markup.button.callback('🧠 Модель: Pro (5 токенов)', 'set_pro')],
        [Markup.button.callback('🔄 Обновить баланс', 'refresh_menu')]
    ]);

    try {
        if (edit && ctx.callbackQuery) {
            return ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        }
    } catch (e) {}

    return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

bot.start(async (ctx) => {
    // Устанавливаем кнопку меню для пользователя
    try {
        await ctx.telegram.setChatMenuButton({
            chat_id: ctx.chat.id,
            menu_button: { type: 'commands' }
        });
    } catch (e) {}

    await sendMainMenu(ctx, false);
});

bot.command('menu', async (ctx) => {
    await sendMainMenu(ctx, false);
});

bot.action('refresh_menu', async (ctx) => {
    await ctx.answerCbQuery('Баланс обновлен!');
    await sendMainMenu(ctx, true);
});

bot.action('set_flash', async (ctx) => {
    userModels[ctx.from.id] = 'flash';
    await ctx.answerCbQuery('Выбрана модель Flash');
    await sendMainMenu(ctx, true);
});

bot.action('set_pro', async (ctx) => {
    userModels[ctx.from.id] = 'pro';
    await ctx.answerCbQuery('Выбрана модель Pro');
    await sendMainMenu(ctx, true);
});

// Обработка текстовых запросов к ИИ с очисткой интерфейса
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    if (text.startsWith('/')) return;

    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных. Попробуйте позже.');
    }

    const modelKey = userModels[userId] || 'flash';
    const selectedModel = MODELS[modelKey];

    if (balance < selectedModel.cost) {
        const webAppUrl = process.env.RENDER_EXTERNAL_URL;
        return ctx.reply(
            `❌ **Недостаточно токенов!**\n\n` +
            `Требуется: ${selectedModel.cost} 🪙 | Баланс: ${balance} 🪙`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('💳 Пополнить в Mini App', webAppUrl)]
                ])
            }
        );
    }

    // Отправляем статус «печатает»
    await ctx.sendChatAction('typing');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: text,
        });

        const aiReply = response.text || 'Пустой ответ от нейросети.';
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -selectedModel.cost);

        // Отправляем чистый ответ БЕЗ назойливых клавиатур, чтобы не засирать экран телефона
        await ctx.reply(`${aiReply}\n\n*(Списано: ${selectedModel.cost} 🪙 | Остаток: ${newBalance} 🪙)*`);
    } catch (error) {
        console.error('Ошибка AI:', error);
        await ctx.reply('⚠️ Произошла ошибка при обращении к нейросети.');
    }
});

// API эндпоинт для Mini App (чтобы сайт мог узнать баланс и создать платеж)
app.post('/api/get-user', async (req, res) => {
    const { userId, username } = req.body;
    const balance = await callGoogleSheet('get', userId, username || 'User');
    res.json({ balance: balance !== null ? balance : 0 });
});

app.post('/api/create-invoice', async (req, res) => {
    const { userId, amountRub, coinsCount } = req.body;
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const body = {
        amount: { value: `${amountRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: process.env.RENDER_EXTERNAL_URL },
        capture: true,
        description: `Покупка ${coinsCount} токенов`,
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
        res.json({ confirmationUrl: response.data.confirmation.confirmation_url, paymentId: response.data.id });
    } catch (error) {
        res.status(500).json({ error: 'Payment creation failed' });
    }
});

// Проверка платежа из Mini App
app.post('/api/check-payment', async (req, res) => {
    const { paymentId, userId, coins } = req.body;
    const url = `https://api.yookassa.ru/v3/payments/${paymentId}`;
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    try {
        const response = await axios.get(url, { headers: { 'Authorization': `Basic ${authString}` } });
        if (response.data.status === 'succeeded') {
            const newBalance = await callGoogleSheet('update', userId, '', parseInt(coins));
            return res.json({ success: true, newBalance });
        }
        res.json({ success: false, status: response.data.status });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
