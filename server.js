'use strict';

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --------------------------------------------------
// ОБЯЗАТЕЛЬНЫЕ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
// --------------------------------------------------

function requiredEnv(name) {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`Не задана обязательная переменная окружения: ${name}`);
    }

    return value;
}

const BOT_TOKEN = requiredEnv('BOT_TOKEN');
const YUKASSA_SHOP_ID = requiredEnv('YUKASSA_SHOP_ID');
const YUKASSA_SECRET_KEY = requiredEnv('YUKASSA_SECRET_KEY');
const GOOGLE_SCRIPT_URL = requiredEnv('GOOGLE_SCRIPT_URL');
const GEMINI_API_KEY = requiredEnv('GEMINI_API_KEY');

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL?.trim();

const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY
});

const bot = new Telegraf(BOT_TOKEN);

bot.use(session());

// --------------------------------------------------
// МОДЕЛИ
// --------------------------------------------------

const MODELS = {
    flash_text: {
        name: '⚡ Gemini Flash',
        modelId: 'gemini-3.1-flash-lite',
        type: 'text',
        cost: 1,
        maxInputChars: 8000,
        maxOutputTokens: 2048
    },

    pro_text: {
        name: '🧠 Gemini Pro',
        modelId: 'gemini-3.1-pro-preview',
        type: 'text',
        cost: 3,
        maxInputChars: 30000,
        maxOutputTokens: 4096
    },

    nano_banana_2_lite: {
        name: '🏎 Nano Banana 2 Lite',
        modelId: 'gemini-3.1-flash-lite-image',
        type: 'image',
        cost: 1,
        maxInputChars: 800
    },

    nano_banana_2: {
        name: '🎨 Nano Banana 2',
        modelId: 'gemini-3.1-flash-image',
        type: 'image',
        cost: 2,
        maxInputChars: 2000
    },

    nano_banana_pro: {
        name: '✨ Nano Banana Pro',
        modelId: 'gemini-3-pro-image',
        type: 'image',
        cost: 4,
        maxInputChars: 3000
    }
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

const userState = new Map();
const processingUsers = new Set();

const ALLOWED_RATIOS = new Set([
    '1:1',
    '16:9',
    '9:16',
    '4:3',
    '3:4'
]);

function getUserState(userId) {
    if (!userState.has(userId)) {
        userState.set(userId, {
            model: 'flash_text',
            aspectRatio: '1:1'
        });
    }

    const state = userState.get(userId);

    if (!MODELS[state.model]) {
        state.model = 'flash_text';
    }

    if (!ALLOWED_RATIOS.has(state.aspectRatio)) {
        state.aspectRatio = '1:1';
    }

    return state;
}

// --------------------------------------------------
// TELEGRAM HELPERS
// --------------------------------------------------

function isTelegramBlockedError(error) {
    const errorCode =
        error?.response?.error_code ??
        error?.code ??
        error?.response?.status;

    return Number(errorCode) === 403;
}

async function safeReply(ctx, text, extra = {}) {
    try {
        return await ctx.reply(text, extra);
    } catch (error) {
        if (isTelegramBlockedError(error)) {
            console.warn(
                `[Telegram 403] Пользователь заблокировал бота: ${ctx.from?.id}`
            );
            return null;
        }

        console.error(
            'Ошибка отправки сообщения Telegram:',
            error.message
        );

        return null;
    }
}

async function safeAnswerCallback(ctx, text = '') {
    try {
        return await ctx.answerCbQuery(text);
    } catch (error) {
        if (!isTelegramBlockedError(error)) {
            console.warn(
                'Ошибка answerCbQuery:',
                error.message
            );
        }

        return null;
    }
}

async function safeEditMessage(ctx, text, extra = {}) {
    try {
        return await ctx.editMessageText(text, extra);
    } catch (error) {
        if (!isTelegramBlockedError(error)) {
            console.warn(
                'Ошибка редактирования Telegram-сообщения:',
                error.message
            );
        }

        return null;
    }
}

async function safeSendPhoto(ctx, buffer, extra = {}) {
    try {
        return await ctx.replyWithPhoto(
            { source: buffer },
            extra
        );
    } catch (error) {
        if (isTelegramBlockedError(error)) {
            console.warn(
                `[Telegram 403] Невозможно отправить фото пользователю: ${ctx.from?.id}`
            );
            return null;
        }

        console.error(
            'Ошибка отправки изображения в Telegram:',
            error.message
        );

        return null;
    }
}

// --------------------------------------------------
// GOOGLE SHEETS
// --------------------------------------------------

async function callGoogleSheet(
    action,
    userId,
    username = '',
    amount = 0,
    paymentId = ''
) {
    try {
        const response = await axios.post(
            GOOGLE_SCRIPT_URL,
            {
                action,
                userId: String(userId),
                username: username || '',
                amount: Number(amount) || 0,
                paymentId: paymentId || ''
            },
            {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const rawBalance = response.data?.balance;

        if (rawBalance === undefined || rawBalance === null) {
            return null;
        }

        const balance = Number(rawBalance);

        return Number.isFinite(balance) ? balance : null;
    } catch (error) {
        console.error(
            'Ошибка Google Sheets:',
            error.response?.data || error.message
        );

        return null;
    }
}

// --------------------------------------------------
// КЛАВИАТУРЫ
// --------------------------------------------------

const mainKeyboard = Markup.keyboard([
    [MENU_BUTTONS.SELECT, MENU_BUTTONS.SETTINGS],
    [MENU_BUTTONS.BALANCE, MENU_BUTTONS.PROFILE]
]).resize();

// --------------------------------------------------
// START
// --------------------------------------------------

bot.start(async (ctx) => {
    getUserState(ctx.from.id);

    await safeReply(
        ctx,
        [
            '👋 Добро пожаловать в AI Studio!',
            '',
            'Выберите модель и отправьте запрос.'
        ].join('\n'),
        mainKeyboard
    );
});

// --------------------------------------------------
// ВЫБОР МОДЕЛИ
// --------------------------------------------------

bot.hears(MENU_BUTTONS.SELECT, async (ctx) => {
    const buttons = Object.entries(MODELS).map(([key, model]) => {
        return [
            Markup.button.callback(
                `${model.name} — ${model.cost} 🪙`,
                `model_${key}`
            )
        ];
    });

    await safeReply(
        ctx,
        '🤖 Доступные модели:',
        Markup.inlineKeyboard(buttons)
    );
});

// --------------------------------------------------
// НАСТРОЙКИ
// --------------------------------------------------

bot.hears(MENU_BUTTONS.SETTINGS, async (ctx) => {
    const state = getUserState(ctx.from.id);

    const button = (ratio) =>
        Markup.button.callback(
            `${ratio} ${state.aspectRatio === ratio ? '✅' : ''}`,
            `ratio_${ratio.replace(':', '-')}`
        );

    await safeReply(
        ctx,
        `⚙️ Формат изображений: ${state.aspectRatio}`,
        Markup.inlineKeyboard([
            [button('1:1')],
            [button('16:9')],
            [button('9:16')],
            [button('4:3')],
            [button('3:4')]
        ])
    );
});

// --------------------------------------------------
// БАЛАНС
// --------------------------------------------------

bot.hears(MENU_BUTTONS.BALANCE, async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || '';

    const balance = await callGoogleSheet(
        'get',
        userId,
        username
    );

    const buttons = PAYMENT_PACKAGES.map((pkg) => [
        Markup.button.callback(
            `${pkg.name}: ${pkg.priceRub}₽ (${pkg.coins} 🪙)`,
            `pay_${pkg.id}`
        )
    ]);

    await safeReply(
        ctx,
        [
            `💳 Баланс: ${balance === null ? 'ошибка' : `${balance} 🪙`}`,
            '',
            'Выберите пакет пополнения:'
        ].join('\n'),
        Markup.inlineKeyboard(buttons)
    );
});

// --------------------------------------------------
// ПРОФИЛЬ
// --------------------------------------------------

bot.hears(MENU_BUTTONS.PROFILE, async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || '';

    const balance = await callGoogleSheet(
        'get',
        userId,
        username
    );

    const state = getUserState(userId);
    const model = MODELS[state.model];

    await safeReply(
        ctx,
        [
            '👤 Профиль пользователя',
            '',
            `🆔 ID: ${userId}`,
            `💰 Баланс: ${balance === null ? 'ошибка' : `${balance} 🪙`}`,
            `🤖 Модель: ${model.name}`,
            `📐 Формат картинок: ${state.aspectRatio}`
        ].join('\n')
    );
});

// --------------------------------------------------
// CALLBACK: МОДЕЛЬ
// --------------------------------------------------

bot.action(/^model_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const model = MODELS[key];

    if (!model) {
        await safeAnswerCallback(ctx, 'Модель не найдена');
        return;
    }

    const state = getUserState(ctx.from.id);
    state.model = key;

    await safeAnswerCallback(ctx, `Выбрано: ${model.name}`);

    const lines = [
        `✅ Активная модель: ${model.name}`,
        '',
        `💰 Стоимость: ${model.cost} 🪙`,
        `📏 Лимит запроса: ${model.maxInputChars} символов`
    ];

    if (model.type === 'text') {
        lines.push(
            `📤 Максимальный ответ: ${model.maxOutputTokens} токенов`
        );
    }

    await safeEditMessage(ctx, lines.join('\n'));
});

// --------------------------------------------------
// CALLBACK: ФОРМАТ ИЗОБРАЖЕНИЯ
// --------------------------------------------------

bot.action(/^ratio_(.+)$/, async (ctx) => {
    const ratio = ctx.match[1].replace('-', ':');

    if (!ALLOWED_RATIOS.has(ratio)) {
        await safeAnswerCallback(ctx, 'Неподдерживаемый формат');
        return;
    }

    const state = getUserState(ctx.from.id);
    state.aspectRatio = ratio;

    await safeAnswerCallback(ctx, `Формат: ${ratio}`);
    await safeEditMessage(
        ctx,
        `✅ Выбран формат изображений: ${ratio}`
    );
});

// --------------------------------------------------
// СОЗДАНИЕ ПЛАТЕЖА
// --------------------------------------------------

bot.action(/^pay_(.+)$/, async (ctx) => {
    const packageId = ctx.match[1];
    const pkg = PAYMENT_PACKAGES.find(
        (item) => item.id === packageId
    );

    if (!pkg) {
        await safeAnswerCallback(ctx, 'Пакет не найден');
        return;
    }

    await safeAnswerCallback(ctx);

    const authString = Buffer
        .from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`)
        .toString('base64');

    const idempotenceKey =
        `${ctx.from.id}-${pkg.id}-${Date.now()}-${Math.random()}`;

    try {
        const response = await axios.post(
            'https://api.yookassa.ru/v3/payments',
            {
                amount: {
                    value: `${pkg.priceRub}.00`,
                    currency: 'RUB'
                },
                confirmation: {
                    type: 'redirect',
                    return_url: 'https://t.me/'
                },
                capture: true,
                description: `Покупка ${pkg.coins} монет`,
                metadata: {
                    user_id: String(ctx.from.id),
                    package_id: pkg.id,
                    coins: String(pkg.coins)
                }
            },
            {
                timeout: 15000,
                headers: {
                    Authorization: `Basic ${authString}`,
                    'Content-Type': 'application/json',
                    'Idempotence-Key': idempotenceKey
                }
            }
        );

        const paymentId = response.data?.id;
        const confirmationUrl =
            response.data?.confirmation?.confirmation_url;

        if (!paymentId || !confirmationUrl) {
            throw new Error('ЮKassa не вернула данные платежа');
        }

        await safeReply(
            ctx,
            `💳 Счёт создан на ${pkg.priceRub}₽`,
            Markup.inlineKeyboard([
                [
                    Markup.button.url(
                        '🔗 Оплатить',
                        confirmationUrl
                    )
                ],
                [
                    Markup.button.callback(
                        '🔄 Проверить оплату',
                        `check_${paymentId}`
                    )
                ]
            ])
        );
    } catch (error) {
        console.error(
            'Ошибка создания платежа:',
            error.response?.data || error.message
        );

        await safeReply(
            ctx,
            '❌ Не удалось создать платёж.'
        );
    }
});

// --------------------------------------------------
// ПРОВЕРКА ПЛАТЕЖА
// --------------------------------------------------

bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];

    await safeAnswerCallback(ctx, 'Проверка платежа...');

    const authString = Buffer
        .from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`)
        .toString('base64');

    try {
        const response = await axios.get(
            `https://api.yookassa.ru/v3/payments/${paymentId}`,
            {
                timeout: 15000,
                headers: {
                    Authorization: `Basic ${authString}`
                }
            }
        );

        const payment = response.data;

        if (
            String(payment.metadata?.user_id) !==
            String(ctx.from.id)
        ) {
            await safeReply(ctx, '❌ Платёж принадлежит другому пользователю.');
            return;
        }

        if (payment.status !== 'succeeded') {
            await safeReply(
                ctx,
                `⏳ Платёж ещё не завершён.\nСтатус: ${payment.status}`
            );
            return;
        }

        const coins = Number(payment.metadata?.coins || 0);

        if (!Number.isFinite(coins) || coins <= 0) {
            await safeReply(ctx, '❌ Некорректное количество монет.');
            return;
        }

        const newBalance = await callGoogleSheet(
            'update',
            ctx.from.id,
            ctx.from.username || '',
            coins,
            paymentId
        );

        if (newBalance === null) {
            await safeReply(
                ctx,
                '⚠️️ Платёж подтверждён, но баланс пока не удалось обновить. Обратитесь в поддержку.'
            );
            return;
        }

        await safeEditMessage(
            ctx,
            [
                '✅ Оплата прошла успешно!',
                '',
                `Зачислено: ${coins} 🪙`,
                `Текущий баланс: ${newBalance} 🪙`
            ].join('\n')
        );
    } catch (error) {
        console.error(
            'Ошибка проверки платежа:',
            error.response?.data || error.message
        );

        await safeReply(
            ctx,
            '❌ Ошибка проверки платежа.'
        );
    }
});

// --------------------------------------------------
// GEMINI TEXT
// --------------------------------------------------

async function generateText(model, promptText, photoBuffer) {
    const parts = [];

    if (promptText?.trim()) {
        parts.push({
            text: promptText.trim()
        });
    } else {
        parts.push({
            text: 'Опиши подробно это изображение.'
        });
    }

    if (photoBuffer) {
        parts.push({
            inlineData: {
                mimeType: 'image/jpeg',
                data: photoBuffer.toString('base64')
            }
        });
    }

    const response = await ai.models.generateContent({
        model: model.modelId,
        contents: [
            {
                role: 'user',
                parts
            }
        ],
        config: {
            maxOutputTokens: model.maxOutputTokens
        }
    });

    const text = response.text?.trim();

    if (!text) {
        throw new Error('Google не вернул текстовый ответ.');
    }

    return text;
}

// --------------------------------------------------
// GEMINI IMAGE
// --------------------------------------------------

async function generateImage(
    model,
    promptText,
    photoBuffer,
    aspectRatio
) {
    const parts = [];

    parts.push({
        text: promptText?.trim() ||
            (
                photoBuffer
                    ? 'Создай улучшенную версию предоставленного изображения.'
                    : 'Создай красивое качественное изображение.'
            )
    });

    if (photoBuffer) {
        parts.push({
            inlineData: {
                mimeType: 'image/jpeg',
                data: photoBuffer.toString('base64')
            }
        });
    }

    const response = await ai.models.generateContent({
        model: model.modelId,
        contents: [
            {
                role: 'user',
                parts
            }
        ],
        config: {
            responseModalities: ['IMAGE'],
            imageConfig: {
                aspectRatio,
                outputMimeType: 'image/jpeg'
            }
        }
    });

    const candidates = response.candidates || [];

    for (const candidate of candidates) {
        const responseParts = candidate.content?.parts || [];

        for (const part of responseParts) {
            const imageData = part.inlineData?.data;
            const mimeType = part.inlineData?.mimeType;

            if (
                imageData &&
                mimeType &&
                mimeType.startsWith('image/')
            ) {
                return {
                    buffer: Buffer.from(imageData, 'base64'),
                    mimeType
                };
            }
        }
    }

    const blockReason =
        response.promptFeedback?.blockReason ||
        candidates[0]?.finishReason ||
        'UNKNOWN';

    throw new Error(
        `Google не вернул изображение. Причина: ${blockReason}`
    );
}

// --------------------------------------------------
// РАЗБИВКА ДЛИННЫХ СООБЩЕНИЙ
// --------------------------------------------------

function splitTelegramMessage(text, maxLength = 4000) {
    const chunks = [];

    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.slice(i, i + maxLength));
    }

    return chunks;
}

// --------------------------------------------------
// ОСНОВНАЯ ЛОГИКА
// --------------------------------------------------

async function handleAIQuery(
    ctx,
    promptText = '',
    photoBuffer = null
) {
    const userId = ctx.from.id;
    const username = ctx.from.username || '';

    if (processingUsers.has(userId)) {
        await safeReply(
            ctx,
            '⏳ Предыдущий запрос ещё выполняется.'
        );
        return;
    }

    processingUsers.add(userId);

    try {
        const originalState = getUserState(userId);

        const state = {
            model: originalState.model,
            aspectRatio: originalState.aspectRatio
        };

        const model = MODELS[state.model] || MODELS.flash_text;
        const prompt = String(promptText || '').trim();

        if (prompt.length > model.maxInputChars) {
            await safeReply(
                ctx,
                [
                    '⛔ Запрос слишком длинный.',
                    `Максимум: ${model.maxInputChars} символов`,
                    `Сейчас: ${prompt.length} символов`
                ].join('\n')
            );
            return;
        }

        const balance = await callGoogleSheet(
            'get',
            userId,
            username
        );

        if (balance === null) {
            await safeReply(
                ctx,
                '❌ Не удалось получить баланс.'
            );
            return;
        }

        if (balance < model.cost) {
            await safeReply(
                ctx,
                [
                    '❌ Недостаточно монет.',
                    `Стоимость: ${model.cost} 🪙`,
                    `Баланс: ${balance} 🪙`
                ].join('\n')
            );
            return;
        }

        if (model.type === 'text') {
            try {
                await ctx.sendChatAction('typing');
            } catch (_) {}

            const result = await generateText(
                model,
                prompt,
                photoBuffer
            );

            const newBalance = await callGoogleSheet(
                'update',
                userId,
                username,
                -model.cost
            );

            if (newBalance === null) {
                await safeReply(
                    ctx,
                    '⚠️ Ответ получен, но списание монет не подтвердилось. Обратитесь в поддержку.'
                );
                return;
            }

            const messages = splitTelegramMessage(result);

            for (const message of messages) {
                await safeReply(ctx, message);
            }

            await safeReply(
                ctx,
                `📉 Списано: ${model.cost} 🪙\n💰 Баланс: ${newBalance} 🪙`
            );

            return;
        }

        if (model.type === 'image') {
            try {
                await ctx.sendChatAction('upload_photo');
            } catch (_) {}

            const image = await generateImage(
                model,
                prompt,
                photoBuffer,
                state.aspectRatio
            );

            const newBalance = await callGoogleSheet(
                'update',
                userId,
                username,
                -model.cost
            );

            if (newBalance === null) {
                await safeReply(
                    ctx,
                    '⚠️ Изображение создано, но списание монет не подтвердилось. Обратитесь в поддержку.'
                );
                return;
            }

            // Исправлено: await с маленькой буквы
            await safeSendPhoto(
                ctx,
                image.buffer,
                {
                    caption: [
                        `✅ Готово: ${model.name}`,
                        `📐 Формат: ${state.aspectRatio}`,
                        `📉 Списано: ${model.cost} 🪙`,
                        `💰 Баланс: ${newBalance} 🪙`
                    ].join('\n')
                }
            );
        }
    } catch (error) {
        console.error(
            'Ошибка обработки AI-запроса:',
            error.response?.data || error.message
        );

        await safeReply(
            ctx,
            [
                '❌ Не удалось обработать запрос.',
                '',
                error.message || 'Неизвестная ошибка'
            ].join('\n')
        );
    } finally {
        processingUsers.delete(userId);
    }
}

// --------------------------------------------------
// ПОЛУЧЕНИЕ ФОТОГРАФИИ
// --------------------------------------------------

async function downloadTelegramPhoto(ctx) {
    const photos = ctx.message?.photo;

    if (!photos || photos.length === 0) {
        return null;
    }

    const largestPhoto = photos[photos.length - 1];
    const fileLink = await ctx.telegram.getFileLink(
        largestPhoto.file_id
    );

    const response = await axios.get(fileLink.href, {
        responseType: 'arraybuffer',
        timeout: 30000
    });

    return Buffer.from(response.data);
}

// --------------------------------------------------
// ТЕКСТОВЫЕ СООБЩЕНИЯ
// --------------------------------------------------

bot.on('text', async (ctx) => {
    const text = ctx.message.text?.trim();

    if (!text) {
        return;
    }

    if (
        text === MENU_BUTTONS.SELECT ||
        text === MENU_BUTTONS.SETTINGS ||
        text === MENU_BUTTONS.BALANCE ||
        text === MENU_BUTTONS.PROFILE
    ) {
        return;
    }

    await handleAIQuery(ctx, text);
});

// --------------------------------------------------
// ФОТОГРАФИИ С ПОДПИСЬЮ И БЕЗ НЕЁ
// --------------------------------------------------

bot.on('photo', async (ctx) => {
    const caption = ctx.message.caption?.trim() || '';

    try {
        const photoBuffer = await downloadTelegramPhoto(ctx);

        if (!photoBuffer) {
            await safeReply(
                ctx,
                '❌ Не удалось загрузить изображение.'
            );
            return;
        }

        await handleAIQuery(
            ctx,
            caption,
            photoBuffer
        );
    } catch (error) {
        console.error(
            'Ошибка загрузки фотографии:',
            error.message
        );

        await safeReply(
            ctx,
            '❌ Не удалось обработать фотографию.'
        );
    }
});

// --------------------------------------------------
// ОБРАБОТКА ОШИБОК TELEGRAM
// --------------------------------------------------

bot.catch(async (error, ctx) => {
    if (isTelegramBlockedError(error)) {
        console.warn(
            `[Telegram 403] Пользователь заблокировал бота: ${ctx?.from?.id}`
        );
        return;
    }

    console.error(
        'Глобальная ошибка Telegram:',
        error.response?.data || error.message
    );

    if (ctx) {
        await safeReply(
            ctx,
            '❌ Произошла внутренняя ошибка.'
        );
    }
});

// --------------------------------------------------
// HTTP API
// --------------------------------------------------

app.get('/', (req, res) => {
    res.status(200).send('AI Studio bot is running');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        ok: true,
        service: 'ai-studio-bot',
        date: new Date().toISOString()
    });
});

app.post('/yookassa/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
        const event = req.body?.event;
        const payment = req.body?.object;

        if (
            event !== 'payment.succeeded' ||
            !payment ||
            payment.status !== 'succeeded'
        ) {
            return;
        }

        const userId = payment.metadata?.user_id;
        const coins = Number(payment.metadata?.coins || 0);
        const paymentId = payment.id;

        if (!userId || !Number.isFinite(coins) || coins <= 0) {
            console.warn(
                'Webhook содержит неполные данные:',
                req.body
            );
            return;
        }

        const balance = await callGoogleSheet(
            'update',
            userId,
            '',
            coins,
            paymentId
        );

        if (balance === null) {
            console.error(
                `Не удалось начислить монеты по платежу ${paymentId}`
            );
            return;
        }

        await safeReply(
            {
                from: { id: userId },
                reply: (text, extra) =>
                    bot.telegram.sendMessage(
                        userId,
                        text,
                        extra
                    )
            },
            [
                '✅ Оплата подтверждена!',
                `Зачислено: ${coins} 🪙`,
                `Баланс: ${balance} 🪙`
            ].join('\n')
        );
    } catch (error) {
        console.error(
            'Ошибка YooKassa webhook:',
            error.message
        );
    }
});

// --------------------------------------------------
// ЗАПУСК
// --------------------------------------------------

async function start() {
    app.listen(PORT, () => {
        console.log(
            `HTTP-сервер запущен на порту ${PORT}`
        );
    });

    if (RENDER_EXTERNAL_URL) {
        const webhookPath = '/telegram/webhook';
        const webhookUrl =
            `${RENDER_EXTERNAL_URL.replace(/\/$/, '')}${webhookPath}`;

        // Важно: регистрируем обработчик вебхука Telegraf в Express
        app.use(bot.webhookCallback(webhookPath));

        await bot.telegram.setWebhook(webhookUrl);

        console.log(
            `Telegram webhook установлен: ${webhookUrl}`
        );
    } else {
        await bot.launch();

        console.log(
            'Telegram-бот запущен через long polling'
        );
    }
}

start().catch((error) => {
    console.error(
        'Критическая ошибка запуска:',
        error
    );
    process.exit(1);
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
});
