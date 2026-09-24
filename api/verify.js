// api/verify.js — подтверждение почты по ссылке из письма
const { kvGet, kvSet } = require('./_lib');

module.exports = async function handler(req, res) {
    const email = String(req.query.email || '').trim().toLowerCase();
    const token = String(req.query.token || '');

    if (!email || !token) {
        return res.status(400).json({ error: 'Неверная ссылка подтверждения' });
    }

    const user = await kvGet(`user:${email}`);
    if (!user) {
        return res.status(404).json({ error: 'Аккаунт не найден' });
    }
    if (user.verified) {
        return res.status(200).json({ ok: true, alreadyVerified: true });
    }
    if (user.verifyToken !== token || Date.now() > user.verifyExpires) {
        return res.status(400).json({ error: 'Ссылка недействительна или устарела. Запросите новое письмо на странице входа' });
    }

    user.verified = true;
    delete user.verifyToken;
    delete user.verifyExpires;
    await kvSet(`user:${email}`, user);

    return res.status(200).json({ ok: true });
};
