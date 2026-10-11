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
  MatchOverPayload,
  PeerSyncState
} from './multiplayer';

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// HUD Elements
const scoreEl = document.getElementById('score-display')!;
const bestScoreEl = document.getElementById('best-score-display')!;
const spModeSub = document.getElementById('sp-mode-sub')!;
const opponentHud = document.getElementById('opponent-hud')!;
const opponentScoreEl = document.getElementById('opponent-score-display')!;
const mpTimerEl = document.getElementById('mp-timer')!;
const topControls = document.getElementById('top-controls')!;
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

const vision = new VisionPipeline();
const game = new GameEngine();
const renderer = new VegiRenderer(ctx);

interface CursorSlot {
  filter: OneEuroFilter2D;
  lastX: number;
  lastY: number;
  lastSeenTime: number;
}

const cursorSlots: CursorSlot[] = Array.from({ length: 4 }, () => ({
  filter: new OneEuroFilter2D(1.0, 0.007),
  lastX: 0,
  lastY: 0,
  lastSeenTime: -1000
}));

let lastFrameTime = performance.now();
let countdownTargetPerfTime = 0;
let lastScoreSyncTime = 0;

// Multiplayer Match & Mutual Rematch State
let currentMatchId = 1;
let lastMatchOverPayload: MatchOverPayload | null = null;
let localRematchReady = false;
let remoteRematchReady = false;

function clearModalOutcomeClasses(): void {
  modalScreen.classList.remove('winner-modal', 'loser-modal', 'draw-modal');
  actionBtn.disabled = false;
}

function applyRemoteMatchOver(payload: MatchOverPayload): void {
  if (game.mode !== 'MULTIPLAYER' || game.state === 'GAMEOVER') return;
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
  lastMatchOverPayload = payload;
  updateHUD();
  showMultiplayerGameOver(payload.winner, payload.reason);
}

function handleRemoteRematchVote(matchId: number): void {
  if (game.mode !== 'MULTIPLAYER' || game.state !== 'GAMEOVER') return;
  if (matchId > 0 && matchId < currentMatchId) return;
  if (remoteRematchReady) return;

  remoteRematchReady = true;

  if (localRematchReady && remoteRematchReady) {
    const nextId = currentMatchId + 1;
    multiplayer.sendRematchStart(nextId, 3000);
    beginMultiplayerCountdown(3000, nextId);
  } else {
    modalBadge.textContent = '⚔️ RIVAL WANTS A REMATCH (1/2 READY)!';
    actionBtn.textContent = 'ACCEPT REMATCH (1/2 READY)';
    actionBtn.disabled = false;
  }
}

function triggerLocalRematchVote(): void {
  if (game.mode !== 'MULTIPLAYER' || game.state !== 'GAMEOVER' || !multiplayer.inRoom) return;
  if (localRematchReady) return;

  localRematchReady = true;
  game.gestureProgress = 0;
  multiplayer.sendRematchVote(currentMatchId);

  if (localRematchReady && remoteRematchReady) {
    const nextId = currentMatchId + 1;
    multiplayer.sendRematchStart(nextId, 3000);
    beginMultiplayerCountdown(3000, nextId);
  } else {
    modalBadge.textContent = '⏳ REMATCH REQUESTED (1/2 READY) • WAITING FOR RIVAL';
    actionBtn.textContent = 'WAITING FOR RIVAL (1/2)...';
    actionBtn.disabled = true;
  }
}

// Setup Multiplayer Client & Callbacks
const multiplayer = new MultiplayerClient({
  onSearching: () => {
    game.state = 'SEARCHING';
    game.resetArena();
    countdownBanner.style.display = 'none';
    lastMatchOverPayload = null;
    localRematchReady = false;
    remoteRematchReady = false;
    clearModalOutcomeClasses();

    modalBadge.textContent = 'LIVE ARENA QUEUE';
    modalTitle.textContent = 'SEARCHING FOR KNIGHT...';
    modalDesc.textContent =
      'Waiting for another player to join the queue. Your shared arena battle will start automatically!';
    menuOptions.style.display = 'none';
    modalActions.style.display = 'flex';
    actionBtn.style.display = 'none';
    secondaryBtn.style.display = 'none';
    backMenuBtn.style.display = 'inline-block';
    modalScreen.style.display = 'block';
  },

  onMatchFound: (_role: PlayerRole, countdownMs: number) => {
    currentMatchId = 1;
    beginMultiplayerCountdown(countdownMs, 1);
  },

  onPeerLeft: () => {
    game.state = 'SEARCHING';
    game.resetArena();
    countdownBanner.style.display = 'none';
    lastMatchOverPayload = null;
    localRematchReady = false;
    remoteRematchReady = false;
    clearModalOutcomeClasses();

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

  onSpawnTarget: target => {
    if (game.mode === 'MULTIPLAYER' && (game.state === 'PLAYING' || game.state === 'COUNTDOWN')) {
      if (game.state === 'COUNTDOWN') {
        countdownBanner.style.display = 'none';
        game.start();
      }
      game.addRemoteTarget(target);
    }
  },

  onSliceTarget: (payload: SliceEventPayload) => {
    if (game.mode !== 'MULTIPLAYER' || game.state === 'GAMEOVER') return;
    game.applyRemoteSlice(
      payload.targetId,
      payload.cutAngle,
      payload.nearestX,
      payload.nearestY,
      () => {
        updateHUD();
        checkMultiplayerKnockout();
      },
      payload.isBomb,
      payload.points,
      payload.slicerScore,
      payload.slicerLives
    );
  },

  onScoreSync: (payload: ScoreSyncPayload) => {
    if (game.mode !== 'MULTIPLAYER' || (game.state !== 'PLAYING' && game.state !== 'COUNTDOWN')) return;
    if (multiplayer.role === 'guest') {
      if (game.state === 'COUNTDOWN') {
        countdownBanner.style.display = 'none';
        game.start();
      }
      // Only update host's score/lives/timer/targets; guest is authoritative for guest's own score and lives
      game.opponentScore = payload.hostScore;
      game.opponentLives = payload.hostLives;
      game.matchTimeRemaining = payload.timeRemainingMs / 1000;
      if (payload.targets) {
        game.syncRemoteTargets(payload.targets);
      }
      updateHUD();
      checkMultiplayerKnockout();
    }
  },

  onMatchOver: (payload: MatchOverPayload) => {
    applyRemoteMatchOver(payload);
  },

  onPeerSyncState: (sync: PeerSyncState) => {
    if (game.mode !== 'MULTIPLAYER') return;

    if (game.state === 'PLAYING' && sync.matchId === currentMatchId) {
      const changed = game.opponentScore !== sync.score || game.opponentLives !== sync.lives;
      game.opponentScore = sync.score;
      game.opponentLives = sync.lives;
      if (changed) {
        updateHUD();
      }
      if (sync.matchOver) {
        applyRemoteMatchOver(sync.matchOver);
        return;
      }
      if (game.opponentLives <= 0 || game.lives <= 0) {
        checkMultiplayerKnockout();
      }
    } else if (game.state === 'GAMEOVER') {
      if (sync.matchId === currentMatchId && sync.rematchReady && !remoteRematchReady) {
        handleRemoteRematchVote(sync.matchId);
      } else if (sync.matchId > currentMatchId && localRematchReady) {
        beginMultiplayerCountdown(3000, sync.matchId);
      }
    }
  },

  onRematchVote: (matchId: number) => {
    handleRemoteRematchVote(matchId);
  },

  onRematchStart: (nextMatchId: number, countdownMs: number) => {
    if (game.mode !== 'MULTIPLAYER' || game.state !== 'GAMEOVER') return;
    if (!localRematchReady) {
      handleRemoteRematchVote(currentMatchId);
      return;
    }
    const targetMatchId = nextMatchId > currentMatchId ? nextMatchId : currentMatchId + 1;
    beginMultiplayerCountdown(countdownMs, targetMatchId);
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
      slicerRole: multiplayer.role,
      isBomb: target.isBomb,
      points: target.points,
      slicerScore: game.score,
      slicerLives: game.lives
    });
    checkMultiplayerKnockout();
  }
};

async function bootstrapCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: { ideal: 60 } },
    audio: false
  });
  video.srcObject = stream;
  await new Promise(res => (video.onloadedmetadata = res));
}

function beginMultiplayerCountdown(countdownOrEpochMs: number, nextMatchId?: number): void {
  if (typeof nextMatchId === 'number' && nextMatchId > 0) {
    currentMatchId = nextMatchId;
  }
  lastMatchOverPayload = null;
  localRematchReady = false;
  remoteRematchReady = false;

  const delayMs =
    countdownOrEpochMs <= 15000
      ? Math.max(800, countdownOrEpochMs)
      : Math.max(800, countdownOrEpochMs - Date.now());
  countdownTargetPerfTime = performance.now() + delayMs;
  game.state = 'COUNTDOWN';
  game.score = 0;
  game.lives = 3;
  game.opponentScore = 0;
  game.opponentLives = 3;
  game.matchTimeRemaining = game.matchDurationSec;
  game.resetArena();
  clearModalOutcomeClasses();
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

  if (game.mode === 'SINGLEPLAYER') {
    bestScoreEl.style.display = 'inline-block';
    bestScoreEl.textContent = game.isNewHighScore
      ? `★ BEST: ${game.highScore}`
      : `BEST: ${game.highScore}`;
    bestScoreEl.classList.toggle('new-record', game.isNewHighScore);
  } else {
    bestScoreEl.style.display = 'none';
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
    clearModalOutcomeClasses();
    modalBadge.textContent = game.isNewHighScore && game.score > 0 ? '🏆 NEW HIGH SCORE!' : 'SOLO MATCH COMPLETE';
    modalTitle.textContent = 'YOU LOST';
    modalDesc.textContent =
      game.isNewHighScore && game.score > 0
        ? `FINAL SCORE: ${game.score} (NEW PERSONAL BEST!). Raise both open hands or hit play again`
        : `FINAL SCORE: ${game.score} - HIGH SCORE: ${game.highScore}. Raise both open hands or hit play again`;
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

    lastMatchOverPayload = payload;
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

  // When time runs out and both players still have lives left, winner is determined strictly by points; equal points = DRAW
  let winner: PlayerRole | 'draw' = 'draw';
  if (hostLives <= 0 && guestLives > 0) {
    winner = 'guest';
  } else if (guestLives <= 0 && hostLives > 0) {
    winner = 'host';
  } else if (hostScore > guestScore) {
    winner = 'host';
  } else if (guestScore > hostScore) {
    winner = 'guest';
  } else {
    winner = 'draw';
  }

  const payload: MatchOverPayload = {
    winner,
    reason: 'timeout',
    hostScore,
    hostLives,
    guestScore,
    guestLives
  };

  lastMatchOverPayload = payload;
  multiplayer.sendMatchOver(payload);
  showMultiplayerGameOver(winner, 'timeout');
}

function showMultiplayerGameOver(winner: PlayerRole | 'draw', reason: 'timeout' | 'knockout'): void {
  if (game.state === 'GAMEOVER') return;
  game.state = 'GAMEOVER';
  countdownBanner.style.display = 'none';
  localRematchReady = false;
  remoteRematchReady = false;
  clearModalOutcomeClasses();

  const didWin = winner !== 'draw' && winner === multiplayer.role;
  const isDraw = winner === 'draw';

  if (isDraw) {
    modalScreen.classList.add('draw-modal');
    modalBadge.textContent = "TIME'S UP!";
    modalTitle.textContent = "DRAW!";
  } else if (didWin) {
    modalScreen.classList.add('winner-modal');
    modalBadge.textContent =
      reason === 'knockout' ? 'OPPONENT LOST ALL LIVES!' : "TIME'S UP!";
    modalTitle.textContent = 'WINNER!';
  } else {
    modalScreen.classList.add('loser-modal');
    modalBadge.textContent =
      reason === 'knockout' ? "YOU LOST ALL LIVES!" : "WIN!";
    modalTitle.textContent = 'LOSER';
  }

  const reasonText =
    reason === 'knockout'
      ? didWin
        ? 'Great Job!'
        : 'Better Luck Next Time'
      : isDraw
        ? 'Same Score!'
        : didWin
          ? 'Great Job!'
          : 'Unfortunatly You Got Less Points';

  modalDesc.textContent = "Both players must click REMATCH to play again!";

  menuOptions.style.display = 'none';
  modalActions.style.display = 'flex';
  actionBtn.textContent = 'REMATCH (0/2)';
  actionBtn.disabled = false;
  actionBtn.style.display = 'inline-block';
  secondaryBtn.textContent = 'NEXT OPPONENT';
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
  game.isNewHighScore = false;
  lastMatchOverPayload = null;
  localRematchReady = false;
  remoteRematchReady = false;
  game.resetArena();
  clearModalOutcomeClasses();
  updateHUD();

  spModeSub.textContent = `Solo Arcade • 3 Lives • Best: ${game.highScore}`;

  opponentHud.style.display = 'none';
  mpTimerEl.style.display = 'none';
  topControls.style.display = 'none';
  countdownBanner.style.display = 'none';

  modalBadge.textContent = 'UCF KNIGHTRO ARENA';
  modalTitle.textContent = 'VEGI KNIGHTS';
  modalDesc.textContent =
    'Select your battle mode below';
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
  game.isNewHighScore = false;
  lastMatchOverPayload = null;
  localRematchReady = false;
  remoteRematchReady = false;
  game.resetArena();
  clearModalOutcomeClasses();
  updateHUD();

  opponentHud.style.display = 'none';
  mpTimerEl.style.display = 'none';
  countdownBanner.style.display = 'none';

  topControls.style.display = 'flex';
  nextOpponentBtn.style.display = 'none';

  modalBadge.textContent = 'SINGLEPLAYER MODE';
  modalTitle.textContent = 'CALIBRATION & PREVIEW';
  modalDesc.textContent =
    'Raise both open hands in the air for 1.5 seconds (or click START MATCH) to begin your solo run!';
  menuOptions.style.display = 'none';
  modalActions.style.display = 'flex';
  actionBtn.textContent = 'START MATCH';
  actionBtn.disabled = false;
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
  lastMatchOverPayload = null;
  localRematchReady = false;
  remoteRematchReady = false;
  game.resetArena();
  updateHUD();

  opponentHud.style.display = 'block';
  mpTimerEl.style.display = 'block';
  topControls.style.display = 'flex';
  nextOpponentBtn.style.display = 'inline-block';
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
    triggerLocalRematchVote();
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

function checkTwoHandsRaised(hands: VisionPacket['hands']): boolean {
  if (hands.length < 2) return false;
  return hands[0][8].y < hands[0][0].y && hands[1][8].y < hands[1][0].y;
}

interface RawFingerCursor {
  tipX: number;
  tipY: number;
  knuckleX: number;
  knuckleY: number;
}

function extractFingerCursors(hands: VisionPacket['hands']): RawFingerCursor[] {
  const cursors: RawFingerCursor[] = [];

  for (const hand of hands) {
    // 1. Primary cursor: Index finger (tip 8, knuckle 5)
    const idxTipX = hand[8].x * canvas.width;
    const idxTipY = hand[8].y * canvas.height;
    cursors.push({
      tipX: idxTipX,
      tipY: idxTipY,
      knuckleX: hand[5].x * canvas.width,
      knuckleY: hand[5].y * canvas.height
    });

    // 2. Secondary cursor on the same hand if playing with two fingers (Middle finger tip 12, knuckle 9)
    const wrist = hand[0];
    const dMidTip = Math.hypot(hand[12].x - wrist.x, hand[12].y - wrist.y);
    const dMidPip = Math.hypot(hand[10].x - wrist.x, hand[10].y - wrist.y);
    const dRingTip = Math.hypot(hand[16].x - wrist.x, hand[16].y - wrist.y);
    const dRingPip = Math.hypot(hand[14].x - wrist.x, hand[14].y - wrist.y);

    const midTipX = hand[12].x * canvas.width;
    const midTipY = hand[12].y * canvas.height;
    const tipSeparationPx = Math.hypot(idxTipX - midTipX, idxTipY - midTipY);

    const isMiddleExtended = dMidTip > dMidPip * 1.12;
    const isRingCurled = dRingTip < dRingPip * 1.16;

    if (isMiddleExtended && isRingCurled && tipSeparationPx > 22) {
      cursors.push({
        tipX: midTipX,
        tipY: midTipY,
        knuckleX: hand[9].x * canvas.width,
        knuckleY: hand[9].y * canvas.height
      });
    }
  }

  return cursors.slice(0, 4);
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

  // 4. Hands-free Gesture Detection (Singleplayer Start/Restart & Multiplayer Rematch Vote)
  const canUseHandsGesture =
    (game.mode === 'SINGLEPLAYER' && (game.state === 'CALIBRATION' || game.state === 'GAMEOVER')) ||
    (game.mode === 'MULTIPLAYER' && game.state === 'GAMEOVER' && multiplayer.inRoom && !localRematchReady);

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
          triggerLocalRematchVote();
        }
      }
    } else {
      game.gestureProgress = Math.max(0.0, game.gestureProgress - dt * 1.5);
    }
    renderer.renderGestureMeter(game.gestureProgress, canvas.width, canvas.height);
  }

  // 5. Track Local Fingers/Hands with Persistent Slot Matching & Independent Slash Trails
  const rawCursors = extractFingerCursors(visionData.hands);
  const usedSlots = new Set<number>();
  const currentLocalSwords: SwordPose[] = [];

  for (const rc of rawCursors) {
    // Find closest recently active slot so two fingers/hands never swap or cross-connect trails
    let bestSlotIdx = -1;
    let bestDist = 320;

    for (let s = 0; s < cursorSlots.length; s++) {
      if (usedSlots.has(s)) continue;
      const slot = cursorSlots[s];
      if (now - slot.lastSeenTime < 220) {
        const dist = Math.hypot(rc.tipX - slot.lastX, rc.tipY - slot.lastY);
        if (dist < bestDist) {
          bestDist = dist;
          bestSlotIdx = s;
        }
      }
    }

    // If no recently active slot matched, pick an available slot and reset its filter/trail
    if (bestSlotIdx === -1) {
      for (let s = 0; s < cursorSlots.length; s++) {
        if (!usedSlots.has(s) && now - cursorSlots[s].lastSeenTime >= 220) {
          bestSlotIdx = s;
          break;
        }
      }
      if (bestSlotIdx === -1) {
        for (let s = 0; s < cursorSlots.length; s++) {
          if (!usedSlots.has(s)) {
            bestSlotIdx = s;
            break;
          }
        }
      }
      if (bestSlotIdx !== -1) {
        cursorSlots[bestSlotIdx].filter.reset();
        game.slashTrails[bestSlotIdx] = [];
      }
    }

    if (bestSlotIdx === -1) continue;
    usedSlots.add(bestSlotIdx);

    const slot = cursorSlots[bestSlotIdx];
    const smoothed = slot.filter.filter(rc.tipX, rc.tipY, now);
    slot.lastX = smoothed.x;
    slot.lastY = smoothed.y;
    slot.lastSeenTime = now;

    // Angle pointing from fingertip back toward knuckle
    const swordAngle = Math.atan2(rc.knuckleY - smoothed.y, rc.knuckleX - smoothed.x) - Math.PI / 2;

    currentLocalSwords.push({
      x: smoothed.x,
      y: smoothed.y,
      angle: swordAngle
    });

    const trail = game.slashTrails[bestSlotIdx];
    trail.push({ x: smoothed.x, y: smoothed.y, age: 1.0 });

    if (trail.length >= 2 && game.state === 'PLAYING') {
      const p1 = trail[trail.length - 2];
      const p2 = trail[trail.length - 1];
      game.processSlash(p1, p2, updateHUD);
    }
  }

  // Decay all local slash trails independently
  for (const trail of game.slashTrails) {
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].age -= 0.08 * (dt * 60);
      if (trail[i].age <= 0) trail.splice(i, 1);
    }
  }

  // 6. Multiplayer Network Sync & Fluid Remote Sword Rendering
  if (game.mode === 'MULTIPLAYER') {
    multiplayer.sendSwordState(currentLocalSwords, now, {
      matchId: currentMatchId,
      score: game.score,
      lives: game.lives,
      matchOver: game.state === 'GAMEOVER' ? lastMatchOverPayload : null,
      rematchReady: game.state === 'GAMEOVER' ? localRematchReady : false
    });

    const remoteSwords = multiplayer.updateRemoteInterpolation(dt, now);
    for (const rTrail of multiplayer.remoteSlashTrails) {
      renderer.renderSlashTrail(rTrail, '#00E5FF');
    }
    for (const rs of remoteSwords) {
      renderer.renderSword(rs.x, rs.y, rs.angle, 'remote');
    }

    // Periodic score/timer/target heartbeat from host
    if (multiplayer.role === 'host' && game.state === 'PLAYING' && now - lastScoreSyncTime > 300) {
      lastScoreSyncTime = now;
      const activeTargets = game.targets.filter(t => !t.sliced);
      multiplayer.sendScoreSync({
        hostScore: game.score,
        hostLives: game.lives,
        guestScore: game.opponentScore,
        guestLives: game.opponentLives,
        timeRemainingMs: Math.round(game.matchTimeRemaining * 1000),
        targets: activeTargets
      });
    }
  }

  // 7. Render Local Slash Trails & Local Gold Swords
  for (const trail of game.slashTrails) {
    renderer.renderSlashTrail(trail, '#FFC904');
  }
  for (const ls of currentLocalSwords) {
    renderer.renderSword(ls.x, ls.y, ls.angle, 'local');
  }

  // 8. Game Physics, 3D Targets, Floating Score Popups & Particle Rendering
  const prevDisplayedSec = Math.ceil(game.matchTimeRemaining);
  const canSpawn = game.mode === 'SINGLEPLAYER' || multiplayer.role === 'host';
  game.update(now, dt, canvas.width, canvas.height, canSpawn, updateHUD, handleMultiplayerTimeUp);
  if (game.mode === 'MULTIPLAYER' && game.state === 'PLAYING') {
    const newDisplayedSec = Math.ceil(game.matchTimeRemaining);
    if (newDisplayedSec !== prevDisplayedSec) {
      updateHUD();
    }
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