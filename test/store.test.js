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

let cachedCookie;
async function adminCookie() {
  if (cachedCookie) return cachedCookie;
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=test-password-1',
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  cachedCookie = res.headers.get('set-cookie').split(';')[0];
  return cachedCookie;
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

test('settings keep the Telegram fields and accept links without https', async () => {
  const cookie = await adminCookie();
  const csrf = await csrfFor(cookie);
  const res = await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, telegram_token: ' 123:ABC \n', telegram_chat_id: '555 ', facebook: 'facebook.com/sifouphone' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  const html = await (await fetch(`${base}/admin/settings`, { headers: { cookie } })).text();
  assert.match(html, /name="telegram_token" value="123:ABC"/);
  assert.match(html, /name="telegram_chat_id" value="555"/);
  assert.match(html, /name="facebook" inputmode="url" value="https:\/\/facebook.com\/sifouphone"/);
  assert.doesNotMatch(html, /type="url"/);
});

test('the Facebook domain verification tag is pasted in settings and shown on the shop', async () => {
  const cookie = await adminCookie();
  const csrf = await csrfFor(cookie);
  const res = await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, fb_domain_verification: ' <meta name="facebook-domain-verification" content="ab12cd34ef56gh78" /> ' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  for (const url of ['/', '/p/buds-pro?ad=1']) {
    const html = await (await fetch(base + url)).text();
    assert.match(html, /<meta name="facebook-domain-verification" content="ab12cd34ef56gh78">/, url);
  }
});

test('SITE_URL sends other hosts to the main domain', () => {
  const { spawnSync } = require('node:child_process');
  const script = `
    const app = require('./server');
    const s = app.listen(0, async () => {
      const b = 'http://127.0.0.1:' + s.address().port;
      const r = await fetch(b + '/products?c=x', { redirect: 'manual' });
      const h = await fetch(b + '/healthz');
      console.log(r.status, r.headers.get('location'), h.status);
      s.close(); process.exit(0);
    });`;
  const out = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, SITE_URL: 'https://sifouphone.store/', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sp-site-')) },
    encoding: 'utf8',
  });
  assert.equal(out.stdout.trim(), '301 https://sifouphone.store/products?c=x 200');
});

test('TikTok and Facebook pixels share the shop events', async () => {
  const cookie = await adminCookie();
  const csrf = await csrfFor(cookie);
  await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, tiktok_pixel_id: ' CABC123<x> ', fb_pixel_id: '123 456' }),
    redirect: 'manual',
  });
  const html = await (await fetch(`${base}/p/buds-pro`)).text();
  assert.match(html, /ttq\.load\("CABC123x"\)/);
  assert.match(html, /fbq\('init', "123456"\)/);
  // Meta's automatic events stay off: they sent their own Purchase, without
  // the order's eventID, when the order button was clicked.
  assert.match(html, /fbq\('set', 'autoConfig', false, "123456"\); fbq\('init'/);
  assert.match(html, /spTrack\('ViewContent', \{ ids: \[\d+\], value: \d+ \}\)/);

  await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, tiktok_pixel_id: '', fb_pixel_id: '' }),
    redirect: 'manual',
  });
  const plain = await (await fetch(`${base}/p/buds-pro`)).text();
  assert.doesNotMatch(plain, /spTrack|ttq|fbq/);
});

test('the ad video maker page carries the product data', async () => {
  const cookie = await adminCookie();
  const p = product('buds-pro');
  const res = await fetch(`${base}/admin/products/${p.id}/video`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const html = await res.text();
  const data = JSON.parse(html.match(/<script type="application\/json" id="video-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.slug, 'buds-pro');
  assert.equal(data.ar.price, p.price);
  assert.ok(data.ar.features.length > 0 && data.ar.features.length <= 4);
  assert.equal(data.wilayas, 69);
  assert.match(html, /\/js\/ad-video\.js/);
  assert.equal((await fetch(`${base}/admin/products/999999/video`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${base}/fonts/tajawal-arabic-800.woff2`)).status, 200);
});

test('delivery prices follow the NOEST tariff, and desk orders need a stop desk', async () => {
  const w = (code) => db.prepare('SELECT * FROM wilayas WHERE code = ?').get(code);
  assert.deepEqual([w(16).home_price, w(16).desk_price, w(16).desk_available], [500, 300, 1]);
  assert.deepEqual([w(56).home_price, w(56).desk_available], [2200, 0]);
  assert.deepEqual([w(59).home_price, w(59).desk_available], [w(3).home_price, 0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wilayas WHERE code >= 59 AND desk_available = 1').get().n, 0);
  const p = product('charger-25w');
  const desk = await order({ ...customer, phone: '0551234567', wilaya: 51, commune: 'أولاد جلال', delivery_type: 'desk', address: '', items: [{ product_id: p.id, qty: 1 }] });
  assert.equal(desk.status, 422);
  assert.match((await desk.json()).errors.form, /مكتب/);
  const home = await order({ ...customer, phone: '0551234568', wilaya: 51, commune: 'أولاد جلال', items: [{ product_id: p.id, qty: 1 }] });
  assert.equal(home.status, 200);
  const html = await (await fetch(`${base}/p/buds-pro`)).text();
  assert.match(html, /"code":51,[^}]*"desk":false/);
});

test('a running store gets a new tariff once and keeps later edits', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-tariff-'));
  const run = (code) => spawnSync(process.execPath, ['-e', `const { db, setSetting } = require('./src/db'); ${code}`], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir, SEED_DEMO: '0' }, encoding: 'utf8',
  });
  run(`db.prepare('UPDATE wilayas SET home_price = 999 WHERE code = 16').run(); setSetting('shipping_tariff', 'old');`);
  assert.equal(run(`process.stdout.write(String(db.prepare('SELECT home_price FROM wilayas WHERE code = 16').get().home_price))`).stdout, '500');
  run(`db.prepare('UPDATE wilayas SET home_price = 450 WHERE code = 16').run();`);
  assert.equal(run(`process.stdout.write(String(db.prepare('SELECT home_price FROM wilayas WHERE code = 16').get().home_price))`).stdout, '450');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ad page mode hides store navigation on one product only', async () => {
  const hidden = [/class="cat-nav"/, /class="icon-btn cart-btn"/, /data-add-to-cart/, /class="crumbs"/, /href="\/products\?c=/];
  const normal = await (await fetch(`${base}/p/buds-pro`)).text();
  for (const re of [...hidden, /section-head-spaced/]) assert.match(normal, re);

  // By link: same page, store navigation gone, ordering and contact kept.
  const byLink = await (await fetch(`${base}/p/buds-pro?ad=1`)).text();
  for (const re of [...hidden, /section-head-spaced/]) assert.doesNotMatch(byLink, re);
  assert.match(byLink, /data-submit/);
  assert.match(byLink, /class="faq"/);
  assert.match(byLink, /class="brand"/);
  assert.match(byLink, /name="robots" content="noindex"/);

  // From the dashboard: the switch applies to that product's page only.
  const cookie = await adminCookie();
  const csrf = await csrfFor(cookie);
  const p = product('buds-pro');
  const form = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrf, name: p.name, price: String(p.price), active: '1', ad_mode: '1' })) form.set(k, v);
  const res = await fetch(`${base}/admin/products/${p.id}`, { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(product('buds-pro').ad_mode, 1);
  const edit = await (await fetch(`${base}/admin/products/${p.id}/edit`, { headers: { cookie } })).text();
  assert.match(edit, /name="ad_mode" value="1" checked/);

  const ad = await (await fetch(`${base}/p/buds-pro`)).text();
  for (const re of [...hidden, /section-head-spaced/]) assert.doesNotMatch(ad, re);
  assert.doesNotMatch(ad, /name="robots"/);
  const other = await (await fetch(`${base}/p/clear-case`)).text();
  assert.match(other, /class="cat-nav"/);
  assert.match(await (await fetch(`${base}/`)).text(), /class="icon-btn cart-btn"/);
});

test('orders reach the Meta Conversions API with the same event id as the pixel', async () => {
  const crypto = require('node:crypto');
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const cookie = await adminCookie();
  const csrf = await csrfFor(cookie);
  const save = (fields) => fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, ...fields }),
    redirect: 'manual',
  });
  await save({ fb_pixel_id: '987654321', fb_capi_token: ' EAAtoken123 ', fb_test_event_code: ' TEST42 ' });

  // The token is stored but never printed back, not even on the settings page.
  const settingsHtml = await (await fetch(`${base}/admin/settings`, { headers: { cookie } })).text();
  assert.doesNotMatch(settingsHtml, /EAAtoken123/);
  assert.match(settingsHtml, /محفوظ/);
  assert.doesNotMatch(await (await fetch(`${base}/`)).text(), /EAAtoken123/);

  // An ad click (?fbclid) is remembered in the _fbc cookie by the server.
  const landing = await fetch(`${base}/p/buds-pro?fbclid=IwAR0abcDEF123_xyz`);
  const setCookie = landing.headers.getSetCookie().join('\n');
  assert.match(setCookie, /_fbc=fb\.1\.\d+\.IwAR0abcDEF123_xyz/);
  assert.match(setCookie, /_fbp=fb\.1\.\d+\.\d+/);

  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = (url, opts) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      sent.push({ url: String(url), body: JSON.parse(opts.body) });
      return Promise.resolve(new Response('{"events_received":1}', { status: 200 }));
    }
    return realFetch(url, opts);
  };
  let res;
  try {
    const p = product('buds-pro');
    res = await order({ ...customer, phone: '0661 22 33 44', items: [{ product_id: p.id, qty: 2 }] }, {
      cookie: '_fbp=fb.1.111.222; _fbc=fb.1.333.IwAR0abc',
      'user-agent': 'TestAgent/1.0',
      referer: `${base}/p/buds-pro`,
    });
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(res.status, 200);
  const { redirect } = await res.json();
  const saved = db.prepare('SELECT * FROM orders WHERE token = ?').get(redirect.split('/').pop());

  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.0\/987654321\/events\?access_token=EAAtoken123$/);
  assert.equal(sent[0].body.test_event_code, 'TEST42');
  const ev = sent[0].body.data[0];
  assert.equal(ev.event_name, 'Purchase');
  assert.equal(ev.event_id, `order-${saved.id}`);
  assert.equal(ev.action_source, 'website');
  assert.equal(ev.event_source_url, `${base}/p/buds-pro`);
  assert.deepEqual(ev.user_data.ph, [sha('213661223344')]);
  assert.deepEqual(ev.user_data.country, [sha('dz')]);
  assert.equal(ev.user_data.fbp, 'fb.1.111.222');
  assert.equal(ev.user_data.fbc, 'fb.1.333.IwAR0abc');
  assert.equal(ev.user_data.client_user_agent, 'TestAgent/1.0');
  assert.equal(ev.custom_data.value, saved.total);
  assert.equal(ev.custom_data.currency, 'DZD');
  assert.equal(ev.custom_data.num_items, 2);

  // With the Conversions API on, the server alone reports the Purchase to Meta:
  // the browser pixel skips it (TikTok still gets it), so no order counts twice.
  const thanks = await (await fetch(`${base}${redirect}`)).text();
  assert.ok(thanks.includes(`eventId: "order-${saved.id}"`));
  assert.ok(thanks.includes('fb: false'));
  assert.match(thanks, /if \(window\.fbq && d\.fb !== false\)/);

  // The thanks page sends the Purchase on its first view only: a refresh or a
  // later visit (another browser, cleared storage) never sends it again.
  assert.equal(db.prepare('SELECT purchase_sent FROM orders WHERE id = ?').get(saved.id).purchase_sent, 1);
  const again = await (await fetch(`${base}${redirect}`)).text();
  assert.doesNotMatch(again, /spTrack\('Purchase'/);
  assert.match(again, new RegExp(`order-${saved.id}|#${saved.id}`));

  // Without a token the browser pixel is the only reporter, so it sends the Purchase.
  await save({ fb_capi_clear: '1' });
  db.prepare('UPDATE orders SET purchase_sent = 0 WHERE id = ?').run(saved.id);
  const pixelOnly = await (await fetch(`${base}${redirect}`)).text();
  assert.ok(pixelOnly.includes('fb: true'));

  await save({ fb_pixel_id: '', fb_test_event_code: '', fb_capi_clear: '1' });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'fb_capi_token'").get().value, '');
});

test('the Q69 earbuds get the 2-piece offer at 6,200 DA once', () => {
  const p = product('q69-bear-bag-earbuds');
  assert.equal(p.bundle_qty, 2);
  assert.equal(p.bundle_price, 6200);
  assert.ok(db.prepare("SELECT value FROM settings WHERE key = 'offer_q69-bear-bag-earbuds'").get());
});

test('a bundle offer is priced on the server, across colours, and items add up to the subtotal', async () => {
  const p = product('q69-bear-bag-earbuds');
  db.prepare('UPDATE products SET stock = 50 WHERE id = ?').run(p.id);
  const cases = [
    [[{ variant: 'وردي', qty: 2 }], 6200],
    [[{ variant: 'وردي', qty: 1 }, { variant: 'أبيض', qty: 1 }], 6200],
    [[{ variant: 'أسود', qty: 3 }], 6200 + p.price],
    [[{ variant: 'برتقالي', qty: 1 }], p.price],
  ];
  for (const [lines, expected] of cases) {
    const items = lines.map((l) => ({ product_id: p.id, ...l, price: 1 }));
    const res = await order({ ...customer, phone: `0661${String(Math.random()).slice(2, 8)}`, items });
    assert.equal(res.status, 200);
    const o = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
    assert.equal(o.subtotal, expected);
    const rows = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
    assert.equal(rows.reduce((s, r) => s + r.price * r.qty, 0), expected);
    assert.equal(rows.reduce((s, r) => s + r.qty, 0), lines.reduce((s, l) => s + l.qty, 0));
  }
});

test('the product page shows the bundle offer', async () => {
  const html = await (await fetch(`${base}/p/q69-bear-bag-earbuds`)).text();
  assert.match(html, /data-bundle-qty="2"/);
  assert.match(html, /data-bundle-price="6200"/);
  assert.match(html, /6,200/);
  const api = await (await fetch(`${base}/api/products?ids=${product('q69-bear-bag-earbuds').id}`)).json();
  assert.equal(api[0].bundle_qty, 2);
  assert.equal(api[0].bundle_price, 6200);
});

test('the dashboard saves a bundle offer, refuses one that is not cheaper, and clears it', async () => {
  const cookie = await adminCookie();
  const save = async (qty, price, status = 303) => {
    const form = new FormData();
    form.set('_csrf', await csrfFor(cookie));
    form.set('name', 'كابل شحن');
    form.set('slug', 'cable-bundle-test');
    form.set('price', '1000');
    form.set('bundle_qty', qty);
    form.set('bundle_price', price);
    form.set('active', '1');
    const id = product('cable-bundle-test')?.id;
    const res = await fetch(`${base}/admin/products${id ? `/${id}` : ''}`, { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
    assert.equal(res.status, status);
    return { p: product('cable-bundle-test'), html: status === 303 ? '' : await res.text() };
  };
  let { p } = await save('3', '2700');
  assert.equal(p.bundle_qty, 3);
  assert.equal(p.bundle_price, 2700);
  const refused = await save('2', '2500', 200);
  assert.match(refused.html, /سعر العرض/);
  assert.equal(refused.p.bundle_price, 2700);
  ({ p } = await save('', ''));
  assert.equal(p.bundle_qty, 0);
  assert.equal(p.bundle_price, null);
});

test('stylesheet and script links carry a version taken from the file contents', async () => {
  const crypto = require('node:crypto');
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'public', f))).digest('hex').slice(0, 10);
  const html = await (await fetch(`${base}/p/q69-bear-bag-earbuds`)).text();
  assert.ok(html.includes(`/css/style.css?v=${hash('css/style.css')}`));
  assert.ok(html.includes(`/js/shop.js?v=${hash('js/shop.js')}`));
});
