// Storefront translations. The owner dashboard stays in Arabic.
const LANGS = ['ar', 'fr'];

const STRINGS = {
  // header / footer
  search_placeholder: ['ابحث عن هاتف، سماعة، شاحن...', 'Rechercher un téléphone, des écouteurs, un chargeur...'],
  search_short: ['ابحث عن منتج...', 'Rechercher un produit...'],
  search: ['بحث', 'Recherche'],
  menu: ['القائمة', 'Menu'],
  cart: ['السلة', 'Panier'],
  all_products: ['كل المنتجات', 'Tous les produits'],
  delivery_returns: ['التوصيل والإرجاع', 'Livraison et retours'],
  switch_lang: ['Français', 'العربية'],
  switch_lang_short: ['FR', 'ع'],
  trust_cod_t: ['الدفع عند الاستلام', 'Paiement à la livraison'],
  trust_cod_d: ['لا تدفع أي شيء مسبقاً', 'Rien à payer à l’avance'],
  trust_ship_t: ['توصيل لكل الولايات', 'Livraison dans toutes les wilayas'],
  trust_ship_d: ['للمنزل أو لمكتب التوصيل', 'À domicile ou au bureau de livraison'],
  trust_inspect_t: ['افحص قبل الدفع', 'Vérifiez avant de payer'],
  trust_inspect_d: ['تأكد من طلبك عند الاستلام', 'Contrôlez votre commande à la réception'],
  trust_guarantee_t: ['منتجات مضمونة', 'Produits garantis'],
  trust_guarantee_d: ['استبدال في حال وجود عيب', 'Échange en cas de défaut'],
  categories: ['الأقسام', 'Catégories'],
  info: ['معلومات', 'Informations'],
  cart_link: ['سلة المشتريات', 'Mon panier'],
  contact: ['تواصل معنا', 'Contactez-nous'],
  whatsapp: ['واتساب', 'WhatsApp'],
  rights: ['جميع الحقوق محفوظة', 'Tous droits réservés'],
  wa_float: ['راسلنا على واتساب', 'Écrivez-nous sur WhatsApp'],

  // home
  hero_eyebrow: ['هواتف • سماعات • شواحن • إكسسوارات', 'Téléphones • Écouteurs • Chargeurs • Accessoires'],
  hero_title_1: ['كل ما يحتاجه هاتفك،', 'Tout pour votre téléphone,'],
  hero_title_2: ['في مكان واحد.', 'au même endroit.'],
  hero_text: ['{tagline}. اطلب الآن وادفع عند الاستلام، مع توصيل سريع إلى باب منزلك.', '{tagline}. Commandez maintenant et payez à la livraison, livré rapidement chez vous.'],
  shop_now: ['تسوّق الآن', 'Découvrir la boutique'],
  ask_whatsapp: ['اسألنا على واتساب', 'Une question ? WhatsApp'],
  n_wilayas: ['{n} ولاية', '{n} wilayas'],
  shop_by_cat: ['تسوّق حسب القسم', 'Acheter par catégorie'],
  best_sellers: ['الأكثر طلباً', 'Les plus demandés'],
  view_all: ['عرض الكل', 'Voir tout'],
  how_title: ['كيف تطلب؟', 'Comment commander ?'],
  step1_t: ['اختر منتجك', 'Choisissez votre produit'],
  step1_d: ['تصفح المنتجات واملأ استمارة الطلب في أقل من دقيقة.', 'Parcourez nos produits et remplissez le formulaire en moins d’une minute.'],
  step2_t: ['نتصل بك للتأكيد', 'Nous vous appelons'],
  step2_d: ['يتصل بك فريقنا لتأكيد الطلب والعنوان.', 'Notre équipe vous appelle pour confirmer la commande et l’adresse.'],
  step3_t: ['استلم وادفع', 'Recevez et payez'],
  step3_d: ['افحص المنتج عند الاستلام ثم ادفع نقداً.', 'Vérifiez le produit à la réception, puis payez en espèces.'],
  new_arrivals: ['وصل حديثاً', 'Nouveautés'],
  no_products_yet: ['لا توجد منتجات بعد.', 'Aucun produit pour le moment.'],

  // product card / listing
  order_now: ['اطلب الآن', 'Commander'],
  view_product: ['عرض المنتج', 'Voir le produit'],
  out_of_stock: ['نفد المخزون', 'Rupture de stock'],
  home: ['الرئيسية', 'Accueil'],
  n_products: ['{n} منتج', '{n} produits'],
  sort_by: ['ترتيب:', 'Trier :'],
  sort_new: ['الأحدث', 'Nouveautés'],
  sort_cheap: ['الأقل سعراً', 'Prix croissant'],
  sort_expensive: ['الأعلى سعراً', 'Prix décroissant'],
  no_match: ['لم نجد منتجات مطابقة.', 'Aucun produit ne correspond à votre recherche.'],
  show_all_products: ['عرض كل المنتجات', 'Voir tous les produits'],
  search_results: ['نتائج البحث: {q}', 'Résultats pour : {q}'],

  // product page
  save_amount: ['وفّر {amount}', 'Économisez {amount}'],
  free_delivery: ['توصيل مجاني', 'Livraison gratuite'],
  delivery_n: ['توصيل لـ {n} ولاية', 'Livraison dans {n} wilayas'],
  low_stock: ['بقي {n} قطع فقط في المخزون', 'Plus que {n} en stock'],
  features: ['المميزات', 'Caractéristiques'],
  description: ['الوصف', 'Description'],
  faq: ['أسئلة شائعة', 'Questions fréquentes'],
  faq1_q: ['كيف أدفع؟', 'Comment payer ?'],
  faq1_a: ['الدفع نقداً عند استلام الطلب فقط، لا نطلب أي دفع مسبق.', 'En espèces, uniquement à la réception de la commande. Aucun paiement à l’avance.'],
  faq2_q: ['كم تستغرق مدة التوصيل؟', 'Quel est le délai de livraison ?'],
  faq2_a: ['عادة من 24 إلى 72 ساعة حسب الولاية، ويتصل بك عون التوصيل قبل الوصول.', 'Généralement 24 à 72 heures selon la wilaya ; le livreur vous appelle avant d’arriver.'],
  faq3_q: ['هل يمكنني فحص المنتج قبل الدفع؟', 'Puis-je vérifier le produit avant de payer ?'],
  faq3_a: ['نعم، يمكنك فحص المنتج عند الاستلام والتأكد من مطابقته لطلبك.', 'Oui, vous pouvez vérifier le produit à la réception et vous assurer qu’il correspond à votre commande.'],
  faq4_q: ['ماذا لو كان المنتج معيباً؟', 'Et si le produit est défectueux ?'],
  faq4_a: ['نستبدله لك دون تكاليف إضافية.', 'Nous l’échangeons sans frais supplémentaires.'],
  read_policy: ['اقرأ سياسة الإرجاع', 'Lire la politique de retour'],
  related: ['قد يعجبك أيضاً', 'Vous aimerez aussi'],
  image_n: ['صورة {n}', 'Image {n}'],

  // order form
  order_form_title: ['اطلب الآن', 'Commander maintenant'],
  delivery_info: ['معلومات التوصيل', 'Informations de livraison'],
  quantity: ['الكمية', 'Quantité'],
  increase: ['زيادة', 'Augmenter'],
  decrease: ['إنقاص', 'Diminuer'],
  full_name: ['الاسم الكامل', 'Nom complet'],
  full_name_ph: ['الاسم واللقب', 'Nom et prénom'],
  phone: ['رقم الهاتف', 'Téléphone'],
  wilaya: ['الولاية', 'Wilaya'],
  choose_wilaya: ['اختر الولاية', 'Choisissez la wilaya'],
  commune: ['البلدية', 'Commune'],
  commune_ph: ['اسم البلدية', 'Nom de la commune'],
  choose_commune: ['اختر البلدية', 'Choisissez la commune'],
  choose_wilaya_first: ['اختر الولاية أولاً', 'Choisissez d’abord la wilaya'],
  commune_other: ['بلدية أخرى (اكتبها)', 'Autre commune (à saisir)'],
  commune_other_ph: ['اكتب اسم البلدية', 'Saisissez le nom de la commune'],
  loading: ['جارٍ التحميل...', 'Chargement...'],
  delivery_method: ['طريقة التوصيل', 'Mode de livraison'],
  home_delivery: ['توصيل للمنزل', 'À domicile'],
  desk_delivery: ['مكتب التوصيل', 'Bureau de livraison'],
  address: ['العنوان', 'Adresse'],
  address_ph: ['الحي، الشارع، رقم المنزل', 'Quartier, rue, numéro'],
  add_note: ['إضافة ملاحظة (اختياري)', 'Ajouter une note (facultatif)'],
  note_ph: ['مثال: موديل الهاتف، وقت مناسب للاتصال...', 'Ex. : modèle du téléphone, heure pour vous appeler...'],
  sum_products: ['المنتجات', 'Produits'],
  sum_shipping: ['التوصيل', 'Livraison'],
  sum_total: ['المجموع', 'Total'],
  confirm_order: ['تأكيد الطلب', 'Confirmer la commande'],
  add_to_cart: ['أضف إلى السلة', 'Ajouter au panier'],
  form_note: ['لن تدفع أي شيء الآن. سنتصل بك لتأكيد الطلب، وتدفع عند استلامه.', 'Vous ne payez rien maintenant. Nous vous appelons pour confirmer, et vous payez à la réception.'],
  free: ['مجاني', 'Gratuit'],
  added_to_cart: ['تمت الإضافة إلى السلة', 'Ajouté au panier'],
  view_cart: ['عرض السلة', 'Voir le panier'],

  // validation (browser and server)
  err_name: ['الرجاء إدخال الاسم الكامل', 'Veuillez saisir votre nom complet'],
  err_phone: ['رقم الهاتف غير صحيح (مثال: 0555123456)', 'Numéro de téléphone invalide (ex. : 0555123456)'],
  err_wilaya: ['اختر الولاية', 'Choisissez la wilaya'],
  err_commune: ['الرجاء إدخال البلدية', 'Veuillez saisir la commune'],
  err_address: ['الرجاء إدخال العنوان', 'Veuillez saisir l’adresse'],
  err_cart_empty: ['السلة فارغة', 'Le panier est vide'],
  err_generic: ['تعذر إرسال الطلب، حاول مجدداً', 'Impossible d’envoyer la commande, veuillez réessayer'],
  err_network: ['تعذر الاتصال بالخادم، تحقق من الإنترنت وحاول مجدداً', 'Connexion impossible. Vérifiez votre connexion internet et réessayez'],
  err_product_gone: ['أحد المنتجات لم يعد متوفراً', 'Un des produits n’est plus disponible'],
  err_choose_variant: ['اختر {label} لـ «{name}»', 'Choisissez : {label} pour « {name} »'],
  err_stock_left: ['الكمية المتوفرة من «{name}» هي {n} فقط', 'Il ne reste que {n} × « {name} »'],
  err_sold_out: ['«{name}» نفد من المخزون', '« {name} » est en rupture de stock'],
  err_too_many: ['لقد أرسلت طلبات كثيرة، الرجاء الاتصال بنا هاتفياً', 'Trop de commandes envoyées, veuillez nous appeler'],
  order_failed: ['تعذر إرسال الطلب', 'Commande non envoyée'],

  // cart
  cart_title: ['سلة المشتريات', 'Mon panier'],
  cart_empty: ['سلتك فارغة حالياً.', 'Votre panier est vide.'],
  browse_products: ['تصفح المنتجات', 'Voir les produits'],
  remove: ['حذف', 'Supprimer'],

  // thank-you page
  thanks_title: ['تم استلام طلبك', 'Commande reçue'],
  thanks_hi: ['شكراً {name}!', 'Merci {name} !'],
  thanks_received: ['تم استلام طلبك رقم {id} بنجاح.', 'Votre commande n° {id} a bien été reçue.'],
  thanks_call: ['سنتصل بك قريباً على الرقم {phone} لتأكيد الطلب.', 'Nous vous appellerons bientôt au {phone} pour la confirmer.'],
  to_home: ['للمنزل', 'À domicile'],
  to_desk: ['مكتب التوصيل', 'Bureau de livraison'],
  shipping_line: ['التوصيل ({type} — {wilaya})', 'Livraison ({type} — {wilaya})'],
  amount_due: ['المبلغ عند الاستلام', 'À payer à la livraison'],
  keep_phone_on: ['الرجاء إبقاء هاتفك مفتوحاً. عدم الرد على اتصال التأكيد قد يؤدي إلى إلغاء الطلب.', 'Gardez votre téléphone allumé : sans réponse à l’appel de confirmation, la commande peut être annulée.'],
  continue_shopping: ['متابعة التسوق', 'Continuer mes achats'],
  contact_us: ['تواصل معنا', 'Nous contacter'],
  wa_order_msg: ['مرحباً، بخصوص طلبي رقم #{id}', 'Bonjour, concernant ma commande n° {id}'],

  // policy
  policy_title: ['سياسة التوصيل والإرجاع', 'Livraison et retours'],
  payment: ['الدفع', 'Paiement'],
  payment_text: ['نعتمد الدفع عند الاستلام فقط: تدفع نقداً لعون التوصيل بعد استلام طلبك وفحصه.', 'Nous acceptons uniquement le paiement à la livraison : vous payez en espèces au livreur après avoir reçu et vérifié votre commande.'],
  returns: ['الإرجاع والاستبدال', 'Retours et échanges'],
  shipping_prices: ['أسعار التوصيل', 'Tarifs de livraison'],

  // errors
  not_found_title: ['الصفحة غير موجودة', 'Page introuvable'],
  not_found_text: ['الصفحة التي تبحث عنها غير موجودة أو تم نقلها.', 'La page que vous cherchez n’existe pas ou a été déplacée.'],
  back_and_fix: ['رجوع وتصحيح المعلومات', 'Revenir et corriger'],
  back_home: ['العودة للرئيسية', 'Retour à l’accueil'],
  error_title: ['خطأ', 'Erreur'],
  error_unexpected: ['حدث خطأ غير متوقع', 'Une erreur inattendue est survenue'],
};

// Strings the storefront script needs in the browser.
const CLIENT_KEYS = ['free', 'choose_wilaya', 'choose_commune', 'choose_wilaya_first', 'commune_other', 'commune_other_ph', 'loading', 'added_to_cart', 'view_cart', 'err_name', 'err_phone', 'err_wilaya',
  'err_commune', 'err_address', 'err_cart_empty', 'err_generic', 'err_network'];

function translator(lang) {
  const i = lang === 'fr' ? 1 : 0;
  return function t(key, vars) {
    const entry = STRINGS[key];
    let s = entry ? entry[i] : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    // French typography: a non-breaking space keeps "!", "?", ":" and quotes on the same line.
    if (i === 1) s = s.replace(/ ([!?:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
    return s;
  };
}

// Picks the French column when the page is in French and it has been filled in.
function localize(lang) {
  return (obj, field) => {
    if (!obj) return '';
    if (lang === 'fr') {
      const fr = obj[`${field}_fr`];
      if (fr && String(fr).trim()) return fr;
    }
    return obj[field] ?? '';
  };
}

function clientStrings(lang) {
  const t = translator(lang);
  return Object.fromEntries(CLIENT_KEYS.map((k) => [k, t(k)]));
}

module.exports = { LANGS, translator, localize, clientStrings };
