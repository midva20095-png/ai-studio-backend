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

// 🤖 СПИСОК АКТУАЛЬНЫХ МОДЕЛЕЙ И ИХ ЛИМИТЫ
const MODELS = {
    'gemini_15_flash': { 
        name: 'Gemini Flash', 
        modelId: 'gemini-2.5-flash', 
        cost: 1,               // 1 запрос = 1 кредит (5 руб)
        maxInputChars: 3000,   // Лимит входных символов
        maxOutputTokens: 1200  // Лимит выходных токенов
    },
    'gemini_15_pro': { 
        name: 'Gemini Pro 3.1', 
        modelId: 'gemini-3.1-pro-preview', 
        cost: 3,               // 1 запрос = 3 кредита (15 руб)
        maxInputChars: 8000,   // Исходный лимит символов
        maxOutputTokens: 2048  // Исходный лимит ответа
    }
};

// Хранение данных
const userModels = {};
const processedPayments = new Set(); // Защита от повторного начисления по одной ссылке

const bot = new Telegraf(BOT_TOKEN);

// Фиксированная нижняя клавиатура
const mainReplyKeyboard = Markup.keyboard([
    ['🤖 Выбор модели', '💳 Личный кабинет']
]).resize();

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

// 2. ИНТЕГРАЦИЯ С ЮKASSA И СОЗДАНИЕ ССЫЛКИ
async function generatePaymentLink(ctx, userId, amountRub, creditsCount) {
    const url = 'https://api.yookassa.ru/v3/payments';
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const botInfo = await bot.telegram.getMe();
    const body = {
        amount: { value: `${amountRub}.00`, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: `https://t.me/${botInfo.username}` },
        capture: true,
        description: `Покупка ${creditsCount} кр. (${amountRub} руб)`,
        metadata: { user_id: String(userId), coins: String(creditsCount) }
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

        return ctx.reply(
            `💳 *Ссылка на оплату создана!*\n\n` +
            `💵 Сумма к оплате: *${amountRub} руб.*\n` +
            `🪙 Кредитов к зачислению: *${creditsCount}*\n\n` +
            `Перейдите по ссылке ниже для оплаты. После успешного платежа кредиты зачислятся автоматически!`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(`🔗 Оплатить ${amountRub} руб.`, confirmationUrl)]
                ])
            }
        );

    } catch (error) {
        console.error('Ошибка ЮKassa:', error.response?.data || error.message);
        return ctx.reply('❌ Ошибка создания платежа в ЮKassa. Попробуйте позже.');
    }
}

// 🌐 АВТОМАТИЧЕСКИЙ ПРИЕМ УВЕДОМЛЕНИЙ ОБ ОПЛАТЕ ОТ ЮKASSA
app.post('/yookassa-webhook', async (req, res) => {
    try {
        const event = req.body.event;
        const paymentInfo = req.body.object;

        if (event === 'payment.succeeded' && paymentInfo) {
            const paymentId = paymentInfo.id;

            if (!processedPayments.has(paymentId)) {
                processedPayments.add(paymentId);

                const userId = paymentInfo.metadata?.user_id;
                const credits = parseInt(paymentInfo.metadata?.coins) || 1;
                const amountPaid = paymentInfo.amount?.value || '';

                if (userId) {
                    const newBalance = await callGoogleSheet('update', userId, '', credits);
                    
                    await bot.telegram.sendMessage(
                        userId,
                        `✅ *Оплата прошла успешно!*\n\n` +
                        `💵 Сумма: *${amountPaid} руб.*\n` +
                        `🪙 Зачислено: *${credits}* кредитов\n` +
                        `💰 Ваш новый баланс: *${newBalance}* кредитов`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка обработки Webhook ЮKassa:', error);
        res.status(500).send('Error');
    }
});

// 3. КОМАНДЫ И НАВИГАЦИЯ БОТА
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const safeUsername = escapeMarkdown(username);
    
    const balance = await callGoogleSheet('get', userId, username);
    const activeModelKey = userModels[userId] || 'gemini_15_flash';
    const activeModel = MODELS[activeModelKey];

    ctx.reply(
        `👋 Привет, ${safeUsername}!\n\n` +
        `🆔 Твой ID: \`${userId}\`\n` +
        `💰 Баланс: *${balance !== null ? balance : 'ошибка'}* кредитов\n` +
        `🤖 Выбранная модель: *${escapeMarkdown(activeModel.name)}*\n\n` +
        `Используй меню ниже для управления ботом:`,
        {
            parse_mode: 'Markdown',
            ...mainReplyKeyboard
        }
    );
});

// Кнопки постоянного нижнего меню
bot.hears('🤖 Выбор модели', async (ctx) => {
    const userId = ctx.from.id;
    const activeModelKey = userModels[userId] || 'gemini_15_flash';

    ctx.reply(
        `🤖 *Выберите языковую модель:*\n\n` +
        `Текущая модель: *${escapeMarkdown(MODELS[activeModelKey].name)}*`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('⚡ Gemini Flash (1 кредит)', 'set_model_gemini_15_flash')],
                [Markup.button.callback('🧠 Gemini Pro 3.1 (3 кредита)', 'set_model_gemini_15_pro')]
            ])
        }
    );
});

bot.hears('💳 Личный кабинет', async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);

    ctx.reply(
        `💳 *Личный кабинет / Пополнение*\n\n` +
        `💰 Твой текущий баланс: *${balance !== null ? balance : 'ошибка'}* кредитов\n` +
        `📊 Курс: *1 кредит = 5 руб.*\n\n` +
        `Выберите пакет кредитов для покупки:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🧪 1 руб. (1 кредит - ТЕСТ)', 'pay_1')],
                [Markup.button.callback('📦 Старт: 100 ₽ (20 кр.)', 'pay_100')],
                [Markup.button.callback('📦 Стандарт: 500 ₽ (100 кр.)', 'pay_500')],
                [Markup.button.callback('📦 Комфорт: 1 000 ₽ (200 кр.)', 'pay_1000')],
                [Markup.button.callback('📦 Топ: 2 500 ₽ (500 кр.)', 'pay_2500')],
                [Markup.button.callback('🚀 Максимум: 5 000 ₽ (1 000 кр.)', 'pay_5000')]
            ])
        }
    );
});

// Переключение моделей
bot.action('set_model_gemini_15_flash', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'gemini_15_flash';
    await ctx.answerCbQuery('Выбрана модель Gemini Flash');
    ctx.reply('✅ Активна модель: *Gemini Flash* (1 кредит / запрос)', { parse_mode: 'Markdown' });
});

bot.action('set_model_gemini_15_pro', async (ctx) => {
    const userId = ctx.from.id;
    userModels[userId] = 'gemini_15_pro';
    await ctx.answerCbQuery('Выбрана модель Gemini Pro 3.1');
    ctx.reply('✅ Активна модель: *Gemini Pro 3.1* (3 кредита / запрос)', { parse_mode: 'Markdown' });
});

// Обработчики кнопок оплаты
bot.action('pay_1', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1, 1); });
bot.action('pay_100', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 100, 20); });
bot.action('pay_500', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 500, 100); });
bot.action('pay_1000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 1000, 200); });
bot.action('pay_2500', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 2500, 500); });
bot.action('pay_5000', async (ctx) => { await ctx.answerCbQuery(); await generatePaymentLink(ctx, ctx.from.id, 5000, 1000); });

// 4. ОБРАБОТКА ИЗОБРАЖЕНИЙ (МУЛЬТИМОДАЛЬНЫЕ ЗАПРОСЫ)
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const caption = (ctx.message.caption || '').trim();

    const activeModelKey = userModels[userId] || 'gemini_15_flash';
    const selectedModel = MODELS[activeModelKey];

    // ⛔ 1. ПРОВЕРКА БАЛАНСА ПОЛЬЗОВАТЕЛЯ
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица). Попробуйте позже.');
    }

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ *Недостаточно кредитов!*\n\n` +
            `🤖 Модель: ${escapeMarkdown(selectedModel.name)}\n` +
            `📉 Требуется: ${selectedModel.cost} кр. (${selectedModel.cost * 5} руб)\n` +
            `💰 Ваш баланс: ${balance} кредитов\n\n` +
            `Пополните баланс в меню «💳 Личный кабинет».`,
            { parse_mode: 'Markdown' }
        );
    }

    try {
        await ctx.sendChatAction('typing');

        const photoArray = ctx.message.photo;
        const fileId = photoArray[photoArray.length - 1].file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);

        const imgResponse = await axios.get(fileLink.href || fileLink.toString(), { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(imgResponse.data).toString('base64');

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const promptText = caption || 'Опиши подробно, что изображено на этом фото.';

        const contents = [
            promptText,
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                }
            }
        ];

        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: contents,
            config: {
                maxOutputTokens: selectedModel.maxOutputTokens
            }
        });

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -selectedModel.cost);

        ctx.reply(`${aiReply}\n\n_(${escapeMarkdown(selectedModel.name)} | Списано: ${selectedModel.cost} кр. | Остаток: ${newBalance} кр.)_`, {
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error('Ошибка обработки изображения Gemini AI:', error);
        ctx.reply('❌ Произошла ошибка при обработке картинки нейросетью. Попробуйте еще раз.');
    }
});

// 5. ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ С ОГРАНИЧЕНИЯМИ
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    const activeModelKey = userModels[userId] || 'gemini_15_flash';
    const selectedModel = MODELS[activeModelKey];

    // Игнорируем нажатия на системные кнопки
    if (text === '🤖 Выбор модели' || text === '💳 Личный кабинет') return;

    // ⛔ 1. ПРОВЕРКА ДЛИНЫ ВХОДНОГО СООБЩЕНИЯ
    if (text.length > selectedModel.maxInputChars) {
        return ctx.reply(
            `⚠️ *Запрос слишком длинный!*\n\n` +
            `Максимальный размер промпта для ${escapeMarkdown(selectedModel.name)}: *${selectedModel.maxInputChars}* символов.\n` +
            `Длина вашего сообщения: *${text.length}* символов.\n\n` +
            `Пожалуйста, сократите текст сообщения, чтобы не тратить кредиты зря.`,
            { parse_mode: 'Markdown' }
        );
    }

    // ⛔ 2. ПРОВЕРКА БАЛАНСА ПОЛЬЗОВАТЕЛЯ
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица). Попробуйте позже.');
    }

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ *Недостаточно кредитов!*\n\n` +
            `🤖 Модель: ${escapeMarkdown(selectedModel.name)}\n` +
            `📉 Требуется: ${selectedModel.cost} кр. (${selectedModel.cost * 5} руб)\n` +
            `💰 Ваш баланс: ${balance} кредитов\n\n` +
            `Пополните баланс в меню «💳 Личный кабинет».`,
            { parse_mode: 'Markdown' }
        );
    }

    try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        await ctx.sendChatAction('typing');

        // ⛔ 3. ЗАПРОС К GEMINI С ОГРАНИЧЕНИЕМ НА ВЫХОД
        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: text,
            config: {
                maxOutputTokens: selectedModel.maxOutputTokens
            }
        });

        const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -selectedModel.cost);

        ctx.reply(`${aiReply}\n\n_(${escapeMarkdown(selectedModel.name)} | Списано: ${selectedModel.cost} кр. | Остаток: ${newBalance} кр.)_`, {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Ошибка обращения к Gemini AI:', error);
        ctx.reply('Произошла ошибка при обращении к нейросети. Попробуй позже.');
    }
});

// 6. ЗАПУСК СЕРВЕРА
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
