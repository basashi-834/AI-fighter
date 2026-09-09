/**
 * 画面表示（体力ゲージ・時間・ゲージ・コンボ数）。
 *
 * 体力バーは 2 枚重ねです。手前が今の体力、奥がすこし遅れて追いつく赤いバー。
 * 「いま何点持っていかれたか」が目で分かるようにするための、格闘ゲームの定番です。
 */

import { METER_PER_BAR, VIEW_W } from '../engine/constants';
import type { Fighter } from '../engine/fighter';
import type { MatchState } from '../engine/match';
import { remainingSeconds } from '../engine/match';
import type { CharacterDef } from '../engine/types';

const BAR_W = 186;
const BAR_H = 14;
const BAR_Y = 14;

export class Hud {
  /** 遅れて追いつく赤いバーの値。 */
  private ghost: [number, number] = [1, 1];
  private comboShown: [number, number] = [0, 0];
  private comboTimer: [number, number] = [0, 0];

  update(s: MatchState): void {
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i];
      const ratio = Math.max(0, f.health / f.maxHealth);
      if (this.ghost[i] > ratio) this.ghost[i] = Math.max(ratio, this.ghost[i] - 0.006);
      else this.ghost[i] = ratio;

      const combo = s.fighters[1 - i].comboHits;
      if (combo >= 2) {
        this.comboShown[i] = combo;
        this.comboTimer[i] = 60;
      } else if (this.comboTimer[i] > 0) {
        this.comboTimer[i]--;
      }
    }
  }

  reset(): void {
    this.ghost = [1, 1];
    this.comboTimer = [0, 0];
  }

  draw(ctx: CanvasRenderingContext2D, s: MatchState, chars: [CharacterDef, CharacterDef]): void {
    for (let i = 0; i < 2; i++) {
      this.drawHealth(ctx, s.fighters[i], chars[i], i, s);
      this.drawMeter(ctx, s.fighters[i], i);
    }
    this.drawTimer(ctx, s);
    this.drawRoundMarks(ctx, s);
    for (let i = 0; i < 2; i++) this.drawCombo(ctx, i);
  }

  private drawHealth(
    ctx: CanvasRenderingContext2D,
    f: Fighter,
    char: CharacterDef,
    side: number,
    s: MatchState,
  ): void {
    const left = side === 0;
    const x = left ? 16 : VIEW_W - 16 - BAR_W;
    const ratio = Math.max(0, f.health / f.maxHealth);

    // 枠。
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4);

    // 減ったぶん（赤）。
    const gw = BAR_W * this.ghost[side];
    ctx.fillStyle = '#c02a3a';
    ctx.fillRect(left ? x : x + BAR_W - gw, BAR_Y, gw, BAR_H);

    // 今の体力。
    const w = BAR_W * ratio;
    const grad = ctx.createLinearGradient(0, BAR_Y, 0, BAR_Y + BAR_H);
    const danger = ratio < 0.25;
    grad.addColorStop(0, danger ? '#ffd36a' : '#8ff06a');
    grad.addColorStop(0.5, danger ? '#ffa93a' : '#4fc93a');
    grad.addColorStop(1, danger ? '#e06a1a' : '#2a8a24');
    ctx.fillStyle = grad;
    ctx.fillRect(left ? x : x + BAR_W - w, BAR_Y, w, BAR_H);

    // つや。
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(left ? x : x + BAR_W - w, BAR_Y, w, 3);

    // 名前。
    ctx.font = 'bold 10px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = left ? 'left' : 'right';
    ctx.fillText(char.nameJa, left ? x : x + BAR_W, BAR_Y + BAR_H + 11);
    void s;
  }

  private drawMeter(ctx: CanvasRenderingContext2D, f: Fighter, side: number): void {
    const left = side === 0;
    const w = 116;
    const h = 8;
    const y = 246;
    const x = left ? 16 : VIEW_W - 16 - w;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

    const segW = (w - 4) / 3;
    for (let i = 0; i < 3; i++) {
      const filled = Math.max(0, Math.min(1, (f.meter - i * METER_PER_BAR) / METER_PER_BAR));
      const sx = left ? x + i * (segW + 2) : x + w - (i + 1) * segW - i * 2;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(sx, y, segW, h);
      if (filled > 0) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        const full = filled >= 1;
        g.addColorStop(0, full ? '#a8f0ff' : '#6ec6ff');
        g.addColorStop(1, full ? '#2a8fd8' : '#1a5fa8');
        ctx.fillStyle = g;
        const fw = segW * filled;
        ctx.fillRect(left ? sx : sx + segW - fw, y, fw, h);
      }
    }
    // ゲージ本数の表示。
    const bars = Math.floor(f.meter / METER_PER_BAR);
    if (bars > 0) {
      ctx.font = 'bold 9px "Trebuchet MS", sans-serif';
      ctx.fillStyle = '#bfe9ff';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(`${bars}`, left ? x + w + 6 : x - 6, y + h);
    }
  }

  private drawTimer(ctx: CanvasRenderingContext2D, s: MatchState): void {
    const t = s.config.timeLimit > 0 ? remainingSeconds(s) : 99;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(VIEW_W / 2 - 24, BAR_Y - 4, 48, 30);
    ctx.fillStyle = t <= 10 ? '#ff6b6b' : '#ffffff';
    ctx.fillText(String(t).padStart(2, '0'), VIEW_W / 2, BAR_Y + 20);
    ctx.restore();
  }

  private drawRoundMarks(ctx: CanvasRenderingContext2D, s: MatchState): void {
    for (let i = 0; i < 2; i++) {
      const left = i === 0;
      // トレーニングなど「先取数がとても大きい」ときは丸を並べない。
      const marks = Math.min(s.config.roundsToWin, 5);
      for (let r = 0; r < marks; r++) {
        const x = left ? 18 + r * 12 : VIEW_W - 18 - r * 12;
        const y = BAR_Y + BAR_H + 18;
        const won = s.wins[i] > r;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = won ? '#ffd94a' : 'rgba(255,255,255,0.22)';
        ctx.fill();
        if (won) {
          ctx.strokeStyle = '#fff3b8';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  private drawCombo(ctx: CanvasRenderingContext2D, side: number): void {
    if (this.comboTimer[side] <= 0) return;
    const n = this.comboShown[side];
    if (n < 2) return;
    const left = side === 0;
    const x = left ? 30 : VIEW_W - 30;
    const y = 92;
    const t = Math.min(1, (60 - this.comboTimer[side]) / 6);
    const scale = 1 + (1 - t) * 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.textAlign = left ? 'left' : 'right';
    ctx.font = 'bold 24px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#ffd94a';
    ctx.strokeStyle = '#4a2a00';
    ctx.lineWidth = 3;
    ctx.strokeText(`${n}`, 0, 0);
    ctx.fillText(`${n}`, 0, 0);
    ctx.font = 'bold 11px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.strokeText('HITS', left ? 22 : -22, 0);
    ctx.fillText('HITS', left ? 22 : -22, 0);
    ctx.restore();
  }
}
