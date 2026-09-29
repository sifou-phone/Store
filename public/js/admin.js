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
    var MAX_SIDE = 1600;
    // Phone photos are often 3-8 MB: re-encode big ones so pages load fast
    // and the free database stays small.
    var shrink = function (file) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return Promise.resolve(file);
      return createImageBitmap(file).then(function (bmp) {
        var scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        if (scale === 1 && file.size < 500 * 1024) return file;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            if (!blob || blob.size >= file.size) return resolve(file);
            resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.85);
        });
      }).catch(function () { return file; });
    };
    var submitBtn = fileInput.form && fileInput.form.querySelector('button[type="submit"]');

    fileInput.addEventListener('change', function () {
      var files = Array.prototype.filter.call(fileInput.files, function (f) { return /^image\//.test(f.type); });
      previews.innerHTML = '';
      if (!files.length) return;
      if (submitBtn) submitBtn.disabled = true;
      Promise.all(files.map(shrink)).then(function (small) {
        if (window.DataTransfer) {
          var dt = new DataTransfer();
          small.forEach(function (f) { dt.items.add(f); });
          fileInput.files = dt.files;
        }
        small.forEach(function (file) {
          var item = document.createElement('div');
          item.className = 'img-item';
          var img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.alt = '';
          var cap = document.createElement('span');
          cap.className = 'muted';
          cap.textContent = file.size > 5 * 1024 * 1024 ? 'كبيرة جداً!' : 'جديدة • ' + Math.round(file.size / 1024) + ' KB';
          item.appendChild(img);
          item.appendChild(cap);
          previews.appendChild(item);
        });
      }).then(function () {
        if (submitBtn) submitBtn.disabled = false;
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
