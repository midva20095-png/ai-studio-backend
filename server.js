async function handleAIQuery(ctx, promptText, photoBuffer = null) {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'User';

    if (isProcessing.has(userId)) {
        return ctx.reply('⏳ Пожалуйста, дождитесь окончания предыдущего запроса.');
    }

    if (!userState[userId]) userState[userId] = { model: 'flash_3_8', aspect_ratio: '1:1' };
    const userConfig = userState[userId];
    const modelData = MODELS[userConfig.model];

    if (promptText && promptText.length > modelData.maxInputChars) {
        return safeReply(
            ctx, 
            `⛔️ **Превышен лимит символов!**\n\nДля модели *${modelData.name}* максимальная длина запроса составляет **${modelData.maxInputChars}** символов.\nДлина вашего текста: ${promptText.length} символов.\n\nПожалуйста, сократите текст.`
        );
    }

    const balance = await callGoogleSheet('get', userId, username);
    if (balance === null) return ctx.reply('❌ Ошибка связи с базой данных.');

    if (balance < modelData.cost) {
        return safeReply(ctx, `❌ Недостаточно монет.\nТребуется: ${modelData.cost} 🪙 | Баланс: ${balance} 🪙`);
    }

    isProcessing.add(userId);

    try {
        if (modelData.type === 'text') {
            await ctx.sendChatAction('typing');
            let contents = photoBuffer 
                ? [{ inlineData: { mimeType: 'image/jpeg', data: photoBuffer.toString('base64') } }, promptText || 'Опиши это изображение.']
                : promptText;

            const response = await ai.models.generateContent({
                model: modelData.modelId,
                contents: contents,
                config: {
                    maxOutputTokens: modelData.maxOutputTokens
                }
            });

            const replyText = response.text || 'Не удалось получить ответ.';
            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            await safeReply(ctx, `${replyText}\n\n📉 _Списано: ${modelData.cost} 🪙 | Остаток: ${newBalance} 🪙_`);

        } else if (modelData.type === 'image') {
            await ctx.sendChatAction('upload_photo');
            
            // Формируем ввод для нового API взаимодействий (Interactions API / Nano Banana)
            let inputPayload = [];
            
            const fullPrompt = `${promptText}. Style requirements: ${modelData.qualityPrompt}`;
            inputPayload.push({ type: 'text', text: fullPrompt });

            if (photoBuffer) {
                inputPayload.push({
                    type: 'image',
                    mime_type: 'image/jpeg',
                    data: photoBuffer.toString('base64')
                });
            }

            // Вызов генерации согласно свежей документации Google AI SDK
            const interaction = await ai.interactions.create({
                model: modelData.modelId, // Например: 'gemini-3.1-flash-image' (Nano Banana 2)
                input: inputPayload.length === 1 ? inputPayload[0].text : inputPayload
            });

            let imgBuffer = null;
            if (interaction.outputImage && interaction.outputImage.data) {
                imgBuffer = Buffer.from(interaction.outputImage.data, 'base64');
            }

            if (!imgBuffer) {
                throw new Error('Изображение не было возвращено моделью.');
            }

            const newBalance = await callGoogleSheet('update', userId, username, -modelData.cost);
            const caption = `🖼 **Картинка готова!**\n🤖 Модель: ${modelData.name}\n\n📉 _Списано: ${modelData.cost} 🪙 | Остаток: ${newBalance} 🪙_`;
            
            await safeReplyWithPhoto(ctx, imgBuffer, caption);
        }

    } catch (error) {
        console.error('Ошибка ИИ:', error);
        ctx.reply('⚠ Произошла ошибка при генерации. Монеты не были списаны.');
    } finally {
        isProcessing.delete(userId);
    }
}
