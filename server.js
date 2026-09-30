const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// 🔑 КОНФИГУРАЦИЯ
const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 🤖 ПОЛНЫЙ СПИСОК МОДЕЛЕЙ
const MODELS = {
    'gemini_38_flash': { name: 'Gemini 3.8 Flash', cost: 1, id: 'gemini-1.5-flash' },
    'gemini_38_live': { name: 'Gemini 3.8 Live', cost: 2, id: 'gemini-1.5-flash' },
    'gemini_38_thinking': { name: 'Gemini 3.8 Live Thinking', cost: 3, id: 'gemini-1.5-pro' },
    'gemini_38_tts': { name: 'Gemini 3.8 Flash TTS', cost: 1.5, id: 'gemini-1.5-flash' },
    'gemini_38_tts_lite': { name: 'Gemini 3.8 Flash-Lite TTS', cost: 0.5, id: 'gemini-1.5-flash' },
    'gemini_37_flash': { name: 'Gemini 3.7 Flash', cost: 1, id: 'gemini-1.5-flash' },
    'gemini_36_flash': { name: 'Gemini 3.6 Flash', cost: 1, id: 'gemini-1.5-flash' },
    'gemini_35_flash': { name: 'Gemini 3.5 Flash', cost: 1, id: 'gemini-1.5-flash' },
    'gemini_35_lite': { name: 'Gemini 3.5 Flash-Lite', cost: 0.5, id: 'gemini-1.5-flash' },
    'gemini_31_lite': { name: 'Gemini 3.1 Flash-Lite', cost: 0.5, id: 'gemini-1.5-flash' },
    'nano_banana_pro': { name: 'Нано Банан Про', cost: 3, id: 'gemini-1.5-pro' },
    'nano_banana_2': { name: 'Нано Банан 2', cost: 2, id: 'gemini-1.5-pro' },
    'nano_banana_2_lite': { name: 'Nano Banana 2 Lite', cost: 2, id: 'gemini-1.5-pro' },
    'gemini_31_pro': { name: 'Gemini 3.1 Pro', cost: 3.5, id: 'gemini-1.5-pro' },
    'gemini_3_flash': { name: 'Gemini 3 Flash', cost: 1, id: 'gemini-1.5-flash' },
    'gemini_35_trans': { name: 'Gemini 3.5 Транскрипция', cost: 1, id: 'gemini-1.5-flash' },
    'gemini_35_translate': { name: 'Gemini 3.5 Live Translate', cost: 2.5, id: 'gemini-1.5-flash' },
    'gemini_31_live': { name: 'Gemini 3.1 Flash Live', cost: 1.5, id: 'gemini-1.5-flash' },
    'gemini_31_tts': { name: 'Gemini 3.1 Flash TTS', cost: 1, id: 'gemini-1.5-flash' },
    'gemini_omni_flash': { name: 'Gemini Omni Flash', cost: 4, id: 'gemini-1.5-pro' }
};

const userModels = {};
const processedPayments = new Set(); 

const bot = new Telegraf(BOT_TOKEN);

const mainReplyKeyboard = Markup.keyboard([
    ['🤖 Выбор модели', '💳 Личный кабинет']
]).resize();

function escapeMarkdown(text) {
    if (!text) return '';
    return String(text).replace(/([_*`\[\]()])/g, '\\$1');
}

// 1. РАБОТА С БАЗОЙ (GOOGLE SHEETS)
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
        console.error('Ошибка таблицы:', error.message);
        return null;
    }
}

// 2. ПЛАТЕЖИ (YUKASSA)
async function generatePaymentLink(ctx, userId, amountRub, creditsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    try {
        const botInfo = await ctx.telegram.getMe();
        const body = {
            amount: { value: `${amountRub}.00`, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: `https://t.me/${botInfo.username}` },
            capture: true,
            description: `Покупка ${creditsCount} кредитов`,
            metadata: { user_id: String(userId), coins: String(creditsCount) }
        };

        const response = await axios.post(url, body, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Idempotence-Key': Math.random().toString(36)
            }
        });

        const confirmationUrl = response.data.confirmation.confirmation_url;
        return ctx.reply(`💳 К оплате: ${amountRub} руб.\n🪙 Будет зачислено: ${creditsCount} кр.`, 
            Markup.inlineKeyboard([[Markup.button.url('🔗 Перейти к оплате', confirmationUrl)]]));
    } catch (error) {
        return ctx.reply('❌ Ошибка платежной системы.');
    }
}

app.post('/yookassa-webhook', async (req, res) => {
    try {
        const { event, object } = req.body;
        if (event === 'payment.succeeded' && !processedPayments.has(object.id)) {
            processedPayments.add(object.id);
            const userId = object.metadata.user_id;
            const credits = parseInt(object.metadata.coins);
            const newBalance = await callGoogleSheet('update', userId, '', credits);
            await bot.telegram.sendMessage(userId, `✅ Баланс пополнен! Текущий баланс: ${newBalance} кр.`);
        }
        res.status(200).send('OK');
    } catch (e) { res.status(500).send('Error'); }
});

// 3. ЛОГИКА БОТА
bot.start(async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username || 'User');
    ctx.reply(`Привет! Выберите модель ИИ и начните общение.\n💰 Ваш баланс: ${balance || 0} кр.`, mainReplyKeyboard);
});

bot.hears('🤖 Выбор модели', async (ctx) => {
    const userId = ctx.from.id;
    const activeKey = userModels[userId] || 'gemini_38_flash';
    
    // Генерируем кнопки (по 2 в ряд для удобства)
    const buttons = Object.keys(MODELS).map(key => {
        const isSelected = key === activeKey ? '✅ ' : '';
        return Markup.button.callback(`${isSelected}${MODELS[key].name} (${MODELS[key].cost} кр)`, `set_${key}`);
    });

    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }

    ctx.reply('Выберите модель ИИ:', Markup.inlineKeyboard(rows));
});

bot.action(/^set_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    if (MODELS[key]) {
        userModels[ctx.from.id] = key;
        await ctx.answerCbQuery();
        ctx.reply(`Вы активировали: ${MODELS[key].name}`);
    }
});

bot.hears('💳 Личный кабинет', async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    ctx.reply(`💰 Баланс: ${balance || 0} кр.\nКурс: 1 кредит = 5 руб.`, Markup.inlineKeyboard([
        [Markup.button.callback('Купить 20 кр. (100₽)', 'buy_100')],
        [Markup.button.callback('Купить 100 кр. (500₽)', 'buy_500')],
        [Markup.button.callback('Купить 200 кр. (1000₽)', 'buy_1000')]
    ]));
});

bot.action(/buy_(\d+)/, async (ctx) => {
    const amount = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await generatePaymentLink(ctx, ctx.from.id, amount, amount / 5);
});

// 4. ОБРАБОТКА НЕЙРОСЕТИ
async function handleAI(ctx, isPhoto = false) {
    const userId = ctx.from.id;
    const modelKey = userModels[userId] || 'gemini_38_flash';
    const config = MODELS[modelKey];

    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance < config.cost) return ctx.reply('❌ Недостаточно кредитов. Пополните баланс в кабинете.');

    try {
        await ctx.sendChatAction('typing');
        const model = genAI.getGenerativeModel({ model: config.id });
        
        let content;
        if (isPhoto) {
            const photo = ctx.message.photo.pop();
            const link = await ctx.telegram.getFileLink(photo.file_id);
            const img = await axios.get(link.href, { responseType: 'arraybuffer' });
            content = [
                ctx.message.caption || "Опиши фото",
                { inlineData: { data: Buffer.from(img.data).toString('base64'), mimeType: 'image/jpeg' } }
            ];
        } else {
            content = ctx.message.text;
        }

        const result = await model.generateContent(content);
        const text = result.response.text();

        const newBal = await callGoogleSheet('update', userId, ctx.from.username, -config.cost);
        await ctx.reply(`${text}\n\n🤖 *${config.name}*\n💸 Списано: ${config.cost} кр.\n💰 Остаток: ${newBal} кр.`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
        ctx.reply('❌ Ошибка нейросети. Попробуйте сменить модель или повторить позже.');
    }
}

bot.on('photo', (ctx) => handleAI(ctx, true));
bot.on('text', (ctx) => {
    if (['🤖 Выбор модели', '💳 Личный кабинет'].includes(ctx.message.text)) return;
    handleAI(ctx, false);
});

// 5. ЗАПУСК
const URL = process.env.RENDER_EXTERNAL_URL;
if (URL) {
    const hookPath = `/telegraf/${bot.secretPathComponent()}`;
    bot.telegram.setWebhook(`${URL}${hookPath}`);
    app.use(bot.webhookCallback(hookPath));
} else {
    bot.launch();
}

app.listen(PORT, () => console.log(`🚀 Бот запущен на порту ${PORT}`));

// Обработка корректного завершения
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
