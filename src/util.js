const ORDER_STATUSES = {
  new: { label: 'جديد', tone: 'blue' },
  no_answer: { label: 'لا يرد', tone: 'amber' },
  confirmed: { label: 'مؤكد', tone: 'teal' },
  shipped: { label: 'قيد التوصيل', tone: 'violet' },
  delivered: { label: 'تم التسليم', tone: 'green' },
  cancelled: { label: 'ملغى', tone: 'gray' },
  returned: { label: 'مرتجع', tone: 'red' },
};

// Statuses in which the ordered items are no longer reserved from stock.
const RELEASED_STATUSES = new Set(['cancelled', 'returned']);

function formatPrice(value, currency = 'دج', lang = 'ar') {
  const n = Math.round(Number(value) || 0);
  if (lang === 'fr') return `${n.toLocaleString('fr-FR')} ${currency === 'دج' ? 'DA' : currency}`;
  // Comma grouping keeps the number in one piece inside right-to-left text.
  return `${n.toLocaleString('en-US')} ${currency}`;
}

function slugify(text) {
  const base = String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `p-${Date.now().toString(36)}`;
}

function parseImages(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function splitList(text, sep) {
  return String(text || '')
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Adds display fields to a product row. In French the *_fr columns are used
 * when filled in. Variant values stay canonical (they are what orders store);
 * variantLabels holds what the customer sees.
 */
function hydrateProduct(p, lang = 'ar') {
  if (!p) return p;
  const images = parseImages(p.images);
  const fr = lang === 'fr';
  const pick = (field) => (fr && p[`${field}_fr`] && String(p[`${field}_fr`]).trim() ? p[`${field}_fr`] : p[field]);
  const variantList = splitList(p.variants, ',');
  const variantFr = splitList(p.variants_fr, ',');
  return {
    ...p,
    name: pick('name'),
    short_desc: pick('short_desc'),
    description: pick('description'),
    variant_label: pick('variant_label'),
    imageList: images,
    image: images[0] || '/img/placeholder.svg',
    featureList: splitList(pick('features'), /\r?\n/),
    variantList,
    variantLabels: fr && variantFr.length === variantList.length ? variantFr : variantList,
    inStock: p.stock == null || p.stock > 0,
    bundle: bundleOf(p),
    discount:
      p.compare_price && p.compare_price > p.price
        ? Math.round((1 - p.price / p.compare_price) * 100)
        : 0,
  };
}

/**
 * A product's bundle offer, e.g. 2 pieces for 6,200: { qty, price } or null.
 * The offer only counts when it is cheaper than buying the pieces one by one,
 * and its price splits evenly into whole dinars per piece.
 */
function bundleOf(p) {
  const qty = Number(p && p.bundle_qty) || 0;
  const price = Number(p && p.bundle_price) || 0;
  if (qty < 2 || price <= 0 || price % qty !== 0 || price >= qty * p.price) return null;
  return { qty, price, unit: price / qty, saving: qty * p.price - price };
}

/**
 * Prices order lines [{ product, variant, qty }]. Pieces of the same product
 * count together towards its bundle offer, whatever their variant. Returns the
 * subtotal and the rows to store; a line is split in two when only part of it
 * falls in a bundle, so price × qty of the rows always adds up to the subtotal.
 */
function priceLines(lines) {
  const bundledLeft = new Map();
  for (const l of lines) {
    const b = bundleOf(l.product);
    if (!b) continue;
    const total = lines.filter((x) => x.product.id === l.product.id).reduce((s, x) => s + x.qty, 0);
    if (!bundledLeft.has(l.product.id)) bundledLeft.set(l.product.id, Math.floor(total / b.qty) * b.qty);
  }
  const rows = [];
  for (const l of lines) {
    const b = bundleOf(l.product);
    const left = bundledLeft.get(l.product.id) || 0;
    const inBundle = b ? Math.min(left, l.qty) : 0;
    if (inBundle) {
      bundledLeft.set(l.product.id, left - inBundle);
      rows.push({ product: l.product, variant: l.variant, price: b.unit, qty: inBundle });
    }
    if (l.qty > inBundle) rows.push({ product: l.product, variant: l.variant, price: l.product.price, qty: l.qty - inBundle });
  }
  return { subtotal: rows.reduce((s, r) => s + r.price * r.qty, 0), rows };
}

// Algerian mobile (05/06/07) or landline numbers; accepts +213 / 00213 prefixes.
function normalizePhone(raw) {
  let s = String(raw || '').replace(/[\s.\-()]/g, '');
  s = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (s.startsWith('+213')) s = '0' + s.slice(4);
  else if (s.startsWith('00213')) s = '0' + s.slice(5);
  else if (s.startsWith('213') && s.length === 12) s = '0' + s.slice(3);
  if (/^0[567]\d{8}$/.test(s) || /^0[2-4]\d{7}$/.test(s)) return s;
  return null;
}

function toInt(value, fallback = null) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number.parseInt(String(value).replace(/[\s,]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

// Minimal fixed-window rate limiter kept in memory.
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset < now) hits.delete(key);
  }, windowMs).unref();
  return function check(key) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

function formatDate(sqlDate) {
  if (!sqlDate) return '';
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ar-DZ-u-nu-latn', {
    timeZone: process.env.TZ_DISPLAY || 'Africa/Algiers',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = {
  ORDER_STATUSES,
  RELEASED_STATUSES,
  formatPrice,
  slugify,
  parseImages,
  hydrateProduct,
  bundleOf,
  priceLines,
  normalizePhone,
  toInt,
  clean,
  rateLimiter,
  formatDate,
};
