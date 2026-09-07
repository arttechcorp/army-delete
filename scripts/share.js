// 유입 출처 확산 추적. 커뮤니티 게시판 UTM 링크로 들어온 사용자가 링크를 친구에게
// 공유하면, sid(share id) 파라미터로 "최초 출처가 어디였는지"를 링크 자체에 실어
// 옮긴다. 서버가 없어 세션을 이어줄 수 없으므로 출처 정보를 URL에 인코딩해야 한다.
// classic 스크립트(ES5) — index.html 이 빌드 없는 인라인 스크립트라 트랜스파일이 없다.
(function (global) {
  'use strict';

  var SID_PARAM = 'sid';
  var SID_KEY = 'ad.sid';
  var ATTR_KEY = 'ad.attr';

  // sid 는 '.' 로 구분되는 4조각이라 세그먼트 안에 '.' 이 섞이면 파싱이 깨진다.
  // 운영자가 utm_source 를 손으로 적어 대문자·한글·특수문자가 들어올 수 있으므로
  // 여기서 미리 걷어낸다.
  function normalizeSegment(raw) {
    if (typeof raw !== 'string') return '';
    var result = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return result.slice(0, 40);
  }

  function parseSid(raw) {
    if (typeof raw !== 'string') return null;
    var parts = raw.split('.');
    if (parts.length !== 4) return null;

    var rootSource = parts[0];
    var rootContent = parts[1];
    var sharer = parts[2];
    var genRaw = parts[3];

    if (!/^[a-z0-9_]+$/.test(rootSource)) return null;
    if (!/^[a-z0-9_]+$/.test(rootContent)) return null;
    if (!/^[a-z0-9]{4}$/.test(sharer)) return null;
    if (!/^[0-9]+$/.test(genRaw)) return null;

    var generation = parseInt(genRaw, 10);
    if (!isFinite(generation) || generation < 0) return null;

    return { rootSource: rootSource, rootContent: rootContent, sharer: sharer, generation: generation };
  }

  function buildSid(attr, sharerId) {
    var a = attr || {};
    var rootSource = normalizeSegment(a.rootSource) || 'direct';
    var rootContent = normalizeSegment(a.rootContent) || 'none';
    var generation = a.generation;
    if (typeof generation !== 'number' || !isFinite(generation) || Math.floor(generation) !== generation) {
      generation = 0;
    }
    return rootSource + '.' + rootContent + '.' + sharerId + '.' + (generation + 1);
  }

  function newSharerId(randomFn) {
    var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var id = '';
    for (var i = 0; i < 4; i++) {
      var idx = Math.floor(rnd() * chars.length);
      if (idx < 0) idx = 0;
      if (idx >= chars.length) idx = chars.length - 1;
      id += chars.charAt(idx);
    }
    return id;
  }

  // href 파싱은 남이 만든 URL 이 그대로 들어올 수 있어 무조건 try/catch 로 감싼다.
  function safeParseUrl(href) {
    try {
      return new URL(href);
    } catch (err) {
      return null;
    }
  }

  function readUrlAttribution(href, mySharerId) {
    var directResult = {
      attr: { firstSource: 'direct', rootSource: 'direct', rootContent: 'none', generation: 0 },
      via: 'direct',
      selfReferral: false,
      incomingSid: ''
    };

    var url = safeParseUrl(href);
    if (!url) return directResult;

    var sidRaw = url.searchParams.get(SID_PARAM);
    if (sidRaw) {
      var parsed = parseSid(sidRaw);
      if (parsed) {
        if (parsed.sharer === mySharerId) {
          // 자기 자신이 뿌린 링크를 눌러 돌아온 경우 — 새 유입으로 치지 않고
          // utm/direct 판정으로 내려간다.
        } else {
          return {
            attr: {
              firstSource: 'user_share',
              rootSource: parsed.rootSource,
              rootContent: parsed.rootContent,
              generation: parsed.generation
            },
            via: 'sid',
            selfReferral: false,
            incomingSid: sidRaw
          };
        }
      }
    }

    var selfReferral = !!(sidRaw && parseSid(sidRaw) && parseSid(sidRaw).sharer === mySharerId);

    var utmSource = url.searchParams.get('utm_source');
    if (utmSource) {
      var firstSource = normalizeSegment(utmSource);
      var utmContent = normalizeSegment(url.searchParams.get('utm_content')) || 'none';
      return {
        attr: { firstSource: firstSource, rootSource: firstSource, rootContent: utmContent, generation: 0 },
        via: 'utm',
        selfReferral: selfReferral,
        incomingSid: ''
      };
    }

    directResult.selfReferral = selfReferral;
    return directResult;
  }

  function stripTrackingParams(href) {
    var url = safeParseUrl(href);
    if (!url) return href;

    url.searchParams.delete(SID_PARAM);
    var toDelete = [];
    url.searchParams.forEach(function (value, key) {
      if (key.indexOf('utm_') === 0) toDelete.push(key);
    });
    for (var i = 0; i < toDelete.length; i++) {
      url.searchParams.delete(toDelete[i]);
    }

    return url.pathname + url.search + url.hash;
  }

  function getSharerId(storage, randomFn) {
    var existing = null;
    try {
      if (storage) existing = storage.getItem(SID_KEY);
    } catch (err) {
      existing = null;
    }

    if (typeof existing === 'string' && /^[a-z0-9]{4}$/.test(existing)) {
      return existing;
    }

    var fresh = newSharerId(randomFn);
    try {
      if (storage) storage.setItem(SID_KEY, fresh);
    } catch (err) {
      // 사파리 프라이빗 모드 등 저장이 막혀도 id 는 그대로 반환한다.
    }
    return fresh;
  }

  function loadAttr(storage) {
    try {
      if (!storage) return null;
      var raw = storage.getItem(ATTR_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function saveAttr(storage, attr) {
    try {
      if (!storage) return;
      storage.setItem(ATTR_KEY, JSON.stringify(attr));
    } catch (err) {
      // 저장 실패는 조용히 무시 — 출처 추적이 세션을 막을 순 없다.
    }
  }

  global.__share = {
    SID_PARAM: SID_PARAM,
    SID_KEY: SID_KEY,
    ATTR_KEY: ATTR_KEY,
    normalizeSegment: normalizeSegment,
    parseSid: parseSid,
    buildSid: buildSid,
    newSharerId: newSharerId,
    readUrlAttribution: readUrlAttribution,
    stripTrackingParams: stripTrackingParams,
    getSharerId: getSharerId,
    loadAttr: loadAttr,
    saveAttr: saveAttr
  };
})(typeof window !== 'undefined' ? window : this);
