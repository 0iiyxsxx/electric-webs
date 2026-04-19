/* ================================================================
   dxio's electric webs — script.js
   Hand tracking + electric line renderer
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */

let CFG = null;             // data.json config
let bgCanvas, bgCtx;        // Background particle canvas
let camCanvas, camCtx;      // Camera + effects canvas
let videoEl;                // Hidden <video> element
let mpHands = null;         // MediaPipe Hands instance
let mpCamera = null;        // MediaPipe Camera instance
let isTracking = false;     // Whether tracking loop is active
let lastResults = null;     // Latest hand detection results
let renderFrameId = null;   // requestAnimationFrame ID
let bgFrameId    = null;    // Background rAF ID
let particles    = [];      // Background particles

// MediaPipe fingertip landmark indices
const TIP_INDICES = [
  4,   // Thumb
  8,   // Index
  12,  // Middle
  16,  // Ring
  20,  // Pinky
];

// Per-finger electric colours (neon palette)
const FINGER_COLORS = [
  '#00eeff',  // thumb  — ice cyan
  '#00aaff',  // index  — electric blue
  '#00ffcc',  // middle — neon mint
  '#44aaff',  // ring   — sky
  '#00d4ff',  // pinky  — primary cyan
];

/* ──────────────────────────────────────────────────────────────
   BOOTSTRAP
────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  // Load config (fallback to embedded defaults on failure)
  CFG = await loadConfig();

  // DOM references
  bgCanvas = document.getElementById('bgCanvas');
  bgCtx    = bgCanvas.getContext('2d');
  camCanvas = document.getElementById('cameraCanvas');
  camCtx    = camCanvas.getContext('2d', { alpha: false });
  videoEl   = document.getElementById('video');

  // Initial sizing
  resizeBgCanvas();
  window.addEventListener('resize', onWindowResize);

  // Start background animation
  initParticles();
  animateBg();

  // Wire up button events
  document.getElementById('startBtn').addEventListener('click', handleStart);
  document.getElementById('backBtn').addEventListener('click', handleBack);
  document.getElementById('retryBtn').addEventListener('click', handleRetry);

  // Magnetic hover — desktop only
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    initMagnetic(document.getElementById('startBtn'));
  }
});

/* ──────────────────────────────────────────────────────────────
   CONFIG
────────────────────────────────────────────────────────────── */

async function loadConfig() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('fetch failed');
    return await res.json();
  } catch (_) {
    return fallbackConfig();
  }
}

function fallbackConfig() {
  return {
    github:       { username: '0iiyxsx', url: 'https://github.com/0iiyxsx' },
    handTracking: { maxHands: 2, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 },
    electricEffect: {
      segments: 10,
      jitter: 20,
      glowSize: 26,
      flickerRate: 0.08,
      lineWidth: 2,
    },
    particles: { count: 55, speed: 0.38, connectionDistance: 130, size: 1.5 },
  };
}

/* ──────────────────────────────────────────────────────────────
   BACKGROUND — PARTICLE FIELD
────────────────────────────────────────────────────────────── */

function resizeBgCanvas() {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}

function initParticles() {
  particles = [];

  // Scale count by screen area — fewer on small/slow devices
  const area    = window.innerWidth * window.innerHeight;
  const density = CFG.particles.count / (1920 * 1080);
  const count   = Math.max(20, Math.min(CFG.particles.count, Math.floor(area * density)));

  for (let i = 0; i < count; i++) {
    particles.push(createParticle());
  }
}

function createParticle() {
  return {
    x:   Math.random() * window.innerWidth,
    y:   Math.random() * window.innerHeight,
    vx:  (Math.random() - 0.5) * CFG.particles.speed * 2,
    vy:  (Math.random() - 0.5) * CFG.particles.speed * 2,
    r:   Math.random() * CFG.particles.size + 0.5,
    a:   Math.random() * 0.45 + 0.15,
  };
}

function animateBg() {
  const W = bgCanvas.width;
  const H = bgCanvas.height;

  // Fade — creates trail effect
  bgCtx.fillStyle = 'rgba(5, 5, 8, 0.18)';
  bgCtx.fillRect(0, 0, W, H);

  const dist = CFG.particles.connectionDistance;
  const n    = particles.length;

  for (let i = 0; i < n; i++) {
    const p = particles[i];

    // Move
    p.x += p.vx;
    p.y += p.vy;

    // Wrap edges with margin
    if (p.x < -20) p.x = W + 20;
    if (p.x > W + 20) p.x = -20;
    if (p.y < -20) p.y = H + 20;
    if (p.y > H + 20) p.y = -20;

    // Draw dot
    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    bgCtx.fillStyle = `rgba(0, 170, 255, ${p.a})`;
    bgCtx.fill();

    // Connect to nearby particles
    for (let j = i + 1; j < n; j++) {
      const q  = particles[j];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d  = Math.hypot(dx, dy);

      if (d < dist) {
        const alpha = (1 - d / dist) * 0.12;
        bgCtx.beginPath();
        bgCtx.moveTo(p.x, p.y);
        bgCtx.lineTo(q.x, q.y);
        bgCtx.strokeStyle = `rgba(0, 170, 255, ${alpha})`;
        bgCtx.lineWidth   = 0.6;
        bgCtx.stroke();
      }
    }
  }

  bgFrameId = requestAnimationFrame(animateBg);
}

/* ──────────────────────────────────────────────────────────────
   MAGNETIC BUTTON EFFECT (desktop)
────────────────────────────────────────────────────────────── */

function initMagnetic(btn) {
  let ease = { tx: 0, ty: 0, cx: 0, cy: 0 };
  let rafId = null;

  btn.addEventListener('mousemove', (e) => {
    const r = btn.getBoundingClientRect();
    ease.tx = (e.clientX - r.left - r.width  / 2) * 0.28;
    ease.ty = (e.clientY - r.top  - r.height / 2) * 0.28;

    if (!rafId) {
      rafId = requestAnimationFrame(function loop() {
        ease.cx += (ease.tx - ease.cx) * 0.12;
        ease.cy += (ease.ty - ease.cy) * 0.12;
        btn.style.transform = `translate(${ease.cx}px, ${ease.cy}px)`;
        if (Math.abs(ease.tx - ease.cx) > 0.1 || Math.abs(ease.ty - ease.cy) > 0.1) {
          rafId = requestAnimationFrame(loop);
        } else {
          rafId = null;
        }
      });
    }
  });

  btn.addEventListener('mouseleave', () => {
    ease.tx = 0;
    ease.ty = 0;
    btn.style.transition = 'transform 0.6s cubic-bezier(0.22,1,0.36,1)';
    btn.style.transform  = 'translate(0,0)';
    setTimeout(() => { btn.style.transition = ''; }, 600);
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  });
}

/* ──────────────────────────────────────────────────────────────
   SCREEN TRANSITIONS
────────────────────────────────────────────────────────────── */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    if (s.id === id) {
      s.classList.remove('exit');
      s.classList.add('active');
    } else if (s.classList.contains('active')) {
      s.classList.add('exit');
      const dur = 600;
      setTimeout(() => s.classList.remove('active', 'exit'), dur);
    }
  });
}

/* ──────────────────────────────────────────────────────────────
   START FLOW
────────────────────────────────────────────────────────────── */

async function handleStart() {
  showScreen('cameraScreen');

  // Allow transition to play
  await sleep(380);

  try {
    await initCamera();
    startRenderLoop();
  } catch (err) {
    console.error('[electric webs] Camera/MediaPipe error:', err);
    revealPermissionError();
  }
}

function handleBack() {
  teardown();
  showScreen('menu');

  // Reset camera screen UI after transition
  setTimeout(() => {
    getEl('loadingOverlay').classList.remove('hidden');
    getEl('permissionOverlay').classList.add('hidden');
    setStatus('Initializing...', 'off');
    getEl('handsInfo').textContent  = 'Waiting for hands...';
    getEl('handsInfo').classList.remove('active');
  }, 650);
}

function handleRetry() {
  getEl('permissionOverlay').classList.add('hidden');
  getEl('loadingOverlay').classList.remove('hidden');
  initCamera().then(() => {
    startRenderLoop();
  }).catch(() => {
    revealPermissionError();
  });
}

/* ──────────────────────────────────────────────────────────────
   CAMERA + MEDIAPIPE INIT
────────────────────────────────────────────────────────────── */

async function initCamera() {
  setStatus('Requesting camera...', 'off');

  /* ---- 1. Check browser support ---- */
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia not supported');
  }

  /* ---- 2. Init MediaPipe Hands ---- */
  setLoadingText('Loading hand tracker model...');

  mpHands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`,
  });

  mpHands.setOptions({
    maxNumHands:            CFG.handTracking.maxHands,
    modelComplexity:        0,   // 0 = faster (lite model) — better for mobile
    minDetectionConfidence: CFG.handTracking.minDetectionConfidence,
    minTrackingConfidence:  CFG.handTracking.minTrackingConfidence,
  });

  // Results callback — stores latest hand data
  mpHands.onResults((results) => {
    lastResults = results;

    // First result: model loaded + camera live → hide loading
    if (!isTracking) {
      isTracking = true;
      getEl('loadingOverlay').classList.add('hidden');
      setStatus('Tracking active', 'live');
    }
  });

  /* ---- 3. Start MediaPipe Camera (handles getUserMedia internally) ---- */
  setLoadingText('Activating camera...');

  const isMobile = window.innerWidth < 768;
  mpCamera = new Camera(videoEl, {
    onFrame: async () => {
      if (mpHands) await mpHands.send({ image: videoEl });
    },
    width:  isMobile ? 640 : 1280,
    height: isMobile ? 480 : 720,
    facingMode: 'user',
  });

  return new Promise((resolve, reject) => {
    mpCamera.start()
      .then(() => {
        // Size camera canvas once video dimensions are known
        videoEl.addEventListener('loadedmetadata', () => {
          sizeCamCanvas();
        }, { once: true });

        // Safety timeout — consider it a success after 4 s even without metadata
        const timeout = setTimeout(() => {
          sizeCamCanvas();
          if (!isTracking) {
            // Camera running but no hands yet — still resolve
            isTracking = true;
            getEl('loadingOverlay').classList.add('hidden');
            setStatus('Tracking active', 'live');
          }
          resolve();
        }, 4000);

        // Resolve on first result
        const originalCB = mpHands.onResults.bind(mpHands);
        mpHands.onResults((results) => {
          lastResults = results;
          if (!isTracking) {
            isTracking = true;
            getEl('loadingOverlay').classList.add('hidden');
            setStatus('Tracking active', 'live');
            clearTimeout(timeout);
            resolve();
          }
        });
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function sizeCamCanvas() {
  camCanvas.width  = window.innerWidth;
  camCanvas.height = window.innerHeight;
}

/* ──────────────────────────────────────────────────────────────
   MAIN RENDER LOOP
────────────────────────────────────────────────────────────── */

function startRenderLoop() {
  if (renderFrameId) cancelAnimationFrame(renderFrameId);

  function loop() {
    drawFrame();
    renderFrameId = requestAnimationFrame(loop);
  }

  renderFrameId = requestAnimationFrame(loop);
}

function drawFrame() {
  const W = camCanvas.width;
  const H = camCanvas.height;

  /* -- Clear -- */
  camCtx.clearRect(0, 0, W, H);

  /* -- Draw video frame (cover-fit) -- */
  if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
    const vW = videoEl.videoWidth;
    const vH = videoEl.videoHeight;
    const vAR = vW / vH;
    const sAR = W  / H;

    let sx, sy, sw, sh;
    if (vAR > sAR) {
      // Video wider than screen — crop left/right
      sh = vH;
      sw = vH * sAR;
      sy = 0;
      sx = (vW - sw) / 2;
    } else {
      // Video taller than screen — crop top/bottom
      sw = vW;
      sh = vW / sAR;
      sx = 0;
      sy = (vH - sh) / 2;
    }

    camCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    // Black background while camera warms up
    camCtx.fillStyle = '#000';
    camCtx.fillRect(0, 0, W, H);
  }

  /* -- Darken frame slightly so electric effects pop -- */
  camCtx.fillStyle = 'rgba(0, 4, 12, 0.28)';
  camCtx.fillRect(0, 0, W, H);

  /* -- Electric hand effects -- */
  if (lastResults?.multiHandLandmarks) {
    renderHandEffects(lastResults.multiHandLandmarks, W, H);
  }
}

/* ──────────────────────────────────────────────────────────────
   HAND EFFECT ORCHESTRATOR
────────────────────────────────────────────────────────────── */

function renderHandEffects(handsArray, W, H) {
  const n = handsArray.length;

  /* -- Update HUD -- */
  const info = getEl('handsInfo');
  if (n === 0) {
    info.textContent = 'No hands detected';
    info.classList.remove('active');
  } else if (n === 1) {
    info.textContent = 'One hand — bring the other closer';
    info.classList.add('active');
  } else {
    info.textContent = '⚡ Electric web active';
    info.classList.add('active');
  }

  if (n === 0) return;

  /* -- Fingertip glow dots on all hands -- */
  handsArray.forEach((hand) => drawTipDots(hand, W, H));

  /* -- Single hand: intra-hand finger web -- */
  if (n === 1) {
    drawSingleHandWeb(handsArray[0], W, H);
    return;
  }

  /* -- Two hands: electric arcs between corresponding fingertips -- */
  drawDualHandElectric(handsArray[0], handsArray[1], W, H);

  /* -- Also draw subtle intra-hand webs for both hands -- */
  handsArray.forEach((hand) => drawSingleHandWeb(hand, W, H, true));
}

/* ──────────────────────────────────────────────────────────────
   LANDMARK COORDINATE HELPER
   MediaPipe landmarks are normalised [0,1].
   Canvas is CSS-flipped (scaleX(-1)), so we draw raw — the flip
   is handled automatically together with the video frame.
────────────────────────────────────────────────────────────── */

function lm(landmark, W, H) {
  return { x: landmark.x * W, y: landmark.y * H };
}

/* ──────────────────────────────────────────────────────────────
   FINGERTIP GLOW DOTS
────────────────────────────────────────────────────────────── */

function drawTipDots(hand, W, H) {
  TIP_INDICES.forEach((tipIdx, i) => {
    const p = lm(hand[tipIdx], W, H);
    const c = FINGER_COLORS[i];

    camCtx.save();

    // Outer glow halo
    camCtx.shadowBlur  = 22;
    camCtx.shadowColor = c;
    camCtx.beginPath();
    camCtx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    camCtx.fillStyle = hexToRgba(c, 0.18);
    camCtx.fill();

    // Mid ring
    camCtx.shadowBlur = 10;
    camCtx.beginPath();
    camCtx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    camCtx.fillStyle = hexToRgba(c, 0.55);
    camCtx.fill();

    // Bright core
    camCtx.shadowBlur  = 4;
    camCtx.shadowColor = '#ffffff';
    camCtx.beginPath();
    camCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    camCtx.fillStyle = '#ffffff';
    camCtx.fill();

    camCtx.restore();
  });
}

/* ──────────────────────────────────────────────────────────────
   INTRA-HAND WEB (single hand, or subtle layer on dual)
────────────────────────────────────────────────────────────── */

function drawSingleHandWeb(hand, W, H, subtle = false) {
  const maxDist   = 180;
  const maxAlpha  = subtle ? 0.35 : 0.55;

  for (let i = 0; i < TIP_INDICES.length; i++) {
    for (let j = i + 1; j < TIP_INDICES.length; j++) {
      const a = lm(hand[TIP_INDICES[i]], W, H);
      const b = lm(hand[TIP_INDICES[j]], W, H);
      const d = Math.hypot(b.x - a.x, b.y - a.y);

      if (d < maxDist) {
        const proximity = 1 - d / maxDist;
        const alpha     = proximity * maxAlpha;

        drawElectricLine(a.x, a.y, b.x, b.y, {
          segments: 5,
          jitter:   subtle ? 6 : 10,
          glowSize: subtle ? 8 : 14,
          color:    `rgba(0, 195, 255, ${alpha})`,
          lineWidth: subtle ? 1.2 : 1.8,
        });
      }
    }
  }
}

/* ──────────────────────────────────────────────────────────────
   INTER-HAND ELECTRIC ARCS
   Draws between corresponding fingertips of both hands.
────────────────────────────────────────────────────────────── */

function drawDualHandElectric(handA, handB, W, H) {
  const EFX = CFG.electricEffect;

  TIP_INDICES.forEach((tipIdx, i) => {
    const a = lm(handA[tipIdx], W, H);
    const b = lm(handB[tipIdx], W, H);
    const c = FINGER_COLORS[i];

    /* Primary arc — thick, colour-coded glow */
    drawElectricLine(a.x, a.y, b.x, b.y, {
      segments: EFX.segments,
      jitter:   EFX.jitter,
      glowSize: EFX.glowSize,
      color:    c,
      lineWidth: EFX.lineWidth + 0.5,
    });

    /* Secondary arc — same path, tighter jitter, wider glow */
    drawElectricLine(a.x, a.y, b.x, b.y, {
      segments: Math.max(4, EFX.segments - 4),
      jitter:   EFX.jitter * 0.5,
      glowSize: EFX.glowSize * 1.6,
      color:    hexToRgba(c, 0.4),
      lineWidth: EFX.lineWidth * 2.5,
    });

    /* White-hot core — minimal jitter */
    drawElectricLine(a.x, a.y, b.x, b.y, {
      segments: 4,
      jitter:   EFX.jitter * 0.15,
      glowSize: 5,
      color:    'rgba(255, 255, 255, 0.85)',
      lineWidth: 0.7,
    });
  });
}

/* ──────────────────────────────────────────────────────────────
   ELECTRIC LINE RENDERER
   Core function — draws a jagged neon lightning bolt between
   two points using multiple shadow passes for a layered glow.

   @param x1,y1  Start point
   @param x2,y2  End point
   @param opts   Rendering options
────────────────────────────────────────────────────────────── */

function drawElectricLine(x1, y1, x2, y2, opts = {}) {
  const {
    segments  = 8,
    jitter    = 15,
    glowSize  = 20,
    color     = '#00d4ff',
    lineWidth = 2,
  } = opts;

  /* Flicker — randomly skip drawing some frames for realism */
  if (Math.random() < (CFG.electricEffect.flickerRate ?? 0.08)) return;

  /* Generate jagged path with random perpendicular offsets */
  const pts = [{ x: x1, y: y1 }];

  // Direction vector for perpendicular offset
  const dx   = x2 - x1;
  const dy   = y2 - y1;
  const len  = Math.hypot(dx, dy);
  const nx   = -dy / len;  // Normal (perpendicular)
  const ny   =  dx / len;

  for (let i = 1; i < segments; i++) {
    const t      = i / segments;
    const base_x = x1 + dx * t;
    const base_y = y1 + dy * t;

    // Perpendicular offset (stronger in the middle, taper at ends)
    const envelope = Math.sin(t * Math.PI);
    const offset   = (Math.random() - 0.5) * jitter * 2 * envelope;

    // Add a small random additional offset along the line
    const along    = (Math.random() - 0.5) * jitter * 0.3;

    pts.push({
      x: base_x + nx * offset + (dx / len) * along,
      y: base_y + ny * offset + (dy / len) * along,
    });
  }

  pts.push({ x: x2, y: y2 });

  /* Build the path once */
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    path.lineTo(pts[i].x, pts[i].y);
  }

  camCtx.save();
  camCtx.lineCap  = 'round';
  camCtx.lineJoin = 'round';

  /* ── Pass 1: Wide outer atmospheric glow ── */
  camCtx.globalAlpha = 0.18 + Math.random() * 0.12;
  camCtx.shadowBlur  = glowSize * 2.5;
  camCtx.shadowColor = color;
  camCtx.strokeStyle = color;
  camCtx.lineWidth   = lineWidth * 4;
  camCtx.stroke(path);

  /* ── Pass 2: Main glow ── */
  camCtx.globalAlpha = 0.55 + Math.random() * 0.35;
  camCtx.shadowBlur  = glowSize;
  camCtx.shadowColor = color;
  camCtx.strokeStyle = color;
  camCtx.lineWidth   = lineWidth;
  camCtx.stroke(path);

  /* ── Pass 3: Bright white core ── */
  camCtx.globalAlpha = 0.65 + Math.random() * 0.35;
  camCtx.shadowBlur  = 4;
  camCtx.shadowColor = '#ffffff';
  camCtx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
  camCtx.lineWidth   = lineWidth * 0.38;
  camCtx.stroke(path);

  camCtx.restore();
}

/* ──────────────────────────────────────────────────────────────
   TEARDOWN
────────────────────────────────────────────────────────────── */

function teardown() {
  isTracking  = false;
  lastResults = null;

  if (renderFrameId) {
    cancelAnimationFrame(renderFrameId);
    renderFrameId = null;
  }

  if (mpCamera) {
    try { mpCamera.stop(); } catch (_) {}
    mpCamera = null;
  }

  if (mpHands) {
    try { mpHands.close(); } catch (_) {}
    mpHands = null;
  }

  // Release camera stream
  if (videoEl?.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  // Clear canvas
  if (camCtx) camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);
}

/* ──────────────────────────────────────────────────────────────
   RESIZE HANDLER
────────────────────────────────────────────────────────────── */

let resizeDebounce = null;
function onWindowResize() {
  resizeBgCanvas();
  initParticles();   // Respawn particles for new dimensions

  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    if (isTracking) {
      camCanvas.width  = window.innerWidth;
      camCanvas.height = window.innerHeight;
    }
  }, 100);
}

/* ──────────────────────────────────────────────────────────────
   UI HELPERS
────────────────────────────────────────────────────────────── */

function getEl(id) { return document.getElementById(id); }

function setStatus(text, state = 'off') {
  const dot  = getEl('statusDot') ?? document.querySelector('.hud-dot');
  const span = getEl('statusText');

  if (span) span.textContent = text;

  if (dot) {
    dot.className = 'hud-dot';
    if (state !== 'off') dot.classList.add(state);
  }
}

function setLoadingText(text) {
  const el = getEl('loadingText');
  if (el) el.textContent = text;
}

function revealPermissionError() {
  getEl('loadingOverlay').classList.add('hidden');
  getEl('permissionOverlay').classList.remove('hidden');
  setStatus('Camera blocked', 'error');
}

/* ──────────────────────────────────────────────────────────────
   UTILS
────────────────────────────────────────────────────────────── */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert #rrggbb hex to rgba(r,g,b,a) string.
 * Falls back gracefully for non-hex values.
 */
function hexToRgba(hex, alpha = 1) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8)  & 255;
  const b =  n        & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
