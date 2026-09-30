// src/priceConfig.ts

export const COIN_RATE_RUB = 5; // 1 монета = 5 рублей

export interface AIModel {
    name: string;
    type: 'text' | 'image';
    cost: number;
}

export const MODELS: Record<string, AIModel> = {
    'flash_3_8': { 
        name: '⚡ Flash 3.8 / Flash-Lite (Быстрый чат)', 
        type: 'text', 
        cost: 1 
    },
    'nano_banana_2': { 
        name: '🎨 Nano Banana 2 (Обычное HD качество)', 
        type: 'image', 
        cost: 2 
    },
    'pro_3_1': { 
        name: '🧠 Pro 3.1 / Deep Research (Умный ИИ + Поиск)', 
        type: 'text', 
        cost: 3 
    },
    'nano_banana_pro': { 
        name: '🍌 Nano Banana Pro (Высокое Ultra-HD)', 
        type: 'image', 
        cost: 4 
    },
    'nano_banana_4k': { 
        name: '💎 Nano Banana 4K (Премиум 4K фотореализм)', 
        type: 'image', 
        cost: 10 
    }
};

export const PAYMENT_PACKAGES = [
    { id: 'pay_150', name: 'Пакет «Старт»', priceRub: 150, coins: 30 },
    { id: 'pay_500', name: 'Пакет «Стандарт»', priceRub: 500, coins: 100 },
    { id: 'pay_1000', name: 'Пакет «Люкс»', priceRub: 1000, coins: 200 },
    { id: 'pay_2500', name: 'Пакет «VIP»', priceRub: 2500, coins: 500 }
];
