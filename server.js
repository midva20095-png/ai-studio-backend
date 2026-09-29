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
const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const bot = new Telegraf(BOT_TOKEN);

// Полный актуальный каталог моделей и эндпоинтов Google по новой документации
const MODELS = {
    'flash_3_8': { name: '⚡ Gemini 3.8 Flash', modelId: 'gemini-3.8-flash', cost: 12 },
    'pro_3_1': { name: '🧠 Gemini 3.1 Pro (Thinking)', modelId: 'gemini-3.1-pro-preview', cost: 25 },
    'flash_lite': { name: '🚀 Gemini 3.5 Flash-Lite', modelId: 'gemini-3.5-flash-lite', cost: 8 },
    'nano_banana_2': { name: '🎨 Nano Banana 2 (Images)', modelId: 'gemini-3.1-flash-image', cost: 15 },
    'nano_banana_pro': { name: '🍌 Nano Banana Pro', modelId: 'gemini-3-pro-image', cost: 20 },
    'veo_3_1': { name: '🎬 Veo 3.1 Video Generator', modelId: 'veo-3.1-generate-preview', cost: 50 },
    'lyria_3_5': { name: '🎵 Lyria 3.5 Music', modelId: 'lyria-3.5', cost: 35 },
    'deep_research': { name: '🔍 Gemini Deep Research', modelId: 'deep-research-preview-04-2026', cost: 45 }
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

        const paymentData = {
            confirmationUrl: response.data.confirmation.confirmation_url,
            paymentId: response.data.id
        };

        return ctx.reply(
            `💳 Ссылка на оплату создана!\n\n` +
            `💵 Сумма: ${amountRub} руб.\n` +
            `🪙 Токенов к зачислению: ${coinsCount}\n\n` +
            `⚠️ Оплатите по ссылке, а затем нажмите кнопку «🔄 Проверить оплату»:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(`🔗 Оплатить ${amountRub} руб.`, paymentData.confirmationUrl)],
                    [Markup.button.callback(`🔄 Проверить оплату`, `check_${paymentData.paymentId}`)],
                    [Markup.button.callback(`🔙 На главную`, `menu_main`)]
                ])
            }
        );
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.response?.data || error.message);
        return ctx.reply('❌ Ошибка создания платежа в ЮKassa. Попробуйте позже.');
    }
}

async function checkPaymentStatus(paymentId) {
    const url = `https://api.yookassa.ru/v3/payments/${paymentId}`;
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Basic ${authString}` }
        });
        return response.data;
    } catch (error) {
        console.error('Ошибка проверки статуса платежа:', error.response?.data || error.message);
        return null;
    }
}

// Главное меню с сеткой актуальных моделей и инструментов
async function sendMainMenu(ctx, edit = false) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const balance = await callGoogleSheet('get', userId, username);
    const modelKey = userModels[userId] || 'flash_3_8';
    const currentModel = MODELS[modelKey];

    const text = 
        `🤖 **AI Studio Hub — Панель управления**\n\n` +
        `👤 Пользователь: *${username}*\n` +
        `🆔 Твой ID: \`${userId}\`\n` +
        `💰 Баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n` +
        `⚙️ Инструмент: *${currentModel.name}* (${currentModel.cost} 🪙)\n\n` +
        `Выберите модель или инструмент для работы:`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('⚡ Flash 3.8', 'set_model_flash_3_8'),
            Markup.button.callback('🧠 Pro 3.1', 'set_model_pro_3_1')
        ],
        [
            Markup.button.callback('🚀 Flash-Lite 3.5', 'set_model_flash_lite'),
            Markup.button.callback('🎨 Nano Banana 2', 'set_model_nano_banana_2')
        ],
        [
            Markup.button.callback('🍌 Nano Banana Pro', 'set_model_nano_banana_pro'),
            Markup.button.callback('🎬 Veo 3.1 Video', 'set_model_veo_3_1')
        ],
        [
            Markup.button.callback('🎵 Lyria 3.5 Music', 'set_model_lyria_3_5'),
            Markup.button.callback('🔍 Deep Research', 'set_model_deep_research')
        ],
        [
            Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')
        ]
    ]);

    try {
        if (edit && ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
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

const modelActions = {
    'set_model_flash_3_8': 'flash_3_8',
    'set_model_pro_3_1': 'pro_3_1',
    'set_model_flash_lite': 'flash_lite',
    'set_model_nano_banana_2': 'nano_banana_2',
    'set_model_nano_banana_pro': 'nano_banana_pro',
    'set_model_veo_3_1': 'veo_3_1',
    'set_model_lyria_3_5': 'lyria_3_5',
    'set_model_deep_research': 'deep_research'
};

for (const [actionName, modelKey] of Object.entries(modelActions)) {
    bot.action(actionName, async (ctx) => {
        userModels[ctx.from.id] = modelKey;
        await ctx.answerCbQuery(`Выбрано: ${MODELS[modelKey].name}`);
        await sendMainMenu(ctx, true);
    });
}

bot.action('menu_buy', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);

    ctx.reply(
        `💳 **Пополнение баланса**\n\n` +
        `💰 Твой текущий баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n\n` +
        `Выберите пакет токенов:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💎 1 рубль (Тест)', 'pay_1')],
                [Markup.button.callback('🪙 50 руб (10 токенов)', 'pay_50'), Markup.button.callback('🪙 100 руб (20 токенов)', 'pay_100')],
                [Markup.button.callback('🪙 500 руб (100 токенов)', 'pay_500'), Markup.button.callback('🪙 1000 руб (200 токенов)', 'pay_1000')],
                [Markup.button.callback('🚀 5000 руб (1000 токенов)', 'pay_5000')],
                [Markup.button.callback('🔙 На главную', 'menu_main')]
            ])
        }
    );
});

bot.action('pay_1', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1, 1); });
bot.action('pay_50', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 50, 10); });
bot.action('pay_100', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 100, 20); });
bot.action('pay_500', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 500, 100); });
bot.action('pay_1000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1000, 200); });
bot.action('pay_5000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 5000, 1000); });

bot.action('menu_main', async (ctx) => {
    await ctx.answerCbQuery();
    await sendMainMenu(ctx, true);
});

bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const userId = ctx.from.id;

    await ctx.answerCbQuery('Проверяем платеж...');

    const paymentInfo = await checkPaymentStatus(paymentId);
    if (!paymentInfo) {
        return ctx.reply('❌ Не удалось связаться с ЮKassa. Попробуйте позже.');
    }

    if (paymentInfo.status === 'succeeded') {
        const coins = parseInt(paymentInfo.metadata?.coins) || 1;
        const amountPaid = paymentInfo.amount?.value || '';

        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, coins);

        try {
            await ctx.editMessageText(
                `✅ Платеж успешно подтвержден!\n` +
                `💵 Сумма: ${amountPaid} руб.\n` +
                `🪙 Зачислено токенов: ${coins}\n` +
                `💰 Ваш новый баланс: ${newBalance} 🪙`
            );
        } catch (e) {}

        return ctx.reply(
            `🎉 Баланс успешно пополнен на ${coins} токенов!\n` +
            `💰 Текущий баланс: ${newBalance} 🪙`,
            Markup.inlineKeyboard([[Markup.button.callback('🔙 На главную', 'menu_main')]])
        );
    } else {
        return ctx.reply(
            `❌ Платеж еще не прошел или имеет статус: ${paymentInfo.status}.\n` +
            `Оплатите по ссылке и попробуйте снова.`
        );
    }
});

// Универсальный обработчик запросов (текст и фото)
async function handleUserQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';

    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица). Попробуйте позже.');
    }

    const modelKey = userModels[userId] || 'flash_3_8';
    const selectedModel = MODELS[modelKey];

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ **Недостаточно токенов!**\n\n` +
            `🤖 Инструмент: ${selectedModel.name}\n` +
            `📉 Требуется: ${selectedModel.cost} 🪙 | Баланс: ${balance} 🪙\n\n` +
            `Пополните баланс в личном кабинете:`,
            Markup.inlineKeyboard([[Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]])
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

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
        const newBalance = await callGoogleSheet('update', userId, username, -selectedModel.cost);

        await ctx.reply(`${aiReply}\n\n*(${selectedModel.name} | Списано: ${selectedModel.cost} 🪙 | Остаток: ${newBalance} 🪙)*`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка обращения к Gemini AI:', error);
        ctx.reply('⚠️ Произошла ошибка при обращении к искусственному интеллекту. Попробуй позже.');
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
        ctx.reply('❌ Не удалось обработать прикрепленное фото.');
    }
});

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`Telegram webhook успешно установлен на ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    console.warn('ВНИМАНИЕ: Переменная RENDER_EXTERNAL_URL не найдена!');
}

app.get('/', (req, res) => {
    res.send('AI Studio Bot Server is running successfully with Gemini 3 models!');
});

app.listen(PORT, () => {
    console.log(`Web server is running on port ${PORT}`);
});
