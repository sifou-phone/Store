const express = require('express');
const { db } = require('../db');
const { hydrateProduct, rateLimiter, toInt, clean } = require('../util');
const { createOrder } = require('../orders');
const { notifyNewOrder } = require('../notify');

const router = express.Router();
const orderLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 8 });

const categories = () => db.prepare('SELECT * FROM categories ORDER BY sort, id').all();
const wilayas = () =>
  db.prepare('SELECT code, name_ar, home_price, desk_price FROM wilayas WHERE active = 1 ORDER BY code').all();

router.use((req, res, next) => {
  res.locals.categories = categories();
  next();
});

router.get('/', (req, res) => {
  const featured = db
    .prepare('SELECT * FROM products WHERE active = 1 AND featured = 1 ORDER BY id DESC LIMIT 8')
    .all()
    .map(hydrateProduct);
  const latest = db
    .prepare('SELECT * FROM products WHERE active = 1 ORDER BY id DESC LIMIT 12')
    .all()
    .map(hydrateProduct);
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
    where.push('(p.name LIKE ? OR p.short_desc LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const sort = { cheap: 'p.price ASC', expensive: 'p.price DESC' }[req.query.sort] || 'p.id DESC';
  const products = db
    .prepare(`SELECT p.* FROM products p WHERE ${where.join(' AND ')} ORDER BY ${sort}`)
    .all(...args)
    .map(hydrateProduct);
  res.render('shop/products', {
    title: cat ? cat.name : q ? `نتائج البحث: ${q}` : 'جميع المنتجات',
    products,
    currentCat: cat,
    q,
    sort: req.query.sort || '',
  });
});

router.get('/p/:slug', (req, res, next) => {
  const product = hydrateProduct(
    db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug)
  );
  if (!product) return next();
  const category = product.category_id
    ? db.prepare('SELECT * FROM categories WHERE id = ?').get(product.category_id)
    : null;
  const related = db
    .prepare(
      `SELECT * FROM products WHERE active = 1 AND id != ?
       ORDER BY (category_id IS ?) DESC, featured DESC, id DESC LIMIT 4`
    )
    .all(product.id, product.category_id)
    .map(hydrateProduct);
  res.render('shop/product', {
    title: product.name,
    description: product.short_desc,
    ogImage: product.image,
    product,
    category,
    related,
    wilayas: wilayas(),
  });
});

router.get('/cart', (req, res) => {
  res.render('shop/cart', { title: 'سلة المشتريات', wilayas: wilayas() });
});

router.get('/policy', (req, res) => {
  res.render('shop/policy', { title: 'سياسة التوصيل والإرجاع', wilayas: wilayas() });
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
    .map(hydrateProduct)
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      image: p.image,
      stock: p.stock,
      free_shipping: !!p.free_shipping,
      variants: p.variantList,
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
          title: 'تعذر إرسال الطلب',
          message: Object.values(errors).join(' — '),
          back: true,
        });

  const body = req.body || {};
  // Honeypot field: humans never see it, bots fill it in.
  if (body.website) return fail(400, { form: 'تعذر إرسال الطلب' });
  if (!orderLimit(req.ip)) {
    return fail(429, { form: 'لقد أرسلت طلبات كثيرة، الرجاء الاتصال بنا هاتفياً' });
  }

  const input = { ...body };
  if (!input.items && input.product_id) {
    input.items = [{ product_id: input.product_id, variant: input.variant, qty: input.qty }];
  }
  const result = createOrder(input, req.ip);
  if (result.errors) return fail(422, result.errors);

  if (!result.duplicate) notifyNewOrder(result.order, result.items, res.locals.baseUrl);
  const redirect = `/order/${result.order.token}`;
  return wantsJson ? res.json({ ok: true, redirect }) : res.redirect(303, redirect);
});

router.get('/order/:token', (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE token = ?').get(req.params.token);
  if (!order) return next();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.set('Cache-Control', 'no-store');
  res.render('shop/thanks', { title: 'تم استلام طلبك', order, items, noindex: true });
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
