/* ============================================================
   ResNet 인터랙티브 가이드 — 시뮬레이션 & 시각화
   외부 라이브러리 없이 전부 브라우저에서 계산합니다.
   ============================================================ */
'use strict';

/* ---------- 유틸 ---------- */
const $ = (sel) => document.querySelector(sel);
const SVGNS = 'http://www.w3.org/2000/svg';

function mk(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
function cssv(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mixRgb(a, b, t) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
}

/* 결정적 난수 (재실행 버튼으로만 시드 교체) */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------- 툴팁 ---------- */
const tooltip = $('#tooltip');
function showTip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.classList.add('show');
  const r = tooltip.getBoundingClientRect();
  let px = x + 14, py = y + 14;
  if (px + r.width > window.innerWidth - 8) px = x - r.width - 10;
  if (py + r.height > window.innerHeight - 8) py = y - r.height - 10;
  tooltip.style.left = px + 'px';
  tooltip.style.top = py + 'px';
}
function hideTip() { tooltip.classList.remove('show'); }

document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tt]');
  if (t) showTip(t.dataset.tt, e.clientX, e.clientY);
});
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest('[data-tt]');
  if (t) showTip(t.dataset.tt, e.clientX, e.clientY);
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest && e.target.closest('[data-tt]')) hideTip();
});

/* ---------- 테마 변경 시 차트 다시 그리기 ---------- */
const rerenders = [];
function onThemeChange() { rerenders.forEach(fn => fn()); }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onThemeChange);

/* ============================================================
   범용 라인 차트 (SVG, 호버 크로스헤어 + 툴팁)
   ============================================================ */
function niceTicks(min, max, n = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / n)));
  let step = step0;
  for (const m of [1, 2, 5, 10]) { if (span / (step0 * m) <= n) { step = step0 * m; break; } }
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

function drawLineChart(el, cfg) {
  el.innerHTML = '';
  const ink = cssv('--text-primary'), sec = cssv('--text-secondary'),
    muted = cssv('--text-muted'), gridc = cssv('--grid'),
    base = cssv('--baseline'), surface = cssv('--surface-1');

  /* 범례 (시리즈 2개 이상이면 항상 표시) */
  if (cfg.series.length >= 2) {
    const leg = document.createElement('div');
    leg.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;margin-bottom:6px;color:' + sec;
    cfg.series.forEach(s => {
      const item = document.createElement('span');
      item.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
      item.innerHTML = `<span style="width:14px;height:3px;border-radius:2px;background:${s.color};display:inline-block"></span>${s.name}`;
      leg.appendChild(item);
    });
    el.appendChild(leg);
  }

  const W = 720, H = cfg.height || 300;
  const m = { l: 58, r: cfg.rightPad ?? 118, t: 14, b: 40 };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, null);
  el.appendChild(svg);

  const clampY = (v) => cfg.yLog ? Math.min(Math.max(v, cfg.yClamp[0]), cfg.yClamp[1]) : v;
  const trans = (v) => cfg.yLog ? Math.log10(clampY(v)) : v;

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  cfg.series.forEach(s => s.points.forEach(p => {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    const t = trans(p[1]); y0 = Math.min(y0, t); y1 = Math.max(y1, t);
  }));
  if (cfg.xDomain) { x0 = cfg.xDomain[0]; x1 = cfg.xDomain[1]; }
  if (cfg.yDomain) { y0 = trans(cfg.yDomain[0]); y1 = trans(cfg.yDomain[1]); }
  if (!cfg.yLog && !cfg.yDomain) { const pad = (y1 - y0) * 0.08 || 1; y0 -= pad; y1 += pad; if (cfg.yMinZero) y0 = Math.max(0, y0); }
  if (cfg.yLog) { y0 = Math.floor(y0); y1 = Math.ceil(y1); if (y1 === y0) y1 = y0 + 1; }

  const px = (x) => m.l + (x - x0) / (x1 - x0 || 1) * (W - m.l - m.r);
  const py = (y) => H - m.b - (trans(y) - y0) / (y1 - y0 || 1) * (H - m.t - m.b);

  /* 그리드 + y축 눈금 */
  let yTicks;
  if (cfg.yLog) {
    const step = Math.max(1, Math.ceil((y1 - y0) / 6));
    yTicks = [];
    for (let e = y0; e <= y1; e += step) yTicks.push(Math.pow(10, e));
  } else {
    yTicks = niceTicks(y0, y1, 5);
  }
  yTicks.forEach(v => {
    const yy = py(cfg.yLog ? v : v);
    mk('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: gridc, 'stroke-width': 1 }, svg);
    const label = cfg.yFmt ? cfg.yFmt(v) : v;
    mk('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', fill: muted, 'font-size': 11 }, svg).textContent = label;
  });
  /* 기준선 */
  mk('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: base, 'stroke-width': 1 }, svg);

  /* x축 눈금 */
  const xTicks = cfg.xTicks || niceTicks(x0, x1, 6);
  xTicks.forEach(v => {
    if (v < x0 - 1e-9 || v > x1 + 1e-9) return;
    mk('text', { x: px(v), y: H - m.b + 18, 'text-anchor': 'middle', fill: muted, 'font-size': 11 }, svg)
      .textContent = cfg.xFmt ? cfg.xFmt(v) : v;
  });
  if (cfg.xLabel) mk('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', fill: muted, 'font-size': 11.5 }, svg).textContent = cfg.xLabel;
  if (cfg.yLabel) {
    mk('text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', fill: muted, 'font-size': 11.5, transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, svg).textContent = cfg.yLabel;
  }

  /* 시리즈 라인 */
  cfg.series.forEach(s => {
    if (!s.points.length) return;
    const d = s.points.map((p, i) => (i ? 'L' : 'M') + px(p[0]).toFixed(1) + ',' + py(p[1]).toFixed(1)).join('');
    mk('path', {
      d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2,
      'stroke-dasharray': s.dash ? '5 4' : 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }, svg);
  });

  /* 라인 끝 직접 라벨 (겹침 방지 보정) */
  if (cfg.directLabels !== false) {
    const ends = cfg.series.filter(s => s.points.length).map(s => {
      const last = s.points[s.points.length - 1];
      return { s, x: px(last[0]), y: py(last[1]) };
    }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    }
    ends.forEach(e => {
      mk('circle', { cx: e.x, cy: py(e.s.points[e.s.points.length - 1][1]), r: 3.5, fill: e.s.color, stroke: surface, 'stroke-width': 1.5 }, svg);
      mk('text', { x: e.x + 9, y: e.y + 4, fill: sec, 'font-size': 12, 'font-weight': 600 }, svg).textContent = e.s.name;
    });
  }

  /* 호버 레이어 */
  const cross = mk('line', { y1: m.t, y2: H - m.b, stroke: base, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 }, svg);
  const markers = cfg.series.map(s => mk('circle', { r: 4.5, fill: s.color, stroke: surface, 'stroke-width': 2, opacity: 0 }, svg));
  const overlay = mk('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);

  overlay.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const dataX = x0 + (sx - m.l) / (W - m.l - m.r) * (x1 - x0);
    let rows = '', anyX = null;
    cfg.series.forEach((s, i) => {
      if (!s.points.length) { markers[i].setAttribute('opacity', 0); return; }
      let best = 0, bd = Infinity;
      for (let j = 0; j < s.points.length; j++) {
        const d = Math.abs(s.points[j][0] - dataX);
        if (d < bd) { bd = d; best = j; }
      }
      const p = s.points[best];
      anyX = p[0];
      markers[i].setAttribute('cx', px(p[0]));
      markers[i].setAttribute('cy', py(p[1]));
      markers[i].setAttribute('opacity', 1);
      rows += `<div class="tt-row"><span class="tt-swatch" style="background:${s.color}"></span>${s.name}: <b>${cfg.yTipFmt ? cfg.yTipFmt(p[1]) : p[1]}</b></div>`;
    });
    if (anyX === null) return;
    cross.setAttribute('x1', px(anyX)); cross.setAttribute('x2', px(anyX));
    cross.setAttribute('opacity', 1);
    showTip(`<div class="tt-title">${cfg.xTipFmt ? cfg.xTipFmt(anyX) : anyX}</div>${rows}`, e.clientX, e.clientY);
  });
  overlay.addEventListener('mouseleave', () => {
    cross.setAttribute('opacity', 0);
    markers.forEach(mm => mm.setAttribute('opacity', 0));
    hideTip();
  });
}

/* ============================================================
   1절 — 열화 문제 차트 (논문 Figure 1 근사 재구성)
   ============================================================ */
function degradationPoints(depth) {
  const pts = [];
  for (let it = 0; it <= 64000; it += 800) {
    let e;
    if (depth === 20) {
      e = it < 32000 ? 13 + 22 * Math.exp(-it / 8000)
        : it < 48000 ? 8.5 + 4.5 * Math.exp(-(it - 32000) / 3000)
          : 7.6 + 0.9 * Math.exp(-(it - 48000) / 3000);
    } else {
      e = it < 32000 ? 20 + 25 * Math.exp(-it / 9000)
        : it < 48000 ? 14 + 6.5 * Math.exp(-(it - 32000) / 3000)
          : 13.2 + 0.9 * Math.exp(-(it - 48000) / 3000);
    }
    e += Math.sin(it / 1500 + depth) * 1.1 * Math.exp(-it / 45000) * (it > 2000 ? 1 : 0.2);
    pts.push([it, Math.max(e, 0.5)]);
  }
  return pts;
}
function renderDegradation() {
  drawLineChart($('#chart-degradation'), {
    series: [
      { name: '56층 plain', color: cssv('--series-2'), points: degradationPoints(56) },
      { name: '20층 plain', color: cssv('--series-1'), points: degradationPoints(20) },
    ],
    xLabel: '훈련 반복 (iterations)', yLabel: '훈련 오류 (%)',
    yDomain: [0, 50], yMinZero: true,
    xTicks: [0, 16000, 32000, 48000, 64000],
    xFmt: v => (v / 1000) + 'k',
    xTipFmt: v => (v / 1000).toFixed(1) + 'k iterations',
    yTipFmt: v => v.toFixed(1) + '%',
    yFmt: v => v + '%',
    height: 290,
  });
}
rerenders.push(renderDegradation);
renderDegradation();

/* ============================================================
   2절 — 잔차 블록 애니메이션
   ============================================================ */
/* 잔차 브랜치를 구성하는 연산 박스 */
const BA_CONV = { label: '3×3 conv, 64', sub: 'weight', w: 140, h: 34 };
const BA_BN = { label: 'BN', w: 90, h: 26 };
const BA_RELU = { label: 'ReLU', w: 90, h: 26 };

/* 세 가지 블록 구성.
   rows   = 덧셈 노드 앞(잔차 브랜치 F)에 놓이는 연산
   postAdd = 덧셈 뒤에 남는 연산 (v2는 없음 = 완전한 항등 경로) */
const BLOCK_SPECS = {
  res: {
    rows: [BA_CONV, BA_BN, BA_RELU, BA_CONV, BA_BN],
    skip: true, postAdd: 'ReLU',
    formula: 'y = ReLU( F(x) + x )',
    mark: '← identity 경로를 방해',
    svgNote: {
      fwd: '두 경로가 덧셈에서 합류 — shortcut은 파라미터 0개',
      bwd: '그래디언트가 덧셈 노드에서 두 경로로 복제되어 거슬러 올라감'
    },
    note: '<strong>v1 · post-activation:</strong> 덧셈 <em>뒤에</em> ReLU가 한 번 더 걸립니다. ' +
      '지름길은 “거의” 항등이지만 완전한 항등은 아닙니다 — 100층대까지는 충분해도 1000층에서는 이 작은 방해가 누적됩니다.'
  },
  plain: {
    rows: [BA_CONV, BA_BN, BA_RELU, BA_CONV, BA_BN],
    skip: false, postAdd: 'ReLU',
    formula: 'y = ReLU( F(x) )',
    svgNote: {
      fwd: '경로가 하나뿐 — 모든 정보가 가중치 층을 통과해야 함',
      bwd: '그래디언트가 가중치 층들을 곱하며 통과 — 소멸/폭발 위험'
    },
    note: '<strong>plain:</strong> shortcut이 없으니 모든 신호가 가중치 층을 통과해야 합니다. ' +
      '역전파 그래디언트도 층마다 가중치와 곱해지며 지수적으로 소멸하거나 폭발합니다.'
  },
  v2: {
    rows: [BA_BN, BA_RELU, BA_CONV, BA_BN, BA_RELU, BA_CONV],
    skip: true, postAdd: null,
    formula: 'y = F(x) + x',
    mark: '덧셈 뒤에 아무것도 없음 — x가 그대로 통과',
    svgNote: {
      fwd: '덧셈부터 출력까지 손대지 않은 완전한 항등 경로',
      bwd: '그래디언트가 변형 없이 1로 직통 — 1001층도 훈련 가능'
    },
    note: '<strong>v2 · pre-activation:</strong> BN과 ReLU를 conv <em>앞</em>으로 옮기면 덧셈 뒤에 남는 연산이 없습니다. ' +
      '입력에서 출력까지 아무 변형도 거치지 않는 <strong>완전한 항등 경로</strong>가 뚫려 1001층 ResNet도 훈련됩니다(6절). ' +
      '잔차 브랜치가 항상 BN으로 시작한다는 점에서 정규화 효과도 더 좋아집니다.'
  }
};

/* 같은 렌더러로 카드 두 장(v1/plain 토글용, v2 전용)을 각각 그린다 */
function createBlockAnim({ hostSel, noteSel, state }) {
  let animFrame = null;
  function render() {
    cancelAnimationFrame(animFrame);
    const host = $(hostSel);
    host.innerHTML = '';
    const spec = BLOCK_SPECS[state.mode];
    const isFwd = state.dir === 'fwd';
    const blue = cssv('--series-1'), orange = cssv('--series-2'), ink = cssv('--text-primary');

    /* ---- 세로 레이아웃 계산 (박스 개수가 모드마다 다르므로 높이를 계산해서 뽑는다) ---- */
    const GAP = 16, TOP = 52, CX = 180;
    let cursor = TOP;
    const placed = spec.rows.map(r => { const y = cursor; cursor += r.h + GAP; return { r, y }; });
    const branchEnd = cursor - GAP;          /* 잔차 브랜치 마지막 박스 아래 */
    const plusCy = branchEnd + 46;           /* 덧셈 노드 중심 */
    const outTop = plusCy + 13, outEnd = outTop + 51;
    const yLabel = outEnd + 20;
    const H = yLabel + 76;

    const svg = mk('svg', { viewBox: `0 0 460 ${H}` }, null);
    host.appendChild(svg);

    /* ---- 경로 (잔차 브랜치 / 스킵 / 출력) ---- */
    const mainPath = mk('path', { d: `M${CX},34 L${CX},${spec.skip ? plusCy - 13 : outTop}`, class: 'ba-path' }, svg);
    const outPath = mk('path', { d: `M${CX},${outTop} L${CX},${outEnd}`, class: 'ba-path' }, svg);
    let skipPath = null;
    if (spec.skip) {
      skipPath = mk('path', {
        d: `M${CX},40 C320,46 340,84 340,132 L340,${plusCy - 46} ` +
           `C340,${plusCy - 12} 262,${plusCy} 195,${plusCy}`,
        class: 'ba-skip'
      }, svg);
      mk('text', { x: 352, y: 136, fill: blue, 'font-size': 12.5, 'font-weight': 600 }, svg).textContent = 'x';
      mk('text', { x: 348, y: 152, fill: blue, 'font-size': 11 }, svg).textContent = 'identity';
    }

    /* ---- 박스들 ---- */
    function box(x, y, w, h, label, sub) {
      mk('rect', { x, y, width: w, height: h, rx: 8, class: 'ba-box' }, svg);
      mk('text', { x: x + w / 2, y: y + (sub ? h / 2 - 2 : h / 2 + 4.5), 'text-anchor': 'middle', class: 'ba-box-label' }, svg).textContent = label;
      if (sub) mk('text', { x: x + w / 2, y: y + h / 2 + 12, 'text-anchor': 'middle', class: 'ba-sub' }, svg).textContent = sub;
    }
    mk('text', { x: CX, y: 24, 'text-anchor': 'middle', fill: ink, 'font-size': 16, 'font-style': 'italic', 'font-weight': 700 }, svg).textContent = 'x';
    placed.forEach(({ r, y }) => box(CX - r.w / 2, y, r.w, r.h, r.label, r.sub));
    mk('text', { x: 96, y: (TOP + branchEnd) / 2 + 5, 'text-anchor': 'end', fill: orange, 'font-size': 15, 'font-style': 'italic', 'font-weight': 700 }, svg).textContent = 'F(x)';

    /* ---- 덧셈 노드 · 덧셈 뒤 연산 ---- */
    if (spec.skip) {
      mk('circle', { cx: CX, cy: plusCy, r: 13, class: 'ba-plus' }, svg);
      mk('text', { x: CX, y: plusCy + 5.5, 'text-anchor': 'middle', fill: ink, 'font-size': 17 }, svg).textContent = '+';
    }
    if (spec.postAdd) box(135, outTop + 13, 90, 26, spec.postAdd);
    if (spec.mark) {
      const atRelu = !!spec.postAdd;
      mk('text', {
        x: atRelu ? 232 : 196, y: outTop + (atRelu ? 30 : 40),
        fill: atRelu ? orange : blue, 'font-size': 10.5, 'font-weight': 600
      }, svg).textContent = spec.mark;
    }
    mk('text', { x: CX, y: yLabel, 'text-anchor': 'middle', fill: ink, 'font-size': 16, 'font-style': 'italic', 'font-weight': 700 }, svg).textContent = 'y';

    /* ---- 수식 · 설명 ---- */
    mk('text', { x: CX, y: yLabel + 36, 'text-anchor': 'middle', class: 'ba-formula' }, svg).textContent = spec.formula;
    mk('text', { x: CX, y: yLabel + 58, 'text-anchor': 'middle', fill: cssv('--text-muted'), 'font-size': 11.5 }, svg)
      .textContent = isFwd ? spec.svgNote.fwd : spec.svgNote.bwd;
    $(noteSel).innerHTML = spec.note;

    /* ---- 흐름 애니메이션 ---- */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dotMain = mk('circle', { r: 6, fill: orange, opacity: 0.95 }, svg);
    const dotSkip = spec.skip ? mk('circle', { r: 6, fill: blue, opacity: 0.95 }, svg) : null;
    const dotOut = mk('circle', { r: 6, fill: ink, opacity: 0.95 }, svg);
    const lenMain = mainPath.getTotalLength();
    const lenOut = outPath.getTotalLength();
    const lenSkip = skipPath ? skipPath.getTotalLength() : 0;
    const T = 3000, SPLIT = 0.68;

    function place(dot, path, len, frac) {
      const p = path.getPointAtLength(len * Math.min(Math.max(frac, 0), 1));
      dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
    }
    function frame(now) {
      const p = (now % T) / T;
      if (isFwd) {
        if (p < SPLIT) {
          const f = p / SPLIT;
          place(dotMain, mainPath, lenMain, f);
          if (dotSkip) place(dotSkip, skipPath, lenSkip, f);
          dotMain.setAttribute('opacity', 0.95);
          if (dotSkip) dotSkip.setAttribute('opacity', 0.95);
          dotOut.setAttribute('opacity', 0);
        } else {
          const f = (p - SPLIT) / (1 - SPLIT);
          place(dotOut, outPath, lenOut, f);
          dotMain.setAttribute('opacity', 0); if (dotSkip) dotSkip.setAttribute('opacity', 0);
          dotOut.setAttribute('opacity', 0.95);
        }
      } else {
        if (p < 1 - SPLIT) {
          const f = 1 - p / (1 - SPLIT);
          place(dotOut, outPath, lenOut, f);
          dotOut.setAttribute('opacity', 0.95);
          dotMain.setAttribute('opacity', 0); if (dotSkip) dotSkip.setAttribute('opacity', 0);
        } else {
          const f = 1 - (p - (1 - SPLIT)) / SPLIT;
          place(dotMain, mainPath, lenMain, f);
          if (dotSkip) place(dotSkip, skipPath, lenSkip, f);
          dotMain.setAttribute('opacity', 0.95);
          if (dotSkip) dotSkip.setAttribute('opacity', 0.95);
          dotOut.setAttribute('opacity', 0);
        }
      }
      animFrame = requestAnimationFrame(frame);
    }
    animFrame = requestAnimationFrame(frame);
  }
  return render;
}

const blockState = { mode: 'res', dir: 'fwd' };
const blockV2State = { mode: 'v2', dir: 'fwd' };
const renderBlockAnim = createBlockAnim({ hostSel: '#block-anim', noteSel: '#block-anim-note', state: blockState });
const renderBlockAnimV2 = createBlockAnim({ hostSel: '#block-anim-v2', noteSel: '#block-anim-v2-note', state: blockV2State });

function setSeg(btns, on) {
  for (const k in btns) $(btns[k]).classList.toggle('active', k === on);
}
function bindSeg(btns, key, state, render) {
  for (const k in btns) {
    $(btns[k]).addEventListener('click', () => {
      state[key] = k; setSeg(btns, k); render();
    });
  }
}
bindSeg({ res: '#blk-btn-res', plain: '#blk-btn-plain' }, 'mode', blockState, renderBlockAnim);
bindSeg({ fwd: '#blk-btn-fwd', bwd: '#blk-btn-bwd' }, 'dir', blockState, renderBlockAnim);
bindSeg({ fwd: '#blk2-btn-fwd', bwd: '#blk2-btn-bwd' }, 'dir', blockV2State, renderBlockAnimV2);
rerenders.push(renderBlockAnim, renderBlockAnimV2);
renderBlockAnim();
renderBlockAnimV2();

/* ============================================================
   3절 — 신호 전파 시뮬레이터
   폭 32의 실제 무작위 네트워크에서 역전파를 수행해 층별 그래디언트 RMS를 측정
   ============================================================ */
const PROP = { width: 32, maxL: 64, seed: 20151210 };

function genBaseWeights(seed) {
  const rng = mulberry32(seed);
  const d = PROP.width, L = PROP.maxL;
  const make = () => {
    const arr = [];
    for (let l = 0; l < L; l++) {
      const W = new Float32Array(d * d);
      for (let i = 0; i < d * d; i++) W[i] = gaussian(rng);
      arr.push(W);
    }
    return arr;
  };
  PROP.plainW = make();
  PROP.resW = make();
  const seedVec = new Float32Array(d);
  for (let i = 0; i < d; i++) seedVec[i] = gaussian(rng);
  PROP.inputVec = seedVec;
  const gVec = new Float32Array(d);
  for (let i = 0; i < d; i++) gVec[i] = gaussian(rng);
  PROP.gradSeed = gVec;
}
genBaseWeights(PROP.seed);

function rms(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s / v.length);
}

function propSim(L, gain, lambda) {
  const d = PROP.width;
  const scale = gain * Math.sqrt(2 / d);
  const run = (weights, lam) => {
    /* 순전파: 활성값과 ReLU 마스크 저장.
       residual 쪽은 실제 ResNet의 BN처럼 잔차 브랜치 입력을 정규화해
       브랜치 출력 크기를 O(1)로 유지 (역전파에서는 정규화 계수를 상수 취급) */
    let a = Float32Array.from(PROP.inputVec);
    { const r = rms(a); for (let i = 0; i < d; i++) a[i] /= r; }
    const masks = [];
    const norms = new Float32Array(L);
    for (let l = 0; l < L; l++) {
      const W = weights[l];
      const r = lam === null ? 1 : Math.max(rms(a), 1e-12);
      norms[l] = r;
      const z = new Float32Array(d);
      for (let i = 0; i < d; i++) {
        let s = 0;
        for (let j = 0; j < d; j++) s += W[i * d + j] * a[j];
        z[i] = s * scale / r;
      }
      const mask = new Uint8Array(d);
      const relu = new Float32Array(d);
      for (let i = 0; i < d; i++) { if (z[i] > 0) { mask[i] = 1; relu[i] = z[i]; } }
      masks.push(mask);
      const next = new Float32Array(d);
      if (lam === null) {                       /* plain */
        for (let i = 0; i < d; i++) next[i] = relu[i];
      } else {                                  /* residual */
        for (let i = 0; i < d; i++) next[i] = lam * a[i] + relu[i];
      }
      a = next;
      if (!isFinite(rms(a))) break;
    }
    /* 역전파 */
    let g = Float32Array.from(PROP.gradSeed);
    { const r = rms(g); for (let i = 0; i < d; i++) g[i] /= r; }
    const gRms = new Array(L + 1);
    gRms[L] = 1;
    for (let l = L - 1; l >= 0; l--) {
      const W = weights[l], mask = masks[l] || new Uint8Array(d);
      const gm = new Float32Array(d);
      for (let i = 0; i < d; i++) gm[i] = mask[i] ? g[i] : 0;
      const gprev = new Float32Array(d);
      for (let j = 0; j < d; j++) {
        let s = 0;
        for (let i = 0; i < d; i++) s += W[i * d + j] * gm[i];
        gprev[j] = s * scale / norms[l] + (lam === null ? 0 : lam * g[j]);
      }
      g = gprev;
      let r = rms(g);
      if (!isFinite(r)) r = 1e12;
      gRms[l] = r;
    }
    return gRms;
  };
  return { plain: run(PROP.plainW, null), res: run(PROP.resW, lambda) };
}

function renderPropChart() {
  const L = +$('#prop-depth').value;
  const gain = +$('#prop-gain').value;
  $('#prop-depth-out').textContent = L;
  $('#prop-gain-out').textContent = gain.toFixed(2);
  const { plain, res } = propSim(L, gain, 1.0);
  const toPts = (arr) => arr.map((v, i) => [i, Math.min(Math.max(v, 1e-8), 1e8)]);
  drawLineChart($('#chart-prop-bwd'), {
    series: [
      { name: 'residual', color: cssv('--series-1'), points: toPts(res) },
      { name: 'plain', color: cssv('--series-2'), points: toPts(plain) },
    ],
    xLabel: '층 번호 (0 = 입력, 오른쪽 끝 = 출력. 그래디언트는 오른쪽에서 왼쪽으로 흐름)',
    yLabel: '그래디언트 RMS (로그)',
    yLog: true, yClamp: [1e-8, 1e8],
    xTipFmt: v => `층 ${Math.round(v)}`,
    yTipFmt: v => v.toExponential(2),
    yFmt: v => {
      const e = Math.round(Math.log10(v));
      return e === 0 ? '1' : '10' + toSup(e);
    },
    height: 300,
  });
}
function toSup(n) {
  const map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(n).split('').map(c => map[c] || c).join('');
}
$('#prop-depth').addEventListener('input', renderPropChart);
$('#prop-gain').addEventListener('input', renderPropChart);
$('#prop-rerun').addEventListener('click', () => {
  PROP.seed = (PROP.seed * 1103515245 + 12345) >>> 0;
  genBaseWeights(PROP.seed);
  renderPropChart();
});
rerenders.push(renderPropChart);
renderPropChart();

/* ---------- λ 스케일 차트 ---------- */
function renderLambdaChart() {
  const lam = +$('#lam').value;
  $('#lam-out').textContent = lam.toFixed(2);
  const mkPts = (l) => {
    const pts = [];
    for (let i = 0; i <= 100; i += 2) {
      const v = Math.pow(l, i);
      if (v < 1e-5 || v > 1e5) { pts.push([i, Math.min(Math.max(v, 1e-5), 1e5)]); break; }
      pts.push([i, v]);
    }
    return pts;
  };
  drawLineChart($('#chart-lambda'), {
    series: [
      { name: `λ = ${lam.toFixed(2)}`, color: cssv('--series-1'), points: mkPts(lam) },
      { name: 'λ = 1 (identity)', color: cssv('--text-muted'), points: mkPts(1), dash: true },
    ],
    xLabel: '통과한 블록 수', yLabel: '직통 경로 기여 Πλ (로그)',
    yLog: true, yClamp: [1e-5, 1e5], yDomain: [1e-5, 1e5],
    xTipFmt: v => `${Math.round(v)}번째 블록`,
    yTipFmt: v => v >= 0.01 && v <= 1000 ? v.toPrecision(3) : v.toExponential(2),
    yFmt: v => {
      const e = Math.round(Math.log10(v));
      return e === 0 ? '1' : '10' + toSup(e);
    },
    height: 270,
  });
}
$('#lam').addEventListener('input', renderLambdaChart);
rerenders.push(renderLambdaChart);
renderLambdaChart();

/* ============================================================
   4절 — 미니 학습 실험 (plain vs residual 실시간 훈련)
   ============================================================ */
const TRAIN = {
  width: 12, B: 10, running: false, raf: null,
  data: null, plain: null, res: null,
  lossPlain: [], lossRes: [], step: 0, totalSteps: 2400,
  rngSeed: 42,
};

function makeSpiral(rng) {
  const X = [], Y = [];
  const n = 110;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 5.2 + c * Math.PI;
      const r = 0.08 + 0.88 * (i / (n - 1));
      X.push([r * Math.sin(t) + gaussian(rng) * 0.025, r * Math.cos(t) + gaussian(rng) * 0.025]);
      Y.push(c);
    }
  }
  return { X, Y, N: X.length };
}

function makeMat(rows, cols, std, rng) {
  const W = new Float32Array(rows * cols);
  for (let i = 0; i < W.length; i++) W[i] = gaussian(rng) * std;
  return W;
}

function buildModels(B, w, rng) {
  const he = (fanin) => Math.sqrt(2 / fanin);
  /* plain: 입력사상 + (2B−1)개 은닉층 + 출력 → 가중치 층 2B+1개 */
  const plain = {
    type: 'plain', w,
    Win: makeMat(w, 2, he(2), rng), bin: new Float32Array(w),
    Ws: [], bs: [],
    Wout: makeMat(2, w, Math.sqrt(1 / w), rng), bout: new Float32Array(2),
  };
  for (let l = 0; l < 2 * B - 1; l++) {
    plain.Ws.push(makeMat(w, w, he(w), rng));
    plain.bs.push(new Float32Array(w));
  }
  /* residual: 입력사상 + B개 블록(각 2층) + 출력 → 가중치 층 2B+1개 (동일) */
  const res = {
    type: 'res', w,
    Win: makeMat(w, 2, he(2), rng), bin: new Float32Array(w),
    A: [], a: [], C: [], c: [],
    Wout: makeMat(2, w, Math.sqrt(1 / w), rng), bout: new Float32Array(2),
  };
  for (let b = 0; b < B; b++) {
    res.A.push(makeMat(w, w, he(w), rng));
    res.a.push(new Float32Array(w));
    res.C.push(makeMat(w, w, he(w) * 0.3, rng));   /* 블록 출력층은 작게 초기화(안정성) */
    res.c.push(new Float32Array(w));
  }
  /* 모멘텀 버퍼 */
  for (const m of [plain, res]) {
    m.vel = {};
    eachParam(m, (name, arr) => { m.vel[name] = new Float32Array(arr.length); });
    m.dead = false;
  }
  return { plain, res };
}

function eachParam(m, fn) {
  fn('Win', m.Win); fn('bin', m.bin); fn('Wout', m.Wout); fn('bout', m.bout);
  if (m.type === 'plain') {
    m.Ws.forEach((W, i) => { fn('Ws' + i, W); fn('bs' + i, m.bs[i]); });
  } else {
    m.A.forEach((W, i) => { fn('A' + i, W); fn('a' + i, m.a[i]); fn('C' + i, m.C[i]); fn('c' + i, m.c[i]); });
  }
}

/* 순전파 (배치). cache에 중간값 저장 */
function forward(m, X, N) {
  const w = m.w;
  const H0 = new Float32Array(N * w);
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < w; i++) {
      const z = m.Win[i * 2] * X[n][0] + m.Win[i * 2 + 1] * X[n][1] + m.bin[i];
      H0[n * w + i] = z > 0 ? z : 0;
    }
  }
  const cache = { H: [H0], T: [], masksT: [] };
  let H = H0;
  if (m.type === 'plain') {
    for (let l = 0; l < m.Ws.length; l++) {
      const W = m.Ws[l], b = m.bs[l];
      const Hn = new Float32Array(N * w);
      for (let n = 0; n < N; n++) {
        const off = n * w;
        for (let i = 0; i < w; i++) {
          let z = b[i];
          for (let j = 0; j < w; j++) z += W[i * w + j] * H[off + j];
          Hn[off + i] = z > 0 ? z : 0;
        }
      }
      cache.H.push(Hn); H = Hn;
    }
  } else {
    for (let bIdx = 0; bIdx < m.A.length; bIdx++) {
      const A = m.A[bIdx], a = m.a[bIdx], C = m.C[bIdx], c = m.c[bIdx];
      const T = new Float32Array(N * w);
      const Hn = new Float32Array(N * w);
      for (let n = 0; n < N; n++) {
        const off = n * w;
        for (let i = 0; i < w; i++) {
          let z = a[i];
          for (let j = 0; j < w; j++) z += A[i * w + j] * H[off + j];
          T[off + i] = z > 0 ? z : 0;
        }
        for (let i = 0; i < w; i++) {
          let s = c[i];
          for (let j = 0; j < w; j++) s += C[i * w + j] * T[off + j];
          Hn[off + i] = H[off + i] + s;        /* ★ h ← h + F(h) */
        }
      }
      cache.T.push(T); cache.H.push(Hn); H = Hn;
    }
  }
  /* 출력층 + softmax */
  const logits = new Float32Array(N * 2), probs = new Float32Array(N * 2);
  for (let n = 0; n < N; n++) {
    const off = n * w;
    for (let k = 0; k < 2; k++) {
      let z = m.bout[k];
      for (let j = 0; j < w; j++) z += m.Wout[k * w + j] * H[off + j];
      logits[n * 2 + k] = z;
    }
    const mx = Math.max(logits[n * 2], logits[n * 2 + 1]);
    const e0 = Math.exp(logits[n * 2] - mx), e1 = Math.exp(logits[n * 2 + 1] - mx);
    probs[n * 2] = e0 / (e0 + e1); probs[n * 2 + 1] = e1 / (e0 + e1);
  }
  cache.logits = logits; cache.probs = probs;
  return cache;
}

function trainStep(m, X, Y, N, lr) {
  if (m.dead) return NaN;
  const w = m.w;
  const cache = forward(m, X, N);
  /* 손실 */
  let loss = 0;
  for (let n = 0; n < N; n++) loss += -Math.log(Math.max(cache.probs[n * 2 + Y[n]], 1e-12));
  loss /= N;
  if (!isFinite(loss)) { m.dead = true; return NaN; }

  const grads = {};
  eachParam(m, (name, arr) => { grads[name] = new Float32Array(arr.length); });

  /* 출력층 역전파 */
  const Hlast = cache.H[cache.H.length - 1];
  const dH = new Float32Array(N * w);
  for (let n = 0; n < N; n++) {
    const off = n * w;
    for (let k = 0; k < 2; k++) {
      const dl = (cache.probs[n * 2 + k] - (Y[n] === k ? 1 : 0)) / N;
      grads.bout[k] += dl;
      for (let j = 0; j < w; j++) {
        grads.Wout[k * w + j] += dl * Hlast[off + j];
        dH[off + j] += m.Wout[k * w + j] * dl;
      }
    }
  }

  let d = dH;
  if (m.type === 'plain') {
    for (let l = m.Ws.length - 1; l >= 0; l--) {
      const W = m.Ws[l], Hin = cache.H[l], Hout = cache.H[l + 1];
      const dPrev = new Float32Array(N * w);
      const gW = grads['Ws' + l], gb = grads['bs' + l];
      for (let n = 0; n < N; n++) {
        const off = n * w;
        for (let i = 0; i < w; i++) {
          if (Hout[off + i] <= 0) continue;          /* ReLU 마스크 */
          const dz = d[off + i];
          gb[i] += dz;
          for (let j = 0; j < w; j++) {
            gW[i * w + j] += dz * Hin[off + j];
            dPrev[off + j] += W[i * w + j] * dz;
          }
        }
      }
      d = dPrev;
    }
  } else {
    for (let bIdx = m.A.length - 1; bIdx >= 0; bIdx--) {
      const A = m.A[bIdx], C = m.C[bIdx];
      const Hin = cache.H[bIdx], T = cache.T[bIdx];
      const dPrev = new Float32Array(N * w);
      const gA = grads['A' + bIdx], ga = grads['a' + bIdx], gC = grads['C' + bIdx], gc = grads['c' + bIdx];
      for (let n = 0; n < N; n++) {
        const off = n * w;
        /* dH' → C 경로 */
        for (let i = 0; i < w; i++) {
          const dh = d[off + i];
          gc[i] += dh;
          dPrev[off + i] += dh;                       /* ★ 지름길: 그래디언트 그대로 통과 */
        }
        for (let j = 0; j < w; j++) {
          if (T[off + j] <= 0) {
            /* gC의 해당 열 기여만 (T=0이면 dT 경로 없음) */
            continue;
          }
          let dT = 0;
          for (let i = 0; i < w; i++) dT += C[i * w + j] * d[off + i];
          ga[j] += dT;
          for (let k = 0; k < w; k++) {
            gA[j * w + k] += dT * Hin[off + k];
            dPrev[off + k] += A[j * w + k] * dT;
          }
        }
        /* gC: dC[i,j] = dh_i * T_j */
        for (let i = 0; i < w; i++) {
          const dh = d[off + i];
          if (dh === 0) continue;
          for (let j = 0; j < w; j++) {
            const t = T[off + j];
            if (t !== 0) gC[i * w + j] += dh * t;
          }
        }
      }
      d = dPrev;
    }
  }
  /* 입력 사상층 */
  const H0 = cache.H[0];
  for (let n = 0; n < N; n++) {
    const off = n * w;
    for (let i = 0; i < w; i++) {
      if (H0[off + i] <= 0) continue;
      const dz = d[off + i];
      grads.bin[i] += dz;
      grads.Win[i * 2] += dz * X[n][0];
      grads.Win[i * 2 + 1] += dz * X[n][1];
    }
  }

  /* 그래디언트 클리핑 + SGD(momentum) */
  let norm2 = 0;
  for (const k in grads) { const g = grads[k]; for (let i = 0; i < g.length; i++) norm2 += g[i] * g[i]; }
  const norm = Math.sqrt(norm2);
  const clip = norm > 5 ? 5 / norm : 1;
  eachParam(m, (name, arr) => {
    const g = grads[name], v = m.vel[name];
    for (let i = 0; i < arr.length; i++) {
      v[i] = 0.9 * v[i] - lr * g[i] * clip;
      arr[i] += v[i];
    }
  });
  return loss;
}

function predictPoint(m, x, y) {
  const cache = forward(m, [[x, y]], 1);
  return cache.probs[1];   /* 클래스 1 확률 */
}
function accuracy(m, data) {
  let ok = 0;
  const cache = forward(m, data.X, data.N);
  for (let n = 0; n < data.N; n++) {
    const pred = cache.probs[n * 2 + 1] > 0.5 ? 1 : 0;
    if (pred === data.Y[n]) ok++;
  }
  return ok / data.N;
}

function drawBoundary(canvas, model, data) {
  const ctx = canvas.getContext('2d');
  const size = 240, G = 48;
  const page = hexToRgb(cssv('--page').trim().startsWith('#') ? cssv('--page') : '#f9f9f7');
  const blue = hexToRgb(cssv('--series-1'));
  const orange = hexToRgb(cssv('--series-2'));
  ctx.clearRect(0, 0, size, size);
  if (model && !model.dead) {
    const off = document.createElement('canvas');
    off.width = G; off.height = G;
    const octx = off.getContext('2d');
    const img = octx.createImageData(G, G);
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const x = -1.15 + 2.3 * gx / (G - 1);
        const y = 1.15 - 2.3 * gy / (G - 1);
        const p = predictPoint(model, x, y);
        const col = mixRgb(orange, blue, p);
        const fin = mixRgb(page, col, 0.34);
        const idx = (gy * G + gx) * 4;
        img.data[idx] = fin[0]; img.data[idx + 1] = fin[1]; img.data[idx + 2] = fin[2]; img.data[idx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, size, size);
  }
  /* 데이터 점 */
  const surface = cssv('--surface-1');
  for (let n = 0; n < data.N; n++) {
    const px = (data.X[n][0] + 1.15) / 2.3 * size;
    const py = (1.15 - data.X[n][1]) / 2.3 * size;
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = data.Y[n] === 1 ? cssv('--series-1') : cssv('--series-2');
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = surface;
    ctx.stroke();
  }
  if (model && model.dead) {
    ctx.fillStyle = cssv('--text-primary');
    ctx.font = '600 15px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('발산 (gradient explosion)', size / 2, size / 2);
  }
}

function renderTrainChart() {
  const thin = (arr) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / 240)) === 0 || i === arr.length - 1);
  drawLineChart($('#chart-train'), {
    series: [
      { name: 'residual', color: cssv('--series-1'), points: thin(TRAIN.lossRes) },
      { name: 'plain', color: cssv('--series-2'), points: thin(TRAIN.lossPlain) },
    ],
    xLabel: '훈련 스텝', yLabel: '손실 (로그)',
    yLog: true, yClamp: [1e-3, 10], yDomain: [1e-3, 2],
    xDomain: [0, TRAIN.totalSteps],
    xTipFmt: v => `스텝 ${Math.round(v)}`,
    yTipFmt: v => v.toExponential(2),
    yFmt: v => { const e = Math.round(Math.log10(v)); return e === 0 ? '1' : '10' + toSup(e); },
    height: 270,
  });
}

function resetTraining() {
  cancelAnimationFrame(TRAIN.raf);
  TRAIN.running = false;
  TRAIN.step = 0;
  TRAIN.lossPlain = [[0, 0.75]];
  TRAIN.lossRes = [[0, 0.75]];
  const rng = mulberry32(TRAIN.rngSeed);
  TRAIN.data = makeSpiral(rng);
  const models = buildModels(TRAIN.B, TRAIN.width, rng);
  TRAIN.plain = models.plain;
  TRAIN.res = models.res;
  $('#acc-plain').textContent = '—';
  $('#acc-res').textContent = '—';
  $('#train-btn').disabled = false;
  $('#train-btn').textContent = '▶ 훈련 시작';
  renderTrainChart();
  drawBoundary($('#canvas-plain'), null, TRAIN.data);
  drawBoundary($('#canvas-res'), null, TRAIN.data);
}

function startTraining() {
  TRAIN.rngSeed = (Math.random() * 1e9) | 0;
  resetTraining();
  TRAIN.running = true;
  $('#train-btn').disabled = true;
  $('#train-btn').textContent = '훈련 중…';
  const lr = 0.03;
  let lastChart = 0, lastBoundary = 0;

  function loop() {
    const t0 = performance.now();
    while (performance.now() - t0 < 12 && TRAIN.step < TRAIN.totalSteps) {
      TRAIN.step++;
      const lp = trainStep(TRAIN.plain, TRAIN.data.X, TRAIN.data.Y, TRAIN.data.N, lr);
      const lres = trainStep(TRAIN.res, TRAIN.data.X, TRAIN.data.Y, TRAIN.data.N, lr);
      if (TRAIN.step % 4 === 0 || TRAIN.step === TRAIN.totalSteps) {
        if (isFinite(lp)) TRAIN.lossPlain.push([TRAIN.step, Math.max(lp, 1e-3)]);
        if (isFinite(lres)) TRAIN.lossRes.push([TRAIN.step, Math.max(lres, 1e-3)]);
      }
    }
    if (TRAIN.step - lastChart >= 60 || TRAIN.step >= TRAIN.totalSteps) {
      lastChart = TRAIN.step;
      renderTrainChart();
    }
    if (TRAIN.step - lastBoundary >= 300 || TRAIN.step >= TRAIN.totalSteps) {
      lastBoundary = TRAIN.step;
      drawBoundary($('#canvas-plain'), TRAIN.plain, TRAIN.data);
      drawBoundary($('#canvas-res'), TRAIN.res, TRAIN.data);
      $('#acc-plain').textContent = TRAIN.plain.dead ? '발산' : '정확도 ' + (accuracy(TRAIN.plain, TRAIN.data) * 100).toFixed(1) + '%';
      $('#acc-res').textContent = TRAIN.res.dead ? '발산' : '정확도 ' + (accuracy(TRAIN.res, TRAIN.data) * 100).toFixed(1) + '%';
    }
    if (TRAIN.step < TRAIN.totalSteps) {
      TRAIN.raf = requestAnimationFrame(loop);
    } else {
      TRAIN.running = false;
      $('#train-btn').disabled = false;
      $('#train-btn').textContent = '↻ 다시 훈련 (새 초기화)';
    }
  }
  TRAIN.raf = requestAnimationFrame(loop);
}

document.querySelectorAll('[data-depth]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-depth]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    TRAIN.B = (+btn.dataset.depth) / 2;
    resetTraining();
  });
});
$('#train-btn').addEventListener('click', startTraining);
rerenders.push(() => {
  renderTrainChart();
  drawBoundary($('#canvas-plain'), TRAIN.running || TRAIN.step > 0 ? TRAIN.plain : null, TRAIN.data);
  drawBoundary($('#canvas-res'), TRAIN.running || TRAIN.step > 0 ? TRAIN.res : null, TRAIN.data);
});
resetTraining();

/* ============================================================
   5절 — 아키텍처 탐색기
   ============================================================ */
const ARCH = {
  18:  { block: 'basic',      stages: [2, 2, 2, 2],   params: '11.7M', flops: 1.8,  layers: 18 },
  34:  { block: 'basic',      stages: [3, 4, 6, 3],   params: '21.8M', flops: 3.6,  layers: 34 },
  50:  { block: 'bottleneck', stages: [3, 4, 6, 3],   params: '25.6M', flops: 3.8,  layers: 50 },
  101: { block: 'bottleneck', stages: [3, 4, 23, 3],  params: '44.5M', flops: 7.6,  layers: 101 },
  152: { block: 'bottleneck', stages: [3, 8, 36, 3],  params: '60.2M', flops: 11.3, layers: 152 },
};
const STAGE_META = [
  { name: 'conv2_x', size: '56²', planes: 64 },
  { name: 'conv3_x', size: '28²', planes: 128 },
  { name: 'conv4_x', size: '14²', planes: 256 },
  { name: 'conv5_x', size: '7²',  planes: 512 },
];

function renderArch(modelKey) {
  const info = ARCH[modelKey];
  const stageColors = [cssv('--seq-250'), cssv('--seq-350'), cssv('--seq-450'), cssv('--seq-550')];
  const view = $('#arch-view');
  view.innerHTML = '';
  const flow = document.createElement('div');
  flow.className = 'arch-flow';

  const stem = (html) => {
    const d = document.createElement('div');
    d.className = 'arch-stem';
    d.innerHTML = html;
    flow.appendChild(d);
  };
  const arrow = () => {
    const a = document.createElement('span');
    a.className = 'arch-arrow';
    a.textContent = '→';
    flow.appendChild(a);
  };

  stem('입력<small>224×224×3</small>');
  arrow();
  stem('7×7 conv, 64<small>stride 2 → 112²</small>');
  arrow();
  stem('3×3 maxpool<small>stride 2 → 56²</small>');
  arrow();

  info.stages.forEach((count, si) => {
    const meta = STAGE_META[si];
    const outCh = info.block === 'bottleneck' ? meta.planes * 4 : meta.planes;
    const stage = document.createElement('div');
    stage.className = 'arch-stage';
    const label = document.createElement('div');
    label.className = 'arch-stage-label';
    label.textContent = `${meta.name} · ${meta.size} · ${outCh}ch × ${count}`;
    stage.appendChild(label);
    const blocks = document.createElement('div');
    blocks.className = 'arch-blocks';
    const comp = info.block === 'bottleneck'
      ? `1×1, ${meta.planes} → 3×3, ${meta.planes} → 1×1, ${outCh}`
      : `3×3, ${meta.planes} → 3×3, ${meta.planes}`;
    for (let b = 0; b < count; b++) {
      const el = document.createElement('div');
      el.className = 'arch-block';
      el.style.background = stageColors[si];
      const isDs = b === 0 && (si > 0 || info.block === 'bottleneck');
      if (isDs) el.classList.add('ds');
      el.dataset.tt = `<b>${meta.name} 블록 ${b + 1}/${count}</b><br>${comp}<br>+ identity shortcut`
        + (isDs ? `<br><i>${si > 0 ? 'stride 2 다운샘플 + ' : ''}projection shortcut (1×1 conv)</i>` : '');
      blocks.appendChild(el);
    }
    stage.appendChild(blocks);
    flow.appendChild(stage);
    arrow();
  });

  stem('global<br>avg pool<small>→ 1×1</small>');
  arrow();
  stem('fc 1000<small>softmax</small>');
  view.appendChild(flow);

  const totalBlocks = info.stages.reduce((a, b) => a + b, 0);
  $('#arch-stats').innerHTML =
    `<span>가중치 층 <b>${info.layers}</b></span>` +
    `<span>잔차 블록 <b>${totalBlocks}개</b> (${info.block === 'bottleneck' ? '병목 3층' : '기본 2층'})</span>` +
    `<span>파라미터 <b>${info.params}</b></span>` +
    `<span>연산량 <b>${info.flops} GFLOPs</b></span>` +
    `<span>VGG-19 대비 <b>${Math.round(info.flops / 19.6 * 100)}%</b></span>`;
}
let currentArch = 34;
document.querySelectorAll('#arch-tabs [data-model]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#arch-tabs [data-model]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentArch = +btn.dataset.model;
    renderArch(currentArch);
  });
});
rerenders.push(() => renderArch(currentArch));
renderArch(currentArch);

/* ---------- 병목 블록 파라미터 비교 ---------- */
function renderBottleneckCompare() {
  const host = $('#bottleneck-compare');
  host.innerHTML = `
  <div class="bnc-col">
    <div class="bnc-title">Basic 블록</div>
    <div class="bnc-sub">입출력 64채널 · 2층 (ResNet-18/34)</div>
    <div class="bnc-layer" data-tt="3×3×64×64 = 36,864"><span>3×3 conv, 64→64</span><span class="k">36.9k</span></div>
    <div class="bnc-layer" data-tt="3×3×64×64 = 36,864"><span>3×3 conv, 64→64</span><span class="k">36.9k</span></div>
    <div class="bnc-total"><span class="k">파라미터 합</span><span>73.7k</span></div>
  </div>
  <div class="bnc-col">
    <div class="bnc-title">Bottleneck 블록</div>
    <div class="bnc-sub">입출력 256채널 · 3층 (ResNet-50/101/152)</div>
    <div class="bnc-layer" data-tt="1×1×256×64 = 16,384"><span>1×1 conv, 256→64 <small>압축</small></span><span class="k">16.4k</span></div>
    <div class="bnc-layer" data-tt="3×3×64×64 = 36,864"><span>3×3 conv, 64→64</span><span class="k">36.9k</span></div>
    <div class="bnc-layer" data-tt="1×1×64×256 = 16,384"><span>1×1 conv, 64→256 <small>복원</small></span><span class="k">16.4k</span></div>
    <div class="bnc-total"><span class="k">파라미터 합</span><span>69.6k</span></div>
  </div>`;
}
renderBottleneckCompare();

/* ---------- ImageNet 결과 막대 차트 ---------- */
function renderResults() {
  const el = $('#chart-results');
  el.innerHTML = '';
  const sec = cssv('--text-secondary'), muted = cssv('--text-muted'),
    base = cssv('--baseline'), gridc = cssv('--grid'),
    ink = cssv('--text-primary'), surface = cssv('--surface-1');
  const blue = cssv('--series-1'), orange = cssv('--series-2');
  const bars = [
    { label: 'plain-34', v: 10.02, c: orange, grp: '잔차 없음' },
    { label: 'VGG-16', v: 9.33, c: orange, grp: '잔차 없음' },
    { label: 'ResNet-34', v: 7.46, c: blue, grp: 'ResNet' },
    { label: 'ResNet-50', v: 6.71, c: blue, grp: 'ResNet' },
    { label: 'ResNet-101', v: 6.05, c: blue, grp: 'ResNet' },
    { label: 'ResNet-152', v: 5.71, c: blue, grp: 'ResNet' },
  ];
  const leg = document.createElement('div');
  leg.style.cssText = 'display:flex;gap:16px;font-size:12.5px;margin-bottom:6px;color:' + sec;
  leg.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:${orange}"></span>잔차 연결 없음</span>` +
    `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:${blue}"></span>ResNet</span>`;
  el.appendChild(leg);

  const W = 720, H = 270, m = { l: 46, r: 10, t: 22, b: 34 };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}` }, null);
  el.appendChild(svg);
  const vmax = 11;
  const py = (v) => H - m.b - v / vmax * (H - m.t - m.b);
  niceTicks(0, vmax, 5).forEach(t => {
    mk('line', { x1: m.l, x2: W - m.r, y1: py(t), y2: py(t), stroke: gridc }, svg);
    mk('text', { x: m.l - 7, y: py(t) + 4, 'text-anchor': 'end', fill: muted, 'font-size': 11 }, svg).textContent = t + '%';
  });
  mk('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: base }, svg);

  const n = bars.length;
  const slot = (W - m.l - m.r) / n;
  const bw = Math.min(64, slot * 0.6);
  bars.forEach((b, i) => {
    const x = m.l + slot * i + (slot - bw) / 2;
    const yt = py(b.v), yb = H - m.b;
    const r = 4;
    const path = mk('path', {
      d: `M${x},${yb} L${x},${yt + r} A${r},${r} 0 0 1 ${x + r},${yt} L${x + bw - r},${yt} A${r},${r} 0 0 1 ${x + bw},${yt + r} L${x + bw},${yb} Z`,
      fill: b.c
    }, svg);
    path.style.cursor = 'default';
    path.addEventListener('mousemove', (e) => showTip(
      `<div class="tt-title">${b.label}</div><div class="tt-row"><span class="tt-swatch" style="background:${b.c}"></span>top-5 오류: <b>${b.v.toFixed(2)}%</b> · ${b.grp}</div>`,
      e.clientX, e.clientY));
    path.addEventListener('mouseleave', hideTip);
    mk('text', { x: x + bw / 2, y: yt - 7, 'text-anchor': 'middle', fill: ink, 'font-size': 12, 'font-weight': 600 }, svg).textContent = b.v.toFixed(2);
    mk('text', { x: x + bw / 2, y: H - m.b + 17, 'text-anchor': 'middle', fill: muted, 'font-size': 11.5 }, svg).textContent = b.label;
  });
}
rerenders.push(renderResults);
renderResults();

/* ============================================================
   코드 하이라이팅 (간단 정규식)
   ============================================================ */
document.querySelectorAll('code.lang-py').forEach(block => {
  let src = block.textContent
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /* 주석을 placeholder로 빼둔 뒤 나머지를 하이라이팅하고 마지막에 복원 */
  const stash = [];
  src = src.replace(/(#[^\n]*)/g, (m0) => {
    stash.push(m0);
    return '@@C' + (stash.length - 1) + '@@';
  });
  src = src.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="tok-str">$1</span>');
  src = src.replace(/\b(class|def|return|if|is|not|None|for|in|import|self|super|True|False)\b/g, '<span class="tok-kw">$1</span>');
  src = src.replace(/@@C(\d+)@@/g, (m0, i) => `<span class="tok-com">${stash[+i]}</span>`);
  src = src.replace(/^(.*out \+= identity.*)$/gm, '<span class="tok-star">$1</span>');
  block.innerHTML = src;
});
