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

export class GameEngine {
  public score = 0;
  public lives = 3;
  public state: 'CALIBRATION' | 'PLAYING' | 'GAMEOVER' = 'CALIBRATION';
  public targets: Target[] = [];
  public particles: SlashParticle[] = [];
  public slashTrail: { x: number; y: number; age: number }[] = [];

  // Hands-free gesture timer
  public gestureProgress = 0; // 0 to 1

  private lastSpawnTime = 0;
  private spawnInterval = 1300;
  private idCounter = 0;

  public start(): void {
    this.score = 0;
    this.lives = 3;
    this.targets = [];
    this.particles = [];
    this.state = 'PLAYING';
    this.lastSpawnTime = performance.now();
  }

  public update(now: number, canvasWidth: number, canvasHeight: number, onLifeLost: () => void): void {
    if (this.state !== 'PLAYING') return;

    if (now - this.lastSpawnTime > this.spawnInterval) {
      this.spawn(canvasWidth, canvasHeight);
      this.lastSpawnTime = now;
    }

    // Update targets & split pieces
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const item = this.targets[i];

      if (!item.sliced) {
        item.x += item.vx;
        item.y += item.vy;
        item.vy += item.gravity;
        item.rotation += item.vRot;

        // Penalty when un-sliced vegetables fall off bottom
        if (item.y > canvasHeight + item.radius * 2) {
          if (!item.isBomb) {
            this.lives--;
            onLifeLost();
          }
          this.targets.splice(i, 1);
        }
      } else if (item.splitPieces) {
        // Update both halves
        for (const piece of item.splitPieces) {
          piece.x += piece.vx;
          piece.y += piece.vy;
          piece.vy += item.gravity;
          piece.rotation += piece.vRot;
        }

        // Clean up once both fallen
        if (item.splitPieces.every(p => p.y > canvasHeight + 100)) {
          this.targets.splice(i, 1);
        }
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
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

    this.targets.push({
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
    });
  }

  public processSlash(p1: { x: number; y: number }, p2: { x: number; y: number }, onLifeLost: () => void): void {
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
        item.sliced = true;

        // Emit slash particles
        this.emitSlashSparks(nearestX, nearestY, cutAngle, item.isBomb);

        if (item.isBomb) {
          this.lives--;
          onLifeLost();
        } else {
          this.score += item.points;

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
    }
  }

  private emitSlashSparks(x: number, y: number, angle: number, isBomb: boolean): void {
    const count = isBomb ? 40 : 25;
    for (let i = 0; i < count; i++) {
      const spread = angle + (Math.random() - 0.5) * 1.5;
      const speed = 4 + Math.random() * 8;
      const color = isBomb
        ? (Math.random() > 0.5 ? '#9C27B0' : '#D32F2F')
        : (Math.random() > 0.4 ? '#FFC904' : '#FFFFFF');

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