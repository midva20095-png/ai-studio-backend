const express = require('express');
const cors = require('cors');
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- КОНФИГУРАЦИЯ ПЕРЕМЕННЫХ ---
const BOT_TOKEN = process.env.BOT_TOKEN || '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID || '1120841';
const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY || 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- МОДЕЛИ GEMINI 3.8 & IMAGEN 3 ---
const MODELS = {
    'flash_2_5': {
        name: '⚡ Flash 3.8',
        modelId: 'gemini-3.8-flash',
        type: 'text',
        cost: 1,
        maxInputChars: 4000
    },
    'pro_2_5': {
        name: '🧠 Pro 3.1',
        modelId: 'gemini-3.1-pro-preview',
        type: 'text',
        cost: 3,
        maxInputChars: 20000
    },
    'nano_banana_2_lite': {
        name: '🏎 Nano Banana 2 Lite',
        modelId: 'imagen-3.0-fast-generate-001',
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

const userState = {};
const isProcessing = new Set();

async function safeReply(ctx, text, extra = {}) {
    try {
        return await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
    } catch (error) {
        return await ctx.reply(text, extra);
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
        console.error('Ошибка Google Sheets:', error.message);
        return null;
    }
}

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
            `💳 **Счет на оплату создан**\n\n💵 Сумма: ${amountRub} руб.\n🪙 Начисление: ${coinsCount} монет`,
            Markup.inlineKeyboard([
                [Markup.button.url(`🔗 Оплатить ${amountRub} ₽`, response.data.confirmation.confirmation_url)],
                [Markup.button.callback(`🔄 Проверить оплату`, `check_${response.data.id}`)]
            ])
        );
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.message);
        ctx.reply('❌ Ошибка при формировании счета.');
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
            const coins = parseInt(response.data.metadata?.coins) || 0;
            const newBalance = await callGoogleSheet('update', ctx.from.id, ctx.from.username, coins);
            await ctx.editMessageText(`✅ **Оплата прошла успешно!**\nЗачислено: ${coins} 🪙\nВаш баланс: ${newBalance} 🪙`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(`⏳ Платеж еще обрабатывается. Статус: ${response.data.status}`);
        }
    } catch (e) {
        await ctx.reply('❌ Ошибка проверки платежа.');
    }
});

const mainMenuKeyboard = Markup.keyboard([
    ['🚀 Выбрать модель', '⚙️ Настройки'],
    ['💳 Баланс / Пополнить', 'ℹ️ Профиль']
]).resize();

bot.start((ctx) => {
    const userId = ctx.from.id;
    if (!userState[userId]) userState[userId] = { model: 'flash_2_5', aspect_ratio: '1:1' };
    safeReply(ctx, `👋 **Добро пожаловать в AI Studio**\n\nВыберите модель ИИ и отправляйте запросы.`, mainMenuKeyboard);
});

bot.hears('🚀 Выбрать модель', (ctx) => {
    safeReply(ctx, '🤖 **Выберите нейросеть:**', Markup.inlineKeyboard([
        [Markup.button.callback('⚡ Flash 3.8 (1 🪙)', 'model_flash_2_5')],
        [Markup.button.callback('🧠 Pro 3.1 (3 🪙)', 'model_pro_2_5')],
        [Markup.button.callback('🏎 Nano Banana 2 Lite (1 🪙)', 'model_nano_banana_2_lite')],
        [Markup.button.callback('🎨 Nano Banana 2 (2 🪙)', 'model_nano_banana_2')],
        [Markup.button.callback('✨ Nano Banana Pro (4 🪙)', 'model_nano_banana_pro')]
    ]));
});

bot.hears('⚙️ Настройки', (ctx) => {
    const userId = ctx.from.id;
    if (!userState[userId]) userState[userId] = { model: 'flash_2_5', aspect_ratio: '1:1' };
    const r = userState[userId].aspect_ratio;
    
    safeReply(ctx, `⚙️ **Настройки пропорций изображений:**\nТекущий формат: **${r}**`, Markup.inlineKeyboard([
        [Markup.button.callback(`Квадрат (1:1) ${r === '1:1' ? '✅' : ''}`, 'ratio_1:1')],
        [Markup.button.callback(`Широкий (16:9) ${r === '16:9' ? '✅' : ''}`, 'ratio_16:9')],
        [Markup.button.callback(`Вертикальный (9:16) ${r === '9:16' ? '✅' : ''}`, 'ratio_9:16')],
        [Markup.button.callback(`Портрет (3:4) ${r === '3:4' ? '✅' : ''}`, 'ratio_3:4')],
        [Markup.button.callback(`Альбом (4:3) ${r === '4:3' ? '✅' : ''}`, 'ratio_4:3')]
    ]));
});

bot.hears('💳 Баланс / Пополнить', async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    safeReply(ctx, `💰 Ваш баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n\nВыберите пакет пополнения:`, Markup.inlineKeyboard([
        [Markup.button.callback('🟢 150 ₽ (30 🪙)', 'pay_start')],
        [Markup.button.callback('🔵 500 ₽ (100 🪙)', 'pay_standard')],
        [Markup.button.callback('🟣 1000 ₽ (250 🪙)', 'pay_lux')],
        [Markup.button.callback('👑 2500 ₽ (650 🪙)', 'pay_vip')]
    ]));
});

bot.hears('ℹ️ Профиль', async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    const state = userState[userId] || { model: 'flash_2_5', aspect_ratio: '1:1' };
    safeReply(ctx, `👤 **Ваш профиль**\n\n🆔 ID: \`${userId}\`\n💰 Баланс: ${balance} 🪙\n🤖 Модель: ${MODELS[state.model]?.name || 'Flash 3.8'}\n📐 Формат картинок: ${state.aspect_ratio}`);
});

bot.action(/model_(.+)/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (!MODELS[modelKey]) return ctx.answerCbQuery('❌ Ошибка');
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_2_5', aspect_ratio: '1:1' };
    userState[ctx.from.id].model = modelKey;
    await ctx.answerCbQuery(`Выбрано: ${MODELS[modelKey].name}`);
    await ctx.editMessageText(`✅ Активная модель: **${MODELS[modelKey].name}**`, { parse_mode: 'Markdown' });
});

bot.action(/ratio_(.+)/, async (ctx) => {
    const ratio = ctx.match[1];
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_2_5', aspect_ratio: '1:1' };
    userState[ctx.from.id].aspect_ratio = ratio;
    await ctx.answerCbQuery(`Формат: ${ratio}`);
    await ctx.editMessageText(`✅ Выбран формат картинок: **${ratio}**`, { parse_mode: 'Markdown' });
});

bot.action(/^pay_(start|standard|lux|vip)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const pkg = PAYMENT_PACKAGES.find(p => p.id === ctx.match[1]);
    if (pkg) await generatePaymentLink(ctx, ctx.from.id, pkg.priceRub, pkg.coins);
});

async function handleAIQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'User';

    if (isProcessing.has(userId)) {
        return ctx.reply('⏳ Предыдущий запрос обрабатывается. Пожалуйста, подождите.');
    }

    if (!userState[userId]) userState[userId] = { model: 'flash_2_5', aspect_ratio: '1:1' };
    const userConfig = userState[userId];
    const modelData = MODELS[userConfig.model] || MODELS['flash_2_5'];

    if (promptText && promptText.length > modelData.maxInputChars) {
        return safeReply(ctx, `⛔ **Превышен лимит символов!**\nМаксимум для ${modelData.name}: ${modelData.maxInputChars} симв.\nУ вас: ${promptText.length} симв.`);
    }

    if (photoBuffer && modelData.type === 'image') {
        return safeReply(ctx, `⚠️ **Внимание:** Для анализа прикрепленных фото используйте текстовые модели (*Flash 3.8* или *Pro 3.1*).`);
    }

    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) return ctx.reply('❌ Ошибка базы данных.');
    if (balance < modelData.cost) {
        return safeReply(ctx, `❌ **Недостаточно монет.**\nСтоимость: ${modelData.cost} 🪙 | Ваш баланс: ${balance} 🪙`);
    }

    isProcessing.add(userId);

    try {
        if (modelData.type === 'text') {
            await ctx.sendChatAction('typing');
            
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
                contents: requestContents,
                config: {
                    thinkingConfig: {
                        thinkingLevel: 'medium'
                    }
                }
            });

            const replyText = response.text || 'Ответ от ИИ пуст.';
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            await safeReply(ctx, `${replyText}\n\n📉 _Списано: ${modelData.cost} 🪙 | Баланс: ${newBalance} 🪙_`);

        } else if (modelData.type === 'image') {
            await ctx.sendChatAction('upload_photo');
            
            const fullPrompt = `${promptText}. ${modelData.qualityPrompt}`;
            const ratio = userConfig.aspect_ratio || '1:1';

            // Вызов генерации согласно официальной документации Imagen 3
            const response = await ai.models.generateImages({
                model: modelData.modelId,
                prompt: fullPrompt,
                config: {
                    numberOfImages: 1,
                    aspectRatio: ratio,
                    outputMimeType: 'image/jpeg'
                }
            });

            if (!response.generatedImages || response.generatedImages.length === 0) {
                throw new Error('Модель не вернула готовое изображение.');
            }

            const imageBytes = response.generatedImages[0].image.imageBytes;
            const imgBuffer = Buffer.from(imageBytes, 'base64');
            
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            const caption = `🖼 **Готово!**\n🤖 Модель: ${modelData.name}\n📐 Соотношение: ${ratio}\n\n📉 _Списано: ${modelData.cost} 🪙 | Баланс: ${newBalance} 🪙_`;
            
            await ctx.replyWithPhoto({ source: imgBuffer }, { caption: caption, parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка исполнения запроса:', error);
        ctx.reply(`⚠ Ошибка генерации: ${error.message || 'Сбой API'}.\nМонеты за этот запрос не списаны.`);
    } finally {
        isProcessing.delete(userId);
    }
}

bot.on('text', async (ctx) => {
    const txt = ctx.message.text;
    if (txt.startsWith('/') || ['🚀 Выбрать модель', '⚙️ Настройки', '💳 Баланс / Пополнить', 'ℹ️ Профиль'].includes(txt)) return;
    await handleAIQuery(ctx, txt, null);
});

bot.on('photo', async (ctx) => {
    const photoArray = ctx.message.photo;
    const photo = photoArray[photoArray.length - 1];
    const caption = ctx.message.caption || '';
    
    try {
        const fileLink = await bot.telegram.getFileLink(photo.file_id);
        const imageResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        await handleAIQuery(ctx, caption, Buffer.from(imageResponse.data));
    } catch (e) {
        ctx.reply('❌ Ошибка загрузки прикрепленного фото.');
    }
});

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Webhook настроен: ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    bot.launch();
    console.log("Бот запущен локально");
}

app.get('/', (req, res) => res.send('AI Studio Backend Status: OK'));
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
