// api/register.js — регистрация нового пользователя + письмо с подтверждением
const crypto = require('crypto');
const { kvGet, kvSet, hashPassword, sendEmail, getBaseUrl, readJsonBody } = require('./_lib');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Метод не поддерживается' });
    }

    const body = readJsonBody(req);
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Некорректный email' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    }

    const existing = await kvGet(`user:${email}`);
    if (existing && existing.verified) {
        return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    }

    const verifyToken = crypto.randomBytes(24).toString('hex');
    const user = {
        email,
        passwordHash: hashPassword(password),
        verified: false,
        verifyToken,
        verifyExpires: Date.now() + 24 * 60 * 60 * 1000,
        createdAt: existing ? existing.createdAt : Date.now()
    };

    const saved = await kvSet(`user:${email}`, user);
    if (!saved) {
        return res.status(502).json({ error: 'Не удалось сохранить аккаунт. Попробуйте позже' });
    }

    const verifyUrl = `${getBaseUrl(req)}/verify.html?email=${encodeURIComponent(email)}&token=${verifyToken}`;

    const sent = await sendEmail(
        email,
        'Подтвердите почту — DBGD',
        `<p>Здравствуйте!</p>
         <p>Подтвердите регистрацию на сайте DBGD, перейдя по ссылке:</p>
         <p><a href="${verifyUrl}">${verifyUrl}</a></p>
         <p>Ссылка действует 24 часа. Если вы не регистрировались на DBGD — просто проигнорируйте это письмо.</p>`
    );

    if (!sent) {
        return res.status(502).json({ error: 'Не удалось отправить письмо. Попробуйте позже' });
    }

    return res.status(200).json({ ok: true });
};
