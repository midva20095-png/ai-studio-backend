const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Инициализация Google AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- СПИСОК МОДЕЛЕЙ И ЦЕНЫ ---
// Т.к. многих версий (3.8, Nano Banana) физически еще нет в API Google, 
// они замаплены на стабильные движки (Flash/Pro), чтобы у пользователей все работало.
const MODELS = {
    'g38f': { name: 'Gemini 3.8 Flash', cost: 1, engine: 'gemini-1.5-flash' },
    'g38l': { name: 'Gemini 3.8 Live', cost: 2, engine: 'gemini-1.5-flash' },
    'g38th': { name: 'Близнецы 3.8 Живи расширенным мышлением', cost: 3, engine: 'gemini-1.5-pro' },
    'g38tts': { name: 'Gemini 3.8 Flash TTS', cost: 1.5, engine: 'gemini-1.5-flash' },
    'g38ttsl': { name: 'Gemini 3.8 Flash-Lite TTS', cost: 0.5, engine: 'gemini-1.5-flash' },
    'g37f': { name: 'Gemini 3.7 Flash', cost: 1, engine: 'gemini-1.5-flash' },
    'g36f': { name: 'Вспышка Gemini 3.6', cost: 1, engine: 'gemini-1.5-flash' },
    'g35f': { name: 'Вспышка Gemini 3.5', cost: 1, engine: 'gemini-1.5-flash' },
    'g35fl': { name: 'Фонарь Gemini 3.5 Flash-Lite', cost: 0.5, engine: 'gemini-1.5-flash' },
    'g31f': { name: 'Фонарик Gemini 3.1', cost: 0.5, engine: 'gemini-1.5-flash' },
    'nbp': { name: 'Нано Банан Про', cost: 3, engine: 'gemini-1.5-pro' },
    'nb2': { name: 'Нано Банан 2', cost: 2, engine: 'gemini-1.5-pro' },
    'nb2l': { name: 'Nano Banana 2 Lite', cost: 2, engine: 'gemini-1.5-pro' },
    'g31p': { name: 'Gemini 3.1 Pro', cost: 3.5, engine: 'gemini-1.5-pro' },
    'g3f': { name: 'Gemini 3 Flash', cost: 1, engine: 'gemini-1.5-flash' },
    'g35t': { name: 'Gemini 3.5 Транскрипция', cost: 1, engine: 'gemini-1.5-flash' },
    'g35lt': { name: 'Gemini 3.5 Live Translate', cost: 2.5, engine: 'gemini-1.5-flash' },
    'g31fl': { name: 'Gemini 3.1 Flash Live', cost: 1.5, engine: 'gemini-1.5-flash' },
    'g31ft': { name: 'Gemini 3.1 Flash TTS', cost: 1, engine: 'gemini-1.5-flash' },
    'gomni': { name: 'Gemini Omni Flash', cost: 4, engine: 'gemini-1.5-pro' }
};

const userModels = {}; // Храним выбор в RAM (обнуляется при рестарте Render)
const processedPayments = new Set(); 

const bot = new Telegraf(BOT_TOKEN);

// Клавиатура
const mainReplyKeyboard = Markup.keyboard([
    ['🤖 Выбор модели', '💳 Личный кабинет']
]).resize();

// Функция взаимодействия с Google Таблицей
async function callGoogleSheet(action, userId, username = '', amount = 0) {
    try {
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
            action, 
            userId: String(userId), 
            username, 
            amount 
        }, { timeout: 10000 });
        return response.data.balance;
    } catch (error) {
        console.error('Ошибка Google Таблицы:', error.message);
        return null;
    }
}

// ПЛАТЕЖИ
async function createPayLink(ctx, userId, amount, credits) {
    const auth = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    try {
        const botInfo = await ctx.telegram.getMe();
        const res = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: { value: `${amount}.00`, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: `https://t.me/${botInfo.username}` },
            capture: true,
            description: `Пополнение: ${credits} кр.`,
            metadata: { user_id: String(userId), coins: String(credits) }
        }, {
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Idempotence-Key': Date.now().toString() }
        });
        
        await ctx.reply(`Счет на ${amount}₽ сформирован:`, Markup.inlineKeyboard([
            [Markup.button.url('🔗 Оплатить', res.data.confirmation.confirmation_url)]
        ]));
    } catch (e) {
        ctx.reply('Ошибка связи с ЮKassa.');
    }
}

// WEBHOOK ЮKASSA
app.post('/yookassa-webhook', async (req, res) => {
    const event = req.body;
    if (event.event === 'payment.succeeded') {
        const obj = event.object;
        if (!processedPayments.has(obj.id)) {
            processedPayments.add(obj.id);
            const uid = obj.metadata.user_id;
            const coins = parseInt(obj.metadata.coins);
            const bal = await callGoogleSheet('update', uid, '', coins);
            bot.telegram.sendMessage(uid, `✅ Оплата принята! +${coins} кр. Ваш баланс: ${bal} кр.`);
        }
    }
    res.status(200).send('OK');
});

// БОТ: ВЫБОР МОДЕЛИ
bot.hears('🤖 Выбор модели', async (ctx) => {
    const current = userModels[ctx.from.id] || 'g38f';
    const buttons = Object.keys(MODELS).map(key => {
        const prefix = key === current ? '✅ ' : '';
        return [Markup.button.callback(`${prefix}${MODELS[key].name} - ${MODELS[key].cost} кр.`, `set_${key}`)];
    });
    ctx.reply('Выберите интеллектуальную модель:', Markup.inlineKeyboard(buttons));
});

bot.action(/^set_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    if (MODELS[key]) {
        userModels[ctx.from.id] = key;
        await ctx.answerCbQuery(`Выбрано: ${MODELS[key].name}`);
        ctx.reply(`✅ Модель установлена: ${MODELS[key].name}`);
    }
});

// БОТ: ЛИЧНЫЙ КАБИНЕТ
bot.hears('💳 Личный кабинет', async (ctx) => {
    const bal = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    ctx.reply(`💰 Ваш баланс: <b>${bal ?? 0} кр.</b>\nКурс: 1 кредит = 5 руб.`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('100 руб. (20 кр.)', 'buy_100')],
            [Markup.button.callback('500 руб. (100 кр.)', 'buy_500')],
            [Markup.button.callback('1000 руб. (200 кр.)', 'buy_1000')]
        ])
    });
});

bot.action(/^buy_(\d+)$/, async (ctx) => {
    const rub = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await createPayLink(ctx, ctx.from.id, rub, rub / 5);
});

// ГЛАВНЫЙ ОБРАБОТЧИК AI
async function handleAIRequest(ctx, isPhoto = false) {
    const uid = ctx.from.id;
    const modelKey = userModels[uid] || 'g38f';
    const mCfg = MODELS[modelKey];

    const balance = await callGoogleSheet('get', uid, ctx.from.username);
    if (balance === null) return ctx.reply('Ошибка доступа к аккаунту.');
    if (balance < mCfg.cost) return ctx.reply('❌ Недостаточно кредитов. Пополните баланс в кабинете.');

    try {
        await ctx.sendChatAction('typing');
        const model = genAI.getGenerativeModel({ model: mCfg.engine });
        
        let prompt;
        if (isPhoto) {
            const photoId = ctx.message.photo.pop().file_id;
            const link = await ctx.telegram.getFileLink(photoId);
            const res = await axios.get(link.href, { responseType: 'arraybuffer' });
            prompt = [
                ctx.message.caption || "Что на картинке?",
                { inlineData: { data: Buffer.from(res.data).toString('base64'), mimeType: 'image/jpeg' } }
            ];
        } else {
            prompt = ctx.message.text;
        }

        const result = await model.generateContent(prompt);
        const aiText = result.response.text();
        
        const newBal = await callGoogleSheet('update', uid, '', -mCfg.cost);

        // Используем HTML для безопасной вставки текста от AI
        await ctx.reply(`<b>${mCfg.name}</b>\n\n${aiText}\n\n<i>💰 Списано: ${mCfg.cost} кр. | Остаток: ${newBal} кр.</i>`, { parse_mode: 'HTML' });
        
    } catch (e) {
        console.error(e.message);
        ctx.reply('⚠️ Ошибка AI. Возможно, модель временно недоступна. Попробуйте сменить модель в меню.');
    }
}

bot.start(async (ctx) => {
    await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    ctx.reply('Бот запущен! Отправь мне текст или фото для анализа.', mainReplyKeyboard);
});

bot.on('photo', (ctx) => handleAIRequest(ctx, true));
bot.on('text', (ctx) => {
    if (ctx.message.text === '🤖 Выбор модели' || ctx.message.text === '💳 Личный кабинет') return;
    handleAIRequest(ctx, false);
});

// ЗАПУСК
const R_URL = process.env.RENDER_EXTERNAL_URL;
if (R_URL) {
    const secretPath = `/telegraf/${bot.secretPathComponent()}`;
    bot.telegram.setWebhook(`${R_URL}${secretPath}`);
    app.use(bot.webhookCallback(secretPath));
    console.log('Webhook mode active');
} else {
    bot.launch();
    console.log('Polling mode active');
}

app.get('/', (req, res) => res.send('Bot is Alive'));
app.listen(PORT, () => console.log(`Server started on ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
