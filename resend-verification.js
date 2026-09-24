// api/resend-verification.js — повторная отправка письма с подтверждением
const crypto = require('crypto');
const { kvGet, kvSet, sendEmail, getBaseUrl, readJsonBody } = require('./_lib');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Метод не поддерживается' });
    }

    const body = readJsonBody(req);
    const email = (body.email || '').trim().toLowerCase();

    const user = await kvGet(`user:${email}`);
    // Не сообщаем, существует ли такой email — чтобы не помогать перебору адресов
    if (!user) {
        return res.status(200).json({ ok: true });
    }
    if (user.verified) {
        return res.status(200).json({ ok: true, alreadyVerified: true });
    }

    user.verifyToken = crypto.randomBytes(24).toString('hex');
    user.verifyExpires = Date.now() + 24 * 60 * 60 * 1000;
    await kvSet(`user:${email}`, user);

    const verifyUrl = `${getBaseUrl(req)}/verify.html?email=${encodeURIComponent(email)}&token=${user.verifyToken}`;

    await sendEmail(
        email,
        'Подтвердите почту — DBGD',
        `<p>Ссылка для подтверждения почты:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>Действует 24 часа.</p>`
    );

    return res.status(200).json({ ok: true });
};
