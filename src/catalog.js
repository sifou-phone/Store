// Products the owner asked to add to the live store. Each one is inserted once
// (remembered in settings), so editing or deleting it from the dashboard sticks.

const PRODUCTS = [
  {
    slug: 'q69-bear-bag-earbuds',
    cat: 'audio',
    price: 3900,
    compare_price: 5500,
    stock: 30,
    featured: 1,
    images: [1, 2, 3].map((n) => `/img/products/q69-bear-bag-${n}.webp`),
    name: 'سماعات لاسلكية Q69 مع حقيبة الدبدوب',
    short_desc: 'سماعات بلوتوث 5.3 بصوت Extra Bass داخل علبة شحن على شكل حقيبة يد أنيقة بسلسلة ودبدوب لامع.',
    description:
      'سماعات أذن لاسلكية بتصميم مفتوح مريح يثبت على الأذن، تأتي داخل علبة شحن على شكل حقيبة يد صغيرة بسلسلة ذهبية وشعار دبدوب مرصّع.\n' +
      'هدية مثالية للبنات: تُعلّق على الحقيبة أو تُحمل باليد، وتمنحك صوتاً قوياً بباس عميق للموسيقى والمكالمات.\n' +
      'تأتي في علبتها مع كابل الشحن.',
    features:
      'بلوتوث 5.3 باتصال سريع وثابت\nصوت Extra Bass ستيريو\nتصميم مفتوح مريح لا يؤلم الأذن\nعلبة شحن على شكل حقيبة يد بسلسلة\nميكروفون مدمج للمكالمات\nكابل شحن مرفق',
    variant_label: 'اللون',
    variants: 'وردي, أبيض, أسود, برتقالي',
    name_fr: 'Écouteurs sans fil Q69 avec étui sac ourson',
    short_desc_fr: 'Écouteurs Bluetooth 5.3 Extra Bass dans un étui de charge en forme de mini sac à main avec chaîne et ourson strass.',
    description_fr:
      'Écouteurs sans fil à design ouvert et confortable, rangés dans un étui de charge en forme de mini sac à main avec chaîne dorée et ourson en strass.\n' +
      'Le cadeau idéal : à accrocher au sac ou à porter à la main, avec un son puissant aux basses profondes pour la musique et les appels.\n' +
      'Livrés dans leur boîte avec câble de charge.',
    features_fr:
      'Bluetooth 5.3 rapide et stable\nSon stéréo Extra Bass\nDesign ouvert confortable\nÉtui de charge mini sac à main avec chaîne\nMicro intégré pour les appels\nCâble de charge inclus',
    variant_label_fr: 'Couleur',
    variants_fr: 'Rose, Blanc, Noir, Orange',
  },
];

// Offers the owner asked for: `qty` pieces for `price` in total, plus the single
// price, the struck-through price, free delivery and free exchange.
const OFFERS = [
  { slug: 'q69-bear-bag-earbuds', qty: 2, price: 6500, unit: 3900, compare: 5500, free_shipping: 1, free_exchange: 1 },
];

module.exports = { PRODUCTS, OFFERS };
