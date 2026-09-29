// Генерация текста для Vertex AI
async function generateText(ws, textPrompt) {
    try {
        const response = await fetch(
            'https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1/publishers/google/models/gemini-1.5-flash:streamGenerateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: textPrompt }] }]
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            ws.send(`❌ Ошибка Vertex API: ${data.error.message}`);
            return;
        }

        const aiReply = data[0]?.candidates?.[0]?.content?.parts?.[0]?.text || "Нет ответа";
        ws.send(aiReply);

    } catch (error) {
        ws.send(`❌ Ошибка запроса: ${error.message}`);
    }
}
