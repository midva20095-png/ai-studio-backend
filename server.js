export type ModelKey =
  | 'flash_3_8'
  | 'flash_lite'
  | 'pro_3_1'
  | 'deep_research'
  | 'nano_banana_2'
  | 'nano_banana_pro'
  | 'nano_banana_4k';

export type ModelType = 'text' | 'image';

export interface ModelPrice {
  name: string;
  type: ModelType;
  cost: number;
  maxInputChars: number;
  maxOutputChars?: number;
  quality?: string;
  buttonLabel: string;
  description: string;
}

export const RUB_PER_COIN = 5;

export const MODELS: Record<ModelKey, ModelPrice> = {
  flash_3_8: {
    name: 'Flash 3.8',
    type: 'text',
    cost: 1,
    maxInputChars: 4000,
    maxOutputChars: 2000,
    buttonLabel: '⚡ Flash 3.8 · 1 🪙',
    description: 'Вход до 4 000 символов · ответ до 2 000 символов · 5 ₽',
  },
  flash_lite: {
    name: 'Flash-Lite',
    type: 'text',
    cost: 1,
    maxInputChars: 4000,
    maxOutputChars: 2000,
    buttonLabel: '⚡ Flash-Lite · 1 🪙',
    description: 'Вход до 4 000 символов · ответ до 2 000 символов · 5 ₽',
  },
  pro_3_1: {
    name: 'Pro 3.1',
    type: 'text',
    cost: 3,
    maxInputChars: 20000,
    maxOutputChars: 8000,
    buttonLabel: '🧠 Pro 3.1 · 3 🪙',
    description: 'Вход до 20 000 символов · ответ до 8 000 символов · 15 ₽',
  },
  deep_research: {
    name: 'Deep Research',
    type: 'text',
    cost: 3,
    maxInputChars: 20000,
    maxOutputChars: 8000,
    buttonLabel: '🔎 Deep Research · 3 🪙',
    description: 'Вход до 20 000 символов · ответ до 8 000 символов · 15 ₽',
  },
  nano_banana_2: {
    name: 'Nano Banana 2',
    type: 'image',
    cost: 2,
    maxInputChars: 800,
    quality: 'HD',
    buttonLabel: '🖼 Nano Banana 2 · 2 🪙',
    description: 'HD · описание до 800 символов · 10 ₽',
  },
  nano_banana_pro: {
    name: 'Nano Banana Pro',
    type: 'image',
    cost: 4,
    maxInputChars: 800,
    quality: 'Ultra-HD',
    buttonLabel: '✨ Nano Banana Pro · 4 🪙',
    description: 'Ultra-HD · описание до 800 символов · 20 ₽',
  },
  nano_banana_4k: {
    name: 'Nano Banana 4K',
    type: 'image',
    cost: 10,
    maxInputChars: 800,
    quality: 'Премиум 4K фотореализм',
    buttonLabel: '💎 Nano Banana 4K · 10 🪙',
    description: 'Премиум 4K фотореализм · описание до 800 символов · 50 ₽',
  },
};

export const PAYMENT_PACKAGES = [
  { id: 'start', name: 'Старт', priceRub: 150, coins: 30, baseCoins: 30, bonusCoins: 0 },
  { id: 'standard', name: 'Стандарт', priceRub: 500, coins: 100, baseCoins: 100, bonusCoins: 0 },
  { id: 'lux', name: 'Люкс', priceRub: 1000, coins: 250, baseCoins: 200, bonusCoins: 50 },
  { id: 'vip', name: 'VIP', priceRub: 2500, coins: 650, baseCoins: 500, bonusCoins: 150 },
] as const;

export type PaymentPackageId = (typeof PAYMENT_PACKAGES)[number]['id'];

/** Используйте эту функцию и в интерфейсе, и на сервере. */
export function validateModelInput(modelKey: string, text: string): ModelPrice {
  if (!Object.prototype.hasOwnProperty.call(MODELS, modelKey)) {
    throw new Error('Неизвестная модель.');
  }

  const model = MODELS[modelKey as ModelKey];
  const length = Array.from(text).length;

  if (!text.trim()) {
    throw new Error('Введите текст запроса.');
  }
  if (length > model.maxInputChars) {
    throw new Error(
      `Для модели ${model.name} максимум ${model.maxInputChars} символов. Сейчас: ${length}. Монеты не списаны.`,
    );
  }

  return model;
}
