// Meta Conversions API: the server reports each new order as a Purchase, so
// sales still count when the browser pixel is blocked (iOS, ad blockers,
// the Facebook in-app browser). The browser sends the same event_id, and Meta
// keeps only one of the two.
const crypto = require('node:crypto');
const { getSetting } = require('./db');

const GRAPH_VERSION = 'v23.0';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (s) => String(s || '').trim().toLowerCase();
// City and region: lowercase with no spaces or punctuation, as Meta asks.
const place = (s) => norm(s).replace(/[\s\p{P}\p{S}]/gu, '');

function purchaseEventId(order) {
  return `order-${order.id}`;
}

function readCookie(header, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header || '');
  return m ? decodeURIComponent(m[1]) : '';
}

// Algerian 05xx… numbers become 2135xx…, the international form Meta matches on.
function e164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('0') ? `213${digits.slice(1)}` : digits;
}

function buildPurchaseEvent({ order, items, wilayaFr, req, now = Date.now() }) {
  const cookie = req.headers.cookie || '';
  const parts = norm(order.customer_name).split(/\s+/).filter(Boolean);
  const phone = e164(order.phone);
  const user = {
    ph: phone ? [sha256(phone)] : undefined,
    external_id: phone ? [sha256(phone)] : undefined,
    fn: parts[0] ? [sha256(parts[0])] : undefined,
    ln: parts.length > 1 ? [sha256(parts.slice(1).join(' '))] : undefined,
    ct: place(order.commune) ? [sha256(place(order.commune))] : undefined,
    st: place(wilayaFr || order.wilaya_name) ? [sha256(place(wilayaFr || order.wilaya_name))] : undefined,
    country: [sha256('dz')],
    client_ip_address: order.ip || req.ip || undefined,
    client_user_agent: req.get('user-agent') || undefined,
    fbp: readCookie(cookie, '_fbp') || undefined,
    fbc: readCookie(cookie, '_fbc') || undefined,
  };
  for (const k of Object.keys(user)) if (user[k] === undefined) delete user[k];

  return {
    event_name: 'Purchase',
    event_time: Math.floor(now / 1000),
    event_id: purchaseEventId(order),
    action_source: 'website',
    event_source_url: req.get('referer') || undefined,
    user_data: user,
    custom_data: {
      currency: 'DZD',
      value: order.total,
      content_type: 'product',
      content_ids: items.map((i) => String(i.product_id)),
      contents: items.map((i) => ({ id: String(i.product_id), quantity: i.qty, item_price: i.price })),
      num_items: items.reduce((s, i) => s + i.qty, 0),
      order_id: String(order.id),
    },
  };
}

async function sendEvents(events) {
  const pixel = getSetting('fb_pixel_id');
  const token = getSetting('fb_capi_token');
  if (!pixel || !token) return { ok: false, error: 'not_configured' };
  const body = { data: events };
  const testCode = getSetting('fb_test_event_code');
  if (testCode) body.test_event_code = testCode;
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, error: data.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Fire and forget: the customer never waits on Meta.
function reportPurchase(args) {
  if (!getSetting('fb_pixel_id') || !getSetting('fb_capi_token')) return Promise.resolve({ ok: false, error: 'not_configured' });
  return sendEvents([buildPurchaseEvent(args)]).then((r) => {
    if (!r.ok) console.warn('[meta capi]', r.error);
    return r;
  });
}

// Visitors who arrive from an ad carry ?fbclid=… once. Keep it in the _fbc
// cookie (and give them an _fbp browser id) from the server, so the order
// can be matched to the ad click even when the pixel script never loads.
function rememberAdClick(req, res) {
  if (!getSetting('fb_pixel_id') || req.method !== 'GET' || req.path.startsWith('/admin')) return;
  const cookie = req.headers.cookie || '';
  const opts = { maxAge: 90 * 864e5, sameSite: 'lax', path: '/', secure: req.secure };
  const fbclid = typeof req.query.fbclid === 'string' ? req.query.fbclid.trim() : '';
  if (fbclid && /^[\w-]{10,500}$/.test(fbclid) && !readCookie(cookie, '_fbc').endsWith(`.${fbclid}`)) {
    res.cookie('_fbc', `fb.1.${Date.now()}.${fbclid}`, opts);
  }
  if (!readCookie(cookie, '_fbp')) {
    res.cookie('_fbp', `fb.1.${Date.now()}.${crypto.randomInt(1e9, 1e10)}`, opts);
  }
}

module.exports = { buildPurchaseEvent, reportPurchase, purchaseEventId, rememberAdClick, sendEvents, e164 };
