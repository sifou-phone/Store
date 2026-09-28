const express = require('express');
const { db } = require('../db');
const { hydrateProduct, rateLimiter, toInt, clean } = require('../util');
const { localize } = require('../i18n');
const { createOrder } = require('../orders');
const { notifyNewOrder } = require('../notify');

const router = express.Router();
const orderLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 8 });

function categories(lang) {
  const loc = localize(lang);
  return db
    .prepare('SELECT * FROM categories ORDER BY sort, id')
    .all()
    .map((c) => ({ ...c, name: loc(c, 'name') }));
}

function wilayas(lang) {
  return db
    .prepare('SELECT code, name_ar, name_fr, home_price, desk_price FROM wilayas WHERE active = 1 ORDER BY code')
    .all()
    .map((w) => ({ code: w.code, name: lang === 'fr' ? w.name_fr : w.name_ar, home_price: w.home_price, desk_price: w.desk_price }));
}

router.use((req, res, next) => {
  res.locals.categories = categories(res.locals.lang);
  res.locals.wilayaCount = db.prepare('SELECT COUNT(*) AS n FROM wilayas WHERE active = 1').get().n;
  next();
});

router.get('/', (req, res) => {
  const featured = db
    .prepare('SELECT * FROM products WHERE active = 1 AND featured = 1 ORDER BY id DESC LIMIT 8')
    .all()
    .map((p) => hydrateProduct(p, res.locals.lang));
  const latest = db
    .prepare('SELECT * FROM products WHERE active = 1 ORDER BY id DESC LIMIT 12')
    .all()
    .map((p) => hydrateProduct(p, res.locals.lang));
  res.render('shop/home', { title: null, featured, latest });
});

router.get('/products', (req, res) => {
  const q = clean(req.query.q, 60);
  const cat = res.locals.categories.find((c) => c.slug === req.query.c);
  const where = ['p.active = 1'];
  const args = [];
  if (cat) {
    where.push('p.category_id = ?');
    args.push(cat.id);
  }
  if (q) {
    where.push('(p.name LIKE ? OR p.short_desc LIKE ? OR p.name_fr LIKE ? OR p.short_desc_fr LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sort = { cheap: 'p.price ASC', expensive: 'p.price DESC' }[req.query.sort] || 'p.id DESC';
  const products = db
    .prepare(`SELECT p.* FROM products p WHERE ${where.join(' AND ')} ORDER BY ${sort}`)
    .all(...args)
    .map((p) => hydrateProduct(p, res.locals.lang));
  res.render('shop/products', {
    title: cat ? cat.name : q ? res.locals.t('search_results', { q }) : res.locals.t('all_products'),
    products,
    currentCat: cat,
    q,
    sort: req.query.sort || '',
  });
});

router.get('/p/:slug', (req, res, next) => {
  const product = hydrateProduct(
    db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug),
    res.locals.lang
  );
  if (!product) return next();
  const category = res.locals.categories.find((c) => c.id === product.category_id) || null;
  const related = db
    .prepare(
      `SELECT * FROM products WHERE active = 1 AND id != ?
       ORDER BY (category_id IS ?) DESC, featured DESC, id DESC LIMIT 4`
    )
    .all(product.id, product.category_id)
    .map((p) => hydrateProduct(p, res.locals.lang));
  res.render('shop/product', {
    title: product.name,
    description: product.short_desc,
    ogImage: product.image,
    product,
    category,
    related,
    wilayas: wilayas(res.locals.lang),
  });
});

router.get('/cart', (req, res) => {
  res.render('shop/cart', { title: res.locals.t('cart_title'), wilayas: wilayas(res.locals.lang) });
});

router.get('/policy', (req, res) => {
  res.render('shop/policy', { title: res.locals.t('policy_title'), wilayas: wilayas(res.locals.lang) });
});

// Current product data for the cart page (cart contents live in localStorage).
router.get('/api/products', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((x) => toInt(x))
    .filter(Boolean)
    .slice(0, 50);
  if (!ids.length) return res.json([]);
  const rows = db
    .prepare(`SELECT * FROM products WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids)
    .map((p) => hydrateProduct(p, res.locals.lang))
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      image: p.image,
      stock: p.stock,
      free_shipping: !!p.free_shipping,
      variants: p.variantList,
      variant_labels: p.variantLabels,
      variant_label: p.variant_label,
    }));
  res.json(rows);
});

router.post('/order', (req, res) => {
  const wantsJson = req.is('application/json');
  const fail = (status, errors) =>
    wantsJson
      ? res.status(status).json({ errors })
      : res.status(status).render('shop/404', {
          title: res.locals.t('order_failed'),
          message: Object.values(errors).join(' — '),
          back: true,
        });

  const body = req.body || {};
  // Honeypot field: humans never see it, bots fill it in.
  if (body.website) return fail(400, { form: res.locals.t('err_generic') });
  if (!orderLimit(req.ip)) {
    return fail(429, { form: res.locals.t('err_too_many') });
  }

  const input = { ...body };
  if (!input.items && input.product_id) {
    input.items = [{ product_id: input.product_id, variant: input.variant, qty: input.qty }];
  }
  const result = createOrder(input, req.ip, res.locals.t, res.locals.lang);
  if (result.errors) return fail(422, result.errors);

  if (!result.duplicate) notifyNewOrder(result.order, result.items, res.locals.baseUrl);
  const redirect = `/order/${result.order.token}`;
  return wantsJson ? res.json({ ok: true, redirect }) : res.redirect(303, redirect);
});

router.get('/order/:token', (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE token = ?').get(req.params.token);
  if (!order) return next();
  const lang = res.locals.lang;
  const items = db
    .prepare(
      `SELECT oi.*, p.name_fr, p.variants AS p_variants, p.variants_fr AS p_variants_fr
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`
    )
    .all(order.id)
    .map((it) => {
      let variant = it.variant;
      if (lang === 'fr' && variant && it.p_variants) {
        const shown = hydrateProduct({ variants: it.p_variants, variants_fr: it.p_variants_fr }, 'fr');
        const i = shown.variantList.indexOf(variant);
        if (i >= 0) variant = shown.variantLabels[i];
      }
      return { ...it, name: localize(lang)(it, 'name'), variant };
    });
  const wilaya = db.prepare('SELECT name_ar, name_fr FROM wilayas WHERE code = ?').get(order.wilaya_code);
  const wilayaName = wilaya ? (lang === 'fr' ? wilaya.name_fr : wilaya.name_ar) : order.wilaya_name;
  res.set('Cache-Control', 'no-store');
  res.render('shop/thanks', { title: res.locals.t('thanks_title'), order, items, wilayaName, noindex: true });
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /order/\nSitemap: ${res.locals.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const base = res.locals.baseUrl;
  const urls = ['/', '/products', ...db.prepare('SELECT slug FROM products WHERE active = 1').all().map((p) => `/p/${p.slug}`)];
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${base}${encodeURI(u)}</loc></url>`)
      .join('\n')}\n</urlset>\n`
  );
});

module.exports = router;
