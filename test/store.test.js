const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));
process.env.DATA_DIR = tmp;
process.env.SEED_DEMO = '1';
process.env.ADMIN_PASSWORD = 'test-password-1';

const app = require('../server');
const { db } = require('../src/db');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const product = (slug) => db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);

function order(body, headers = {}) {
  return fetch(`${base}/order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers },
    body: JSON.stringify(body),
  });
}

const customer = {
  customer_name: 'محمد أمين',
  phone: '0555 12 34 56',
  wilaya: 16,
  commune: 'باب الزوار',
  address: 'حي 1000 مسكن',
  delivery_type: 'home',
};

async function adminCookie() {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=test-password-1',
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  return res.headers.get('set-cookie').split(';')[0];
}

async function csrfFor(cookie) {
  const html = await (await fetch(`${base}/admin/settings`, { headers: { cookie } })).text();
  return html.match(/name="_csrf" value="([^"]+)"/)[1];
}

test('health check answers without touching the database', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('storefront pages render', async () => {
  for (const url of ['/', '/products', '/p/buds-pro', '/cart', '/policy']) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
  }
  assert.equal((await fetch(`${base}/p/nope`)).status, 404);
});

test('order is priced on the server and reduces stock', async () => {
  const p = product('buds-pro');
  const res = await order({ ...customer, items: [{ product_id: p.id, variant: 'أسود', qty: 2, price: 1 }] });
  assert.equal(res.status, 200);
  const { redirect } = await res.json();
  const o = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  assert.equal(o.subtotal, p.price * 2);
  assert.equal(o.shipping, db.prepare('SELECT home_price FROM wilayas WHERE code = 16').get().home_price);
  assert.equal(o.total, o.subtotal + o.shipping);
  assert.equal(o.phone, '0555123456');
  assert.equal(product('buds-pro').stock, p.stock - 2);

  const thanks = await fetch(base + redirect);
  assert.equal(thanks.status, 200);
  assert.match(await thanks.text(), new RegExp(`#${o.id}`));
});

test('resubmitting the same order does not duplicate it', async () => {
  const p = product('charger-25w');
  const body = { ...customer, phone: '0666000111', items: [{ product_id: p.id, qty: 1 }] };
  const a = await (await order(body)).json();
  const b = await (await order(body)).json();
  assert.equal(a.redirect, b.redirect);
});

test('invalid orders are rejected with field errors', async () => {
  const p = product('nova-x12');
  const res = await order({ customer_name: 'a', phone: '123', wilaya: 99, commune: '', delivery_type: 'home', items: [{ product_id: p.id, qty: 1, variant: 'أحمر' }] });
  assert.equal(res.status, 422);
  const { errors } = await res.json();
  for (const k of ['customer_name', 'phone', 'wilaya', 'commune', 'address', 'items']) assert.ok(errors[k], k);

  const tooMany = await order({ ...customer, phone: '0777000222', items: [{ product_id: p.id, variant: 'أسود', qty: p.stock + 1 }] });
  assert.equal(tooMany.status, 422);
});

test('desk delivery and free shipping', async () => {
  const p = product('clear-case');
  db.prepare('UPDATE products SET free_shipping = 1 WHERE id = ?').run(p.id);
  await order({ ...customer, phone: '0770112233', delivery_type: 'desk', address: '', items: [{ product_id: p.id, qty: 1 }] });
  const o = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  assert.equal(o.delivery_type, 'desk');
  assert.equal(o.shipping, 0);
  assert.equal(o.total, p.price);
});

test('honeypot blocks bots', async () => {
  const p = product('clear-case');
  const res = await order({ ...customer, website: 'spam', items: [{ product_id: p.id, qty: 1 }] });
  assert.equal(res.status, 400);
});

test('admin requires login and a valid password', async () => {
  const res = await fetch(`${base}/admin/orders`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const bad = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=wrong',
    redirect: 'manual',
  });
  assert.equal(bad.status, 401);
});

test('admin can view orders and cancelling restocks', async () => {
  const cookie = await adminCookie();
  for (const url of ['/admin', '/admin/orders', '/admin/products', '/admin/products/new', '/admin/categories', '/admin/shipping', '/admin/settings', '/admin/orders.csv']) {
    const res = await fetch(base + url, { headers: { cookie } });
    assert.equal(res.status, 200, url);
  }
  const o = db.prepare("SELECT o.* FROM orders o JOIN order_items i ON i.order_id = o.id JOIN products p ON p.id = i.product_id WHERE p.slug = 'buds-pro'").get();
  assert.equal((await fetch(`${base}/admin/orders/${o.id}`, { headers: { cookie } })).status, 200);

  const csrf = await csrfFor(cookie);
  const before = product('buds-pro').stock;
  const noCsrf = await fetch(`${base}/admin/orders/${o.id}/status`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'status=cancelled',
    redirect: 'manual',
  });
  assert.equal(noCsrf.status, 403);

  const ok = await fetch(`${base}/admin/orders/${o.id}/status`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, status: 'cancelled', note: 'test' }),
    redirect: 'manual',
  });
  assert.equal(ok.status, 303);
  assert.equal(product('buds-pro').stock, before + 2);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(o.id).status, 'cancelled');
});

test('admin can create a product with an image', async () => {
  const cookie = await adminCookie();
  const csrf = await csrfFor(cookie);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.set('_csrf', csrf);
  form.set('name', 'حامل هاتف للسيارة');
  form.set('price', '1500');
  form.set('compare_price', '2000');
  form.set('stock', '10');
  form.set('variants', 'أسود، رمادي');
  form.set('active', '1');
  form.append('images', new Blob([png], { type: 'image/png' }), 'holder.png');
  const res = await fetch(`${base}/admin/products`, { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
  assert.equal(res.status, 303);
  const p = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 1').get();
  assert.equal(p.name, 'حامل هاتف للسيارة');
  assert.equal(p.variants, 'أسود, رمادي');
  const [img] = JSON.parse(p.images);
  assert.match(img, /^\/uploads\/.+\.png$/);
  assert.equal((await fetch(base + img)).status, 200);
  assert.equal((await fetch(`${base}/p/${encodeURIComponent(p.slug)}`)).status, 200);
});

test('all 69 wilayas are available, including the 2026 ones', async () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wilayas').get().n, 69);
  const html = await (await fetch(`${base}/p/buds-pro`)).text();
  assert.match(html, /69 - الأبيض سيدي الشيخ/);
  assert.match(html, /59 - أفلو/);

  const p = product('charger-25w');
  const res = await order({ ...customer, phone: '0550998877', wilaya: 68, commune: 'بوسعادة', items: [{ product_id: p.id, qty: 1 }] });
  assert.equal(res.status, 200);
  const o = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  assert.equal(o.wilaya_code, 68);
  assert.equal(o.wilaya_name, 'بوسعادة');
});

test('storefront switches to French and remembers it', async () => {
  const res = await fetch(`${base}/p/buds-pro?lang=fr`);
  const html = await res.text();
  assert.match(html, /<html lang="fr" dir="ltr">/);
  assert.match(html, /Écouteurs sans fil Buds Pro/);
  assert.match(html, /Confirmer la commande/);
  assert.match(html, /value="أبيض"[^>]*><span>Blanc<\/span>/);
  assert.match(html, /68 - Bou Saâda/);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.equal(cookie, 'lang=fr');

  const home = await (await fetch(base + '/', { headers: { cookie } })).text();
  assert.match(home, /Les plus demandés/);
  assert.match(home, /href="\/\?lang=ar"/);

  const bad = await order({ customer_name: 'a', phone: '1', wilaya: 16, commune: 'x', items: [] }, { cookie });
  const { errors } = await bad.json();
  assert.match(errors.phone, /^Numéro de téléphone invalide \(ex\.\s:\s0555123456\)$/);
});

test('the dashboard saves French product fields', async () => {
  const cookie = await adminCookie();
  const csrf = await csrfFor(cookie);
  const p = product('clear-case');
  const form = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrf, name: p.name, price: String(p.price), active: '1', name_fr: 'Coque premium', variants: 'أسود, أحمر', variants_fr: 'Noir, Rouge' })) form.set(k, v);
  const res = await fetch(`${base}/admin/products/${p.id}`, { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
  assert.equal(res.status, 303);
  const html = await (await fetch(`${base}/p/clear-case?lang=fr`)).text();
  assert.match(html, /Coque premium/);
  assert.match(html, /<span>Rouge<\/span>/);
});

test('communes API lists the communes of a wilaya, including the 2026 ones', async () => {
  const alger = await (await fetch(`${base}/api/communes/16`)).json();
  assert.equal(alger.length, 57);
  assert.ok(alger.some((c) => c.ar === 'باب الزوار' && c.fr === 'Bab Ezzouar'));
  const bouSaada = await (await fetch(`${base}/api/communes/68`)).json();
  assert.equal(bouSaada.length, 23);
  assert.ok(bouSaada.some((c) => c.fr === 'Bou Saada'));
  assert.equal((await (await fetch(`${base}/api/communes/99`)).json()).length, 0);
});
