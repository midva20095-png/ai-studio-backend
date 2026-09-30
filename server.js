const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

// Конфигурация из переменных окружения
const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA'; // Перенеси в process.env на проде
const YUKASSA_SHOP_ID = '1120841'; // Перенеси в process.env на проде
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk'; // Перенеси в process.env на проде
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz__C7Y8ybJm2bOi85TN0KLeBXRHxoIdYyH-aKun_Wss6JWYaGzZlRw5HWQksFbP0TK/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const bot = new Telegraf(BOT_TOKEN);

app.use(cors());
app.use(express.json());

/**
 * 🤖 ПЕРЕЧЕНЬ МОДЕЛЕЙ (ТОЛЬКО РЕАЛЬНЫЕ И АКТУАЛЬНЫЕ)
 * Доступны по платному ключу Gemini API.
 */
const MODELS = {
    'flash': { name: 'Gemini 1.5 Flash', cost: 1, id: 'gemini-1.5-flash', desc: 'Быстрая и универсальная' },
    'pro': { name: 'Gemini 1.5 Pro', cost: 4, id: 'gemini-1.5-pro', desc: 'Самая мощная, для сложных задач' },
    'flash8b': { name: 'Gemini 1.5 Flash-8b', cost: 0.5, id: 'gemini-1.5-flash-8b', desc: 'Сверхбыстрая для простых вопросов' },
    // Экспериментальные модели (если они включены в твоем API Console):
    'exp1': { name: 'Gemini Exp (Experimental)', cost: 3, id: 'gemini-exp-1206', desc: 'Новейшая экспериментальная модель' }
};

const userState = {}; // Сохранение выбора в памяти сессии (key: uid, value: modelKey)

// --- МОДУЛЬ GOOGLE TABLES (База данных) ---
async function manageSheets(action, uid, username = '', amount = 0) {
    try {
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
            action, userId: String(uid), username, amount
        });
        return response.data.balance; // Возвращает актуальный баланс
    } catch (e) {
        console.error('Sheet Error:', e.message);
        return null; // В случае ошибки соединения
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

// ГЕНЕРАЦИЯ КНОПОК ДЛЯ ВЫБОРА МОДЕЛИ (Компактный вид)
bot.hears('🤖 Выбор модели', async (ctx) => {
    const current = userState[ctx.from.id] || 'flash';
    
    // Создаем кнопки. Формат: [ [кнопка1, кнопка2], [кнопка3, кнопка4] ]
    const buttons = [];
    const modelKeys = Object.keys(MODELS);
    
    for (let i = 0; i < modelKeys.length; i += 2) {
        const row = [];
        for (let j = 0; j < 2 && i + j < modelKeys.length; j++) {
            const key = modelKeys[i + j];
            const check = key === current ? '✅ ' : '';
            row.push(Markup.button.callback(`${check}${MODELS[key].name} (${MODELS[key].cost} кр)`, `use_${key}`));
        }
        buttons.push(row);
    }

    let text = '🎯 <b>Выберите активную нейросеть:</b>\n\n';
    Object.values(MODELS).forEach(m => {
        text += `• <b>${m.name}</b>: ${m.desc} <i>(${m.cost} кр/запрос)</i>\n`;
    });
    
    ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^use_(.+)$/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (MODELS[modelKey]) {
        userState[ctx.from.id] = modelKey;
        await ctx.answerCbQuery(`Выбрана модель: ${MODELS[modelKey].name}`);
        
        // Обновляем сообщение с галочкой, чтобы пользователь видел изменение
        const buttons = [];
        const modelKeys = Object.keys(MODELS);
        for (let i = 0; i < modelKeys.length; i += 2) {
            const row = [];
            for (let j = 0; j < 2 && i + j < modelKeys.length; j++) {
                const key = modelKeys[i + j];
                const check = key === modelKey ? '✅ ' : '';
                row.push(Markup.button.callback(`${check}${MODELS[key].name} (${MODELS[key].cost} кр)`, `use_${key}`));
            }
            buttons.push(row);
        }
        await ctx.editMessageReplyMarkup({ inline_keyboard: buttons }).catch(e => console.log(e));
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
    const currentKey = userState[uid] || 'flash'; // Flash по умолчанию
    const cfg = MODELS[currentKey];

    // 1. Проверяем текущий баланс ПЕРЕД запросом
    const currentBal = await manageSheets('get', uid, ctx.from.username);
    if (currentBal === null) return ctx.reply('⚠️ Ошибка соединения с базой данных (Google Таблицы).');
    if (currentBal < cfg.cost) {
        return ctx.reply(`❌ Недостаточно средств для модели <b>${cfg.name}</b>.\nСтоимость: ${cfg.cost} кр.\nВаш баланс: ${currentBal} кр.\n\nПополните баланс в Личном кабинете.`, { parse_mode: 'HTML' });
    }

    try {
        await ctx.sendChatAction('typing');
        const activeModel = genAI.getGenerativeModel({ model: cfg.id });
        
        let promptData;
        if (isMedia) {
            const fileId = ctx.message.photo.pop().file_id;
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const imageBuffer = await axios.get(fileUrl.href, { responseType: 'arraybuffer' });
            promptData = [
                ctx.message.caption || "Проанализируй это изображение",
                { inlineData: { data: Buffer.from(imageBuffer.data).toString('base64'), mimeType: 'image/jpeg' } }
            ];
        } else {
            promptData = ctx.message.text;
        }

        // 2. Отправляем запрос в Google API
        const result = await activeModel.generateContent(promptData);
        const finalResponse = result.response.text();
        
        // 3. СПИСЫВАЕМ КРЕДИТЫ (только если ответ получен без ошибок)
        // Передаем отрицательное значение (-cfg.cost) в action 'update'
        const finalBalance = await manageSheets('update', uid, '', -cfg.cost);
        
        if (finalBalance === null) {
            console.error("Критическая ошибка: Ответ отправлен, но кредиты не списаны!");
        }

        // 4. Отправляем результат пользователю
        // Разбивка ответа, если он превышает лимит Telegram (4096 символов)
        const chunks = finalResponse.match(/[\s\S]{1,3900}/g) || ["(Пустой ответ от нейросети)"];
        
        for (let i = 0; i < chunks.length; i++) {
            let textToSend = chunks[i];
            
            if (i === 0) {
                textToSend = `🤖 Модель: ${cfg.name}\n\n` + textToSend;
            }
            if (i === chunks.length - 1) {
                // Если баланс не удалось получить, показываем "Ошибка БД"
                const balanceDisplay = finalBalance !== null ? finalBalance : "Ошибка БД";
                textToSend += `\n\n💰 Списано: ${cfg.cost} кр. | Баланс: ${balanceDisplay} кр.`;
            }
            
            await ctx.reply(textToSend);
        }
        
    } catch (error) {
        console.error('Gemini SDK Error:', error.message);
        ctx.reply(`🤖 Ошибка генерации: Модель отклонила запрос или перегружена.\n\nДетали: ${error.message}\n\n<i>Кредиты не списаны.</i>`, { parse_mode: 'HTML' });
    }
}

bot.on('photo', (ctx) => performAIRequest(ctx, true));
bot.on('text', (ctx) => {
    // Игнорируем нажатия на кнопки главного меню
    if (ctx.message.text === '🤖 Выбор модели' || ctx.message.text === '💳 Личный кабинет') return;
    performAIRequest(ctx, false);
});

// --- СТАРТ СЕРВЕРА (Render Webhook) ---
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    const EXT_URL = process.env.RENDER_EXTERNAL_URL;
    if (EXT_URL) {
        bot.telegram.setWebhook(`${EXT_URL}/telegraf-bot`);
        app.use(bot.webhookCallback('/telegraf-bot'));
        console.log('🌐 Webhook активирован по адресу:', `${EXT_URL}/telegraf-bot`);
    } else {
        bot.launch();
        console.log('🔄 Polling запущен');
    }
});
