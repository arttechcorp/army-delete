// 주차별 캠페인: launch 시기가 끝나 이제 매주 새 캠페인 코드를 쓴다.
// 월 1~7일이 1주차, 8~14일이 2주차 ... 식으로 날짜에서 그대로 계산한다.
const now = new Date();
export const UTM_CAMPAIGN = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0') + 'w' + Math.ceil(now.getDate() / 7);

export const UTM_CHANNELS = [
  { id: 'dcinside_army', label: '디시 육군', source: 'dcinside', medium: 'community', contentBase: 'army', codeLabel: null },
  { id: 'dcinside_navy', label: '디시 해군', source: 'dcinside', medium: 'community', contentBase: 'navy', codeLabel: null },
  { id: 'dcinside_airforce', label: '디시 공군', source: 'dcinside', medium: 'community', contentBase: 'airforce', codeLabel: null },
  { id: 'everytime', label: '에브리타임', source: 'everytime', medium: 'community', contentBase: null, codeLabel: '학교코드' },
  { id: 'gundori', label: '군돌이', source: 'gundori', medium: 'community', contentBase: null, codeLabel: '게시판코드' },
  { id: 'gomsin_cafe', label: '곰신카페', source: 'gomsin_cafe', medium: 'community', contentBase: null, codeLabel: '카페코드' },
  { id: 'referral', label: '지인', source: 'referral', medium: 'referral', contentBase: 'friend', codeLabel: null }
];

export function findChannel(channelId) {
  for (let i = 0; i < UTM_CHANNELS.length; i++) {
    if (UTM_CHANNELS[i].id === channelId) return UTM_CHANNELS[i];
  }
  return null;
}

export function normalizeCode(raw) {
  if (typeof raw !== 'string') return '';
  const result = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return result;
}

// 운영자가 손으로 코드/캠페인을 적다 한글·특수문자를 섞어 넣으면 normalizeCode 가
// 그걸 조용히 걷어내면서 서로 다른 값이 같은 슬러그로 뭉개질 수 있다 (예: '홍익대A' 와
// '서울대A' 가 둘 다 'a'). normalizeCode 자체는 순수 정규화 함수로 남겨두고, 호출
// 지점에서 이 함수로 먼저 막아 조용한 데이터 합산을 방지한다.
export function assertPlainSlug(raw, fieldLabel) {
  const value = String(raw).trim();
  if (value === '') return;
  if (!/^[A-Za-z0-9_\-. ]+$/.test(value)) {
    throw new Error(`${fieldLabel}에는 영문·숫자·언더스코어만 쓸 수 있습니다. 한글은 로마자로 바꿔 입력해 주세요.`);
  }
}

export function buildUtmContent(channelId, code, postNumber) {
  const channel = findChannel(channelId);
  if (!channel) {
    throw new Error('알 수 없는 채널입니다.');
  }
  let base;
  if (typeof channel.contentBase === 'string') {
    base = channel.contentBase;
  } else {
    assertPlainSlug(code, '코드');
    base = normalizeCode(code);
    if (!base) {
      throw new Error('코드를 입력해주세요.');
    }
  }
  if (typeof postNumber !== 'number' && typeof postNumber !== 'string') {
    throw new Error('게시물 번호는 1 이상의 정수여야 합니다.');
  }
  const n = Number(postNumber);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('게시물 번호는 1 이상의 정수여야 합니다.');
  }
  const padded = n < 10 ? '0' + n : String(n);
  return base + '_post' + padded;
}

export function buildUtmUrl(options) {
  const opts = options || {};
  const channel = findChannel(opts.channelId);
  if (!channel) {
    throw new Error('알 수 없는 채널입니다.');
  }
  const content = buildUtmContent(opts.channelId, opts.code, opts.postNumber);

  let campaign;
  if (typeof opts.campaign !== 'string' || opts.campaign.trim() === '') {
    campaign = UTM_CAMPAIGN;
  } else {
    assertPlainSlug(opts.campaign, '캠페인');
    campaign = normalizeCode(opts.campaign);
    if (!campaign) {
      campaign = UTM_CAMPAIGN;
    }
  }

  let url;
  try {
    url = new URL(opts.baseUrl);
  } catch (err) {
    throw new Error('올바른 URL 주소가 아닙니다.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('올바른 URL 주소가 아닙니다.');
  }

  const base = url.origin + url.pathname;
  const params = new URLSearchParams();
  params.set('utm_source', channel.source);
  params.set('utm_medium', channel.medium);
  params.set('utm_content', content);
  params.set('utm_campaign', campaign);

  return base + '?' + params.toString();
}
