import { VisionPipeline, VisionPacket } from './vision';
import { GameEngine } from './game';
import { OneEuroFilter2D } from './filter';
import { VegiRenderer } from './renderer';
import {
  MultiplayerClient,
  PlayerRole,
  SwordPose,
  SliceEventPayload,
  ScoreSyncPayload,
  MatchOverPayload
} from './multiplayer';

const video = document.getElementById('webcam') as HTMLVideoElement;
const remoteVideo = document.getElementById('remote-webcam') as HTMLVideoElement;
const remoteFallbackImg = document.getElementById('remote-webcam-fallback') as HTMLImageElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// HUD Elements
const scoreEl = document.getElementById('score-display')!;
const opponentHud = document.getElementById('opponent-hud')!;
const opponentScoreEl = document.getElementById('opponent-score-display')!;
const mpTimerEl = document.getElementById('mp-timer')!;
const topControls = document.getElementById('top-controls')!;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;
const nextOpponentBtn = document.getElementById('next-opponent-btn') as HTMLButtonElement;
const menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;
const countdownBanner = document.getElementById('countdown-banner')!;

// Modal Elements
const modalScreen = document.getElementById('modal-screen')!;
const modalBadge = document.getElementById('modal-badge')!;
const modalTitle = document.getElementById('modal-title')!;
const modalDesc = document.getElementById('modal-desc')!;
const menuOptions = document.getElementById('menu-options')!;
const singleplayerBtn = document.getElementById('singleplayer-btn') as HTMLButtonElement;
const multiplayerBtn = document.getElementById('multiplayer-btn') as HTMLButtonElement;
const modalActions = document.getElementById('modal-actions')!;
const actionBtn = document.getElementById('action-btn') as HTMLButtonElement;
const secondaryBtn = document.getElementById('secondary-btn') as HTMLButtonElement;
const backMenuBtn = document.getElementById('back-menu-btn') as HTMLButtonElement;

// PiP Elements
const pipContainer = document.getElementById('pip-container')!;
const pipPlaceholder = document.getElementById('pip-placeholder')!;
const pipLabel = document.getElementById('pip-label')!;
const localMicIndicator = document.getElementById('local-mic-indicator')!;
const voiceBars = Array.from(document.querySelectorAll('#voice-bars .v-bar')) as HTMLElement[];

const vision = new VisionPipeline();
const game = new GameEngine();
const renderer = new VegiRenderer(ctx);

const filters: OneEuroFilter2D[] = [
  new OneEuroFilter2D(1.0, 0.007),
  new OneEuroFilter2D(1.0, 0.007)
];

let lastFrameTime = performance.now();
let countdownTargetPerfTime = 0;
let lastScoreSyncTime = 0;

// Setup Multiplayer Client & Callbacks
const multiplayer = new MultiplayerClient({
  onSearching: () => {
    game.state = 'SEARCHING';
    game.resetArena();
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'block';
    if (remoteFallbackImg) remoteFallbackImg.style.display = 'none';
    pipPlaceholder.style.display = 'flex';
    pipPlaceholder.textContent = 'SEARCHING QUEUE...';
    pipLabel.textContent = 'FINDING OPPONENT';
    countdownBanner.style.display = 'none';

    modalBadge.textContent = 'LIVE ARENA QUEUE';
    modalTitle.textContent = 'SEARCHING FOR KNIGHT...';
    modalDesc.textContent =
      'Waiting for another player to join the queue. Your voice call and shared arena will start automatically!';
    menuOptions.style.display = 'none';
    modalActions.style.display = 'flex';
    actionBtn.style.display = 'none';
    secondaryBtn.style.display = 'none';
    backMenuBtn.style.display = 'inline-block';
    modalScreen.style.display = 'block';
  },

  onMatchFound: (role: PlayerRole, matchStartTime: number) => {
    pipPlaceholder.textContent = 'CONNECTING VOICE & VIDEO...';
    pipLabel.textContent = role === 'host' ? 'RIVAL KNIGHT (P2)' : 'RIVAL KNIGHT (P1)';
    beginMultiplayerCountdown(matchStartTime);
  },

  onPeerLeft: () => {
    game.state = 'SEARCHING';
    game.resetArena();
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'block';
    if (remoteFallbackImg) remoteFallbackImg.style.display = 'none';
    pipPlaceholder.style.display = 'flex';
    pipPlaceholder.textContent = 'OPPONENT LEFT';
    countdownBanner.style.display = 'none';

    modalBadge.textContent = 'OPPONENT DISCONNECTED';
    modalTitle.textContent = 'KNIGHT LEFT THE ARENA';
    modalDesc.textContent = 'Your opponent disconnected or skipped. Ready to match with the next player?';
    menuOptions.style.display = 'none';
    modalActions.style.display = 'flex';
    actionBtn.style.display = 'none';
    secondaryBtn.textContent = 'FIND NEXT OPPONENT ⏭';
    secondaryBtn.style.display = 'inline-block';
    backMenuBtn.style.display = 'inline-block';
    modalScreen.style.display = 'block';
  },

  onRemoteStream: (stream: MediaStream) => {
    remoteVideo.srcObject = stream;
    remoteVideo.muted = false;
    remoteVideo.style.display = 'block';
    if (remoteFallbackImg) remoteFallbackImg.style.display = 'none';
    remoteVideo.play().catch(() => {});
    pipPlaceholder.style.display = 'none';
    pipLabel.textContent = 'OPPONENT LIVE • VOICE ON';
  },

  onRemoteFallbackFrame: (dataUrl: string) => {
    if (remoteFallbackImg) {
      remoteFallbackImg.src = dataUrl;
      remoteFallbackImg.style.display = 'block';
      remoteVideo.style.display = 'none';
      pipPlaceholder.style.display = 'none';
      pipLabel.textContent = 'OPPONENT LIVE';
    }
  },

  onSpawnTarget: target => {
    if (game.mode === 'MULTIPLAYER' && game.state === 'PLAYING') {
      game.addRemoteTarget(target);
    }
  },

  onSliceTarget: (payload: SliceEventPayload) => {
    if (game.mode !== 'MULTIPLAYER') return;
    game.applyRemoteSlice(
      payload.targetId,
      payload.cutAngle,
      payload.nearestX,
      payload.nearestY,
      () => {
        updateHUD();
        checkMultiplayerKnockout();
      }
    );
  },

  onScoreSync: (payload: ScoreSyncPayload) => {
    if (game.mode !== 'MULTIPLAYER' || game.state !== 'PLAYING') return;
    if (multiplayer.role === 'guest') {
      game.score = payload.guestScore;
      game.lives = payload.guestLives;
      game.opponentScore = payload.hostScore;
      game.opponentLives = payload.hostLives;
      game.matchTimeRemaining = payload.timeRemainingMs / 1000;
      updateHUD();
    }
  },

  onMatchOver: (payload: MatchOverPayload) => {
    if (game.mode !== 'MULTIPLAYER') return;
    if (multiplayer.role === 'host') {
      game.score = payload.hostScore;
      game.lives = payload.hostLives;
      game.opponentScore = payload.guestScore;
      game.opponentLives = payload.guestLives;
    } else {
      game.score = payload.guestScore;
      game.lives = payload.guestLives;
      game.opponentScore = payload.hostScore;
      game.opponentLives = payload.hostLives;
    }
    updateHUD();
    showMultiplayerGameOver(payload.winner, payload.reason);
  },

  onRematchStart: (matchStartTime: number) => {
    if (game.mode !== 'MULTIPLAYER') return;
    beginMultiplayerCountdown(matchStartTime);
  }
});

// Hook GameEngine multiplayer events
game.onTargetSpawned = target => {
  if (game.mode === 'MULTIPLAYER' && multiplayer.role === 'host') {
    multiplayer.sendSpawnTarget(target);
  }
};

game.onTargetSlicedByLocal = (target, cutAngle, nearestX, nearestY) => {
  if (game.mode === 'MULTIPLAYER') {
    multiplayer.sendSliceTarget({
      targetId: target.id,
      cutAngle,
      nearestX,
      nearestY,
      slicerRole: multiplayer.role
    });
    checkMultiplayerKnockout();
  }
};

async function bootstrapCamera(): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, frameRate: { ideal: 60 } },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch {
    // Fallback if microphone permission is denied or no mic hardware is present
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, frameRate: { ideal: 60 } },
      audio: false
    });
  }
  video.srcObject = stream;
  multiplayer.setLocalStream(stream);
  await new Promise(res => (video.onloadedmetadata = res));
}

function beginMultiplayerCountdown(matchStartEpochMs: number): void {
  const delayMs = Math.max(800, matchStartEpochMs - Date.now());
  countdownTargetPerfTime = performance.now() + delayMs;
  game.state = 'COUNTDOWN';
  game.score = 0;
  game.lives = 3;
  game.opponentScore = 0;
  game.opponentLives = 3;
  game.matchTimeRemaining = game.matchDurationSec;
  game.resetArena();
  updateHUD();

  modalScreen.style.display = 'none';
  countdownBanner.style.display = 'block';
  countdownBanner.textContent = '3';
}

function updateHUD(): void {
  scoreEl.textContent = `SCORE: ${game.score}`;
  for (let i = 1; i <= 3; i++) {
    const heart = document.getElementById(`hp-${i}`)!;
    if (i > game.lives) {
      heart.classList.add('lost');
    } else {
      heart.classList.remove('lost');
    }
  }

  if (game.mode === 'MULTIPLAYER') {
    opponentScoreEl.textContent = `FOE: ${game.opponentScore}`;
    for (let i = 1; i <= 3; i++) {
      const oppHeart = document.getElementById(`opp-hp-${i}`)!;
      if (i > game.opponentLives) {
        oppHeart.classList.add('lost');
      } else {
        oppHeart.classList.remove('lost');
      }
    }

    const totalSec = Math.ceil(game.matchTimeRemaining);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    mpTimerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (totalSec <= 10 && game.state === 'PLAYING') {
      mpTimerEl.classList.add('urgent');
    } else {
      mpTimerEl.classList.remove('urgent');
    }
  } else if (game.lives <= 0 && game.state === 'PLAYING') {
    game.state = 'GAMEOVER';
    modalBadge.textContent = 'SOLO MATCH COMPLETE';
    modalTitle.textContent = 'VALIANT DEFEAT';
    modalDesc.textContent = `FINAL SCORE: ${game.score}. Raise both open hands or click below to re-enter battle!`;
    menuOptions.style.display = 'none';
    modalActions.style.display = 'flex';
    actionBtn.textContent = 'PLAY AGAIN';
    actionBtn.style.display = 'inline-block';
    secondaryBtn.style.display = 'none';
    backMenuBtn.style.display = 'inline-block';
    modalScreen.style.display = 'block';
  }
}

function checkMultiplayerKnockout(): void {
  if (game.mode !== 'MULTIPLAYER' || game.state !== 'PLAYING') return;

  if (game.lives <= 0 || game.opponentLives <= 0) {
    const hostScore = multiplayer.role === 'host' ? game.score : game.opponentScore;
    const hostLives = multiplayer.role === 'host' ? game.lives : game.opponentLives;
    const guestScore = multiplayer.role === 'guest' ? game.score : game.opponentScore;
    const guestLives = multiplayer.role === 'guest' ? game.lives : game.opponentLives;

    let winner: PlayerRole | 'draw' = 'draw';
    if (hostLives <= 0 && guestLives > 0) {
      winner = 'guest';
    } else if (guestLives <= 0 && hostLives > 0) {
      winner = 'host';
    } else if (hostScore !== guestScore) {
      winner = hostScore > guestScore ? 'host' : 'guest';
    }

    const payload: MatchOverPayload = {
      winner,
      reason: 'knockout',
      hostScore,
      hostLives,
      guestScore,
      guestLives
    };

    multiplayer.sendMatchOver(payload);
    showMultiplayerGameOver(winner, 'knockout');
  }
}

function handleMultiplayerTimeUp(): void {
  if (game.mode !== 'MULTIPLAYER' || game.state !== 'PLAYING') return;

  const hostScore = multiplayer.role === 'host' ? game.score : game.opponentScore;
  const hostLives = multiplayer.role === 'host' ? game.lives : game.opponentLives;
  const guestScore = multiplayer.role === 'guest' ? game.score : game.opponentScore;
  const guestLives = multiplayer.role === 'guest' ? game.lives : game.opponentLives;

  let winner: PlayerRole | 'draw' = 'draw';
  if (hostScore > guestScore) {
    winner = 'host';
  } else if (guestScore > hostScore) {
    winner = 'guest';
  } else if (hostLives !== guestLives) {
    winner = hostLives > guestLives ? 'host' : 'guest';
  }

  const payload: MatchOverPayload = {
    winner,
    reason: 'timeout',
    hostScore,
    hostLives,
    guestScore,
    guestLives
  };

  if (multiplayer.role === 'host') {
    multiplayer.sendMatchOver(payload);
  }
  showMultiplayerGameOver(winner, 'timeout');
}

function showMultiplayerGameOver(winner: PlayerRole | 'draw', reason: 'timeout' | 'knockout'): void {
  if (game.state === 'GAMEOVER') return;
  game.state = 'GAMEOVER';
  countdownBanner.style.display = 'none';

  const didWin = winner !== 'draw' && winner === multiplayer.role;
  const isDraw = winner === 'draw';

  modalBadge.textContent = reason === 'knockout' ? 'KNOCKOUT • LAST KNIGHT STANDING' : 'TIME UP • FINAL SCORE';
  if (isDraw) {
    modalTitle.textContent = 'HONORABLE DRAW!';
  } else if (didWin) {
    modalTitle.textContent = 'GLORIOUS VICTORY!';
  } else {
    modalTitle.textContent = 'VALIANT DEFEAT';
  }

  const reasonText =
    reason === 'knockout'
      ? game.lives <= 0
        ? 'You lost all 3 hearts to poison mushrooms!'
        : 'Your opponent lost all 3 hearts!'
      : '60-second arena battle complete!';

  modalDesc.textContent = `${reasonText} YOU: ${game.score} pts (${game.lives} ❤️) vs RIVAL: ${game.opponentScore} pts (${game.opponentLives} ❤️). Voice call is still live—raise both hands or click REMATCH!`;

  menuOptions.style.display = 'none';
  modalActions.style.display = 'flex';
  actionBtn.textContent = 'REMATCH';
  actionBtn.style.display = 'inline-block';
  secondaryBtn.textContent = 'NEXT OPPONENT ⏭';
  secondaryBtn.style.display = 'inline-block';
  backMenuBtn.style.display = 'inline-block';
  modalScreen.style.display = 'block';
}

function showMainMenu(): void {
  multiplayer.disconnect();
  game.mode = 'SINGLEPLAYER';
  game.state = 'MENU';
  game.score = 0;
  game.lives = 3;
  game.resetArena();
  updateHUD();

  opponentHud.style.display = 'none';
  mpTimerEl.style.display = 'none';
  topControls.style.display = 'none';
  pipContainer.style.display = 'none';
  countdownBanner.style.display = 'none';

  modalBadge.textContent = 'UCF KNIGHTRO ARENA';
  modalTitle.textContent = 'VEGI KNIGHTS';
  modalDesc.textContent =
    'Select your battle mode below. Wield your finger-tracked sword in Solo Arcade or jump into live 1v1 Multiplayer with video & voice chat!';
  menuOptions.style.display = 'grid';
  modalActions.style.display = 'none';
  modalScreen.style.display = 'block';
}

function enterSingleplayer(): void {
  multiplayer.disconnect();
  game.mode = 'SINGLEPLAYER';
  game.state = 'CALIBRATION';
  game.score = 0;
  game.lives = 3;
  game.resetArena();
  updateHUD();

  opponentHud.style.display = 'none';
  mpTimerEl.style.display = 'none';
  pipContainer.style.display = 'none';
  countdownBanner.style.display = 'none';

  topControls.style.display = 'flex';
  muteBtn.style.display = 'none';
  nextOpponentBtn.style.display = 'none';

  modalBadge.textContent = 'SINGLEPLAYER MODE';
  modalTitle.textContent = 'CALIBRATION & PREVIEW';
  modalDesc.textContent =
    'Raise both open hands in the air for 1.5 seconds (or click START MATCH) to begin your solo run!';
  menuOptions.style.display = 'none';
  modalActions.style.display = 'flex';
  actionBtn.textContent = 'START MATCH';
  actionBtn.style.display = 'inline-block';
  secondaryBtn.style.display = 'none';
  backMenuBtn.style.display = 'inline-block';
  modalScreen.style.display = 'block';
}

function enterMultiplayer(): void {
  game.mode = 'MULTIPLAYER';
  game.state = 'SEARCHING';
  game.score = 0;
  game.lives = 3;
  game.opponentScore = 0;
  game.opponentLives = 3;
  game.matchTimeRemaining = game.matchDurationSec;
  game.resetArena();
  updateHUD();

  opponentHud.style.display = 'block';
  mpTimerEl.style.display = 'block';
  topControls.style.display = 'flex';
  muteBtn.style.display = 'inline-block';
  nextOpponentBtn.style.display = 'inline-block';
  pipContainer.style.display = 'block';
  countdownBanner.style.display = 'none';

  multiplayer.connectAndFindMatch();
}

// UI Button Event Listeners
singleplayerBtn.addEventListener('click', () => {
  enterSingleplayer();
});

multiplayerBtn.addEventListener('click', () => {
  enterMultiplayer();
});

actionBtn.addEventListener('click', () => {
  if (game.mode === 'SINGLEPLAYER') {
    game.start();
    updateHUD();
    modalScreen.style.display = 'none';
    game.gestureProgress = 0;
  } else if (game.mode === 'MULTIPLAYER' && game.state === 'GAMEOVER') {
    const startTime = multiplayer.sendRematchRequest();
    beginMultiplayerCountdown(startTime);
  }
});

secondaryBtn.addEventListener('click', () => {
  if (game.mode === 'MULTIPLAYER') {
    multiplayer.nextOpponent();
  }
});

nextOpponentBtn.addEventListener('click', () => {
  if (game.mode === 'MULTIPLAYER') {
    multiplayer.nextOpponent();
  }
});

backMenuBtn.addEventListener('click', () => {
  showMainMenu();
});

menuBtn.addEventListener('click', () => {
  showMainMenu();
});

muteBtn.addEventListener('click', () => {
  const isMuted = multiplayer.toggleMute();
  muteBtn.textContent = isMuted ? 'MIC: MUTED' : 'MIC: ON';
  muteBtn.classList.toggle('muted', isMuted);
  localMicIndicator.textContent = isMuted ? '🔇 MIC MUTED' : '🎤 VOICE CALL ACTIVE';
});

function checkTwoHandsRaised(hands: VisionPacket['hands']): boolean {
  if (hands.length < 2) return false;
  return hands[0][8].y < hands[0][0].y && hands[1][8].y < hands[1][0].y;
}

function updateVoiceUI(): void {
  if (game.mode !== 'MULTIPLAYER') return;
  multiplayer.updateVoiceLevels();

  const remoteLevel = multiplayer.remoteVoiceLevel;
  const isOpponentSpeaking = remoteLevel > 0.12;
  pipContainer.classList.toggle('speaking', isOpponentSpeaking);

  for (let i = 0; i < voiceBars.length; i++) {
    const scale = Math.min(1, remoteLevel * (1.4 + i * 0.35));
    const h = Math.max(4, Math.round(scale * 14));
    voiceBars[i].style.height = `${h}px`;
  }
}

function loop(now: number): void {
  const dt = (now - lastFrameTime) / 1000.0;
  lastFrameTime = now;

  // 1. Draw Mirrored Raw Camera
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. Vision Task Inference (Hand Landmarker)
  const visionData: VisionPacket = vision.processFrame(video, now);

  // 3. Synchronized Multiplayer Countdown
  if (game.mode === 'MULTIPLAYER' && game.state === 'COUNTDOWN') {
    const remainingMs = countdownTargetPerfTime - now;
    if (remainingMs <= 0) {
      countdownBanner.textContent = 'SLASH!';
      game.start();
      updateHUD();
      setTimeout(() => {
        if (game.state === 'PLAYING') {
          countdownBanner.style.display = 'none';
        }
      }, 450);
    } else {
      const sec = Math.ceil(remainingMs / 1000);
      countdownBanner.textContent = String(sec);
    }
  }

  // 4. Hands-free Gesture Detection (Singleplayer Start/Restart & Multiplayer Rematch)
  const canUseHandsGesture =
    (game.mode === 'SINGLEPLAYER' && (game.state === 'CALIBRATION' || game.state === 'GAMEOVER')) ||
    (game.mode === 'MULTIPLAYER' && game.state === 'GAMEOVER' && multiplayer.inRoom);

  if (canUseHandsGesture) {
    if (checkTwoHandsRaised(visionData.hands)) {
      game.gestureProgress = Math.min(1.0, game.gestureProgress + dt / 1.5);
      if (game.gestureProgress >= 1.0) {
        game.gestureProgress = 0;
        if (game.mode === 'SINGLEPLAYER') {
          game.start();
          updateHUD();
          modalScreen.style.display = 'none';
        } else if (game.mode === 'MULTIPLAYER') {
          const startTime = multiplayer.sendRematchRequest();
          beginMultiplayerCountdown(startTime);
        }
      }
    } else {
      game.gestureProgress = Math.max(0.0, game.gestureProgress - dt * 1.5);
    }
    renderer.renderGestureMeter(game.gestureProgress, canvas.width, canvas.height);
  }

  // 5. Track Local Hands, Filter Jitter, Render Local Sword & Collect Network Pose
  const currentLocalSwords: SwordPose[] = [];

  visionData.hands.forEach((hand, idx) => {
    const rawTip = hand[8];     // Index tip (fingernail)
    const rawKnuckle = hand[5]; // Index MCP knuckle

    const filter = filters[idx] || filters[0];
    const smoothed = filter.filter(rawTip.x * canvas.width, rawTip.y * canvas.height, now);

    const knuckleX = rawKnuckle.x * canvas.width;
    const knuckleY = rawKnuckle.y * canvas.height;

    // Angle pointing from fingertip back toward knuckle
    const swordAngle = Math.atan2(knuckleY - smoothed.y, knuckleX - smoothed.x) - Math.PI / 2;

    currentLocalSwords.push({
      x: smoothed.x,
      y: smoothed.y,
      angle: swordAngle
    });

    // Record trail for slicing intersections
    game.slashTrail.push({ x: smoothed.x, y: smoothed.y, age: 1.0 });

    if (game.slashTrail.length >= 2 && game.state === 'PLAYING') {
      const p1 = game.slashTrail[game.slashTrail.length - 2];
      const p2 = game.slashTrail[game.slashTrail.length - 1];
      game.processSlash(p1, p2, updateHUD);
    }
  });

  // Decay local slash trail
  for (let i = game.slashTrail.length - 1; i >= 0; i--) {
    game.slashTrail[i].age -= 0.08 * (dt * 60);
    if (game.slashTrail[i].age <= 0) game.slashTrail.splice(i, 1);
  }

  // 6. Multiplayer Network Sync & Fluid Remote Sword Rendering
  if (game.mode === 'MULTIPLAYER') {
    multiplayer.sendSwordState(currentLocalSwords, now);

    const remoteSwords = multiplayer.updateRemoteInterpolation(dt, now);
    renderer.renderSlashTrail(multiplayer.remoteSlashTrail, '#00E5FF');
    for (const rs of remoteSwords) {
      renderer.renderSword(rs.x, rs.y, rs.angle, 'remote');
    }

    // Periodic score/timer heartbeat from host
    if (multiplayer.role === 'host' && game.state === 'PLAYING' && now - lastScoreSyncTime > 500) {
      lastScoreSyncTime = now;
      multiplayer.sendScoreSync({
        hostScore: game.score,
        hostLives: game.lives,
        guestScore: game.opponentScore,
        guestLives: game.opponentLives,
        timeRemainingMs: Math.round(game.matchTimeRemaining * 1000)
      });
    }

    updateVoiceUI();
  }

  // 7. Render Local Slash Trail & Local Gold Swords
  renderer.renderSlashTrail(game.slashTrail, '#FFC904');
  for (const ls of currentLocalSwords) {
    renderer.renderSword(ls.x, ls.y, ls.angle, 'local');
  }

  // 8. Game Physics, 3D Targets, Floating Score Popups & Particle Rendering
  const canSpawn = game.mode === 'SINGLEPLAYER' || multiplayer.role === 'host';
  game.update(now, dt, canvas.width, canvas.height, canSpawn, updateHUD, handleMultiplayerTimeUp);
  if (game.state === 'PLAYING') {
    updateHUD();
  }

  for (const item of game.targets) {
    renderer.renderTarget(item);
  }

  renderer.renderParticles(game.particles);
  renderer.renderFloatingTexts(game.floatingTexts);

  requestAnimationFrame(loop);
}

async function main() {
  modalBadge.textContent = 'SYSTEM BOOT';
  modalTitle.textContent = 'INITIALIZING SYSTEM';
  modalDesc.textContent = 'Loading MediaPipe AI tracking models & camera feed...';
  menuOptions.style.display = 'none';
  modalActions.style.display = 'none';

  await bootstrapCamera();
  await vision.initialize();

  showMainMenu();
  requestAnimationFrame(loop);
}

main().catch(err => console.error('Initialization error:', err));