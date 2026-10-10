import { VisionPipeline, VisionPacket } from './vision';
import { GameEngine } from './game';

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const scoreEl = document.getElementById('score-display')!;
const modalScreen = document.getElementById('modal-screen')!;
const modalTitle = document.getElementById('modal-title')!;
const modalDesc = document.getElementById('modal-desc')!;
const actionBtn = document.getElementById('action-btn') as HTMLButtonElement;

const vision = new VisionPipeline();
const game = new GameEngine();

async function bootstrapCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: { ideal: 60 } },
    audio: false
  });
  video.srcObject = stream;
  await new Promise(res => (video.onloadedmetadata = res));
}

function updateHearts(): void {
  for (let i = 1; i <= 3; i++) {
    const heart = document.getElementById(`hp-${i}`)!;
    if (i > game.lives) {
      heart.classList.add('lost');
    } else {
      heart.classList.remove('lost');
    }
  }
  if (game.lives <= 0) {
    game.state = 'GAMEOVER';
    modalTitle.textContent = 'VALIANT DEFEAT';
    modalDesc.textContent = `FINAL SCORE: ${game.score}. The harvest has overtaken the realm.`;
    actionBtn.textContent = 'FIGHT AGAIN';
    modalScreen.style.display = 'block';
  }
}

function renderKnightroHelmet(x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(x, y - h * 0.15);

  const scaleW = w * 1.8;
  const scaleH = h * 2.1;

  // Solid Matte UCF Gold Helmet Shell
  ctx.fillStyle = '#FFC904';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 6;

  ctx.beginPath();
  ctx.moveTo(-scaleW * 0.45, -scaleH * 0.35);
  ctx.quadraticCurveTo(0, -scaleH * 0.75, scaleW * 0.45, -scaleH * 0.35);
  ctx.lineTo(scaleW * 0.42, scaleH * 0.42);
  ctx.quadraticCurveTo(0, scaleH * 0.65, -scaleW * 0.42, scaleH * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Black Crest Comb
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(-scaleW * 0.08, -scaleH * 0.45);
  ctx.lineTo(scaleW * 0.08, -scaleH * 0.45);
  ctx.lineTo(scaleW * 0.06, -scaleH * 0.85);
  ctx.lineTo(-scaleW * 0.06, -scaleH * 0.85);
  ctx.closePath();
  ctx.fill();

  // Visor Shadow Cutout
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(-scaleW * 0.35, -scaleH * 0.08);
  ctx.lineTo(scaleW * 0.35, -scaleH * 0.08);
  ctx.lineTo(scaleW * 0.28, scaleH * 0.12);
  ctx.lineTo(-scaleW * 0.28, scaleH * 0.12);
  ctx.closePath();
  ctx.fill();

  // Golden Grille Slits
  ctx.fillStyle = '#FFC904';
  for (let offset = -0.22; offset <= 0.22; offset += 0.09) {
    ctx.fillRect(offset * scaleW - 3, -scaleH * 0.08, 6, scaleH * 0.2);
  }

  ctx.restore();
}

function loop(now: number): void {
  // 1. Draw mirrored raw video
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. Continuous Vision Inference
  const visionData: VisionPacket = vision.processFrame(video, now);

  // 3. Render Knightro Helmet across ALL states (CALIBRATION, PLAYING, GAMEOVER)
  if (visionData.faceTransform) {
    renderKnightroHelmet(
      visionData.faceTransform.xCenter * canvas.width,
      visionData.faceTransform.yCenter * canvas.height,
      visionData.faceTransform.width * canvas.width,
      visionData.faceTransform.height * canvas.height
    );
  }

  // 4. Ingest Hand Landmarks and Build Trail Points
  visionData.hands.forEach(hand => {
    // Landmark 8 corresponds to Index Fingertip; Landmark 5 is MCP base
    const tip = hand[8];
    const tipX = tip.x * canvas.width;
    const tipY = tip.y * canvas.height;

    game.slashTrail.push({ x: tipX, y: tipY, age: 1.0 });

    if (game.slashTrail.length >= 2 && game.state === 'PLAYING') {
      const p1 = game.slashTrail[game.slashTrail.length - 2];
      const p2 = game.slashTrail[game.slashTrail.length - 1];
      game.processSlash(p1, p2, updateHearts);
    }
  });

  // 5. Age & Draw Golden Slicing Trails
  for (let i = game.slashTrail.length - 1; i >= 0; i--) {
    game.slashTrail[i].age -= 0.08;
    if (game.slashTrail[i].age <= 0) {
      game.slashTrail.splice(i, 1);
    }
  }

  ctx.strokeStyle = '#FFC904';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  for (let i = 1; i < game.slashTrail.length; i++) {
    const t1 = game.slashTrail[i - 1];
    const t2 = game.slashTrail[i];
    if (Math.hypot(t2.x - t1.x, t2.y - t1.y) < 140) {
      ctx.globalAlpha = t2.age;
      ctx.beginPath();
      ctx.moveTo(t1.x, t1.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1.0;

  // 6. Update Game Targets and UI
  game.update(now, canvas.width, canvas.height, updateHearts);
  scoreEl.textContent = `SCORE: ${game.score}`;

  for (const item of game.targets) {
    if (item.sliced) continue;

    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.fillStyle = item.color;

    if (item.isBomb) {
      // Mushroom Cap
      ctx.beginPath();
      ctx.arc(0, -5, item.radius, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      // Stem
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-item.radius * 0.35, -5, item.radius * 0.7, item.radius * 0.7);
      // Spots
      ctx.beginPath();
      ctx.arc(-14, -18, 6, 0, Math.PI * 2);
      ctx.arc(14, -18, 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, item.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = item.leaf;
      ctx.beginPath();
      ctx.ellipse(0, -item.radius, 8, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  requestAnimationFrame(loop);
}

actionBtn.addEventListener('click', () => {
  game.start();
  updateHearts();
  modalScreen.style.display = 'none';
});

async function main() {
  actionBtn.disabled = true;
  actionBtn.textContent = 'LOADING MODELS...';
  
  await bootstrapCamera();
  await vision.initialize();

  actionBtn.disabled = false;
  actionBtn.textContent = 'START MATCH';
  
  requestAnimationFrame(loop);
}

main().catch(err => console.error('Initialization failed:', err));