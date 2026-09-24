// api/login.js — вход по email + паролю
const { kvGet, verifyPassword, createSessionToken, readJsonBody } = require('./_lib');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Метод не поддерживается' });
    }

    const body = readJsonBody(req);
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    const user = await kvGet(`user:${email}`);
    if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    if (!user.verified) {
        return res.status(403).json({ error: 'Почта ещё не подтверждена. Проверьте письмо во входящих (и в папке «Спам»)' });
    }

    const token = createSessionToken(email);
    res.setHeader(
        'Set-Cookie',
        `dbgd_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
    );

    return res.status(200).json({ ok: true, email });
};
