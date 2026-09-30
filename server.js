const express = require('express');
const cors = require('cors');
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

// Инициализация нового SDK от Google
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN || '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID || '1120841';
const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY || 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- СТРОГИЕ ПАРАМЕТРЫ МОДЕЛЕЙ (Цены и лимиты) ---
const MODELS = {
    'flash_3_8': {
        name: '⚡ Flash 3.8',
        modelId: 'gemini-3.8-flash', // Обновлено по требованию Google API
        type: 'text',
        cost: 1,
        maxInputChars: 4000
    },
    'flash_lite': {
        name: '⚡ Flash-Lite',
        modelId: 'gemini-3.8-flash',
        type: 'text',
        cost: 1,
        maxInputChars: 4000
    },
    'pro_3_1': {
        name: '🧠 Pro 3.1',
        modelId: 'gemini-3.8-pro', // Обновлено по требованию Google API
        type: 'text',
        cost: 3,
        maxInputChars: 20000
    },
    'deep_research': {
        name: '🔎 Deep Research',
        modelId: 'gemini-3.8-pro',
        type: 'text',
        cost: 3,
        maxInputChars: 20000
    },
    'nano_banana_2': {
        name: '🖼 Nano Banana 2',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 2,
        maxInputChars: 800,
        qualityPrompt: 'HD quality, clear details, high resolution'
    },
    'nano_banana_pro': {
        name: '✨ Nano Banana Pro',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 4,
        maxInputChars: 800,
        qualityPrompt: 'Ultra-HD quality, extremely detailed, 4k resolution, masterpiece, fine details'
    },
    'nano_banana_4k': {
        name: '💎 Nano Banana 4K',
        modelId: 'imagen-3.0-generate-002',
        type: 'image',
        cost: 10,
        maxInputChars: 800,
        qualityPrompt: '4K premium photorealistic, hyperrealistic, 8k UHD, cinematic lighting, professional photography'
    }
};

const PAYMENT_PACKAGES = [
    { id: 'start', name: 'Старт', priceRub: 150, coins: 30 },
    { id: 'standard', name: 'Стандарт', priceRub: 500, coins: 100 },
    { id: 'lux', name: 'Люкс', priceRub: 1000, coins: 250 },
    { id: 'vip', name: 'VIP', priceRub: 2500, coins: 650 }
];

const userState = {};
const isProcessing = new Set();

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
async function safeReply(ctx, text, extra = {}) {
    try {
        return await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
    } catch (error) {
        return await ctx.reply(text, extra); // Фолбек, если Markdown ломается
    }
}

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
        console.error('Ошибка БД:', error.message);
        return null;
    }
}

// --- ЮKASSA ОПЛАТА ---
async function generatePaymentLink(ctx, userId, amountRub, coinsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    try {
        const response = await axios.post(url, {
            amount: { value: `${amountRub}.00`, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: 'https://t.me/ai_studio_hub_bot' },
            capture: true,
            description: `Покупка ${coinsCount} 🪙`,
            metadata: { user_id: String(userId), coins: String(coinsCount) }
        }, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Idempotence-Key': Math.random().toString(36).substring(7)
            }
        });

        await safeReply(
            ctx,
            `💳 **Счет создан**\n\n💵 Сумма: ${amountRub} руб.\n🪙 Монет: ${coinsCount}`,
            Markup.inlineKeyboard([
                [Markup.button.url(`🔗 Оплатить ${amountRub} руб.`, response.data.confirmation.confirmation_url)],
                [Markup.button.callback(`🔄 Проверить оплату`, `check_${response.data.id}`)]
            ])
        );
    } catch (error) {
        ctx.reply('❌ Ошибка платежной системы.');
    }
}

bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    await ctx.answerCbQuery('Проверка...');
    try {
        const response = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
            headers: { 'Authorization': `Basic ${authString}` }
        });
        
        if (response.data.status === 'succeeded') {
            const coins = parseInt(response.data.metadata?.coins) || 1;
            const newBalance = await callGoogleSheet('update', ctx.from.id, ctx.from.username, coins);
            await ctx.editMessageText(`✅ **Успешно!** Зачислено: ${coins} 🪙\nБаланс: ${newBalance} 🪙`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(`⏳ Платеж еще не прошел. Статус: ${response.data.status}`);
        }
    } catch (e) {
        await ctx.reply('❌ Ошибка проверки.');
    }
});

// --- МЕНЮ И НАВИГАЦИЯ ---
const mainMenuKeyboard = Markup.keyboard([
    ['🚀 Выбрать модель', '⚙️ Настройки'],
    ['💳 Баланс / Пополнить', 'ℹ️ Профиль']
]).resize();

bot.start((ctx) => {
    const userId = ctx.from.id;
    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    safeReply(ctx, `👋 **Добро пожаловать в AI Studio!**\n\nВыбирайте нейросеть, настраивайте формат и отправляйте запросы (текст или фото).`, mainMenuKeyboard);
});

bot.hears('🚀 Выбрать модель', (ctx) => {
    safeReply(ctx, '🤖 **Выберите нейросеть:**', Markup.inlineKeyboard([
        [Markup.button.callback('⚡ Flash 3.8 (1 🪙 | до 4к симв.)', 'model_flash_3_8')],
        [Markup.button.callback('🧠 Pro 3.1 (3 🪙 | до 20к симв.)', 'model_pro_3_1')],
        [Markup.button.callback('🎨 Nano Banana 2 HD (2 🪙)', 'model_nano_banana_2')],
        [Markup.button.callback('🍌 Nano Banana Pro Ultra (4 🪙)', 'model_nano_banana_pro')],
        [Markup.button.callback('💎 Nano Banana 4K (10 🪙)', 'model_nano_banana_4k')]
    ]));
});

bot.hears('⚙️ Настройки', (ctx) => {
    const userId = ctx.from.id;
    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    const r = userState[userId].aspect_ratio;
    
    safeReply(ctx, `⚙️ **Настройки картинок:**\nТекущий формат: **${r}**`, Markup.inlineKeyboard([
        [Markup.button.callback(`Квадрат (1:1) ${r === '1:1' ? '✅' : ''}`, 'ratio_1:1')],
        [Markup.button.callback(`Широкий (16:9) ${r === '16:9' ? '✅' : ''}`, 'ratio_16:9')],
        [Markup.button.callback(`Вертикальный (9:16) ${r === '9:16' ? '✅' : ''}`, 'ratio_9:16')]
    ]));
});

bot.hears('💳 Баланс / Пополнить', async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    safeReply(ctx, `💰 Баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n\nВыберите пакет:`, Markup.inlineKeyboard([
        [Markup.button.callback('🟢 150 ₽ (30 🪙)', 'pay_start')],
        [Markup.button.callback('🔵 500 ₽ (100 🪙)', 'pay_standard')],
        [Markup.button.callback('🟣 1000 ₽ (250 🪙)', 'pay_lux')],
        [Markup.button.callback('👑 2500 ₽ (650 🪙)', 'pay_vip')]
    ]));
});

bot.hears('ℹ️ Профиль', async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    const state = userState[userId] || { model: 'flash_3_8', aspect_ratio: '1:1' };
    safeReply(ctx, `👤 **Профиль**\n\n🆔 ID: \`${userId}\`\n💰 Баланс: ${balance} 🪙\n🤖 Модель: ${MODELS[state.model]?.name || 'Неизвестно'}\n📐 Формат картинок: ${state.aspect_ratio}`);
});

bot.action(/model_(.+)/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (!MODELS[modelKey]) return ctx.answerCbQuery('❌ Ошибка');
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    userState[ctx.from.id].model = modelKey;
    await ctx.answerCbQuery(`Выбрано: ${MODELS[modelKey].name}`);
    await ctx.editMessageText(`✅ Модель переключена на: **${MODELS[modelKey].name}**`, { parse_mode: 'Markdown' });
});

bot.action(/ratio_(.+)/, async (ctx) => {
    const ratio = ctx.match[1];
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    userState[ctx.from.id].aspect_ratio = ratio;
    await ctx.answerCbQuery(`Формат: ${ratio}`);
    await ctx.editMessageText(`✅ Формат генерации картинок установлен на: **${ratio}**`, { parse_mode: 'Markdown' });
});

bot.action(/^pay_(start|standard|lux|vip)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const pkg = PAYMENT_PACKAGES.find(p => p.id === ctx.match[1]);
    if (pkg) await generatePaymentLink(ctx, ctx.from.id, pkg.priceRub, pkg.coins);
});

// --- ГЛАВНЫЙ ОБРАБОТЧИК ИИ ЗАПРОСОВ ---
async function handleAIQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'User';

    if (isProcessing.has(userId)) {
        return ctx.reply('⏳ Подождите завершения предыдущего запроса.');
    }

    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    const userConfig = userState[userId];
    const modelData = MODELS[userConfig.model] || MODELS['flash_3_8'];

    // 1. ПРОВЕРКА ЛИМИТА СИМВОЛОВ
    if (promptText && promptText.length > modelData.maxInputChars) {
        return safeReply(ctx, `⛔ **Слишком длинный текст!**\nЛимит для ${modelData.name}: ${modelData.maxInputChars} симв.\nУ вас: ${promptText.length} симв. Отправьте текст короче.`);
    }

    // 2. ПРОВЕРКА ФОТО ДЛЯ МОДЕЛЕЙ КАРТИНОК
    if (photoBuffer && modelData.type === 'image') {
        return safeReply(ctx, `⚠️ **Внимание:** Вы прикрепили фото, но у вас активна модель *создания* картинок (${modelData.name}).\n\nМодели генерации изображений не умеют редактировать чужие фото. Если вы хотите, чтобы ИИ проанализировал или описал ваше фото, переключитесь на текстовую модель (Flash или Pro).`);
    }

    // 3. ПРОВЕРКА БАЛАНСА
    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) return ctx.reply('❌ Ошибка базы данных.');
    if (balance < modelData.cost) {
        return safeReply(ctx, `❌ **Недостаточно монет.**\nНужно: ${modelData.cost} 🪙 | Есть: ${balance} 🪙\nПополните баланс в меню.`);
    }

    isProcessing.add(userId);

    try {
        if (modelData.type === 'text') {
            await ctx.sendChatAction('typing');
            
            // Сборка запроса: поддерживает и просто текст, и текст + фото
            let requestContents;
            if (photoBuffer) {
                requestContents = [
                    promptText || 'Опиши детально это изображение.',
                    { inlineData: { mimeType: 'image/jpeg', data: photoBuffer.toString('base64') } }
                ];
            } else {
                requestContents = promptText;
            }

            const response = await ai.models.generateContent({
                model: modelData.modelId,
                contents: requestContents
            });

            const replyText = response.text || 'Не удалось получить ответ.';
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            await safeReply(ctx, `${replyText}\n\n📉 _Списано: ${modelData.cost} 🪙 | Баланс: ${newBalance} 🪙_`);

        } else if (modelData.type === 'image') {
            await ctx.sendChatAction('upload_photo');
            
            const fullPrompt = `${promptText}. ${modelData.qualityPrompt}`;
            const ratio = userConfig.aspect_ratio || '1:1';

            // Генерация через новый SDK
            const response = await ai.models.generateImages({
                model: modelData.modelId,
                prompt: fullPrompt,
                config: {
                    numberOfImages: 1,
                    aspectRatio: ratio,
                    outputMimeType: 'image/jpeg'
                }
            });

            const imageBytes = response.generatedImages[0].image.imageBytes;
            const imgBuffer = Buffer.from(imageBytes, 'base64');
            
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            const caption = `🖼 **Готово!**\n🤖 Модель: ${modelData.name}\n📐 Размер: ${ratio}\n\n📉 _Списано: ${modelData.cost} 🪙 | Баланс: ${newBalance} 🪙_`;
            
            await ctx.replyWithPhoto({ source: imgBuffer }, { caption: caption, parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка API ИИ:', error);
        
        let errorMsg = '⚠ Произошла ошибка генерации.';
        if (error.message?.includes('404')) errorMsg = '⚠ Модель временно недоступна на стороне Google.';
        if (error.message?.includes('safety')) errorMsg = '⚠ Запрос заблокирован фильтрами безопасности Google.';
        
        ctx.reply(`${errorMsg} Монеты не списаны.`);
    } finally {
        isProcessing.delete(userId);
    }
}

// --- ПРИЕМ ТЕКСТА ---
bot.on('text', async (ctx) => {
    const txt = ctx.message.text;
    if (txt.startsWith('/') || ['🚀 Выбрать модель', '⚙️ Настройки', '💳 Баланс / Пополнить', 'ℹ️ Профиль'].includes(txt)) return;
    await handleAIQuery(ctx, txt, null);
});

// --- ПРИЕМ ФОТО ---
bot.on('photo', async (ctx) => {
    const photoArray = ctx.message.photo;
    // Берем самое высокое разрешение
    const photo = photoArray[photoArray.length - 1];
    const caption = ctx.message.caption || '';
    
    try {
        const fileLink = await bot.telegram.getFileLink(photo.file_id);
        const imageResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        await handleAIQuery(ctx, caption, Buffer.from(imageResponse.data));
    } catch (e) {
        ctx.reply('❌ Ошибка при загрузке вашего фото.');
    }
});

// --- ЗАПУСК ВЕБХУКА ---
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Webhook -> ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    // Резервный пулинг для тестов на ПК
    bot.launch();
    console.log("Бот запущен в режиме polling");
}

app.get('/', (req, res) => res.send('AI Studio Bot is UP'));
app.listen(PORT, () => console.log(`HTTP Server на порту ${PORT}`));

// Безопасная остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
