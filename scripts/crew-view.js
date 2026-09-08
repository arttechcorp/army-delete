(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof window !== 'undefined' ? window : null);
  } else {
    root.CrewView = factory(root);
  }
}(typeof self !== 'undefined' ? self : this, function (global) {
  'use strict';

  var ACTIVE_IDS = [
    'rank-pvt',
    'rank-pfc',
    'rank-cpl',
    'rank-squad',
    'rank-sgt',
    'rank-shorttimer'
  ];

  var CHARACTERS = {
    'rank-pvt': {
      className: 'pvt',
      rank: '이병',
      displayName: '신병 이병',
      quote: '이거 누르면 됩니까?',
      prop: 'doublebag',
      motion: 'strain'
    },
    'rank-pfc': {
      className: 'pfc',
      rank: '일병',
      displayName: '일잘알 일병',
      quote: '이거 끝나고 피엑스 가실 분?',
      prop: 'watch',
      motion: 'point'
    },
    'rank-cpl': {
      className: 'cpl',
      rank: '상병',
      displayName: '체단실 상병',
      quote: '이것도 전완근 먹네.',
      prop: 'towel',
      motion: 'palm'
    },
    'rank-squad': {
      className: 'squad',
      rank: '상병',
      displayName: '분대장 상병',
      quote: '다 왔지? 누르고 쉬자.',
      prop: 'notebook',
      motion: 'check'
    },
    'rank-sgt': {
      className: 'sgt',
      rank: '병장',
      displayName: '누워 있는 병장',
      quote: '어, 눌렀어.',
      prop: 'blanket',
      motion: 'lazy'
    },
    'rank-shorttimer': {
      className: 'shorttimer',
      rank: '병장',
      displayName: '말출 앞둔 병장',
      quote: '나 말출 전까지만 한다.',
      prop: 'calendar',
      motion: 'quick'
    }
  };

  var POSITION_CLASSES = [
    'slot-top-0', 'slot-top-1', 'slot-top-2',
    'slot-bottom-0', 'slot-bottom-1', 'slot-bottom-2'
  ];

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function toArray(value) {
    if (!value) return [];
    if (Object.prototype.toString.call(value) === '[object Array]') return value;
    if (typeof value.length === 'number') {
      var result = [];
      for (var i = 0; i < value.length; i += 1) result.push(value[i]);
      return result;
    }
    return [];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    var number = Number(value);
    if (!isFinite(number)) return '1';
    if (global && global.Intl && global.Intl.NumberFormat) {
      return new global.Intl.NumberFormat('ko-KR').format(number);
    }
    return String(number);
  }

  function intervalMs(item, meta) {
    var effect = item && item.effect;
    return Number(item && item.intervalMs) || Number(effect && effect.intervalMs) || Number(meta.intervalMs) || 0;
  }

  function daysPerTick(item) {
    var effect = item && item.effect;
    var value = item && (item.daysPerTick || item.amount || item.days);
    if (!value && effect) value = effect.daysPerTick || effect.amount || effect.days;
    value = Number(value);
    return isFinite(value) && value > 0 ? value : 1;
  }

  function intervalText(ms) {
    var seconds = ms / 1000;
    if (!isFinite(seconds) || seconds <= 0) return '자동 간격 미정';
    var rounded = Math.round(seconds * 10) / 10;
    return String(rounded).replace(/\.0$/, '') + '초마다 1회';
  }

  function propSvg(prop) {
    if (prop === 'doublebag') {
      return '<g class="cv-prop cv-prop-doublebag" aria-hidden="true"><path d="M10 70h17v24H10z"/><path d="M13 70c0-10 11-10 11 0M15 72v18M23 72v18"/></g>';
    }
    if (prop === 'watch') {
      return '<g class="cv-prop cv-prop-watch" aria-hidden="true"><path d="M69 58v7M69 78v7"/><circle cx="69" cy="72" r="8"/><path d="M69 67v5l3 2"/></g>';
    }
    if (prop === 'towel') {
      return '<g class="cv-prop cv-prop-towel" aria-hidden="true"><path d="M29 43c9 7 30 7 40 0l5 9c-13 9-34 9-50 0z"/><path d="M27 50c3 5 7 8 12 10"/></g>';
    }
    if (prop === 'notebook') {
      return '<g class="cv-prop cv-prop-notebook" aria-hidden="true"><rect x="9" y="53" width="23" height="29" rx="2"/><path d="M14 61h13M14 67h11M14 74l3 3 7-8"/></g>';
    }
    if (prop === 'blanket') {
      return '<g class="cv-prop cv-prop-blanket" aria-hidden="true"><path d="M36 73Q63 63 90 76L98 96H35z"/><path d="M40 81q24-6 47 4"/><path d="M8 99h95M16 99v5M96 99v5"/></g>';
    }
    return '<g class="cv-prop cv-prop-calendar" aria-hidden="true"><rect x="8" y="18" width="24" height="25" rx="3"/><path d="M8 26h24M14 14v8M26 14v8M13 32h4M20 32h4M13 37h4"/><path d="M70 68h20v24H70zM73 68v-5M87 68v-5M76 75h9"/></g>';
  }

  function characterSvg(meta, direction) {
    var bodyClass = 'cv-body cv-body-' + meta.className + (meta.className === 'sgt' ? ' cv-body-reclined' : '');
    var shoulder = meta.className === 'sgt' ? '50 67' : meta.className === 'pfc' ? '58 53' : '43 53';
    var arm = '<g class="cv-arm cv-contact-arm" data-shoulder="' + shoulder + '">' +
      '<path class="cv-contact-path" d="M' + shoulder + ' C46 67 49 82 50 99"/>' +
      '<circle class="cv-hand cv-contact-hand" cx="50" cy="100" r="4"/></g>';
    var secondArm = meta.className === 'pvt' ?
      '<g class="cv-arm cv-arm-secondary" data-shoulder="57 53"><path class="cv-secondary-path" d="M57 53C55 67 52 83 50 100"/><circle class="cv-hand cv-secondary-hand" cx="50" cy="100" r="4"/></g>' : '';
    var face = meta.className === 'sgt' ? '<path d="M42 31c4 4 14 4 18 0"/>' : '<circle cx="44" cy="32" r="2"/><circle cx="56" cy="32" r="2"/><path d="M46 39c3 2 6 2 9 0"/>';
    return '<svg class="cv-avatar" viewBox="0 0 100 108" role="img" aria-hidden="true" focusable="false">' +
        '<g class="cv-person cv-person-' + escapeHtml(meta.className) + '">' +
        '<circle class="cv-head" cx="50" cy="27" r="17"/>' +
        '<path class="cv-hair" d="M34 25c2-14 29-20 33 1-8-5-21-7-33-1z"/>' +
        '<g class="cv-face">' + face + '</g>' +
        '<path class="cv-neck" d="M45 41h10v8H45z"/>' +
        '<path class="cv-uniform" d="M32 47c10-6 26-6 36 0l8 43H24z"/>' +
        '<path class="cv-collar" d="M42 46l8 10 8-10M50 56v28"/>' +
        '<path class="cv-leg cv-leg-left" d="M38 88l-6 15"/><path class="cv-leg cv-leg-right" d="M62 88l6 15"/>' +
        '<path class="cv-shoe" d="M26 102h12M62 102h13"/>' +
      '</g>' +
      propSvg(meta.prop) +
      '<g class="' + escapeHtml(bodyClass) + '">' + arm + secondArm + '</g>' +
    '</svg>';
  }

  function create(options) {
    options = options || {};
    var container = options.container;
    var button = options.button;
    var stage = options.stage || (container && container.parentNode);
    if (!container || !button || !stage) {
      throw new Error('CrewView.create requires container, button, and stage');
    }

    var destroyed = false;
    var reduced = false;
    var explicitReduced = false;
    var media = null;
    var mediaMatches = false;
    var mediaListener = null;
    var resizeFrame = null;
    var activeMotions = 0;
    var activeIds = {};
    var timers = [];
    var itemsById = {};
    var layer = document.createElement('div');
    layer.className = 'crew-view__layer';
    layer.setAttribute('aria-label', '자동으로 군생활을 삭제하는 병사들');
    container.classList.add('crew-view-host');
    stage.classList.add('crew-view-stage');
    container.removeAttribute('aria-hidden');
    container.setAttribute('aria-label', '생활관 병사');
    container.appendChild(layer);

    function setTimer(callback, delay) {
      var timer = setTimeout(function () {
        var index = timers.indexOf(timer);
        if (index > -1) timers.splice(index, 1);
        if (!destroyed) callback();
      }, delay);
      timers.push(timer);
      return timer;
    }

    function activeItems(autos) {
      var input = toArray(autos);
      var found = {};
      var result = [];
      input.forEach(function (item) {
        if (!item || !own(CHARACTERS, item.id) || found[item.id]) return;
        found[item.id] = true;
        result.push(item);
      });
      result.sort(function (a, b) {
        return ACTIVE_IDS.indexOf(a.id) - ACTIVE_IDS.indexOf(b.id);
      });
      return result;
    }

    function closeDetails(except) {
      var units = layer.querySelectorAll('.crew-view__unit');
      for (var i = 0; i < units.length; i += 1) {
        if (units[i] === except) continue;
        units[i].classList.remove('is-selected');
        units[i].setAttribute('aria-expanded', 'false');
      }
    }

    function showDetails(unit, item, meta) {
      var open = unit.classList.contains('is-selected');
      closeDetails(unit);
      if (!open) {
        unit.classList.add('is-selected');
        unit.setAttribute('aria-expanded', 'true');
      }
      if (item && item.onSelect && typeof item.onSelect === 'function') item.onSelect(meta, item);
    }

    function makeUnit(item, index) {
      var meta = CHARACTERS[item.id];
      var unit = document.createElement('button');
      var direction = ['top-left', 'top', 'top-right', 'bottom-left', 'bottom', 'bottom-right'][index];
      var row = index < 3 ? 'top' : 'bottom';
      var slot = POSITION_CLASSES[index];
      var name = item.name || meta.displayName;
      var days = daysPerTick(item);
      var interval = intervalMs(item, meta);
      unit.type = 'button';
      unit.className = 'crew-view__unit crew-view__' + meta.className + ' ' + slot;
      unit.setAttribute('data-id', item.id);
      unit.setAttribute('data-slot', row);
      unit.setAttribute('aria-expanded', 'false');
      unit.setAttribute('aria-label', meta.displayName + ' 정보 보기');
      unit.innerHTML = '<span class="crew-view__avatar" aria-hidden="true">' + characterSvg(meta, direction) + '</span>' +
        '<span class="crew-view__label"><b>' + escapeHtml(name) + '</b><small>' + escapeHtml(meta.rank) + '</small></span>' +
        '<span class="crew-view__details" role="status">' +
          '<span class="crew-view__close" role="button" tabindex="0" aria-label="닫기">&times;</span>' +
          '<strong>' + escapeHtml(meta.displayName) + '</strong>' +
          '<span>' + formatNumber(days) + '일/회 · ' + escapeHtml(intervalText(interval)) + '</span>' +
          '<em>' + escapeHtml(meta.quote) + '</em>' +
        '</span>' +
        '<span class="crew-view__gain" aria-hidden="true"></span>';
      unit.addEventListener('click', function (event) {
        showDetails(unit, item, meta);
      });
      var closeBtn = unit.querySelector('.crew-view__close');
      function collapse(event) {
        event.stopPropagation();
        event.preventDefault();
        unit.classList.remove('is-selected');
        unit.setAttribute('aria-expanded', 'false');
      }
      closeBtn.addEventListener('click', collapse);
      closeBtn.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') collapse(event);
      });
      return unit;
    }

    function fallbackReach(unit) {
      var row = unit.getAttribute('data-slot');
      var index = Array.prototype.indexOf.call(layer.children, unit);
      var horizontal = index === 0 || index === 3 ? -1 : index === 2 || index === 5 ? 1 : 0;
      var vertical = row === 'top' ? 1 : -1;
      return { x: 50 + horizontal * 40, y: 100 + vertical * 6, dx: horizontal, dy: vertical };
    }

    function setReach(unit) {
      var avatar = unit.querySelector('.cv-avatar');
      var svg = avatar;
      var path = unit.querySelector('.cv-contact-path');
      var hand = unit.querySelector('.cv-contact-hand');
      var secondaryPath = unit.querySelector('.cv-secondary-path');
      var secondaryHand = unit.querySelector('.cv-secondary-hand');
      if (!svg || !path || !hand) return;

      var svgRect = svg.getBoundingClientRect();
      var buttonRect = button.getBoundingClientRect();
      var unitRect = unit.getBoundingClientRect();
      var reach = fallbackReach(unit);
      var validGeometry = svgRect.width > 0 && svgRect.height > 0 && buttonRect.width > 0 && buttonRect.height > 0;
      if (validGeometry) {
        var buttonX = (buttonRect.left + buttonRect.right) / 2;
        var buttonY = (buttonRect.top + buttonRect.bottom) / 2;
        var unitX = unitRect.width ? (unitRect.left + unitRect.right) / 2 : svgRect.left;
        var unitY = unitRect.height ? (unitRect.top + unitRect.bottom) / 2 : svgRect.top;
        var dx = unitX - buttonX;
        var dy = unitY - buttonY;
        var distance = Math.sqrt(dx * dx + dy * dy) || 1;
        var edgeX = buttonX + (dx / distance) * (buttonRect.width / 2 + 2);
        var edgeY = buttonY + (dy / distance) * (buttonRect.height / 2 + 2);
        reach = {
          x: (edgeX - svgRect.left) / svgRect.width * 100,
          y: (edgeY - svgRect.top) / svgRect.height * 108,
          dx: dx / distance,
          dy: dy / distance
        };
      }

      var x = Number(reach.x.toFixed(2));
      var y = Number(reach.y.toFixed(2));
      var shoulderAttr = (unit.querySelector('.cv-contact-arm') || {}).getAttribute && unit.querySelector('.cv-contact-arm').getAttribute('data-shoulder');
      var shoulder = shoulderAttr ? shoulderAttr.split(/\s+/).map(Number) : [43, 53];
      unit.style.setProperty('--cv-shoulder-x', shoulder[0] + 'px');
      unit.style.setProperty('--cv-shoulder-y', shoulder[1] + 'px');
      var midX = Number(((shoulder[0] + x) / 2).toFixed(2));
      var midY = Number(((shoulder[1] + y) / 2).toFixed(2));
      path.setAttribute('d', 'M' + shoulder[0] + ' ' + shoulder[1] + ' C' + midX + ' ' + shoulder[1] + ' ' + midX + ' ' + midY + ' ' + x + ' ' + y);
      hand.setAttribute('cx', x);
      hand.setAttribute('cy', y);
      if (secondaryPath && secondaryHand) {
        var sx = x + (reach.dy || 0) * 4;
        var sy = y - (reach.dx || 0) * 4;
        secondaryPath.setAttribute('d', 'M57 53 C55 67 ' + ((55 + sx) / 2).toFixed(2) + ' ' + ((67 + sy) / 2).toFixed(2) + ' ' + sx.toFixed(2) + ' ' + sy.toFixed(2));
        secondaryHand.setAttribute('cx', sx);
        secondaryHand.setAttribute('cy', sy);
      }
      unit.style.setProperty('--cv-nudge-x', ((reach.dx || 0) * 5).toFixed(2) + 'px');
      unit.style.setProperty('--cv-nudge-y', ((reach.dy || 0) * 5).toFixed(2) + 'px');
    }

    function updateReach() {
      var units = layer.querySelectorAll('.crew-view__unit');
      for (var i = 0; i < units.length; i += 1) setReach(units[i]);
    }

    function scheduleReach() {
      if (resizeFrame !== null) return;
      var callback = function () { resizeFrame = null; if (!destroyed) updateReach(); };
      if (global && global.requestAnimationFrame) resizeFrame = global.requestAnimationFrame(callback);
      else resizeFrame = global.setTimeout(callback, 0);
    }

    function render(autos) {
      if (destroyed) return api;
      var active = activeItems(autos);
      itemsById = {};
      active.forEach(function (item) { itemsById[item.id] = item; });
      layer.innerHTML = '';
      active.forEach(function (item, index) {
        layer.appendChild(makeUnit(item, index));
      });
      updateReach();
      scheduleReach();
      container.hidden = active.length === 0;
      stage.classList.toggle('has-crew-view', active.length > 0);
      return api;
    }

    function findUnit(id) {
      return layer.querySelector('[data-id="' + String(id).replace(/"/g, '\\"') + '"]');
    }

    function tick(id, days) {
      if (destroyed) return;
      var unit = findUnit(id);
      if (!unit || activeIds[id]) return;
      if (reduced) {
        var reducedGain = unit.querySelector('.crew-view__gain');
        if (reducedGain) reducedGain.textContent = '+' + formatNumber(days == null ? daysPerTick(itemsById[id]) : days) + '일';
        unit.classList.add('is-ticking');
        setTimer(function () {
          unit.classList.remove('is-ticking');
          if (reducedGain) reducedGain.textContent = '';
        }, 900);
        return;
      }
      if (activeMotions >= 2) return;
      activeIds[id] = true;
      activeMotions += 1;
      var gain = unit.querySelector('.crew-view__gain');
      if (gain) {
        gain.textContent = '+' + formatNumber(days == null ? daysPerTick(itemsById[id]) : days) + '일';
      }
      unit.classList.remove('is-ticking');
      void unit.offsetWidth;
      unit.classList.add('is-ticking');
      setTimer(function () {
        delete activeIds[id];
        activeMotions = Math.max(0, activeMotions - 1);
        unit.classList.remove('is-ticking');
        if (gain) gain.textContent = '';
      }, 455);
    }

    function celebrate(kind) {
      if (destroyed || reduced || !layer.firstChild) return;
      layer.setAttribute('data-celebrate', kind || 'recruit');
      layer.classList.remove('is-celebrating');
      void layer.offsetWidth;
      layer.classList.add('is-celebrating');
      setTimer(function () {
        layer.classList.remove('is-celebrating');
        layer.removeAttribute('data-celebrate');
      }, 480);
    }

    function applyReduced() {
      reduced = explicitReduced || mediaMatches;
      layer.classList.toggle('is-reduced', reduced);
      if (reduced) {
        layer.classList.remove('is-celebrating');
        var ticking = layer.querySelectorAll('.is-ticking');
        for (var i = 0; i < ticking.length; i += 1) ticking[i].classList.remove('is-ticking');
      }
    }

    function setReduced(value) {
      explicitReduced = Boolean(value);
      applyReduced();
    }

    function onMediaChange(event) {
      mediaMatches = Boolean(event.matches);
      applyReduced();
    }

    if (global && global.matchMedia) {
      media = global.matchMedia('(prefers-reduced-motion: reduce)');
      mediaMatches = Boolean(media.matches);
      applyReduced();
      mediaListener = onMediaChange;
      if (media.addEventListener) media.addEventListener('change', mediaListener);
      else if (media.addListener) media.addListener(mediaListener);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      timers.forEach(clearTimeout);
      timers = [];
      if (resizeFrame !== null) {
        if (global.cancelAnimationFrame) global.cancelAnimationFrame(resizeFrame);
        else global.clearTimeout(resizeFrame);
        resizeFrame = null;
      }
      if (global && global.removeEventListener) global.removeEventListener('resize', scheduleReach);
      if (media && mediaListener) {
        if (media.removeEventListener) media.removeEventListener('change', mediaListener);
        else if (media.removeListener) media.removeListener(mediaListener);
      }
      layer.parentNode.removeChild(layer);
      container.classList.remove('crew-view-host');
      stage.classList.remove('crew-view-stage', 'has-crew-view');
      container.hidden = false;
      container.setAttribute('aria-hidden', 'true');
    }

    var api = {
      render: render,
      tick: tick,
      setReduced: setReduced,
      destroy: destroy,
      celebrate: celebrate
    };
    if (global && global.addEventListener) global.addEventListener('resize', scheduleReach);
    return api;
  }

  return { create: create };
}));
