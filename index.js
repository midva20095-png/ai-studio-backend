require('dotenv').config();
const { startBot } = require('./core/bot');
const { startWebApp } = require('./ui_modules/webapp_server');

console.log('🚀 Запуск системы...');

// 1. Поднимаем интерфейс и мини-приложение (независимо от бота)
try {
    startWebApp();
} catch (e) {
    console.error('⚠ Ошибка запуска WebApp:', e.message);
}

// 2. Запускаем ядро самого бота
try {
    startBot();
} catch (e) {
    console.error('❌ Ошибка запуска ядра бота:', e.message);
}
