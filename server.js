const express = require('express');
const cors = require('cors');
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- КОНФИГУРАЦИЯ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ С ГАРАНТИЕЙ ЗНАЧЕНИЙ ---
const BOT_TOKEN = process.env.BOT_TOKEN || '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID || '1120841';
const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY || 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// =========================================================================
// 🎯 ТАРИФНАЯ СЕТКА И АКТУАЛЬНЫЕ МОДЕЛИ ИИ
// =========================================================================
const MODELS = {
    'flash_2_5': {
        name: '⚡ Flash 2.5',
        modelId: 'gemini-2.5-flash',
        type: 'text',
        cost: 1,
        maxInputChars: 4000,
        maxOutputTokens: 2048
    },
    'pro_2_5': {
        name: '🧠 Pro 2.5',
        modelId: 'gemini-2.5-pro',
        type: 'text',
        cost: 3,
        maxInputChars: 20000,
        maxOutputTokens: 4096
    },
    'nano_banana_2_lite': {
        name: '🏎 Nano Banana 2 Lite',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 1,
        maxInputChars: 800,
        qualityPrompt: 'clear, fast generation, detailed'
    },
    'nano_banana_2': {
        name: '🎨 Nano Banana 2',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 2,
        maxInputChars: 800,
        qualityPrompt: 'high quality, detailed, clear focus, professional photography'
    },
    'nano_banana_pro': {
        name: '✨ Nano Banana Pro',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 4,
        maxInputChars: 800,
        qualityPrompt: 'ultra-hd quality, highly detailed, 4k resolution, masterpiece, photorealistic'
    }
};

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
        userState[userId] = { model: 'flash_2_5', aspect_ratio: '1:1' };
    }
    if (!MODELS[userState[userId].model]) {
        userState[userId].model = 'flash_2_5';
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

// Запрос к Google Таблицам с таймаутом (защита от зависаний)
async function callGoogleSheet(action, userId, username = '', amount = 0) {
    try {
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
            action,
            userId: String(userId),
            username,
            amount
        }, { timeout: 10000 });
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

bot.hears(MENU_BUTTONS.SELECT_MODEL, (ctx) => {
    const buttons = Object.keys(MODELS).map((key) => {
        const m = MODELS[key];
        const limitInfo = m.type === 'text' ? `до ${m.maxInputChars} симв.` : `промпт до ${m.maxInputChars} симв.`;
        return [Markup.button.callback(`${m.name} — ${m.cost} 🪙 (${limitInfo})`, `model_${key}`)];
    });
    safeReply(ctx, '🤖 **Выберите нейросеть для работы:**\n\nСтоимость и лимиты указаны на кнопках:', Markup.inlineKeyboard(buttons));
});

bot.hears(MENU_BUTTONS.SETTINGS, (ctx) => {
    const state = getUserState(ctx.from.id);
    const r = state.aspect_ratio;
    safeReply(ctx, `⚙️ **Настройки пропорций генерации картинок:**\nТекущий формат: **${r}**`, Markup.inlineKeyboard([
        [Markup.button.callback(`1:1 (Квадрат) ${r === '1:1' ? '✅' : ''}`, 'ratio_1:1')],
        [Markup.button.callback(`16:9 (Широкий) ${r === '16:9' ? '✅' : ''}`, 'ratio_16:9')],
        [Markup.button.callback(`9:16 (Вертикальный) ${r === '9:16' ? '✅' : ''}`, 'ratio_9:16')],
        [Markup.button.callback(`4:3 (Альбом) ${r === '4:3' ? '✅' : ''}`, 'ratio_4:3')],
        [Markup.button.callback(`3:4 (Портрет) ${r === '3:4' ? '✅' : ''}`, 'ratio_3:4')]
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
    const m = MODELS[state.model] || MODELS['flash_2_5'];

    safeReply(ctx, 
        `👤 **Профиль пользователя**\n\n` +
        `🆔 ID: \`${userId}\`\n` +
        `💰 Баланс: **${balance !== null ? balance : 'Ошибка'} 🪙**\n` +
        `🤖 Активная модель: **${m.name}**\n` +
        `💵 Стоимость запроса: **${m.cost} 🪙**\n` +
        `📏 Лимит входящего текста: **до ${m.maxInputChars} символов**\n` +
        (m.type === 'text' ? `📤 Лимит ответа: **до ${m.maxOutputTokens} токенов**\n` : '') +
        `📐 Формат картинок: **${state.aspect_ratio}**`
    );
});

// --- CALLBACK ОБРАБОТЧИКИ ---
bot.action(/^(?:model_|set_model_)(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    if (!MODELS[key]) return ctx.answerCbQuery('❌ Модель не найдена');

    const state = getUserState(ctx.from.id);
    state.model = key;
    const m = MODELS[key];

    await ctx.answerCbQuery(`Выбрано: ${m.name}`);
    await ctx.editMessageText(
        `✅ Активная модель: **${m.name}**\n\n` +
        `💰 Стоимость: **${m.cost} 🪙**\n` +
        `📏 Лимит длины запроса: **${m.maxInputChars} символов**` +
        (m.type === 'text' ? `\n📤 Макс. длина ответа: **${m.maxOutputTokens} токенов**` : ''), 
        { parse_mode: 'Markdown' }
    );
});

bot.action(/^(?:ratio_|set_ratio_)(.+)$/, async (ctx) => {
    const ratio = ctx.match[1];
    const state = getUserState(ctx.from.id);
    state.aspect_ratio = ratio;
    await ctx.answerCbQuery(`Формат: ${ratio}`);
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
            },
            timeout: 10000
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
            headers: { 'Authorization': `Basic ${authString}` },
            timeout: 10000
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
    const modelData = MODELS[state.model] || MODELS['flash_2_5'];

    // 1. Проверка длины текста
    if (promptText && promptText.length > modelData.maxInputChars) {
        return safeReply(
            ctx,
            `⛔ **Превышен лимит длины запроса!**\n\n` +
            `Модель: **${modelData.name}**\n` +
            `Максимум: **${modelData.maxInputChars}** символов\n` +
            `Ваш запрос: **${promptText.length}** символов`
        );
    }

    // 2. Проверка совместимости
    if (photoBuffer && modelData.type === 'image') {
        return safeReply(ctx, `⚠️ Генераторы картинок не принимают фото на вход. Для анализа фотографий выберите текстовую модель (Flash или Pro).`);
    }

    // 3. Проверка баланса
    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) return ctx.reply('❌ Ошибка связи с базой данных.');
    if (balance < modelData.cost) {
        return safeReply(ctx, `❌ **Недостаточно монет.**\nСтоимость запроса: ${modelData.cost} 🪙\nВаш баланс: ${balance} 🪙`);
    }

    isProcessing.add(userId);

    try {
        if (modelData.type === 'text') {
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
                model: modelData.modelId,
                contents: contents,
                config: { maxOutputTokens: modelData.maxOutputTokens }
            });

            const replyText = response.text || 'Получен пустой ответ.';
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            const balanceStr = newBalance !== null ? newBalance : (balance - modelData.cost);

            await safeReply(ctx, `${replyText}\n\n📉 _Списано: ${modelData.cost} 🪙 | Баланс: ${balanceStr} 🪙_`);

        } else if (modelData.type === 'image') {
            await ctx.sendChatAction('upload_photo');

            const fullPrompt = promptText ? `${promptText}. ${modelData.qualityPrompt}` : modelData.qualityPrompt;

            const response = await ai.models.generateImages({
                model: modelData.modelId,
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
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            const balanceStr = newBalance !== null ? newBalance : (balance - modelData.cost);

            await ctx.replyWithPhoto(
                { source: imgBuffer },
                {
                    caption: `🖼 **Готово!** (${modelData.name})\n📐 Формат: ${state.aspect_ratio}\n\n📉 _Списано: ${modelData.cost} 🪙 | Баланс: ${balanceStr} 🪙_`,
                    parse_mode: 'Markdown'
                }
            );
        }
    } catch (err) {
        console.error('Ошибка API Google:', err.message);
        let userErrMsg = err.message || 'Сбой сервиса Google API';
        if (err.message && err.message.includes('404')) {
            userErrMsg = 'Модель генерации изображений временно недоступна для вашего API ключа. Воспользуйтесь текстовой моделью.';
        }
        await ctx.reply(`⚠️ Ошибка генерации: ${userErrMsg}\nМонеты списаны не были.`);
    } finally {
        isProcessing.delete(userId);
    }
}

// --- ЛИСТЕНЕРЫ ВХОДЯЩИХ СООБЩЕНИЙ (Асинхронный запуск без блокировки вебхука) ---
bot.on('text', (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || Object.values(MENU_BUTTONS).includes(text)) return;
    handleAIQuery(ctx, text, null).catch(e => console.error('Unhandled AI query error:', e));
});

bot.on('photo', async (ctx) => {
    const photoArray = ctx.message.photo;
    const photo = photoArray[photoArray.length - 1];
    const caption = ctx.message.caption || '';

    try {
        const fileLink = await bot.telegram.getFileLink(photo.file_id);
        const res = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 10000 });
        handleAIQuery(ctx, caption, Buffer.from(res.data)).catch(e => console.error('Unhandled photo AI error:', e));
    } catch (e) {
        console.error('Ошибка загрузки фото:', e.message);
        await ctx.reply('❌ Ошибка скачивания фото.');
    }
});

// --- СЕРВЕР И БЕЗОПАСНАЯ НАСТРОЙКА ВЕБХУКА ---
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    // Гарантируем корректный путь вебхука даже при проблемах с генерацией ключа Telegraf
    let secretPath;
    try {
        secretPath = bot.secretPathComponent();
    } catch (e) {
        secretPath = 'ai_studio_secret_webhook';
    }
    
    const webhookPath = `/telegraf/${secretPath}`;
    app.use(bot.webhookCallback(webhookPath));
    
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Webhook успешно запущен: ${RENDER_EXTERNAL_URL}${webhookPath}`);
    }).catch(e => console.error('Ошибка установки вебхука:', e.message));
} else {
    bot.launch();
    console.log("Бот запущен локально (Long Polling)");
}

app.get('/', (req, res) => res.send('AI Studio Backend Status: OK'));
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
