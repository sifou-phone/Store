const crypto = require('node:crypto');
const { db, transaction } = require('./db');
const { normalizePhone, toInt, clean, hydrateProduct, RELEASED_STATUSES, ORDER_STATUSES } = require('./util');
const { translator } = require('./i18n');

const MAX_LINES = 20;
const MAX_QTY = 20;

const productById = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
const wilayaByCode = db.prepare('SELECT * FROM wilayas WHERE code = ? AND active = 1');

function normalizeItems(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) list = [];
  const merged = new Map();
  for (const it of list.slice(0, MAX_LINES)) {
    const id = toInt(it && it.product_id);
    const qty = Math.min(Math.max(toInt(it && it.qty, 1), 1), MAX_QTY);
    const variant = clean(it && it.variant, 60);
    if (!id) continue;
    const key = `${id}|${variant}`;
    const prev = merged.get(key);
    merged.set(key, { product_id: id, variant, qty: Math.min((prev ? prev.qty : 0) + qty, MAX_QTY) });
  }
  return [...merged.values()];
}

function shippingFor(wilaya, deliveryType, lines) {
  if (lines.length && lines.every((l) => l.product.free_shipping)) return 0;
  return deliveryType === 'desk' ? wilaya.desk_price : wilaya.home_price;
}

/**
 * Validate a checkout payload against current prices and stock and create the
 * order. Prices sent by the browser are never trusted.
 */
function createOrder(input, ip = '', t = translator('ar'), lang = 'ar') {
  const errors = {};
  const name = clean(input.customer_name, 80);
  const phone = normalizePhone(input.phone);
  const wilaya = wilayaByCode.get(toInt(input.wilaya, 0));
  const commune = clean(input.commune, 80);
  const deliveryType = input.delivery_type === 'desk' ? 'desk' : 'home';
  const address = clean(input.address, 200);
  const notes = clean(input.notes, 500);

  if (name.length < 3) errors.customer_name = t('err_name');
  if (!phone) errors.phone = t('err_phone');
  if (!wilaya) errors.wilaya = t('err_wilaya');
  if (commune.length < 2) errors.commune = t('err_commune');
  if (deliveryType === 'home' && address.length < 4) errors.address = t('err_address');

  const lines = [];
  for (const item of normalizeItems(input.items)) {
    const product = productById.get(item.product_id);
    if (!product) {
      errors.items = t('err_product_gone');
      continue;
    }
    const shown = hydrateProduct(product, lang);
    const variants = product.variants
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    let variant = item.variant;
    if (variants.length) {
      if (!variants.includes(variant)) {
        errors.items = t('err_choose_variant', { label: shown.variant_label, name: shown.name });
        continue;
      }
    } else {
      variant = '';
    }
    if (product.stock != null && product.stock < item.qty) {
      errors.items =
        product.stock > 0
          ? t('err_stock_left', { name: shown.name, n: product.stock })
          : t('err_sold_out', { name: shown.name });
      continue;
    }
    lines.push({ product, variant, qty: item.qty });
  }
  if (!lines.length && !errors.items) errors.items = t('err_cart_empty');

  if (Object.keys(errors).length) return { errors };

  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const shipping = shippingFor(wilaya, deliveryType, lines);
  const total = subtotal + shipping;

  // A double click or a resubmitted form must not create a second order.
  const recent = db
    .prepare(
      `SELECT id, token FROM orders WHERE phone = ? AND total = ?
       AND created_at >= datetime('now', '-5 minutes') ORDER BY id DESC LIMIT 1`
    )
    .get(phone, total);
  if (recent) return { order: recent, duplicate: true };

  const order = transaction(() => {
    const token = crypto.randomBytes(12).toString('base64url');
    const res = db
      .prepare(
        `INSERT INTO orders (token, customer_name, phone, wilaya_code, wilaya_name, commune, address,
          delivery_type, notes, subtotal, shipping, total, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        token, name, phone, wilaya.code, wilaya.name_ar, commune,
        deliveryType === 'home' ? address : '', deliveryType, notes, subtotal, shipping, total, ip
      );
    const orderId = res.lastInsertRowid;
    const insItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, variant, price, qty) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const takeStock = db.prepare(
      'UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL'
    );
    for (const l of lines) {
      insItem.run(orderId, l.product.id, l.product.name, l.variant, l.product.price, l.qty);
      takeStock.run(l.qty, l.product.id);
    }
    db.prepare("INSERT INTO order_history (order_id, status, note) VALUES (?, 'new', 'تم إنشاء الطلب')").run(orderId);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  });

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  return { order, items };
}

function setOrderStatus(orderId, status, note = '') {
  if (!ORDER_STATUSES[status]) throw new Error('bad status');
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return null;
    if (order.status === status && !note) return order;
    const wasReleased = RELEASED_STATUSES.has(order.status);
    const isReleased = RELEASED_STATUSES.has(status);
    if (wasReleased !== isReleased) {
      // Cancelling returns items to stock; reopening takes them again.
      const sign = isReleased ? 1 : -1;
      const upd = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL');
      for (const it of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId)) {
        if (it.product_id) upd.run(sign * it.qty, it.product_id);
      }
    }
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, orderId);
    db.prepare('INSERT INTO order_history (order_id, status, note) VALUES (?, ?, ?)').run(orderId, status, clean(note, 300));
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  });
}

module.exports = { createOrder, setOrderStatus, normalizeItems };
