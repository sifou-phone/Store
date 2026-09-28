const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { WILAYAS } = require('./wilayas');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'store.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price INTEGER NOT NULL,
  compare_price INTEGER,
  stock INTEGER,
  short_desc TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL DEFAULT '',
  variant_label TEXT NOT NULL DEFAULT 'اللون',
  variants TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  free_shipping INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wilayas (
  code INTEGER PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  home_price INTEGER NOT NULL,
  desk_price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  wilaya_code INTEGER NOT NULL,
  wilaya_name TEXT NOT NULL,
  commune TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('home', 'desk')),
  notes TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_note TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const DEFAULT_SETTINGS = {
  store_name: 'Sifou Phone',
  tagline: 'هواتف وإكسسوارات أصلية بأفضل الأسعار',
  announcement: 'الدفع عند الاستلام • التوصيل إلى 58 ولاية',
  phone: '',
  whatsapp: '',
  facebook: '',
  instagram: '',
  tiktok: '',
  address: '',
  currency: 'دج',
  fb_pixel_id: '',
  telegram_token: '',
  telegram_chat_id: '',
  policy_text:
    'يمكنك فحص المنتج عند الاستلام قبل الدفع.\nفي حال وجود عيب مصنعي، يتم الاستبدال خلال 7 أيام من تاريخ الاستلام.\nتكاليف الإرجاع بسبب تغيير الرأي على حساب الزبون.',
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getSetting(key) {
  const row = getSettingStmt.get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

function setSetting(key, value) {
  setSettingStmt.run(key, value == null ? '' : String(value));
}

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (isPublicKey(row.key)) out[row.key] = row.value;
  }
  return out;
}

// Secrets never reach templates through getSettings().
function isPublicKey(key) {
  return !['admin_hash', 'session_secret'].includes(key);
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM wilayas').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO wilayas (code, name_ar, name_fr, home_price, desk_price) VALUES (?, ?, ?, ?, ?)'
    );
    transaction(() => WILAYAS.forEach((w) => ins.run(...w)));
  }

  if (getSettingStmt.get('seeded')) return;
  setSetting('seeded', '1');
  if (process.env.SEED_DEMO === '0') return;

  const cats = [
    ['هواتف ذكية', 'phones'],
    ['سماعات', 'audio'],
    ['شواحن وكوابل', 'chargers'],
    ['أغلفة وحماية', 'cases'],
    ['ساعات ذكية', 'watches'],
  ];
  const insCat = db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)');
  const catId = {};
  cats.forEach(([name, slug], i) => {
    catId[slug] = insCat.run(name, slug, i).lastInsertRowid;
  });

  const demo = [
    {
      name: 'هاتف ذكي Nova X12 بذاكرة 128 جيغا',
      slug: 'nova-x12',
      cat: 'phones',
      price: 32900,
      compare: 36500,
      stock: 12,
      short: 'شاشة 6.6 بوصة، بطارية 5000 ملي أمبير وكاميرا 50 ميغابكسل.',
      desc: 'هاتف أنيق بأداء سريع للاستعمال اليومي، الألعاب الخفيفة والتصوير.\nيأتي في علبته الأصلية مع الشاحن وضمان 12 شهراً.',
      features: 'ذاكرة 128 جيغا + رام 6 جيغا\nشاشة 6.6 بوصة 90 هرتز\nبطارية 5000 ملي أمبير مع شحن سريع\nكاميرا خلفية 50 ميغابكسل\nضمان 12 شهراً',
      variants: 'أسود, أزرق, فضي',
      img: 'phone',
      featured: 1,
    },
    {
      name: 'سماعات لاسلكية Buds Pro',
      slug: 'buds-pro',
      cat: 'audio',
      price: 3900,
      compare: 5500,
      stock: 40,
      short: 'عزل للضوضاء، صوت نقي وبطارية تدوم حتى 24 ساعة مع العلبة.',
      desc: 'سماعات بلوتوث 5.3 مريحة للأذن، مثالية للرياضة والمكالمات.\nاقتران تلقائي مع الهاتف بمجرد فتح العلبة.',
      features: 'بلوتوث 5.3 باتصال ثابت\nعزل نشط للضوضاء\n24 ساعة تشغيل مع العلبة\nمقاومة للعرق والرذاذ\nميكروفون مدمج للمكالمات',
      variants: 'أبيض, أسود',
      img: 'buds',
      featured: 1,
    },
    {
      name: 'شاحن سريع 25 واط مع كابل Type-C',
      slug: 'charger-25w',
      cat: 'chargers',
      price: 2200,
      compare: 2900,
      stock: 60,
      short: 'اشحن هاتفك من 0 إلى 50% في 30 دقيقة فقط.',
      desc: 'شاحن جداري بتقنية الشحن السريع PD متوافق مع أغلب الهواتف الحديثة.\nيحمي البطارية من الحرارة الزائدة والشحن الزائد.',
      features: 'قدرة 25 واط PD\nكابل Type-C بطول 1 متر\nحماية من الحرارة والشحن الزائد\nمتوافق مع أغلب الهواتف',
      variants: '',
      img: 'charger',
      featured: 1,
    },
    {
      name: 'غلاف حماية شفاف مضاد للصدمات',
      slug: 'clear-case',
      cat: 'cases',
      price: 900,
      compare: 1300,
      stock: 100,
      short: 'حماية كاملة للزوايا مع الحفاظ على شكل هاتفك الأصلي.',
      desc: 'غلاف سيليكون شفاف لا يصفرّ مع الوقت، بزوايا معززة ضد السقوط.\nاذكر موديل هاتفك في الملاحظات عند الطلب.',
      features: 'زوايا مقواة ضد الصدمات\nشفاف ولا يصفرّ\nحواف بارزة لحماية الكاميرا والشاشة\nخفيف ونحيف',
      variants: '',
      img: 'case',
      featured: 0,
    },
    {
      name: 'ساعة ذكية Fit Watch 3',
      slug: 'fit-watch-3',
      cat: 'watches',
      price: 5900,
      compare: 7900,
      stock: 25,
      short: 'تتبع الخطوات، النبض والنوم مع إشعارات الهاتف على معصمك.',
      desc: 'ساعة رياضية بشاشة ملونة واضحة تحت الشمس، وبطارية تدوم أسبوعاً كاملاً.\nمتوافقة مع أندرويد وآيفون.',
      features: 'شاشة 1.8 بوصة ملونة\nقياس نبض القلب والأكسجين\nإشعارات المكالمات والرسائل\nبطارية حتى 7 أيام\nمقاومة للماء IP67',
      variants: 'أسود, وردي, أخضر',
      img: 'watch',
      featured: 1,
    },
    {
      name: 'باور بنك 20000 ملي أمبير',
      slug: 'powerbank-20000',
      cat: 'chargers',
      price: 4200,
      compare: null,
      stock: 30,
      short: 'اشحن هاتفك 4 مرات كاملة أينما كنت.',
      desc: 'بطارية متنقلة بسعة كبيرة ومنفذين للشحن المتزامن، مع مؤشر رقمي للنسبة المتبقية.',
      features: 'سعة 20000 ملي أمبير\nمنفذ USB + منفذ Type-C\nشحن سريع 22.5 واط\nشاشة رقمية للنسبة',
      variants: '',
      img: 'powerbank',
      featured: 0,
    },
  ];
  const insProd = db.prepare(`INSERT INTO products
    (name, slug, category_id, price, compare_price, stock, short_desc, description, features, variants, images, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  transaction(() => {
    for (const p of demo) {
      insProd.run(
        p.name, p.slug, catId[p.cat], p.price, p.compare, p.stock, p.short, p.desc,
        p.features, p.variants, JSON.stringify([`/img/demo/${p.img}.svg`]), p.featured
      );
    }
  });
}

seed();

module.exports = { db, getSetting, setSetting, getSettings, transaction, UPLOAD_DIR, DATA_DIR };
