# 콤보 클릭 이펙트 및 도파민 강화 상세 설계서

본 문서는 군생활 삭제 버튼의 연타 클릭 만족감(Game Feel)과 도파민 분비를 극대화하기 위한 콤보 이펙트 시스템 상세 설계서입니다.
외부 에셋이나 라이브러리 추가 없이, 기존의 Web Audio API와 바닐라 CSS 및 자바스크립트 환경에서 즉시 동작하도록 설계했습니다.

---

## 1. 핵심 목표 및 설계 원칙

1. 점진적 긴장감 고조와 폭발적 보상
   - 단순 반복 클릭에서 오는 피로감을 줄이고, 콤보가 쌓일수록 시각과 청각 자극의 강도를 단계적으로 올려 사용자가 연타를 멈추지 못하게 만듭니다.
2. 다감각 피드백 결합
   - 청각(피치 상승, 화음 팡파르, 서브 베이스 킥), 시각(화면 미세 흔들림, 파티클 분출, 외곽선 발광), 촉각(모바일 햅틱 진동 패턴)을 동시에 타격합니다.
3. 성능 및 무의존성 유지
   - 외부 음원 파일(mp3, wav)이나 외부 그래픽 라이브러리를 일절 쓰지 않고, Web Audio 오실레이터 합성과 하드웨어 가속 CSS만으로 60fps 성능을 유지합니다.
4. 접근성 배려
   - 시스템 설정에서 움직임 줄이기(prefers-reduced-motion)를 활성화한 사용자에게는 화면 흔들림과 번쩍임 연출을 자동으로 끕니다.

---

## 2. 유사 게임 피드백 분석 결과

1. 쿠키 클리커 (Cookie Clicker)
   - 연타 누적 시 황금빛 피버 모드로 진입하며, 파티클 방출량이 폭증하여 조작 속도감을 극대화합니다.
2. 뱀파이어 서바이버 (Vampire Survivors)
   - 단계가 올라갈 때 단음을 쓰지 않고 주파수를 연속 상승시키며, 목표치 도달 시 4화음 메이저 코드를 터뜨려 도파민을 분비시킵니다.
3. 탭 타이탄 (Tap Titans) 및 팝캣 (Popcat)
   - 연타 피치 상승과 더불어 콤보 뱃지 색상이 화이트 -> 골드 -> 파이어 -> 네온으로 변하고, 임계점에서 화면 전체가 덜컹거리는 물리적 반동(Screen Shake)을 제공합니다.

---

## 3. 단계별 콤보 보상 시스템

콤보 유지 시간은 기존과 동일하게 1.2초(COMBO_RESET_MS = 1200)입니다.
구간별 도달 시 1회성 마일스톤 연출이 터지고, 해당 구간을 유지하는 동안 클릭 피드백이 강화됩니다.

| 구간 | 명칭 | 도달 조건 | 청각 효과 | 시각 및 물리 효과 | 모바일 햅틱 |
|---|---|---|---|---|---|
| 기본 | 일반 삭제 | 1~9 콤보 | 펜타토닉 음계 순차 상승 | 기본 버튼 눌림 및 -1일 텍스트 | 없음 |
| 1단계 | 가속 삭제 | 10 콤보 | 고음 금속성 벨 챠링 사운드 | 콤보 뱃지 노란색 전환, 주황색 충격파 링 | 단발 진동 (25ms) |
| 2단계 | 광속 삭제 | 25 콤보 | 묵직한 808 저음 서브 킥 중첩 | 보라색 네온 발광, 360도 스파크 파티클 8개 분출 | 2연타 진동 (20ms, 휴식 30ms, 20ms) |
| 3단계 | 시계 박살 (피버) | 50 콤보 | 4화음 메이저 코드 팡파르 | 화면 미세 흔들림(0.15초), 골드 파티클 16개 분출, 뱃지 화염 | 3연타 강진동 (40ms 3회) |
| 4단계 | 시공간 붕괴 | 100 콤보 | 고속 스윕 글리산도 및 대형 화음 | 화면 백색 플래시(0.08초), 무지개 파티클 24개, 버튼 회전 오라 | 롱 펄스 진동 (60ms, 40ms, 80ms) |

---

## 4. 상세 기술 구현 사양

### 4.1 Web Audio API 사운드 합성기 확장

외부 파일 없이 브라우저 내장 오실레이터만으로 모든 특수 효과음을 합성합니다.

```javascript
/* 콤보 사운드 합성 함수군 */

// 1. 고음 금속 벨 소리 (10콤보용: 두 개의 고주파 사인파 간섭)
function soundBell(now) {
  if (muted || !ctx) return;
  [1568, 2093].forEach(function (freq, i) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + (i * 0.02));
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
    track(osc);
  });
}

// 2. 808 서브 베이스 킥 (25콤보용: 120Hz에서 35Hz로 급강하하는 묵직한 펀치)
function soundSubKick(now) {
  if (muted || !ctx) return;
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(130, now);
  osc.frequency.exponentialRampToValueAtTime(32, now + 0.18);
  g.gain.setValueAtTime(0.35, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.25);
  track(osc);
}

// 3. 4화음 메이저 팡파르 코드 (50콤보 피버용: C5, E5, G5, C6)
function soundFanfare(now) {
  if (muted || !ctx) return;
  var chord = [523.25, 659.25, 783.99, 1046.50];
  chord.forEach(function (freq, idx) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + (idx * 0.035));
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + (idx * 0.035) + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.7);
    track(osc);
  });
}

// 4. 상승 주파수 글리산도 (100콤보용: 220Hz에서 1760Hz로 솟구치는 스윕음)
function soundGlissando(now) {
  if (muted || !ctx) return;
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = 'sawtooth';
  var bp = ctx.createBiquadFilter();
  bp.type = 'lowpass';
  bp.frequency.value = 2400;

  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(1760, now + 0.32);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

  osc.connect(bp);
  bp.connect(g);
  g.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.48);
  track(osc);
}
```

---

### 4.2 CSS 비주얼 및 애니메이션 사양

```css
/* 화면 흔들림 (50콤보 이상 도달 시 트리거) */
@keyframes screenShake {
  0% { transform: translate(0, 0); }
  20% { transform: translate(-3px, 2px); }
  40% { transform: translate(3px, -2px); }
  60% { transform: translate(-2px, -1px); }
  80% { transform: translate(2px, 1px); }
  100% { transform: translate(0, 0); }
}
.shake {
  animation: screenShake 0.15s ease-in-out;
}

/* 100콤보 화면 백색 플래시 */
.combo-flash {
  position: fixed;
  inset: 0;
  background: #ffffff;
  pointer-events: none;
  z-index: 999;
  opacity: 0.35;
  animation: flashOut 0.08s ease-out forwards;
}
@keyframes flashOut {
  to { opacity: 0; }
}

/* 콤보 단계별 뱃지 스타일 */
.combo-badge.tier-10 {
  background: #eab308;
  color: #000000;
  border-color: #fef08a;
  box-shadow: 0 0 12px rgba(234, 179, 8, 0.45);
}
.combo-badge.tier-25 {
  background: #9333ea;
  color: #ffffff;
  border-color: #d8b4fe;
  box-shadow: 0 0 18px rgba(147, 51, 234, 0.65);
  animation: comboPulse 0.22s ease-in-out infinite alternate;
}
.combo-badge.tier-50 {
  background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%);
  color: #ffffff;
  border-color: #fecaca;
  box-shadow: 0 0 24px rgba(220, 38, 38, 0.8);
  animation: comboPulse 0.16s ease-in-out infinite alternate;
}
.combo-badge.tier-100 {
  background: linear-gradient(90deg, #ec4899, #8b5cf6, #3b82f6, #10b981);
  background-size: 300% 300%;
  color: #ffffff;
  border-color: #ffffff;
  box-shadow: 0 0 30px rgba(139, 92, 246, 0.9);
  animation: rainbowShift 2s linear infinite, comboPulse 0.14s ease-in-out infinite alternate;
}
@keyframes rainbowShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* 100콤보 유지 시 버튼 플레이트 회전 오라 */
.plate.singularity::after {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, #ec4899, #8b5cf6, #3b82f6, #10b981, #ec4899);
  z-index: 0;
  filter: blur(8px);
  opacity: 0.75;
  animation: spinAura 1.5s linear infinite;
  pointer-events: none;
}
@keyframes spinAura {
  to { transform: rotate(360deg); }
}

/* 분출 파티클 (DOM 기반 경량 요소) */
.spark-particle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 20;
  transform: translate(-50%, -50%);
  animation: sparkBurst 0.45s cubic-bezier(0.12, 0.8, 0.32, 1) forwards;
}
@keyframes sparkBurst {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0);
    opacity: 0;
  }
}
```

---

### 4.3 자바스크립트 파티클 및 콤보 제어 로직

```javascript
/* 파티클 분출 함수 */
function burstParticles(count, colors) {
  if (reduced) return;
  var rect = plate.getBoundingClientRect();
  for (var i = 0; i < count; i++) {
    var p = document.createElement('span');
    p.className = 'spark-particle';
    var color = colors[Math.floor(Math.random() * colors.length)];
    p.style.backgroundColor = color;
    p.style.boxShadow = '0 0 6px ' + color;

    var angle = (Math.PI * 2 * i) / count + ((Math.random() - 0.5) * 0.4);
    var distance = 55 + Math.random() * 65;
    var dx = Math.cos(angle) * distance + 'px';
    var dy = Math.sin(angle) * distance + 'px';

    p.style.setProperty('--dx', dx);
    p.style.setProperty('--dy', dy);

    plate.appendChild(p);
    setTimeout((function (el) {
      return function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      };
    })(p), 480);
  }
}

/* 화면 흔들림 함수 */
function triggerScreenShake() {
  if (reduced) return;
  stage.classList.remove('shake');
  void stage.offsetWidth; // 리플로우 강제하여 애니메이션 재시작
  stage.classList.add('shake');
  setTimeout(function () {
    stage.classList.remove('shake');
  }, 160);
}

/* 화면 플래시 함수 */
function triggerFlash() {
  if (reduced) return;
  var flash = document.createElement('div');
  flash.className = 'combo-flash';
  document.body.appendChild(flash);
  setTimeout(function () {
    if (flash.parentNode) flash.parentNode.removeChild(flash);
  }, 100);
}

/* 콤보 뱃지 및 단계별 연출 메인 함수 */
function updateComboState(c) {
  if (!comboBadge || !comboNum) return;

  if (c < 3) {
    comboBadge.className = 'combo-badge';
    plate.classList.remove('singularity');
    return;
  }

  comboNum.textContent = String(c);

  // 단계별 스타일 적용
  if (c >= 100) {
    comboBadge.className = 'combo-badge on tier-100';
    plate.classList.add('singularity');
  } else if (c >= 50) {
    comboBadge.className = 'combo-badge on tier-50';
    plate.classList.remove('singularity');
  } else if (c >= 25) {
    comboBadge.className = 'combo-badge on tier-25';
    plate.classList.remove('singularity');
  } else if (c >= 10) {
    comboBadge.className = 'combo-badge on tier-10';
    plate.classList.remove('singularity');
  } else {
    comboBadge.className = 'combo-badge on';
    plate.classList.remove('singularity');
  }

  clearTimeout(comboFadeTimer);
  comboFadeTimer = setTimeout(function () {
    if (comboBadge) comboBadge.className = 'combo-badge';
    if (plate) plate.classList.remove('singularity');
  }, COMBO_RESET_MS + 250);
}

/* 구간 도달 시 1회성 마일스톤 폭발 연출 */
function triggerComboMilestone(c, now) {
  if (c === 10) {
    soundBell(now);
    burstParticles(8, ['#facc15', '#f59e0b', '#fbbf24']);
    if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) {} }
  } else if (c === 25) {
    soundSubKick(now);
    burstParticles(12, ['#c084fc', '#a855f7', '#e879f9']);
    if (navigator.vibrate) { try { navigator.vibrate([20, 30, 20]); } catch (e) {} }
  } else if (c === 50) {
    soundFanfare(now);
    triggerScreenShake();
    burstParticles(16, ['#ef4444', '#f97316', '#eab308']);
    if (navigator.vibrate) { try { navigator.vibrate([40, 30, 40, 30, 40]); } catch (e) {} }
  } else if (c === 100) {
    soundGlissando(now);
    triggerFlash();
    triggerScreenShake();
    burstParticles(24, ['#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#fbbf24']);
    if (navigator.vibrate) { try { navigator.vibrate([60, 40, 80]); } catch (e) {} }
  }
}
```

---

### 4.4 기존 클릭 이벤트 핸들러 연동 지점

`index.html` 내 기존 `btn.addEventListener('click')` 내부 로직에 다음과 같이 결합합니다.

```javascript
btn.addEventListener('click', function () {
  var now = Date.now();
  if (now - lastClickTime <= COMBO_RESET_MS) {
    currentCombo++;
  } else {
    currentCombo = 1;
  }
  lastClickTime = now;
  var combo = currentCombo;

  // 1. 콤보 상태 업데이트
  updateComboState(combo);

  // 2. Web Audio 초기화 및 사운드 시각 산출
  var c = audio();
  var audioNow = c ? c.currentTime : 0;

  // 3. 특정 콤보 도달 시 1회성 특수 마일스톤 연출
  triggerComboMilestone(combo, audioNow);

  // 4. 기본 클릭음 및 일수 추가
  addDays(multiplier());
  playClick(total);
  punch();

  // 5. 기본 연타 팝업 (-1일 텍스트)
  if (!reduced) {
    pop();
    ripple();
  }
});
```

---

## 5. 검증 및 점검 항목

1. 오디오 노드 누수 점검
   - 빠른 연타 시 `AudioContext`의 보이스 노드가 무한정 쌓이지 않고 기존 `track()` 함수에 의해 최대 개수(MAX_VOICES) 내에서 즉시 정리되는지 확인합니다.
2. DOM 파티클 제거 확인
   - 파티클 애니메이션 종료 시 DOM 트리에서 온전히 삭제되어 메모리 점유가 늘어나지 않는지 확인합니다.
3. 인라인 스크립트 문법 검사
   - `index.html` 적용 후 `sed` 및 `node --check` 명령을 통해 SyntaxError가 없는지 확인합니다.
4. 개인정보처리방침 및 로컬스토리지 무변경 검증
   - 본 기능은 순수 연출 로직이므로 로컬스토리지 키(`ad.*`)를 추가하거나 수정하지 않으며, 외부 네트워크 요청을 발생시키지 않습니다.
