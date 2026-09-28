const { getSetting } = require('./db');
const { formatPrice } = require('./util');

async function sendTelegram(text) {
  const token = getSetting('telegram_token');
  const chatId = getSetting('telegram_chat_id');
  if (!token || !chatId) return { ok: false, error: 'not_configured' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    return data.ok ? { ok: true } : { ok: false, error: data.description || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function notifyNewOrder(order, items, baseUrl) {
  const cur = getSetting('currency');
  const lines = [
    `🛒 طلب جديد #${order.id}`,
    `👤 ${order.customer_name}`,
    `📞 ${order.phone}`,
    `📍 ${order.wilaya_code} - ${order.wilaya_name} / ${order.commune}`,
    order.delivery_type === 'desk' ? '🏢 توصيل للمكتب' : `🏠 ${order.address || 'توصيل للمنزل'}`,
    '',
    ...items.map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.qty}`),
    '',
    `💰 المجموع: ${formatPrice(order.total, cur)}`,
  ];
  if (order.notes) lines.push(`📝 ${order.notes}`);
  if (baseUrl) lines.push('', `${baseUrl}/admin/orders/${order.id}`);
  sendTelegram(lines.join('\n')).then((r) => {
    if (!r.ok && r.error !== 'not_configured') console.warn('[telegram]', r.error);
  });
}

module.exports = { sendTelegram, notifyNewOrder };
