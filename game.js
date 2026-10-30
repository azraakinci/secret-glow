/**
 * Secret Glow
 *
 * How it works:
 * - Two pictures of the character: "before" (acne, redness) and "after"
 *   (clear skin). "after" sits on top and fades in as progress grows.
 * - The player drags each tool onto the face, in order:
 *   Cleanse -> Toner -> Serum -> Moisturize -> Mask.
 * - While a tool is held over the face, MOVING it (rubbing) fills that step
 *   little by little: foam builds up, cream spreads, serum drips...
 *   When the step is full, it finishes and the next tool is unlocked.
 * - The Mask is different: just let go of it over the face.
 * - No visible target outline is drawn. The face area is only used in code.
 */

const TOOLS = [
  {
    id: "cleanser", name: "Cleanse", art: "assets/tools/cleanser.svg", mode: "rub", rubLength: 3.0,
    start: "Rub gently to foam it up!", done: "Rinsed clean!",
  },
  {
    id: "toner", name: "Toner", art: "assets/tools/toner.svg", mode: "rub", rubLength: 2.2,
    start: "Pat it on all over her face.", done: "Skin feels fresh!",
  },
  {
    id: "serum", name: "Serum", art: "assets/tools/serum.svg", mode: "rub", rubLength: 2.0,
    start: "Spread the serum around.", done: "Serum absorbed!",
  },
  {
    id: "moisturizer", name: "Moisturize", art: "assets/tools/moisturizer.svg", mode: "rub", rubLength: 2.4,
    start: "Smooth the cream in.", done: "So soft!",
  },
  {
    id: "mask", name: "Mask", art: "assets/tools/mask.svg", mode: "drop",
    start: "Let go to put the mask on.", done: "Relax...",
  },
];

// Face position inside the picture (fractions of the picture).
const FACE_BOX = { x: 0.291, y: 0.2747, w: 0.3848, h: 0.3359 };
const FACE_CENTER = { x: FACE_BOX.x + FACE_BOX.w / 2, y: FACE_BOX.y + FACE_BOX.h / 2 };
const FACE_RADIUS = { x: (FACE_BOX.w / 2) * 1.02, y: (FACE_BOX.h / 2) * 1.04 };

// Eyes stay free of products (fractions of the picture).
const EYES = [
  { x: 0.38, y: 0.418, rx: 0.062, ry: 0.02 },
  { x: 0.583, y: 0.42, rx: 0.062, ry: 0.02 },
];

const gameState = {
  selectedToolId: null,
  progress: 0,
  step: 0, // index of the next tool to use
  rub: 0, // 0..1 inside the current step
  busy: false,
};

/* ---------- helpers ---------- */

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setHint(text) {
  $("hint").textContent = text || "";
}

function setProgress(value) {
  const clamped = Math.max(0, Math.min(100, value));
  gameState.progress = clamped;
  $("progress-fill").style.width = clamped + "%";
  $("progress-bar").setAttribute("aria-valuenow", String(Math.round(clamped)));
  $("character-after").style.opacity = String(clamped / 100);
}

/* ---------- fitting the picture ---------- */

// The picture is 2:3. Fit .fx-layer to it (same as object-fit: contain).
function layoutFx() {
  const box = $("character-display");
  const layer = $("fx-layer");
  const canvas = $("fx-canvas");
  const w = box.clientWidth;
  const h = box.clientHeight;
  const scale = Math.min(w / 2, h / 3);
  const lw = scale * 2;
  const lh = scale * 3;

  layer.style.width = lw + "px";
  layer.style.height = lh + "px";
  layer.style.left = (w - lw) / 2 + "px";
  layer.style.top = (h - lh) / 2 + "px";

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(lw * dpr);
  canvas.height = Math.round(lh * dpr);
}

// Screen position -> position inside the picture (0..1).
function toPicture(clientX, clientY) {
  const r = $("fx-layer").getBoundingClientRect();
  return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height, w: r.width };
}

function isOnFace(p) {
  const dx = (p.x - FACE_CENTER.x) / FACE_RADIUS.x;
  const dy = (p.y - FACE_CENTER.y) / FACE_RADIUS.y;
  return dx * dx + dy * dy <= 1;
}

/* ---------- particles ----------
 * hold: true  -> stays on the face until release() is called (foam, cream...)
 * grow        -> radius grows a little every frame (foam "puffs up")
 */

const particles = [];
let rafId = null;

function addParticle(p) {
  p.life = 0;
  particles.push(p);
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function release(kinds) {
  particles.forEach(function (p) {
    if (p.hold && (!kinds || kinds.includes(p.kind))) {
      p.hold = false;
      p.fade = true;
      p.life = 0;
      p.max = rand(40, 75);
      p.vy = rand(0.0002, 0.0007); // slides down a bit while washing off
    }
  });
}

const makers = {
  foam: (x, y) => ({ kind: "foam", x, y, r: 0.004, rmax: rand(0.014, 0.032), grow: rand(0.0003, 0.0007), vx: 0, vy: 0, hold: true, clip: true, max: 1 }),
  wet: (x, y) => ({ kind: "wet", x, y, r: rand(0.025, 0.045), vx: 0, vy: 0, hold: true, clip: true, max: 1 }),
  shimmer: (x, y) => ({ kind: "shimmer", x, y, r: rand(0.02, 0.04), vx: 0, vy: 0, hold: true, clip: true, max: 1 }),
  creamDab: (x, y) => ({ kind: "cream", x, y, r: 0.006, rmax: rand(0.02, 0.04), grow: rand(0.0004, 0.0009), vx: 0, vy: 0, hold: true, clip: true, max: 1 }),
  drop: (x, y, color) => ({ kind: "drop", x, y, r: rand(0.006, 0.011), color: color || "140,190,235", vx: 0, vy: rand(0.0016, 0.0032), max: rand(30, 55) }),
  bubble: (x, y) => ({ kind: "bubble", x, y, r: rand(0.008, 0.022), vx: rand(-0.0004, 0.0004), vy: rand(-0.0012, -0.0004), max: rand(60, 100) }),
  sparkle: (x, y) => ({ kind: "sparkle", x, y, r: rand(0.008, 0.02), vx: 0, vy: rand(-0.0004, 0), max: rand(40, 90) }),
};

function drawParticle(ctx, p, W, H, alpha) {
  const x = p.x * W;
  const y = p.y * H;
  const r = p.r * W;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  if (p.kind === "foam" || p.kind === "bubble") {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.kind === "foam" ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.55)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.strokeStyle = "rgba(185,222,238,0.9)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fill();
  } else if (p.kind === "wet") {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(210,232,255,0.38)");
    g.addColorStop(1, "rgba(210,232,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === "shimmer") {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,226,160,0.42)");
    g.addColorStop(1, "rgba(255,226,160,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === "cream") {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,252,247,0.95)");
    g.addColorStop(0.7, "rgba(255,250,244,0.8)");
    g.addColorStop(1, "rgba(255,250,244,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === "drop") {
    ctx.fillStyle = "rgba(" + p.color + ",0.9)";
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.8);
    ctx.quadraticCurveTo(x + r * 1.2, y + r * 0.2, x, y + r);
    ctx.quadraticCurveTo(x - r * 1.2, y + r * 0.2, x, y - r * 1.8);
    ctx.fill();
  } else if (p.kind === "sparkle") {
    ctx.translate(x, y);
    ctx.rotate((Math.PI / 4) * Math.sin(p.life * 0.1));
    ctx.fillStyle = "rgba(255,214,120,0.95)";
    ctx.shadowColor = "rgba(255,220,140,0.9)";
    ctx.shadowBlur = r * 0.8;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : r * 0.28;
      const a = (Math.PI / 4) * i;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function particleAlpha(p) {
  if (p.hold) return Math.min(1, p.life / 10);
  if (p.fade) return 1 - p.life / p.max;
  const t = p.life / p.max;
  return t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
}

function tick() {
  const canvas = $("fx-canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // update
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.hold) {
      if (p.life < 10) p.life += 1;
    } else {
      p.life += 1;
    }
    if (p.grow && p.r < p.rmax) p.r += p.grow;
    p.x += p.vx;
    p.y += p.vy;
    if (!p.hold && p.life >= p.max) particles.splice(i, 1);
  }

  // Pass 1: things that live ON the skin are clipped to the face shape.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(FACE_CENTER.x * W, FACE_CENTER.y * H, FACE_RADIUS.x * W, FACE_RADIUS.y * H, 0, 0, Math.PI * 2);
  // keep eyes clear (even-odd turns these ellipses into holes)
  EYES.forEach(function (eye) {
    ctx.moveTo((eye.x + eye.rx) * W, eye.y * H);
    ctx.ellipse(eye.x * W, eye.y * H, eye.rx * W, eye.ry * H, 0, 0, Math.PI * 2);
  });
  ctx.clip("evenodd");
  particles.forEach(function (p) {
    if (p.clip) drawParticle(ctx, p, W, H, particleAlpha(p));
  });
  ctx.restore();

  // Pass 2: drops, bubbles, sparkles can go anywhere.
  particles.forEach(function (p) {
    if (!p.clip) drawParticle(ctx, p, W, H, particleAlpha(p));
  });

  rafId = particles.length ? requestAnimationFrame(tick) : null;
  if (!rafId) ctx.clearRect(0, 0, W, H);
}

/* ---------- rubbing: what each tool leaves on the skin ---------- */

function countHeld(kind) {
  let n = 0;
  particles.forEach((p) => {
    if (p.hold && p.kind === kind) n++;
  });
  return n;
}

// Called every time the tool has moved a little bit over the face.
function leaveTrace(tool, pos) {
  const j = () => rand(-0.03, 0.03);

  if (tool.id === "cleanser") {
    if (countHeld("foam") < 240) {
      for (let i = 0; i < 3; i++) addParticle(makers.foam(pos.x + j(), pos.y + j()));
    }
  } else if (tool.id === "toner") {
    if (countHeld("wet") < 90) addParticle(makers.wet(pos.x + j(), pos.y + j()));
    if (Math.random() < 0.35) addParticle(makers.drop(pos.x + j(), pos.y - 0.01));
  } else if (tool.id === "serum") {
    if (countHeld("shimmer") < 90) addParticle(makers.shimmer(pos.x + j(), pos.y + j()));
    if (Math.random() < 0.5) addParticle(makers.drop(pos.x + j() * 0.4, pos.y - 0.02, "255,214,140"));
    if (Math.random() < 0.15) addParticle(makers.sparkle(pos.x + j(), pos.y + j()));
  } else if (tool.id === "moisturizer") {
    if (countHeld("cream") < 110) {
      for (let i = 0; i < 2; i++) addParticle(makers.creamDab(pos.x + j(), pos.y + j()));
    }
  }
}

// What happens when a step is finished.
async function finishEffect(tool) {
  if (tool.id === "cleanser") {
    // rinse: foam slides off, water drops fall
    release(["foam"]);
    for (let i = 0; i < 5; i++) {
      for (let k = 0; k < 6; k++) {
        addParticle(makers.drop(FACE_CENTER.x + rand(-0.15, 0.15), FACE_CENTER.y + rand(-0.12, 0.02)));
      }
      await sleep(160);
    }
    await sleep(300);
  } else if (tool.id === "toner") {
    release(["wet"]);
    await sleep(500);
  } else if (tool.id === "serum") {
    release(["shimmer"]);
    for (let k = 0; k < 8; k++) addParticle(makers.sparkle(FACE_CENTER.x + rand(-0.15, 0.15), FACE_CENTER.y + rand(-0.14, 0.12)));
    await sleep(500);
  } else if (tool.id === "moisturizer") {
    release(["cream"]); // absorbed
    for (let k = 0; k < 6; k++) addParticle(makers.sparkle(FACE_CENTER.x + rand(-0.15, 0.15), FACE_CENTER.y + rand(-0.14, 0.12)));
    await sleep(500);
  } else if (tool.id === "mask") {
    const mask = $("mask-overlay");
    mask.classList.add("is-on");
    await sleep(2200);
    mask.classList.remove("is-on");
    await sleep(900);
  }
}

async function playFinale() {
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 6; k++) {
      addParticle(makers.sparkle(rand(0.2, 0.8), rand(0.15, 0.7)));
    }
    await sleep(220);
  }
}

/* ---------- game flow ---------- */

function refreshToolStates() {
  document.querySelectorAll(".tool-button").forEach(function (button) {
    const index = TOOLS.findIndex((t) => t.id === button.dataset.toolId);
    button.classList.toggle("is-done", index < gameState.step);
    button.classList.toggle("is-next", index === gameState.step);
  });
}

function shake(button) {
  button.classList.remove("is-wrong");
  void button.offsetWidth; // restart animation
  button.classList.add("is-wrong");
}

async function completeStep(tool) {
  gameState.busy = true;
  gameState.rub = 1;
  setProgress((gameState.step + 1) * (100 / TOOLS.length));
  setHint(tool.done);

  await finishEffect(tool);

  gameState.step += 1;
  gameState.rub = 0;
  setProgress(gameState.step * (100 / TOOLS.length));
  refreshToolStates();

  if (gameState.step >= TOOLS.length) {
    setHint("Glow up complete!");
    showRestart();
    await playFinale();
  } else {
    setHint("Next: drag " + TOOLS[gameState.step].name + " onto her face");
  }
  gameState.busy = false;
}

function showRestart() {
  if ($("restart-button")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "restart-button";
  btn.className = "restart-button";
  btn.textContent = "Play again";
  btn.addEventListener("click", resetGame);
  $("character-display").appendChild(btn);
}

function resetGame() {
  gameState.step = 0;
  gameState.rub = 0;
  gameState.selectedToolId = null;
  gameState.busy = false;
  particles.length = 0;
  const btn = $("restart-button");
  if (btn) btn.remove();
  document.querySelectorAll(".tool-button").forEach((b) => b.classList.remove("is-selected"));
  setProgress(0);
  refreshToolStates();
  setHint("Drag Cleanse onto her face");
}

function selectTool(toolId) {
  gameState.selectedToolId = toolId;
  document.querySelectorAll(".tool-button").forEach(function (button) {
    button.classList.toggle("is-selected", button.dataset.toolId === toolId);
  });
}

/* ---------- drag and rub ---------- */

function enableDrag(button, tool) {
  button.addEventListener("pointerdown", function (e) {
    if (gameState.busy) {
      setHint("One moment...");
      return;
    }
    e.preventDefault();
    button.setPointerCapture(e.pointerId);

    const index = TOOLS.indexOf(tool);
    const isNext = index === gameState.step;
    const liftY = e.pointerType === "touch" ? -52 : 0; // keep the tool visible above a finger
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let lastPos = null; // last contact point on the picture
    let acc = 0; // distance since last trace
    let onFace = false;
    let finished = false;

    const ghost = document.createElement("img");
    ghost.className = "drag-ghost";
    ghost.src = tool.art;
    ghost.alt = "";
    ghost.draggable = false;
    ghost.style.display = "none";
    document.body.appendChild(ghost);

    function placeGhost(x, y) {
      ghost.style.left = x - 39 + "px";
      ghost.style.top = y + liftY - 70 + "px"; // the bottle's tip touches the contact point
    }

    function onMove(ev) {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        moved = true;
        ghost.style.display = "";
        selectTool(tool.id);
        setHint(isNext ? "Drag it onto her face" : "Not yet! Next: " + TOOLS[gameState.step].name);
      }
      if (!moved) return;
      placeGhost(ev.clientX, ev.clientY);

      const pos = toPicture(ev.clientX, ev.clientY + liftY);
      const nowOnFace = isOnFace(pos);

      if (nowOnFace && !onFace) {
        if (isNext) setHint(tool.start);
        else setHint("Not yet! Next: " + TOOLS[gameState.step].name);
        lastPos = pos;
      }
      onFace = nowOnFace;

      if (!isNext || tool.mode !== "rub" || !onFace || finished) {
        if (!onFace) lastPos = null;
        return;
      }

      // Rubbing: every bit of movement over the face fills the step.
      if (lastPos) {
        const dist = Math.hypot((pos.x - lastPos.x) * pos.w, (pos.y - lastPos.y) * pos.w * 1.5);
        acc += dist;
        gameState.rub = Math.min(1, gameState.rub + dist / (pos.w * tool.rubLength));
        setProgress((gameState.step + gameState.rub) * (100 / TOOLS.length));

        const spacing = pos.w * 0.04;
        while (acc > spacing) {
          acc -= spacing;
          leaveTrace(tool, pos);
        }
      }
      lastPos = pos;

      if (gameState.rub >= 1) {
        finished = true;
        cleanup();
        completeStep(tool);
      }
    }

    function cleanup() {
      button.removeEventListener("pointermove", onMove);
      button.removeEventListener("pointerup", onUp);
      button.removeEventListener("pointercancel", cleanup);
      ghost.remove();
    }

    function onUp(ev) {
      const pos = toPicture(ev.clientX, ev.clientY + liftY);
      const dropped = moved && isOnFace(pos);
      cleanup();
      if (finished) return;

      if (!moved) {
        setHint("Drag " + tool.name + " onto her face");
      } else if (!dropped) {
        setHint(isNext ? "Drag " + tool.name + " onto her face" : "Not yet! Next: " + TOOLS[gameState.step].name);
      } else if (!isNext) {
        shake(button);
        setHint("Not yet! Next: " + TOOLS[gameState.step].name);
      } else if (tool.mode === "drop") {
        completeStep(tool);
      } else {
        setHint("Keep rubbing to finish " + tool.name + "!");
      }
    }

    button.addEventListener("pointermove", onMove);
    button.addEventListener("pointerup", onUp);
    button.addEventListener("pointercancel", cleanup);
  });
}

function createToolButton(tool) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-button";
  button.dataset.toolId = tool.id;
  button.setAttribute("aria-label", tool.name);

  const icon = document.createElement("span");
  icon.className = "tool-icon";

  const art = document.createElement("img");
  art.className = "tool-art";
  art.src = tool.art;
  art.alt = "";
  art.draggable = false;
  icon.appendChild(art);

  const label = document.createElement("span");
  label.className = "tool-name";
  label.textContent = tool.name;

  button.appendChild(icon);
  button.appendChild(label);

  enableDrag(button, tool);

  // Keyboard users (Enter / Space): finish the step in one go.
  button.addEventListener("click", function (e) {
    if (e.detail !== 0 || gameState.busy) return;
    if (TOOLS.indexOf(tool) !== gameState.step) {
      shake(button);
      setHint("Not yet! Next: " + TOOLS[gameState.step].name);
      return;
    }
    selectTool(tool.id);
    completeStep(tool);
  });

  return button;
}

function renderTools() {
  const row = $("tools-row");
  row.innerHTML = "";
  TOOLS.forEach(function (tool) {
    row.appendChild(createToolButton(tool));
  });
}

function initGame() {
  renderTools();
  layoutFx();
  window.addEventListener("resize", layoutFx);
  resetGame();
}

document.addEventListener("DOMContentLoaded", initGame);
