// Работа с балансом через Firestore с детальным логированием
async function getBalance(userId) {
    try {
        const docId = String(userId);
        console.log(`[Firestore] Чтение баланса для пользователя ID: ${docId}`);
        const userRef = db.collection('users').doc(docId);
        const doc = await userRef.get();
        
        if (!doc.exists) {
            console.log(`[Firestore] Пользователь ${docId} не найден. Создаем с начальным балансом 5.`);
            await userRef.set({ balance: 5, created_at: new Date() });
            return 5;
        }
        
        const balance = Number(doc.data().balance) || 0;
        console.log(`[Firestore] Текущий баланс пользователя ${docId}: ${balance}`);
        return balance;
    } catch (error) {
        console.error('[Firestore ERROR] Ошибка чтения баланса:', error);
        return 0;
    }
}

async function updateBalance(userId, amount) {
    try {
        const docId = String(userId);
        console.log(`[Firestore] Обновление баланса для пользователя ${docId}. Изменение на: ${amount}`);
        const userRef = db.collection('users').doc(docId);
        const doc = await userRef.get();
        
        let currentBalance = 0;
        if (doc.exists) {
            currentBalance = Number(doc.data().balance) || 0;
        }
        
        const newBalance = currentBalance + amount;
        await userRef.set({ balance: newBalance, updated_at: new Date() }, { merge: true });
        console.log(`[Firestore] Успешно! Новый баланс пользователя ${docId} равен ${newBalance}`);
        return newBalance;
    } catch (error) {
        console.error('[Firestore ERROR] Ошибка обновления баланса:', error);
        return 0;
    }
}
