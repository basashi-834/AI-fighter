/**
 * 演出（エフェクト）。
 *
 * ここに入っているものは試合の結果に一切影響しません。
 * シミュレーションが出した「出来事（SimEvent）」を受け取って、
 * 火花を出したり画面を揺らしたりするだけの層です。
 * こう分けておくと、巻き戻しても演出だけが二重に出る、という事故を防げます。
 */

import { FLOOR_SCREEN_Y } from '../engine/constants';
import type { SimEvent } from '../engine/match';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'spark' | 'dust' | 'ring' | 'shard' | 'star' | 'text';
  gravity: number;
  text?: string;
  rot?: number;
}

const HIT_COLORS: Record<string, string[]> = {
  light: ['#fff8d0', '#ffd766', '#ffae3a'],
  medium: ['#ffffff', '#ffd05a', '#ff8f3a'],
  heavy: ['#ffffff', '#ffe07a', '#ff5b3a'],
  slash: ['#eafcff', '#8fe6ff', '#4aa8ff'],
  burn: ['#fff0c0', '#ffb24a', '#ff5a2a'],
};

export class Effects {
  particles: Particle[] = [];
  /** 画面の揺れ。 */
  shakeX = 0;
  shakeY = 0;
  private shakePower = 0;
  /** 白い閃光（超必殺技の暗転など）。 */
  flash = 0;
  flashColor = '#ffffff';
  /** 決着のときの暗転。 */
  vignette = 0;
  private tick = 0;

  clear(): void {
    this.particles.length = 0;
    this.shakePower = 0;
    this.flash = 0;
    this.vignette = 0;
  }

  private add(p: Partial<Particle> & { x: number; y: number }): void {
    this.particles.push({
      vx: 0,
      vy: 0,
      life: 20,
      maxLife: 20,
      size: 3,
      color: '#fff',
      kind: 'spark',
      gravity: 0,
      ...p,
    });
  }

  /** シミュレーションの出来事を受け取る。 */
  consume(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          this.hit(e.x, e.y, e.props.effect, e.props.shake, e.counter);
          break;
        case 'block':
          this.block(e.x, e.y);
          break;
        case 'armor':
          this.armor(e.x, e.y);
          break;
        case 'throw':
          this.shakePower = Math.max(this.shakePower, 5);
          break;
        case 'throwTech':
          this.ring(e.x, e.y, '#ffffff', 26);
          break;
        case 'clash':
          this.clash(e.x, e.y);
          break;
        case 'land':
          // 位置は呼び出し側が dustAt で足す（イベントには座標が無い）。
          if (e.hard) this.shakePower = Math.max(this.shakePower, 2);
          break;
        case 'superFlash':
          this.flash = 1;
          this.flashColor = '#ffffff';
          this.shakePower = Math.max(this.shakePower, 6);
          break;
        case 'ko':
          this.shakePower = 14;
          this.flash = 0.85;
          this.flashColor = '#ffdcdc';
          break;
        case 'dizzy':
          break;
        default:
          break;
      }
    }
  }

  /** 着地・ダッシュの土煙。座標は画面座標ではなくワールド x。 */
  dustAt(worldX: number, amount: number): void {
    this.dust(worldX, 0, amount);
  }

  private dust(x: number, y: number, amount: number): void {
    for (let i = 0; i < amount; i++) {
      const a = (Math.random() - 0.5) * Math.PI;
      this.add({
        x: x + (Math.random() - 0.5) * 14,
        y: y,
        vx: Math.cos(a) * (0.6 + Math.random() * 1.4),
        vy: -Math.random() * 1.2,
        life: 16 + Math.random() * 10,
        maxLife: 26,
        size: 2 + Math.random() * 3,
        color: '#cfc4ae',
        kind: 'dust',
        gravity: -0.02,
      });
    }
  }

  private hit(x: number, y: number, effect: string, shake: number, counter: boolean): void {
    const colors = HIT_COLORS[effect] ?? HIT_COLORS.medium;
    const n = effect === 'heavy' || effect === 'burn' ? 18 : effect === 'light' ? 9 : 13;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.4 + Math.random() * (effect === 'heavy' ? 5.5 : 3.4);
      this.add({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.6,
        life: 10 + Math.random() * 12,
        maxLife: 22,
        size: 1.5 + Math.random() * 2.6,
        color: colors[i % colors.length],
        kind: 'spark',
        gravity: 0.12,
      });
    }
    this.ring(x, y, colors[0], effect === 'heavy' ? 34 : 22);
    if (counter) {
      this.ring(x, y, '#ff4d6d', 44);
      this.add({
        x,
        y: y + 14,
        vx: 0,
        vy: -0.5,
        life: 34,
        maxLife: 34,
        size: 10,
        color: '#ff4d6d',
        kind: 'text',
        text: 'COUNTER',
        gravity: 0,
      });
    }
    this.shakePower = Math.max(this.shakePower, shake);
  }

  private block(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      this.add({
        x,
        y,
        vx: Math.cos(a) * 2.2,
        vy: Math.sin(a) * 2.2,
        life: 9 + Math.random() * 7,
        maxLife: 16,
        size: 1.4 + Math.random() * 1.6,
        color: '#bfe4ff',
        kind: 'shard',
        gravity: 0.08,
      });
    }
    this.ring(x, y, '#8fd0ff', 18);
    this.shakePower = Math.max(this.shakePower, 2);
  }

  private armor(x: number, y: number): void {
    this.ring(x, y, '#ffd76a', 34);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        x, y,
        vx: Math.cos(a) * 2.6,
        vy: Math.sin(a) * 2.6,
        life: 14, maxLife: 14, size: 2.4,
        color: '#ffd76a', kind: 'shard', gravity: 0.05,
      });
    }
    this.shakePower = Math.max(this.shakePower, 5);
  }

  private clash(x: number, y: number): void {
    this.ring(x, y, '#ffffff', 30);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        x, y,
        vx: Math.cos(a) * 3.4,
        vy: Math.sin(a) * 3.4,
        life: 16, maxLife: 16, size: 2,
        color: i % 2 ? '#ffffff' : '#9fd8ff', kind: 'spark', gravity: 0.1,
      });
    }
    this.shakePower = Math.max(this.shakePower, 4);
  }

  ring(x: number, y: number, color: string, size: number): void {
    this.add({ x, y, life: 12, maxLife: 12, size, color, kind: 'ring' });
  }

  /** 残像や余韻の星（ダウン・気絶）。 */
  star(x: number, y: number, color = '#ffe36a'): void {
    this.add({ x, y, life: 26, maxLife: 26, size: 4, color, kind: 'star', gravity: -0.02, vy: -0.4 });
  }

  update(): void {
    this.tick++;
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.96;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    if (this.shakePower > 0.2) {
      this.shakeX = (Math.random() - 0.5) * this.shakePower * 2;
      this.shakeY = (Math.random() - 0.5) * this.shakePower * 1.4;
      this.shakePower *= 0.78;
    } else {
      this.shakePower = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.09);
  }

  /** ワールド座標で描く（カメラ変換は呼び出し側で済ませてある前提）。 */
  draw(ctx: CanvasRenderingContext2D, cameraX: number, viewW: number): void {
    ctx.save();
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      const sx = p.x - cameraX + viewW / 2;
      const sy = FLOOR_SCREEN_Y - p.y;
      ctx.globalAlpha = Math.max(0, Math.min(1, t));
      switch (p.kind) {
        case 'ring': {
          const r = p.size * (1.35 - t);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, 3 * t);
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'text': {
          ctx.fillStyle = p.color;
          ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.text ?? '', sx, sy - (1 - t) * 16);
          break;
        }
        case 'star': {
          ctx.fillStyle = p.color;
          drawStar(ctx, sx, sy, p.size * t + 1, 5);
          break;
        }
        case 'dust': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(sx, sy, p.size * t, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default: {
          ctx.fillStyle = p.color;
          const s = p.size * (0.5 + t * 0.9);
          ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
          break;
        }
      }
    }
    ctx.restore();
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px2 = x + Math.cos(a) * rad;
    const py2 = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px2, py2);
    else ctx.lineTo(px2, py2);
  }
  ctx.closePath();
  ctx.fill();
}
