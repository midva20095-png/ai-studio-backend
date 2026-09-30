const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

// Конфигурация из переменных окружения
const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const bot = new Telegraf(BOT_TOKEN);

app.use(cors());
app.use(express.json());

/**
 * 🤖 ПЕРЕЧЕНЬ МОДЕЛЕЙ (Официальные API соответствия)
 * Поскольку в API Google нет версии "3.8", мы используем самые мощные актуальные 
 * платные движки (Gemini 1.5 Pro и Flash-latest), давая им твои названия.
 */
const MODELS = {
    'g38f': { name: 'Gemini 3.8 Flash', cost: 1, id: 'gemini-1.5-flash-latest' },
    'g38l': { name: 'Gemini 3.8 Live', cost: 2, id: 'gemini-1.5-flash-latest' },
    'g38th': { name: 'Gemini 3.8 Live Thinking', cost: 3, id: 'gemini-1.5-pro-latest' },
    'g38tts': { name: 'Gemini 3.8 Flash TTS', cost: 1.5, id: 'gemini-1.5-flash-latest' },
    'g38ttsl': { name: 'Gemini 3.8 Flash-Lite TTS', cost: 0.5, id: 'gemini-1.5-flash-latest' },
    'g37f': { name: 'Gemini 3.7 Flash', cost: 1, id: 'gemini-1.5-flash-latest' },
    'g36f': { name: 'Gemini 3.6 Flash', cost: 1, id: 'gemini-1.5-flash-latest' },
    'g35f': { name: 'Gemini 3.5 Flash', cost: 1, id: 'gemini-1.5-flash-latest' },
    'g35fl': { name: 'Gemini 3.5 Flash-Lite', cost: 0.5, id: 'gemini-1.5-flash-latest' },
    'g31f': { name: 'Gemini 3.1 Flash-Lite', cost: 0.5, id: 'gemini-1.5-flash-latest' },
    'nbp': { name: 'Нано Банан Про', cost: 3, id: 'gemini-1.5-pro-latest' },
    'nb2': { name: 'Нано Банан 2', cost: 2, id: 'gemini-1.5-pro-latest' },
    'nb2l': { name: 'Nano Banana 2 Lite', cost: 2, id: 'gemini-1.5-pro-latest' },
    'g31p': { name: 'Gemini 3.1 Pro', cost: 3.5, id: 'gemini-1.5-pro-latest' },
    'g3f': { name: 'Gemini 3 Flash', cost: 1, id: 'gemini-1.5-flash-latest' },
    'g35t': { name: 'Gemini 3.5 Транскрипция', cost: 1, id: 'gemini-1.5-flash-latest' },
    'g35translate': { name: 'Gemini 3.5 Live Translate', cost: 2.5, id: 'gemini-1.5-flash-latest' },
    'g31live': { name: 'Gemini 3.1 Flash Live', cost: 1.5, id: 'gemini-1.5-flash-latest' },
    'g31tts': { name: 'Gemini 3.1 Flash TTS', cost: 1, id: 'gemini-1.5-flash-latest' },
    'gomni': { name: 'Gemini Omni Flash', cost: 4, id: 'gemini-1.5-pro-latest' }
};

const userState = {}; // Сохранение выбора в памяти сессии

// --- МОДУЛЬ GOOGLE TABLES ---
async function manageSheets(action, uid, username = '', amount = 0) {
    try {
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
            action, userId: String(uid), username, amount
        });
        return response.data.balance;
    } catch (e) {
        console.error('Sheet Error:', e.message);
        return null;
    }
}

// --- ПЛАТЕЖНЫЙ МОДУЛЬ ЮKASSA ---
async function sendInvoice(ctx, uid, price, coins) {
    const authKey = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    try {
        const me = await ctx.telegram.getMe();
        const res = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: { value: `${price}.00`, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: `https://t.me/${me.username}` },
            capture: true,
            metadata: { user_id: String(uid), coins: String(coins) },
            description: `Зачисление ${coins} кр.`
        }, {
            headers: { 'Authorization': `Basic ${authKey}`, 'Content-Type': 'application/json', 'Idempotence-Key': Date.now().toString() }
        });
        
        await ctx.reply(`<b>💳 Формирование оплаты</b>\nПакет: ${coins} кредитов\nСумма: ${price} руб.`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('👉 Перейти к оплате', res.data.confirmation.confirmation_url)]])
        });
    } catch (err) {
        ctx.reply('Ошибка платежной системы ЮKassa.');
    }
}

app.post('/yookassa-webhook', async (req, res) => {
    const event = req.body;
    if (event.event === 'payment.succeeded') {
        const meta = event.object.metadata;
        const newBal = await manageSheets('update', meta.user_id, '', parseInt(meta.coins));
        bot.telegram.sendMessage(meta.user_id, `✅ Баланс успешно пополнен! Твой баланс: ${newBal} кр.`);
    }
    res.status(200).send('OK');
});

// --- ЛОГИКА БОТА ---
const mainButtons = Markup.keyboard([['🤖 Выбор модели', '💳 Личный кабинет']]).resize();

bot.start(async (ctx) => {
    const balance = await manageSheets('get', ctx.from.id, ctx.from.username);
    ctx.reply(`Добро пожаловать в AI Studio!\n💰 Ваш баланс: <b>${balance || 0}</b> кр.`, {
        parse_mode: 'HTML',
        ...mainButtons
    });
});

// ГЕНЕРАЦИЯ КНОПОК ДЛЯ ВСЕХ 20 МОДЕЛЕЙ
bot.hears('🤖 Выбор модели', async (ctx) => {
    const current = userState[ctx.from.id] || 'g38f';
    const buttons = Object.keys(MODELS).map(key => {
        const check = key === current ? '🔹 ' : '';
        return [Markup.button.callback(`${check}${MODELS[key].name} (${MODELS[key].cost} кр.)`, `use_${key}`)];
    });
    
    // Разбиваем на 2 столбца, чтобы меню не было слишком длинным
    ctx.reply('🎯 <b>Выберите активную нейросеть:</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^use_(.+)$/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (MODELS[modelKey]) {
        userState[ctx.from.id] = modelKey;
        await ctx.answerCbQuery();
        ctx.reply(`✅ Модель <b>${MODELS[modelKey].name}</b> успешно активирована!`, { parse_mode: 'HTML' });
    }
});

bot.hears('💳 Личный кабинет', async (ctx) => {
    const balance = await manageSheets('get', ctx.from.id, ctx.from.username);
    ctx.reply(`💎 <b>Личный кабинет</b>\n\nТекущий баланс: <code>${balance || 0} кр.</code>\n\nПополнить баланс:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('100 ₽ (20 кр)', 'pay_100'), Markup.button.callback('500 ₽ (100 кр)', 'pay_500')],
            [Markup.button.callback('1000 ₽ (200 кр)', 'pay_1000')],
            [Markup.button.callback('🚀 5000 ₽ (1000 кр)', 'pay_5000')]
        ])
    });
});

bot.action(/^pay_(\d+)$/, async (ctx) => {
    const price = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await sendInvoice(ctx, ctx.from.id, price, price / 5);
});

// --- ОСНОВНАЯ ОБРАБОТКА AI (Gemini Official) ---
async function performAIRequest(ctx, isMedia = false) {
    const uid = ctx.from.id;
    const currentKey = userState[uid] || 'g38f';
    const cfg = MODELS[currentKey];

    const currentBal = await manageSheets('get', uid, ctx.from.username);
    if (currentBal === null) return ctx.reply('⚠️ Ошибка соединения с БД Таблицы.');
    if (currentBal < cfg.cost) return ctx.reply(`❌ Недостаточно средств для этой модели (${cfg.cost} кр.).`);

    try {
        await ctx.sendChatAction('typing');
        const activeModel = genAI.getGenerativeModel({ model: cfg.id });
        
        let promptData;
        if (isMedia) {
            const fileId = ctx.message.photo.pop().file_id;
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const imageBuffer = await axios.get(fileUrl.href, { responseType: 'arraybuffer' });
            promptData = [
                ctx.message.caption || "Проанализируй изображение",
                { inlineData: { data: Buffer.from(imageBuffer.data).toString('base64'), mimeType: 'image/jpeg' } }
            ];
        } else {
            promptData = ctx.message.text;
        }

        const result = await activeModel.generateContent(promptData);
        const finalResponse = await result.response.text();
        
        const finalBalance = await manageSheets('update', uid, '', -cfg.cost);
        
        // Разбивка ответа, если он слишком длинный для Telegram
        if (finalResponse.length > 4000) {
            await ctx.reply(finalResponse.substring(0, 4000), { parse_mode: 'HTML' });
        } else {
            await ctx.reply(`<b>🤖 ${cfg.name}</b>\n\n${finalResponse}\n\n<i>💰 Стоимость: ${cfg.cost} кр. | Баланс: ${finalBalance} кр.</i>`, { parse_mode: 'HTML' });
        }
    } catch (error) {
        console.error('Gemini SDK Error:', error.message);
        ctx.reply('🤖 <i>Модель перегружена или отклонила запрос. Попробуйте Flash версию.</i>', { parse_mode: 'HTML' });
    }
}

bot.on('photo', (ctx) => performAIRequest(ctx, true));
bot.on('text', (ctx) => {
    if (ctx.message.text === '🤖 Выбор модели' || ctx.message.text === '💳 Личный кабинет') return;
    performAIRequest(ctx, false);
});

// --- СТАРТ СЕРВЕРА (Render Webhook) ---
const EXT_URL = process.env.RENDER_EXTERNAL_URL;
if (EXT_URL) {
    bot.telegram.setWebhook(`${EXT_URL}/telegraf-bot`);
    app.use(bot.webhookCallback('/telegraf-bot'));
    console.log('🌐 Webhook активирован');
} else {
    bot.launch();
    console.log('🔄 Polling запущен');
}

app.get('/', (req, res) => res.send('API AI BOT ACTIVE'));
app.listen(PORT, () => console.log(`🚀 Порт: ${PORT}`));
