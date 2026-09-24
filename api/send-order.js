// api/send-order.js — серверная функция для Vercel.
// Токен бота живёт здесь, на сервере, и в браузер не попадает.
//
// Как запустить:
// 1. Положите этот файл в папку api/ рядом с HTML-страницами.
// 2. Залейте проект на vercel.com (или аналог).
// 3. В настройках проекта → Environment Variables добавьте:
//      TELEGRAM_BOT_TOKEN = токен от @BotFather
//      TELEGRAM_CHAT_ID   = ваш chat_id
// 4. Старый токен, который лежал в cart.js, обязательно отзовите:
//    @BotFather → /revoke → выберите бота. Он уже засвечен в коде страницы.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Простая защита от спама: не больше 5 заявок с одного IP за 10 минут
const recent = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function isRateLimited(ip) {
    const now = Date.now();
    const hits = (recent.get(ip) || []).filter(t => now - t < WINDOW_MS);
    hits.push(now);
    recent.set(ip, hits);
    return hits.length > MAX_PER_WINDOW;
}

// Экранируем всё, что пришло от пользователя
function clean(value, maxLength = 500) {
    return String(value || '')
        .slice(0, maxLength)
        .replace(/[<>]/g, '');
}

function isValidPhone(phone) {
    return /^\+?380[3-9]\d{8}$/.test(String(phone).replace(/\D/g, '').replace(/^/, '+'));
}

function buildMessage(data) {
    const name = clean(data.name, 100);
    const phone = clean(data.phone, 20);

    if (data.type === 'callback') {
        return `📞 Обратный звонок\n\nИмя: ${name}\nТелефон: ${phone}`;
    }

    if (data.type === 'custom_order') {
        return `📝 Индивидуальный заказ\n\n` +
            `Имя: ${name}\nТелефон: ${phone}\n\n` +
            `Задача: ${clean(data.description, 2000)}`;
    }

    if (data.type === 'cart_order') {
        const o = data.order || {};
        const items = (o.items || [])
            .slice(0, 30)
            .map(i => `• ${clean(i.name, 100)} — ${Number(i.qty)} шт. × ${Number(i.price)} грн`)
            .join('\n');

        return `🛒 Заказ ${clean(o.number, 30)}\n\n` +
            `Имя: ${name}\nТелефон: ${phone}\n` +
            (data.comment ? `Комментарий: ${clean(data.comment, 1000)}\n` : '') +
            `\nТовары:\n${items}\n\n` +
            `Сумма: ${Number(o.subtotal)} грн\n` +
            (o.discount ? `Промокод ${clean(o.promoCode, 30)}: −${Number(o.discount)} грн\n` : '') +
            `Доставка: ${clean(o.delivery, 100)}` +
            (o.deliveryPrice ? ` (${Number(o.deliveryPrice)} грн)` : '') + `\n` +
            (o.address ? `Адрес: ${clean(o.address, 300)}\n` : '') +
            `Оплата: ${clean(o.payment, 100)}\n\n` +
            `К оплате: ${Number(o.total)} грн`;
    }

    return null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Только POST' });
    }

    const ip = req.headers['x-forwarded-for'] || 'unknown';
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Слишком много заявок. Попробуйте через несколько минут' });
    }

    const data = req.body || {};

    if (!data.name || String(data.name).trim().length < 2) {
        return res.status(400).json({ error: 'Не указано имя' });
    }
    if (!isValidPhone(data.phone)) {
        return res.status(400).json({ error: 'Некорректный телефон' });
    }

    const text = buildMessage(data);
    if (!text) {
        return res.status(400).json({ error: 'Неизвестный тип заявки' });
    }

    try {
        const tg = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text })
        });

        if (!tg.ok) {
            const details = await tg.text();
            console.error('Telegram вернул ошибку:', details);
            return res.status(502).json({ error: 'Не удалось передать заявку' });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Внутренняя ошибка' });
    }
}
