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

// Полный каталог моделей и инструментов с рыночными ценами в рублях
const MODELS = {
    // Основные текстовые и мультимодальные модели
    'pro_3_1': { name: '🧠 Gemini 3.1 Pro (Thinking)', modelId: 'gemini-2.5-pro', cost: 25 },
    'flash_3_8': { name: '⚡ Gemini 3.8 / 3.5 Flash', modelId: 'gemini-2.5-flash', cost: 12 },
    'flash_lite': { name: '🚀 Gemini 3.1 Flash-Lite', modelId: 'gemini-2.5-flash-lite', cost: 8 },
    'pro_2_5': { name: '🧠 Gemini 2.5 Pro', modelId: 'gemini-2.5-pro', cost: 20 },
    
    // Специализированные ИИ-агенты и инструменты
    'deep_research': { name: '🔎 Deep Research', modelId: 'gemini-2.5-pro', cost: 40 },
    'antigravity': { name: '🛠️ Antigravity Agent', modelId: 'gemini-2.5-pro', cost: 35 },
    'jules': { name: '💻 Jules Dev Assistant', modelId: 'gemini-2.5-pro', cost: 30 },

    // Медиагенерация (изображения, видео, аудио)
    'nano_banana': { name: '🎨 Nano Banana Pro', modelId: 'gemini-2.5-flash', cost: 15 },
    'veo': { name: '🎬 Veo Video Generator', modelId: 'gemini-2.5-flash', cost: 50 },
    'lyria': { name: '🎵 Lyria 3.5 Music', modelId: 'gemini-2.5-flash', cost: 35 },
    
    // Открытые модели
    'gemma': { name: '🌐 Gemma 4 Open Model', modelId: 'gemini-2.5-flash-lite', cost: 8 }
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

// Главное меню по твоему визуальному примеру (сетка кнопок)
async function sendMainMenu(ctx, edit = false) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const balance = await callGoogleSheet('get', userId, username);
    const modelKey = userModels[userId] || 'flash_3_8';

    const text = 
        `🤖 **AI Studio Hub — Панель управления**\n\n` +
        `👤 Пользователь: *${username}*\n` +
        `💰 Баланс: *${balance !== null ? balance : '0'} 🪙*\n` +
        `⚙️ Активный инструмент: *${MODELS[modelKey].name}* (${MODELS[modelKey].cost} 🪙)\n\n` +
        `Выберите нужный раздел или модель ниже:`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('🎛️ Выбрать модель', 'menu_models'),
            Markup.button.callback('🎨 Создать картинку', 'set_nano_banana')
        ],
        [
            Markup.button.callback('🌐 Интернет-поиск', 'set_deep_research'),
            Markup.button.callback('🎬 Создать видео', 'set_veo')
        ],
        [
            Markup.button.callback('📊 Презентации', 'menu_tools'),
            Markup.button.callback('🎵 Создать песню', 'set_lyria')
        ],
        [
            Markup.button.callback('⭐ Премиум', 'menu_premium'),
            Markup.button.callback('👤 Мой профиль', 'profile_info')
        ],
        [
            Markup.button.callback('🔄 Обновить баланс', 'refresh_menu')
        ]
    ]);

    try {
        if (edit && ctx.callbackQuery) {
            return ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        }
    } catch (e) {}

    return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

// Подменю выбора моделей
async function sendModelsMenu(ctx) {
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🧠 Gemini 3.1 Pro (Thinking)', 'set_pro_3_1')],
        [Markup.button.callback('⚡ Gemini 3.8 / 3.5 Flash', 'set_flash_3_8')],
        [Markup.button.callback('🚀 Gemini Flash-Lite', 'set_flash_lite')],
        [Markup.button.callback('🔍 Deep Research Agent', 'set_deep_research')],
        [Markup.button.callback('🛠️ Antigravity Agent', 'set_antigravity')],
        [Markup.button.callback('🔙 Назад в меню', 'refresh_menu')]
    ]);

    await ctx.editMessageText('⚙️ **Выберите модель или агента:**', { parse_mode: 'Markdown', ...keyboard });
}

bot.start(async (ctx) => {
    await sendMainMenu(ctx, false);
});

bot.command('menu', async (ctx) => {
    await sendMainMenu(ctx, false);
});

bot.action('refresh_menu', async (ctx) => {
    await ctx.answerCbQuery('Меню обновлено');
    await sendMainMenu(ctx, true);
});

bot.action('menu_models', async (ctx) => {
    await sendModelsMenu(ctx);
});

bot.action('menu_tools', async (ctx) => {
    await ctx.answerCbQuery('Инструменты презентаций и анализа в разработке');
});

bot.action('menu_premium', async (ctx) => {
    await ctx.answerCbQuery('Премиум-доступ активен для всех моделей!');
});

bot.action('profile_info', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const balance = await callGoogleSheet('get', userId, username);
    await ctx.answerCbQuery(`ID: ${userId} | Баланс: ${balance} токенов`);
});

// Назначение моделей через кнопки
const modelActions = {
    'set_pro_3_1': 'pro_3_1',
    'set_flash_3_8': 'flash_3_8',
    'set_flash_lite': 'flash_lite',
    'set_deep_research': 'deep_research',
    'set_antigravity': 'antigravity',
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

// Обработка запросов (текст и фото / мультимодальность)
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
            `Пополните баланс для продолжения работы.`
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
                promptText || 'Проанализируй это изображение.'
            ];
        } else {
            contents = promptText;
        }

        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: contents,
        });

        const aiReply = response.text || 'Генерация завершена успешно.';
        const newBalance = await callGoogleSheet('update', userId, username, -selectedModel.cost);

        await ctx.reply(`${aiReply}\n\n*(${selectedModel.name} | Списано: ${selectedModel.cost} 🪙 | Остаток: ${newBalance} 🪙)*`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка ИИ:', error);
        await ctx.reply('⚠️ Произошла ошибка при обработке запроса нейросетью.');
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

app.get('/', (req, res) => {
    res.send('AI Studio Hub Bot is running!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
