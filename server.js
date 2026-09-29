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
    'pro_3_1': { name: '🧠 Gemini 3.1 Pro (Thinking)', modelId: 'gemini-2.5-pro', cost: 25 },
    'flash_3_8': { name: '⚡ Gemini 3.8 / 3.5 Flash', modelId: 'gemini-2.5-flash', cost: 12 },
    'flash_lite': { name: '🚀 Gemini 3.1 Flash-Lite', modelId: 'gemini-2.5-flash-lite', cost: 8 },
    'nano_banana': { name: '🎨 Nano Banana Pro', modelId: 'gemini-2.5-flash', cost: 15 },
    'veo': { name: '🎬 Veo Video Generator', modelId: 'gemini-2.5-flash', cost: 50 },
    'lyria': { name: '🎵 Lyria 3.5 Music', modelId: 'gemini-2.5-flash', cost: 35 }
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
    const modelKey = userModels[userId] || 'flash_3_8';

    const text = 
        `🤖 **AI Studio Hub — Панель управления**\n\n` +
        `👤 Пользователь: *${username}*\n` +
        `💰 Баланс: *${balance !== null ? balance : '0'} 🪙*\n` +
        `⚙️ Инструмент: *${MODELS[modelKey].name}* (${MODELS[modelKey].cost} 🪙)\n\n` +
        `Выберите нужный инструмент или модель:`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('⚡ Flash 3.8', 'set_flash_3_8'),
            Markup.button.callback('🧠 Pro 3.1', 'set_pro_3_1')
        ],
        [
            Markup.button.callback('🚀 Flash-Lite', 'set_flash_lite'),
            Markup.button.callback('🎨 Nano Banana', 'set_nano_banana')
        ],
        [
            Markup.button.callback('🎬 Veo Video', 'set_veo'),
            Markup.button.callback('🎵 Lyria Music', 'set_lyria')
        ],
        [
            Markup.button.callback('🔄 Обновить баланс', 'refresh_menu')
        ]
    ]);

    try {
        if (edit && ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch((err) => {
                // Игнорируем ошибку, если текст сообщения не изменился
                if (!err.description?.includes('message is not modified')) {
                    console.error('Ошибка редактирования сообщения:', err);
                }
            });
            return;
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
    await ctx.answerCbQuery('Баланс проверен!');
    await sendMainMenu(ctx, true);
});

const modelActions = {
    'set_flash_3_8': 'flash_3_8',
    'set_pro_3_1': 'pro_3_1',
    'set_flash_lite': 'flash_lite',
    'set_nano_banana': 'nano_banana',
    'set_veo': 'veo',
    'set_lyria': 'lyria'
};

for (const [actionName, modelKey] of Object.entries(modelActions)) {
    bot.action(actionName, async (ctx) => {
        userModels[ctx.from.id] = modelKey;
        await ctx.answerCbQuery(`Выбрано: ${MODELS[modelKey].name}`);
        await sendMainMenu(ctx, true);
    });
}

async function handleUserQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';

    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица).');
    }

    const modelKey = userModels[userId] || 'flash_3_8';
    const selectedModel = MODELS[modelKey];

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ **Недостаточно токенов!**\n\n` +
            `🛠️ Инструмент: ${selectedModel.name}\n` +
            `📉 Требуется: ${selectedModel.cost} 🪙 | Баланс: ${balance} 🪙\n\n` +
            `Обратитесь к администратору для пополнения баланса.`
        );
    }

    await ctx.sendChatAction('typing');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        let contents = [];

        if (photoBuffer) {
            const base64Image = photoBuffer.toString('base64');
            contents = [
                {
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Image
                    }
                },
                promptText || 'Опиши это изображение.'
            ];
        } else {
            contents = promptText;
        }

        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: contents,
        });

        const aiReply = response.text || 'Ответ от нейросети получен.';
        const newBalance = await callGoogleSheet('update', userId, username, -selectedModel.cost);

        await ctx.reply(`${aiReply}\n\n*(${selectedModel.name} | Списано: ${selectedModel.cost} 🪙 | Остаток: ${newBalance} 🪙)*`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка ИИ:', error);
        await ctx.reply('⚠️ Произошла ошибка при обращении к нейросети.');
    }
}

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    await handleUserQuery(ctx, text, null);
});

bot.on('photo', async (ctx) => {
    const photoArray = ctx.message.photo;
    const photo = photoArray[photoArray.length - 1];
    const caption = ctx.message.caption || 'Что изображено на фото?';

    try {
        const fileLink = await bot.telegram.getFileLink(photo.file_id);
        const imageResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const photoBuffer = Buffer.from(imageResponse.data);

        await handleUserQuery(ctx, caption, photoBuffer);
    } catch (e) {
        console.error('Ошибка загрузки фото:', e);
        await ctx.reply('❌ Не удалось обработать прикрепленное фото.');
    }
});

const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://ai-studio-backend-06so.onrender.com';
app.use(bot.webhookCallback('/telegraf/webhook'));
bot.telegram.setWebhook(`${RENDER_URL}/telegraf/webhook`);

app.get('/', (req, res) => {
    res.send('AI Studio Bot Server is running!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
