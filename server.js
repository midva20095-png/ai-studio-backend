bot.action(/^check_(.+)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const userId = ctx.from.id;

    await ctx.answerCbQuery('Проверяем платеж...');

    const paymentInfo = await checkPaymentStatus(paymentId);
    if (!paymentInfo) {
        return ctx.reply('❌ Недали связаться с ЮKassa. Попробуйте позже.');
    }

    if (paymentInfo.status === 'succeeded') {
        const coins = parseInt(paymentInfo.metadata?.coins) || 1;
        const amountPaid = paymentInfo.amount?.value || '';

        // Начисляем токены в таблицу
        const newBalance = await callGoogleSheet('update', userId, ctx.from.username, coins);

        // 1. Сначала редактируем сообщение, убирая кнопки, чтобы исключить повторные клики!
        try {
            await ctx.editMessageText(
                `✅ Платеж успешно подтвержден!\n` +
                `💵 Сумма: ${amountPaid} руб.\n` +
                `🪙 Зачислено токенов: ${coins}\n` +
                `💰 Ваш новый баланс: ${newBalance} 🪙`,
                { parse__mode: 'Markdown' }
            );
        } catch (e) {
            // Игнорируем ошибку, если текст сообщения не изменился
        }

        // 2. Отправляем финальное уведомление
        return ctx.reply(
            `🎉 Баланс успешно пополнен на ${coins} токенов!\n` +
            `💰 Текущий баланс: *${newBalance} 🪙*`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('🔙 На главную', 'menu_main')]])
            }
        );
    } else {
        return ctx.reply(
            `❌ Платеж еще не прошел или имеет статус: ${paymentInfo.status}.\n` +
            `Оплатите по ссылке и попробуйте снова.`
        );
    }
});
