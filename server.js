const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
// ИСПРАВЛЕНО: Правильная библиотека
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

// ИСПРАВЛЕНО: Актуальные ID моделей Gemini
const MODELS = {
    'gemini_15_flash': { 
        name: 'Gemini 1.5 Flash', 
        modelId: 'gemini-1.5-flash', 
        cost: 1,
        maxInputChars: 10000,   
        maxOutputTokens: 2048  
    },
    'gemini_15_pro': { 
        name: 'Gemini 1.5 Pro', 
        modelId: 'gemini-1.5-pro', 
        cost: 3,
        maxInputChars: 30000,   
        maxOutputTokens: 4096  
    }
};

const userModels = {};
const processedPayments = new Set(); 

const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const mainReplyKeyboard = Markup.keyboard([
    ['🤖 Выбор модели', '💳 Личный кабинет']
]).resize();

function escapeMarkdown(text) {
    if (!text) return '';
    return String(text).replace(/([_*`\[\]()])/g, '\\$1');
}

// 1. ВЗАИМОДЕЙСТВИЕ С GOOGLE ТАБЛИЦЕЙ
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

// 2. ЮKASSA (ИСПРАВЛЕНО: await внутри async функции)
async function generatePaymentLink(ctx, userId, amountRub, creditsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    try {
        // Получаем инфо о боте динамически
        const botInfo = await ctx.telegram.getMe();
        
        const body = {
            amount: { value: `${amountRub}.00`, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: `https://t.me/${botInfo.username}` },
            capture: true,
            description: `Пополнение: ${creditsCount} кр.`,
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

        return ctx.reply(
            `💳 *Оплата кредитов*\n\n` +
            `💰 Сумма: *${amountRub} руб.*\n` +
            `🪙 Кредитов: *${creditsCount}*\n`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(`🔗 Оплатить ${amountRub} ₽`, confirmationUrl)]
                ])
            }
        );
    } catch (error) {
        console.error('Ошибка ЮKassa:', error.response?.data || error.message);
        return ctx.reply('❌ Ошибка создания платежа.');
    }
}

// Webhook ЮKassa
app.post('/yookassa-webhook', async (req, res) => {
    try {
        const { event, object } = req.body;
        if (event === 'payment.succeeded') {
            const paymentId = object.id;
            if (!processedPayments.has(paymentId)) {
                processedPayments.add(paymentId);
                const userId = object.metadata?.user_id;
                const credits = parseInt(object.metadata?.coins);
                if (userId) {
                    const newBalance = await callGoogleSheet('update', userId, '', credits);
                    await bot.telegram.sendMessage(userId, `✅ Оплата прошла! Зачислено ${credits} кр. Баланс: ${newBalance}`);
                }
            }
        }
        res.status(200).send('OK');
    } catch (e) { res.status(500).send('Error'); }
});

// 3. ОБРАБОТКА КОМАНД
bot.start(async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username || 'User');
    ctx.reply(`👋 Привет! Твой баланс: ${balance !== null ? balance : 0} кр.`, mainReplyKeyboard);
});

bot.hears('🤖 Выбор модели', async (ctx) => {
    const userId = ctx.from.id;
    const activeKey = userModels[userId] || 'gemini_15_flash';
    const buttons = Object.keys(MODELS).map(key => [
        Markup.button.callback(`${key === activeKey ? '✅ ' : ''}${MODELS[key].name}`, `set_model_${key}`)
    ]);
    ctx.reply('Выберите нейросеть:', Markup.inlineKeyboard(buttons));
});

bot.action(/^set_model_(.+)$/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (MODELS[modelKey]) {
        userModels[ctx.from.id] = modelKey;
        await ctx.answerCbQuery();
        ctx.reply(`Выбрана модель: ${MODELS[modelKey].name}`);
    }
});

bot.hears('💳 Личный кабинет', async (ctx) => {
    const balance = await callGoogleSheet('get', ctx.from.id, ctx.from.username);
    ctx.reply(`💰 Твой баланс: ${balance || 0} кр.\n\nВыберите пакет пополнения:`, Markup.inlineKeyboard([
        [Markup.button.callback('100 ₽ (20 кр)', 'pay_100')],
        [Markup.button.callback('500 ₽ (100 кр)', 'pay_500')],
        [Markup.button.callback('1000 ₽ (200 кр)', 'pay_1000')]
    ]));
});

bot.action(/pay_(\d+)/, async (ctx) => {
    const amount = parseInt(ctx.match[1]);
    const credits = amount / 5;
    await ctx.answerCbQuery();
    await generatePaymentLink(ctx, ctx.from.id, amount, credits);
});

// 4. ЛОГИКА AI (ИСПРАВЛЕНО: result.response.text())
async function handleAI(ctx, isPhoto = false) {
    const userId = ctx.from.id;
    const modelKey = userModels[userId] || 'gemini_15_flash';
    const cfg = MODELS[modelKey];

    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance < cfg.cost) return ctx.reply('❌ Недостаточно кредитов. Пополните баланс.');

    try {
        await ctx.sendChatAction('typing');
        const model = genAI.getGenerativeModel({ model: cfg.modelId });
        
        let prompt;
        if (isPhoto) {
            const photo = ctx.message.photo.pop();
            const link = await ctx.telegram.getFileLink(photo.file_id);
            const imgData = await axios.get(link.href, { responseType: 'arraybuffer' });
            prompt = [
                ctx.message.caption || "Что на этом изображении?",
                { inlineData: { data: Buffer.from(imgData.data).toString('base64'), mimeType: 'image/jpeg' } }
            ];
        } else {
            prompt = ctx.message.text;
        }

        const result = await model.generateContent(prompt);
        const text = result.response.text(); // ИСПРАВЛЕНО: это функция

        const newBal = await callGoogleSheet('update', userId, ctx.from.username, -cfg.cost);
        await ctx.reply(`${text}\n\n—\n🤖 ${cfg.name} | Оплачено: ${cfg.cost} кр. | Остаток: ${newBal} кр.`);
    } catch (e) {
        console.error(e);
        ctx.reply('❌ Ошибка нейросети. Попробуйте еще раз.');
    }
}

bot.on('photo', (ctx) => handleAI(ctx, true));
bot.on('text', (ctx) => {
    if (['🤖 Выбор модели', '💳 Личный кабинет'].includes(ctx.message.text)) return;
    handleAI(ctx, false);
});

// 5. ЗАПУСК СЕРВЕРА
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
    const path = `/telegraf/${bot.secretPathComponent()}`;
    bot.telegram.setWebhook(`${RENDER_URL}${path}`);
    app.use(bot.webhookCallback(path));
} else {
    bot.launch();
}

app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
