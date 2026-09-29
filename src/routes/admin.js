const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, getSetting, setSetting, transaction, UPLOAD_DIR } = require('../db');
const auth = require('../auth');
const { sendTelegram } = require('../notify');
const { setOrderStatus } = require('../orders');
const {
  ORDER_STATUSES, hydrateProduct, parseImages, slugify, toInt, clean, rateLimiter, formatDate,
} = require('../util');

const router = express.Router();
const loginLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
// Photos are kept in the database (table media) so they survive hosts whose
// disk is wiped on restart, and are included in every database backup.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, Boolean(IMAGE_TYPES[file.mimetype])),
});

const PER_PAGE = 30;

// ---------------------------------------------------------------- login
router.get('/login', (req, res) => {
  res.render('admin/login', { title: 'تسجيل الدخول', error: null, next: clean(req.query.next, 200) });
});

router.post('/login', (req, res) => {
  const next = clean(req.body.next, 200);
  const safeNext = next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
  if (!loginLimit(req.ip)) {
    return res.status(429).render('admin/login', { title: 'تسجيل الدخول', error: 'محاولات كثيرة، حاول بعد 15 دقيقة', next });
  }
  if (!auth.verifyPassword(req.body.password || '', getSetting('admin_hash'))) {
    return res.status(401).render('admin/login', { title: 'تسجيل الدخول', error: 'كلمة المرور غير صحيحة', next });
  }
  auth.login(req, res);
  res.redirect(303, safeNext);
});

router.use(auth.requireAdmin);

router.post('/logout', auth.verifyCsrf, (req, res) => {
  auth.logout(req, res);
  res.redirect(303, '/admin/login');
});

router.use((req, res, next) => {
  res.locals.path = req.path;
  res.locals.newCount = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").get().n;
  res.locals.lastOrderId = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM orders').get().n;
  res.locals.defaultPassword = getSetting('admin_default_pw') === '1';
  res.locals.flash = req.query.ok ? String(req.query.ok) : null;
  next();
});

// Everything below that changes data needs the CSRF token. Multipart forms
// verify it after multer has parsed the body.
router.use((req, res, next) => {
  if (req.method !== 'POST' || req.is('multipart/form-data')) return next();
  auth.verifyCsrf(req, res, next);
});

// ------------------------------------------------------------ dashboard
router.get('/', (req, res) => {
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  const stats = {
    today: count("SELECT COUNT(*) AS n FROM orders WHERE date(created_at, '+1 hour') = date('now', '+1 hour')"),
    pending: count("SELECT COUNT(*) AS n FROM orders WHERE status IN ('new', 'no_answer', 'confirmed')"),
    shipping: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'shipped'"),
    revenue: count("SELECT COALESCE(SUM(total - shipping), 0) AS n FROM orders WHERE status = 'delivered' AND created_at >= datetime('now', '-30 days')"),
    delivered30: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'delivered' AND created_at >= datetime('now', '-30 days')"),
    all30: count("SELECT COUNT(*) AS n FROM orders WHERE created_at >= datetime('now', '-30 days') AND status != 'new'"),
    products: count('SELECT COUNT(*) AS n FROM products WHERE active = 1'),
    lowStock: db.prepare('SELECT id, name, stock FROM products WHERE active = 1 AND stock IS NOT NULL AND stock <= 3 ORDER BY stock').all(),
  };
  const days = db
    .prepare(
      `SELECT date(created_at, '+1 hour') AS d, COUNT(*) AS n FROM orders
       WHERE created_at >= datetime('now', '-14 days') GROUP BY d`
    )
    .all();
  const byDay = Object.fromEntries(days.map((r) => [r.d, r.n]));
  const chart = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() + 3600e3 - i * 864e5).toISOString().slice(0, 10);
    chart.push({ d, n: byDay[d] || 0 });
  }
  const topProducts = db
    .prepare(
      `SELECT oi.name, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status NOT IN ('cancelled', 'returned') AND o.created_at >= datetime('now', '-30 days')
       GROUP BY oi.name ORDER BY qty DESC LIMIT 5`
    )
    .all();
  const recent = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 8').all();
  res.render('admin/dashboard', { title: 'لوحة التحكم', stats, chart, topProducts, recent });
});

// Polled by the admin pages to announce new orders.
router.get('/api/new-orders', (req, res) => {
  const since = toInt(req.query.since, 0);
  const rows = db.prepare('SELECT id, customer_name, total FROM orders WHERE id > ? ORDER BY id').all(since);
  res.json({ newCount: res.locals.newCount, lastId: res.locals.lastOrderId, orders: rows });
});

// --------------------------------------------------------------- orders
function orderFilters(query) {
  const where = [];
  const args = [];
  if (query.status && ORDER_STATUSES[query.status]) {
    where.push('status = ?');
    args.push(query.status);
  }
  const q = clean(query.q, 60);
  if (q) {
    where.push('(phone LIKE ? OR customer_name LIKE ? OR CAST(id AS TEXT) = ?)');
    args.push(`%${q.replace(/\s/g, '')}%`, `%${q}%`, q.replace(/^#/, ''));
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args, q };
}

router.get('/orders', (req, res) => {
  const f = orderFilters(req.query);
  const page = Math.max(toInt(req.query.page, 1), 1);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${f.sql}`).get(...f.args).n;
  const orders = db
    .prepare(`SELECT * FROM orders ${f.sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...f.args, PER_PAGE, (page - 1) * PER_PAGE);
  const itemsStmt = db.prepare('SELECT name, variant, qty FROM order_items WHERE order_id = ?');
  for (const o of orders) o.items = itemsStmt.all(o.id);
  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n])
  );
  res.render('admin/orders', {
    title: 'الطلبات',
    orders,
    counts,
    status: req.query.status || '',
    q: f.q,
    page,
    pages: Math.max(Math.ceil(total / PER_PAGE), 1),
    total,
  });
});

router.get('/orders.csv', (req, res) => {
  const f = orderFilters(req.query);
  const orders = db.prepare(`SELECT * FROM orders ${f.sql} ORDER BY id DESC`).all(...f.args);
  const itemsStmt = db.prepare('SELECT name, variant, qty FROM order_items WHERE order_id = ?');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['رقم', 'التاريخ', 'الاسم', 'الهاتف', 'رمز الولاية', 'الولاية', 'البلدية', 'العنوان', 'نوع التوصيل', 'المنتجات', 'المجموع الفرعي', 'التوصيل', 'المجموع', 'الحالة', 'ملاحظات'];
  const rows = orders.map((o) => [
    o.id, formatDate(o.created_at), o.customer_name, o.phone, o.wilaya_code, o.wilaya_name, o.commune,
    o.address, o.delivery_type === 'desk' ? 'مكتب' : 'منزل',
    itemsStmt.all(o.id).map((i) => `${i.name}${i.variant ? ` (${i.variant})` : ''} x${i.qty}`).join(' | '),
    o.subtotal, o.shipping, o.total, ORDER_STATUSES[o.status]?.label || o.status, o.notes,
  ]);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
  res.send('﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n'));
});

router.get('/orders/:id', (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(toInt(req.params.id, 0));
  if (!order) return next();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const history = db.prepare('SELECT * FROM order_history WHERE order_id = ? ORDER BY id DESC').all(order.id);
  const previous = db
    .prepare("SELECT id, status, total, created_at FROM orders WHERE phone = ? AND id != ? ORDER BY id DESC LIMIT 10")
    .all(order.phone, order.id);
  const wilaya = db.prepare('SELECT * FROM wilayas WHERE code = ?').get(order.wilaya_code);
  res.render('admin/order', { title: `الطلب #${order.id}`, order, items, history, previous, wilaya, print: req.query.print === '1' });
});

router.post('/orders/:id/status', (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!ORDER_STATUSES[req.body.status]) return res.status(400).send('حالة غير صالحة');
  setOrderStatus(id, req.body.status, req.body.note);
  const back = clean(req.body.back, 300);
  res.redirect(303, back.startsWith('/admin/orders') ? back : `/admin/orders/${id}?ok=تم تحديث الحالة`);
});

router.post('/orders/:id/edit', (req, res) => {
  const id = toInt(req.params.id, 0);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).send('غير موجود');
  const shipping = Math.max(toInt(req.body.shipping, order.shipping), 0);
  db.prepare(
    `UPDATE orders SET customer_name = ?, phone = ?, commune = ?, address = ?, admin_note = ?,
     shipping = ?, total = subtotal + ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    clean(req.body.customer_name, 80) || order.customer_name,
    clean(req.body.phone, 20) || order.phone,
    clean(req.body.commune, 80),
    clean(req.body.address, 200),
    clean(req.body.admin_note, 1000),
    shipping,
    shipping,
    id
  );
  res.redirect(303, `/admin/orders/${id}?ok=تم حفظ التعديلات`);
});

router.post('/orders/:id/delete', (req, res) => {
  const id = toInt(req.params.id, 0);
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(id);
  if (order) {
    // Give reserved stock back before removing an order that still held it.
    if (!['cancelled', 'returned'].includes(order.status)) setOrderStatus(id, 'cancelled', 'حذف');
    // Children are removed explicitly: Turso does not enforce ON DELETE CASCADE.
    transaction(() => {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
      db.prepare('DELETE FROM order_history WHERE order_id = ?').run(id);
      db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    });
  }
  res.redirect(303, '/admin/orders?ok=تم حذف الطلب');
});

// ------------------------------------------------------------- products
router.get('/products', (req, res) => {
  const products = db
    .prepare(
      `SELECT p.*, c.name AS category_name,
        (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND o.status NOT IN ('cancelled', 'returned')) AS sold
       FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id DESC`
    )
    .all()
    .map(hydrateProduct);
  res.render('admin/products', { title: 'المنتجات', products });
});

function productForm(res, product, errors = {}) {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort, id').all();
  res.render('admin/product-form', {
    title: product.id ? `تعديل: ${product.name}` : 'منتج جديد',
    product: hydrateProduct(product),
    categories,
    errors,
  });
}

const EMPTY_PRODUCT = {
  name: '', slug: '', category_id: null, price: '', compare_price: '', stock: '', short_desc: '',
  description: '', features: '', variant_label: 'اللون', variants: '', images: '[]', active: 1, featured: 0, free_shipping: 0,
  name_fr: '', short_desc_fr: '', description_fr: '', features_fr: '', variant_label_fr: '', variants_fr: '',
};

router.get('/products/new', (req, res) => productForm(res, { ...EMPTY_PRODUCT }));

router.get('/products/:id/edit', (req, res, next) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(toInt(req.params.id, 0));
  if (!product) return next();
  productForm(res, product);
});

function removeUploads(paths) {
  for (const p of paths) {
    if (!p.startsWith('/uploads/')) continue;
    const name = path.basename(p);
    db.prepare('DELETE FROM media WHERE name = ?').run(name);
    // Photos uploaded by older versions live on disk.
    fs.promises.unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
  }
}

function uniqueSlug(wanted, exceptId) {
  const base = slugify(wanted);
  let slug = base;
  for (let i = 2; db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(slug, exceptId || 0); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

function saveProduct(req, res) {
  const id = toInt(req.params.id, 0);
  const existing = id ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null;
  if (id && !existing) return res.status(404).send('غير موجود');

  const b = req.body;
  const incoming = (req.files || []).map((f) => ({
    name: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${IMAGE_TYPES[f.mimetype]}`,
    mime: f.mimetype,
    data: f.buffer,
  }));
  const uploaded = incoming.map((f) => `/uploads/${f.name}`);
  const kept = parseImages(existing?.images).filter((img) => ![].concat(b.remove_images || []).includes(img));
  let images = [...kept, ...uploaded];
  const main = clean(b.main_image, 300);
  if (main && images.includes(main)) images = [main, ...images.filter((i) => i !== main)];

  const product = {
    ...(existing || EMPTY_PRODUCT),
    name: clean(b.name, 150),
    category_id: toInt(b.category_id),
    price: toInt(b.price),
    compare_price: toInt(b.compare_price),
    stock: toInt(b.stock),
    short_desc: clean(b.short_desc, 300),
    description: clean(b.description, 5000),
    features: clean(b.features, 3000),
    variant_label: clean(b.variant_label, 30) || 'اللون',
    variants: clean(b.variants, 300).replace(/،/g, ','),
    name_fr: clean(b.name_fr, 150),
    short_desc_fr: clean(b.short_desc_fr, 300),
    description_fr: clean(b.description_fr, 5000),
    features_fr: clean(b.features_fr, 3000),
    variant_label_fr: clean(b.variant_label_fr, 30),
    variants_fr: clean(b.variants_fr, 300).replace(/،/g, ','),
    images: JSON.stringify(images),
    active: b.active ? 1 : 0,
    featured: b.featured ? 1 : 0,
    free_shipping: b.free_shipping ? 1 : 0,
  };

  const errors = {};
  if (product.name.length < 2) errors.name = 'اسم المنتج مطلوب';
  if (product.price == null || product.price < 0) errors.price = 'السعر مطلوب';
  if (product.compare_price != null && product.compare_price <= (product.price || 0)) product.compare_price = null;
  if (product.stock != null && product.stock < 0) product.stock = 0;
  if (Object.keys(errors).length) {
    // New photos were only held in memory; nothing to clean up.
    return productForm(res, { ...product, images: existing?.images || '[]', id }, errors);
  }

  // An empty link field keeps the current URL so links already shared in ads keep working.
  product.slug = uniqueSlug(clean(b.slug, 80) || existing?.slug || product.name, id);
  const cols = ['name', 'slug', 'category_id', 'price', 'compare_price', 'stock', 'short_desc', 'description',
    'features', 'variant_label', 'variants', 'images', 'active', 'featured', 'free_shipping',
    'name_fr', 'short_desc_fr', 'description_fr', 'features_fr', 'variant_label_fr', 'variants_fr'];
  const values = cols.map((c) => product[c]);
  const insMedia = db.prepare('INSERT INTO media (name, mime, data) VALUES (?, ?, ?)');
  transaction(() => {
    for (const f of incoming) insMedia.run(f.name, f.mime, f.data);
    if (existing) {
      db.prepare(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
    } else {
      db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...values);
    }
  });
  if (existing) removeUploads(parseImages(existing.images).filter((img) => !images.includes(img)));
  res.redirect(303, '/admin/products?ok=تم حفظ المنتج');
}

const withUpload = [upload.array('images', 10), auth.verifyCsrf];
router.post('/products', withUpload, saveProduct);
router.post('/products/:id', withUpload, saveProduct);

router.post('/products/:id/toggle', (req, res) => {
  db.prepare('UPDATE products SET active = 1 - active WHERE id = ?').run(toInt(req.params.id, 0));
  res.redirect(303, '/admin/products');
});

router.post('/products/:id/delete', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(toInt(req.params.id, 0));
  if (product) {
    transaction(() => {
      db.prepare('UPDATE order_items SET product_id = NULL WHERE product_id = ?').run(product.id);
      db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
    });
    removeUploads(parseImages(product.images));
  }
  res.redirect(303, '/admin/products?ok=تم حذف المنتج');
});

// ----------------------------------------------------------- categories
router.get('/categories', (req, res) => {
  const categories = db
    .prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS n FROM categories c ORDER BY sort, id')
    .all();
  res.render('admin/categories', { title: 'الأقسام', categories });
});

router.post('/categories', (req, res) => {
  const name = clean(req.body.name, 60);
  if (name) {
    let slug = slugify(clean(req.body.slug, 60) || name);
    while (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) slug += '-2';
    db.prepare('INSERT INTO categories (name, name_fr, slug, sort) VALUES (?, ?, ?, ?)')
      .run(name, clean(req.body.name_fr, 60), slug, toInt(req.body.sort, 0));
  }
  res.redirect(303, '/admin/categories?ok=تمت الإضافة');
});

router.post('/categories/:id', (req, res) => {
  const name = clean(req.body.name, 60);
  if (name) {
    db.prepare('UPDATE categories SET name = ?, name_fr = ?, sort = ? WHERE id = ?')
      .run(name, clean(req.body.name_fr, 60), toInt(req.body.sort, 0), toInt(req.params.id, 0));
  }
  res.redirect(303, '/admin/categories?ok=تم الحفظ');
});

router.post('/categories/:id/delete', (req, res) => {
  const id = toInt(req.params.id, 0);
  transaction(() => {
    db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  res.redirect(303, '/admin/categories?ok=تم الحذف');
});

// ------------------------------------------------------------- shipping
router.get('/shipping', (req, res) => {
  const wilayas = db.prepare('SELECT * FROM wilayas ORDER BY code').all();
  res.render('admin/shipping', { title: 'أسعار التوصيل', wilayas });
});

router.post('/shipping', (req, res) => {
  const upd = db.prepare('UPDATE wilayas SET home_price = ?, desk_price = ?, active = ? WHERE code = ?');
  const b = req.body;
  transaction(() => {
    for (const w of db.prepare('SELECT * FROM wilayas').all()) {
      upd.run(
        Math.max(toInt(b[`home_${w.code}`], w.home_price), 0),
        Math.max(toInt(b[`desk_${w.code}`], w.desk_price), 0),
        b[`active_${w.code}`] ? 1 : 0,
        w.code
      );
    }
  });
  res.redirect(303, '/admin/shipping?ok=تم حفظ أسعار التوصيل');
});

// ------------------------------------------------------------- settings
const SETTING_FIELDS = ['store_name', 'tagline', 'announcement', 'phone', 'whatsapp', 'facebook', 'instagram',
  'tiktok', 'address', 'currency', 'fb_pixel_id', 'telegram_token', 'telegram_chat_id', 'policy_text',
  'tagline_fr', 'announcement_fr', 'policy_text_fr'];

router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'الإعدادات', error: req.query.err || null });
});

router.post('/settings', (req, res) => {
  for (const key of SETTING_FIELDS) {
    if (key in req.body) setSetting(key, clean(req.body[key], key.startsWith('policy_text') ? 5000 : 300));
  }
  res.redirect(303, '/admin/settings?ok=تم حفظ الإعدادات');
});

router.post('/settings/password', (req, res) => {
  const { current, password, confirm } = req.body;
  if (!auth.verifyPassword(current || '', getSetting('admin_hash'))) {
    return res.redirect(303, '/admin/settings?err=' + encodeURIComponent('كلمة المرور الحالية غير صحيحة'));
  }
  if (!password || password.length < 8 || password !== confirm) {
    return res.redirect(303, '/admin/settings?err=' + encodeURIComponent('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل ومتطابقة'));
  }
  setSetting('admin_hash', auth.hashPassword(password));
  setSetting('admin_default_pw', '0');
  auth.login(req, res);
  res.redirect(303, '/admin/settings?ok=تم تغيير كلمة المرور');
});

router.post('/settings/telegram-test', async (req, res) => {
  const r = await sendTelegram(`✅ تم ربط إشعارات متجر ${getSetting('store_name')} بنجاح`);
  res.redirect(303, r.ok ? '/admin/settings?ok=تم إرسال رسالة تجريبية' : '/admin/settings?err=' + encodeURIComponent(`فشل الإرسال: ${r.error}`));
});

module.exports = router;
