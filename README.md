## LifeCycle : Interactive Hand-Tracking Visual (Processing + p5.js + MediaPipe + OSC)

### by Ursula Vallejo Janne

This experiment connects **Processing (audio + OSC)** with **p5.js (visuals)** and **MediaPipe Hands (camera tracking)** to create an **interactive flower** that reacts to hand gestures and phases of motion.

---

### Video:

https://github.com/user-attachments/assets/07eb7c3c-d815-4740-b2eb-d76e2a7ef60e

---

### ⚙️ How It Works

- The camera feed is processed with **MediaPipe Hands** (from Google).
- It detects your **hand landmarks** and measures:

  - **Pinch** → distance between thumb and index finger (0–1 normalized)
  - **Fingers count** → how many fingers are extended (0–5)

🖐️ Interaction

The webcam feed is processed by MediaPipe Hands, which tracks the thumb and index finger to measure pinch distance, and counts the number of extended fingers.
These values drive a state machine that controls the flower’s life cycle:

Phase Trigger Visual
🌱 SEED Hand relaxed (no pinch) A glowing seed appears at the center
🌿 GROW Pinch begins (thumb + index close) The flower starts to grow and expand
🌸 BLOOM Pinch released (two fingers open) The flower opens into full bloom
🌬️ DISPERSE Hand fully open (5 fingers extended) Petals and particles scatter, resetting the scene

👉 The “pinch” gesture controls how the flower opens and closes — when you bring thumb and index together, it closes; when you separate them, it blooms again.
When the whole hand opens, the particles disperse outward, completing the cycle.

Each phase also emits OSC messages (via the Node bridge) that can be used to trigger sound, light, or other external effects in Processing.

Each phase can also send OSC messages back to Processing for sound or light synchronization:

```js
socket.emit('osc-send', ['/hand/pinch', pinchSmooth])
socket.emit('osc-send', ['/hand/fingers', fingers])
socket.emit('osc-send', ['/viz/phase', phase])
```

---

### How to Run the Project

#### 1️⃣ Start the OSC Bridge

Open a terminal in the bridge folder and run:

```bash
node bridge.js
```

You should see something like:

```
✅ Socket.IO listening on http://localhost:8081
```

#### 2️⃣ Start the Web Visualization

> ⚠️ **Important:** Do _not_ use “Live Server” — it will cause
> `Error: getUserMedia is not implemented in this browser`.

Instead, open the project folder and run:

```bash
npx http-server -p 3000
```

Then open the project in your browser:
👉 [http://127.0.0.1:3000](http://127.0.0.1:3000)

http://localhost:3000/

This local server provides a secure context required by browsers to access your **camera feed**.
