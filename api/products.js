// api/products.js — товары для goods.html + управление ими из admin.html
const crypto = require('crypto');
const { kvGet, kvSet, parseCookies, verifySessionToken, readJsonBody } = require('./_lib');

async function getProducts() {
    const data = await kvGet('products');
    return Array.isArray(data) ? data : [];
}

function isAdminEmail(email) {
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    return !!adminEmail && email === adminEmail;
}

function validateProductInput(body) {
    const name = (body.name || '').trim();
    const price = Number(body.price);
    if (!name) return 'Укажите название товара';
    if (!Number.isFinite(price) || price <= 0) return 'Цена должна быть положительным числом';
    return null;
}

module.exports = async function handler(req, res) {
    // Список товаров виден всем — это для страницы "Товары"
    if (req.method === 'GET') {
        const products = await getProducts();
        return res.status(200).json({ products });
    }

    // Всё остальное — только для администратора
    const cookies = parseCookies(req);
    const email = verifySessionToken(cookies.dbgd_session);
    if (!isAdminEmail(email)) {
        return res.status(403).json({ error: 'Доступ разрешён только администратору' });
    }

    if (req.method === 'POST') {
        const body = readJsonBody(req);
        const error = validateProductInput(body);
        if (error) return res.status(400).json({ error });

        const product = {
            id: crypto.randomBytes(6).toString('hex'),
            name: body.name.trim(),
            price: Number(body.price),
            oldPrice: body.oldPrice ? Number(body.oldPrice) : null,
            image: (body.image || '').trim(),
            description: (body.description || '').trim(),
            createdAt: Date.now()
        };

        const products = await getProducts();
        products.push(product);
        await kvSet('products', products);

        return res.status(200).json({ ok: true, product });
    }

    if (req.method === 'PUT') {
        const body = readJsonBody(req);
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Не указан id товара' });

        const error = validateProductInput(body);
        if (error) return res.status(400).json({ error });

        const products = await getProducts();
        const idx = products.findIndex((p) => p.id === id);
        if (idx === -1) return res.status(404).json({ error: 'Товар не найден' });

        products[idx] = {
            ...products[idx],
            name: body.name.trim(),
            price: Number(body.price),
            oldPrice: body.oldPrice ? Number(body.oldPrice) : null,
            image: (body.image || '').trim(),
            description: (body.description || '').trim()
        };
        await kvSet('products', products);

        return res.status(200).json({ ok: true, product: products[idx] });
    }

    if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'Не указан id товара' });

        const products = await getProducts();
        const filtered = products.filter((p) => p.id !== id);
        await kvSet('products', filtered);

        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Метод не поддерживается' });
};
