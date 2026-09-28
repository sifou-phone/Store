/* Sifou Phone dashboard helpers. */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Confirm destructive actions.
  $all('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // Whole order rows are clickable.
  $all('tr[data-href]').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, select')) return;
      window.location.href = row.dataset.href;
    });
  });

  // Hide the success banner after a moment and drop ?ok= from the URL.
  var flash = $('[data-flash]');
  if (flash) {
    setTimeout(function () { flash.style.transition = 'opacity .4s'; flash.style.opacity = '0'; }, 3500);
    setTimeout(function () { flash.remove(); }, 4000);
    var url = new URL(window.location.href);
    url.searchParams.delete('ok');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  // Image previews for the product form.
  var fileInput = $('[data-file-input]');
  var previews = $('[data-previews]');
  var drop = $('[data-dropzone]');
  if (fileInput && previews) {
    fileInput.addEventListener('change', function () {
      previews.innerHTML = '';
      Array.prototype.forEach.call(fileInput.files, function (file) {
        if (!/^image\//.test(file.type)) return;
        var item = document.createElement('div');
        item.className = 'img-item';
        var img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = '';
        var cap = document.createElement('span');
        cap.className = 'muted';
        cap.textContent = file.size > 5 * 1024 * 1024 ? 'كبيرة جداً!' : 'جديدة';
        item.appendChild(img);
        item.appendChild(cap);
        previews.appendChild(item);
      });
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function () { drop.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function () { drop.classList.remove('drag'); });
    });
  }

  // Bulk shipping prices.
  var bulkBtn = $('[data-bulk-apply]');
  if (bulkBtn) {
    bulkBtn.addEventListener('click', function () {
      ['home', 'desk'].forEach(function (col) {
        var v = $('[data-bulk="' + col + '"]').value;
        if (v === '') return;
        $all('input[data-col="' + col + '"]').forEach(function (i) { i.value = v; });
      });
    });
  }

  // New-order watcher: polls every 30s, updates the badge and title, plays a chime.
  var body = document.body;
  var lastId = Number(body.dataset.lastOrder || 0);
  var badge = $('[data-new-badge]');
  var toast = $('[data-new-toast]');
  var baseTitle = document.title.replace(/^\(\d+\)\s*/, '');

  function chime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      [880, 1175].forEach(function (f, i) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.frequency.value = f;
        o.connect(g);
        g.connect(ctx.destination);
        var t = ctx.currentTime + i * 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.start(t);
        o.stop(t + 0.4);
      });
    } catch (e) { /* audio not allowed yet */ }
  }

  function poll() {
    if (document.hidden && Math.random() < 0.5) return; // back off when the tab is hidden
    fetch('/admin/api/new-orders?since=' + lastId, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (badge) { badge.textContent = data.newCount; badge.hidden = !data.newCount; }
        document.title = (data.newCount ? '(' + data.newCount + ') ' : '') + baseTitle;
        if (data.orders.length) {
          lastId = data.lastId;
          var o = data.orders[data.orders.length - 1];
          $('[data-new-toast-text]').textContent = data.orders.length > 1
            ? data.orders.length + ' طلبات جديدة!'
            : 'طلب جديد من ' + o.customer_name;
          toast.hidden = false;
          chime();
          setTimeout(function () { toast.hidden = true; }, 12000);
        }
      })
      .catch(function () { /* offline */ });
  }
  if (!body.classList.contains('login-body')) setInterval(poll, 30000);
})();
