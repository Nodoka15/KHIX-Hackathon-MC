import soundFile from './audio/sword_slash.mp3';

function playSlashSound(): void {
  try {
    const audio = new Audio(soundFile);
    audio.volume = 0.65;
    audio.play().catch(() => {});
  } catch {
    // Ignore audio playback errors
  }
}

export interface Target {
  id: number;
  type: 'carrot' | 'eggplant' | 'broccoli' | 'corn' | 'tomato' | 'mushroom';
  isBomb: boolean;
  radius: number;
  points: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  rotation: number;
  vRot: number;
  sliced: boolean;
  slicedBy?: 'local' | 'remote';
  // Sliced piece split properties
  splitPieces?: SlicedHalf[];
}

export interface SlicedHalf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  vRot: number;
  side: -1 | 1; // Left or Right half
  cutAngle: number;
}

export interface SlashParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  alpha: number;
}

const HIGH_SCORE_KEY = 'vegi_knights_high_score';

export class GameEngine {
  public mode: 'SINGLEPLAYER' | 'MULTIPLAYER' = 'SINGLEPLAYER';
  public state: 'MENU' | 'CALIBRATION' | 'SEARCHING' | 'COUNTDOWN' | 'PLAYING' | 'GAMEOVER' = 'MENU';

  public score = 0;
  public lives = 3;
  public highScore = 0;
  public isNewHighScore = false;
  private highScoreBannerShown = false;

  public opponentScore = 0;
  public opponentLives = 3;

  public matchDurationSec = 60;
  public matchTimeRemaining = 60;
  private matchStartPerfTime = 0;

  public targets: Target[] = [];
  public particles: SlashParticle[] = [];
  public floatingTexts: FloatingText[] = [];
  public slashTrails: { x: number; y: number; age: number }[][] = [[], [], [], []];

  // Hands-free gesture timer
  public gestureProgress = 0; // 0 to 1

  private lastSpawnTime = 0;
  private spawnInterval = 1300;
  private idCounter = 0;

  public onTargetSpawned?: (target: Target) => void;
  public onTargetSlicedByLocal?: (target: Target, cutAngle: number, nearestX: number, nearestY: number) => void;

  constructor() {
    this.loadHighScore();
  }

  private loadHighScore(): void {
    try {
      const saved = localStorage.getItem(HIGH_SCORE_KEY);
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.highScore = parsed;
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveHighScore(val: number): void {
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(val));
    } catch {
      // Ignore storage errors
    }
  }

  public start(): void {
    this.score = 0;
    this.lives = 3;
    this.isNewHighScore = false;
    this.highScoreBannerShown = this.highScore === 0;
    this.opponentScore = 0;
    this.opponentLives = 3;
    this.targets = [];
    this.particles = [];
    this.floatingTexts = [];
    this.slashTrails = [[], [], [], []];
    this.state = 'PLAYING';
    const now = performance.now();
    this.lastSpawnTime = now;
    this.matchStartPerfTime = now;
    this.matchTimeRemaining = this.matchDurationSec;
    this.spawnInterval = this.mode === 'MULTIPLAYER' ? 950 : 1300;
  }

  public resetArena(): void {
    this.targets = [];
    this.particles = [];
    this.floatingTexts = [];
    this.slashTrails = [[], [], [], []];
    this.gestureProgress = 0;
  }

  public update(
    now: number,
    dt: number,
    canvasWidth: number,
    canvasHeight: number,
    canSpawn: boolean,
    onStateChanged: () => void,
    onMatchTimeUp?: () => void
  ): void {
    const timeScale = Math.min(dt, 0.05) * 60;

    // Always update particles & floating texts even right after game over
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * timeScale;
      p.y += p.vy * timeScale;
      p.alpha -= p.decay * timeScale;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * timeScale;
      ft.alpha -= 0.022 * timeScale;
      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    if (this.state !== 'PLAYING') return;

    if (this.mode === 'MULTIPLAYER') {
      const elapsedSec = (now - this.matchStartPerfTime) / 1000;
      this.matchTimeRemaining = Math.max(0, this.matchDurationSec - elapsedSec);
      if (this.matchTimeRemaining <= 0 && onMatchTimeUp) {
        onMatchTimeUp();
        return;
      }
    }

    if (canSpawn && now - this.lastSpawnTime > this.spawnInterval) {
      this.spawn(canvasWidth, canvasHeight);
      // In Multiplayer, occasionally toss a second veggie simultaneously so both knights have plenty to fight over
      if (this.mode === 'MULTIPLAYER' && Math.random() < 0.35) {
        this.spawn(canvasWidth, canvasHeight);
      }
      this.lastSpawnTime = now;
    }

    // Update targets & split pieces
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const item = this.targets[i];

      if (!item.sliced) {
        item.x += item.vx * timeScale;
        item.y += item.vy * timeScale;
        item.vy += item.gravity * timeScale;
        item.rotation += item.vRot * timeScale;

        // Penalty when un-sliced vegetables fall off bottom (Singleplayer only)
        if (item.y > canvasHeight + item.radius * 2) {
          if (!item.isBomb && this.mode === 'SINGLEPLAYER') {
            this.lives--;
            onStateChanged();
          }
          this.targets.splice(i, 1);
        }
      } else if (item.splitPieces) {
        // Update both halves
        for (const piece of item.splitPieces) {
          piece.x += piece.vx * timeScale;
          piece.y += piece.vy * timeScale;
          piece.vy += item.gravity * timeScale;
          piece.rotation += piece.vRot * timeScale;
        }

        // Clean up once both fallen
        if (item.splitPieces.every(p => p.y > canvasHeight + 100)) {
          this.targets.splice(i, 1);
        }
      }
    }
  }

  private spawn(canvasWidth: number, canvasHeight: number): void {
    const isBomb = Math.random() < 0.22;
    const types: Target['type'][] = ['carrot', 'eggplant', 'broccoli', 'corn', 'tomato'];
    const chosenType = isBomb ? 'mushroom' : types[Math.floor(Math.random() * types.length)];

    const radiusMap = {
      carrot: 32,
      eggplant: 40,
      broccoli: 38,
      corn: 34,
      tomato: 36,
      mushroom: 38
    };

    const target: Target = {
      id: ++this.idCounter,
      type: chosenType,
      isBomb,
      radius: radiusMap[chosenType],
      points: isBomb ? 0 : 15,
      x: 180 + Math.random() * (canvasWidth - 360),
      y: canvasHeight + 40,
      vx: (Math.random() - 0.5) * 6,
      vy: -(15 + Math.random() * 3.5),
      gravity: 0.38,
      rotation: Math.random() * Math.PI,
      vRot: (Math.random() - 0.5) * 0.08,
      sliced: false
    };

    this.targets.push(target);

    if (this.mode === 'MULTIPLAYER' && this.onTargetSpawned) {
      this.onTargetSpawned(target);
    }
  }

  public addRemoteTarget(target: Target): void {
    if (this.targets.some(t => t.id === target.id)) return;
    this.targets.push({
      ...target,
      sliced: false
    });
  }

  public processSlash(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    onStateChanged: () => void
  ): void {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;

    const cutAngle = Math.atan2(dy, dx);

    for (const item of this.targets) {
      if (item.sliced) continue;

      const u = ((item.x - p1.x) * dx + (item.y - p1.y) * dy) / (len * len);
      const clampedU = Math.max(0, Math.min(1, u));
      const nearestX = p1.x + clampedU * dx;
      const nearestY = p1.y + clampedU * dy;

      if (Math.hypot(item.x - nearestX, item.y - nearestY) < item.radius) {
        this.sliceTargetItem(item, cutAngle, nearestX, nearestY, 'local');

        if (item.isBomb) {
          this.lives = Math.max(0, this.lives - 1);
          this.floatingTexts.push({
            x: item.x,
            y: item.y - 10,
            vy: -2.2,
            text: '-1 HEART!',
            color: '#FF2E54',
            alpha: 1.0
          });
        } else {
          this.score += item.points;
          this.floatingTexts.push({
            x: item.x,
            y: item.y - 10,
            vy: -2.2,
            text: `+${item.points}`,
            color: '#FFC904',
            alpha: 1.0
          });

          if (this.mode === 'SINGLEPLAYER' && this.score > this.highScore) {
            this.highScore = this.score;
            this.isNewHighScore = true;
            this.saveHighScore(this.highScore);
            if (!this.highScoreBannerShown) {
              this.highScoreBannerShown = true;
              this.floatingTexts.push({
                x: item.x,
                y: item.y - 42,
                vy: -2.6,
                text: 'NEW HIGH SCORE!',
                color: '#FFE57F',
                alpha: 1.0
              });
            }
          }
        }

        if (this.mode === 'MULTIPLAYER' && this.onTargetSlicedByLocal) {
          this.onTargetSlicedByLocal(item, cutAngle, nearestX, nearestY);
        }

        onStateChanged();
      }
    }
  }

  public applyRemoteSlice(
    targetId: number,
    cutAngle: number,
    nearestX: number,
    nearestY: number,
    onStateChanged: () => void
  ): void {
    const item = this.targets.find(t => t.id === targetId);
    if (!item) return;

    // Even if locally already sliced in a race condition, avoid double-splitting
    if (!item.sliced) {
      this.sliceTargetItem(item, cutAngle, nearestX, nearestY, 'remote');
    }

    if (item.isBomb) {
      this.opponentLives = Math.max(0, this.opponentLives - 1);
      this.floatingTexts.push({
        x: item.x,
        y: item.y - 10,
        vy: -2.2,
        text: 'FOE HIT BOMB!',
        color: '#00E5FF',
        alpha: 1.0
      });
    } else {
      this.opponentScore += item.points;
      this.floatingTexts.push({
        x: item.x,
        y: item.y - 10,
        vy: -2.2,
        text: `+${item.points} FOE`,
        color: '#00E5FF',
        alpha: 1.0
      });
    }

    onStateChanged();
  }

  private sliceTargetItem(
    item: Target,
    cutAngle: number,
    nearestX: number,
    nearestY: number,
    slicedBy: 'local' | 'remote'
  ): void {
    item.sliced = true;
    item.slicedBy = slicedBy;
    playSlashSound();

    // Emit slash particles
    this.emitSlashSparks(nearestX, nearestY, cutAngle, item.isBomb, slicedBy);

    if (!item.isBomb) {
      // Compute 2D splitting trajectory
      const normX = -Math.sin(cutAngle);
      const normY = Math.cos(cutAngle);
      const splitPush = 4.5;

      item.splitPieces = [
        {
          x: item.x,
          y: item.y,
          vx: item.vx + normX * splitPush,
          vy: item.vy + normY * splitPush - 2,
          rotation: item.rotation,
          vRot: -0.12,
          side: -1,
          cutAngle
        },
        {
          x: item.x,
          y: item.y,
          vx: item.vx - normX * splitPush,
          vy: item.vy - normY * splitPush - 2,
          rotation: item.rotation,
          vRot: 0.12,
          side: 1,
          cutAngle
        }
      ];
    }
  }

  private emitSlashSparks(
    x: number,
    y: number,
    angle: number,
    isBomb: boolean,
    slicedBy: 'local' | 'remote' = 'local'
  ): void {
    const count = isBomb ? 40 : 25;
    for (let i = 0; i < count; i++) {
      const spread = angle + (Math.random() - 0.5) * 1.5;
      const speed = 4 + Math.random() * 8;
      let color: string;
      if (isBomb) {
        color = Math.random() > 0.5 ? '#9C27B0' : '#D32F2F';
      } else if (slicedBy === 'remote') {
        color = Math.random() > 0.4 ? '#00E5FF' : '#FF2E54';
      } else {
        color = Math.random() > 0.4 ? '#FFC904' : '#FFFFFF';
      }

      this.particles.push({
        x,
        y,
        vx: Math.cos(spread) * speed * (Math.random() > 0.5 ? 1 : -1),
        vy: Math.sin(spread) * speed,
        size: 3 + Math.random() * 4,
        color,
        alpha: 1.0,
        decay: 0.04 + Math.random() * 0.04
      });
    }
  }
}