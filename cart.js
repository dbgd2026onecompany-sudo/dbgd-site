// cart.js — логика корзины через localStorage
// Подключайте этот файл на каждой странице (goods.html, korzina.html и т.д.)
// перед закрывающим тегом </body>: <script src="cart.js"></script>

// ===== НАСТРОЙКИ ОТПРАВКИ ЗАЯВОК =====
// ВНИМАНИЕ: токен бота нельзя держать в этом файле — его видно любому
// посетителю через «Просмотр кода страницы». Заявки отправляются на ваш
// серверный адрес, а уже сервер пересылает их в Telegram со своим токеном.
// Пока сервера нет, заявка сохраняется в браузере (см. PENDING_KEY),
// чтобы данные клиента не пропали.
const ORDER_ENDPOINT = '/api/send-order';

// ===== КОНТАКТНЫЕ ДАННЫЕ (используются в кнопках связи на всех страницах) =====
const CONTACT_PHONE = '+380969532561';
const CONTACT_EMAIL = 'daniilborisenko64801@gmail.com';
const CONTACT_TELEGRAM_URL = 'https://t.me/+380969532561';
const CONTACT_WHATSAPP_URL = 'https://wa.me/380969532561';
const CONTACT_VIBER_URL = 'viber://chat?number=%2B380969532561';

// ===== КЛЮЧИ ХРАНИЛИЩА =====
const CART_KEY = 'cart';
const PROMO_KEY = 'cartPromo';
const HISTORY_KEY = 'orderHistory';
const PENDING_KEY = 'pendingOrders';

// ===== ЛИМИТЫ КОЛИЧЕСТВА =====
const MIN_QTY = 1;
const MAX_QTY = 20;          // максимум одной позиции
const MAX_POSITIONS = 30;    // максимум разных позиций в корзине

// ===== ПРОМОКОДЫ =====
// type: 'percent' — скидка в %, 'fixed' — скидка в гривнах
// minTotal — минимальная сумма заказа, с которой код работает
const PROMO_CODES = {
    'WELCOME10': { type: 'percent', value: 10, minTotal: 0,    label: 'Первый заказ −10%' },
    'DBGD15':    { type: 'percent', value: 15, minTotal: 1000, label: 'От 1000 грн −15%' },
    'MINUS50':   { type: 'fixed',   value: 50, minTotal: 300,  label: 'Минус 50 грн' }
};

// ===== ДОСТАВКА =====
// needsAddress — нужно ли поле адреса/отделения
const DELIVERY_OPTIONS = {
    'telegram':   { label: 'Онлайн в Telegram (для программ)', price: 0,   needsAddress: false },
    'remote':     { label: 'Удалённо (для услуг)',             price: 0,   needsAddress: false },
    'novaposhta': { label: 'Новая почта, отделение',           price: 90,  needsAddress: true  },
    'courier':    { label: 'Курьер по Киеву',                  price: 150, needsAddress: true  },
    'pickup':     { label: 'Самовывоз, Киев',                  price: 0,   needsAddress: false }
};

const PAYMENT_OPTIONS = {
    'card': 'Перевод на карту',
    'mono': 'Банка monobank',
    'cod':  'Наложенный платёж',
    'cash': 'Наличными при получении'
};

/* ============================================================
   ТЕЛЕФОН: маска ввода и проверка
   ============================================================ */

function digitsOnly(value) {
    return (value || '').replace(/\D/g, '');
}

// Приводим любой ввод к виду 380XXXXXXXXX (12 цифр).
// Поле уже содержит «+380», поэтому человек часто дописывает номер целиком
// («+380» + «0969532561» или «+380» + «380969532561») — срезаем всё лишнее
// в начале, сколько бы раз оно ни повторилось. Код оператора в Украине
// никогда не начинается с 0 или 8, так что это безопасно.
function normalizePhone(value) {
    let d = digitsOnly(value);

    for (;;) {
        if (d.startsWith('380')) { d = d.slice(3); continue; }
        if (d.startsWith('80'))  { d = d.slice(2); continue; }
        if (d.startsWith('0'))   { d = d.slice(1); continue; }
        break;
    }

    return '380' + d.slice(0, 9);
}

// Красивый вид: +380 96 953 25 61
function formatPhone(value) {
    const d = normalizePhone(value);
    if (d.length <= 3) return '+380 ';
    const rest = d.slice(3);
    let out = '+380';
    if (rest.length) out += ' ' + rest.slice(0, 2);
    if (rest.length > 2) out += ' ' + rest.slice(2, 5);
    if (rest.length > 5) out += ' ' + rest.slice(5, 7);
    if (rest.length > 7) out += ' ' + rest.slice(7, 9);
    return out;
}

// Валиден, если 12 цифр и код оператора начинается с 3..9
function isValidPhone(value) {
    return /^380[3-9]\d{8}$/.test(normalizePhone(value));
}

// Вешаем маску на поле телефона
function attachPhoneMask(input) {
    if (!input || input.dataset.maskAttached) return;
    input.dataset.maskAttached = '1';

    input.setAttribute('inputmode', 'tel');
    input.setAttribute('autocomplete', 'tel');
    input.setAttribute('maxlength', '17');
    input.setAttribute('placeholder', '+380 XX XXX XX XX');

    const apply = () => {
        input.value = formatPhone(input.value);
        input.setCustomValidity(
            isValidPhone(input.value) ? '' : 'Введите номер в формате +380 XX XXX XX XX'
        );
    };

    input.addEventListener('focus', () => {
        if (!input.value.trim()) input.value = '+380 ';
    });
    input.addEventListener('input', apply);
    input.addEventListener('blur', () => {
        if (normalizePhone(input.value).length <= 3) {
            input.value = '';
            input.setCustomValidity('');
        } else {
            apply();
        }
    });
    // Не даём стереть префикс клавишей Backspace
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && normalizePhone(input.value).length <= 3) {
            e.preventDefault();
        }
    });
}

// Подсветить поле с ошибкой и объяснить, что не так
function markInvalid(input, message) {
    showToast(message, 'error');
    if (!input) return;
    input.classList.add('field-error');
    input.focus();
    setTimeout(() => input.classList.remove('field-error'), 2500);
}

/* ============================================================
   ЗАЩИТА ОТ ДВОЙНОЙ ОТПРАВКИ
   ============================================================ */

const submittingForms = new Set();

// Блокирует повторный клик, меняет текст кнопки
// и гарантированно возвращает всё обратно даже при ошибке.
async function withSubmitLock(formId, submitBtn, busyText, task) {
    if (submittingForms.has(formId)) return;   // уже отправляется
    submittingForms.add(formId);

    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = busyText;
    }

    try {
        return await task();
    } finally {
        submittingForms.delete(formId);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }
}

/* ============================================================
   БАЗОВЫЕ ОПЕРАЦИИ С КОРЗИНОЙ
   ============================================================ */

function getCart() {
    try {
        const cart = JSON.parse(localStorage.getItem(CART_KEY));
        return Array.isArray(cart) ? cart : [];
    } catch (e) {
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
}

// Приводим количество к допустимому диапазону
function clampQty(qty) {
    const n = Math.floor(Number(qty) || 0);
    if (n < MIN_QTY) return MIN_QTY;
    if (n > MAX_QTY) return MAX_QTY;
    return n;
}

function addToCart(id, name, price, image) {
    const cart = getCart();
    const existing = cart.find(item => item.id === id);

    if (existing) {
        if (existing.qty >= MAX_QTY) {
            showToast(`Больше ${MAX_QTY} шт. одной позиции в заказе не получится. Напишите нам — обсудим оптом`, 'error');
            return;
        }
        existing.qty = clampQty(existing.qty + 1);
    } else {
        if (cart.length >= MAX_POSITIONS) {
            showToast(`В корзине уже ${MAX_POSITIONS} позиций — оформите этот заказ, потом добавите ещё`, 'error');
            return;
        }
        cart.push({ id, name, price: Number(price) || 0, image: image || '', qty: 1 });
    }

    saveCart(cart);
    renderCart();
    showToast(`«${name}» в корзине`);
}

function removeFromCart(id) {
    let cart = getCart();
    const item = cart.find(i => i.id === id);
    cart = cart.filter(i => i.id !== id);
    saveCart(cart);
    if (cart.length === 0) clearPromo(true);
    renderCart();
    if (item) showToast(`«${item.name}» убран из корзины`);
}

function changeQty(id, delta) {
    const cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;

    const next = item.qty + delta;

    if (next > MAX_QTY) {
        showToast(`Максимум ${MAX_QTY} шт. одной позиции`, 'error');
        return;
    }
    if (next < MIN_QTY) {
        removeFromCart(id);
        return;
    }

    item.qty = clampQty(next);
    saveCart(cart);
    renderCart();
}

// Ввод количества руками в поле
function setQty(id, value) {
    const cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;

    const raw = Math.floor(Number(value));
    if (!raw || raw < MIN_QTY) {
        item.qty = MIN_QTY;
        showToast(`Минимум ${MIN_QTY} шт.`, 'error');
    } else if (raw > MAX_QTY) {
        item.qty = MAX_QTY;
        showToast(`Максимум ${MAX_QTY} шт. одной позиции`, 'error');
    } else {
        item.qty = raw;
    }

    saveCart(cart);
    renderCart();
}

function clearCart() {
    localStorage.removeItem(CART_KEY);
    clearPromo(true);
    updateCartBadge();
    renderCart();
}

function updateCartBadge() {
    const badge = document.querySelector('.cart-badge');
    if (!badge) return;
    const totalQty = getCart().reduce((sum, item) => sum + item.qty, 0);
    badge.textContent = totalQty > 0 ? totalQty : '';
    badge.style.display = totalQty > 0 ? 'inline-flex' : 'none';
}

/* ============================================================
   ПРОМОКОДЫ
   ============================================================ */

function getSubtotal(cart) {
    return (cart || getCart()).reduce((sum, i) => sum + i.price * i.qty, 0);
}

function getAppliedPromo() {
    const code = localStorage.getItem(PROMO_KEY);
    if (!code) return null;
    const promo = PROMO_CODES[code];
    return promo ? { code, ...promo } : null;
}

// Сколько реально скинули с учётом текущей суммы
function calcDiscount(subtotal, promo) {
    if (!promo || subtotal < promo.minTotal) return 0;
    const value = promo.type === 'percent'
        ? Math.round(subtotal * promo.value / 100)
        : promo.value;
    return Math.min(value, subtotal);   // скидка не больше суммы заказа
}

function applyPromo(event) {
    if (event) event.preventDefault();

    const input = document.querySelector('#promo-input');
    if (!input) return;

    const code = input.value.trim().toUpperCase();
    if (!code) return markInvalid(input, 'Введите промокод');

    const promo = PROMO_CODES[code];
    if (!promo) return markInvalid(input, 'Такого промокода нет');

    const subtotal = getSubtotal();
    if (subtotal < promo.minTotal) {
        return markInvalid(input, `Промокод работает от ${promo.minTotal} грн, сейчас в корзине ${subtotal} грн`);
    }

    localStorage.setItem(PROMO_KEY, code);
    renderCart();
    showToast(`Промокод ${code} применён: ${promo.label}`);
}

function clearPromo(silent) {
    localStorage.removeItem(PROMO_KEY);
    if (!silent) {
        renderCart();
        showToast('Промокод убран');
    }
}

/* ============================================================
   ДОСТАВКА
   ============================================================ */

function getSelectedDelivery() {
    const select = document.querySelector('#order-delivery');
    const key = select ? select.value : 'telegram';
    return { key, ...(DELIVERY_OPTIONS[key] || DELIVERY_OPTIONS['telegram']) };
}

function onDeliveryChange() {
    const delivery = getSelectedDelivery();
    const addressWrap = document.querySelector('#order-address-wrap');
    const addressInput = document.querySelector('#order-address');

    if (addressWrap && addressInput) {
        addressWrap.style.display = delivery.needsAddress ? 'block' : 'none';
        addressInput.required = delivery.needsAddress;
        addressInput.placeholder = delivery.key === 'novaposhta'
            ? 'Город и номер отделения Новой почты'
            : 'Улица, дом, квартира';
        if (!delivery.needsAddress) addressInput.value = '';
    }

    renderCart();
}

/* ============================================================
   ОТРИСОВКА КОРЗИНЫ
   ============================================================ */

function renderCart() {
    const container = document.querySelector('.cart-items');
    if (!container) return;   // на других страницах ничего не делаем

    const cart = getCart();
    const summaryEl = document.querySelector('.cart-summary');
    const formEl = document.querySelector('#order-form');

    if (cart.length === 0) {
        container.innerHTML =
            '<p class="cart-empty">Корзина пуста. Загляните в <a href="goods.html">товары</a> или <a href="services.html">услуги</a>.</p>';
        if (summaryEl) summaryEl.innerHTML = '';
        if (formEl) formEl.style.display = 'none';
        return;
    }

    if (formEl) formEl.style.display = 'flex';
    container.innerHTML = '';

    cart.forEach(item => {
        const itemTotal = item.price * item.qty;
        const row = document.createElement('div');
        row.className = 'cart-row';
        row.innerHTML = `
            ${item.image
                ? `<img src="${item.image}" alt="${item.name}">`
                : '<div class="cart-row-noimg">🛠</div>'}
            <div class="cart-row-info">
                <p class="cart-row-title">${item.name}</p>
                <p class="cart-row-price">${item.price} грн / шт.</p>
            </div>
            <div class="cart-qty">
                <button type="button" aria-label="Убрать одну штуку"
                    onclick="changeQty('${item.id}', -1)">−</button>
                <input type="number" class="cart-qty-input" value="${item.qty}"
                    min="${MIN_QTY}" max="${MAX_QTY}" inputmode="numeric" aria-label="Количество"
                    onchange="setQty('${item.id}', this.value)">
                <button type="button" aria-label="Добавить одну штуку"
                    ${item.qty >= MAX_QTY ? 'disabled' : ''}
                    onclick="changeQty('${item.id}', 1)">+</button>
            </div>
            <p class="cart-row-total">${itemTotal} грн</p>
            <button type="button" class="cart-remove" aria-label="Убрать из корзины"
                onclick="removeFromCart('${item.id}')">✕</button>
        `;
        container.appendChild(row);
    });

    renderSummary(cart);
}

function renderSummary(cart) {
    const summaryEl = document.querySelector('.cart-summary');
    if (!summaryEl) return;

    const subtotal = getSubtotal(cart);
    const promo = getAppliedPromo();
    const discount = calcDiscount(subtotal, promo);
    const delivery = getSelectedDelivery();
    const total = subtotal - discount + delivery.price;

    // Промокод перестал подходить под сумму — убираем молча
    if (promo && discount === 0) clearPromo(true);

    const rows = [
        `<div class="sum-row"><span>Товары и услуги</span><span>${subtotal} грн</span></div>`
    ];

    if (discount > 0) {
        rows.push(`
            <div class="sum-row sum-discount">
                <span>${promo.code} · ${promo.label}
                    <button type="button" class="promo-clear" onclick="clearPromo()">убрать</button>
                </span>
                <span>−${discount} грн</span>
            </div>`);
    }

    rows.push(`<div class="sum-row"><span>${delivery.label}</span><span>${delivery.price ? delivery.price + ' грн' : 'бесплатно'}</span></div>`);
    rows.push(`<div class="sum-row sum-total"><span>К оплате</span><span>${total} грн</span></div>`);

    summaryEl.innerHTML = `
        <form class="promo-form" onsubmit="applyPromo(event)">
            <input type="text" id="promo-input" placeholder="Промокод" autocomplete="off"
                value="${promo ? promo.code : ''}">
            <button type="submit">Применить</button>
        </form>
        <div class="cart-sums">${rows.join('')}</div>
    `;
}

/* ============================================================
   ИСТОРИЯ ЗАКАЗОВ
   ============================================================ */

function getOrderHistory() {
    try {
        const list = JSON.parse(localStorage.getItem(HISTORY_KEY));
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function saveOrderToHistory(order) {
    const history = getOrderHistory();
    history.unshift(order);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
    renderOrderHistory();
}

function clearOrderHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderOrderHistory();
    showToast('История очищена');
}

// Повторить заказ: те же позиции обратно в корзину
function repeatOrder(orderNumber) {
    const order = getOrderHistory().find(o => o.number === orderNumber);
    if (!order) return;

    saveCart(order.items.map(i => ({ ...i, qty: clampQty(i.qty) })));
    renderCart();
    showToast(`Заказ ${orderNumber} снова в корзине`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderOrderHistory() {
    const wrap = document.querySelector('.order-history');
    if (!wrap) return;

    const history = getOrderHistory();

    if (history.length === 0) {
        wrap.innerHTML = '<h3>Ваши заказы</h3>' +
            '<p class="history-empty">Здесь появятся заказы, оформленные с этого устройства.</p>';
        return;
    }

    const cards = history.map(order => {
        const items = order.items
            .map(i => `<li>${i.name} — ${i.qty} шт. × ${i.price} грн</li>`)
            .join('');
        return `
            <div class="history-card">
                <div class="history-head">
                    <span class="history-number">${order.number}</span>
                    <span class="history-date">${order.date}</span>
                    <span class="history-status history-${order.status}">${order.statusText}</span>
                </div>
                <ul class="history-items">${items}</ul>
                <div class="history-foot">
                    <span class="history-way">${order.delivery} · ${order.payment}</span>
                    <strong>${order.total} грн</strong>
                    <button type="button" onclick="repeatOrder('${order.number}')">Повторить</button>
                </div>
            </div>`;
    }).join('');

    wrap.innerHTML = `
        <h3>Ваши заказы</h3>
        <p class="history-note">Список хранится только в этом браузере.</p>
        ${cards}
        <button type="button" class="history-clear" onclick="clearOrderHistory()">Очистить историю</button>
    `;
}

function makeOrderNumber() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `DBGD-${pad(d.getDate())}${pad(d.getMonth() + 1)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ============================================================
   ОТПРАВКА ЗАЯВОК
   ============================================================ */

// Отправляем на ваш сервер. Если сервера ещё нет — складываем заявку
// в localStorage, чтобы ничего не потерялось, и честно говорим об этом.
async function sendOrderRequest(payload) {
    try {
        const response = await fetch(ORDER_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Сервер ответил ' + response.status);
        return { ok: true };
    } catch (err) {
        console.error('Не удалось отправить заявку:', err);
        savePending(payload);
        return { ok: false, error: err };
    }
}

function savePending(payload) {
    try {
        const list = JSON.parse(localStorage.getItem(PENDING_KEY)) || [];
        list.push({ ...payload, savedAt: new Date().toISOString() });
        localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-50)));
    } catch (e) {
        console.error(e);
    }
}

/* ---------- Обратный звонок (order.html) ---------- */
async function submitCallback(event) {
    event.preventDefault();

    const nameInput = document.querySelector('#callback-name');
    const phoneInput = document.querySelector('#callback-phone');
    const name = nameInput.value.trim();

    if (name.length < 2) return markInvalid(nameInput, 'Напишите, как к вам обращаться');
    if (!isValidPhone(phoneInput.value)) return markInvalid(phoneInput, 'Номер в формате +380 XX XXX XX XX');

    const submitBtn = document.querySelector('#callback-submit-btn');

    await withSubmitLock('callback', submitBtn, 'Отправляем...', async () => {
        const result = await sendOrderRequest({
            type: 'callback',
            name,
            phone: '+' + normalizePhone(phoneInput.value)
        });

        if (result.ok) {
            showToast('Заявка принята — перезвоним в рабочее время');
            document.querySelector('#callback-form').reset();
            phoneInput.value = '';
        } else {
            showToast('Сервер не ответил. Заявка сохранена — напишите нам в Telegram', 'error');
        }
    });
}

/* ---------- Индивидуальный заказ (order.html) ---------- */
async function submitCustomOrder(event) {
    event.preventDefault();

    const nameInput = document.querySelector('#custom-order-name');
    const phoneInput = document.querySelector('#custom-order-phone');
    const descInput = document.querySelector('#custom-order-description');

    const name = nameInput.value.trim();
    const description = descInput.value.trim();

    if (name.length < 2) return markInvalid(nameInput, 'Напишите, как к вам обращаться');
    if (!isValidPhone(phoneInput.value)) return markInvalid(phoneInput, 'Номер в формате +380 XX XXX XX XX');
    if (description.length < 10) return markInvalid(descInput, 'Опишите задачу подробнее — хотя бы пару предложений');

    const submitBtn = document.querySelector('#custom-order-submit-btn');

    await withSubmitLock('custom-order', submitBtn, 'Отправляем...', async () => {
        const result = await sendOrderRequest({
            type: 'custom_order',
            name,
            phone: '+' + normalizePhone(phoneInput.value),
            description
        });

        if (result.ok) {
            showToast('Заказ отправлен — свяжемся с вами');
            document.querySelector('#custom-order-form').reset();
            phoneInput.value = '';
        } else {
            showToast('Сервер не ответил. Заказ сохранён — напишите нам в Telegram', 'error');
        }
    });
}

/* ---------- Заказ из корзины (korzina.html) ---------- */
async function submitOrder(event) {
    event.preventDefault();

    const cart = getCart();
    if (cart.length === 0) {
        showToast('Корзина пуста', 'error');
        return;
    }

    const nameInput = document.querySelector('#order-name');
    const phoneInput = document.querySelector('#order-phone');
    const addressInput = document.querySelector('#order-address');
    const commentInput = document.querySelector('#order-comment');
    const paymentSelect = document.querySelector('#order-payment');

    const name = nameInput.value.trim();
    const comment = commentInput.value.trim();
    const delivery = getSelectedDelivery();
    const paymentLabel = PAYMENT_OPTIONS[paymentSelect.value] || paymentSelect.value;

    if (name.length < 2) return markInvalid(nameInput, 'Напишите, как к вам обращаться');
    if (!isValidPhone(phoneInput.value)) return markInvalid(phoneInput, 'Номер в формате +380 XX XXX XX XX');
    if (delivery.needsAddress && addressInput.value.trim().length < 5) {
        return markInvalid(addressInput, delivery.key === 'novaposhta'
            ? 'Укажите город и номер отделения'
            : 'Укажите адрес доставки');
    }

    const subtotal = getSubtotal(cart);
    const promo = getAppliedPromo();
    const discount = calcDiscount(subtotal, promo);

    const order = {
        number: makeOrderNumber(),
        date: formatDate(new Date()),
        items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, image: i.image })),
        subtotal,
        promoCode: promo ? promo.code : null,
        discount,
        delivery: delivery.label,
        deliveryPrice: delivery.price,
        address: delivery.needsAddress ? addressInput.value.trim() : '',
        payment: paymentLabel,
        total: subtotal - discount + delivery.price,
        status: 'new',
        statusText: 'Отправлен'
    };

    const submitBtn = document.querySelector('#order-submit-btn');

    await withSubmitLock('order', submitBtn, 'Отправляем...', async () => {
        const result = await sendOrderRequest({
            type: 'cart_order',
            name,
            phone: '+' + normalizePhone(phoneInput.value),
            comment,
            order
        });

        if (result.ok) {
            saveOrderToHistory(order);
            clearCart();
            document.querySelector('#order-form').reset();
            phoneInput.value = '';
            onDeliveryChange();
            showToast(`Заказ ${order.number} отправлен — свяжемся с вами`);
        } else {
            order.status = 'pending';
            order.statusText = 'Ждёт отправки';
            saveOrderToHistory(order);
            showToast('Сервер не ответил. Заказ сохранён в истории — напишите нам в Telegram', 'error');
        }
    });
}

/* ============================================================
   ИНТЕРФЕЙСНЫЕ МЕЛОЧИ
   ============================================================ */

function createFloatingContactWidget() {
    if (document.querySelector('.floating-contact')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'floating-contact';
    wrapper.innerHTML = `
        <div class="floating-contact-options">
            <a href="tel:${CONTACT_PHONE}" class="fc-phone" title="Позвонить">📞</a>
            <a href="${CONTACT_TELEGRAM_URL}" target="_blank" rel="noopener" class="fc-telegram" title="Telegram">✈️</a>
            <a href="${CONTACT_WHATSAPP_URL}" target="_blank" rel="noopener" class="fc-whatsapp" title="WhatsApp">💬</a>
            <a href="${CONTACT_VIBER_URL}" class="fc-viber" title="Viber">📱</a>
        </div>
        <button type="button" class="floating-contact-toggle" title="Связаться с нами">💬</button>
    `;
    document.body.appendChild(wrapper);

    const toggleBtn = wrapper.querySelector('.floating-contact-toggle');
    const options = wrapper.querySelector('.floating-contact-options');
    toggleBtn.addEventListener('click', () => options.classList.toggle('open'));

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) options.classList.remove('open');
    });
}

// График: Пн-Пт 9:00-20:00, Сб 10:00-19:00, Вс — выходной
function updateOnlineStatus() {
    const statusEl = document.querySelector('.online-status');
    if (!statusEl) return;

    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours() + now.getMinutes() / 60;

    let isOnline = false;
    if (day >= 1 && day <= 5) isOnline = hour >= 9 && hour < 20;
    else if (day === 6) isOnline = hour >= 10 && hour < 19;

    const dot = statusEl.querySelector('.online-dot');
    const text = statusEl.querySelector('.online-text');
    if (dot) {
        dot.classList.toggle('online', isOnline);
        dot.classList.toggle('offline', !isOnline);
    }
    if (text) {
        text.textContent = isOnline
            ? 'Мы на связи прямо сейчас'
            : 'Сейчас офлайн — напишите, ответим в рабочее время';
    }
}

function showToast(message, type = 'success') {
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-show'));

    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

/* ============================================================
   АВТОРИЗАЦИЯ: регистрация, вход, подтверждение почты, кабинет
   ============================================================ */

// Добавляет ссылку "Войти" / "Личный кабинет" в меню на каждой странице
async function insertAuthNavLink() {
    const nav = document.querySelector('.link-center');
    if (!nav) return;

    const link = document.createElement('a');
    link.className = 'auth-nav-link';
    link.href = 'login.html';
    link.textContent = '…';
    nav.appendChild(link);

    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (data.loggedIn) {
            link.href = 'account.html';
            link.textContent = '👤 ' + data.email.split('@')[0];
        } else {
            link.href = 'login.html';
            link.textContent = 'Войти';
        }
    } catch (err) {
        link.href = 'login.html';
        link.textContent = 'Войти';
    }
}

// Регистрация (страница register.html)
async function submitRegister(event) {
    event.preventDefault();

    const email = document.querySelector('#reg-email').value.trim().toLowerCase();
    const password = document.querySelector('#reg-password').value;
    const password2 = document.querySelector('#reg-password2').value;

    if (password.length < 6) {
        showToast('Пароль должен быть не короче 6 символов', 'error');
        return;
    }
    if (password !== password2) {
        showToast('Пароли не совпадают', 'error');
        return;
    }

    const btn = document.querySelector('#register-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Отправка...';

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка регистрации');

        showToast('Письмо с подтверждением отправлено ✓');
        document.querySelector('#register-form').innerHTML =
            `<p style="text-align:center;">Мы отправили письмо на <b>${email}</b>. Перейдите по ссылке из письма, чтобы подтвердить почту, затем войдите.</p>`;
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = 'Зарегистрироваться';
        }
    }
}

// Вход (страница login.html)
async function submitLogin(event) {
    event.preventDefault();

    const email = document.querySelector('#login-email').value.trim().toLowerCase();
    const password = document.querySelector('#login-password').value;

    const btn = document.querySelector('#login-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Вход...';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка входа');

        showToast('Вход выполнен ✓');
        window.location.href = 'account.html';
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
    }
}

// Повторная отправка письма с подтверждением (ссылка на странице login.html)
async function resendVerification(event) {
    event.preventDefault();
    const email = document.querySelector('#login-email').value.trim().toLowerCase();

    if (!email) {
        showToast('Сначала введите email в поле выше', 'error');
        return;
    }

    try {
        await fetch('/api/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        showToast('Если аккаунт существует — письмо отправлено ✓');
    } catch (err) {
        showToast('Не удалось отправить письмо. Попробуйте позже', 'error');
    }
}

// Выход из аккаунта
async function doLogout() {
    await fetch('/api/logout', { method: 'POST' });
    showToast('Вы вышли из аккаунта');
    window.location.href = 'main.html';
}

// Подтверждение почты по ссылке (страница verify.html)
async function verifyEmailFromUrl() {
    const messageEl = document.querySelector('#verify-message');
    if (!messageEl) return;

    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    const token = params.get('token');

    if (!email || !token) {
        messageEl.textContent = 'Ссылка неполная или повреждена.';
        return;
    }

    try {
        const res = await fetch(`/api/verify?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось подтвердить почту');

        messageEl.innerHTML = data.alreadyVerified
            ? 'Почта уже была подтверждена ранее. <a href="login.html">Войти</a>'
            : 'Почта подтверждена! Теперь можно <a href="login.html">войти в аккаунт</a>.';
    } catch (err) {
        messageEl.textContent = err.message;
    }
}

// Данные аккаунта (страница account.html)
async function loadAccountInfo() {
    const el = document.querySelector('#account-info');
    if (!el) return;

    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (!data.loggedIn) {
            window.location.href = 'login.html';
            return;
        }
        el.innerHTML = `Вы вошли как <b>${data.email}</b>`;
    } catch (err) {
        el.textContent = 'Не удалось загрузить данные аккаунта.';
    }
}

/* ============================================================
   ЗАПУСК
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    updateCartBadge();

    // Маски на все поля телефона
    document.querySelectorAll('input[type="tel"]').forEach(attachPhoneMask);

    const deliverySelect = document.querySelector('#order-delivery');
    if (deliverySelect) {
        deliverySelect.addEventListener('change', onDeliveryChange);
        onDeliveryChange();   // выставит видимость адреса и отрисует корзину
    } else {
        renderCart();
    }

    renderOrderHistory();
    createFloatingContactWidget();
    updateOnlineStatus();
    insertAuthNavLink();
    loadAccountInfo();
});

// Корзину изменили в другой вкладке — подтягиваем
window.addEventListener('storage', (e) => {
    if (e.key === CART_KEY || e.key === PROMO_KEY) {
        updateCartBadge();
        renderCart();
    }
});
