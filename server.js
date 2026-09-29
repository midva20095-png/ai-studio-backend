const admin = require('firebase-admin');
const fs = require('fs');

// Инициализация Firebase через единый JSON из переменных окружения Render
try {
    if (process.env.FIREBASE_CONFIG_JSON) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase успешно подключен через FIREBASE_CONFIG_JSON!');
    } else if (fs.existsSync('./firebase-key.json')) {
        const serviceAccount = require('./firebase-key.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase успешно подключен из локального файла!');
    } else {
        console.error('КРИТИЧЕСКАЯ ОШИБКА: Учетные данные Firebase не найдены!');
    }
} catch (e) {
    console.error('Ошибка инициализации Firebase (проверьте формат JSON в Render):', e);
}

const db = admin.firestore();
