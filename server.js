const express = require('express');
const cors = require('cors');
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- КОНФИГУРАЦИЯ С ТВОИМИ КЛЮЧАМИ ПО УМОЛЧАНИЮ ---
const BOT_TOKEN = process.env.BOT_TOKEN || '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID || '1120841';
const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY || 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''; // Если здесь нужен ключ, вставь его в кавычки

// Инициализация Google GenAI SDK
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Глобальный перехватчик ошибок Telegraf
bot.catch((err, ctx) => {
    const code = err.response?.error_code ?? err.code;
    if (Number(code) === 403) {
        console.warn(`[Bot Blocked] Пользователь ${ctx.from?.id} заблокировал бота.`);
        return;
    }
    console.error('Ошибка в обработчике Telegram:', {
        updateId: ctx.update?.update_id,
        code,
        message: err.message
    });
});

// — АКТУАЛЬНЫЕ МОДЕЛИ И ТАРИФЫ —
const MODELS = {
    'flash_3_8': { name: '⚡ Gemini 3.8 Flash', modelId: 'gemini-3.8-flash', type: 'text', cost: 1, maxInputChars: 8000, maxOutputTokens: 2048 },
    'pro_3_8': { name: '🧠 Gemini 3.8 Pro', modelId: 'gemini-3.8-pro', type: 'text', cost: 3, maxInputChars: 30000, maxOutputTokens: 4096 },
    'nano_banana_2_lite': { name: '🏎 Nano Banana 2 Lite', modelId: 'gemini-3.1-flash-lite-image', type: 'image', cost: 1, maxInputChars: 800 },
    'nano_banana_2': { name: '🎨 Nano Banana 2', modelId: 'gemini-3.1-flash-image', type: 'image', cost: 2, maxInputChars: 800 },
    'nano_banana_pro': { name: '✨ Nano Banana Pro', modelId: 'gemini-3-pro-image', type: 'image', cost: 4, maxInputChars: 800 }
};

const PAYMENT_PACKAGES = [
    { id: 'start', name: 'Старт', priceRub: 150, coins: 30 },
    { id: 'standard', name: 'Стандарт', priceRub: 500, coins: 100 },
    { id: 'lux', name: 'Люкс', priceRub: 1000, coins: 250 },
    { id: 'vip', name: 'VIP', priceRub: 2500, coins: 650 }
];

const MENU_BUTTONS = {
    SELECT: '🚀 Выбрать модель',
    SETTINGS: '⚙️ Настройки',
    BALANCE: '💳 Баланс / Пополнить',
    PROFILE: 'ℹ️ Профиль'
};

const userState = {};
const isProcessing = new Set();

function getUserState(userId) {
    if (!userState[userId]) {
        userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    }
    if (!MODELS[userState[userId].model]) {
        userState[userId].model = 'flash_3_8';
    }
    return userState[userId];
}

// Защищенная отправка сообщений
async function safeReply(ctx, text, extra = {}) {
    try {
        return await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
    } catch (e) {
        if (e.response && (e.response.error_code === 403 || e.code === 403)) {
            return null;
        }
        try {
            const cleanExtra = { ...extra };
            delete cleanExtra.parse_mode;
            return await ctx.reply(text, cleanExtra);
        } catch (innerErr) {
            console.error('Ошибка отправки сообщения Telegram:', innerErr.message);
            return null;
        }
    }
}

// Запрос к Google Таблицам
async function callGoogleSheet(action, userId, username = '', amount = 0) {
    try {
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
            action,
            userId: String(userId),
            username,
            amount
        }, { timeout: 8000 });
        
        const balance = response.data?.balance;
        return typeof balance === 'number' ? balance : null;
    } catch (error) {
        console.error('Ошибка Google Sheets API:', error.message);
        return null;
    }
}

// — ФУНКЦИЯ ГЕНЕРАЦИИ КАРТИНОК ЧЕРЕЗ GEMINI (generateContent) —
async function generateGeminiImage({ modelId, prompt, aspectRatio = '1:1', photoBuffer = null }) {
    const allowedRatios = new Set(['1:1', '16:9', '9:16']);
    const safeAspectRatio = allowedRatios.has(aspectRatio) ? aspectRatio : '1:1';

    const parts = [{
        text: prompt?.trim() || (photoBuffer ? 'Создай новое изображение на основе приложенного.' : 'Создай изображение.')
    }];

    if (photoBuffer) {
        parts.push({
            inlineData: {
                mimeType: 'image/jpeg',
                data: photoBuffer.toString('base64')
            }
        });
    }

    const response = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts }],
        config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: safeAspectRatio
            }
        }
    });

    const candidate = response.candidates?.[0];
    const resultParts = candidate?.content?.parts || [];

    const imagePart = resultParts.find(part =>
        !part.thought &&
        part.inlineData?.data &&
        part.inlineData?.mimeType?.startsWith('image/')
    );

    if (!imagePart) {
        const explanation = resultParts
            .filter(part => !part.thought && part.text)
            .map(part => part.text)
            .join('\n');

        const reason = response.promptFeedback?.blockReason || candidate?.finishReason || 'NO_IMAGE';
        throw new Error(`Google не вернул изображение (${reason}). ${explanation.slice(0, 300)}`);
    }

    return {
        buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
        mimeType: imagePart.inlineData.mimeType
    };
}

// — КЛАВИАТУРЫ И РОУТИНГ —
const mainKeyboard = Markup.keyboard([
    [MENU_BUTTONS.SELECT, MENU_BUTTONS.SETTINGS],
    [MENU_BUTTONS.BALANCE, MENU_BUTTONS.PROFILE]
]).resize();

bot.start((ctx) => {
    getUserState(ctx.from.id);
    safeReply(ctx, '👋 Добро пожаловать в AI Studio!\n\nВыберите модель кнопкой ниже и отправьте запрос.', mainKeyboard);
});

bot.hears(MENU_BUTTONS.SELECT, (ctx) => {
    const buttons = Object.keys(MODELS).map(k => {
        const m = MODELS[k];
        return [Markup.button.callback(`${m.name} — ${m.cost} 🪙`, `model_${k}`)];
    });
    safeReply(ctx, '🤖 Доступные нейросети:', Markup.inlineKeyboard(buttons));
});

bot.hears(MENU_BUTTONS.SETTINGS, (ctx) => {
    const st = getUserState(ctx.from.id);
    const r = st.aspect_ratio;
    safeReply(ctx, `⚙️ **Формат изображений:** текущий **${r}**`, Markup.inlineKeyboard([
        [Markup.button.callback(`1:1 ${r === '1:1' ? '✅' : ''}`, 'ratio_1:1')],
        [Markup.button.callback(`16:9 ${r === '16:9' ? '✅' : ''}`, 'ratio_16:9')],
        [Markup.button.callback(`9:16 ${r === '9:16' ? '✅' : ''}`, 'ratio_9:16')]
    ]));
});

bot.hears(MENU_BUTTONS.BALANCE, async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    const btns = PAYMENT_PACKAGES.map(p => [Markup.button.callback(`${p.name}: ${p.priceRub}₽ (${p.coins} 🪙)`, `pay_${p.id}`)]);
    safeReply(ctx, `💳 Баланс: **${balance !== null ? balance : 'Ошибка'} 🪙**\nВыберите пакет пополнения:`, Markup.inlineKeyboard(btns));
});

bot.hears(MENU_BUTTONS.PROFILE, async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    const state = getUserState(userId);
    const m = MODELS[state.model] || MODELS['flash_3_8'];

    safeReply(ctx, 
        `👤 **Профиль пользователя**\n\n` +
        `🆔 ID: \`${userId}\`\n` +
        `💰 Баланс: **${balance !== null ? balance : 'Ошибка'} 🪙**\n` +
        `🤖 Активная модель: **${m.name}** (${m.cost} 🪙)\n` +
        `📐 Формат картинок: **${state.aspect_ratio}**`
    );
});

// — CALLBACK ОБРАБОТЧИКИ —
bot.action(/^model_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    if (!MODELS[key]) return ctx.answerCbQuery('❌ Модель не найдена').catch(() => {});

    const state = getUserState(ctx.from.id);
    state.model = key;
    const m = MODELS[key];

    try {
        await ctx.answerCbQuery(`Выбрано: ${m.name}`);
        await ctx.editMessageText(
            `✅ Активная модель: **${m.name}**\n\n` +
            `💰 Стоимость: **${m.cost} 🪙**\n` +
            `📏 Лимит длины запроса: **${m.maxInputChars} символов**` +
            (m.type === 'text' ? `\n📤 Макс. длина ответа: **${m.maxOutputTokens} токенов**` : ''),
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        console.warn('Ошибка при обновлении сообщения модели:', e.message);
    }
});

bot.action(/^ratio_(.+)$/, async (ctx) => {
    const ratio = ctx.match[1];
    const state = getUserState(ctx.from.id);
    state.aspect_ratio = ratio;
    try {
        await ctx.answerCbQuery(`Формат: ${ratio}`);
        await ctx.editMessageText(`✅ Выбран формат картинок: **${ratio}**`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.warn('Ошибка при смене формата:', e.message);
    }
});

bot.action(/^pay_(.+)$/, async (ctx) => {
    const pkg = PAYMENT_PACKAGES.find(p => p.id === ctx.match[1]);
    if (!pkg) return ctx.answerCbQuery().catch(() => {});
    await ctx.answerCbQuery().catch(() => {});

    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    try {
        const r = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: { value: `${pkg.priceRub}.00`, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: 'https://t.me/ai_studio_hub_bot' },
            capture: true,
            description: `Покупка ${pkg.coins} монет`,
            metadata: { user_id: String(ctx.from.id), coins: String(pkg.coins) }
        }, {
            headers: { 'Authorization': `Basic ${authString}`, 'Content-Type': 'application/json', 'Idempotence-Key': Math.random().toString(36) },
            timeout: 10000
        });

        safeReply(ctx, `💳 **Счет на оплату создан** (${pkg.priceRub}₽)`, Markup.inlineKeyboard([
            [Markup.button.url('🔗 Оплатить', r.data.confirmation.confirmation_url)],
            [Markup.button.callback('🔄 Проверить оплату', `check_${r.data.id}`)]
        ]));
    } catch (e) {
        safeReply(ctx, '❌ Ошибка при формировании счета.');
    }
});

bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    await ctx.answerCbQuery('Проверка…').catch(() => {});

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
            safeReply(ctx, `⏳ Платеж обрабатывается. Статус: ${res.data.status}`);
        }
    } catch (e) {
        safeReply(ctx, '❌ Ошибка проверки статуса платежа.');
    }
});

// — ОСНОВНАЯ ЛОГИКА ОБРАБОТКИ ЗАПРОСОВ —
async function handleAIQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'User';

    if (isProcessing.has(userId)) {
        return safeReply(ctx, '⏳ Предыдущий запрос еще выполняется.');
    }

    isProcessing.add(userId);

    try {
        const state = { ...getUserState(userId) };
        const modelData = MODELS[state.model] || MODELS['flash_3_8'];

        if (promptText && promptText.length > modelData.maxInputChars) {
            return safeReply(
                ctx,
                `⛔ **Превышен лимит длины запроса!**\n\n` +
                `Модель: **${modelData.name}**\n` +
                `Максимум: **${modelData.maxInputChars}** символов\n` +
                `Ваш запрос: **${promptText.length}** символов`
            );
        }

        const balance = await callGoogleSheet('get', userId, username);
        if (balance === null) return safeReply(ctx, '❌ Ошибка связи с базой данных.');
        if (balance < modelData.cost) {
            return safeReply(ctx, `❌ **Недостаточно монет.**\nСтоимость запроса: ${modelData.cost} 🪙\nВаш баланс: ${balance} 🪙`);
        }

        if (modelData.type === 'text') {
            try { await ctx.sendChatAction('typing'); } catch (e) {}

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
            try { await ctx.sendChatAction('upload_photo'); } catch (e) {}

            const { buffer: imgBuffer } = await generateGeminiImage({
                modelId: modelData.modelId,
                prompt: promptText,
                aspectRatio: state.aspect_ratio || '1:1',
                photoBuffer
            });

            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            const balanceStr = newBalance !== null ? newBalance : (balance - modelData.cost);

            try {
                await ctx.replyWithPhoto(
                    { source: imgBuffer },
                    {
                        caption: `🖼 **Готово!** (${modelData.name})\n📐 Формат: ${state.aspect_ratio}\n\n📉 _Списано: ${modelData.cost} 🪙 | Баланс: ${balanceStr} 🪙_`,
                        parse_mode: 'Markdown'
                    }
                );
            } catch (err) {
                console.warn('Не удалось отправить сгенерированное фото:', err.message);
            }
        }
    } catch (err) {
        console.error('Ошибка API Google / Обработки:', err.response?.data || err.message);
        let userErrMsg = err.message || 'Сбой сервиса Google API';
        if (err.response?.data?.error?.message) {
            userErrMsg = err.response.data.error.message;
        }
        await safeReply(ctx, `⚠️ Ошибка генерации: ${userErrMsg}\nМонеты списаны не были.`);
    } finally {
        isProcessing.delete(userId);
    }
}

// — СЛУШАТЕЛИ СООБЩЕНИЙ —
bot.on('text', (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || Object.values(MENU_BUTTONS).includes(text)) return;
    handleAIQuery(ctx, text, null).catch(e => console.error('Unhandled AI query error:', e.message));
});

bot.on('photo', async (ctx) => {
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const caption = ctx.message.caption || '';
    try {
        const fileLink = await bot.telegram.getFileLink(photo.file_id);
        const res = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 10000 });
        handleAIQuery(ctx, caption, Buffer.from(res.data)).catch(e => console.error('Unhandled photo AI error:', e.message));
    } catch (e) {
        console.error('Ошибка загрузки фото:', e.message);
        safeReply(ctx, '❌ Ошибка скачивания фото.');
    }
});

// — СЕРВЕР И ВЕБХУК —
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    let webhookPath;
    try {
        webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    } catch (e) {
        webhookPath = `/telegraf/webhook`;
    }
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Telegram webhook успешно установлен на ${RENDER_EXTERNAL_URL}${webhookPath}`);
    }).catch(e => console.error('Ошибка установки вебхука:', e.message));
} else {
    bot.launch();
    console.log("Бот запущен локально (Long Polling)");
}

app.get('/', (req, res) => res.send('AI Studio Backend Status: OK'));
app.listen(PORT, () => console.log(`Web server is running on port ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
