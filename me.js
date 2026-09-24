// api/me.js — проверка текущей сессии (используется в шапке сайта и в кабинете)
const { parseCookies, verifySessionToken } = require('./_lib');

module.exports = async function handler(req, res) {
    const cookies = parseCookies(req);
    const email = verifySessionToken(cookies.dbgd_session);

    if (!email) {
        return res.status(200).json({ loggedIn: false });
    }
    return res.status(200).json({ loggedIn: true, email });
};
