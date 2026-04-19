/* ═══════════════════════════════════════════════════════
   ELECTRIC WEBS — dxio — script.js
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ─── CONFIG & DEFAULTS ─────────────────────────────── */
let CFG = {
  effects: {
    particleCount: 72,
    lightningSegments: 14,
    lightningRoughness: 0.32,
    arcLayers: 3,
    bgArcMaxDist: 180,
  },
  mediapipe: {
    maxHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.62,
  },
};

/* ─── DOM REFS ───────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const DOM = {
  landing:    $('screen-landing'),
  camera:     $('screen-camera'),
  bgCanvas:   $('bg-canvas'),
  overlay:    $('overlay'),
  video:      $('video'),
  startBtn:   $('start-btn'),
  backBtn:    $('back-btn'),
  flash:      $('flash'),
  statusText: $('hand-status-text'),
  indicator:  $('hand-indicator'),
  handCount:  $('hand-count'),
};

/* ─── CANVAS CONTEXTS ────────────────────────────────── */
const bgCtx  = DOM.bgCanvas.getContext('2d');
const ovCtx  = DOM.overlay.getContext('2d');

/* ─── FINGER CONFIG ──────────────────────────────────── */
// Each finger tip → a unique electric color
const FINGERS = [
  { tipIdx: 4,  color: '#00d4ff', glow: '#0055cc', label: 'thumb'  },
  { tipIdx: 8,  color: '#00ffaa', glow: '#00774d', label: 'index'  },
  { tipIdx: 12, color: '#cc44ff', glow: '#5500aa', label: 'middle' },
  { tipIdx: 16, color: '#ffbb00', glow: '#886600', label: 'ring'   },
  { tipIdx: 20, color: '#ff3366', glow: '#aa0033', label: 'pinky'  },
];

// Adjacent tip pairs for intra-hand web
const TIP_PAIRS = [[4,8],[8,12],[12,16],[16,20]];

// Hand skeleton connections
const SKELETON = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],[5,9],[9,13],[0,5],
];

/* ─── GLOBAL STATE ───────────────────────────────────── */
let bgRafId    = null;
let bgParticles = [];
let mpHands    = null;
let mpCamera   = null;
let lastResults = null;

/* ═══════════════════════════════════════════════════════
   1. CONFIG LOADER
   ═══════════════════════════════════════════════════════ */
async function loadConfig() {
  try {
    const r = await fetch('./config.json');
    if (r.ok) CFG = await r.json();
  } catch (_) { /* use defaults */ }
}

/* ═══════════════════════════════════════════════════════
   2. BACKGROUND CANVAS ANIMATION
   ═══════════════════════════════════════════════════════ */

function resizeBg() {
  DOM.bgCanvas.width  = window.innerWidth;
  DOM.bgCanvas.height = window.innerHeight;
}

function spawnParticle(w, h) {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.55,
    vy: (Math.random() - 0.5) * 0.55,
    r: Math.random() * 1.6 + 0.4,
    phase: Math.random() * Math.PI * 2,
    arcCd: Math.floor(Math.random() * 240),
  };
}

function initBgParticles() {
  const { width: w, height: h } = DOM.bgCanvas;
  const count = CFG.effects?.particleCount ?? 72;
  bgParticles = Array.from({ length: count }, () => spawnParticle(w, h));
}

/* Draw faint grid */
function drawGrid(ctx, w, h) {
  const gs = 90;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.restore();
}

/* Lightning path between two background particles */
function bgArc(x1, y1, x2, y2, alpha) {
  const pts = jagged(x1, y1, x2, y2, 7, 0.22);
  bgCtx.save();
  bgCtx.globalAlpha = alpha;
  bgCtx.shadowBlur  = 10;
  bgCtx.shadowColor = '#00d4ff';
  bgCtx.strokeStyle = '#00d4ff';
  bgCtx.lineWidth   = 0.7;
  strokePts(bgCtx, pts);
  bgCtx.restore();
}

function animateBg(ts) {
  const { width: w, height: h } = DOM.bgCanvas;

  /* Soft trail for persistence effect */
  bgCtx.fillStyle = 'rgba(2,2,9,0.18)';
  bgCtx.fillRect(0, 0, w, h);

  drawGrid(bgCtx, w, h);

  bgParticles.forEach((p, i) => {
    /* Move & wrap */
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = w; else if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h; else if (p.y > h) p.y = 0;

    const bright = 0.35 + 0.45 * Math.sin(ts * 0.0009 + p.phase);

    /* Draw particle dot */
    bgCtx.save();
    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    bgCtx.fillStyle = `rgba(0,212,255,${bright})`;
    bgCtx.shadowBlur  = 7;
    bgCtx.shadowColor = '#00d4ff';
    bgCtx.fill();
    bgCtx.restore();

    /* Occasional arc to a nearby particle */
    if (--p.arcCd <= 0) {
      p.arcCd = 120 + Math.floor(Math.random() * 280);
      const maxD = CFG.effects?.bgArcMaxDist ?? 180;
      for (let j = i + 1; j < bgParticles.length; j++) {
        const q = bgParticles[j];
        const dx = q.x - p.x, dy = q.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < maxD) {
          bgArc(p.x, p.y, q.x, q.y, (1 - dist / maxD) * 0.45);
          break;
        }
      }
    }
  });

  bgRafId = requestAnimationFrame(animateBg);
}

function startBgAnim() {
  if (!bgRafId) bgRafId = requestAnimationFrame(animateBg);
}
function stopBgAnim() {
  if (bgRafId) { cancelAnimationFrame(bgRafId); bgRafId = null; }
}

/* ═══════════════════════════════════════════════════════
   3. LIGHTNING DRAWING UTILITIES
   ═══════════════════════════════════════════════════════ */

/* Generate a jagged path between two points */
function jagged(x1, y1, x2, y2, segs, roughness) {
  const dx  = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx  = -dy / len, ny = dx / len;       // perpendicular normal
  const pts = [{ x: x1, y: y1 }];
  for (let i = 1; i < segs; i++) {
    const t   = i / segs;
    const off = (Math.random() - 0.5) * 2 * len * roughness;
    pts.push({ x: x1 + dx * t + nx * off, y: y1 + dy * t + ny * off });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

/* Draw a polyline from array of {x,y} */
function strokePts(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/**
 * Draw a full electric bolt from (x1,y1) to (x2,y2).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x1 y1 x2 y2
 * @param {Object} opts - color, glow, segs, rough, alpha, lw
 */
function lightning(ctx, x1, y1, x2, y2, opts = {}) {
  const {
    color   = '#00d4ff',
    glow    = '#0055cc',
    segs    = 14,
    rough   = 0.32,
    alpha   = 1,
    lw      = 2,
  } = opts;

  const pts = jagged(x1, y1, x2, y2, segs, rough);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';

  /* Outer wide glow */
  ctx.shadowBlur  = 32;
  ctx.shadowColor = glow;
  ctx.strokeStyle = glow;
  ctx.lineWidth   = lw + 6;
  strokePts(ctx, pts);

  /* Mid glow */
  ctx.shadowBlur  = 14;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth   = lw;
  strokePts(ctx, pts);

  /* Bright white core */
  ctx.shadowBlur  = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth   = Math.max(0.5, lw * 0.28);
  strokePts(ctx, pts);

  ctx.restore();
}

/* Draw a glowing node (fingertip dot) */
function node(ctx, x, y, color, glow, r = 5) {
  ctx.save();
  /* Outer halo */
  ctx.beginPath();
  ctx.arc(x, y, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = glow.replace(')', ',0.15)').replace('rgb', 'rgba');
  ctx.shadowBlur  = 20;
  ctx.shadowColor = glow;
  ctx.fill();
  /* Main dot */
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle   = color;
  ctx.shadowBlur  = 18;
  ctx.shadowColor = glow;
  ctx.fill();
  /* White core */
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle   = '#fff';
  ctx.shadowBlur  = 0;
  ctx.fill();
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════
   4. OVERLAY — COORDINATE HELPERS
   ═══════════════════════════════════════════════════════ */

function resizeOverlay() {
  DOM.overlay.width  = window.innerWidth;
  DOM.overlay.height = window.innerHeight;
}

/* Mirror x for user-facing (selfie) orientation */
function lx(lm) { return (1 - lm.x) * DOM.overlay.width;  }
function ly(lm) { return lm.y        * DOM.overlay.height; }

/* ═══════════════════════════════════════════════════════
   5. HAND DRAWING LOGIC
   ═══════════════════════════════════════════════════════ */

function drawSkeleton(lms, baseColor) {
  const ctx = ovCtx;
  ctx.save();
  ctx.globalAlpha  = 0.22;
  ctx.strokeStyle  = baseColor;
  ctx.shadowBlur   = 5;
  ctx.shadowColor  = baseColor;
  ctx.lineWidth    = 1;
  ctx.lineJoin     = 'round';
  SKELETON.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(lx(lms[a]), ly(lms[a]));
    ctx.lineTo(lx(lms[b]), ly(lms[b]));
    ctx.stroke();
  });
  /* Knuckle dots */
  lms.forEach((lm, i) => {
    if (i === 0) return;
    ctx.beginPath();
    ctx.arc(lx(lm), ly(lm), 2.2, 0, Math.PI * 2);
    ctx.fillStyle  = baseColor;
    ctx.shadowBlur = 6;
    ctx.fill();
  });
  ctx.restore();
}

/* Render everything based on MediaPipe results */
function renderHands(results) {
  const ctx = ovCtx;
  const W   = DOM.overlay.width;
  const H   = DOM.overlay.height;

  ctx.clearRect(0, 0, W, H);

  const hands = results?.multiHandLandmarks;
  if (!hands || hands.length === 0) {
    setStatus('SCANNING', false);
    DOM.handCount.textContent = '0 HANDS';
    return;
  }

  const n = hands.length;
  DOM.handCount.textContent = `${n} HAND${n > 1 ? 'S' : ''} DETECTED`;
  setStatus(n === 2 ? 'CHARGING' : 'TRACKING', n === 2);

  /* Draw skeleton for each detected hand */
  const HAND_COLORS = ['#00d4ff', '#7c3aff'];
  hands.forEach((lms, hi) => drawSkeleton(lms, HAND_COLORS[hi % 2]));

  /* ── INTER-HAND ELECTRIC WEBS ───────────────────── */
  if (n >= 2) {
    const [h1, h2] = hands;
    const layerCfg = CFG.effects?.arcLayers ?? 3;
    const segs     = CFG.effects?.lightningSegments ?? 14;
    const rough    = CFG.effects?.lightningRoughness ?? 0.32;

    FINGERS.forEach((f) => {
      const x1 = lx(h1[f.tipIdx]), y1 = ly(h1[f.tipIdx]);
      const x2 = lx(h2[f.tipIdx]), y2 = ly(h2[f.tipIdx]);

      /* Multiple arc layers for a wild, thick electric look */
      for (let arc = 0; arc < layerCfg; arc++) {
        lightning(ovCtx, x1, y1, x2, y2, {
          color: f.color,
          glow:  f.glow,
          segs:  segs + arc * 5,
          rough: rough + arc * 0.07,
          alpha: arc === 0 ? 1 : arc === 1 ? 0.48 : 0.22,
          lw:    arc === 0 ? 2.5 : 1.4,
        });
      }

      /* Glowing nodes at each fingertip */
      node(ovCtx, x1, y1, f.color, f.glow, 5.5);
      node(ovCtx, x2, y2, f.color, f.glow, 5.5);
    });

    /* ── INTRA-HAND WEB (adjacent tips within each hand) */
    hands.forEach((lms) => {
      TIP_PAIRS.forEach(([a, b], pi) => {
        const fa = FINGERS[pi] ?? FINGERS[0];
        lightning(ovCtx, lx(lms[a]), ly(lms[a]), lx(lms[b]), ly(lms[b]), {
          color: fa.color,
          glow:  fa.glow,
          segs:  8,
          rough: 0.18,
          alpha: 0.3,
          lw:    1,
        });
      });
    });
  } else {
    /* Only one hand: just show fingertip nodes */
    const lms = hands[0];
    FINGERS.forEach((f) => {
      node(ovCtx, lx(lms[f.tipIdx]), ly(lms[f.tipIdx]), f.color, f.glow, 4.5);
    });
  }
}

function setStatus(text, active) {
  DOM.statusText.textContent = text;
  if (active) {
    DOM.indicator.classList.add('active');
  } else {
    DOM.indicator.classList.remove('active');
  }
}

/* ═══════════════════════════════════════════════════════
   6. MEDIAPIPE SETUP
   ═══════════════════════════════════════════════════════ */
async function initMediaPipe() {
  const mp = CFG.mediapipe;

  mpHands = new Hands({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });

  mpHands.setOptions({
    maxNumHands:              mp.maxHands            ?? 2,
    modelComplexity:          mp.modelComplexity     ?? 1,
    minDetectionConfidence:   mp.minDetectionConfidence ?? 0.72,
    minTrackingConfidence:    mp.minTrackingConfidence  ?? 0.62,
  });

  mpHands.onResults((results) => {
    lastResults = results;
    renderHands(results);
  });

  mpCamera = new Camera(DOM.video, {
    onFrame: async () => {
      if (mpHands) await mpHands.send({ image: DOM.video });
    },
    width:  1280,
    height: 720,
  });

  await mpCamera.start();
}

/* ═══════════════════════════════════════════════════════
   7. SCREEN TRANSITIONS
   ═══════════════════════════════════════════════════════ */

/* Flash then switch screens */
function flashTransition(cb) {
  DOM.flash.classList.add('pop');
  setTimeout(() => {
    cb();
    DOM.flash.classList.remove('pop');
  }, 280);
}

async function goToCamera() {
  DOM.startBtn.disabled = true;

  flashTransition(() => {
    DOM.landing.classList.remove('active');
    DOM.camera.classList.add('active');
    resizeOverlay();
    setStatus('LOADING', false);
  });

  stopBgAnim();

  try {
    await initMediaPipe();
  } catch (err) {
    console.error('MediaPipe / Camera init error:', err);
    alert(
      'Camera access was denied or MediaPipe failed to load.\n' +
      'Please allow camera access and reload the page.'
    );
    goToLanding();
    return;
  }

  DOM.startBtn.disabled = false;
}

function goToLanding() {
  /* Stop camera & hands */
  if (mpCamera) { mpCamera.stop(); mpCamera = null; }
  if (mpHands)  { mpHands.close(); mpHands  = null; }

  ovCtx.clearRect(0, 0, DOM.overlay.width, DOM.overlay.height);
  lastResults = null;

  flashTransition(() => {
    DOM.camera.classList.remove('active');
    DOM.landing.classList.add('active');
  });

  startBgAnim();
  DOM.startBtn.disabled = false;
}

/* ═══════════════════════════════════════════════════════
   8. RESIZE HANDLER
   ═══════════════════════════════════════════════════════ */
function onResize() {
  resizeBg();
  initBgParticles();
  resizeOverlay();
}

/* ═══════════════════════════════════════════════════════
   9. INIT
   ═══════════════════════════════════════════════════════ */
async function init() {
  await loadConfig();

  /* Size canvases */
  resizeBg();
  resizeOverlay();
  window.addEventListener('resize', onResize);

  /* Boot bg animation */
  initBgParticles();
  startBgAnim();

  /* Show landing */
  DOM.landing.classList.add('active');

  /* Events */
  DOM.startBtn.addEventListener('click', goToCamera);
  DOM.backBtn.addEventListener('click', goToLanding);
}

init();
