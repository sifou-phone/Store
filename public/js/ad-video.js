/* Sifou Phone ad video maker.
 * Builds a short promo video for one product entirely in the browser:
 * frames are drawn on a <canvas>, music and sound effects are synthesised with
 * Web Audio, and MediaRecorder turns both into an MP4 (or WebM) download. */
(function () {
  'use strict';

  var root = document.querySelector('[data-video-maker]');
  if (!root) return;

  var DATA = JSON.parse(document.getElementById('video-data').textContent);
  var canvas = root.querySelector('[data-vm-canvas]');
  var ctx = canvas.getContext('2d');
  var statusEl = root.querySelector('[data-vm-status]');
  var progressEl = root.querySelector('[data-vm-progress]');
  var playBtn = root.querySelector('[data-vm-play]');
  var recordBtn = root.querySelector('[data-vm-record]');

  var GOLD = '#f2b01e';
  var GOLD_LIGHT = '#ffd36b';
  var CREAM = '#f3f1ea';
  var FONT = 'SPVideo, Tajawal, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  // Tajawal ships with the store (public/fonts), so the video looks the same on every computer.
  var FACE_RANGES = {
    arabic: 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200E,U+2010-2011,U+FB50-FDFF,U+FE70-FEFC',
    latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212'
  };

  // Layout per format, in canvas pixels. f scales type and cards.
  var FORMATS = {
    '9:16': { w: 1080, h: 1920, f: 1, brandY: 120, hookY: 300, prodHookY: 1160, prodHook: 760, prodTopY: 640, prodTop: 600, contentY: 1050 },
    '4:5': { w: 1080, h: 1350, f: 0.82, brandY: 80, hookY: 200, prodHookY: 830, prodHook: 590, prodTopY: 420, prodTop: 420, contentY: 700 },
    '1:1': { w: 1080, h: 1080, f: 0.72, brandY: 64, hookY: 160, prodHookY: 655, prodHook: 500, prodTopY: 320, prodTop: 330, contentY: 540 }
  };

  var CUR = { ar: DATA.currency || 'دج', fr: DATA.currency === 'دج' || !DATA.currency ? 'DA' : DATA.currency };
  var TEXT = {
    ar: {
      hook1: function (d) { return d.discount >= 5 ? 'تخفيض ' + d.discount + '% 🔥' : 'جديد عند ' + DATA.store + ' ✨'; },
      cta: 'اطلب الآن',
      save: 'وفّر',
      colors: 'الألوان المتوفرة',
      cod: '💵 الدفع عند الاستلام',
      ship: function (d) { return d.freeShipping ? '🚚 توصيل مجاني' : '🚚 توصيل لـ ' + DATA.wilayas + ' ولاية'; },
      num: 'en-US'
    },
    fr: {
      hook1: function (d) { return d.discount >= 5 ? 'Promo -' + d.discount + '% 🔥' : 'Nouveau chez ' + DATA.store + ' ✨'; },
      cta: 'Commander',
      save: 'Économisez',
      colors: 'Couleurs disponibles',
      cod: '💵 Paiement à la livraison',
      ship: function (d) { return d.freeShipping ? '🚚 Livraison gratuite' : '🚚 Livraison ' + DATA.wilayas + ' wilayas'; },
      num: 'fr-FR'
    }
  };

  var SWATCHES = [
    [/أسود|noir|black/i, '#161616'], [/أبيض|blanc|white/i, '#f4f4f4'], [/أزرق|bleu|blue/i, '#1f5fae'],
    [/أحمر|rouge|red/i, '#c62828'], [/أخضر|vert|green/i, '#2e7d32'], [/وردي|زهري|rose|pink/i, '#e75a8c'],
    [/رمادي|gris|gr[ae]y/i, '#8a8a8a'], [/فضي|argent|silver/i, '#c9ccd1'], [/ذهبي|doré|or\b|gold/i, '#d4af37'],
    [/بنفسجي|violet|purple/i, '#7b3fb2'], [/برتقالي|orange/i, '#ef6c00'], [/أصفر|jaune|yellow/i, '#f5c518'],
    [/بني|marron|brown/i, '#6d4c41'], [/سماوي|turquoise|cyan/i, '#26a6c9']
  ];
  var ICONS = [
    [/بطار|batter|mah/i, '🔋'], [/شريح|sim/i, '📶'], [/راديو|radio|fm\b/i, '📻'], [/مصباح|lampe|torche|flash/i, '🔦'],
    [/شاشة|écran|ecran|screen/i, '📱'], [/كاميرا|caméra|camera|photo/i, '📷'], [/شحن|واط|charge|\bw\b|watt/i, '⚡'],
    [/بلوتوث|bluetooth|tws/i, '🎧'], [/صوت|son|audio|سماع/i, '🔊'], [/ضمان|garantie/i, '🛡️'], [/ماء|eau|water/i, '💧'],
    [/متين|خفيف|solide|léger|durable/i, '💪'], [/ذاكرة|mémoire|memory|go\b|gb/i, '💾'], [/كابل|câble|cable|type-c|usb/i, '🔌']
  ];

  // ---------------------------------------------------------------- helpers
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var prog = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var out3 = function (x) { return 1 - Math.pow(1 - x, 3); };
  var inout = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  var back = function (x) { var c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  var lerp = function (a, b, k) { return a + (b - a) * k; };
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function font(size, weight) { return (weight || 800) + ' ' + Math.round(size) + 'px ' + FONT; }
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrap(text, size, weight, maxW) {
    ctx.font = font(size, weight);
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }
  // Largest size (down to min) at which text fits in maxLines lines.
  function fit(text, size, min, weight, maxW, maxLines) {
    var lines = wrap(text, size, weight, maxW);
    while (lines.length > maxLines && size > min) { size *= 0.92; lines = wrap(text, size, weight, maxW); }
    return { size: size, lines: lines };
  }
  function money(n, lang) { return Number(n).toLocaleString(TEXT[lang].num) + ' ' + CUR[lang]; }
  function iconFor(text) {
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(text)) return ICONS[i][1];
    return '✔️';
  }
  function swatchFor(name) {
    for (var i = 0; i < SWATCHES.length; i++) if (SWATCHES[i][0].test(name)) return SWATCHES[i][1];
    return null;
  }

  // ---------------------------------------------------------------- assets
  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  // Product photos on white get their background removed (flood fill from the
  // edges), so the product floats on the dark set. Others keep a white card.
  function cutout(img) {
    var max = 900, k = Math.min(1, max / Math.max(img.width, img.height));
    var w = Math.round(img.width * k), h = Math.round(img.height * k);
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    var d;
    try { d = g.getImageData(0, 0, w, h); } catch (e) { return { canvas: c, cut: false }; }
    var px = d.data;
    var white = function (i) {
      var r = px[i], gg = px[i + 1], b = px[i + 2];
      return Math.min(r, gg, b) > 232 && Math.max(r, gg, b) - Math.min(r, gg, b) < 20;
    };
    var corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
    if (corners.filter(white).length < 3) return { canvas: c, cut: false };
    var seen = new Uint8Array(w * h), stack = [];
    for (var x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (var y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      var p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      if (!white(p * 4)) continue;
      px[p * 4 + 3] = 0;
      var px0 = p % w, py0 = (p - px0) / w;
      if (px0 > 0) stack.push(p - 1);
      if (px0 < w - 1) stack.push(p + 1);
      if (py0 > 0) stack.push(p - w);
      if (py0 < h - 1) stack.push(p + w);
    }
    // Soften the edge: pixels touching the removed background become half transparent.
    for (var q = 0; q < w * h; q++) {
      if (px[q * 4 + 3] === 0) continue;
      var qx = q % w;
      if ((qx > 0 && px[(q - 1) * 4 + 3] === 0) || (qx < w - 1 && px[(q + 1) * 4 + 3] === 0) ||
          (q >= w && px[(q - w) * 4 + 3] === 0) || (q < w * (h - 1) && px[(q + w) * 4 + 3] === 0)) px[q * 4 + 3] = 140;
    }
    g.putImageData(d, 0, 0);
    // Crop to the visible product.
    var minX = w, minY = h, maxX = 0, maxY = 0;
    for (var i = 0; i < w * h; i++) {
      if (px[i * 4 + 3] > 20) {
        var ix = i % w, iy = (i - ix) / w;
        if (ix < minX) minX = ix; if (ix > maxX) maxX = ix; if (iy < minY) minY = iy; if (iy > maxY) maxY = iy;
      }
    }
    if (maxX <= minX || maxY <= minY) return { canvas: c, cut: false };
    var out = document.createElement('canvas');
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(c, -minX, -minY);
    return { canvas: out, cut: true };
  }

  function loadFonts() {
    if (!window.FontFace || !document.fonts) return Promise.resolve();
    var faces = [];
    ['arabic', 'latin'].forEach(function (subset) {
      [500, 800].forEach(function (w) {
        var face = new FontFace('SPVideo', 'url(/fonts/tajawal-' + subset + '-' + w + '.woff2)', { weight: String(w), unicodeRange: FACE_RANGES[subset] });
        document.fonts.add(face);
        faces.push(face.load().catch(function () { return null; }));
      });
    });
    return Promise.all(faces);
  }

  var assets = null;
  function loadAssets() {
    if (assets) return assets;
    assets = Promise.all([
      loadImage(DATA.image), loadImage('/img/logo.webp'),
      loadFonts()
    ]).then(function (r) {
      var product = r[0] ? cutout(r[0]) : null;
      var grain = document.createElement('canvas'); grain.width = grain.height = 220;
      var gg = grain.getContext('2d'), gd = gg.createImageData(220, 220), rnd = rng(7);
      for (var i = 0; i < gd.data.length; i += 4) { var v = rnd() * 255; gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = v; gd.data[i + 3] = 255; }
      gg.putImageData(gd, 0, 0);
      var shine = document.createElement('canvas');
      if (product) { shine.width = product.canvas.width; shine.height = product.canvas.height; }
      return { product: product, logo: r[1], grain: grain, shine: shine };
    });
    return assets;
  }

  // ---------------------------------------------------------------- options & plan
  var opts = {};
  function readOpts() {
    root.querySelectorAll('[data-vm-opt]').forEach(function (el) {
      opts[el.dataset.vmOpt] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
  }
  function fillDefaults(lang) {
    var d = DATA[lang];
    var set = function (k, v) { root.querySelector('[data-vm-opt="' + k + '"]').value = v; };
    set('hook1', TEXT[lang].hook1(d));
    set('hook2', d.name);
    set('cta', TEXT[lang].cta);
  }

  function buildPlan() {
    var d = DATA[opts.lang];
    var feats = d.features.slice(0, 4);
    var colors = d.colorLabels.slice(0, 4);
    var s = [], t = 0;
    var add = function (name, dur) { s.push({ name: name, a: t, b: t + dur }); t += dur; };
    add('hook', 3.0);
    if (feats.length) add('features', 0.6 + feats.length * 1.15);
    if (colors.length > 1) add('colors', 2.2);
    add('price', 3.0);
    add('cta', 3.4);
    return { scenes: s, duration: t, feats: feats, colors: colors, d: d };
  }
  function scene(plan, name) {
    for (var i = 0; i < plan.scenes.length; i++) if (plan.scenes[i].name === name) return plan.scenes[i];
    return null;
  }
  // Opacity and entrance progress of an element living in [a, b].
  function life(t, a, b, inDur, outDur) {
    inDur = inDur || 0.4; outDur = outDur || 0.3;
    var k = prog(t, a, a + inDur);
    return { k: k, o: Math.min(k, 1 - prog(t, b - outDur, b)) };
  }

  // ---------------------------------------------------------------- drawing
  function drawBackground(t, L, cx, cy, A) {
    var W = L.w, H = L.h;
    ctx.fillStyle = '#090909';
    ctx.fillRect(0, 0, W, H);
    // Warm light behind the product.
    var pulse = 0.85 + 0.15 * Math.sin(t * 2.4);
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.75);
    g.addColorStop(0, 'rgba(242,176,30,' + 0.42 * pulse + ')');
    g.addColorStop(0.35, 'rgba(242,176,30,' + 0.12 * pulse + ')');
    g.addColorStop(1, 'rgba(242,176,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Slow light rays.
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t * 0.12);
    ctx.fillStyle = 'rgba(255,211,107,0.045)';
    for (var i = 0; i < 14; i++) {
      ctx.rotate(Math.PI * 2 / 14);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-60, -H * 1.2); ctx.lineTo(60, -H * 1.2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // Floating bokeh.
    var rnd = rng(42);
    for (var j = 0; j < 30; j++) {
      var bx = rnd() * W, speed = 20 + rnd() * 60, r = (4 + rnd() * 14) * L.f;
      var by = ((rnd() * H - t * speed) % H + H) % H;
      var a = (0.12 + rnd() * 0.25) * (0.6 + 0.4 * Math.sin(t * 2 + j));
      ctx.beginPath(); ctx.arc(bx + Math.sin(t + j) * 10, by, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(242,176,30,' + a + ')'; ctx.fill();
    }
    // Vignette.
    var v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  function drawGrain(t, L, A) {
    ctx.save();
    // A still texture: moving grain looks the same but makes the file far heavier.
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = ctx.createPattern(A.grain, 'repeat');
    ctx.fillRect(0, 0, L.w, L.h);
    ctx.restore();
  }

  function drawProduct(t, L, A, cx, cy, boxH, scale, rot, alpha) {
    if (!A.product) return;
    var img = A.product.canvas;
    var hgt = boxH * scale, wid = hgt * img.width / img.height;
    if (wid > L.w * 0.8 * scale) { wid = L.w * 0.8 * scale; hgt = wid * img.height / img.width; }
    ctx.save();
    ctx.globalAlpha = alpha;
    // Floor shadow.
    var sg = ctx.createRadialGradient(cx, cy + hgt * 0.5, 0, cx, cy + hgt * 0.5, wid * 0.6);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.save(); ctx.translate(cx, cy + hgt * 0.5); ctx.scale(1, 0.18); ctx.beginPath(); ctx.arc(0, 0, wid * 0.6, 0, Math.PI * 2); ctx.restore(); ctx.fill();
    ctx.translate(cx, cy); ctx.rotate(rot * Math.PI / 180);
    // Shine band sweeping across the product every few seconds.
    var sh = A.shine, sctx = sh.getContext('2d');
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, sh.width, sh.height);
    sctx.drawImage(img, 0, 0);
    var cycle = ((t - 0.8) % 3.4 + 3.4) % 3.4, band = clamp(cycle / 0.9);
    if (t > 0.8 && band < 1) {
      var bx = lerp(-sh.width * 0.6, sh.width * 1.6, band);
      var lg = sctx.createLinearGradient(bx - sh.width * 0.25, 0, bx + sh.width * 0.25, sh.height * 0.4);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.5)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.globalCompositeOperation = 'source-atop';
      sctx.fillStyle = lg; sctx.fillRect(0, 0, sh.width, sh.height);
    }
    if (A.product.cut) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 50 * L.f; ctx.shadowOffsetY = 24 * L.f;
      ctx.drawImage(sh, -wid / 2, -hgt / 2, wid, hgt);
    } else {
      var pad = 26 * L.f;
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 50 * L.f; ctx.shadowOffsetY = 20 * L.f;
      rrect(-wid / 2 - pad, -hgt / 2 - pad, wid + pad * 2, hgt + pad * 2, 36 * L.f);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.save(); rrect(-wid / 2, -hgt / 2, wid, hgt, 22 * L.f); ctx.clip();
      ctx.drawImage(sh, -wid / 2, -hgt / 2, wid, hgt); ctx.restore();
    }
    ctx.restore();
  }

  function drawBrand(t, L, A) {
    var o = clamp(prog(t, 0.2, 0.7));
    if (!o) return;
    var size = 78 * L.f, name = String(DATA.store || '').toUpperCase();
    ctx.save();
    ctx.globalAlpha = o;
    ctx.font = font(30 * L.f, 800);
    ctx.direction = 'ltr';
    var spacing = 6 * L.f, tw = 0;
    for (var i = 0; i < name.length; i++) tw += ctx.measureText(name[i]).width + spacing;
    var total = size + 18 * L.f + tw, x = (L.w - total) / 2, y = L.brandY;
    if (A.logo) {
      ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y, size / 2, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(A.logo, x, y - size / 2, size, size); ctx.restore();
    }
    ctx.fillStyle = GOLD; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var cxp = x + size + 18 * L.f;
    for (var j = 0; j < name.length; j++) { ctx.fillText(name[j], cxp, y + 2); cxp += ctx.measureText(name[j]).width + spacing; }
    ctx.restore();
  }

  // Text revealed by a widening clip from the centre.
  function revealText(lines, size, weight, color, cy, k, lineH) {
    ctx.save();
    ctx.font = font(size, weight); ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach(function (line, i) {
      var kk = out3(clamp(k * 1.6 - i * 0.35));
      var w = ctx.measureText(line).width + 40, y = cy + i * lineH;
      ctx.save();
      ctx.beginPath(); ctx.rect(ctx.canvas.width / 2 - (w / 2) * kk, y - size, w * kk, size * 2); ctx.clip();
      ctx.fillText(line, ctx.canvas.width / 2, y + (1 - kk) * size * 0.3);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawHook(t, L, plan, sc) {
    var l1 = life(t, sc.a + 0.25, sc.b, 0.5);
    var l2 = life(t, sc.a + 0.55, sc.b, 0.7);
    if (l1.o <= 0 && l2.o <= 0) return;
    var maxW = L.w * 0.86;
    ctx.save();
    ctx.globalAlpha = l1.o;
    var s1 = fit(opts.hook1, 50 * L.f, 34 * L.f, 500, maxW, 1);
    revealText(s1.lines, s1.size, 500, CREAM, L.hookY, l1.k, s1.size * 1.2);
    ctx.globalAlpha = l2.o;
    var s2 = fit(opts.hook2, 88 * L.f, 52 * L.f, 800, maxW, 2);
    var y2 = L.hookY + s1.size * 0.9 + s2.size * 0.85;
    revealText(s2.lines, s2.size, 800, '#ffffff', y2, l2.k, s2.size * 1.18);
    // Gold underline.
    var uw = Math.min(maxW, 360 * L.f) * out3(prog(t, sc.a + 1.0, sc.a + 1.6));
    var uy = y2 + (s2.lines.length - 1) * s2.size * 1.18 + s2.size * 0.75;
    ctx.fillStyle = GOLD; rrect(L.w / 2 - uw / 2, uy, uw, 8 * L.f, 4 * L.f); ctx.fill();
    ctx.restore();
  }

  function drawFeatures(t, L, plan, sc) {
    var f = L.f, cardH = 104 * f, gap = 22 * f, cardW = Math.min(L.w * 0.82, 860 * f);
    var rtl = opts.lang === 'ar', x0 = (L.w - cardW) / 2;
    plan.feats.forEach(function (text, i) {
      var a = sc.a + 0.35 + i * 1.15;
      var lf = life(t, a, sc.b, 0.45, 0.3);
      if (lf.o <= 0) return;
      var k = back(lf.k), y = L.contentY + i * (cardH + gap);
      ctx.save();
      ctx.globalAlpha = lf.o;
      ctx.translate((rtl ? 1 : -1) * 120 * f * (1 - k), 0);
      rrect(x0, y, cardW, cardH, 26 * f);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
      ctx.lineWidth = 2.5 * f; ctx.strokeStyle = 'rgba(242,176,30,0.75)'; ctx.stroke();
      // Highlight sweep when the card lands.
      var sw = prog(t, a + 0.15, a + 0.75);
      if (sw > 0 && sw < 1) {
        ctx.save(); rrect(x0, y, cardW, cardH, 26 * f); ctx.clip();
        var hx = rtl ? lerp(x0 + cardW, x0 - 200 * f, sw) : lerp(x0 - 200 * f, x0 + cardW, sw);
        var hg = ctx.createLinearGradient(hx, 0, hx + 200 * f, 0);
        hg.addColorStop(0, 'rgba(255,211,107,0)'); hg.addColorStop(0.5, 'rgba(255,211,107,0.25)'); hg.addColorStop(1, 'rgba(255,211,107,0)');
        ctx.fillStyle = hg; ctx.fillRect(x0, y, cardW, cardH); ctx.restore();
      }
      var ic = cardH * 0.72, icx = rtl ? x0 + cardW - cardH / 2 - 6 * f : x0 + cardH / 2 + 6 * f, icy = y + cardH / 2;
      ctx.beginPath(); ctx.arc(icx, icy, ic / 2, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill();
      ctx.font = font(ic * 0.55, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(iconFor(text), icx, icy + 2 * f);
      var maxW = cardW - cardH - 46 * f, size = 40 * f;
      ctx.font = font(size, 800);
      while (ctx.measureText(text).width > maxW && size > 26 * f) { size *= 0.94; ctx.font = font(size, 800); }
      ctx.fillStyle = '#ffffff'; ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.textAlign = rtl ? 'right' : 'left';
      ctx.fillText(text, rtl ? icx - ic / 2 - 22 * f : icx + ic / 2 + 22 * f, icy + 2 * f, maxW);
      ctx.restore();
    });
  }

  function drawColors(t, L, plan, sc) {
    var lf = life(t, sc.a + 0.1, sc.b);
    if (lf.o <= 0) return;
    var f = L.f;
    ctx.save();
    ctx.globalAlpha = lf.o;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = opts.lang === 'ar' ? 'rtl' : 'ltr';
    ctx.font = font(56 * f, 800); ctx.fillStyle = '#ffffff';
    ctx.fillText(TEXT[opts.lang].colors, L.w / 2, L.contentY + 40 * f);
    var n = plan.colors.length, r = 52 * f, gapX = 190 * f, x0 = L.w / 2 - (n - 1) * gapX / 2;
    plan.colors.forEach(function (name, i) {
      var k = back(prog(t, sc.a + 0.3 + i * 0.15, sc.a + 0.75 + i * 0.15));
      var x = x0 + (opts.lang === 'ar' ? n - 1 - i : i) * gapX, y = L.contentY + 200 * f;
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
      var sw = swatchFor(DATA.ar.colors[i] || name) || swatchFor(name);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = sw || 'rgba(255,255,255,0.08)'; ctx.fill();
      ctx.lineWidth = 5 * f; ctx.strokeStyle = GOLD; ctx.stroke();
      ctx.restore();
      ctx.font = font(38 * f, 500); ctx.fillStyle = CREAM;
      ctx.fillText(name, x, y + r + 50 * f);
    });
    ctx.restore();
  }

  function sparkles(t, cx, cy, t0, f) {
    var k = prog(t, t0, t0 + 0.9);
    if (k <= 0 || k >= 1) return;
    var rnd = rng(99);
    ctx.save();
    for (var i = 0; i < 26; i++) {
      var ang = rnd() * Math.PI * 2, dist = (140 + rnd() * 320) * f * out3(k), r = (5 + rnd() * 9) * f * (1 - k);
      ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist * 0.6, r, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 ? GOLD : '#ffffff'; ctx.globalAlpha = 1 - k; ctx.fill();
    }
    ctx.restore();
  }

  function drawPrice(t, L, plan, sc) {
    var lf = life(t, sc.a + 0.1, sc.b);
    if (lf.o <= 0) return;
    var f = L.f, d = plan.d, lang = opts.lang, y = L.contentY;
    ctx.save();
    ctx.globalAlpha = lf.o;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = lang === 'ar' ? 'rtl' : 'ltr';
    if (d.compare) {
      ctx.font = font(52 * f, 500); ctx.fillStyle = '#9b978d';
      var old = money(d.compare, lang), ow = ctx.measureText(old).width;
      ctx.fillText(old, L.w / 2, y + 40 * f);
      var sk = out3(prog(t, sc.a + 0.35, sc.a + 0.75));
      ctx.strokeStyle = '#e8553a'; ctx.lineWidth = 6 * f; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(L.w / 2 + ow / 2 + 10 * f, y + 44 * f); ctx.lineTo(L.w / 2 + ow / 2 + 10 * f - (ow + 20 * f) * sk, y + 36 * f); ctx.stroke();
    }
    // Count up to the price.
    var ck = out3(prog(t, sc.a + 0.5, sc.a + 1.3));
    var from = d.compare || Math.round(d.price * 1.3), shown = Math.round(lerp(from, d.price, ck) / 10) * 10;
    if (ck >= 1) shown = d.price;
    var pop = back(prog(t, sc.a + 0.4, sc.a + 0.9));
    ctx.save();
    ctx.translate(L.w / 2, y + 190 * f); ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
    ctx.font = font(150 * f, 800);
    var pg = ctx.createLinearGradient(0, -80 * f, 0, 80 * f);
    pg.addColorStop(0, GOLD_LIGHT); pg.addColorStop(1, GOLD);
    ctx.fillStyle = pg; ctx.shadowColor = 'rgba(242,176,30,0.45)'; ctx.shadowBlur = 40 * f;
    ctx.fillText(money(shown, lang), 0, 0);
    ctx.restore();
    sparkles(t, L.w / 2, y + 190 * f, sc.a + 1.3, f);
    if (d.compare) {
      var bk = back(prog(t, sc.a + 1.35, sc.a + 1.8));
      if (bk > 0) {
        var label = TEXT[lang].save + ' ' + money(d.compare - d.price, lang);
        ctx.font = font(44 * f, 800);
        var bw = ctx.measureText(label).width + 70 * f, bh = 80 * f, by = y + 350 * f;
        ctx.save(); ctx.translate(L.w / 2, by); ctx.scale(bk, bk);
        rrect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fillStyle = '#e8553a'; ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.fillText(label, 0, 3 * f);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawCta(t, L, plan, sc) {
    var lf = life(t, sc.a + 0.1, sc.b + 1, 0.4);
    if (lf.o <= 0) return;
    var f = L.f, lang = opts.lang, y = L.contentY + 60 * f;
    ctx.save();
    ctx.globalAlpha = lf.o;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = lang === 'ar' ? 'rtl' : 'ltr';
    var k = back(lf.k), pulse = 1 + 0.045 * Math.sin(Math.max(0, t - sc.a - 0.6) * 7);
    ctx.font = font(72 * f, 800);
    var label = opts.cta + (lang === 'ar' ? ' 👈' : ' 👉');
    var bw = ctx.measureText(label).width + 130 * f, bh = 140 * f;
    ctx.save();
    ctx.translate(L.w / 2, y); ctx.scale(k * pulse, k * pulse);
    ctx.shadowColor = 'rgba(242,176,30,0.5)'; ctx.shadowBlur = 50 * f;
    rrect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    var bg = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2); bg.addColorStop(0, GOLD_LIGHT); bg.addColorStop(1, GOLD);
    ctx.fillStyle = bg; ctx.fill(); ctx.shadowColor = 'transparent';
    // Shine across the button.
    var sh = ((t - sc.a) % 1.6) / 1.6;
    ctx.save(); rrect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.clip();
    var sx = lerp(-bw, bw, sh), sg = ctx.createLinearGradient(sx - 80 * f, 0, sx + 80 * f, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.55)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(-bw / 2, -bh / 2, bw, bh); ctx.restore();
    ctx.fillStyle = '#111111'; ctx.fillText(label, 0, 4 * f);
    ctx.restore();
    var l2 = life(t, sc.a + 0.4, sc.b + 1);
    ctx.globalAlpha = lf.o * l2.o;
    ctx.direction = 'ltr'; ctx.font = font(54 * f, 800); ctx.fillStyle = GOLD;
    ctx.fillText(DATA.domain, L.w / 2, y + 140 * f + (1 - out3(l2.k)) * 20 * f);
    var l3 = life(t, sc.a + 0.7, sc.b + 1);
    ctx.globalAlpha = lf.o * l3.o;
    ctx.direction = lang === 'ar' ? 'rtl' : 'ltr';
    var chips = [TEXT[lang].cod, TEXT[lang].ship(plan.d)];
    ctx.font = font(36 * f, 500);
    var cw = chips.map(function (c) { return ctx.measureText(c).width + 56 * f; });
    var gapC = 20 * f, total = cw[0] + cw[1] + gapC;
    var stack = total > L.w * 0.92;
    chips.forEach(function (c, i) {
      var w = cw[i], h = 70 * f, cx, cy;
      if (stack) { cx = L.w / 2; cy = y + 240 * f + i * (h + 16 * f); }
      else { var order = lang === 'ar' ? i : 1 - i; cx = L.w / 2 + (order === 0 ? total / 2 - w / 2 : -total / 2 + w / 2); cy = y + 240 * f; }
      rrect(cx - w / 2, cy - h / 2, w, h, h / 2);
      ctx.lineWidth = 2.5 * f; ctx.strokeStyle = GOLD; ctx.stroke();
      ctx.fillStyle = CREAM; ctx.fillText(c, cx, cy + 2 * f);
    });
    ctx.restore();
  }

  // Diagonal light streak marking each scene change.
  function drawTransitions(t, L, plan) {
    plan.scenes.forEach(function (s, i) {
      if (!i) return;
      var k = prog(t, s.a - 0.15, s.a + 0.25);
      if (k <= 0 || k >= 1) return;
      var x = lerp(-L.w * 0.6, L.w * 1.6, inout(k));
      ctx.save();
      ctx.translate(x, L.h / 2); ctx.rotate(-0.35);
      var g = ctx.createLinearGradient(-160, 0, 160, 0);
      g.addColorStop(0, 'rgba(255,211,107,0)'); g.addColorStop(0.5, 'rgba(255,211,107,0.22)'); g.addColorStop(1, 'rgba(255,211,107,0)');
      ctx.fillStyle = g; ctx.fillRect(-160, -L.h, 320, L.h * 2);
      ctx.restore();
    });
  }

  function render(t, plan, A) {
    var L = FORMATS[opts.format];
    if (canvas.width !== L.w || canvas.height !== L.h) { canvas.width = L.w; canvas.height = L.h; }
    ctx.direction = opts.lang === 'ar' ? 'rtl' : 'ltr';
    var hook = plan.scenes[0], cta = scene(plan, 'cta');
    // Product path: drops in under the hook, then settles at the top.
    var pin = back(prog(t, 0.15, 1.0));
    var move = inout(prog(t, hook.b - 0.2, hook.b + 0.5));
    var bob = Math.sin(t * 2.2) * 8 * L.f;
    var cy = lerp(L.prodHookY, L.prodTopY, move) + bob;
    var box = lerp(L.prodHook, L.prodTop, move) * (cta ? 1 - 0.08 * out3(prog(t, cta.a, cta.a + 0.5)) : 1);
    var rot = -16 * (1 - pin) + Math.sin(t * 1.5) * 2.2;
    drawBackground(t, L, L.w / 2, cy, A);
    // Ring burst as the product lands.
    var rb = prog(t, 0.5, 1.4);
    if (rb > 0 && rb < 1) {
      ctx.beginPath(); ctx.arc(L.w / 2, cy, box * (0.35 + 0.5 * out3(rb)), 0, Math.PI * 2);
      ctx.lineWidth = 6 * L.f; ctx.strokeStyle = 'rgba(242,176,30,' + (1 - rb) + ')'; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(L.w / 2, cy, box * 0.52, 0, Math.PI * 2);
    ctx.lineWidth = 2 * L.f; ctx.strokeStyle = 'rgba(242,176,30,' + 0.35 * pin + ')'; ctx.stroke();
    drawProduct(t, L, A, L.w / 2, cy, box, 0.45 + 0.55 * pin, rot, clamp(prog(t, 0.1, 0.4)));
    drawBrand(t, L, A);
    plan.scenes.forEach(function (s) {
      if (t < s.a - 0.1 || t > s.b + 1) return;
      if (s.name === 'hook') drawHook(t, L, plan, s);
      else if (s.name === 'features') drawFeatures(t, L, plan, s);
      else if (s.name === 'colors') drawColors(t, L, plan, s);
      else if (s.name === 'price') drawPrice(t, L, plan, s);
      else if (s.name === 'cta') drawCta(t, L, plan, s);
    });
    drawTransitions(t, L, plan);
    drawGrain(t, L, A);
    ctx.fillStyle = GOLD; ctx.fillRect(0, 0, L.w * clamp(t / plan.duration), 8 * L.f);
  }

  // ---------------------------------------------------------------- music
  // A simple royalty-free groove (kick, hats, bass, pad) plus whooshes, pops and a
  // "ding" on the price, all synthesised so the video carries no licensed audio.
  function makeSoundtrack(ac, plan, dest) {
    var t0 = ac.currentTime + 0.05, D = plan.duration;
    var master = ac.createGain(); master.gain.value = 0.9; master.connect(dest); master.connect(ac.destination);
    master.gain.setValueAtTime(0.9, t0 + D - 0.8); master.gain.linearRampToValueAtTime(0.0001, t0 + D);
    var comp = ac.createDynamicsCompressor(); comp.connect(master);
    var noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), nd = noise.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    var env = function (g, at, peak, dec) { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + dec); };
    function kick(at) {
      var o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.25);
      env(g, at, 0.9, 0.3); o.connect(g); g.connect(comp); o.start(at); o.stop(at + 0.35);
    }
    function hat(at, vol) {
      var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise; f.type = 'highpass'; f.frequency.value = 7500;
      env(g, at, vol || 0.12, 0.05); s.connect(f); f.connect(g); g.connect(comp); s.start(at); s.stop(at + 0.08);
    }
    function bass(at, freq, dur) {
      var o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 420;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.22, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(f); f.connect(g); g.connect(comp); o.start(at); o.stop(at + dur + 0.05);
    }
    function pad(at, freqs, dur) {
      freqs.forEach(function (fr) {
        var o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = (Math.random() - 0.5) * 14;
        f.type = 'lowpass'; f.frequency.value = 1100;
        g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.035, at + 0.4); g.gain.linearRampToValueAtTime(0.0001, at + dur);
        o.connect(f); f.connect(g); g.connect(comp); o.start(at); o.stop(at + dur + 0.05);
      });
    }
    function whoosh(at) {
      var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise; f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, at); f.frequency.exponentialRampToValueAtTime(3500, at + 0.4);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.35, at + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      s.connect(f); f.connect(g); g.connect(comp); s.start(at); s.stop(at + 0.5);
    }
    function tone(at, freq, vol, dec, type) {
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine'; o.frequency.value = freq; env(g, at, vol, dec);
      o.connect(g); g.connect(comp); o.start(at); o.stop(at + dec + 0.05);
    }
    var beat = 60 / 112;
    var roots = [110, 87.31, 130.81, 98];             // A2 F2 C3 G2
    var chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
    for (var b = 0; b * beat < D; b++) {
      var at = t0 + b * beat, bar = Math.floor(b / 4) % 4;
      if (b >= 2) kick(at);
      hat(at + beat / 2, 0.1);
      if (b % 2) hat(at + beat * 0.75, 0.05);
      if (b % 4 === 0) { pad(at, chords[bar], beat * 4); }
      if (b >= 2) bass(at, roots[bar], beat * 0.45);
      if (b >= 2 && b % 2) bass(at + beat / 2, roots[bar] * 2, beat * 0.3);
    }
    tone(t0 + 0.6, 98, 0.6, 0.8);                      // impact as the product lands
    plan.scenes.forEach(function (s, i) { if (i) whoosh(t0 + s.a - 0.2); });
    var fs = scene(plan, 'features');
    if (fs) plan.feats.forEach(function (x, i) { tone(t0 + fs.a + 0.35 + i * 1.15, 880, 0.18, 0.15, 'triangle'); });
    var ps = scene(plan, 'price');
    if (ps) { tone(t0 + ps.a + 1.3, 1318.5, 0.25, 0.9); tone(t0 + ps.a + 1.3, 1760, 0.18, 1.1); }
    var cs = scene(plan, 'cta');
    if (cs) { tone(t0 + cs.a + 0.1, 65.4, 0.7, 0.9); }
    return t0;
  }

  // ---------------------------------------------------------------- playback & recording
  var running = null;
  function setStatus(text) { statusEl.textContent = text || ''; }
  function setBusy(busy) { playBtn.disabled = busy; recordBtn.disabled = busy; }

  function run(record) {
    readOpts();
    if (running) return;
    setBusy(true);
    setStatus(record ? 'جارٍ إنشاء الفيديو… اترك الصفحة مفتوحة' : '');
    return loadAssets().then(function (A) {
      var plan = buildPlan();
      render(0, plan, A);
      var ac = null, dest = null, recorder = null, chunks = [], mime = '';
      if (opts.music && window.AudioContext) {
        ac = new AudioContext();
        dest = ac.createMediaStreamDestination();
      }
      if (record) {
        var stream = canvas.captureStream(30);
        if (dest) dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
        // MP4 only when the browser really encodes H.264 (Chrome, Edge, Safari); a bare
        // "video/mp4" may hold VP9, which TikTok rejects, so WebM is the honest fallback.
        var types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a',
          'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
        mime = types.filter(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); })[0] || '';
        if (!window.MediaRecorder || !mime) {
          setBusy(false); setStatus('متصفحك لا يدعم تسجيل الفيديو. استعمل Chrome على الحاسوب.'); return;
        }
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000, audioBitsPerSecond: 160000 });
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      }
      var start = function () {
        if (ac) makeSoundtrack(ac, plan, dest);
        if (recorder) recorder.start(500);
        var t0 = performance.now();
        progressEl.hidden = false;
        running = true;
        var frame = function () {
          var t = (performance.now() - t0) / 1000;
          render(Math.min(t, plan.duration), plan, A);
          progressEl.firstElementChild.style.width = (100 * clamp(t / plan.duration)) + '%';
          if (t < plan.duration) return requestAnimationFrame(frame);
          setTimeout(finish, 200);
        };
        requestAnimationFrame(frame);
      };
      var finish = function () {
        running = null;
        progressEl.hidden = true;
        if (ac) ac.close();
        if (!recorder) { setBusy(false); return; }
        recorder.onstop = function () {
          var ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
          var blob = new Blob(chunks, { type: mime.split(';')[0] });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = DATA.slug + '-' + opts.format.replace(':', 'x') + '-' + opts.lang + '.' + ext;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
          setBusy(false);
          setStatus(ext === 'mp4'
            ? '✅ تم! الفيديو محفوظ في التنزيلات (MP4).'
            : '✅ تم! الفيديو بصيغة WebM — يقبله فيسبوك، ولتيك توك استعمل Chrome على الحاسوب للحصول على MP4.');
        };
        recorder.stop();
      };
      if (ac && ac.state === 'suspended') ac.resume().then(start); else start();
    });
  }

  playBtn.addEventListener('click', function () { run(false); });
  recordBtn.addEventListener('click', function () { run(true); });

  var langSel = root.querySelector('[data-vm-opt="lang"]');
  langSel.addEventListener('change', function () { fillDefaults(langSel.value); readOpts(); loadAssets().then(function (A) { render(1.6, buildPlan(), A); }); });
  root.querySelectorAll('[data-vm-opt]').forEach(function (el) {
    if (el === langSel) return;
    el.addEventListener('change', function () { if (running) return; readOpts(); loadAssets().then(function (A) { render(1.6, buildPlan(), A); }); });
  });

  fillDefaults('ar');
  readOpts();
  loadAssets().then(function (A) { render(1.6, buildPlan(), A); });

  // Hook for automated checks: draw any moment of the video.
  window.__adVideo = {
    at: function (t) { readOpts(); return loadAssets().then(function (A) { var p = buildPlan(); render(t, p, A); return p.duration; }); },
    // Soundtrack rendered offline, as 16-bit WAV bytes.
    wav: function () {
      readOpts();
      var plan = buildPlan(), rate = 48000;
      var oac = new OfflineAudioContext(2, Math.ceil(rate * plan.duration), rate);
      makeSoundtrack(oac, plan, oac.destination);
      return oac.startRendering().then(function (buf) {
        var n = buf.length, view = new DataView(new ArrayBuffer(44 + n * 4)), off = 0;
        var str = function (s) { for (var i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
        var u32 = function (v) { view.setUint32(off, v, true); off += 4; };
        var u16 = function (v) { view.setUint16(off, v, true); off += 2; };
        str('RIFF'); u32(36 + n * 4); str('WAVE'); str('fmt '); u32(16); u16(1); u16(2); u32(rate); u32(rate * 4); u16(4); u16(16); str('data'); u32(n * 4);
        var l = buf.getChannelData(0), r = buf.getChannelData(1);
        for (var i = 0; i < n; i++) {
          view.setInt16(off, Math.max(-1, Math.min(1, l[i])) * 32767, true); off += 2;
          view.setInt16(off, Math.max(-1, Math.min(1, r[i])) * 32767, true); off += 2;
        }
        return Array.from(new Uint8Array(view.buffer));
      });
    }
  };
})();
