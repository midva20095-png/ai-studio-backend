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
