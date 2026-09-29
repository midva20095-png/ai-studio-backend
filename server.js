const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Инициализация сервера
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Ключи Telegram
const BOT_TOKEN = '8885904685:AAFYRm1chT7h8i7lCf9jbG4odGd98-2BDgA';
const bot = new Telegraf(BOT_TOKEN);

// Ключи ЮKassa
const YUKASSA_SHOP_ID = '1120841';
const YUKASSA_SECRET_KEY = 'live_WNdPjKP4AHR-9eun-no0nkpCSzXxxC9_nomQanO-wIk';

// База данных в памяти (потом переключим на твой Firebase)
const userBalances = {};

function getBalance(userId) {
    if (!(userId in userBalances)) {
        userBalances[userId] = 5; // Стартовый бонус 5 монет
    }
    return userBalances[userId];
}

function updateBalance(userId, amount) {
    userBalances[userId] = getBalance(userId) + amount;
}

// Функция создания платежной ссылки через API ЮKassa
async function createYooKassaPayment(userId, amountCoins, priceRub) {
    const url = 'https://api.yookassa.ru/v3/payments';
    
    // Авторизация Basic для ЮKassa
    const authString = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    
    const body = {
        amount: {
            value: `${priceRub}.00`,
            currency: 'RUB'
        },
        confirmation: {
            type: 'redirect',
            // Сюда пользователь вернется после оплаты (можно указать твой сайт на Тилде)
            return_url: 'https://t.me/' + (await bot.telegram.getMe()).username
        },
        capture: true,
        description: `Покупка ${amountCoins} монет в ИИ-боте`,
        metadata: {
            user_id: String(userId),
            coins: String(amountCoins)
        }
    };

    try {
        const response = await axios.post(url, body, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Idempotence-Key': Math.random().toString(36).substring(7)
            }
        });
        return response.data.confirmation.confirmation_url; // Ссылка на оплату
    } catch (error) {
        console.error('Ошибка создания платежа в ЮKassa:', error.response?.data || error.message);
        return null;
    }
}

// Команда /start
bot.start((ctx) => {
    const userId = ctx.from.id;
    const balance = getBalance(userId);
    
    ctx.reply(
        `Привет! Я твой ИИ-помощник.\n` +
        `Твой баланс: ${balance} 🪙\n\n` +
        `Напиши мне любой вопрос, и я отвечу (списывается 1 монета).`,
        Markup.inlineKeyboard([
            [Markup.button.callback('💳 Купить 100 монет (100 руб)', 'buy_100')]
        ])
    );
});

// Кнопка покупки в боте
bot.action('buy_100', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    
    const paymentUrl = await createYooKassaPayment(userId, 100, 100);
    
    if (paymentUrl) {
        ctx.reply(
            `Ссылка на оплату сформирована! 🎉\nНажми на кнопку ниже, чтобы оплатить 100 рублей через ЮKassa:`,
            Markup.inlineKeyboard([
                [Markup.button.url('🔗 Оплатить 100 руб.', paymentUrl)]
            ])
        );
    } else {
        ctx.reply('Произошла ошибка при создании платежа. Попробуй позже.');
    }
});

// Текстовые сообщения (общение с ИИ)
bot.on('text', (ctx) => {
    const userId = ctx.from.id;
    const balance = getBalance(userId);
    const text = ctx.message.text;

    if (balance <= 0) {
        ctx.reply(
            'У тебя закончились монеты! 🪙 Пополни баланс, чтобы продолжить:',
            Markup.inlineKeyboard([
                [Markup.button.callback('💳 Купить монеты', 'buy_100')]
            ])
        );
        return;
    }

    updateBalance(userId, -1);
    const newBalance = getBalance(userId);

    ctx.reply(`Ответ ИИ: "${text}"\n\n*(Списана 1 монета. Остаток: ${newBalance} 🪙)*`);
});

// Запуск бота
bot.launch().then(() => {
    console.log('Telegram бот успешно запущен!');
}).catch((err) => {
    console.error('Ошибка запуска бота:', err);
});

// Эндпоинт для вебхуков от ЮKassa (сюда ЮKassa присылает уведомления об успешной оплате)
app.post('/yookassa-webhook', (req, res) => {
    const event = req.body;

    if (event.event === 'payment.succeeded') {
        const payment = event.object;
        const metadata = payment.metadata;
        
        if (metadata && metadata.user_id && metadata.coins) {
            const userId = parseInt(metadata.user_id);
            const coins = parseInt(metadata.coins);

            // Начисляем монеты пользователю
            updateBalance(userId, coins);
            const newBalance = getBalance(userId);

            // Отправляем уведомление пользователю в Telegram
            bot.telegram.sendMessage(
                userId,
                `Оплата прошла успешно! 🎉 Начислено монет: ${coins}.\nТвой текущий баланс: ${newBalance} 🪙`
            ).catch(err => console.error('Не удалось отправить сообщение об оплате:', err));
        }
    }

    res.status(200).send('OK');
});

// Эндпоинт для сайта на Тилде
app.get('/', (req, res) => {
    res.send('Server is running with Telegram bot & YooKassa API!');
});

app.post('/chat', (req, res) => {
    const { message, email } = req.body;
    res.json({ reply: `Ответ с сервера для сайта: ${message}`, balance: 10 });
});

// Запуск веб-сервера
app.listen(PORT, () => {
    console.log(`Web server is running on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
