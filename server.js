const express = require('express');
const cors = require('cors');
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID || '1120841';
const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY || 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Актуальный каталог только текстовых моделей и генерации изображений
const MODELS = {
    'flash_3_8': { name: '⚡ Gemini 3.8 Flash', modelId: 'gemini-3.8-flash', type: 'text', cost: 12 },
    'pro_3_1': { name: '🧠 Gemini 3.1 Pro (Thinking)', modelId: 'gemini-3.1-pro-preview', type: 'text', cost: 25 },
    'flash_lite': { name: '🚀 Flash-Lite 3.5', modelId: 'gemini-3.5-flash-lite', type: 'text', cost: 8 },
    'deep_research': { name: '🔍 Deep Research', modelId: 'deep-research-preview-04-2026', type: 'text', cost: 45 },
    'nano_banana_2': { name: '🎨 Nano Banana 2 (Images)', modelId: 'gemini-3.1-flash-image', type: 'image', cost: 15 },
    'nano_banana_pro': { name: '🍌 Nano Banana Pro', modelId: 'gemini-3-pro-image', type: 'image', cost: 20 }
};

// Хранилище состояний пользователей
const userState = {};
const isProcessing = new Set(); // Защита от спама и двойных списаний

// --- Взаимодействие с Google Таблицей ---
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

// --- ЮKassa: Создание платежа ---
async function generatePaymentLink(ctx, userId, amountRub, coinsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const body = {
        amount: { value: `${amountRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: 'https://t.me/ai_studio_hub_bot' },
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

        return ctx.reply(
            `💳 **Создан счет на оплату**\n\n💵 Сумма: ${amountRub} руб.\n🪙 Токенов: ${coinsCount}\n\nОплатите по ссылке ниже, затем нажмите «🔄 Проверить оплату».`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(`🔗 Оплатить ${amountRub} руб.`, response.data.confirmation.confirmation_url)],
                    [Markup.button.callback(`🔄 Проверить оплату`, `check_${response.data.id}`)]
                ])
            }
        );
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.message);
        return ctx.reply('❌ Ошибка создания платежа.');
    }
}

// --- ЮKassa: Проверка платежа ---
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

// --- Главное меню (Постоянные кнопки внизу чата) ---
const mainMenuKeyboard = Markup.keyboard([
    ['🚀 Выбрать модель', '⚙️ Настройки'],
    ['💳 Баланс / Пополнить', 'ℹ️ Профиль']
]).resize();

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    
    await ctx.reply(
        `👋 Добро пожаловать в **AI Studio Hub**!\n\nИспользуй нижнее меню для навигации. Отправь текст или фото, чтобы начать работу с ИИ.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard }
    );
});

// Обработка нижнего меню
bot.hears('🚀 Выбрать модель', (ctx) => {
    ctx.reply('Выберите модель для работы:', Markup.inlineKeyboard([
        [Markup.button.callback('⚡ Flash 3.8', 'model_flash_3_8'), Markup.button.callback('🧠 Pro 3.1', 'model_pro_3_1')],
        [Markup.button.callback('🚀 Flash-Lite', 'model_flash_lite'), Markup.button.callback('🔍 Deep Research', 'model_deep_research')],
        [Markup.button.callback('🎨 Nano Banana 2', 'model_nano_banana_2'), Markup.button.callback('🍌 Nano Banana Pro', 'model_nano_banana_pro')]
    ]));
});

bot.hears('⚙️ Настройки', (ctx) => {
    ctx.reply('⚙️ **Настройки генерации изображений:**\nВыберите соотношение сторон:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('Квадрат (1:1)', 'ratio_1:1')],
            [Markup.button.callback('Горизонтально (16:9)', 'ratio_16:9'), Markup.button.callback('Вертикально (9:16)', 'ratio_9:16')]
        ])
    });
});

bot.hears('💳 Баланс / Пополнить', async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    ctx.reply(
        `💰 Твой баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n\nВыберите пакет пополнения:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💎 1 руб (Тест)', 'pay_1'), Markup.button.callback('🪙 50 руб (10 ток.)', 'pay_50')],
                [Markup.button.callback('🪙 100 руб (20 ток.)', 'pay_100'), Markup.button.callback('🪙 500 руб (100 ток.)', 'pay_500')],
                [Markup.button.callback('🚀 1000 руб (200 ток.)', 'pay_1000'), Markup.button.callback('🔥 5000 руб (1000 ток.)', 'pay_5000')]
            ])
        }
    );
});

bot.hears('ℹ️ Профиль', async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    const state = userState[userId] || { model: 'flash_3_8', aspect_ratio: '1:1' };
    const model = MODELS[state.model];
    
    ctx.reply(
        `👤 **Ваш профиль:**\n\n🆔 ID: \`${userId}\`\n💰 Баланс: ${balance} 🪙\n🤖 Активная модель: ${model.name}\n🖼 Формат картинок: ${state.aspect_ratio}`,
        { parse_mode: 'Markdown' }
    );
});

// Обработка инлайн-кнопок моделей и настроек
bot.action(/model_(.+)/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    userState[ctx.from.id].model = modelKey;
    await ctx.answerCbQuery(`✅ Выбрана модель: ${MODELS[modelKey].name}`);
    await ctx.editMessageText(`✅ Вы успешно переключились на модель: **${MODELS[modelKey].name}**`, { parse_mode: 'Markdown' });
});

bot.action(/ratio_(.+)/, async (ctx) => {
    const ratio = ctx.match[1];
    if (!userState[ctx.from.id]) userState[ctx.from.id] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    userState[ctx.from.id].aspect_ratio = ratio;
    await ctx.answerCbQuery(`✅ Формат изменен на ${ratio}`);
    await ctx.editMessageText(`✅ Формат генерации изображений установлен на: **${ratio}**`, { parse_mode: 'Markdown' });
});

// Обработка кнопок оплаты
bot.action(/^pay_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parseInt(ctx.match[1]);
    const coins = amount === 1 ? 1 : amount / 5; // Простая логика конвертации
    await generatePaymentLink(ctx, ctx.from.id, amount, coins);
});

// --- Основная логика работы с ИИ ---
async function handleAIQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'User';

    // Защита от двойных списаний и спама запросами
    if (isProcessing.has(userId)) {
        return ctx.reply('⏳ Пожалуйста, дождитесь ответа на предыдущий запрос.');
    }

    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    const modelData = MODELS[userState[userId].model];

    // Проверка баланса ДО запроса
    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) return ctx.reply('❌ Ошибка базы данных.');
    if (balance < modelData.cost) {
        return ctx.reply(`❌ Недостаточно токенов.\nТребуется: ${modelData.cost} 🪙 | Баланс: ${balance} 🪙`);
    }

    isProcessing.add(userId);
    await ctx.sendChatAction(modelData.type === 'text' ? 'typing' : 'upload_photo');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        let replyText = '';

        if (modelData.type === 'text') {
            // Текстовые и Vision модели
            let contents = photoBuffer 
                ? [{ inlineData: { mimeType: 'image/jpeg', data: photoBuffer.toString('base64') } }, promptText || 'Опиши фото.']
                : promptText;

            const response = await ai.models.generateContent({
                model: modelData.modelId,
                contents: contents
            });
            replyText = response.text;

        } else if (modelData.type === 'image') {
            // Модели генерации изображений (Здесь пока возвращаем текст, если в SDK нет прямого метода)
            // Примечание: Если Google API поддерживает generateImages, код будет заменен на:
            replyText = `🖼 *Генерация изображения...*\n(Функция использует модель ${modelData.name} с форматом ${userState[userId].aspect_ratio}).\n\n*Запрос:* ${promptText}`;
            // Здесь должен быть реальный вызов API для изображений.
        }

        // Списываем баланс ТОЛЬКО после успешной генерации
        const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
        await ctx.reply(`${replyText}\n\n📉 _Списано: ${modelData.cost} 🪙 | Остаток: ${newBalance} 🪙_`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Ошибка ИИ:', error);
        await ctx.reply('⚠️ Ошибка при обработке запроса нейросетью. Токены не списаны.');
    } finally {
        isProcessing.delete(userId); // Разблокируем пользователя
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

// Запуск Webhook для Render
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Webhook установлен на ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
}

app.get('/', (req, res) => res.send('AI Studio Bot Server V2 is running!'));
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
