const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SHEET_WEB_APP_URL = process.env.GOOGLE_SHEET_WEB_APP_URL;

if (!BOT_TOKEN) {
    console.error('❌ Ошибка: Не задан BOT_TOKEN в переменных окружения.');
    process.exit(1);
}

if (!GEMINI_API_KEY) {
    console.error('❌ Ошибка: Не задан GEMINI_API_KEY в переменных окружения.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// 🤖 СПИСОК МОДЕЛЕЙ (Добавлена Gemini 3.1 Flash Image)
const MODELS = {
    'gemini_15_flash': { 
        name: 'Gemini Flash', 
        modelId: 'gemini-3.8-flash', 
        cost: 1,               
        maxInputChars: 3000,   
        maxOutputTokens: 1200  
    },
    'gemini_15_pro': { 
        name: 'Gemini Pro 3.1', 
        modelId: 'gemini-3.1-pro-preview', 
        cost: 3,               
        maxInputChars: 8000,   
        maxOutputTokens: 2048  
    },
    'gemini_31_flash_image': { 
        name: 'Gemini 3.1 Flash Image', 
        modelId: 'gemini-3.1-flash-image', 
        cost: 3,               
        maxInputChars: 5000,   
        maxOutputTokens: 2048  
    }
};

// Хранилище выбранных моделей пользователей (в памяти)
const userModels = {};

// Функция экранирования для MarkdownV2 / Markdown
function escapeMarkdown(text) {
    return text;
}

// Функция взаимодействия с Google Таблицей (Базой данных баланса)
async function callGoogleSheet(action, userId, username = '') {
    if (!GOOGLE_SHEET_WEB_APP_URL) {
        console.warn('⚠️ URL Google Таблицы не задан. Используем режим заглушки (баланс 100 кредитов).');
        return 100;
    }
    try {
        const response = await axios.post(GOOGLE_SHEET_WEB_APP_URL, {
            action: action,
            userId: userId,
            username: username || 'NoUsername',
            amount: 0
        });
        return response.data.balance;
    } catch (error) {
        console.error('Ошибка связи с Google Таблицей:', error.message);
        return null;
    }
}

// Главная клавиатура
function getMainMenu() {
    return Markup.keyboard([
        ['🤖 Выбор модели', '💳 Личный кабинет']
    ]).resize();
}

// 1. КОМАНДА /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || '';
    
    // Инициализация пользователя в таблице при первом входе
    await callGoogleSheet('get', userId, username);
    
    userModels[userId] = Object.keys(MODELS)[0]; // По умолчанию первая модель

    await ctx.reply(
        `Привет, ${ctx.from.first_name}! 👋\n\n` +
        `Я твой умный помощник на базе искусственного интеллекта. Выбирай модель, отправляй текст или картинки и получай ответы!\n\n` +
        `Используй кнопки ниже для навигации 👇`,
        getMainMenu()
    );
});

// 2. КНОПКА «Личный кабинет»
bot.hears('💳 Личный кабинет', async (ctx) => {
    const userId = ctx.from.id;
    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    
    if (balance === null) {
        return ctx.reply('❌ Не удалось получить данные о балансе. Попробуйте позже.');
    }

    const activeModelKey = userModels[userId] || Object.keys(MODELS)[0];
    const activeModel = MODELS[activeModelKey];

    await ctx.reply(
        `👤 *Личный кабинет*\n\n` +
        `🆔 ID: \`${userId}\`\n` +
        `💰 Баланс: *${balance} кредитов* (~${balance * 5} руб)\n` +
        `🤖 Активная модель: *${activeModel.name}* (${activeModel.cost} кр. / запрос)`,
        { parse_mode: 'Markdown', ...getMainMenu() }
    );
});

// 3. КНОПКА «Выбор модели» (Динамическое создание кнопок из словаря MODELS)
bot.hears('🤖 Выбор модели', async (ctx) => {
    const userId = ctx.from.id;
    const currentModel = userModels[userId] || Object.keys(MODELS)[0];

    const buttons = Object.keys(MODELS).map(key => {
        const model = MODELS[key];
        const isSelected = key === currentModel;
        const prefix = isSelected ? '✅ ' : '▫️ ';
        return [Markup.button.callback(`${prefix}${model.name} (${model.cost} кр.)`, `set_model_${key}`)];
    });

    await ctx.reply('🤖 *Выберите модель искусственного интеллекта:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    });
});

// Обработка клика по инлайн-кнопке выбора модели
bot.action(/^set_model_(.+)$/, async (ctx) => {
    const modelKey = ctx.match[1];
    if (!MODELS[modelKey]) {
        return ctx.answerCbQuery('❌ Модель не найдена.');
    }

    const userId = ctx.from.id;
    userModels[userId] = modelKey;
    const selected = MODELS[modelKey];

    await ctx.answerCbQuery(`Выбрана модель: ${selected.name}`);
    await ctx.editMessageText(
        `✅ Успешно переключено!\n\n🤖 Текущая модель: *${selected.name}*\n💳 Стоимость запроса: *${selected.cost} кредитов*`,
        { parse_mode: 'Markdown' }
    );
});

// 4. ОБРАБОТКА ИЗОБРАЖЕНИЙ (С поддержкой возврата картинок/текста)
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const caption = (ctx.message.caption || '').trim();

    const activeModelKey = userModels[userId] || Object.keys(MODELS)[0];
    const selectedModel = MODELS[activeModelKey] || MODELS['gemini_15_flash'];

    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица). Попробуйте позже.');
    }

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ *Недостаточно кредитов!*\n\n` +
            `🤖 Модель: ${escapeMarkdown(selectedModel.name)}\n` +
            `📉 Требуется: ${selectedModel.cost} кр. (${selectedModel.cost * 5} руб)\n` +
            `💰 Ваш баланс: ${balance} кредитов`,
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

        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -selectedModel.cost);
        const captionStats = `\n\n_(${escapeMarkdown(selectedModel.name)} | Списано: ${selectedModel.cost} кр. | Остаток: ${newBalance} кр.)_`;

        const candidates = response.candidates || [];
        let imageSent = false;

        for (const candidate of candidates) {
            const parts = candidate.content?.parts || [];
            for (const part of parts) {
                if (part.inlineData) {
                    const imgBuffer = Buffer.from(part.inlineData.data, 'base64');
                    await ctx.replyWithPhoto({ source: imgBuffer }, {
                        caption: (part.text || '🎨 Обработанное изображение') + captionStats,
                        parse_mode: 'Markdown'
                    });
                    imageSent = true;
                }
            }
        }

        if (!imageSent) {
            const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
            await ctx.reply(`${aiReply}${captionStats}`, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error('Ошибка обработки изображения Gemini AI:', error);
        ctx.reply('❌ Произошла ошибка при обработке картинки нейросетью. Попробуйте еще раз.');
    }
});

// 5. ОБРАБОТКА ТЕКСТА (С поддержкой возврата картинок/текста)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    const activeModelKey = userModels[userId] || Object.keys(MODELS)[0];
    const selectedModel = MODELS[activeModelKey] || MODELS['gemini_15_flash'];

    if (text === '🤖 Выбор модели' || text === '💳 Личный кабинет') return;

    if (text.length > selectedModel.maxInputChars) {
        return ctx.reply(
            `⚠️ *Запрос слишком длинный!*\n\n` +
            `Максимальный размер промпта для ${escapeMarkdown(selectedModel.name)}: *${selectedModel.maxInputChars}* символов.\n` +
            `Длина вашего сообщения: *${text.length}* символов.`,
            { parse_mode: 'Markdown' }
        );
    }

    const balance = await callGoogleSheet('get', userId, ctx.from.username);
    if (balance === null) {
        return ctx.reply('❌ Ошибка связи с базой данных (Google Таблица). Попробуйте позже.');
    }

    if (balance < selectedModel.cost) {
        return ctx.reply(
            `❌ *Недостаточно кредитов!*\n\n` +
            `🤖 Модель: ${escapeMarkdown(selectedModel.name)}\n` +
            `📉 Требуется: ${selectedModel.cost} кр. (${selectedModel.cost * 5} руб)\n` +
            `💰 Ваш баланс: ${balance} кредитов`,
            { parse_mode: 'Markdown' }
        );
    }

    try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        await ctx.sendChatAction('typing');

        const response = await ai.models.generateContent({
            model: selectedModel.modelId,
            contents: text,
            config: {
                maxOutputTokens: selectedModel.maxOutputTokens
            }
        });

        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, -selectedModel.cost);
        const captionStats = `\n\n_(${escapeMarkdown(selectedModel.name)} | Списано: ${selectedModel.cost} кр. | Остаток: ${newBalance} кр.)_`;

        const candidates = response.candidates || [];
        let imageSent = false;

        for (const candidate of candidates) {
            const parts = candidate.content?.parts || [];
            for (const part of parts) {
                if (part.inlineData) {
                    const imgBuffer = Buffer.from(part.inlineData.data, 'base64');
                    await ctx.replyWithPhoto({ source: imgBuffer }, {
                        caption: (part.text || '🎨 Сгенерированное изображение') + captionStats,
                        parse_mode: 'Markdown'
                    });
                    imageSent = true;
                }
            }
        }

        if (!imageSent) {
            const aiReply = response.text || 'Не удалось получить ответ от нейросети.';
            await ctx.reply(`${aiReply}${captionStats}`, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error('Ошибка обращения к Gemini AI:', error);
        ctx.reply('Произошла ошибка при обращении к нейросети. Попробуй позже.');
    }
});

// Запуск бота
bot.launch().then(() => {
    console.log('🚀 Бот успешно запущен и готов к работе!');
}).catch((err) => {
    console.error('❌ Ошибка запуска бота:', err);
});

// Корректная остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
