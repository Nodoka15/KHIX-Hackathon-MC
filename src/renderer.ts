import { Target, SlicedHalf, SlashParticle } from './game';

export class VegiRenderer {
  constructor(private ctx: CanvasRenderingContext2D) {}

  public renderSword(tipX: number, tipY: number, angle: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(angle);

    // Flat Matte Knight Broadsword
    // Blade
    ctx.fillStyle = '#FFC904';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.moveTo(0, 0); // Fingertip is blade tip
    ctx.lineTo(9, -70);
    ctx.lineTo(6, -90);
    ctx.lineTo(-6, -90);
    ctx.lineTo(-9, -70);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Central blade fuller ridge
    ctx.strokeStyle = '#BA9B37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, -85);
    ctx.stroke();

    // Crossguard
    ctx.fillStyle = '#111111';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.fillRect(-22, -94, 44, 8);
    ctx.strokeRect(-22, -94, 44, 8);

    // Hilt / Pommel
    ctx.fillStyle = '#FFC904';
    ctx.fillRect(-4, -114, 8, 20);
    ctx.beginPath();
    ctx.arc(0, -118, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  public renderKnightroHelmet(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
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

    // Visor Grille
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(-scaleW * 0.35, -scaleH * 0.08);
    ctx.lineTo(scaleW * 0.35, -scaleH * 0.08);
    ctx.lineTo(scaleW * 0.28, scaleH * 0.12);
    ctx.lineTo(-scaleW * 0.28, scaleH * 0.12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FFC904';
    for (let offset = -0.22; offset <= 0.22; offset += 0.09) {
      ctx.fillRect(offset * scaleW - 3, -scaleH * 0.08, 6, scaleH * 0.2);
    }

    ctx.restore();
  }

  public renderTarget(item: Target): void {
    const ctx = this.ctx;
    if (!item.sliced) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rotation);
      this.drawVegetableModel(item.type);
      ctx.restore();
    } else if (item.splitPieces) {
      for (const half of item.splitPieces) {
        ctx.save();
        ctx.translate(half.x, half.y);
        ctx.rotate(half.rotation);

        // Clip along slice plane
        ctx.beginPath();
        const clipDist = 120;
        ctx.rect(half.side === -1 ? -clipDist : 0, -clipDist, clipDist, clipDist * 2);
        ctx.clip();

        this.drawVegetableModel(item.type);
        ctx.restore();
      }
    }
  }

  private drawVegetableModel(type: Target['type']): void {
    const ctx = this.ctx;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';

    switch (type) {
      case 'carrot':
        // Conical body
        ctx.fillStyle = '#FF7A00';
        ctx.beginPath();
        ctx.moveTo(0, 38);
        ctx.lineTo(16, -24);
        ctx.quadraticCurveTo(0, -32, -16, -24);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Rib marks
        ctx.strokeStyle = '#D95E00';
        for (const y of [-10, 4, 18]) {
          ctx.beginPath();
          ctx.moveTo(-7, y);
          ctx.lineTo(7, y);
          ctx.stroke();
        }

        // Green leaves
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        ctx.ellipse(-8, -36, 5, 14, -0.3, 0, Math.PI * 2);
        ctx.ellipse(0, -40, 5, 16, 0, 0, Math.PI * 2);
        ctx.ellipse(8, -36, 5, 14, 0.3, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'eggplant':
        // Teardrop bulb
        ctx.fillStyle = '#4A154B';
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.bezierCurveTo(24, -20, 34, 18, 0, 36);
        ctx.bezierCurveTo(-34, 18, -24, -20, 0, -26);
        ctx.fill();
        ctx.stroke();

        // Calyx top
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

      case 'broccoli':
        // Stalk
        ctx.fillStyle = '#81C784';
        ctx.fillRect(-10, 4, 20, 28);
        ctx.strokeRect(-10, 4, 20, 28);

        // Flory clusters
        ctx.fillStyle = '#1B5E20';
        ctx.beginPath();
        ctx.arc(-16, -6, 16, 0, Math.PI * 2);
        ctx.arc(0, -18, 20, 0, Math.PI * 2);
        ctx.arc(16, -6, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;

      case 'corn':
        // Cob
        ctx.fillStyle = '#FDD835';
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Kernels pattern
        ctx.fillStyle = '#F57F17';
        for (let y = -20; y <= 20; y += 10) {
          for (let x = -8; x <= 8; x += 8) {
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Husks
        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        ctx.moveTo(-16, 18);
        ctx.quadraticCurveTo(-24, 0, -12, -26);
        ctx.quadraticCurveTo(-14, 10, -12, 28);
        ctx.fill();
        break;

      case 'tomato':
        // Round bulb with top notch
        ctx.fillStyle = '#E53935';
        ctx.beginPath();
        ctx.arc(0, 2, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 5-Point Calyx
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

      case 'mushroom':
        // Poison Mushroom Cap
        ctx.fillStyle = '#7B1FA2';
        ctx.beginPath();
        ctx.arc(0, -6, 30, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Skull Spots
        ctx.fillStyle = '#E1BEE7';
        ctx.beginPath();
        ctx.arc(-12, -18, 5, 0, Math.PI * 2);
        ctx.arc(12, -18, 5, 0, Math.PI * 2);
        ctx.arc(0, -10, 4, 0, Math.PI * 2);
        ctx.fill();

        // Bone-white stem
        ctx.fillStyle = '#EEEEEE';
        ctx.fillRect(-10, -6, 20, 28);
        ctx.strokeRect(-10, -6, 20, 28);
        break;
    }
  }

  public renderParticles(particles: SlashParticle[]): void {
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

  public renderGestureMeter(progress: number, canvasWidth: number, canvasHeight: number): void {
    if (progress <= 0) return;
    const ctx = this.ctx;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const radius = 58;

    ctx.save();
    // Dark backdrop ring
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#111111';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Charging Gold Meter
    ctx.strokeStyle = '#FFC904';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}