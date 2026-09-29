const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const bot = new Telegraf(BOT_TOKEN);

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const MODELS = {
    'flash': { name: '⚡ Gemini 3.8 Flash', modelId: 'gemini-3.8-flash', cost: 1 },
    'pro': { name: '🧠 Nano Banana Pro', modelId: 'gemini-3.1-pro-preview', cost: 5 }
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

async function sendMainMenu(ctx, edit = false) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const balance = await callGoogleSheet('get', userId, username);
    const modelKey = userModels[userId] || 'flash';

    const text = 
        `🤖 **AI Studio Bot**\n\n` +
        `👤 Пользователь: *${username}*\n` +
        `💰 Баланс: *${balance !== null ? balance : '0'} 🪙*\n` +
        `⚙️ Модель: *${MODELS[modelKey].name}*\n\n` +
        `Выберите модель или отправьте сообщение для генерации:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚡ Flash (1 токен)', 'set_flash')],
        [Markup.button.callback('🧠 Nano Banana Pro (5 токенов)', 'set_pro')],
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
    await ctx.answerCbQuery('Выбрана модель Nano Banana Pro');
    await sendMainMenu(ctx, true);
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    if (text.startsWith('/')) return;

    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица).');
    }

    const modelKey = userModels[userId] || 'flash';
    const selectedModel = MODELS[modelKey];

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ **Недостаточно токенов!**\n\n` +
            `🤖 Модель: ${selectedModel.name}\n` +
            `📉 Требуется: ${selectedModel.cost} 🪙 | Баланс: ${balance} 🪙\n\n` +
            `Обратитесь к администратору для пополнения баланса.`
        );
    }

    await ctx.sendChatAction('typing');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: text,
        });

        const aiReply = response.text || 'Пустой ответ от нейросети.';
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -selectedModel.cost);

        await ctx.reply(`${aiReply}\n\n*(${selectedModel.name} | Списано: ${selectedModel.cost} 🪙 | Остаток: ${newBalance} 🪙)*`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка AI:', error);
        await ctx.reply('⚠️ Произошла ошибка при обращении к нейросети.');
    }
});

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
