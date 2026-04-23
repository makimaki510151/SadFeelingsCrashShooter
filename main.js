const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const W = canvas.width;
const H = canvas.height;
const GROUND_Y = H - 48;

const negativeWords = [
  "ムリ",
  "最悪",
  "失敗",
  "無価値",
  "だめ",
  "やる気なし",
  "後悔",
  "孤独",
  "不安",
  "自信ゼロ",
  "終わった",
  "つらい",
];

const keys = new Set();
let touchAxis = 0;
let score = 0;
let life = 5;
let gameOver = false;
let gameStarted = false;
let spawnTimer = 0;
let shotCooldown = 0;
let damageFlashTimer = 0;
let damageTextTimer = 0;
const AUTO_FIRE_INTERVAL = 0.14;
const ENEMY_BREAK_THRESHOLD = 0.80;
const GAMEPAD_AXIS_DEADZONE = 0.15;
const GAMEPAD_CONFIRM_BUTTONS = [0, 9]; // A or Start
let prevPadButtonStates = [];

const player = {
  x: W * 0.5,
  y: H - 60,
  width: 36,
  height: 16,
  speed: 360,
};

const bullets = [];
const enemies = [];
const particles = [];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function makeEnemy() {
  const text = negativeWords[(Math.random() * negativeWords.length) | 0];
  const fontSize = randomRange(30, 42);
  const sprite = buildEnemySprite(text, fontSize);
  return {
    text,
    x: randomRange(130, W - 130),
    y: -sprite.height * 0.5,
    vy: randomRange(34, 62),
    fontSize,
    sprite,
    alivePixels: sprite.initialPixels,
    initialPixels: sprite.initialPixels,
  };
}

function buildEnemySprite(text, fontSize) {
  const off = document.createElement("canvas");
  const ox = off.getContext("2d", { willReadFrequently: true });
  ox.font = `700 ${fontSize}px "Meiryo", "Yu Gothic", sans-serif`;
  const m = ox.measureText(text);
  const width = Math.max(32, Math.ceil(m.width + 28));
  const height = Math.max(32, Math.ceil(fontSize * 1.35));
  off.width = width;
  off.height = height;
  ox.font = `700 ${fontSize}px "Meiryo", "Yu Gothic", sans-serif`;
  ox.textAlign = "center";
  ox.textBaseline = "middle";
  ox.lineWidth = 5;
  ox.strokeStyle = "rgba(20, 0, 0, 0.85)";
  ox.fillStyle = "#ff6b7f";
  ox.strokeText(text, width * 0.5, height * 0.52);
  ox.fillText(text, width * 0.5, height * 0.52);

  const data = ox.getImageData(0, 0, width, height).data;
  let initialPixels = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 35) initialPixels += 1;
  }
  return { canvas: off, ctx: ox, width, height, initialPixels };
}

function spawnBullet() {
  bullets.push({
    x: player.x,
    y: GROUND_Y,
    vy: -520,
    radius: 3,
  });
}

function onPlayerDamaged() {
  damageFlashTimer = 0.32;
  damageTextTimer = 0.85;
}

function startGame() {
  if (gameStarted) return;
  resetGame();
  gameStarted = true;
}

function drawPlayer() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = "#7de3ff";
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(14, 12);
  ctx.lineTo(0, 6);
  ctx.lineTo(-14, 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#b9f2ff";
  ctx.fillRect(-2, -10, 4, 12);
  ctx.restore();
}

function drawBullet(b) {
  ctx.fillStyle = "#ffd761";
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemy(e) {
  ctx.drawImage(e.sprite.canvas, e.x - e.sprite.width * 0.5, e.y - e.sprite.height * 0.5);
}

function explodeTextToParticles(enemy) {
  const { width, height, ctx: enemyCtx } = enemy.sprite;
  const image = enemyCtx.getImageData(0, 0, width, height).data;
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const a = image[idx + 3];
      if (a < 40) continue;

      const dx = x - cx;
      const dy = y - cy;
      const len = Math.hypot(dx, dy) + 0.001;
      const ux = dx / len;
      const uy = dy / len;
      const speed = randomRange(70, 220);

      particles.push({
        x: enemy.x + dx,
        y: enemy.y + dy,
        vx: ux * speed + randomRange(-30, 30),
        vy: uy * speed + randomRange(-120, 10),
        life: randomRange(0.55, 1.1),
        color: `rgba(${image[idx]}, ${image[idx + 1]}, ${image[idx + 2]}, `,
      });
    }
  }
}

function updateInput(dt) {
  let axis = touchAxis;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) axis -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) axis += 1;

  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = gamepads[0];
  if (pad) {
    const stick = Math.abs(pad.axes[0]) > GAMEPAD_AXIS_DEADZONE ? pad.axes[0] : 0;
    axis += stick;
  }

  player.x += axis * player.speed * dt;
  player.x = clamp(player.x, 26, W - 26);
}

function updatePadButtonStates() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = gamepads[0];
  const justPressed = new Set();
  const nextStates = [];

  if (pad && pad.buttons) {
    for (let i = 0; i < pad.buttons.length; i++) {
      const pressed = !!pad.buttons[i]?.pressed;
      nextStates[i] = pressed;
      if (pressed && !prevPadButtonStates[i]) {
        justPressed.add(i);
      }
    }
  }

  prevPadButtonStates = nextStates;
  return justPressed;
}

function handleGamepadUiActions() {
  const justPressed = updatePadButtonStates();
  const confirmPressed = GAMEPAD_CONFIRM_BUTTONS.some((idx) => justPressed.has(idx));
  if (!confirmPressed) return;

  if (!gameStarted) {
    startGame();
    return;
  }

  if (gameOver) {
    resetGame();
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.y += b.vy * dt;
    if (b.y < -20) bullets.splice(i, 1);
  }
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.y += e.vy * dt;

    const enemyBottom = e.y + e.sprite.height * 0.5;
    if (enemyBottom >= GROUND_Y) {
      enemies.splice(i, 1);
      life -= 1;
      onPlayerDamaged();
      if (life <= 0) {
        gameOver = true;
      }
    }
  }
}

function handleCollisions() {
  for (let ei = enemies.length - 1; ei >= 0; ei--) {
    const e = enemies[ei];
    const left = e.x - e.sprite.width * 0.5;
    const top = e.y - e.sprite.height * 0.5;

    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      const localX = Math.floor(b.x - left);
      const localY = Math.floor(b.y - top);
      if (localX < 0 || localX >= e.sprite.width || localY < 0 || localY >= e.sprite.height) continue;

      const img = e.sprite.ctx.getImageData(0, 0, e.sprite.width, e.sprite.height);
      const data = img.data;
      const sampleIdx = (localY * e.sprite.width + localX) * 4 + 3;
      if (data[sampleIdx] < 20) continue;

      bullets.splice(bi, 1);
      const cutR = 11;
      for (let yy = localY - cutR; yy <= localY + cutR; yy++) {
        if (yy < 0 || yy >= e.sprite.height) continue;
        for (let xx = localX - cutR; xx <= localX + cutR; xx++) {
          if (xx < 0 || xx >= e.sprite.width) continue;
          const dx = xx - localX;
          const dy = yy - localY;
          if (dx * dx + dy * dy > cutR * cutR) continue;
          const aIdx = (yy * e.sprite.width + xx) * 4 + 3;
          data[aIdx] = 0;
        }
      }
      e.sprite.ctx.putImageData(img, 0, 0);

      let alive = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 35) alive += 1;
      }
      e.alivePixels = alive;
      const ratio = alive / Math.max(1, e.initialPixels);
      if (ratio <= ENEMY_BREAK_THRESHOLD) {
        explodeTextToParticles(e);
        enemies.splice(ei, 1);
        score += 100;
        break;
      }
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt;
    p.vx *= 0.99;
    p.life -= dt * 1.1;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = clamp(p.life, 0, 1);
    ctx.fillStyle = `${p.color}${a})`;
    ctx.fillRect(p.x, p.y, 2, 2);
  }
}

function drawHud() {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = '700 22px "Meiryo", sans-serif';
  ctx.fillStyle = "#d7ebff";
  ctx.fillText(`SCORE: ${score}`, 18, 12);
  ctx.fillText(`LIFE: ${life}`, 18, 38);

  const hitGlow = clamp(damageFlashTimer / 0.32, 0, 1);
  const lineA = 0.35 + hitGlow * 0.55;
  ctx.strokeStyle = `rgba(255, 120, 120, ${lineA})`;
  ctx.lineWidth = 2 + hitGlow * 4;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(W, GROUND_Y);
  ctx.stroke();
}

function drawDamageFeedback() {
  const flash = clamp(damageFlashTimer / 0.32, 0, 1);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 40, 40, ${flash * 0.22})`;
    ctx.fillRect(0, 0, W, H);
  }

  const warn = clamp(damageTextTimer / 0.85, 0, 1);
  if (warn > 0) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '700 48px "Meiryo", sans-serif';
    ctx.fillStyle = `rgba(255, 145, 145, ${warn})`;
    ctx.fillText("LIFE -1", W * 0.5, GROUND_Y - 48);
  }
}

function drawGameOver() {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 58px "Meiryo", sans-serif';
  ctx.fillStyle = "#ff8da0";
  ctx.fillText("GAME OVER", W / 2, H / 2 - 24);
  ctx.font = '700 26px "Meiryo", sans-serif';
  ctx.fillStyle = "#d7ebff";
  ctx.fillText("Rキー / A / STARTでリスタート", W / 2, H / 2 + 30);
}

function drawStartOverlay() {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 46px "Meiryo", sans-serif';
  ctx.fillStyle = "#9ed9ff";
  ctx.fillText("悲しい気持ち", W * 0.5, H * 0.39);
  ctx.fillText("クラッシュシューター", W * 0.5, H * 0.46);
  ctx.font = '700 24px "Meiryo", sans-serif';
  ctx.fillStyle = "#d7ebff";
  ctx.fillText("タップ / キー入力 / A / STARTでスタート", W * 0.5, H * 0.56);
}

function resetGame() {
  score = 0;
  life = 5;
  gameOver = false;
  spawnTimer = 0;
  shotCooldown = 0;
  bullets.length = 0;
  enemies.length = 0;
  particles.length = 0;
  player.x = W * 0.5;
  damageFlashTimer = 0;
  damageTextTimer = 0;
}

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  ctx.clearRect(0, 0, W, H);
  handleGamepadUiActions();

  if (!gameStarted) {
    drawPlayer();
    drawHud();
    drawStartOverlay();
    requestAnimationFrame(loop);
    return;
  }

  if (!gameOver) {
    spawnTimer -= dt;
    shotCooldown -= dt;
    if (shotCooldown <= 0) {
      spawnBullet();
      shotCooldown = AUTO_FIRE_INTERVAL;
    }
    if (spawnTimer <= 0) {
      enemies.push(makeEnemy());
      const base = Math.max(0.45, 1.2 - score / 5000);
      spawnTimer = randomRange(base * 0.55, base * 1.15);
    }

    updateInput(dt);
    updateBullets(dt);
    updateEnemies(dt);
    handleCollisions();
    updateParticles(dt);
    damageFlashTimer = Math.max(0, damageFlashTimer - dt);
    damageTextTimer = Math.max(0, damageTextTimer - dt);
  } else {
    updateParticles(dt);
    damageFlashTimer = Math.max(0, damageFlashTimer - dt);
    damageTextTimer = Math.max(0, damageTextTimer - dt);
  }

  drawParticles();
  for (const e of enemies) drawEnemy(e);
  for (const b of bullets) drawBullet(b);
  drawPlayer();
  drawHud();
  drawDamageFeedback();
  if (gameOver) drawGameOver();

  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") e.preventDefault();
  startGame();
  keys.add(e.code);
  if (e.code === "KeyR" && gameOver) resetGame();
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

function bindTouchButton(id, axisValue) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = (e) => {
    e.preventDefault();
    startGame();
    touchAxis = axisValue;
  };
  const end = (e) => {
    e.preventDefault();
    if (touchAxis === axisValue) touchAxis = 0;
  };
  el.addEventListener("touchstart", start, { passive: false });
  el.addEventListener("touchend", end, { passive: false });
  el.addEventListener("touchcancel", end, { passive: false });
  el.addEventListener("mousedown", start);
  window.addEventListener("mouseup", end);
}

bindTouchButton("btn-left", -1);
bindTouchButton("btn-right", 1);

const restartBtn = document.getElementById("btn-restart");
if (restartBtn) {
  const restart = (e) => {
    e.preventDefault();
    startGame();
    if (gameOver) resetGame();
  };
  restartBtn.addEventListener("touchstart", restart, { passive: false });
  restartBtn.addEventListener("click", restart);
}

canvas.addEventListener("touchstart", () => startGame(), { passive: true });
canvas.addEventListener("mousedown", () => startGame());

requestAnimationFrame(loop);
