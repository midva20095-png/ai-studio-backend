const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Настройки
const app = express();
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const bot = new Telegraf(BOT_TOKEN);

app.use(cors());
app.use(express.json());

const MODELS = {
    'g38f': { name: 'Gemini 3.8 Flash', cost: 1, eng: 'gemini-1.5-flash' },
    'g31p': { name: 'Gemini 3.1 Pro', cost: 3.5, eng: 'gemini-1.5-pro' },
    'nbp': { name: 'Нано Банан Про', cost: 3, eng: 'gemini-1.5-pro' }
};

const userSettings = {};

// Функция баланса
async function getBalance(uid, user = '') {
    try {
        const r = await axios.post(GOOGLE_SCRIPT_URL, { action: 'get', userId: String(uid), username: user });
        return r.data.balance;
    } catch (e) { return 0; }
}

async function updateBalance(uid, amount) {
    try {
        const r = await axios.post(GOOGLE_SCRIPT_URL, { action: 'update', userId: String(uid), amount: amount });
        return r.data.balance;
    } catch (e) { return 0; }
}

// Меню
const mainKb = Markup.keyboard([['🤖 Выбор модели', '💳 Кабинет']]).resize();

bot.start(async (ctx) => {
    const b = await getBalance(ctx.from.id, ctx.from.username);
    ctx.reply(`Привет! Твой баланс: ${b} кр.`, mainKb);
});

bot.hears('🤖 Выбор модели', (ctx) => {
    const btns = Object.keys(MODELS).map(k => [Markup.button.callback(MODELS[k].name, `set_${k}`)]);
    ctx.reply('Выбери модель:', Markup.inlineKeyboard(btns));
});

bot.action(/^set_(.+)$/, async (ctx) => {
    userSettings[ctx.from.id] = ctx.match[1];
    await ctx.answerCbQuery();
    ctx.reply(`Установлена модель: ${MODELS[ctx.match[1]].name}`);
});

bot.on('text', async (ctx) => {
    if (['🤖 Выбор модели', '💳 Кабинет'].includes(ctx.message.text)) return;
    
    const uid = ctx.from.id;
    const mKey = userSettings[uid] || 'g38f';
    const cfg = MODELS[mKey];
    
    const b = await getBalance(uid);
    if (b < cfg.cost) return ctx.reply('Недостаточно кредитов!');

    try {
        await ctx.sendChatAction('typing');
        const model = genAI.getGenerativeModel({ model: cfg.eng });
        const result = await model.generateContent(ctx.message.text);
        const text = result.response.text();
        
        const newB = await updateBalance(uid, -cfg.cost);
        ctx.reply(`${text}\n\nОстаток: ${newB} кр.`, { parse_mode: 'HTML' });
    } catch (e) {
        ctx.reply('Ошибка нейросети.');
    }
});

// Настройки Render
const WEB_URL = process.env.RENDER_EXTERNAL_URL;
if (WEB_URL) {
    bot.telegram.setWebhook(`${WEB_URL}/telegraf`);
    app.use(bot.webhookCallback('/telegraf'));
} else {
    bot.launch();
}

app.get('/', (req, res) => res.send('Бот работает!'));
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
