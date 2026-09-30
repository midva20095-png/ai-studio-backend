const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// 🔑 КОНФИГУРАЦИЯ И КЛЮЧИ
const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Настройка единственной рабочей модели (актуальный ID из ошибки Google API)
const MODEL_ID = 'gemini-3.8-flash';
const MODEL_NAME = 'Gemini AI';
const REQUEST_COST = 1; // 1 запрос = 1 токен

const bot = new Telegraf(BOT_TOKEN);

// Экранирование спецсимволов Markdown для защиты от ошибок Telegram
function escapeMarkdown(text) {
    if (!text) return '';
    return String(text).replace(/[_*`\[\]()]/g, '\\$&');
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
        console.error('Ошибка связи с Google Таблицей:', error.message);
        return null;
    }
}

// 2. ИНТЕГРАЦИЯ С ЮKASSA
async function generatePaymentLink(ctx, userId, amountRub, coinsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const botInfo = await bot.telegram.getMe();
    const body = {
        amount: { value: `${amountRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: `https://t.me/${botInfo.username}` },
        capture: true,
        description: `Покупка ${coinsCount} токенов (${amountRub} руб)`,
        metadata: { user_id: String(userId), coins: String(coinsCount) }
    };

    try {
        const response = await axios.post(url, body, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Idempotence-Key': Math.random().toString(36).substring(2) + Date.now().toString(36)
            }
        });

        const confirmationUrl = response.data.confirmation.confirmation_url;
        const paymentId = response.data.id;

        return ctx.reply(
            `💳 *Ссылка на оплату создана!*\n\n` +
            `💵 Сумма: *${amountRub} руб.*\n` +
            `🪙 Токенов к зачислению: *${coinsCount}*\n\n` +
            `⚠️ Оплатите по ссылке, затем нажмите кнопку «🔄 Проверить оплату»:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(`🔗 Оплатить ${amountRub} руб.`, confirmationUrl)],
                    [Markup.button.callback(`🔄 Проверить оплату`, `check_${paymentId}`)],
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
        console.error('Ошибка проверки платежа:', error.response?.data || error.message);
        return null;
    }
}

// 3. КОМАНДЫ И НАВИГАЦИЯ БОТА
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const safeUsername = escapeMarkdown(username);
    
    const balance = await callGoogleSheet('get', userId, username);

    ctx.reply(
        `👋 Привет, ${safeUsername}!\n\n` +
        `🆔 Твой ID: \`${userId}\`\n` +
        `💰 Баланс: *${balance !== null ? balance : 'ошибка'}* 🪙\n` +
        `🤖 Модель: *${MODEL_NAME}*\n\n` +
        `Просто отправь мне текст сообщения:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]
            ])
        }
    );
});

bot.action('menu_buy', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);

    ctx.reply(
        `💳 *Пополнение баланса*\n\n` +
        `💰 Твой текущий баланс: *${balance !== null ? balance : 'ошибка'}* 🪙\n\n` +
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

    ctx.reply(
        `🏠 *Главное меню*\n\n` +
        `💰 Баланс: *${balance !== null ? balance : 'ошибка'}* 🪙\n` +
        `🤖 Модель: *${MODEL_NAME}*`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]
            ])
        }
    );
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
                `✅ *Платеж успешно подтвержден!*\n` +
                `💵 Сумма: ${amountPaid} руб.\n` +
                `🪙 Зачислено токенов: ${coins}\n` +
                `💰 Ваш новый баланс: *${newBalance}* 🪙`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            // Игнорируем ошибку при повторном клике
        }

        return ctx.reply(
            `🎉 Баланс успешно пополнен на *${coins}* токенов!\n` +
            `💰 Текущий баланс: *${newBalance}* 🪙`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('🔙 На главную', 'menu_main')]])
            }
        );
    } else {
        return ctx.reply(
            `❌ Платеж еще не прошел (статус: ${paymentInfo.status}).\n` +
            `Оплатите по ссылке и попробуйте снова.`
        );
    }
});

// 4. ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (GEMINI)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица). Попробуйте позже.');
    }

    if (balance < REQUEST_COST) {
        return ctx.reply(
            `❌ *Недостаточно токенов!*\n\n` +
            `📉 Требуется: ${REQUEST_COST} 🪙\n` +
            `💰 Ваш баланс: ${balance} 🪙\n\n` +
            `Пополните баланс в личном кабинете:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('💳 Личный кабинет / Пополнить', 'menu_buy')]])
            }
        );
    }

    try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        await ctx.sendChatAction('typing');

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: text,
        });

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -REQUEST_COST);

        ctx.reply(`${aiReply}\n\n_(${MODEL_NAME} | Списано: ${REQUEST_COST} 🪙 | Остаток: ${newBalance} 🪙)_`, {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Ошибка обращения к Gemini AI:', error);
        ctx.reply('Произошла ошибка при обращении к нейросети. Попробуй позже.');
    }
});

// 5. ЗАПУСК СЕРВЕРА
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`).then(() => {
        console.log(`🌐 Webhook установлен: ${RENDER_EXTERNAL_URL}${webhookPath}`);
    });
} else {
    console.log('⚠️ Переменная RENDER_EXTERNAL_URL не задана. Запуск в режиме Polling...');
    bot.launch();
}

app.get('/', (req, res) => {
    res.send('Server is running with Google Sheets database!');
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
