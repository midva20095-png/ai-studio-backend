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

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN || '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID || '1120841';
const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY || 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- МОДЕЛИ ИИ ---
const MODELS = {
    'flash_3_8': { 
        name: '⚡ Flash 3.8 / Flash-Lite', 
        modelId: 'gemini-2.5-flash', 
        type: 'text', 
        cost: 1, 
        maxInputChars: 4000,
        maxOutputTokens: 800 
    },
    'pro_3_1': { 
        name: '🧠 Pro 3.1 / Deep Research', 
        modelId: 'gemini-2.5-pro', 
        type: 'text', 
        cost: 3, 
        maxInputChars: 20000,
        maxOutputTokens: 3200 
    },
    'nano_banana_2': { 
        name: '🎨 Nano Banana 2 (HD)', 
        modelId: 'gemini-2.5-flash', // Используем стабильную модель с поддержкой генерации картинок или текст/модали
        type: 'image', 
        qualityPrompt: 'HD quality, clear details, high resolution', 
        cost: 2, 
        maxInputChars: 800
    },
    'nano_banana_pro': { 
        name: '🍌 Nano Banana Pro (Ultra-HD)', 
        modelId: 'gemini-2.5-flash', 
        type: 'image', 
        qualityPrompt: 'Ultra-HD quality, extremely detailed, 4k resolution, masterpiece, fine details', 
        cost: 4, 
        maxInputChars: 800
    },
    'nano_banana_4k': { 
        name: '💎 Nano Banana 4K (Премиум)', 
        modelId: 'gemini-2.5-pro', 
        type: 'image', 
        qualityPrompt: '4K premium photorealistic, hyperrealistic, 8k UHD, cinematic lighting, photorealism, professional photography', 
        cost: 10, 
        maxInputChars: 800
    }
};

const PAYMENT_PACKAGES = [
    { id: 'pay_150', name: '🟢 Старт', priceRub: 150, coins: 30 },
    { id: 'pay_500', name: '🔵 Стандарт', priceRub: 500, coins: 100 },
    { id: 'pay_1000', name: '🟣 Люкс', priceRub: 1000, coins: 200 },
    { id: 'pay_2500', name: '👑 VIP', priceRub: 2500, coins: 500 }
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

async function safeReplyWithPhoto(ctx, photoBuffer, caption, extra = {}) {
    try {
        return await ctx.replyWithPhoto({ source: photoBuffer }, { caption: caption, parse_mode: 'Markdown', ...extra });
    } catch (error) {
        return await ctx.replyWithPhoto({ source: photoBuffer }, { caption: caption, ...extra });
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
        console.error('Ошибка Google Таблицы:', error.message);
        return null;
    }
}

async function generatePaymentLink(ctx, userId, amountRub, coinsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const body = {
        amount: { value: `${amountRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: 'https://t.me/ai_studio_hub_bot' },
        capture: true,
        description: `Покупка ${coinsCount} монет (Сумма: ${amountRub} руб)`,
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
        return safeReply(
            ctx,
            `💳 **Создан счет на оплату**\n\n💵 Сумма: ${amountRub} руб.\n🪙 Монет: ${coinsCount}\n\nОплатите по ссылке ниже, затем нажмите «🔄 Проверить оплату».`,
            Markup.inlineKeyboard([
                [Markup.button.url(`🔗 Оплатить ${amountRub} руб.`, response.data.confirmation.confirmation_url)],
                [Markup.button.callback(`🔄 Проверить оплату`, `check_${response.data.id}`)]
            ])
        );
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.message);
        return ctx.reply('❌ Ошибка создания платежа.');
    }
}

bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    await ctx.answerCbQuery('Проверяем платеж...');
    try {
        const response = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
            headers: { 'Authorization': `Basic ${authString}` }
        });
        
        const paymentInfo = response.data;
        if (paymentInfo.status === 'succeeded') {
            const coins = parseInt(paymentInfo.metadata?.coins) || 1;
            const newBalance = await callGoogleSheet('update', ctx.from.id, ctx.from.username || 'User', coins);
            await ctx.editMessageText(`✅ **Платеж прошел!**\n\nЗачислено: ${coins} 🪙\nТекущий баланс: ${newBalance} 🪙`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(`❌ Статус платежа: ${paymentInfo.status}. Попробуйте позже.`);
        }
    } catch (e) {
        await ctx.reply('❌ Ошибка проверки платежа.');
    }
});

const mainMenuKeyboard = Markup.keyboard([
    ['🚀 Выбрать модель', '⚙️ Настройки'],
    ['💳 Баланс / Пополнить', 'ℹ️ Профиль']
]).resize();

const sendMenu = async (ctx) => {
    const userId = ctx.from.id;
    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    
    await safeReply(
        ctx,
        `👋 **Панель управления AI Studio**\n\nИспользуй нижнее меню для навигации. Отправь текст или описание картинки, чтобы начать.`,
        mainMenuKeyboard
    );
};

bot.start(sendMenu);
bot.command('menu', sendMenu);

bot.hears('🚀 Выбрать модель', (ctx) => {
    safeReply(ctx, '🤖 **Выберите нейросеть для работы:**', Markup.inlineKeyboard([
        [Markup.button.callback('⚡ Flash 3.8 / Flash-Lite (1 🪙 | 5 ₽)', 'model_flash_3_8')],
        [Markup.button.callback('🧠 Pro 3.1 / Deep Research (3 🪙 | 15 ₽)', 'model_pro_3_1')],
        [Markup.button.callback('🎨 Nano Banana 2 HD (2 🪙 | 10 ₽)', 'model_nano_banana_2')],
        [Markup.button.callback('🍌 Nano Banana Pro Ultra-HD (4 🪙 | 20 ₽)', 'model_nano_banana_pro')],
        [Markup.button.callback('💎 Nano Banana 4K (10 🪙 | 50 ₽)', 'model_nano_banana_4k')]
    ]));
});

bot.hears('⚙️ Настройки', (ctx) => {
    const userId = ctx.from.id;
    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    const currentRatio = userState[userId].aspect_ratio;
    
    safeReply(ctx, `⚙️ **Настройки генерации изображений:**\n\nТекущее соотношение сторон: **${currentRatio}**\nВыберите нужный размер:`, Markup.inlineKeyboard([
        [Markup.button.callback(`Квадрат (1:1) ${currentRatio === '1:1' ? '✅' : ''}`, 'ratio_1:1')],
        [Markup.button.callback(`Горизонтально (16:9) ${currentRatio === '16:9' ? '✅' : ''}`, 'ratio_16:9')],
        [Markup.button.callback(`Вертикально (9:16) ${currentRatio === '9:16' ? '✅' : ''}`, 'ratio_9:16')]
    ]));
});

bot.hears('💳 Баланс / Пополнить', async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    safeReply(
        ctx,
        `💰 Твой баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n\nВыберите пакет пополнения:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🟢 Старт: 150 ₽ (30 монет)', 'pay_150')],
            [Markup.button.callback('🔵 Стандарт: 500 ₽ (100 монет)', 'pay_500')],
            [Markup.button.callback('🟣 Люкс: 1000 ₽ (200 монет)', 'pay_1000')],
            [Markup.button.callback('👑 VIP: 2500 ₽ (500 монет)', 'pay_2500')]
        ])
    );
});

bot.hears('ℹ️ Профиль', async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    const state = userState[userId] || { model: 'flash_3_8', aspect_ratio: '1:1' };
    const model = MODELS[state.model];
    
    safeReply(
        ctx,
        `👤 **Ваш профиль:**\n\n🆔 ID: \`${userId}\`\n💰 Баланс: ${balance} 🪙\n🤖 Активная модель: ${model.name}\n📐 Размер картинок: ${state.aspect_ratio}`
    );
});

bot.action(/model_(.+)/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (!MODELS[modelKey]) return ctx.answerCbQuery('❌ Модель не найдена');
    
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    userState[ctx.from.id].model = modelKey;
    
    await ctx.answerCbQuery(`✅ Выбрано: ${MODELS[modelKey].name}`);
    await ctx.editMessageText(`✅ Вы успешно переключились на модель:\n**${MODELS[modelKey].name}**`, { parse_mode: 'Markdown' });
});

bot.action(/ratio_(.+)/, async (ctx) => {
    const ratio = ctx.match[1];
    if (!['1:1', '16:9', '9:16'].includes(ratio)) return ctx.answerCbQuery('❌ Неверный формат');
    
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    userState[ctx.from.id].aspect_ratio = ratio;
    
    await ctx.answerCbQuery(`✅ Формат изменен на ${ratio}`);
    await ctx.editMessageText(`✅ Формат генерации изображений установлен на: **${ratio}**`, { parse_mode: 'Markdown' });
});

bot.action(/^pay_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parseInt(ctx.match[1]);
    const packageInfo = PAYMENT_PACKAGES.find(p => p.priceRub === amount);
    if (!packageInfo) return ctx.reply('❌ Ошибка: пакет не найден.');
    await generatePaymentLink(ctx, ctx.from.id, packageInfo.priceRub, packageInfo.coins);
});

// --- ОСНОВНАЯ ЛОГИКА ЗАПРОСОВ К ИИ ---
async function handleAIQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'User';

    if (isProcessing.has(userId)) {
        return ctx.reply('⏳ Пожалуйста, дождитесь окончания предыдущего запроса.');
    }

    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    const userConfig = userState[userId];
    const modelData = MODELS[userConfig.model];

    if (promptText && promptText.length > modelData.maxInputChars) {
        return safeReply(
            ctx, 
            `⛔️ **Превышен лимит символов!**\n\nДля модели *${modelData.name}* максимальная длина запроса составляет **${modelData.maxInputChars}** символов.\nДлина вашего текста: ${promptText.length} символов.\n\nПожалуйста, сократите текст.`
        );
    }

    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) return ctx.reply('❌ Ошибка связи с базой данных.');

    if (balance < modelData.cost) {
        return safeReply(ctx, `❌ Недостаточно монет.\nТребуется: ${modelData.cost} 🪙 | Баланс: ${balance} 🪙`);
    }

    isProcessing.add(userId);

    try {
        if (modelData.type === 'text') {
            await ctx.sendChatAction('typing');
            
            // Корректная сборка контента для @google/genai SDK
            let contents = promptText;
            if (photoBuffer) {
                contents = [
                    {
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: photoBuffer.toString('base64')
                        }
                    },
                    promptText || 'Опиши это изображение.'
                ];
            }

            const response = await ai.models.generateContent({
                model: modelData.modelId,
                contents: contents,
                config: {
                    maxOutputTokens: modelData.maxOutputTokens
                }
            });

            const replyText = response.text || 'Не удалось получить ответ.';
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            await safeReply(ctx, `${replyText}\n\n📉 _Списано: ${modelData.cost} 🪙 | Остаток: ${newBalance} 🪙_`);

        } else if (modelData.type === 'image') {
            await ctx.sendChatAction('typing');
            
            const selectedRatio = userConfig.aspect_ratio || '1:1';
            const fullPrompt = `${promptText || 'Сгенерируй изображение'}. Стиль и качество: ${modelData.qualityPrompt}, Соотношение сторон: ${selectedRatio}`;

            // Используем стандартный генератор текста/модели для описания или текстового промпта
            const response = await ai.models.generateContent({
                model: modelData.modelId,
                contents: fullPrompt,
            });

            const replyText = response.text || 'Изображение не удалось сформировать.';
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            
            // Если модель вернула текстовое описание или результат, отправляем его пользователю
            await safeReply(ctx, `🎨 *Результат генерации (${modelData.name}):*\n\n${replyText}\n\n📉 _Списано: ${modelData.cost} 🪙 | Остаток: ${newBalance} 🪙_`);
        }

    } catch (error) {
        console.error('Ошибка ИИ:', error);
        ctx.reply('⚠ Произошла ошибка при генерации. Монеты не были списаны.');
    } finally {
        isProcessing.delete(userId);
    }
}

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/') || ['🚀 Выбрать модель', '⚙️ Настройки', '💳 Баланс / Пополнить', 'ℹ️ Профиль'].includes(ctx.message.text)) return;
    await handleAIQuery(ctx, ctx.message.text, null);
});

bot.on('photo', async (ctx) => {
    const photoArray = ctx.message.photo;
    const photo = photoArray[photoArray.length - 1];
    const caption = ctx.message.caption || 'Что на фото?';
    try {
        const fileLink = await bot.telegram.getFileLink(photo.file_id);
        const imageResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        await handleAIQuery(ctx, caption, Buffer.from(imageResponse.data));
    } catch (e) {
        ctx.reply('❌ Ошибка загрузки фото.');
    }
});

// --- ВЕБХУК И ЗАПУСК СЕРВЕРА ---
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Webhook установлен на ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    // Локальный запуск через polling, если нет вебхука
    bot.launch();
    console.log('🤖 Бот запущен в режиме Long Polling');
}

app.get('/', (req, res) => res.send('AI Studio Bot Server is running!'));

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
