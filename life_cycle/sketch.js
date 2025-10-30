// === Interactive Flower — p5.js + MediaPipe Hands + OSC Bridge ===
//  thresholds tuned for pinch open/close and finger spread.
// - Pinch controls SEED ↔ GROW ↔ BLOOM (open/close).
// - 5 fingers open triggers DISPERSE (particles).
// - Canvas is fixed-fullscreen; windowResized keeps it exact to viewport.

// ---- Hand & interaction state ----
let video, hands, camera
let pinch = 0 // 0..1 (thumb-index distance normalized, mapped)
let fingers = 0 // 0..5 (rough heuristic)
let pinchSmooth = 0 // smoothed pinch
const alpha = 0.25 // EMA smoothing

// ---- Visual state machine ----
const PHASE = { SEED: 0, GROW: 1, BLOOM: 2, DISPERSE: 3 }
let phase = PHASE.SEED
let tPhase = 0 // seconds elapsed inside current phase
let particles = []

// ---- OSC Bridge (Node) ----
let socket = null

// ---- Thresholds (tweak-friendly) ----
const PINCH_GROW_T = 0.15 // pinchSmooth > this → start GROW
const PINCH_RELEASE_T = 0.12 // pinchSmooth < this (after growing) → BLOOM
const FINGERS_FOR_BLOOM = 2 // alternative bloom trigger
const FINGERS_FOR_DISPERSE = 5

// Keep a flag so BLOOM only happens after having grown at least once
let hasGrown = false

function setup() {
  // Create a fixed, full-viewport canvas
  const cnv = createCanvas(window.innerWidth, window.innerHeight)
  // Avoid HiDPI surprises when mapping 1:1 to viewport
  pixelDensity(1)
  noStroke()

  // Attach CSS styles via p5 to ensure position and fit (redundant with global.css but safe)
  cnv.style('position', 'fixed')
  cnv.style('top', '0')
  cnv.style('left', '0')
  cnv.style('width', '100vw')
  cnv.style('height', '100vh')

  // Optional: connect to OSC bridge
  // socket = io('http://localhost:8081');
  socket = io('http://127.0.0.1:8081')
  // Tell the bridge the OSC ports (Processing <-> Node)
  socket.emit('config', {
    server: { host: '127.0.0.1', port: 12000 }, // Processing SENDS to 12000
    client: { host: '127.0.0.1', port: 8000 }, // Processing LISTENS on 8000
  })

  // Listen to OSC → Web (if you need values back from Processing)
  socket.on('message', (msg) => {
    // msg example: ['/test', mouseX, mouseY, r, g, b]
    const [addr, ...args] = msg
    if (addr === '/test') {
      // You could map args to visual globals here
    }
  })

  setupHands()
}

function setupHands() {
  // p5 capture
  video = createCapture(VIDEO, () => {
    video.size(640, 480)
  })
  // Important for iOS Safari inline playback
  video.elt.setAttribute('playsinline', '')
  video.hide()

  // MediaPipe Hands
  hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  })

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  })

  hands.onResults(onHandsResults)

  // Use MediaPipe Camera helper to drive frames
  camera = new Camera(video.elt, {
    onFrame: async () => {
      await hands.send({ image: video.elt })
    },
    width: 640,
    height: 480,
  })
  camera.start()
}

function onHandsResults(results) {
  // Compute pinch & fingers for the first detected hand
  if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
    const lm = results.multiHandLandmarks[0]

    // Thumb (4), Index (8)
    const dx = lm[4].x - lm[8].x
    const dy = lm[4].y - lm[8].y
    const d = Math.sqrt(dx * dx + dy * dy)

    // Map typical pinch distance [~0.02..0.18] → [0..1]
    pinch = constrain(map(d, 0.02, 0.18, 0, 1), 0, 1)

    // Count extended fingers via simple y-tip vs y-pip heuristic
    fingers = countExtendedFingers(lm)
  } else {
    pinch = 0
    fingers = 0
  }
}

function countExtendedFingers(lm) {
  // Very simple heuristic: tip.y < pip.y when finger is extended (assuming upright hand)
  // Tips: 4,8,12,16,20 — PIPs: 3,6,10,14,18
  const TIP = [4, 8, 12, 16, 20]
  const PIP = [3, 6, 10, 14, 18]

  let count = 0

  // Skip index 0 because it's the thumb here; handle thumb separately
  for (let i = 1; i < 5; i++) {
    if (lm[TIP[i]].y < lm[PIP[i]].y) count++
  }

  // Rudimentary thumb check: horizontal spread vs base
  const thumbOpen = Math.abs(lm[4].x - lm[2].x) > 0.05
  if (thumbOpen) count++

  return constrain(count, 0, 5)
}

function draw() {
  background(10)

  // Smooth pinch and advance time inside current phase
  pinchSmooth += (pinch - pinchSmooth) * alpha
  tPhase += deltaTime / 1000

  // Background: rotating molecular nest
  drawMolecularNest(frameCount * 0.002)

  // State machine
  switch (phase) {
    case PHASE.SEED:
      drawSeed(pinchSmooth)
      // Start growing when pinch begins
      if (pinchSmooth > PINCH_GROW_T) {
        hasGrown = true
        gotoPhase(PHASE.GROW)
      }
      break

    case PHASE.GROW:
      drawGrowingFlower(pinchSmooth, tPhase)
      // Bloom if user releases pinch OR at least 2 fingers detected
      if (
        (hasGrown && pinchSmooth < PINCH_RELEASE_T) ||
        fingers >= FINGERS_FOR_BLOOM
      ) {
        gotoPhase(PHASE.BLOOM)
      }
      break

    case PHASE.BLOOM:
      drawBloom(pinchSmooth, tPhase)
      // Disperse on fully open hand (5 fingers)
      if (fingers >= FINGERS_FOR_DISPERSE) {
        gotoPhase(PHASE.DISPERSE)
      }
      break

    case PHASE.DISPERSE:
      drawDisperse(tPhase)
      // After particles fade, reset cycle
      if (tPhase > 2.0) {
        hasGrown = false
        gotoPhase(PHASE.SEED)
      }
      break
  }

  // Optional debug overlay
  // drawHUD();
}

function gotoPhase(p) {
  phase = p
  tPhase = 0

  // Emit OSC for external sync (Processing, lights, etc.)
  if (socket) {
    socket.emit('osc-send', ['/hand/pinch', pinchSmooth])
    socket.emit('osc-send', ['/hand/fingers', fingers])
    socket.emit('osc-send', ['/viz/phase', phase]) // 0..3
  }

  // Initialize particles when entering DISPERSE
  if (phase === PHASE.DISPERSE) {
    particles = makeParticles(180)
  }
}

function drawMolecularNest(theta) {
  push()
  translate(width / 2, height / 2)

  const rings = 4
  for (let r = 0; r < rings; r++) {
    const rad = 60 + r * 55
    const n = 10 + r * 6

    for (let i = 0; i < n; i++) {
      const a = theta * 0.4 + (i * TWO_PI) / n + r * 0.3
      const x = rad * Math.cos(a)
      const y = rad * Math.sin(a)
      const s = 4 + r * 1.2

      fill(180 - r * 25, 180 - r * 25, 220, 150)
      circle(x, y, s)

      // Light links
      if (i % 3 === 0) {
        const a2 = a + 0.25 + 0.1 * Math.sin(theta * 1.5 + r)
        const x2 = (rad + 25) * Math.cos(a2)
        const y2 = (rad + 25) * Math.sin(a2)
        stroke(120, 130, 200, 70)
        line(x, y, x2, y2)
        noStroke()
      }
    }
  }
  pop()
}

function drawSeed(p) {
  push()
  translate(width / 2, height / 2)
  const s = 20 + 40 * p
  fill(230, 200, 40)
  circle(0, 0, s)
  pop()
}

function drawGrowingFlower(p, tp) {
  // p: 0..1 — growth factor from pinch
  push()
  translate(width / 2, height / 2)

  const petals = 8
  const radius = lerp(30, 140, easeOutCubic(p))

  for (let i = 0; i < petals; i++) {
    const a = (i * TWO_PI) / petals + 0.3 * Math.sin(tp * 1.5)
    const px = radius * Math.cos(a)
    const py = radius * Math.sin(a)
    fill(255, 140 + 50 * Math.sin(tp + i), 180)
    ellipse(px, py, 40, 90)
  }

  // Core
  fill(255, 220, 120)
  circle(0, 0, lerp(30, 55, p))
  pop()
}

function drawBloom(_p, tp) {
  // Full bloom with subtle pulsation
  drawGrowingFlower(1.0, tp)
}

function makeParticles(n) {
  const arr = []
  for (let i = 0; i < n; i++) {
    arr.push({
      x: width / 2,
      y: height / 2,
      vx: random(-2, 2),
      vy: random(-2, 2),
      life: random(1.2, 2.0),
    })
  }
  return arr
}

function drawDisperse(tp) {
  // explode and fade out
  for (const pa of particles) {
    pa.x += pa.vx
    pa.y += pa.vy
    const k = 1 - tp / pa.life
    if (k > 0) {
      fill(255, 200 * k)
      circle(pa.x, pa.y, 3 + 2 * k)
    }
  }
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3)
}

// Optional HUD for debugging
function drawHUD() {
  fill(255)
  noStroke()
  textSize(14)
  text(
    `pinch:${pinchSmooth.toFixed(2)}  fingers:${fingers}  phase:${phase}`,
    12,
    20
  )
}

// Keep canvas exactly at viewport size on resize/orientation changes
function windowResized() {
  resizeCanvas(window.innerWidth, window.innerHeight)
}
