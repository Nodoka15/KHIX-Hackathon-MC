import { Target, FloatingText } from './game';

export class VegiRenderer {
  constructor(private ctx: CanvasRenderingContext2D) {}

  public renderSword(
    tipX: number,
    tipY: number,
    angle: number,
    variant: 'local' | 'remote' = 'local'
  ): void {
    const ctx = this.ctx;
    const isRemote = variant === 'remote';

    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(angle);

    // Tip is positioned exactly at the fingernail: (0, 0)
    // The blade body, guard, and hilt extend backward along the finger (positive Y)

    // 1. Blade Body (Matte UCF Gold for Local, Cyber Silver/Cyan for Opponent)
    ctx.fillStyle = isRemote ? '#00E5FF' : '#FFC904';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3.5;

    if (isRemote) {
      ctx.shadowColor = '#00E5FF';
      ctx.shadowBlur = 12;
    }

    ctx.beginPath();
    ctx.moveTo(0, 0);       // Exact fingernail / point tip
    ctx.lineTo(9, 18);
    ctx.lineTo(7, 85);
    ctx.lineTo(-7, 85);
    ctx.lineTo(-9, 18);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    // 2. Bevel Shading (Depth facet)
    ctx.fillStyle = isRemote ? '#B2EBF2' : '#FFE57F';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 85);
    ctx.lineTo(-7, 85);
    ctx.lineTo(-9, 18);
    ctx.closePath();
    ctx.fill();

    // Center blade ridge
    ctx.strokeStyle = isRemote ? '#00838F' : '#BA9B37';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, 85);
    ctx.stroke();

    // 3. Crossguard (Matte Black for Local, Crimson Accent for Opponent)
    ctx.fillStyle = isRemote ? '#FF2E54' : '#111111';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.fillRect(-18, 85, 36, 8);
    ctx.strokeRect(-18, 85, 36, 8);

    // 4. Hilt & Pommel (resting down the finger)
    ctx.fillStyle = isRemote ? '#00E5FF' : '#FFC904';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.fillRect(-3.5, 93, 7, 18);
    ctx.strokeRect(-3.5, 93, 7, 18);

    ctx.beginPath();
    ctx.arc(0, 114, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Floating badge for Opponent sword so both players clearly track each other
    if (isRemote) {
      ctx.save();
      ctx.translate(tipX, tipY - 22);
      ctx.scale(-1, 1); // Un-mirror text since canvas has scaleX(-1)
      ctx.font = '900 13px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000000';
      ctx.fillRect(-24, -14, 48, 18);
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-24, -14, 48, 18);
      ctx.fillStyle = '#00E5FF';
      ctx.fillText('RIVAL', 0, -1);
      ctx.restore();
    }
  }


  public renderTarget(item: Target): void {
    const ctx = this.ctx;
    if (!item.sliced) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rotation);
      this.draw3DVegetable(item.type);
      ctx.restore();
    } else if (item.splitPieces) {
      for (const half of item.splitPieces) {
        ctx.save();
        ctx.translate(half.x, half.y);
        ctx.rotate(half.rotation);

        // Bounded clip along the cut axis matching the vegetable's actual size
        const clipSize = item.radius * 2.2;
        ctx.beginPath();
        ctx.rect(half.side === -1 ? -clipSize : 0, -clipSize, clipSize, clipSize * 2);
        ctx.clip();

        // Render the half model
        this.draw3DVegetable(item.type);

        // Flat cut boundary stroke strictly restricted to the vegetable radius
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -item.radius * 0.9);
        ctx.lineTo(0, item.radius * 0.9);
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  private draw3DVegetable(type: Target['type']): void {
    const ctx = this.ctx;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';

    switch (type) {
      case 'carrot': {
        // Body cone
        ctx.beginPath();
        ctx.moveTo(0, 42);
        ctx.lineTo(16, -24);
        ctx.quadraticCurveTo(0, -32, -16, -24);
        ctx.closePath();

        // 3D cylindrical shading
        const grad = ctx.createLinearGradient(-16, 0, 16, 0);
        grad.addColorStop(0, '#E65100');
        grad.addColorStop(0.35, '#FFA726');
        grad.addColorStop(1, '#BF360C');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.stroke();

        // Horizontal ridges with specular rim
        ctx.strokeStyle = '#8D2600';
        ctx.lineWidth = 2;
        for (const y of [-12, 2, 18, 30]) {
          ctx.beginPath();
          ctx.arc(0, y, 6, 0.2, Math.PI - 0.2);
          ctx.stroke();
        }

        // 3D Stem tufts
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        ctx.ellipse(-7, -35, 5, 14, -0.3, 0, Math.PI * 2);
        ctx.ellipse(0, -38, 5, 16, 0, 0, Math.PI * 2);
        ctx.ellipse(7, -35, 5, 14, 0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'eggplant': {
        // Teardrop shape with radial sphere volume
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.bezierCurveTo(28, -20, 38, 20, 0, 38);
        ctx.bezierCurveTo(-38, 20, -28, -20, 0, -26);

        const grad = ctx.createRadialGradient(-10, -4, 4, 0, 8, 38);
        grad.addColorStop(0, '#7B1FA2');
        grad.addColorStop(0.6, '#380036');
        grad.addColorStop(1, '#1A0019');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.stroke();

        // Specular highlight gleam
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.beginPath();
        ctx.ellipse(-10, 0, 6, 16, -0.3, 0, Math.PI * 2);
        ctx.fill();

        // 3D Calyx
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        ctx.moveTo(-16, -24);
        ctx.lineTo(-6, -16);
        ctx.lineTo(0, -28);
        ctx.lineTo(6, -16);
        ctx.lineTo(16, -24);
        ctx.lineTo(0, -36);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'broccoli': {
        // 3D Stalk
        const stalkGrad = ctx.createLinearGradient(-10, 0, 10, 0);
        stalkGrad.addColorStop(0, '#66BB6A');
        stalkGrad.addColorStop(0.4, '#A5D6A7');
        stalkGrad.addColorStop(1, '#388E3C');
        ctx.fillStyle = stalkGrad;
        ctx.fillRect(-10, 4, 20, 28);
        ctx.strokeRect(-10, 4, 20, 28);

        // Volumetric Florets
        const drawFloret = (cx: number, cy: number, r: number) => {
          const floretGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r);
          floretGrad.addColorStop(0, '#4CAF50');
          floretGrad.addColorStop(0.7, '#1B5E20');
          floretGrad.addColorStop(1, '#0D3811');
          ctx.fillStyle = floretGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        };

        drawFloret(-16, -6, 17);
        drawFloret(16, -6, 17);
        drawFloret(0, -18, 21);
        break;
      }

      case 'corn': {
        // Cylindrical cob gradient
        const cobGrad = ctx.createLinearGradient(-16, 0, 16, 0);
        cobGrad.addColorStop(0, '#FBC02D');
        cobGrad.addColorStop(0.3, '#FFEE58');
        cobGrad.addColorStop(1, '#F57F17');
        ctx.fillStyle = cobGrad;

        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 3D Round Kernels
        for (let y = -22; y <= 22; y += 9) {
          for (let x = -9; x <= 9; x += 9) {
            const kGrad = ctx.createRadialGradient(x - 1, y - 1, 1, x, y, 3.5);
            kGrad.addColorStop(0, '#FFF59D');
            kGrad.addColorStop(1, '#E65100');
            ctx.fillStyle = kGrad;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Wraparound Husks
        ctx.fillStyle = '#43A047';
        ctx.beginPath();
        ctx.moveTo(-16, 20);
        ctx.quadraticCurveTo(-26, 0, -14, -24);
        ctx.quadraticCurveTo(-14, 12, -12, 30);
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'tomato': {
        // Spherical lighting gradient
        const tGrad = ctx.createRadialGradient(-8, -8, 4, 0, 2, 30);
        tGrad.addColorStop(0, '#FF5252');
        tGrad.addColorStop(0.6, '#D32F2F');
        tGrad.addColorStop(1, '#8E0000');
        ctx.fillStyle = tGrad;

        ctx.beginPath();
        ctx.arc(0, 2, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Curved highlight arc
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 2, 22, -Math.PI * 0.75, -Math.PI * 0.45);
        ctx.stroke();

        // Star calyx
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
          ctx.lineTo(Math.cos(a) * 12, -24 + Math.sin(a) * 10);
          ctx.lineTo(Math.cos(a + 0.6) * 4, -24 + Math.sin(a + 0.6) * 4);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'mushroom': {
        // Volumetric Poison Mushroom Dome
        const capGrad = ctx.createRadialGradient(-6, -18, 4, 0, -6, 32);
        capGrad.addColorStop(0, '#BA68C8');
        capGrad.addColorStop(0.6, '#6A1B9A');
        capGrad.addColorStop(1, '#38006B');
        ctx.fillStyle = capGrad;

        ctx.beginPath();
        ctx.arc(0, -6, 30, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Shaded Stem
        const stemGrad = ctx.createLinearGradient(-10, 0, 10, 0);
        stemGrad.addColorStop(0, '#BDBDBD');
        stemGrad.addColorStop(0.4, '#FAFAFA');
        stemGrad.addColorStop(1, '#757575');
        ctx.fillStyle = stemGrad;
        ctx.fillRect(-10, -6, 20, 28);
        ctx.strokeRect(-10, -6, 20, 28);

        // Skull Spots
        ctx.fillStyle = '#EDE7F6';
        ctx.beginPath();
        ctx.arc(-12, -18, 5, 0, Math.PI * 2);
        ctx.arc(12, -18, 5, 0, Math.PI * 2);
        ctx.arc(0, -10, 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  public renderParticles(particles: any[]): void {
    const ctx = this.ctx;
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  public renderSlashTrail(
    trail: { x: number; y: number; age: number }[],
    color: string = '#FFC904'
  ): void {
    if (trail.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const t1 = trail[i - 1];
      const t2 = trail[i];
      if (Math.hypot(t2.x - t1.x, t2.y - t1.y) < 160) {
        ctx.globalAlpha = Math.max(0, Math.min(1, t2.age));
        ctx.beginPath();
        ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  public renderFloatingTexts(texts: FloatingText[]): void {
    const ctx = this.ctx;
    for (const ft of texts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.translate(ft.x, ft.y);
      ctx.scale(-1, 1); // Un-mirror text for mirrored canvas
      ctx.font = '900 22px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }
  }

  public renderGestureMeter(progress: number, canvasWidth: number, canvasHeight: number): void {
    if (progress <= 0) return;
    const ctx = this.ctx;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const radius = 58;

    ctx.save();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#111111';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#FFC904';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}