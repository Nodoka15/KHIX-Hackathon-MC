import { VisionPipeline, VisionPacket } from './vision';
import { GameEngine } from './game';
import { OneEuroFilter2D } from './filter';
import { VegiRenderer } from './renderer';

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
const renderer = new VegiRenderer(ctx);

const filters: OneEuroFilter2D[] = [new OneEuroFilter2D(1.0, 0.007), new OneEuroFilter2D(1.0, 0.007)];

let lastFrameTime = performance.now();

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
    modalDesc.textContent = `FINAL SCORE: ${game.score}. Raise both open hands to re-enter battle!`;
    actionBtn.style.display = 'none';
    modalScreen.style.display = 'block';
  }
}

function checkTwoHandsRaised(hands: VisionPacket['hands']): boolean {
  if (hands.length < 2) return false;
  return hands[0][8].y < hands[0][0].y && hands[1][8].y < hands[1][0].y;
}

function loop(now: number): void {
  const dt = (now - lastFrameTime) / 1000.0;
  lastFrameTime = now;

  // 1. Draw Mirrored Raw Camera
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. Vision Task Inference (Hand Landmarker only)
  const visionData: VisionPacket = vision.processFrame(video, now);

  // 3. Hands-free Gesture Detection
  if (game.state !== 'PLAYING') {
    if (checkTwoHandsRaised(visionData.hands)) {
      game.gestureProgress = Math.min(1.0, game.gestureProgress + dt / 1.5);
      if (game.gestureProgress >= 1.0) {
        game.start();
        updateHearts();
        modalScreen.style.display = 'none';
        game.gestureProgress = 0;
      }
    } else {
      game.gestureProgress = Math.max(0.0, game.gestureProgress - dt * 1.5);
    }
    renderer.renderGestureMeter(game.gestureProgress, canvas.width, canvas.height);
  }

  // 4. Track Hands, Filter Jitter & Render Outward-Facing Sword
  // 4. Track Hands, Filter Jitter & Render Sword Aligned to Fingernail
  visionData.hands.forEach((hand, idx) => {
    const rawTip = hand[8];     // Index tip (fingernail)
    const rawKnuckle = hand[5]; // Index MCP knuckle

    const filter = filters[idx] || filters[0];
    const smoothed = filter.filter(rawTip.x * canvas.width, rawTip.y * canvas.height, now);

    const knuckleX = rawKnuckle.x * canvas.width;
    const knuckleY = rawKnuckle.y * canvas.height;

    // Angle pointing from fingertip back toward knuckle
    const swordAngle = Math.atan2(knuckleY - smoothed.y, knuckleX - smoothed.x) - Math.PI / 2;

    // Render Sword with tip locked directly to fingernail
    renderer.renderSword(smoothed.x, smoothed.y, swordAngle);

    // Record trail for slicing intersections
    game.slashTrail.push({ x: smoothed.x, y: smoothed.y, age: 1.0 });

    if (game.slashTrail.length >= 2 && game.state === 'PLAYING') {
      const p1 = game.slashTrail[game.slashTrail.length - 2];
      const p2 = game.slashTrail[game.slashTrail.length - 1];
      game.processSlash(p1, p2, updateHearts);
    }
  });

  // 5. Sword Trails
  for (let i = game.slashTrail.length - 1; i >= 0; i--) {
    game.slashTrail[i].age -= 0.08;
    if (game.slashTrail[i].age <= 0) game.slashTrail.splice(i, 1);
  }

  ctx.strokeStyle = '#FFC904';
  ctx.lineWidth = 8;
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

  // 6. Game Physics, 3D Targets & Particle Rendering
  game.update(now, canvas.width, canvas.height, updateHearts);
  scoreEl.textContent = `SCORE: ${game.score}`;

  for (const item of game.targets) {
    renderer.renderTarget(item);
  }

  renderer.renderParticles(game.particles);

  requestAnimationFrame(loop);
}

async function main() {
  modalTitle.textContent = 'INITIALIZING SYSTEM';
  modalDesc.textContent = 'Loading MediaPipe AI tracking models...';
  actionBtn.style.display = 'none';

  await bootstrapCamera();
  await vision.initialize();

  modalTitle.textContent = 'CALIBRATION MODE';
  modalDesc.textContent = 'Raise both open hands in the air for 1.5 seconds to start the match!';
  
  requestAnimationFrame(loop);
}

main().catch(err => console.error('Initialization error:', err));