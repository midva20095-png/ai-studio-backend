// --- УТВЕРЖДЕННЫЕ ТАРИФЫ, ЛИМИТЫ И МОДЕЛИ (1 монета = 5 рублей) ---
const MODELS = {
    'flash_3_8': { 
        name: '⚡ Flash 3.8 / Flash-Lite', 
        modelId: 'gemini-3.8-flash', 
        type: 'text', 
        cost: 1, // 5 ₽
        maxInputChars: 4000,
        maxOutputTokens: 800 // эквивалент лимита на выход до 2000 символов
    },
    'pro_3_1': { 
        name: '🧠 Pro 3.1 / Deep Research', 
        modelId: 'gemini-3.1-pro', 
        type: 'text', 
        cost: 3, // 15 ₽
        maxInputChars: 20000,
        maxOutputTokens: 3200 // эквивалент лимита на выход до 8000 символов
    },
    'nano_banana_2': { 
        name: '🎨 Nano Banana 2 (HD)', 
        modelId: 'gemini-3-flash-preview', 
        type: 'image', 
        qualityPrompt: 'HD quality, clear details, high resolution', 
        cost: 2, // 10 ₽
        maxInputChars: 800
    },
    'nano_banana_pro': { 
        name: '🍌 Nano Banana Pro (Ultra-HD)', 
        modelId: 'gemini-3-flash-preview', 
        type: 'image', 
        qualityPrompt: 'Ultra-HD quality, extremely detailed, 4k resolution, masterpiece, fine details', 
        cost: 4, // 20 ₽
        maxInputChars: 800
    },
    'nano_banana_4k': { 
        name: '💎 Nano Banana 4K (Премиум)', 
        modelId: 'gemini-3-flash-preview', 
        type: 'image', 
        qualityPrompt: '4K premium photorealistic, hyperrealistic, 8k UHD, cinematic lighting, photorealism, professional photography', 
        cost: 10, // 50 ₽
        maxInputChars: 800
    }
};
