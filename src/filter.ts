class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  constructor(private alpha: number = 0) {}

  public filter(val: number, alpha?: number): number {
    if (alpha !== undefined) this.alpha = alpha;
    if (this.s === null) {
      this.s = val;
    } else {
      this.s = this.alpha * val + (1.0 - this.alpha) * this.s;
    }
    this.y = val;
    return this.s;
  }

  public last(): number | null {
    return this.s;
  }
}

export class OneEuroFilter2D {
  private xFilter = new LowPassFilter();
  private yFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private dyFilter = new LowPassFilter();
  private lastTime: number | null = null;

  constructor(
    private minCutoff: number = 1.0,
    private beta: number = 0.007,
    private dCutoff: number = 1.0
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  public filter(x: number, y: number, timestamp: number): { x: number; y: number } {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      return {
        x: this.xFilter.filter(x, 1.0),
        y: this.yFilter.filter(y, 1.0)
      };
    }

    const dt = Math.max((timestamp - this.lastTime) / 1000.0, 0.001);
    this.lastTime = timestamp;

    const prevX = this.xFilter.last() ?? x;
    const prevY = this.yFilter.last() ?? y;

    const dx = (x - prevX) / dt;
    const dy = (y - prevY) / dt;

    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff, dt));
    const edy = this.dyFilter.filter(dy, this.alpha(this.dCutoff, dt));

    const speed = Math.hypot(edx, edy);
    const cutoff = this.minCutoff + this.beta * speed;
    const a = this.alpha(cutoff, dt);

    return {
      x: this.xFilter.filter(x, a),
      y: this.yFilter.filter(y, a)
    };
  }

  public reset(): void {
    this.lastTime = null;
  }
}