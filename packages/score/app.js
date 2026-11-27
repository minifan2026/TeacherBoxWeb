/* 班级分数 —— 本机加密存储的课堂加减分小工具 */
(function () {
  'use strict';

  var DEF_PW = '2147483647';          // 默认密码：IntMax 的值（改密码后作废）
  var LEGACY_PW = 'IntMax2026';       // 1.1 版的默认密码：老数据用它加密，只用来自动迁移
  var K_VAULT = 'tbscore.vault.v1';
  var K_META = 'tbscore.meta.v1';
  var ITER = 120000;

  var state = {
    pw: '',
    data: null,
    changedPw: false,
    selected: {},
    filter: '',
    mode: 'id',
    setupFromSettings: false
  };

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2000);
  }

  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }
  function getJSON(key) {
    var s = storeGet(key);
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  /* ---------------- 加解密：密码派生密钥，AES-GCM ---------------- */
  var enc = new TextEncoder();

  function b64(bytes) {
    var arr = new Uint8Array(bytes), s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }
  function unb64(str) {
    var bin = atob(str), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function deriveKey(pw, salt) {
    return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  function sealData(data, pw) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(pw, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(data)));
    }).then(function (ct) {
      return { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
    });
  }

  function unsealData(blob, pw) {
    if (!blob || !blob.salt || !blob.ct) return Promise.resolve(null);
    return deriveKey(pw, unb64(blob.salt)).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    }).then(function (buf) {
      return JSON.parse(new TextDecoder().decode(buf));
    }).catch(function () {
      return null;      // 密码不对 / 数据损坏
    });
  }

  var saveTimer = null;
  function save() {
    if (!state.pw || !state.data) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      sealData(state.data, state.pw).then(function (blob) {
        storeSet(K_VAULT, JSON.stringify(blob));
        storeSet(K_META, JSON.stringify({
          changed: state.changedPw,
          savedAt: Date.now(),
          count: state.data.students.length
        }));
      });
    }, 120);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    if (!state.pw || !state.data) return Promise.resolve();
    return sealData(state.data, state.pw).then(function (blob) {
      storeSet(K_VAULT, JSON.stringify(blob));
      storeSet(K_META, JSON.stringify({
        changed: state.changedPw,
        savedAt: Date.now(),
        count: state.data.students.length
      }));
    });
  }

  /* ---------------- 名单 ---------------- */
  function cmpId(a, b) {
    var na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b), 'zh');
  }

  function parseRoster(text, mode) {
    var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    var list = [];
    if (mode === 'id') {
      lines.forEach(function (line) {
        var m = line.match(/^([0-9A-Za-z._-]+)[\s\u3000]+(.+)$/);
        if (m) list.push({ id: m[1], name: m[2].trim() });
        else list.push({ id: '', name: line });
      });
      list.sort(function (a, b) { return cmpId(a.id, b.id) || a.name.localeCompare(b.name, 'zh'); });
    } else {
      lines.forEach(function (line) { list.push({ id: '', name: line }); });
      list.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    }
    return list.map(function (r) { return { id: r.id, name: r.name, pts: 0, spent: 0 }; });
  }

  /* ---------------- 数据操作 ---------------- */
  function balanceOf(stu) { return round1(stu.pts - stu.spent); }

  function pushLog(data, kind, stu, amount, note) {
    data.log.unshift({
      ts: Date.now(),
      kind: kind,
      name: stu.name,
      id: stu.id,
      amount: amount,
      note: note || ''
    });
    if (data.log.length > 500) data.log.length = 500;
  }

  // 加分 / 减分：只记荣誉分，减分不设下限（可以扣成负数），兑换另有约束
  function applyAdj(data, stu, delta, reason) {
    delta = round1(Number(delta));
    if (!isFinite(delta) || delta === 0) return 'zero';
    stu.pts = round1(stu.pts + delta);
    pushLog(data, delta > 0 ? 'add' : 'sub', stu, delta, reason);
    return '';
  }

  // 兑换：只扣 spent，不动 pts；不允许余额为负
  function tryRedeem(data, stu, amount, item) {
    amount = round1(Number(amount));
    if (!isFinite(amount) || amount <= 0) return 'amount';
    if (amount > balanceOf(stu) + 1e-9) return 'balance';
    stu.spent = round1(stu.spent + amount);
    pushLog(data, 'redeem', stu, -amount, item);
    return '';
  }

  // 名次：按荣誉分（pts）降序，同分同名次
  function rankList(list) {
    var sorted = list.slice().sort(function (a, b) {
      return (b.pts - a.pts) || a.name.localeCompare(b.name, 'zh') || cmpId(a.id, b.id);
    });
    var ranks = {}, lastPts = null, lastRank = 0;
    sorted.forEach(function (s, i) {
      if (lastPts === null || s.pts !== lastPts) { lastRank = i + 1; lastPts = s.pts; }
      ranks[s._key] = lastRank;
    });
    return { sorted: sorted, ranks: ranks };
  }

  function keyOf(stu, i) { return stu.id ? 'i:' + stu.id : 'n:' + stu.name + '#' + i; }

  /* ---------------- 渲染 ---------------- */
  function visibleStudents() {
    var data = state.data;
    var q = state.filter.trim().toLowerCase();
    var byKey = {};
    data.students.forEach(function (s, i) { s._key = keyOf(s, i); byKey[s._key] = s; });
    var sorted = rankList(data.students).sorted;
    if (!data.settings.dynamicSort) {
      // 名单顺序（学号/名称序），名次仍然按分数
      sorted = data.students.slice();
    }
    return sorted.filter(function (s) {
      if (!q) return true;
      return (s.name + ' ' + s.id).toLowerCase().indexOf(q) >= 0;
    });
  }

  function render() {
    if (!state.data) return;
    var data = state.data;
    data.students.forEach(function (s, i) { s._key = keyOf(s, i); });
    var ranks = rankList(data.students).ranks;
    var list = visibleStudents();

    $('stat').textContent = data.students.length + ' 人';
    var totalAdd = 0, totalSpent = 0;
    data.students.forEach(function (s) {
      if (s.pts > 0) totalAdd += s.pts;
      totalSpent += s.spent;
    });
    $('sumInfo').textContent = '累计荣誉分 ' + round1(totalAdd) + ' ｜ 已兑换 ' + round1(totalSpent) +
      (data.settings.dynamicSort ? ' ｜ 动态排序：开' : '');

    var rows = $('rows');
    rows.textContent = '';
    list.forEach(function (s) {
      var tr = document.createElement('tr');
      var rk = ranks[s._key] || 0;
      if (rk === 1) tr.className = 'top1';
      else if (rk === 2) tr.className = 'top2';
      else if (rk === 3) tr.className = 'top3';

      var chk = document.createElement('td');
      chk.className = 'c-chk';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!state.selected[s._key];
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected[s._key] = true;
        else delete state.selected[s._key];
        renderBatch();
      });
      chk.appendChild(cb);
      tr.appendChild(chk);

      var rank = document.createElement('td');
      rank.className = 'c-rank';
      rank.textContent = rk ? String(rk) : '—';
      tr.appendChild(rank);

      var nm = document.createElement('td');
      nm.className = 'c-name';
      var nameEl = document.createElement('span');
      nameEl.className = 'name';
      nameEl.textContent = s.name;
      nm.appendChild(nameEl);
      tr.appendChild(nm);

      var idTd = document.createElement('td');
      idTd.className = 'c-id';
      idTd.textContent = s.id || '—';
      tr.appendChild(idTd);

      var pts = document.createElement('td');
      pts.className = 'c-num pts';
      pts.textContent = String(s.pts);
      tr.appendChild(pts);

      var spent = document.createElement('td');
      spent.className = 'c-num spent';
      spent.textContent = String(s.spent);
      tr.appendChild(spent);

      var bal = document.createElement('td');
      var bv = balanceOf(s);
      bal.className = 'c-num bal' + (bv < 0 ? ' neg' : (bv < 3 ? ' low' : ''));
      bal.textContent = String(balanceOf(s));
      tr.appendChild(bal);

      var ops = document.createElement('td');
      ops.className = 'c-ops';
      var wrap = document.createElement('div');
      wrap.className = 'ops';
      wrap.appendChild(miniBtn('+1', 'plus', function () { quickAdj(s, 1); }));
      wrap.appendChild(miniBtn('+2', 'plus', function () { quickAdj(s, 2); }));
      wrap.appendChild(miniBtn('−1', 'minus', function () { quickAdj(s, -1); }));
      wrap.appendChild(miniBtn('自定义', 'more', function () { openAdjust(s); }));
      wrap.appendChild(miniBtn('兑换', 'more', function () { openRedeem(s); }));
      ops.appendChild(wrap);
      tr.appendChild(ops);

      rows.appendChild(tr);
    });

    if (list.length === 0) {
      var tr2 = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8;
      td.style.padding = '26px';
      td.style.textAlign = 'center';
      td.style.color = '#867f70';
      td.textContent = state.data.students.length ? '没有匹配的同学' : '名单是空的，去「设置 → 重新导入名单」';
      tr2.appendChild(td);
      rows.appendChild(tr2);
    }

    // 全选框状态
    var chkAll = $('chkAll');
    var allSel = list.length > 0 && list.every(function (s) { return state.selected[s._key]; });
    chkAll.checked = allSel;
    renderBatch();
  }

  function miniBtn(text, cls, fn) {
    var b = document.createElement('button');
    b.className = 'mini ' + cls;
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  function renderBatch() {
    var n = Object.keys(state.selected).length;
    var bar = $('batchBar');
    bar.classList.toggle('hidden', n === 0);
    $('batchInfo').textContent = '已选 ' + n + ' 人';
  }

  function quickAdj(stu, delta) {
    var r = applyAdj(state.data, stu, delta, delta > 0 ? '快速加分' : '快速减分');
    if (r === 'zero') return;
    save(); render();
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(title, build) {
    $('modalTitle').textContent = title;
    var body = $('modalBody');
    body.textContent = '';
    build(body);
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  // 需要老师看清的提示：独立弹窗，而不是一闪而过的 toast
  function alertModal(title, lines, after) {
    openModal(title, function (body) {
      lines.forEach(function (t, i) {
        var p = document.createElement('p');
        p.className = i === 0 ? 'alert-main' : 'alert-sub';
        p.textContent = t;
        body.appendChild(p);
      });
      body.appendChild(actionsEl([{
        label: '知道了', cls: 'primary', fn: function () {
          closeModal();
          if (after) after();
        }
      }]));
    });
  }

  function field(labelText, input) {
    var f = document.createElement('div');
    f.className = 'field';
    var lb = document.createElement('label');
    lb.textContent = labelText;
    f.appendChild(lb);
    f.appendChild(input);
    return f;
  }

  function inputEl(type, value, placeholder) {
    var i = document.createElement('input');
    i.type = type || 'text';
    if (value != null) i.value = value;
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  function actionsEl(buttons) {
    var a = document.createElement('div');
    a.className = 'modal-actions';
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.addEventListener('click', b.fn);
      a.appendChild(btn);
    });
    return a;
  }

  function openAdjust(stu) {
    var val = inputEl('number', 1, '分值');
    val.step = '0.5';
    var reason = inputEl('text', '', '原因（可空）');
    openModal('给 ' + stu.name + ' 加减分', function (body) {
      body.appendChild(field('分值（正数加分，负数减分）', val));
      body.appendChild(field('原因', reason));
      body.appendChild(actionsEl([
        { label: '取消', cls: 'ghost', fn: closeModal },
        {
          label: '确定', cls: 'primary', fn: function () {
            var d = round1(parseFloat(val.value));
            if (!isFinite(d) || d === 0) return toast('分值要填一个非 0 的数');
            var r = applyAdj(state.data, stu, d, reason.value.trim());
            if (r === 'zero') return toast('分值要填一个非 0 的数');
            save(); render(); closeModal();
            toast((d > 0 ? '加分 ' : '减分 ') + Math.abs(d) + '：' + stu.name + ' → ' + balanceOf(stu));
          }
        }
      ]));
    });
  }

  function openRedeem(preset, preAmount, preItem) {
    var sel = document.createElement('select');
    state.data.students.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = s.name + (s.id ? '（' + s.id + '）' : '') + ' 余额 ' + balanceOf(s);
      sel.appendChild(o);
    });
    if (preset) {
      state.data.students.forEach(function (s, i) { if (s === preset) sel.value = String(i); });
    }
    var amount = inputEl('number', preAmount != null && preAmount !== '' ? preAmount : 3, '要扣的分');
    amount.step = '0.5';
    amount.min = '0.5';
    var item = inputEl('text', preItem || '', '兑换什么（如 小奖品 / 一次免作业）');
    var info = document.createElement('p');
    info.className = 'hint';
    function refresh() {
      var s = state.data.students[parseInt(sel.value, 10)] || state.data.students[0];
      info.textContent = s ? ('当前余额 ' + balanceOf(s) + '（荣誉分 ' + s.pts + '，已兑换 ' + s.spent + '）') : '';
    }
    sel.addEventListener('change', refresh);
    refresh();

    openModal('兑换', function (body) {
      body.appendChild(field('学生', sel));
      body.appendChild(info);
      body.appendChild(field('扣分', amount));
      body.appendChild(field('兑换内容', item));
      body.appendChild(actionsEl([
        { label: '取消', cls: 'ghost', fn: closeModal },
        {
          label: '兑换', cls: 'primary', fn: function () {
            var s = state.data.students[parseInt(sel.value, 10)];
            var a = round1(parseFloat(amount.value));
            var it = item.value.trim();
            var r = tryRedeem(state.data, s, a, it);
            if (r === 'amount') return toast('扣分要填大于 0 的数');
            if (r === 'balance') {
              closeModal();
              alertModal('不能兑换：余额不够', [
                s.name + ' 现在只有 ' + balanceOf(s) + ' 分，这次要扣 ' + (isFinite(a) ? a : '—') + ' 分。',
                '兑换只能扣已经挣到的分，不能扣成负数。想多扣，先给 TA 加分；减分已经把分扣成负数的话，也没法用兑换抵。'
              ], function () {
                openRedeem(s, String(amount.value), it);
              });
              return;
            }
            save(); render(); closeModal();
            toast('已兑换：' + s.name + ' 扣 ' + a + '，余额 ' + balanceOf(s));
          }
        }
      ]));
    });
  }

  function openHonor() {
    var data = state.data;
    var byPts = rankList(data.students).sorted;
    var top = byPts.slice(0, 5);
    var bottom = byPts.slice().reverse().slice(0, 3);

    function col(title, list, startRank, isTop) {
      var c = document.createElement('div');
      c.className = 'honor-col';
      var h = document.createElement('h3');
      h.textContent = title;
      c.appendChild(h);
      if (!list.length) {
        var e = document.createElement('p');
        e.className = 'hint';
        e.textContent = '还没有人';
        c.appendChild(e);
      }
      list.forEach(function (s, i) {
        var it = document.createElement('div');
        it.className = 'honor-item' + (isTop && i === 0 ? ' top' : '');
        var rk = document.createElement('span');
        rk.className = 'rk';
        rk.textContent = isTop ? 'No.' + (startRank + i + 1) : String(i + 1);
        var nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = s.name + (s.id ? '（' + s.id + '）' : '');
        var sc = document.createElement('span');
        sc.className = 'sc';
        sc.textContent = s.pts + ' 分';
        it.appendChild(rk); it.appendChild(nm); it.appendChild(sc);
        c.appendChild(it);
      });
      return c;
    }

    openModal('荣誉榜', function (body) {
      var grid = document.createElement('div');
      grid.className = 'honor-grid';
      grid.appendChild(col('荣誉榜（按荣誉分）', top, 0, true));
      grid.appendChild(col('需要加油（倒数，兑换不影响）', bottom, 0, false));
      body.appendChild(grid);
      var note = document.createElement('p');
      note.className = 'honor-note';
      note.textContent = '荣誉分只算加分/减分；兑换扣的是余额，不扣荣誉分，所以兑换不会把人拉进倒数。';
      body.appendChild(note);
    });
  }

  function openSettings() {
    openModal('设置', function (body) {
      var pw1 = inputEl('password', '', '新密码');
      var pw2 = inputEl('password', '', '再输一次');
      var sec1 = document.createElement('div');
      var h1 = document.createElement('h3');
      h1.textContent = '修改密码';
      h1.style.cssText = 'font-size:13.5px;margin:0 0 8px';
      sec1.appendChild(h1);
      sec1.appendChild(field('新密码', pw1));
      sec1.appendChild(field('确认新密码', pw2));
      sec1.appendChild(actionsEl([{
        label: '改密码', fn: function () {
          var a = pw1.value.trim(), b = pw2.value.trim();
          if (a.length < 4) return toast('密码至少 4 位');
          if (a !== b) return toast('两次输入不一致');
          var oldPw = state.pw;
          sealData(state.data, a).then(function (blob) {
            return unsealData(blob, a).then(function (chk) {
              if (!chk) throw new Error('self-check failed');
              state.pw = a;
              state.changedPw = true;
              return saveNow();
            });
          }).then(function () {
            toast('密码已改成新的（默认密码作废），数据已用新密钥重新加密');
            closeModal();
          }).catch(function () {
            state.pw = oldPw;
            toast('改密码失败，数据没有变动，请重试');
          });
        }
      }]));
      body.appendChild(sec1);

      var sec2 = document.createElement('div');
      sec2.style.marginTop = '16px';
      var h2 = document.createElement('h3');
      h2.textContent = '名单与数据';
      h2.style.cssText = 'font-size:13.5px;margin:0 0 8px';
      sec2.appendChild(h2);
      sec2.appendChild(actionsEl([
        { label: '重新导入名单', fn: function () { closeModal(); startSetup(true); } },
        {
          label: '清空所有人分数', cls: 'danger', fn: function () {
            if (!confirm('确定把所有分数和兑换记录清零？名字保留。')) return;
            state.data.students.forEach(function (s) { s.pts = 0; s.spent = 0; });
            state.data.log = [];
            save(); render(); closeModal();
            toast('分数已清零');
          }
        },
        { label: '查看操作记录', fn: function () { openLog(); } }
      ]));
      body.appendChild(sec2);
    });
  }

  function openLog() {
    var list = document.createElement('div');
    list.className = 'log-list';
    var data = state.data;
    if (!data.log.length) {
      list.textContent = '还没有记录';
    }
    data.log.slice(0, 60).forEach(function (l) {
      var d = document.createElement('div');
      var t = new Date(l.ts);
      var head = pad(t.getMonth() + 1, 2) + '-' + pad(t.getDate(), 2) + ' ' +
        pad(t.getHours(), 2) + ':' + pad(t.getMinutes(), 2) + '  ';
      var kind = l.kind === 'redeem' ? '兑换' : (l.amount > 0 ? '加分' : '减分');
      var b = document.createElement('b');
      b.textContent = l.name;
      d.appendChild(document.createTextNode(head));
      d.appendChild(b);
      d.appendChild(document.createTextNode(' ' + kind + ' ' + (l.amount > 0 ? '+' : '') + l.amount +
        (l.note ? '（' + l.note + '）' : '')));
      list.appendChild(d);
    });
    openModal('操作记录（最近 60 条）', function (body) { body.appendChild(list); });
  }

  /* ---------------- 导出 ---------------- */
  function exportCsv() {
    var data = state.data;
    var ranks = rankList(data.students).ranks;
    var lines = ['名次,姓名,学号,荣誉分,已兑换,余额'];
    data.students.forEach(function (s, i) {
      s._key = keyOf(s, i);
      lines.push([ranks[s._key], quoteCsv(s.name), s.id, s.pts, s.spent, balanceOf(s)].join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '班级分数-' + ymd() + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出 CSV');
  }
  function quoteCsv(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
  function ymd() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
  }

  /* ---------------- 流程 ---------------- */
  function showGate() {
    $('gate').classList.remove('hidden');
    $('setup').classList.add('hidden');
    $('main').classList.add('hidden');
    $('gateHint').textContent = '';
    $('pw').value = '';
    setTimeout(function () { $('pw').focus(); }, 50);
  }

  function showSetup() {
    $('gate').classList.add('hidden');
    $('main').classList.add('hidden');
    $('setup').classList.remove('hidden');
    updateRosterInfo();
    $('rosterText').focus();
  }

  function showMain() {
    $('gate').classList.add('hidden');
    $('setup').classList.add('hidden');
    $('main').classList.remove('hidden');
    $('chkDynamic').checked = !!state.data.settings.dynamicSort;
    render();
  }

  function updateRosterInfo() {
    var list = parseRoster($('rosterText').value, state.mode);
    var dup = 0;
    var names = {};
    list.forEach(function (s) {
      if (names[s.name]) dup++;
      names[s.name] = true;
    });
    $('rosterInfo').textContent = list.length + ' 人' + (dup ? '（有 ' + dup + ' 个重名）' : '');
  }

  function startSetup(fromSettings) {
    state.setupFromSettings = !!fromSettings;
    state.mode = 'id';
    var btns = document.querySelectorAll('[data-mode]');
    btns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === 'id'); });
    $('rosterText').value = '';
    if (fromSettings && state.data) {
      // 预填现有名单，方便改一个人重导（分数会重算）
      $('rosterText').value = state.data.students.map(function (s) {
        return (s.id ? s.id + ' ' : '') + s.name;
      }).join('\n');
    }
    showSetup();
  }

  function enterMain(data, pw) {
    state.data = data;
    state.pw = pw;
    if (!state.data.settings) state.data.settings = {};
    if (!state.data.log) state.data.log = [];
    var meta = getJSON(K_META);
    state.changedPw = !!(meta && meta.changed);
    state.selected = {};
    showMain();
  }

  function attemptUnlock() {
    var pw = $('pw').value.trim();
    if (!pw) { $('gateHint').textContent = '先输密码'; return; }
    var blob = getJSON(K_VAULT);
    var hint = $('gateHint');
    if (!blob) {
      if (pw !== DEF_PW) { hint.textContent = '密码不对（首次使用请用默认密码，点「查看默认密码」）'; return; }
      state.pw = pw;
      state.changedPw = false;
      startSetup(false);
      return;
    }
    hint.textContent = '正在解锁…';
    unsealData(blob, pw).then(function (data) {
      if (data) { enterMain(data, pw); return; }
      var meta = getJSON(K_META);
      // 新默认密码打不开时，再试 1.1 的老默认密码：老数据是 IntMax2026 加密的
      if (pw !== DEF_PW || (meta && meta.changed)) {
        hint.innerHTML = '密码不对' + (meta && meta.changed ? '（你改过密码，默认密码已失效）' : '（默认密码见按钮）');
        return;
      }
      unsealData(blob, LEGACY_PW).then(function (old) {
        if (!old) {
          hint.innerHTML = '密码不对（默认密码见按钮）';
          return;
        }
        enterMain(old, DEF_PW);
        saveNow();
        hint.textContent = '';
        toast('老数据已按新默认密码重新加密，以后用 ' + DEF_PW + ' 打开');
      });
    });
  }

  function lock() {
    clearTimeout(saveTimer);
    state.pw = '';
    state.data = null;
    state.selected = {};
    closeModal();
    showGate();
  }

  /* ---------------- 绑定 ---------------- */
  $('btnEnter').addEventListener('click', attemptUnlock);
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') attemptUnlock(); });

  $('btnShowDefault').addEventListener('click', function () {
    var meta = getJSON(K_META);
    var h = $('gateHint');
    if (!getJSON(K_VAULT)) {
      h.innerHTML = '默认密码：<b>' + DEF_PW + '</b>（第一次用就用它，进去后可以改）';
    } else if (meta && meta.changed) {
      h.innerHTML = '默认密码是 <b>' + DEF_PW + '</b>，但你改过密码，它已经失效了——用你改的那个。';
    } else {
      h.innerHTML = '默认密码：<b>' + DEF_PW + '</b>（没改过密码的话就是它；1.1 版的老数据输它也能自动迁移）';
    }
  });

  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.mode = b.getAttribute('data-mode');
      document.querySelectorAll('[data-mode]').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      updateRosterInfo();
    });
  });
  $('rosterText').addEventListener('input', updateRosterInfo);

  $('btnMakeRoster').addEventListener('click', function () {
    var list = parseRoster($('rosterText').value, state.mode);
    if (list.length === 0) return toast('名单是空的，先粘贴/输入每行一个人');
    var isRe = state.setupFromSettings && state.data;
    if (isRe && !confirm('重新导入会覆盖现有名单并清掉全部分数，继续？')) return;
    var data = isRe ? state.data : { students: [], log: [], settings: { dynamicSort: false }, created: Date.now() };
    data.students = list;
    data.log = [];
    data.settings = data.settings || { dynamicSort: false };
    state.data = data;
    state.selected = {};
    saveNow().then(function () {
      showMain();
      toast('名单已建立：' + list.length + ' 人' + (state.mode === 'id' ? '（按学号升序）' : '（按名称升序）'));
    });
  });

  $('chkDynamic').addEventListener('change', function () {
    state.data.settings.dynamicSort = $('chkDynamic').checked;
    save(); render();
  });

  $('filter').addEventListener('input', function () {
    state.filter = $('filter').value;
    render();
  });

  $('chkAll').addEventListener('change', function () {
    var list = visibleStudents();
    if ($('chkAll').checked) list.forEach(function (s) { state.selected[s._key] = true; });
    else state.selected = {};
    render();
  });

  $('btnBatchAdd').addEventListener('click', function () { batchAdj(1); });
  $('btnBatchSub').addEventListener('click', function () { batchAdj(-1); });
  $('btnBatchClear').addEventListener('click', function () { state.selected = {}; render(); });

  function batchAdj(sign) {
    var v = Math.abs(round1(parseFloat($('batchVal').value)));
    if (!isFinite(v) || v <= 0) return toast('分值要大于 0');
    var reason = $('batchReason').value.trim();
    var picked = [];
    state.data.students.forEach(function (s, i) {
      s._key = keyOf(s, i);
      if (state.selected[s._key]) picked.push(s);
    });
    if (!picked.length) return toast('先勾选同学');
    picked.forEach(function (s) {
      applyAdj(state.data, s, sign * v, reason);
    });
    state.selected = {};
    save(); render();
    toast('已' + (sign > 0 ? '加分' : '减分') + ' ' + v + ' 给 ' + picked.length + ' 人');
  }

  $('btnHonor').addEventListener('click', openHonor);
  $('btnRedeem').addEventListener('click', function () { openRedeem(null); });
  $('btnExport').addEventListener('click', exportCsv);
  $('btnSettings').addEventListener('click', openSettings);
  $('btnLock').addEventListener('click', lock);
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  /* ---------------- 自检（?test=1） ---------------- */
  function runSelfTest() {
    var out = $('selftest');
    var log = [];
    function ok(name, cond, extra) { log.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); }
    out.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;background:#fff;border:1px solid #999;padding:8px;max-height:92vh;overflow:auto';

    (function () {
      // 名单解析与排序
      var r1 = parseRoster('12 王五\n03 张三\n01 李四', 'id');
      ok('学号名单按学号升序', r1[0].id === '01' && r1[1].id === '03' && r1[2].id === '12',
        r1.map(function (s) { return s.id + s.name; }).join('/'));
      var r2 = parseRoster('张三\n李四\n王五', 'name');
      ok('名称名单升序', r2.length === 3, r2.map(function (s) { return s.name; }).join('/'));

      var data = { students: r1, log: [], settings: {} };
      var a = data.students[0], b = data.students[1];
      ok('加分累加', applyAdj(data, a, 5, '课堂') === '' && a.pts === 5, 'pts=' + a.pts);
      ok('减分可以扣成负分', applyAdj(data, b, -2, '') === '' && b.pts === -2, 'pts=' + b.pts);
      applyAdj(data, b, 2, '');
      ok('负分能加回 0', b.pts === 0, 'pts=' + b.pts);

      ok('兑换余额不足被拒', tryRedeem(data, b, 1, '糖') === 'balance', 'bal=' + balanceOf(b));
      applyAdj(data, a, 0.5, '');
      ok('兑换扣余额不扣荣誉分', tryRedeem(data, a, 3, '免作业') === '' && a.pts === 5.5 && a.spent === 3 && balanceOf(a) === 2.5,
        'pts=' + a.pts + ' spent=' + a.spent + ' bal=' + balanceOf(a));

      var rk = rankList(data.students);
      ok('名次按荣誉分（兑换不影响）', rk.sorted[0].name === a.name, rk.sorted.map(function (s) { return s.name + s.pts; }).join('/'));
      var c = data.students[2];
      applyAdj(data, c, 5.5, '');
      data.students.forEach(function (s, i) { s._key = keyOf(s, i); });
      var rk2 = rankList(data.students).ranks;
      ok('并列第一都算第 1', rk2[keyOf(a)] === 1 && rk2[keyOf(c)] === 1, 'a=' + rk2[keyOf(a)] + ' c=' + rk2[keyOf(c)]);

      ok('运行在安全上下文（crypto.subtle 可用）', !!(window.isSecureContext && crypto && crypto.subtle),
        'secure=' + window.isSecureContext + ' subtle=' + !!(crypto && crypto.subtle));
      out.textContent = log.join('\n');   // 先落同步结果，再看异步

      // 加解密
      var payload = { hello: '班级分数', n: [1, 2, 3] };
      if (!(crypto && crypto.subtle)) {
        log.push('FAIL 没有 crypto.subtle，加密不可用');
        out.textContent = log.join('\n');
        return;
      }
      sealData(payload, '2147483647').then(function (blob) {
        return unsealData(blob, '2147483647').then(function (got) {
          ok('加密后能用同一密码解开', !!got && got.hello === '班级分数', JSON.stringify(got));
          return unsealData(blob, 'wrong-pass').then(function (bad) {
            ok('错密码解不开', bad === null, String(bad));
          });
        });
      }).then(function () {
        // 默认密码：新值 2147483647；1.1 老的 IntMax2026 能解老数据
        return sealData(payload, LEGACY_PW).then(function (oldBlob) {
          return unsealData(oldBlob, DEF_PW).then(function (bad) {
            ok('新默认密码解不开 1.1 的老数据（必须走迁移）', bad === null, String(bad));
            return unsealData(oldBlob, LEGACY_PW).then(function (got) {
              ok('老数据用老默认密码能解开', !!got && got.hello === '班级分数', JSON.stringify(got));
            });
          });
        });
      }).then(function () {
        // 存储往返
        storeSet(K_VAULT + '.test', JSON.stringify({ x: 1 }));
        var back = getJSON(K_VAULT + '.test');
        try { localStorage.removeItem(K_VAULT + '.test'); } catch (e) {}
        ok('localStorage 可读写', !!back && back.x === 1, JSON.stringify(back));
      }).catch(function (e) {
        log.push('FAIL 自检异常 :: ' + (e && e.message));
      }).then(function () {
        out.textContent = log.join('\n');
      });
    })();
  }

  /* ---------------- 启动 ---------------- */
  window.__score = {
    DEF_PW: DEF_PW,
    parseRoster: parseRoster,
    applyAdj: applyAdj,
    tryRedeem: tryRedeem,
    rankList: rankList,
    balanceOf: balanceOf,
    sealData: sealData,
    unsealData: unsealData
  };

  var q = location.search;
  if (q.indexOf('test=1') >= 0) {
    runSelfTest();
  } else if (q.indexOf('demo=1') >= 0) {
    // 截图演示：不读存储、不写存储
    state.data = {
      students: parseRoster('01 陈一\n02 李二\n03 王三\n04 赵四\n05 钱五\n06 孙六\n07 周七\n08 吴八', 'id'),
      log: [],
      settings: { dynamicSort: true }
    };
    state.pw = 'demo';
    state.data.students[0].pts = 12;
    state.data.students[1].pts = 9;
    state.data.students[2].pts = 8;
    state.data.students[3].pts = 6;
    state.data.students[4].pts = 5;
    state.data.students[5].pts = 4;
    state.data.students[6].pts = 2;
    state.data.students[7].pts = 1;
    state.data.students[2].spent = 3;
    state.data.students[5].spent = 2;
    showMain();
  } else {
    showGate();
  }
})();
