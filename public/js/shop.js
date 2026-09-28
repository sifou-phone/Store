/* Sifou Phone storefront: cart (localStorage), order form, gallery. */
(function () {
  'use strict';

  var CART_KEY = 'sp_cart';
  var currency = document.body.dataset.currency || 'دج';
  var lang = document.body.dataset.lang || 'ar';
  var T = {};
  try { T = JSON.parse(document.getElementById('i18n-data').textContent); } catch (e) { /* keep keys */ }
  function t(key) { return T[key] || key; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmt(n) {
    // Arabic pages use comma grouping so the number stays in one piece in RTL text.
    return Math.round(n).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US') + ' ' + currency;
  }
  function track() {
    if (window.fbq) { try { window.fbq.apply(null, arguments); } catch (e) { /* ignore */ } }
  }

  // ------------------------------------------------------------ cart store
  function readCart() {
    try {
      var c = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(c) ? c : [];
    } catch (e) { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) { /* private mode */ }
    renderCount(true);
  }
  function addToCart(productId, variant, qty) {
    var cart = readCart();
    var line = cart.find(function (l) { return l.product_id === productId && l.variant === variant; });
    if (line) line.qty = Math.min(line.qty + qty, 20);
    else cart.push({ product_id: productId, variant: variant, qty: qty });
    writeCart(cart);
  }
  function renderCount(bump) {
    var n = readCart().reduce(function (s, l) { return s + l.qty; }, 0);
    $all('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.hidden = n === 0;
      if (bump && n) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
  }

  function toast(html) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, 3200);
  }

  // ------------------------------------------------------------ order form
  function setupOrderForm(form) {
    var mode = form.dataset.mode;
    var wilayas = JSON.parse(($('#wilayas-data') || {}).textContent || '[]');
    var byCode = {};
    wilayas.forEach(function (w) { byCode[w.code] = w; });
    var submitBtn = $('[data-submit]', form);
    var qtyInput = $('input[name="qty"]', form);
    var addressField = $('[data-address-field]', form);
    var cartLines = []; // cart mode: [{product, variant, qty}]

    function subtotal() {
      if (mode === 'single') return Number(form.dataset.price) * (Number(qtyInput.value) || 1);
      return cartLines.reduce(function (s, l) { return s + l.product.price * l.qty; }, 0);
    }
    function allFree() {
      if (mode === 'single') return form.dataset.freeShipping === '1';
      return cartLines.length > 0 && cartLines.every(function (l) { return l.product.free_shipping; });
    }
    function deliveryType() {
      var r = $('input[name="delivery_type"]:checked', form);
      return r ? r.value : 'home';
    }

    function update() {
      var w = byCode[form.wilaya.value];
      var free = allFree();
      $all('[data-ship-price]', form).forEach(function (el) {
        var type = el.dataset.shipPrice;
        el.textContent = free ? t('free') : w ? fmt(type === 'desk' ? w.desk_price : w.home_price) : t('choose_wilaya');
      });
      var sub = subtotal();
      var ship = free ? 0 : w ? (deliveryType() === 'desk' ? w.desk_price : w.home_price) : null;
      $('[data-sum="subtotal"]', form).textContent = fmt(sub);
      $('[data-sum="shipping"]', form).textContent = ship === null ? t('choose_wilaya') : ship === 0 ? t('free') : fmt(ship);
      $('[data-sum="total"]', form).textContent = fmt(sub + (ship || 0));
      if (addressField) addressField.hidden = deliveryType() === 'desk';
    }

    function clearErrors() {
      $all('.field.invalid', form).forEach(function (f) { f.classList.remove('invalid'); });
      $all('[data-err]', form).forEach(function (e) { e.textContent = ''; });
      var box = $('[data-err="form"]', form);
      box.hidden = true;
    }
    function showErrors(errors) {
      var first = null;
      Object.keys(errors).forEach(function (key) {
        var el = $('[data-err="' + key + '"]', form);
        if (!el || key === 'items') el = $('[data-err="form"]', form);
        el.textContent = errors[key];
        el.hidden = false;
        var field = el.closest('.field');
        if (field) field.classList.add('invalid');
        if (!first) first = field || el;
      });
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function validate() {
      var errors = {};
      if (form.customer_name.value.trim().length < 3) errors.customer_name = t('err_name');
      var phone = form.phone.value.replace(/[\s.\-()]/g, '').replace(/^(\+|00)213/, '0');
      if (!/^0[5-7]\d{8}$/.test(phone) && !/^0[2-4]\d{7}$/.test(phone)) errors.phone = t('err_phone');
      if (!form.wilaya.value) errors.wilaya = t('err_wilaya');
      if (form.commune.value.trim().length < 2) errors.commune = t('err_commune');
      if (deliveryType() === 'home' && form.address.value.trim().length < 4) errors.address = t('err_address');
      if (mode === 'cart' && !cartLines.length) errors.form = t('err_cart_empty');
      return errors;
    }

    function items() {
      if (mode === 'single') {
        var v = $('input[name="variant"]:checked', form);
        return [{ product_id: Number(form.dataset.productId), variant: v ? v.value : '', qty: Number(qtyInput.value) || 1 }];
      }
      return cartLines.map(function (l) { return { product_id: l.product.id, variant: l.variant, qty: l.qty }; });
    }

    form.addEventListener('input', function (e) {
      var field = e.target.closest('.field');
      if (field && field.classList.contains('invalid')) {
        field.classList.remove('invalid');
        var err = $('.err', field);
        if (err) err.textContent = '';
      }
    });
    form.addEventListener('change', update);
    form.addEventListener('focusin', function once() {
      track('track', 'InitiateCheckout');
      form.removeEventListener('focusin', once);
    });

    // Quantity stepper
    $all('[data-qty-step]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var max = Number(qtyInput.max) || 20;
        var v = (Number(qtyInput.value) || 1) + Number(btn.dataset.qtyStep);
        qtyInput.value = Math.min(Math.max(v, 1), max);
        update();
      });
    });
    if (qtyInput) qtyInput.addEventListener('input', update);

    var addBtn = $('[data-add-to-cart]', form);
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var it = items()[0];
        addToCart(it.product_id, it.variant, it.qty);
        track('track', 'AddToCart', { content_ids: [String(it.product_id)], content_type: 'product', value: subtotal(), currency: 'DZD' });
        toast(t('added_to_cart') + ' <a href="/cart">' + t('view_cart') + '</a>');
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();
      var errors = validate();
      if (Object.keys(errors).length) return showErrors(errors);

      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      data.items = items();
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;

      fetch('/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
        .then(function (res) {
          if (res.ok && res.body.redirect) {
            if (mode === 'cart') {
              try { sessionStorage.setItem('sp_clear_cart', '1'); } catch (e) { writeCart([]); }
            }
            window.location.href = res.body.redirect;
            return;
          }
          showErrors(res.body.errors || { form: t('err_generic') });
          submitBtn.classList.remove('loading');
          submitBtn.disabled = false;
        })
        .catch(function () {
          showErrors({ form: t('err_network') });
          submitBtn.classList.remove('loading');
          submitBtn.disabled = false;
        });
    });

    update();

    return {
      setCartLines: function (lines) { cartLines = lines; update(); },
    };
  }

  // ------------------------------------------------------------- cart page
  function setupCartPage(orderForm) {
    var layout = $('[data-cart-layout]');
    if (!layout) return;
    var empty = $('[data-cart-empty]');
    var list = $('[data-cart-items]');
    var tpl = $('#cart-item-tpl');
    var products = {};

    function lines() {
      return readCart()
        .filter(function (l) { return products[l.product_id]; })
        .map(function (l) { return { product: products[l.product_id], variant: l.variant, qty: l.qty }; });
    }

    function render() {
      var cart = readCart();
      // Drop products that no longer exist and fix variants that were removed.
      var cleaned = cart.filter(function (l) { return products[l.product_id]; }).map(function (l) {
        var p = products[l.product_id];
        if (p.variants.length && p.variants.indexOf(l.variant) === -1) l.variant = p.variants[0];
        if (!p.variants.length) l.variant = '';
        if (p.stock != null) l.qty = Math.max(Math.min(l.qty, p.stock), 1);
        return l;
      });
      if (cleaned.length !== cart.length || JSON.stringify(cleaned) !== JSON.stringify(cart)) writeCart(cleaned);

      list.innerHTML = '';
      empty.hidden = cleaned.length > 0;
      layout.hidden = cleaned.length === 0;

      cleaned.forEach(function (line, idx) {
        var p = products[line.product_id];
        var node = tpl.content.firstElementChild.cloneNode(true);
        $all('[data-link]', node).forEach(function (a) { a.href = '/p/' + p.slug; });
        var img = $('img', node);
        img.src = p.image;
        img.alt = p.name;
        $('[data-name]', node).textContent = p.name;
        var vWrap = $('[data-variant-wrap]', node);
        if (p.variants.length) {
          $('[data-variant-label]', node).textContent = p.variant_label + ':';
          var sel = $('[data-variant]', node);
          p.variants.forEach(function (v, i) {
            var o = document.createElement('option');
            o.value = v;
            o.textContent = (p.variant_labels && p.variant_labels[i]) || v;
            if (v === line.variant) o.selected = true;
            sel.appendChild(o);
          });
          sel.addEventListener('change', function () { mutate(idx, { variant: sel.value }); });
        } else {
          vWrap.remove();
        }
        var q = $('[data-qty-input]', node);
        q.value = line.qty;
        q.max = p.stock != null ? Math.min(p.stock, 20) : 20;
        q.addEventListener('change', function () { mutate(idx, { qty: Number(q.value) || 1 }); });
        $('[data-inc]', node).addEventListener('click', function () { mutate(idx, { qty: line.qty + 1 }); });
        $('[data-dec]', node).addEventListener('click', function () { mutate(idx, { qty: line.qty - 1 }); });
        $('[data-remove]', node).addEventListener('click', function () {
          var c = readCart();
          c.splice(idx, 1);
          writeCart(c);
          render();
        });
        $('[data-line-total]', node).textContent = fmt(p.price * line.qty);
        list.appendChild(node);
      });
      if (orderForm) orderForm.setCartLines(lines());
    }

    function mutate(idx, patch) {
      var c = readCart();
      var line = c[idx];
      if (!line) return;
      var p = products[line.product_id];
      if (patch.qty != null) {
        var max = p && p.stock != null ? Math.min(p.stock, 20) : 20;
        line.qty = Math.min(Math.max(patch.qty, 1), max);
      }
      if (patch.variant != null) line.variant = patch.variant;
      // Merge lines that became identical after a variant change.
      var merged = [];
      c.forEach(function (l) {
        var m = merged.find(function (x) { return x.product_id === l.product_id && x.variant === l.variant; });
        if (m) m.qty = Math.min(m.qty + l.qty, 20);
        else merged.push(l);
      });
      writeCart(merged);
      render();
    }

    var ids = readCart().map(function (l) { return l.product_id; });
    if (!ids.length) { empty.hidden = false; return; }
    fetch('/api/products?ids=' + ids.join(','))
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        rows.forEach(function (p) { products[p.id] = p; });
        render();
      })
      .catch(function () { empty.hidden = false; });
  }

  // --------------------------------------------------------------- gallery
  function setupGallery() {
    var g = $('[data-gallery]');
    if (!g) return;
    var main = $('[data-gallery-main]', g);
    $all('.thumb', g).forEach(function (t) {
      t.addEventListener('click', function () {
        main.src = t.dataset.src;
        $all('.thumb', g).forEach(function (x) { x.classList.toggle('active', x === t); });
      });
    });
  }

  function setupStickyBuy() {
    var bar = $('[data-sticky-buy]');
    var form = $('#order');
    if (!bar || !form || !('IntersectionObserver' in window)) return;
    var formVisible = false;
    var pastTop = false;
    function sync() { bar.hidden = formVisible || !pastTop; }
    new IntersectionObserver(function (entries) {
      formVisible = entries[0].isIntersecting;
      sync();
    }).observe(form);
    window.addEventListener('scroll', function () {
      pastTop = window.scrollY > 400;
      sync();
    }, { passive: true });
  }

  function setupMenu() {
    var btn = $('[data-menu-toggle]');
    var menu = $('[data-menu]');
    if (!btn || !menu) return;
    btn.addEventListener('click', function () { menu.classList.toggle('open'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderCount(false);
    setupMenu();
    setupGallery();
    setupStickyBuy();
    $all('[data-autosubmit]').forEach(function (el) {
      el.addEventListener('change', function () { el.form.submit(); });
    });
    var formEl = $('[data-order-form]');
    var api = formEl ? setupOrderForm(formEl) : null;
    if (formEl && formEl.dataset.mode === 'cart') setupCartPage(api);
  });
})();
