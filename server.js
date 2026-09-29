require('./src/preflight');
const path = require('node:path');
const express = require('express');
const { db, getSettings, UPLOAD_DIR } = require('./src/db');
const { ensureAdminPassword } = require('./src/auth');
const { formatPrice, formatDate, ORDER_STATUSES } = require('./src/util');
const { icon } = require('./src/icons');
const { LANGS, translator, localize, clientStrings } = require('./src/i18n');

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

// Lightweight endpoint for the host's health check and uptime monitors.
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
// Product photos: stored in the database; older ones may still be files on disk.
app.get('/uploads/:name', (req, res, next) => {
  const row = db.prepare('SELECT mime, data FROM media WHERE name = ?').get(req.params.name);
  if (!row) return next();
  res.set({ 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(Buffer.from(row.data));
});
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));

// Storefront language: ?lang=fr|ar switches it and is remembered in a cookie.
// The owner dashboard is always Arabic.
function pickLanguage(req, res) {
  if (req.path.startsWith('/admin')) return 'ar';
  const q = String(req.query.lang || '');
  if (LANGS.includes(q)) {
    res.cookie('lang', q, { maxAge: 365 * 864e5, sameSite: 'lax', path: '/' });
    return q;
  }
  const m = /(?:^|;\s*)lang=(ar|fr)(?:;|$)/.exec(req.headers.cookie || '');
  return m ? m[1] : 'ar';
}

app.use((req, res, next) => {
  const settings = getSettings();
  const lang = pickLanguage(req, res);
  const other = lang === 'fr' ? 'ar' : 'fr';
  const switchUrl = new URL(req.originalUrl, 'http://x');
  switchUrl.searchParams.set('lang', other);

  res.locals.lang = lang;
  res.locals.dir = lang === 'fr' ? 'ltr' : 'rtl';
  res.locals.t = translator(lang);
  res.locals.loc = localize(lang);
  res.locals.clientStrings = clientStrings(lang);
  res.locals.langSwitch = { lang: other, url: switchUrl.pathname + switchUrl.search };
  res.locals.settings = settings;
  res.locals.price = (v) => formatPrice(v, settings.currency, lang);
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
  res.status(404).render('shop/404', { title: res.locals.t('not_found_title') });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  // The failure happened before page helpers were set up (e.g. the database is
  // unreachable): answer with plain text instead of crashing the error page.
  if (!res.locals.settings) {
    return res.status(500).type('text/plain; charset=utf-8').send('حدث خطأ مؤقت، الرجاء إعادة المحاولة بعد قليل.\nTemporary error, please try again shortly.');
  }
  const t = res.locals.t || translator('ar');
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة كبير جداً (الحد 5 ميغابايت)' : t('error_unexpected');
  res.status(err.status || 500).render('shop/404', { title: t('error_title'), message });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  // HOST=127.0.0.1 keeps the app private behind a reverse proxy (see deploy/install.sh).
  app.listen(port, process.env.HOST || undefined, () => console.log(`Sifou Phone store running on http://localhost:${port}`));
}

module.exports = app;
