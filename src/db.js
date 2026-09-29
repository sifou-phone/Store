const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { WILAYAS } = require('./wilayas');
const demo = require('./demo');
const { RemoteDatabase } = require('./remote-db');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Two storage backends with the same synchronous API:
 * - a local SQLite file (node:sqlite) — the default, for a PC or a VPS;
 * - Turso (libSQL) when TURSO_DATABASE_URL is set — for free hosts like Render
 *   whose disk is wiped on every restart. Queries go straight to Turso.
 *   TURSO_MODE=replica opts into a local embedded replica instead; it reads
 *   faster but its write forwarding breaks multi-statement transactions
 *   (InvalidParserState("Init") on COMMIT), so it is not the default.
 */
function openDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url && process.env.DB_DRIVER !== 'libsql') {
    const conn = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'store.db'));
    conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    return { conn, driver: 'sqlite' };
  }
  const Libsql = require('libsql');
  if (!url) return { conn: new Libsql(process.env.DB_FILE || path.join(DATA_DIR, 'store.db')), driver: 'libsql' };
  const opts = { authToken: (process.env.TURSO_AUTH_TOKEN || '').trim() || undefined };
  const cleanUrl = url.trim();

  if (process.env.TURSO_MODE === 'replica') {
    // Local replica: fast reads, writes go to Turso; readYourWrites makes a new
    // order readable right after it is written. Falls back to a direct
    // connection when the replica cannot sync.
    const replicaFile = path.join(DATA_DIR, 'turso-replica.db');
    try {
      const conn = new Libsql(replicaFile, { ...opts, syncUrl: cleanUrl, syncPeriod: 60, readYourWrites: true });
      conn.sync();
      return { conn, driver: 'libsql-replica' };
    } catch (err) {
      console.warn(`[turso] replica sync failed (${err.message}); using a direct connection instead.`);
      for (const f of fs.readdirSync(DATA_DIR)) {
        if (f.startsWith('turso-replica.db')) fs.rmSync(path.join(DATA_DIR, f), { force: true, recursive: true });
      }
    }
  }

  try {
    const conn = new RemoteDatabase(() => new Libsql(cleanUrl, opts));
    conn.prepare('SELECT 1').get();
    return { conn, driver: 'libsql' };
  } catch (err) {
    console.error(
      '\n✖ تعذر الاتصال بقاعدة بيانات Turso. تحقق من TURSO_DATABASE_URL (يبدأ بـ libsql://) و TURSO_AUTH_TOKEN.\n' +
        `✖ Could not connect to Turso (${err.message}). Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.\n`
    );
    throw err;
  }
}

const { conn: db, driver: DB_DRIVER } = openDatabase();

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
CREATE TABLE IF NOT EXISTS media (
  name TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  announcement: 'الدفع عند الاستلام • التوصيل إلى كل الولايات',
  tagline_fr: 'Téléphones et accessoires d’origine au meilleur prix',
  announcement_fr: 'Paiement à la livraison • Livraison dans toutes les wilayas',
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
  policy_text_fr:
    'Vous pouvez vérifier le produit à la réception avant de payer.\nEn cas de défaut de fabrication, l’échange se fait dans les 7 jours suivant la réception.\nLes frais de retour pour changement d’avis sont à la charge du client.',
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
  // Replica write forwarding cannot carry BEGIN/COMMIT; run the steps one by one.
  if (DB_DRIVER === 'libsql-replica') return fn();
  if (DB_DRIVER === 'libsql') return db.transaction(fn)();
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

function columnNames(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

function addColumns(table, defs) {
  const have = columnNames(table);
  for (const [name, def] of Object.entries(defs)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}

// Schema changes for databases created by earlier versions.
function migrate() {
  addColumns('categories', { name_fr: "TEXT NOT NULL DEFAULT ''" });
  addColumns('products', {
    name_fr: "TEXT NOT NULL DEFAULT ''",
    short_desc_fr: "TEXT NOT NULL DEFAULT ''",
    description_fr: "TEXT NOT NULL DEFAULT ''",
    features_fr: "TEXT NOT NULL DEFAULT ''",
    variant_label_fr: "TEXT NOT NULL DEFAULT ''",
    variants_fr: "TEXT NOT NULL DEFAULT ''",
  });

  // New wilayas are added; prices the owner already edited are kept.
  const ins = db.prepare(
    'INSERT OR IGNORE INTO wilayas (code, name_ar, name_fr, home_price, desk_price) VALUES (?, ?, ?, ?, ?)'
  );
  transaction(() => WILAYAS.forEach((w) => ins.run(...w)));

  const announcement = getSettingStmt.get('announcement');
  if (announcement && announcement.value.includes('58 ولاية')) {
    setSetting('announcement', announcement.value.replace('58 ولاية', `${WILAYAS.length} ولاية`));
  }

  // Give the untouched demo catalogue its French text.
  const catFr = db.prepare("UPDATE categories SET name_fr = ? WHERE slug = ? AND name = ? AND name_fr = ''");
  for (const c of demo.CATEGORIES) catFr.run(c.name_fr, c.slug, c.name);
  const prodFr = db.prepare(
    `UPDATE products SET ${demo.FR_FIELDS.map((f) => `${f} = ?`).join(', ')}
     WHERE slug = ? AND name_fr = '' AND (name = ? OR slug = 'nova-x12')`
  );
  for (const p of demo.PRODUCTS) prodFr.run(...demo.FR_FIELDS.map((f) => p[f] || ''), p.slug, p.name);
}

function seed() {
  if (getSettingStmt.get('seeded')) return;
  setSetting('seeded', '1');
  if (process.env.SEED_DEMO === '0') return;

  const insCat = db.prepare('INSERT INTO categories (name, name_fr, slug, sort) VALUES (?, ?, ?, ?)');
  const catId = {};
  demo.CATEGORIES.forEach((c, i) => {
    catId[c.slug] = insCat.run(c.name, c.name_fr, c.slug, i).lastInsertRowid;
  });

  const cols = ['name', 'slug', 'category_id', 'price', 'compare_price', 'stock', 'short_desc', 'description',
    'features', 'variants', 'images', 'featured', ...demo.FR_FIELDS];
  const insProd = db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  transaction(() => {
    for (const p of demo.PRODUCTS) {
      const row = { ...p, category_id: catId[p.cat], images: JSON.stringify([`/img/demo/${p.img}.svg`]) };
      insProd.run(...cols.map((c) => row[c] ?? (demo.FR_FIELDS.includes(c) || c === 'variants' ? '' : null)));
    }
  });
}

migrate();
seed();

module.exports = { db, DB_DRIVER, getSetting, setSetting, getSettings, transaction, UPLOAD_DIR, DATA_DIR };
