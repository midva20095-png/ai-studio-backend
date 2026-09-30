require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// --- ИНТЕРФЕЙС И КНОПКИ (Личный кабинет и исчезающие инлайны) ---

bot.telegram.setChatMenuButton({
    menu_button: {
        type: 'web_app',
        text: 'Личный Кабинет 📱',
        web_app: { url: process.env.WEBAPP_URL } 
    }
});

bot.start(async (ctx) => {
    await ctx.reply(
        'Привет! Я готов к работе. Открой Личный Кабинет или выбери действие:',
        Markup.inlineKeyboard([
            [Markup.button.callback('💳 Пополнить баланс', 'action_pay')],
            [Markup.button.callback('🤖 Выбрать ИИ', 'action_choose_ai')]
        ])
    );
});

bot.action('action_pay', async (ctx) => {
    await ctx.deleteMessage(); // Исчезающая кнопка
    await ctx.reply('Генерирую ссылку на оплату ЮKassa...');
});

bot.action('action_choose_ai', async (ctx) => {
    await ctx.deleteMessage();
    await ctx.reply('Выбери модель для работы:', Markup.inlineKeyboard([
        [Markup.button.callback('Gemini (Текст/Фото/Видео)', 'set_gemini')],
        [Markup.button.callback('Midjourney (Генерация картинок)', 'set_mj')]
    ]));
});

// Кнопки-заглушки для переключения
bot.action('set_gemini', async (ctx) => { await ctx.deleteMessage(); await ctx.reply('✅ Выбрана Gemini.'); });
bot.action('set_mj', async (ctx) => { await ctx.deleteMessage(); await ctx.reply('✅ Выбран Midjourney.'); });


// --- ГЛАВНЫЙ МЕХАНИЗМ: УНИВЕРСАЛЬНЫЙ ПРИЁМНИК ЛЮБЫХ ДАННЫХ ---
// Мы перехватываем ВСЁ разом: текст, фото, видео, аудио, голосовые, документы.
bot.on(['text', 'photo', 'video', 'audio', 'voice', 'document'], async (ctx) => {
    
    // 1. Собираем всё, что прислал юзер в один объект
    const userId = ctx.from.id;
    let userPrompt = ctx.message.text || ctx.message.caption || ""; // Текст или подпись к фотке
    let mediaType = 'text'; // По умолчанию считаем, что это текст
    let fileId = null;

    // 2. Определяем, что именно прилетело, и достаем file_id
    if (ctx.message.photo) {
        mediaType = 'photo';
        // Telegram присылает массив фоток в разном качестве, берем самую большую (последнюю)
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id; 
    } else if (ctx.message.video) {
        mediaType = 'video';
        fileId = ctx.message.video.file_id;
    } else if (ctx.message.audio) {
        mediaType = 'audio';
        fileId = ctx.message.audio.file_id;
    } else if (ctx.message.voice) {
        mediaType = 'voice';
        fileId = ctx.message.voice.file_id;
    } else if (ctx.message.document) {
        mediaType = 'document';
        fileId = ctx.message.document.file_id;
    }

    // Сообщаем юзеру, что данные приняты (показываем, что бот не завис)
    const statusMsg = await ctx.reply('⏳ Принял в обработку. Передаю нейросети...');

    try {
        /*
        ЗДЕСЬ БОТ ОБРАЩАЕТСЯ К НАШЕЙ ОТДЕЛЬНОЙ БИБЛИОТЭКЕ ИИ (ai_modules/router.js).
        Основной код тупо скидывает сформированный пакет данных в роутер:
        
        const aiResponse = await ai_router.process({
            userId: userId,
            model: "выбранная_юзером_модель", // берем из базы
            type: mediaType,      // 'photo', 'video', 'text' и т.д.
            file_id: fileId,      // ID файла, чтобы ИИ мог его скачать
            prompt: userPrompt    // ТЗ от юзера (например, "поменяй фон на красный")
        });
        */

        // Эмулируем, что внешний ИИ-модуль отработал и вернул результат:
        // await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, aiResponse.text);
        
        // Временно для теста просто показываем, что ядро всё правильно распознало:
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            statusMsg.message_id, 
            null, 
            `✅ Ядро отработало.\nТип: ${mediaType}\nТекст: "${userPrompt}"\nФайл ID: ${fileId || 'нет файла'}\n\n*Тут будет ответ от внешнего ИИ-модуля*`
        );

    } catch (error) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '❌ Ошибка при обработке в модуле ИИ.');
        console.error(error);
    }
});

bot.launch().then(() => console.log('Универсальное ядро бота запущено!'));
