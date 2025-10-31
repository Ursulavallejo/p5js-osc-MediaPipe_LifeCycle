// === Interactive Flower — p5.js + MediaPipe Hands + OSC Bridge (original working version) ===
// Simple pinch/finger-driven lifecycle: SEED → GROW → BLOOM → DISPERSE

let video, hands, camera
let pinch = 0 // 0..1 (thumb-index distance normalized)
let fingers = 0 // 0..5 extended
let pinchSmooth = 0
const alpha = 0.25 // EMA smoothing

// Visual state machine
const PHASE = { SEED: 0, GROW: 1, BLOOM: 2, DISPERSE: 3 }
let phase = PHASE.SEED
let tPhase = 0 // time inside phase (seconds)
let particles = []

let socket = null // OSC via bridge

function setup() {
  createCanvas(windowWidth, windowHeight)
  pixelDensity(1)
  noStroke()

  // Optional socket to bridge
  // socket = io('http://localhost:8081')
  socket = io('http://127.0.0.1:8081') // o localhost

  //IMPORTANT: send the port configuration to the bridge:
  socket.emit('config', {
    server: { host: '127.0.0.1', port: 12000 }, // <- Where does Processing SEND (your Processing sends to 12000)
    client: { host: '127.0.0.1', port: 8000 }, // <- where Processing LISTENS (oscP5 on 8000)
  })

  // If you want to listen to what comes from Processing:
  socket.on('message', (msg) => {
    //msg is an array type ['/test', mouseX, mouseY, r, g, b]
    // console.log('OSC → Web:', msg)
    const [addr, ...args] = msg
    if (addr === '/test') {
      // Example: you could use those values to alter your visual
    }
  })

  setupHands()
}

function setupHands() {
  video = createCapture(VIDEO, () => {
    video.size(640, 480)
  })
  video.hide()

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
  // Compute pinch & fingers
  if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
    const lm = results.multiHandLandmarks[0]
    const thumb = lm[4],
      index = lm[8]

    // Distance normalized by diag of video
    const dx = thumb.x - index.x
    const dy = thumb.y - index.y
    const d = Math.sqrt(dx * dx + dy * dy)

    // typical pinch range ~[0.0 .. 0.2], remap to 0..1 (clamped)
    pinch = constrain(map(d, 0.02, 0.18, 0, 1), 0, 1)

    fingers = countExtendedFingers(lm) // simple heuristic below
  } else {
    pinch = 0
    fingers = 0
  }
}

function countExtendedFingers(lm) {
  // Very simple heuristic: compare tip vs pip y for each finger (assuming upright)
  // Tips: 4,8,12,16,20 — PIPs: 3,6,10,14,18
  const TIP = [4, 8, 12, 16, 20],
    PIP = [3, 6, 10, 14, 18]
  let count = 0
  // Ignore thumb in this basic heuristic (count it if far from palm)
  for (let i = 1; i < 5; i++) {
    if (lm[TIP[i]].y < lm[PIP[i]].y) count++
  }
  // rudimentary thumb check: x distance vs wrist (landmark 0)
  const thumbOpen = Math.abs(lm[4].x - lm[2].x) > 0.05
  if (thumbOpen) count++
  return constrain(count, 0, 5)
}

function draw() {
  background(10)

  // Update smoothing & phase timer
  pinchSmooth += (pinch - pinchSmooth) * alpha
  tPhase += deltaTime / 1000

  // Back layer: rotating molecular nest
  drawMolecularNest(frameCount * 0.002)

  // State transitions
  switch (phase) {
    case PHASE.SEED:
      drawSeed(pinchSmooth)
      if (pinchSmooth > 0.15) gotoPhase(PHASE.GROW)
      break

    case PHASE.GROW:
      drawGrowingFlower(pinchSmooth, tPhase)
      if (fingers >= 3) gotoPhase(PHASE.BLOOM)
      break

    case PHASE.BLOOM:
      drawBloom(pinchSmooth, tPhase)
      if (fingers >= 5) gotoPhase(PHASE.DISPERSE)
      break

    case PHASE.DISPERSE:
      drawDisperse(tPhase)
      if (tPhase > 2.0) gotoPhase(PHASE.SEED)
      break
  }

  // Optional debug
  drawHUD()
}

function gotoPhase(p) {
  phase = p
  tPhase = 0

  // Optional: emit to OSC via bridge
  if (socket) {
    socket.emit('osc-send', ['/hand/pinch', pinchSmooth])
    socket.emit('osc-send', ['/hand/fingers', fingers])
    socket.emit('osc-send', ['/viz/phase', phase])
  }

  if (phase === PHASE.DISPERSE) {
    // init particles from current bloom
    particles = makeParticles(180)
  }
}

function drawMolecularNest(theta) {
  push()
  translate(width / 2, height / 2)
  // Concentric orbits of nodes
  const rings = 4
  for (let r = 0; r < rings; r++) {
    const rad = 60 + r * 55
    const n = 10 + r * 6
    for (let i = 0; i < n; i++) {
      const a = theta * 0.4 + (i * TWO_PI) / n + r * 0.3
      const x = rad * cos(a)
      const y = rad * sin(a)
      const s = 4 + r * 1.2
      fill(180 - r * 25, 180 - r * 25, 220, 150)
      circle(x, y, s)

      // links (light lines)
      if (i % 3 === 0) {
        const a2 = a + 0.25 + 0.1 * sin(theta * 1.5 + r)
        const x2 = (rad + 25) * cos(a2)
        const y2 = (rad + 25) * sin(a2)
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
    const a = (i * TWO_PI) / petals + 0.3 * sin(tp * 1.5)
    const px = radius * cos(a)
    const py = radius * sin(a)
    fill(255, 140 + 50 * sin(tp + i), 180)
    ellipse(px, py, 40, 90)
  }
  // core
  fill(255, 220, 120)
  circle(0, 0, lerp(30, 55, p))
  pop()
}

function drawBloom(p, tp) {
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
  for (let pa of particles) {
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
  return 1 - pow(1 - x, 3)
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
