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
const bot = new Telegraf(BOT_TOKEN);

const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';

// Твоя новая точная ссылка на веб-приложение Google Таблицы
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyq4Joa7pPtUUNESXoZtXG9YWjy0RKEvUTH8zG0mi55rtjrMsb945VrU1rY3LRt7Oiw/exec';

const MODELS = {
    'flash': { name: '⚡ Gemini 3.8 Flash (Быстрая)', modelId: 'gemini-3.8-flash', cost: 1 },
    'pro': { name: '🧠 Nano Banana Pro / Gemini 3.1 Pro', modelId: 'gemini-3.1-pro-preview', cost: 5 }
};

const userModels = {};

// Функция запроса к Google Таблице
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

// Генерация ссылки на оплату
async function generatePaymentLink(ctx, userId, amountRub, coinsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const body = {
        amount: { value: `${amountRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: 'https://t.me/' + (await bot.telegram.getMe()).username },
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
            `⚠️ *Оплатите по ссылке, а затем нажмите кнопку «🔄 Проверить оплату»:*`,
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

// Старт / Регистрация в Google Таблице
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    
    const balance = await callGoogleSheet('get', userId, username);
    const currentModelKey = userModels[userId] || 'flash';
    
    ctx.reply(
        `👋 Привет, *${username}*!\n\n` +
        `🆔 Твой ID: \`${userId}\`\n` +
        `💰 Баланс в таблице: *${balance !== null ? balance : 'ошибка'} 🪙*\n` +
        `🤖 Модель: *${MODELS[currentModelKey].name}*\n\n` +
        `Выбирай модель или пополняй баланс:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('⚡ Gemini 3.8 Flash (1 токен)', 'set_model_flash')],
                [Markup.button.callback('🧠 Nano Banana Pro (5 токенов)', 'set_model_pro')],
                [Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]
            ])
        }
    );
});

bot.action('set_model_flash', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'flash';
    await ctx.answerCbQuery('Выбрана модель Gemini 3.8 Flash');
    ctx.reply('✅ Активна модель **Gemini 3.8 Flash**.');
});

bot.action('set_model_pro', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'pro';
    await ctx.answerCbQuery('Выбрана модель Nano Banana Pro');
    ctx.reply('🧠 Активна премиум-модель **Nano Banana Pro**.');
});

bot.action('menu_buy', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);

    ctx.reply(
        `💳 *Пополнение баланса*\n\n` +
        `💰 Твой текущий баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n\n` +
        `Выберите пакет токенов:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💎 1 рубль (1 токен - тест)', 'pay_1')],
                [Markup.button.callback('🪙 50 руб (10 токенов)', 'pay_50'), Markup.button.callback('🪙 100 руб (20 токенов)', 'pay_100')],
                [Markup.button.callback('🪙 500 руб (100 токенов)', 'pay_500'), Markup.button.callback('🪙 1000 руб (200 токенов)', 'pay_1000')],
                [Markup.button.callback('🚀 5000 руб (1000 токенов)', 'pay_5000')],
                [Markup.button.callback('🔙 На главную', 'menu_main')]
            ])
        }
    );
});

// Кнопки пополнения
bot.action('pay_1', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1, 1); });
bot.action('pay_50', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 50, 10); });
bot.action('pay_100', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 100, 20); });
bot.action('pay_500', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 500, 100); });
bot.action('pay_1000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1000, 200); });
bot.action('pay_5000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 5000, 1000); });

bot.action('menu_main', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    const currentModelKey = userModels[userId] || 'flash';
    
    ctx.reply(
        `🏠 Главное меню\n\n` +
        `💰 Баланс: *${balance !== null ? balance : 'ошибка'} 🪙*\n` +
        `🤖 Модель: *${MODELS[currentModelKey].name}*`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('⚡ Gemini 3.8 Flash (1 токен)', 'set_model_flash')],
                [Markup.button.callback('🧠 Nano Banana Pro (5 токенов)', 'set_model_pro')],
                [Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]
            ])
        }
    );
});

// ПРОВЕРКА ОПЛАТЫ И ЗАЧИСЛЕНИЕ ЧЕРЕЗ ТАБЛИЦУ
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

        // Начисляем токены прямо в Google Таблицу
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, coins);

        return ctx.reply(
            `✅ Вы успешно купили ${coins} токенов (Сумма: ${amountPaid} руб.)!\n` +
            `🎉 Баланс в Google Таблице успешно пополнен.\n` +
            `💰 Текущий баланс: *${newBalance} 🪙*`,
            { parse_mode: 'Markdown' }
        );
    } else {
        return ctx.reply(
            `❌ Платеж еще не прошел или имеет статус: ${paymentInfo.status}.\n` +
            `Оплатите по ссылке и попробуйте снова.`
        );
    }
});

// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (Общение с ИИ)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    // Проверяем баланс в таблице
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица). Попробуйте позже.');
    }

    const modelKey = userModels[userId] || 'flash';
    const selectedModel = MODELS[modelKey];

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ Недостаточно токенов!\n\n` +
            `🤖 Модель: ${selectedModel.name}\n` +
            `📉 Требуется: ${selectedModel.cost} 🪙\n` +
            `💰 Ваш баланс: ${balance} 🪙\n\n` +
            `Пополните баланс в личном кабинете:`,
            Markup.inlineKeyboard([[Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]])
        );
    }

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: text,
        });

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
        
        // Списываем стоимость запроса в таблице
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -selectedModel.cost);

        ctx.reply(`${aiReply}\n\n*(${selectedModel.name} | Списано: ${selectedModel.cost} 🪙 | Остаток: ${newBalance} 🪙)*`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка обращения к Gemini AI:', error);
        ctx.reply('Произошла ошибка при обращении к искусственному интеллекту. Попробуй позже.');
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
    res.send('Server is running with Google Sheets database!');
});

app.listen(PORT, () => {
    console.log(`Web server is running on port ${PORT}`);
});
