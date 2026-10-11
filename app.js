/* Square — settle up between four friends.
 * Amounts are stored in pence (integers) so nothing drifts from float rounding.
 * A payment: { id, created_at, amount_pence, paid_by, shares: {name: weight}, description, kind }
 * kind = 'expense' for normal payments, 'settle' for a pay-back (paid_by pays one person).
 */
(function () {
  'use strict';

  var PEOPLE = ['Pieter', 'Luke', 'Johnny', 'James'];
  var COLORS = ['var(--p0)', 'var(--p1)', 'var(--p2)', 'var(--p3)'];
  var cfg = window.SQUARE_CONFIG || {};
  var LIVE = !!(cfg.supabaseUrl && cfg.supabaseKey && cfg.supabaseUrl.indexOf('YOUR_') === -1);

  // ---------- helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gbp(p) { var neg = p < 0; p = Math.abs(p); return (neg ? '−' : '') + '£' + Math.floor(p / 100) + '.' + String(p % 100).padStart(2, '0'); }
  function signed(p) { return p === 0 ? '£0.00' : (p > 0 ? '+' : '') + gbp(p); }
  function toPence(str) {
    var s = String(str || '').replace(/[^0-9.]/g, '');
    if (!s) return 0;
    var parts = s.split('.');
    var pounds = parseInt(parts[0] || '0', 10) || 0;
    var pence = parseInt(((parts[1] || '') + '00').slice(0, 2), 10) || 0;
    return pounds * 100 + pence;
  }
  function color(name) { return COLORS[PEOPLE.indexOf(name)] || 'var(--muted)'; }
  function ls(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) { return null; }
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function when(iso) {
    var d = new Date(iso), now = new Date();
    var days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // Split pence across weights so the parts always add up exactly.
  function split(pence, shares) {
    var names = PEOPLE.filter(function (n) { return (shares[n] || 0) > 0; });
    var total = names.reduce(function (a, n) { return a + shares[n]; }, 0);
    var out = {}; PEOPLE.forEach(function (n) { out[n] = 0; });
    if (!total) return out;
    var used = 0, rems = [];
    names.forEach(function (n) {
      var exact = pence * shares[n] / total;
      out[n] = Math.floor(exact); used += out[n];
      rems.push({ n: n, r: exact - out[n] });
    });
    rems.sort(function (a, b) { return b.r - a.r; });
    for (var i = 0; used < pence; i++, used++) out[rems[i % rems.length].n] += 1;
    return out;
  }

  function effect(p) { // each person's net change from one payment
    var parts = split(p.amount_pence, p.shares || {});
    var e = {};
    PEOPLE.forEach(function (n) { e[n] = -parts[n] + (p.paid_by === n ? p.amount_pence : 0); });
    return e;
  }

  function balances(payments) {
    var b = {}; PEOPLE.forEach(function (n) { b[n] = 0; });
    payments.forEach(function (p) { var e = effect(p); PEOPLE.forEach(function (n) { b[n] += e[n]; }); });
    return b;
  }

  // Fewest-transfers settle plan (greedy: biggest debtor pays biggest creditor).
  function plan(bal) {
    var debt = [], cred = [];
    PEOPLE.forEach(function (n) { if (bal[n] < 0) debt.push({ n: n, v: -bal[n] }); else if (bal[n] > 0) cred.push({ n: n, v: bal[n] }); });
    debt.sort(function (a, b) { return b.v - a.v; }); cred.sort(function (a, b) { return b.v - a.v; });
    var out = [], i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      var x = Math.min(debt[i].v, cred[j].v);
      if (x > 0) out.push({ from: debt[i].n, to: cred[j].n, pence: x });
      debt[i].v -= x; cred[j].v -= x;
      if (!debt[i].v) i++; if (!cred[j].v) j++;
    }
    return out;
  }

  function ratioText(shares) {
    var on = PEOPLE.filter(function (n) { return (shares[n] || 0) > 0; });
    var w = on.map(function (n) { return shares[n]; });
    var equal = w.every(function (x) { return x === w[0]; });
    if (equal && on.length === 4) return 'split 4 ways';
    if (equal) return 'split ' + on.join(', ');
    return on.map(function (n) { return n + ' ' + shares[n]; }).join(' : ');
  }

  // ---------- storage ----------
  var store = LIVE ? {
    headers: function (extra) {
      var h = { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + cfg.supabaseKey, 'Content-Type': 'application/json' };
      for (var k in extra) h[k] = extra[k];
      return h;
    },
    url: function (q) { return cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/payments' + (q || ''); },
    list: function () {
      return fetch(this.url('?select=*&order=created_at.desc&limit=1000'), { headers: this.headers() })
        .then(function (r) { if (!r.ok) throw new Error('Load failed (' + r.status + ')'); return r.json(); });
    },
    add: function (p) {
      return fetch(this.url(), { method: 'POST', headers: this.headers({ Prefer: 'return=representation' }), body: JSON.stringify(p) })
        .then(function (r) { if (!r.ok) throw new Error('Save failed (' + r.status + ')'); return r.json(); })
        .then(function (rows) { return rows[0]; });
    },
    remove: function (id) {
      return fetch(this.url('?id=eq.' + encodeURIComponent(id)), { method: 'DELETE', headers: this.headers() })
        .then(function (r) { if (!r.ok) throw new Error('Delete failed (' + r.status + ')'); });
    }
  } : {
    read: function () { try { return JSON.parse(ls('square.demo') || '[]'); } catch (e) { return []; } },
    write: function (rows) { ls('square.demo', JSON.stringify(rows)); },
    list: function () { return Promise.resolve(this.read().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })); },
    add: function (p) {
      var row = Object.assign({ id: String(Date.now()) + Math.random().toString(16).slice(2, 6), created_at: new Date().toISOString() }, p);
      var rows = this.read(); rows.push(row); this.write(rows); return Promise.resolve(row);
    },
    remove: function (id) { this.write(this.read().filter(function (r) { return r.id !== id; })); return Promise.resolve(); }
  };

  // ---------- state ----------
  var state = { me: ls('square.me'), view: 'home', payments: [], loading: true, error: null };

  function load() {
    state.loading = true;
    return store.list().then(function (rows) { state.payments = rows; state.error = null; })
      .catch(function (e) { state.error = e.message; })
      .then(function () { state.loading = false; render(); });
  }

  // ---------- views ----------
  var app = $('#app');

  function render() {
    if (!state.me || PEOPLE.indexOf(state.me) === -1) return renderPick();
    if (state.view === 'settle') return renderSettle();
    renderHome();
  }

  function renderPick() {
    app.innerHTML =
      '<div class="top"><h1 class="display">Square</h1></div>' +
      '<div><h2 style="font-size:22px">Who are you?</h2><p class="muted">So Square can show what you owe. Change it any time.</p></div>' +
      '<div class="pick">' + PEOPLE.map(function (n) {
        return '<button type="button" data-me="' + n + '"><span class="dot" style="background:' + color(n) + '"></span>' + n + '</button>';
      }).join('') + '</div>';
    $('#fab') && $('#fab').remove();
  }

  function heroLine(v) {
    if (v > 0) return { label: 'You’re owed', amt: gbp(v) };
    if (v < 0) return { label: 'You owe', amt: gbp(-v) };
    return { label: 'You’re', amt: 'All square' };
  }

  function renderHome() {
    var bal = balances(state.payments);
    var me = state.me, h = heroLine(bal[me]);
    var html =
      '<div class="top"><h1 class="display">Square</h1>' +
      '<button type="button" class="chip" data-switch aria-label="Switch person, currently ' + me + '">' + esc(me) + ' ▾</button></div>';
    if (!LIVE) html += '<div class="banner">Demo mode: payments are saved on this phone only until the database is connected.</div>';
    if (state.error) html += '<div class="banner">Couldn’t reach the database: ' + esc(state.error) + '. <button type="button" class="chip" data-reload>Retry</button></div>';
    html +=
      '<section class="hero">' +
        '<div class="label">' + h.label + '</div>' +
        '<div class="big display num">' + h.amt + '</div>' +
        '<button type="button" class="btn-light" data-view="settle">Settle up</button>' +
      '</section>' +
      '<section class="balances" aria-label="Everyone’s balance">' + PEOPLE.map(function (n) {
        var v = bal[n];
        return '<div class="bal"><div class="who"><span class="dot" style="background:' + color(n) + '"></span>' + n + (n === me ? ' (you)' : '') + '</div>' +
          '<div class="amt num ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + (v === 0 ? 'Square' : signed(v)) + '</div></div>';
      }).join('') + '</section>' +
      '<div class="section-head"><h2>Recent</h2><span class="muted small">Your change</span></div>';

    if (state.loading && !state.payments.length) html += '<p class="empty">Loading…</p>';
    else if (!state.payments.length) html += '<p class="empty">No payments yet. Tap “Add payment” to log the first one.</p>';
    else html += '<ul class="list">' + state.payments.slice(0, 60).map(itemHtml).join('') + '</ul>';

    app.innerHTML = html;
    ensureFab();
  }

  function itemHtml(p) {
    var e = effect(p)[state.me];
    var bar = '', parts = split(p.amount_pence, p.shares || {});
    if (p.kind !== 'settle') {
      bar = '<div class="bar" aria-hidden="true">' + PEOPLE.map(function (n) {
        var w = p.amount_pence ? parts[n] / p.amount_pence * 100 : 0;
        return w ? '<span style="width:' + w + '%;background:' + color(n) + '"></span>' : '';
      }).join('') + '</div>';
    }
    var to = p.kind === 'settle' ? Object.keys(p.shares || {})[0] : '';
    var meta = p.kind === 'settle' ? esc(p.paid_by) + ' paid ' + esc(to) + ' back' : esc(p.paid_by) + ' paid · ' + esc(ratioText(p.shares || {}));
    return '<li class="item' + (p.kind === 'settle' ? ' settle' : '') + '">' +
      '<div class="line"><span>' + esc(p.description || (p.kind === 'settle' ? 'Settled up' : 'Payment')) + '</span><span class="num">' + gbp(p.amount_pence) + '</span></div>' +
      bar +
      '<div class="meta"><span>' + when(p.created_at) + ' · ' + meta + '</span>' +
      '<span class="num ' + (e > 0 ? 'pos' : e < 0 ? 'neg' : '') + '" style="font-weight:600">' + (e ? signed(e) : '—') + '</span></div>' +
      '<div><button type="button" class="del" data-del="' + esc(p.id) + '">Delete</button></div>' +
      '</li>';
  }

  function renderSettle() {
    var bal = balances(state.payments), steps = plan(bal);
    var html =
      '<div class="top"><button type="button" class="icon-btn" data-view="home" aria-label="Back">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<h1 style="font-size:16px;font-weight:600">Settle up</h1><span style="width:44px"></span></div>';
    if (!steps.length) {
      html += '<div class="allsquare"><div class="tick"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
        '<h2 class="display" style="font-size:30px">All square</h2><p class="muted">Nobody owes anybody.</p></div>';
    } else {
      html += '<p class="muted" style="margin:0">The fewest payments that clear everything. Mark each one once the money’s sent.</p>' +
        '<ul class="transfers">' + steps.map(function (s, i) {
          var mine = s.from === state.me || s.to === state.me;
          return '<li class="transfer"' + (mine ? ' style="outline:2px solid var(--green)"' : '') + '>' +
            '<div class="line"><span><b>' + s.from + '</b> pays <b>' + s.to + '</b></span><strong class="num display">' + gbp(s.pence) + '</strong></div>' +
            '<button type="button" data-settle="' + i + '">Mark as paid</button></li>';
        }).join('') + '</ul>';
    }
    app.innerHTML = html;
    $('#fab') && $('#fab').remove();
    app._steps = steps;
  }

  function ensureFab() {
    if ($('#fab')) return;
    var b = document.createElement('button');
    b.id = 'fab'; b.type = 'button'; b.className = 'fab';
    b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add payment';
    b.addEventListener('click', openAdd);
    document.body.appendChild(b);
  }

  // ---------- events on main view ----------
  app.addEventListener('click', function (ev) {
    var t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.me) { state.me = t.dataset.me; ls('square.me', state.me); render(); return; }
    if (t.hasAttribute('data-switch')) { state.me = null; ls('square.me', null); render(); return; }
    if (t.hasAttribute('data-reload')) { load(); return; }
    if (t.dataset.view) { state.view = t.dataset.view; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.del) {
      var p = state.payments.find(function (x) { return String(x.id) === t.dataset.del; });
      if (!p || !confirm('Delete “' + (p.description || 'this payment') + '” (' + gbp(p.amount_pence) + ')? Everyone’s balance will update.')) return;
      t.disabled = true;
      store.remove(p.id).then(function () { toast('Deleted'); return load(); })
        .catch(function (e) { t.disabled = false; toast(e.message); });
      return;
    }
    if (t.dataset.settle) {
      var s = app._steps[Number(t.dataset.settle)]; if (!s) return;
      t.disabled = true; t.textContent = 'Saving…';
      var shares = {}; shares[s.to] = 1;
      store.add({ amount_pence: s.pence, paid_by: s.from, shares: shares, description: 'Settled up', kind: 'settle' })
        .then(function () { toast(s.from + ' → ' + s.to + ' recorded'); return load(); })
        .catch(function (e) { t.disabled = false; t.textContent = 'Mark as paid'; toast(e.message); });
    }
  });

  // ---------- add payment sheet ----------
  var dlg = $('#add'), form = $('#add-form');
  var draft = null;

  function openAdd() {
    draft = { shares: { Pieter: 1, Luke: 1, Johnny: 1, James: 1 }, payer: state.me };
    form.reset();
    paintSheet();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(function () { $('#amt').focus(); }, 50);
  }
  function closeAdd() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

  function presetsFor() {
    var me = state.me, all = {}, notMe = {}, pair = {};
    PEOPLE.forEach(function (n) { all[n] = 1; notMe[n] = n === me ? 0 : 1; pair[n] = 0; });
    var list = [{ label: 'Everyone', shares: all }, { label: 'Not me', shares: notMe }];
    PEOPLE.forEach(function (n) { if (n !== me) { var s = Object.assign({}, pair); s[me] = 1; s[n] = 1; list.push({ label: 'Me & ' + n, shares: s }); } });
    return list;
  }
  function same(a, b) { return PEOPLE.every(function (n) { return (a[n] || 0) === (b[n] || 0); }); }

  function paintSheet() {
    var pence = toPence($('#amt').value);
    var parts = split(pence, draft.shares);
    var total = PEOPLE.reduce(function (a, n) { return a + draft.shares[n]; }, 0);

    $('#split-bar').innerHTML = PEOPLE.map(function (n) {
      var w = total ? draft.shares[n] / total * 100 : 0;
      return '<span style="width:' + w + '%;background:' + color(n) + '"></span>';
    }).join('');

    $('#split-people').innerHTML = PEOPLE.map(function (n) {
      var w = draft.shares[n];
      return '<li class="person' + (w ? '' : ' off') + '">' +
        '<span class="name"><span class="dot" style="background:' + color(n) + '"></span>' + n + (n === state.me ? ' (you)' : '') + '</span>' +
        '<span class="stepper"><button type="button" data-step="' + n + '" data-d="-1" aria-label="Less for ' + n + '"' + (w ? '' : ' disabled') + '>−</button>' +
        '<output aria-label="' + n + ' shares">' + w + '</output>' +
        '<button type="button" data-step="' + n + '" data-d="1" aria-label="More for ' + n + '">+</button></span>' +
        '<span class="share num">' + gbp(parts[n]) + '</span></li>';
    }).join('');

    $('#presets').innerHTML = presetsFor().map(function (p, i) {
      return '<button type="button" class="pill" data-preset="' + i + '" aria-pressed="' + same(p.shares, draft.shares) + '">' + p.label + '</button>';
    }).join('');

    $('#payer').innerHTML = PEOPLE.map(function (n) {
      return '<button type="button" data-payer="' + n + '" aria-pressed="' + (draft.payer === n) + '">' + (n === state.me ? 'Me' : n) + '</button>';
    }).join('');

    var msg;
    if (!pence) msg = 'Enter an amount';
    else if (!total) msg = 'Give at least one person a share';
    else {
      var mine = -parts[state.me] + (draft.payer === state.me ? pence : 0);
      msg = mine > 0 ? 'You’ll be owed ' + gbp(mine) + ' more' : mine < 0 ? 'You’ll owe ' + gbp(-mine) + ' more' : 'Doesn’t change your balance';
    }
    $('#summary').textContent = msg;
    $('#save').disabled = !pence || !total;
  }

  form.addEventListener('input', function (e) { if (e.target.id === 'amt') paintSheet(); });
  form.addEventListener('click', function (ev) {
    var t = ev.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-close')) { closeAdd(); return; }
    if (t.dataset.step) {
      var n = t.dataset.step;
      draft.shares[n] = Math.max(0, Math.min(9, draft.shares[n] + Number(t.dataset.d)));
      paintSheet(); return;
    }
    if (t.dataset.preset) { draft.shares = Object.assign({}, presetsFor()[Number(t.dataset.preset)].shares); paintSheet(); return; }
    if (t.dataset.payer) { draft.payer = t.dataset.payer; paintSheet(); }
  });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pence = toPence($('#amt').value);
    var shares = {};
    PEOPLE.forEach(function (n) { if (draft.shares[n] > 0) shares[n] = draft.shares[n]; });
    if (!pence || !Object.keys(shares).length) return;
    var btn = $('#save'); btn.disabled = true; btn.textContent = 'Saving…';
    store.add({ amount_pence: pence, paid_by: draft.payer, shares: shares, description: $('#desc').value.trim(), kind: 'expense' })
      .then(function () { closeAdd(); toast('Saved'); return load(); })
      .catch(function (e) { toast(e.message); })
      .then(function () { btn.textContent = 'Save payment'; btn.disabled = false; });
  });

  // Refresh when the app comes back to the foreground so everyone sees new entries.
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.me) load(); });

  render();
  load();
})();
