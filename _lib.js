// api/_lib.js — общие функции для регистрации/входа.
// Не отдаётся напрямую как страница — просто подключается другими файлами в api/.

const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// ===== Хранилище (Vercel KV / Upstash Redis через REST) =====

async function kvGet(key) {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await res.json();
    if (!data.result) return null;
    try {
        return JSON.parse(data.result);
    } catch {
        return null;
    }
}

async function kvSet(key, valueObj) {
    const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        body: JSON.stringify(valueObj)
    });
    const data = await res.json();
    return data.result === 'OK';
}

// ===== Пароли =====

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const hashToCompare = crypto.scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(hashToCompare, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

// ===== Сессия (подписанная cookie, без базы для самой сессии) =====

function createSessionToken(email) {
    const payload = JSON.stringify({ email, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

function verifySessionToken(token) {
    if (!token || !token.includes('.')) return null;
    const [payloadB64, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payloadB64).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        if (payload.exp < Date.now()) return null;
        return payload.email;
    } catch {
        return null;
    }
}

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const out = {};
    header.split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        out[key] = decodeURIComponent(val);
    });
    return out;
}

function getBaseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
}

// ===== Отправка писем через Resend =====

async function sendEmail(to, subject, html) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'DBGD <onboarding@resend.dev>',
            to,
            subject,
            html
        })
    });
    return res.ok;
}

function readJsonBody(req) {
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = {};
        }
    }
    return body || {};
}

module.exports = {
    kvGet,
    kvSet,
    hashPassword,
    verifyPassword,
    createSessionToken,
    verifySessionToken,
    parseCookies,
    getBaseUrl,
    sendEmail,
    readJsonBody
};
