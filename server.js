const path = require('node:path');
const express = require('express');
const { getSettings, UPLOAD_DIR } = require('./src/db');
const { ensureAdminPassword } = require('./src/auth');
const { formatPrice, formatDate, ORDER_STATUSES } = require('./src/util');
const { icon } = require('./src/icons');

ensureAdminPassword();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', process.env.TRUST_PROXY === '0' ? false : 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));

app.use((req, res, next) => {
  const settings = getSettings();
  res.locals.settings = settings;
  res.locals.price = (v) => formatPrice(v, settings.currency);
  res.locals.formatDate = formatDate;
  res.locals.STATUSES = ORDER_STATUSES;
  res.locals.icon = icon;
  // Safe to embed inside <script type="application/json">.
  res.locals.json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  res.locals.waLink = settings.whatsapp
    ? `https://wa.me/${settings.whatsapp.replace(/\D/g, '').replace(/^0/, '213')}`
    : '';
  res.locals.path = req.path;
  res.locals.baseUrl = `${req.protocol}://${req.get('host')}`;
  next();
});

app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/shop'));

app.use((req, res) => {
  res.status(404).render('shop/404', { title: 'الصفحة غير موجودة' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة كبير جداً (الحد 5 ميغابايت)' : 'حدث خطأ غير متوقع';
  res.status(err.status || 500).render('shop/404', { title: 'خطأ', message });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Sifou Phone store running on http://localhost:${port}`));
}

module.exports = app;
