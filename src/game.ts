export interface Target {
  type: string;
  color: string;
  leaf: string;
  radius: number;
  points: number;
  isBomb: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  sliced: boolean;
}

export class GameEngine {
  public score = 0;
  public lives = 3;
  public state: 'CALIBRATION' | 'PLAYING' | 'GAMEOVER' = 'CALIBRATION';
  public targets: Target[] = [];
  public slashTrail: { x: number; y: number; age: number }[] = [];

  private lastSpawnTime = 0;
  private spawnInterval = 1400;

  private templates = [
    { type: 'carrot', color: '#FF7A00', leaf: '#2E7D32', radius: 36, points: 10, isBomb: false },
    { type: 'eggplant', color: '#5E2750', leaf: '#2E7D32', radius: 42, points: 15, isBomb: false },
    { type: 'broccoli', color: '#2E7D32', leaf: '#1B5E20', radius: 38, points: 10, isBomb: false },
    { type: 'corn', color: '#FFD54F', leaf: '#81C784', radius: 34, points: 10, isBomb: false },
    { type: 'poison_shroom', color: '#D32F2F', leaf: '#FFFFFF', radius: 38, points: 0, isBomb: true }
  ];

  public start(): void {
    this.score = 0;
    this.lives = 3;
    this.targets = [];
    this.state = 'PLAYING';
    this.lastSpawnTime = performance.now();
  }

  public update(now: number, canvasWidth: number, canvasHeight: number, onLifeLost: () => void): void {
    if (this.state !== 'PLAYING') return;

    if (now - this.lastSpawnTime > this.spawnInterval) {
      this.spawn(canvasWidth, canvasHeight);
      this.lastSpawnTime = now;
    }

    for (let i = this.targets.length - 1; i >= 0; i--) {
      const item = this.targets[i];
      item.x += item.vx;
      item.y += item.vy;
      item.vy += item.gravity;

      // Fallen vegetable check (dropping below frame costs 1 HP)
      if (item.y > canvasHeight + item.radius * 2) {
        if (!item.sliced && !item.isBomb) {
          this.lives--;
          onLifeLost();
        }
        this.targets.splice(i, 1);
      }
    }
  }

  private spawn(canvasWidth: number, canvasHeight: number): void {
    const isBomb = Math.random() < 0.25;
    const template = isBomb
      ? this.templates.find(t => t.isBomb)!
      : this.templates.filter(t => !t.isBomb)[Math.floor(Math.random() * (this.templates.length - 1))];

    this.targets.push({
      ...template,
      x: 150 + Math.random() * (canvasWidth - 300),
      y: canvasHeight + 30,
      vx: (Math.random() - 0.5) * 5.5,
      vy: -(15 + Math.random() * 4),
      gravity: 0.38,
      sliced: false
    });
  }

  public processSlash(p1: { x: number; y: number }, p2: { x: number; y: number }, onLifeLost: () => void): void {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;

    for (const item of this.targets) {
      if (item.sliced) continue;

      const u = ((item.x - p1.x) * dx + (item.y - p1.y) * dy) / (len * len);
      const clampedU = Math.max(0, Math.min(1, u));
      const nearestX = p1.x + clampedU * dx;
      const nearestY = p1.y + clampedU * dy;

      if (Math.hypot(item.x - nearestX, item.y - nearestY) < item.radius) {
        item.sliced = true;
        if (item.isBomb) {
          this.lives--;
          onLifeLost();
        } else {
          this.score += item.points;
        }
      }
    }
  }
}