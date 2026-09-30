const { GoogleGenAI, Modality } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function handleAIQuery(promptText, userChatId) {
    try {
        // Используем модель с поддержкой генерации изображений
        const modelName = 'gemini-2.5-flash-image'; // или gemini-3.1-flash-image

        const response = await ai.models.generateContent({
            model: modelName,
            contents: promptText,
            config: {
                // Разрешаем модели отдавать текст и картинку одновременно
                responseModalities: [Modality.TEXT, Modality.IMAGE],
            },
        });

        const candidate = response.candidates?.[0];
        if (!candidate || !candidate.content || !candidate.content.parts) {
            throw new Error("Модель вернула пустой ответ без контента.");
        }

        let textResult = '';
        let imageBuffer = null;

        // Перебираем части ответа (parts), чтобы найти текст и картинку
        for (const part of candidate.content.parts) {
            if (part.text) {
                textResult += part.text;
            }
            // Проверяем наличие сгенерированного изображения (байт или инлайн-данных)
            if (part.inlineData && part.inlineData.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            } else if (part.fileData) {
                // Обработка, если возвращается по ссылке/файлу
                // (зависимости от того, как SDK отдает файлы)
            }
        }

        return {
            text: textResult || "Готово!",
            image: imageBuffer // Buffer с картинкой или null, если картинки нет
        };

    } catch (error) {
        console.error("Ошибка ИИ:", error.message);
        throw error;
    }
}
