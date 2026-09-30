const express = require('express');
const cors = require('cors');
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- ИНИЦИАЛИЗАЦИЯ КЛЮЧЕЙ СЕРВЕРА ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID;
const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// =========================================================================
// 🎯 ТАРИФНАЯ СЕТКА, ЛИМИТЫ И НАСТРОЙКИ МОДЕЛЕЙ
// Изменяйте 'cost', 'maxChars' и 'maxOutputTokens' здесь — кнопки обновятся автоматически.
// =========================================================================
const MODELS = {
    'flash': {
        name: '⚡ Flash (Gemini 2.0)',
        modelId: 'gemini-2.0-flash',
        type: 'text',
        cost: 1,             // Стоимость в монетах
        maxChars: 4000,      // Лимит символов на вход (от пользователя)
        maxOutputTokens: 2048 // Максимальная длина ответа
    },
    'pro': {
        name: '🧠 Pro (Gemini 1.5)',
        modelId: 'gemini-1.5-pro',
        type: 'text',
        cost: 3,
        maxChars: 12000,
        maxOutputTokens: 4096
    },
    'nano_banana_2_lite': {
        name: '🏎 Nano Banana 2 Lite',
        modelId: 'imagen-3.0-fast-generate-001',
        type: 'image',
        cost: 1,
        maxChars: 800,
        qualityPrompt: 'fast generation, high quality'
    },
    'nano_banana_2': {
        name: '🎨 Nano Banana 2',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 2,
        maxChars: 800,
        qualityPrompt: 'high quality, detailed, professional photo'
    },
    'nano_banana_pro': {
        name: '✨ Nano Banana Pro',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 4,
        maxChars: 800,
        qualityPrompt: 'ultra-hd quality, highly detailed, photorealistic, 4k'
    }
};

// Пакеты пополнения баланса ЮKassa
const PAYMENT_PACKAGES = [
    { id: 'start', name: 'Старт', priceRub: 150, coins: 30 },
    { id: 'standard', name: 'Стандарт', priceRub: 500, coins: 100 },
    { id: 'lux', name: 'Люкс', priceRub: 1000, coins: 250 },
    { id: 'vip', name: 'VIP', priceRub: 2500, coins: 650 }
];

const MENU_BUTTONS = {
    SELECT_MODEL: '🚀 Выбрать модель',
    SETTINGS: '⚙️ Настройки',
    BALANCE: '💳 Баланс / Пополнить',
    PROFILE: 'ℹ️ Профиль'
};

const userState = {};
const isProcessing = new Set();

function getUserState(userId) {
    if (!userState[userId]) {
        userState[userId] = { model: 'flash', aspect_ratio: '1:1' };
    }
    return userState[userId];
}

async function safeReply(ctx, text, extra = {}) {
    try {
        return await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
    } catch (e) {
        const cleanExtra = { ...extra };
        delete cleanExtra.parse_mode;
        return await ctx.reply(text, cleanExtra);
    }
}

// Запрос к Google Таблицам (Баланс)
async function callGoogleSheet(action, userId, username = '', amount = 0) {
    try {
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
            action,
            userId: String(userId),
            username,
            amount
        });
        return response.data?.balance ?? null;
    } catch (error) {
        console.error('Ошибка Google Sheets API:', error.message);
        return null;
    }
}

// --- КЛАВИАТУРА И МЕНЮ ---
const mainMenuKeyboard = Markup.keyboard([
    [MENU_BUTTONS.SELECT_MODEL, MENU_BUTTONS.SETTINGS],
    [MENU_BUTTONS.BALANCE, MENU_BUTTONS.PROFILE]
]).resize();

bot.start((ctx) => {
    getUserState(ctx.from.id);
    safeReply(ctx, `👋 **Добро пожаловать в AI Studio!**\n\nВыберите модель из меню ниже и отправьте ваш запрос.`, mainMenuKeyboard);
});

// ДИНАМИЧЕСКИЙ ВЫВОД КНОПОК МОДЕЛЕЙ (с ценами и лимитами)
bot.hears(MENU_BUTTONS.SELECT_MODEL, (ctx) => {
    const buttons = Object.keys(MODELS).map((key) => {
        const m = MODELS[key];
        return [Markup.button.callback(`${m.name} — ${m.cost} 🪙 (до ${m.maxChars} симв.)`, `set_model_${key}`)];
    });

    safeReply(ctx, '🤖 **Выберите нейросеть для работы:**\n\nЦена и максимальный лимит указаны на кнопках:', Markup.inlineKeyboard(buttons));
});

bot.hears(MENU_BUTTONS.SETTINGS, (ctx) => {
    const state = getUserState(ctx.from.id);
    const r = state.aspect_ratio;
    safeReply(ctx, `⚙️ **Настройки пропорций генерации картинок:**\nТекущие пропорции: **${r}**`, Markup.inlineKeyboard([
        [Markup.button.callback(`1:1 (Квадрат) ${r === '1:1' ? '✅' : ''}`, 'set_ratio_1:1')],
        [Markup.button.callback(`16:9 (Широкий) ${r === '16:9' ? '✅' : ''}`, 'set_ratio_16:9')],
        [Markup.button.callback(`9:16 (Вертикальный) ${r === '9:16' ? '✅' : ''}`, 'set_ratio_9:16')],
        [Markup.button.callback(`4:3 (Альбом) ${r === '4:3' ? '✅' : ''}`, 'set_ratio_4:3')],
        [Markup.button.callback(`3:4 (Портрет) ${r === '3:4' ? '✅' : ''}`, 'set_ratio_3:4')]
    ]));
});

bot.hears(MENU_BUTTONS.BALANCE, async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    
    const payButtons = PAYMENT_PACKAGES.map(pkg => [
        Markup.button.callback(`${pkg.name}: ${pkg.priceRub} ₽ (${pkg.coins} 🪙)`, `pay_${pkg.id}`)
    ]);

    safeReply(ctx, `💳 Ваш текущий баланс: **${balance !== null ? balance : 'Ошибка'} 🪙**\n\nВыберите пакет пополнения:`, Markup.inlineKeyboard(payButtons));
});

bot.hears(MENU_BUTTONS.PROFILE, async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    const state = getUserState(userId);
    const m = MODELS[state.model] || MODELS['flash'];

    safeReply(ctx, 
        `👤 **Профиль пользователя**\n\n` +
        `🆔 ID: \`${userId}\`\n` +
        `💰 Баланс: **${balance !== null ? balance : 'Ошибка'} 🪙**\n` +
        `🤖 Активная модель: **${m.name}**\n` +
        `💵 Стоимость запроса: **${m.cost} 🪙**\n` +
        `📏 Лимит входа: **до ${m.maxChars} символов**\n` +
        `📐 Формат картинок: **${state.aspect_ratio}**`
    );
});

// --- CALLBACK ОБРАБОТЧИКИ ---
bot.action(/^set_model_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    if (!MODELS[key]) return ctx.answerCbQuery('Модель не найдена');

    const state = getUserState(ctx.from.id);
    state.model = key;
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        `✅ Активная модель: **${MODELS[key].name}**\n\n` +
        `💰 Стоимость: **${MODELS[key].cost} 🪙**\n` +
        `📏 Лимит длины запроса: **${MODELS[key].maxChars} символов**`, 
        { parse_mode: 'Markdown' }
    );
});

bot.action(/^set_ratio_(.+)$/, async (ctx) => {
    const ratio = ctx.match[1];
    const state = getUserState(ctx.from.id);
    state.aspect_ratio = ratio;
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ Выбран формат картинок: **${ratio}**`, { parse_mode: 'Markdown' });
});

bot.action(/^pay_(.+)$/, async (ctx) => {
    const pkg = PAYMENT_PACKAGES.find(p => p.id === ctx.match[1]);
    if (!pkg) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    try {
        const response = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: { value: `${pkg.priceRub}.00`, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: 'https://t.me/ai_studio_hub_bot' },
            capture: true,
            description: `Покупка ${pkg.coins} монет`,
            metadata: { user_id: String(ctx.from.id), coins: String(pkg.coins) }
        }, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Idempotence-Key': Math.random().toString(36).substring(7)
            }
        });

        await safeReply(
            ctx,
            `💳 **Счет на оплату создан**\n\nПакет: ${pkg.name}\nСумма: ${pkg.priceRub} ₽\nНачисление: ${pkg.coins} 🪙`,
            Markup.inlineKeyboard([
                [Markup.button.url(`🔗 Оплатить ${pkg.priceRub} ₽`, response.data.confirmation.confirmation_url)],
                [Markup.button.callback(`🔄 Проверить оплату`, `check_${response.data.id}`)]
            ])
        );
    } catch (e) {
        console.error('Ошибка ЮKassa:', e.message);
        await ctx.reply('❌ Ошибка при формировании счета.');
    }
});

bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    await ctx.answerCbQuery('Проверка...');

    try {
        const res = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
            headers: { 'Authorization': `Basic ${authString}` }
        });

        if (res.data.status === 'succeeded') {
            const coins = parseInt(res.data.metadata?.coins || 0);
            const newBalance = await callGoogleSheet('update', ctx.from.id, ctx.from.username, coins);
            await ctx.editMessageText(`✅ **Оплата прошла успешно!**\nЗачислено: ${coins} 🪙\nТекущий баланс: ${newBalance} 🪙`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(`⏳ Платеж обрабатывается. Статус: ${res.data.status}`);
        }
    } catch (e) {
        await ctx.reply('❌ Ошибка проверки статуса платежа.');
    }
});

// --- ЛОГИКА ОБРАБОТКИ AI ЗАПРОСОВ ---
async function handleAIQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'User';

    if (isProcessing.has(userId)) {
        return ctx.reply('⏳ Предыдущий запрос еще выполняется.');
    }

    const state = getUserState(userId);
    const model = MODELS[state.model] || MODELS['flash'];

    // 1. ПРОВЕРКА ДЛИНЫ ПРОМПТА ДО ВЫЗОВА API
    if (promptText && promptText.length > model.maxChars) {
        return safeReply(
            ctx,
            `⛔ **Превышен лимит длины запроса!**\n\n` +
            `Модель: **${model.name}**\n` +
            `Допустимо: **${model.maxChars}** символов\n` +
            `Ваш запрос: **${promptText.length}** символов\n\n` +
            `Пожалуйста, сократите текст.`
        );
    }

    // 2. ПРОВЕРКА СОВМЕСТИМОСТИ ФОТО
    if (photoBuffer && model.type === 'image') {
        return safeReply(ctx, `⚠️ Генераторы картинок не принимают фото на вход. Для анализа картинок переключитесь на текстовую модель (Flash или Pro).`);
    }

    // 3. ПРОВЕРКА БАЛАНСА
    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) return ctx.reply('❌ Ошибка связи с базой данных.');
    if (balance < model.cost) {
        return safeReply(ctx, `❌ **Недостаточно монет.**\nСтоимость запроса: ${model.cost} 🪙\nВаш баланс: ${balance} 🪙`);
    }

    isProcessing.add(userId);

    try {
        if (model.type === 'text') {
            await ctx.sendChatAction('typing');

            let contents;
            if (photoBuffer) {
                contents = [
                    promptText || 'Опиши детально это изображение.',
                    { inlineData: { mimeType: 'image/jpeg', data: photoBuffer.toString('base64') } }
                ];
            } else {
                contents = promptText;
            }

            const response = await ai.models.generateContent({
                model: model.modelId,
                contents: contents,
                config: {
                    maxOutputTokens: model.maxOutputTokens
                }
            });

            const replyText = response.text || 'Получен пустой ответ.';
            const newBalance = await callGoogleSheet('update', userId, username, -model.cost);

            await safeReply(ctx, `${replyText}\n\n📉 _Списано: ${model.cost} 🪙 | Баланс: ${newBalance ?? (balance - model.cost)} 🪙_`);

        } else if (model.type === 'image') {
            await ctx.sendChatAction('upload_photo');

            const fullPrompt = promptText ? `${promptText}. ${model.qualityPrompt}` : model.qualityPrompt;

            const response = await ai.models.generateImages({
                model: model.modelId,
                prompt: fullPrompt,
                config: {
                    numberOfImages: 1,
                    aspectRatio: state.aspect_ratio || '1:1',
                    outputMimeType: 'image/jpeg'
                }
            });

            const base64Bytes = response?.generatedImages?.[0]?.image?.imageBytes;
            if (!base64Bytes) throw new Error('API не вернуло данные изображения.');

            const imgBuffer = Buffer.from(base64Bytes, 'base64');
            const newBalance = await callGoogleSheet('update', userId, username, -model.cost);

            await ctx.replyWithPhoto(
                { source: imgBuffer },
                {
                    caption: `🖼 **Готово!** (${model.name})\n\n📉 _Списано: ${model.cost} 🪙 | Баланс: ${newBalance ?? (balance - model.cost)} 🪙_`,
                    parse_mode: 'Markdown'
                }
            );
        }
    } catch (err) {
        console.error('Ошибка API Google:', err.message);
        await ctx.reply(`⚠️ Ошибка генерации: ${err.message}\nМонеты списаны не были.`);
    } finally {
        isProcessing.delete(userId);
    }
}

// --- ЛИСТЕНЕРЫ ВХОДЯЩИХ СООБЩЕНИЙ ---
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || Object.values(MENU_BUTTONS).includes(text)) return;
    await handleAIQuery(ctx, text, null);
});

bot.on('photo', async (ctx) => {
    const photoArray = ctx.message.photo;
    const photo = photoArray[photoArray.length - 1];
    const caption = ctx.message.caption || '';

    try {
        const fileLink = await bot.telegram.getFileLink(photo.file_id);
        const res = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        await handleAIQuery(ctx, caption, Buffer.from(res.data));
    } catch (e) {
        console.error('Ошибка загрузки фото:', e.message);
        await ctx.reply('❌ Ошибка скачивания фото.');
    }
});

// --- СЕРВЕР И ВЕБХУК ---
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Webhook запущен: ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    bot.launch();
    console.log("Бот запущен локально (Long Polling)");
}

app.get('/', (req, res) => res.send('AI Studio Backend: Running'));
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
