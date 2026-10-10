// Executed inside the sandboxed exercise iframe; talks to the app only through postMessage.
export const RUNTIME = String.raw`(function () {
  var post = function (type, data) { parent.postMessage(Object.assign({ zb: 1, type: type }, data || {}), '*'); };
  var handlers = {};
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var answered = false, hints = 0, started = performance.now();
  var media = {};
  var tail = function (u) { var i = String(u).indexOf('/deck/'); return i >= 0 ? String(u).slice(i + 6).replace(/^topics\//, '') : String(u).slice(0, 40); };
  window.addEventListener('error', function (e) { post('log', { msg: 'frame error', data: { message: e.message, line: e.lineno } }); });
  window.addEventListener('unhandledrejection', function (e) { post('log', { msg: 'frame rejection', data: String(e.reason) }); });
  var audio = new Audio();
  var ms = function () { return Math.round(performance.now() - started); };
  function reveal() { $$('[data-zb-back]').forEach(function (e) { e.hidden = false; }); $$('[data-zb="flip"]').forEach(function (b) { b.disabled = true; }); }
  function lock() { $$('[data-zb-choice],[data-zb-chip],[data-zb-input],[data-zb="submit"],[data-zb="hint"]').forEach(function (e) { e.disabled = true; }); }
  var zb = {
    $: $, $$: $$,
    on: function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit: function (evt, data) { (handlers[evt] || []).forEach(function (f) { f(data); }); },
    answer: function (value) { if (answered) return; answered = true; lock(); post('answer', { value: value, ms: ms(), hints: hints }); },
    flip: function () { if (answered) return; answered = true; reveal(); post('flip', { ms: ms(), hints: hints }); },
    grade: function (g) { post('grade', { grade: g }); },
    skip: function (reason) { post('skip', { reason: reason || 'later' }); },
    hint: function () { hints++; $$('[data-zb-hint]').forEach(function (e) { e.hidden = false; }); $$('[data-zb="hint"]').forEach(function (b) { b.hidden = true; }); post('hint'); },
    play: function (src, rate) {
      // Play inside this frame, synchronously within the tap: mobile browsers block audio started after async hops.
      var local = media[src];
      zb.log('play tapped', { src: tail(src), local: !!local, loaded: Object.keys(media).length });
      if (!local) { zb.log('no local audio yet, asking app to play'); post('play', { src: src, rate: rate || 1 }); return; }
      audio.pause();
      audio.src = local;
      audio.playbackRate = rate || 1;
      post('stop-audio');
      audio.play().then(function () { zb.log('playing in frame', tail(src)); }, function (e) {
        zb.log('frame play failed, asking app', { src: tail(src), error: e && e.name, message: e && e.message });
        post('play', { src: src, rate: rate || 1 });
      });
    },
    log: function (msg, data) { post('log', { msg: msg, data: data }); },
    next: function () { post('next'); },
    get answered() { return answered; }
  };
  window.zb = zb;
  window.__zbStart = function () { if (window.__zbLogic) window.__zbLogic(zb); };

  var slot = $('[data-zb-slot]');
  var submitBtn = $('[data-zb="submit"]');
  function slotTokens() { return slot ? Array.prototype.map.call(slot.children, function (c) { return c.dataset.zbChip; }) : []; }
  function updateSubmit() { if (submitBtn && slot) submitBtn.disabled = slot.children.length === 0; }
  function addChip(chip) {
    if (answered || chip.classList.contains('ghost')) return;
    var copy = chip.cloneNode(true);
    copy.addEventListener('click', function () { if (answered) return; copy.remove(); chip.classList.remove('ghost'); updateSubmit(); });
    slot.appendChild(copy); chip.classList.add('ghost'); updateSubmit();
  }
  function removeLastChip() {
    if (!slot || !slot.lastElementChild || answered) return;
    var last = slot.lastElementChild; var word = last.dataset.zbChip; last.remove();
    var ghost = $$('.zb-bank [data-zb-chip].ghost').filter(function (c) { return c.dataset.zbChip === word; }).pop();
    if (ghost) ghost.classList.remove('ghost');
    updateSubmit();
  }
  var inputs = $$('[data-zb-input]');
  function submit() {
    if (answered) return;
    if (slot) { if (slot.children.length) zb.answer({ tokens: slotTokens() }); return; }
    if (inputs.length === 1 && inputs[0].tagName === 'TEXTAREA') { if (inputs[0].value.trim()) zb.answer({ text: inputs[0].value.trim() }); return; }
    if (inputs.length > 1 || $('[data-gap]')) { zb.answer({ texts: inputs.map(function (i) { return i.value; }) }); return; }
    if (inputs.length === 1) { if (inputs[0].value.trim()) zb.answer({ text: inputs[0].value }); }
  }
  $$('[data-zb-chip]').forEach(function (chip) { chip.addEventListener('click', function () { addChip(chip); }); });
  $$('[data-zb-choice]').forEach(function (btn) {
    btn.addEventListener('click', function () { if (answered) return; btn.classList.add('picked'); zb.answer({ choice: btn.dataset.zbChoice }); });
  });
  inputs.forEach(function (input, i) {
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      // In a free-text box Enter is a new line; Cmd/Ctrl+Enter sends the answer.
      if (input.tagName === 'TEXTAREA' && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault(); e.stopPropagation();
      if (answered) { post('key', { key: 'Enter' }); return; }
      if (i < inputs.length - 1 && !inputs[i + 1].value) { inputs[i + 1].focus(); return; }
      submit();
    });
  });
  document.addEventListener('click', function (e) {
    if (answered && !e.target.closest('button, input, a')) { post('tap'); return; }
    var el = e.target.closest('[data-zb]');
    if (!el || el.disabled) return;
    var action = el.dataset.zb;
    if (action === 'submit') submit();
    else if (action === 'flip') zb.flip();
    else if (action === 'next') zb.next();
    else if (action === 'hint') zb.hint();
    else if (action === 'play') zb.play(el.dataset.src, parseFloat(el.dataset.rate || '1'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var options = $$('[data-zb-choice]');
    if (!answered && /^[1-9]$/.test(e.key) && options[Number(e.key) - 1]) { options[Number(e.key) - 1].click(); return; }
    if (!answered && e.key === 'Backspace' && slot) { e.preventDefault(); removeLastChip(); return; }
    if (!answered && (e.key === 'Enter' || e.key === ' ')) {
      var flip = $('[data-zb="flip"]'), next = $('[data-zb="next"]');
      e.preventDefault();
      if (flip) { zb.flip(); return; }
      if (next) { zb.next(); return; }
      if (submitBtn && !submitBtn.disabled) { submit(); return; }
    }
    if (e.key === ' ' || (answered && e.key.indexOf('Arrow') === 0)) e.preventDefault();
    post('key', { key: e.key });
  });
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (!m.zb) return;
    if (m.type === 'theme') document.documentElement.dataset.theme = m.theme;
    if (m.type === 'gloss-result') showTip(m);
    if (m.type === 'media') (m.files || []).forEach(function (f) {
      media[f.url] = URL.createObjectURL(new Blob([f.buffer], { type: f.type || 'audio/mpeg' }));
      zb.log('media received', { src: tail(f.url), bytes: f.buffer && f.buffer.byteLength, type: f.type });
    });
    if (m.type === 'focus') { var first = inputs[0]; if (first && !answered) first.focus(); else document.body.focus(); }
    if (m.type === 'graded') {
      answered = true; lock(); reveal();
      var mark = function (path) { return '<svg class="zb-mark" viewBox="0 0 24 24"><path d="' + path + '"/></svg>'; };
      $$('[data-zb-choice]').forEach(function (b) {
        if (b.dataset.zbChoice === m.expected) { b.classList.add('correct'); b.insertAdjacentHTML('beforeend', mark('M5 12l5 5 9-10')); }
        else if (b.classList.contains('picked')) { b.classList.add('wrong'); b.insertAdjacentHTML('beforeend', mark('M6 6l12 12M18 6 6 18')); }
      });
      var gapMarks = (m.marks && m.marks.gaps) || null;
      inputs.forEach(function (input, i) { input.classList.add(m.typo && m.correct ? 'typo' : (gapMarks ? gapMarks[i] : m.correct) ? 'ok' : 'bad'); });
      if (slot) slot.classList.add(m.correct ? 'ok' : 'bad');
      zb.emit('graded', m);
    }
  });
  // Every English word is tappable and shows its translation; on answer buttons it takes a long press, so a tap still answers.
  var INTERACTIVE = 'button,a,label,input,[data-zb-chip],[data-zb-choice]';
  function wrapWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentElement;
      if (!p || p.closest('script,style,svg,textarea,.zb-gloss,[data-w]')) return NodeFilter.FILTER_REJECT;
      return /[A-Za-z]/.test(n.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    } });
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var holder = document.createElement('span');
      holder.innerHTML = n.textContent.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; })
        .replace(/[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*/g, '<span data-w>$&</span>');
      n.replaceWith.apply(n, Array.prototype.slice.call(holder.childNodes));
    });
  }
  var tip = null, press = null, pressAt = null, suppress = false;
  function hideTip() { if (tip) { tip.remove(); tip = null; } $$('.zb-glossed').forEach(function (w) { w.classList.remove('zb-glossed'); }); }
  function blockOf(el) { return el.closest('p,li,button,td,th,h1,h2,h3,.zb-prompt,.zb-translation,.zb-hint,div') || document.body; }
  function askGloss(el) {
    var list = Array.prototype.slice.call(blockOf(el).querySelectorAll('[data-w]'));
    var r = el.getBoundingClientRect();
    glossWords = list;
    post('gloss', { words: list.map(function (w) { return w.textContent; }), index: list.indexOf(el), rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } });
  }
  var glossWords = [], tipWords = [];
  function showTip(m) {
    hideTip();
    tip = document.createElement('div');
    tip.className = 'zb-gloss' + (m.ru ? '' : ' none') + (m.canKnow ? ' can-know' : '');
    tip.innerHTML = '<b></b><span></span>';
    tip.firstChild.textContent = m.phrase || m.word;
    tip.lastChild.textContent = m.ru || 'нет в словаре колоды';
    if (m.canKnow) { tip.insertAdjacentHTML('beforeend', '<button type="button" class="zb-known" data-zb-known>знаю</button>'); tipWords = m.knownWords; }
    document.body.appendChild(tip);
    if (m.ru) glossWords.slice(m.start, m.start + m.length).forEach(function (w) { w.classList.add('zb-glossed'); });
    var r = m.rect, w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - 8);
    var top = r.top - h - 8 < 4 ? r.bottom + 8 : r.top - h - 8;
    tip.style.left = left + 'px'; tip.style.top = (top + window.scrollY) + 'px';
  }
  wrapWords(document.body);
  document.addEventListener('pointerdown', function (e) {
    var w = e.target.closest && e.target.closest('[data-w]');
    if (!w || !w.closest(INTERACTIVE)) return;
    pressAt = { x: e.clientX, y: e.clientY };
    press = setTimeout(function () { press = null; suppress = true; askGloss(w); }, 450);
  }, true);
  var cancelPress = function () { if (press) { clearTimeout(press); press = null; } };
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('pointermove', function (e) { if (press && pressAt && Math.abs(e.clientX - pressAt.x) + Math.abs(e.clientY - pressAt.y) > 10) cancelPress(); }, true);
  document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('[data-w]')) e.preventDefault(); }, true);
  document.addEventListener('click', function (e) {
    if (suppress) { suppress = false; e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest && e.target.closest('[data-zb-known]')) { e.stopPropagation(); post('known', { words: tipWords }); hideTip(); return; }
    var w = e.target.closest && e.target.closest('[data-w]');
    if (w && !w.closest(INTERACTIVE)) { e.stopPropagation(); askGloss(w); return; }
    hideTip();
  }, true);
  window.addEventListener('scroll', hideTip);

  // A long word (распространённый) in display size is wider than a phone; shrink until the longest word fits, then let it break.
  var FIT = '.zb-prompt.word,.ci-word,.ci-ru,.zb-answer,.zb-md h1,.zb-md h2,.zb-md h3';
  function fit() {
    $$(FIT).forEach(function (el) {
      el.style.fontSize = '';
      el.classList.add('zb-fitting');
      el.classList.remove('zb-tight');
      var size = parseFloat(getComputedStyle(el).fontSize), min = el.matches('.zb-prompt.word,.ci-word,.zb-md h1') ? 18 : 15;
      while (el.scrollWidth > el.clientWidth + 1 && size > min) { size -= 1; el.style.fontSize = size + 'px'; }
      if (el.scrollWidth > el.clientWidth + 1) { el.lang = /[а-яё]/i.test(el.textContent) ? 'ru' : 'en'; el.classList.add('zb-tight'); }
      el.classList.remove('zb-fitting');
    });
  }
  fit();
  if (document.fonts) document.fonts.ready.then(fit);
  window.addEventListener('resize', fit);

  function report() { post('resize', { height: Math.ceil(document.documentElement.scrollHeight) }); }
  new ResizeObserver(report).observe(document.body);
  window.addEventListener('load', report);
  document.body.tabIndex = -1;
  var sources = $$('[data-zb="play"]').map(function (b) { return b.dataset.src; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  if (sources.length) { post('need-media', { urls: sources }); zb.log('requested media', sources.map(tail)); }
  if (document.body.dataset.autoplay) { var p = $('[data-zb="play"]'); if (p) post('play', { src: p.dataset.src, rate: 1, auto: true }); }
  setTimeout(function () { if (inputs[0]) inputs[0].focus(); else document.body.focus(); report(); }, 30);
})();`;
