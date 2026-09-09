/**
 * 描画のまとめ役。
 *
 * シミュレーションの状態を受け取り、
 *   背景 → 飛び道具 → キャラクター → エフェクト → 画面表示
 * の順に重ねていきます。
 */

import { FLOOR_SCREEN_Y, VIEW_H, VIEW_W, toPx } from '../engine/constants';
import {
  currentMove,
  hitboxes,
  hurtboxes,
  pushbox,
  worldBox,
  type Fighter,
} from '../engine/fighter';
import type { MatchState, Projectile } from '../engine/match';
import type { CharacterDef } from '../engine/types';
import { Effects } from './effects';
import { drawFighter } from './fighterArt';
import { Hud } from './hud';
import { STAGES, drawStage, type StageDef } from './stage';

interface Ghost {
  f: Fighter;
  char: CharacterDef;
  life: number;
}

export class Renderer {
  effects = new Effects();
  hud = new Hud();
  stage: StageDef = STAGES[0];
  tick = 0;
  /** 当たり判定の表示。 */
  debug = false;
  /** 決着などの大きな文字。 */
  banner = '';
  bannerSub = '';
  bannerTimer = 0;
  private ghosts: Ghost[] = [];
  private lastEventFrame = -1;

  setStage(id: string): void {
    this.stage = STAGES.find((s) => s.id === id) ?? STAGES[0];
  }

  showBanner(text: string, sub = '', frames = 90): void {
    this.banner = text;
    this.bannerSub = sub;
    this.bannerTimer = frames;
  }

  /** シミュレーションの出来事を演出に流す。同じフレームを二度流さない。 */
  consume(s: MatchState, chars: [CharacterDef, CharacterDef]): void {
    // ロールバックで同じフレームをやり直したときに、演出が二重に出ないようにする。
    if (s.frame <= this.lastEventFrame) return;
    this.lastEventFrame = s.frame;
    this.effects.consume(s.events);
    for (const e of s.events) {
      if (e.type === 'land') {
        this.effects.dustAt(toPx(s.fighters[e.side].x), e.hard ? 9 : 4);
      } else if (e.type === 'dash') {
        this.effects.dustAt(toPx(s.fighters[e.side].x), 6);
      } else if (e.type === 'ko') {
        this.showBanner('K.O.', '', 120);
      } else if (e.type === 'roundStart') {
        this.hud.reset();
      }
    }
    // 残像（ダッシュ中・超必殺技中）。
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i];
      const m = currentMove(f, chars[i]);
      const fast = f.state === 'dash' || f.state === 'backdash' || (m?.meterCost ?? 0) >= 1000;
      if (fast && s.frame % 2 === 0) {
        this.ghosts.push({ f: { ...f }, char: chars[i], life: 10 });
      }
    }
    for (const g of this.ghosts) g.life--;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
  }

  update(s: MatchState): void {
    this.tick++;
    this.effects.update();
    this.hud.update(s);
    if (this.bannerTimer > 0) this.bannerTimer--;
  }

  render(ctx: CanvasRenderingContext2D, s: MatchState, chars: [CharacterDef, CharacterDef]): void {
    const cam = s.cameraX;
    ctx.save();
    ctx.translate(Math.round(this.effects.shakeX), Math.round(this.effects.shakeY));

    drawStage(ctx, this.stage, cam, this.tick);

    // 超必殺技の暗転中は背景を暗くする。
    const freezing = s.fighters[0].freeze > 0 || s.fighters[1].freeze > 0;
    if (freezing) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40);
      drawSpeedLines(ctx, this.tick);
    }

    for (const p of s.projectiles) this.drawProjectile(ctx, p, cam);

    // 残像。
    for (const g of this.ghosts) {
      drawFighter(ctx, g.f, g.char, cam, VIEW_W, this.tick, {
        ghost: true,
        alpha: (g.life / 10) * 0.28,
        tint: '#9fd8ff',
      });
    }

    // 手前に描くのは「攻撃している側」。技が見えなくなるのを防ぐ。
    const order = s.fighters[0].state === 'attack' && s.fighters[1].state !== 'attack' ? [1, 0] : [0, 1];
    for (const i of order) {
      const f = s.fighters[i];
      const flash = f.hitstop > 0 && (f.state === 'hitstun' || f.state === 'blockstun') ? (this.tick % 2 === 0 ? 1 : 0) : 0;
      const dim = freezing && f.freeze > 0 ? 0.55 : 1;
      drawFighter(ctx, f, chars[i], cam, VIEW_W, this.tick, { flash, alpha: dim });
      if (f.state === 'dizzy') this.drawDizzyStars(ctx, f, cam);
    }

    this.effects.draw(ctx, cam, VIEW_W);

    if (this.debug) this.drawBoxes(ctx, s, chars, cam);

    // 白い閃光。
    if (this.effects.flash > 0) {
      ctx.globalAlpha = this.effects.flash * 0.8;
      ctx.fillStyle = this.effects.flashColor;
      ctx.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    this.hud.draw(ctx, s, chars);
    this.drawPhaseText(ctx, s);
    this.drawBanner(ctx);
    if (this.debug) this.drawDebugText(ctx, s, chars);
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile, cam: number): void {
    const x = toPx(p.x) - cam + VIEW_W / 2;
    const y = FLOOR_SCREEN_Y - toPx(p.y);
    const t = this.tick;
    ctx.save();
    if (p.style === 'wave') {
      const g = ctx.createRadialGradient(x, y, 4, x, y, 34);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.3, '#9fe6ff');
      g.addColorStop(0.7, '#3aa0ff');
      g.addColorStop(1, 'rgba(40,120,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, 34 + Math.sin(t * 0.4) * 3, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x - (p.facingRight ? 20 : -20), y, 14, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.style === 'orb') {
      const g = ctx.createRadialGradient(x, y, 2, x, y, 20);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, '#c0a0ff');
      g.addColorStop(1, 'rgba(120,60,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 20 + Math.sin(t * 0.5) * 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createRadialGradient(x, y, 2, x, y, 16);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#9fd8ff');
      g.addColorStop(1, 'rgba(60,150,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 16 + Math.sin(t * 0.6) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      // 尾。
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#7ec8ff';
      ctx.beginPath();
      ctx.ellipse(x - (p.facingRight ? 12 : -12), y, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawDizzyStars(ctx: CanvasRenderingContext2D, f: Fighter, cam: number): void {
    const x = toPx(f.x) - cam + VIEW_W / 2;
    const y = FLOOR_SCREEN_Y - toPx(f.y) - 108;
    for (let i = 0; i < 3; i++) {
      const a = this.tick * 0.12 + (i * Math.PI * 2) / 3;
      ctx.fillStyle = '#ffe36a';
      const sx = x + Math.cos(a) * 16;
      const sy = y + Math.sin(a) * 5;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBoxes(
    ctx: CanvasRenderingContext2D,
    s: MatchState,
    chars: [CharacterDef, CharacterDef],
    cam: number,
  ): void {
    const rect = (b: { l: number; r: number; b: number; t: number }, color: string) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color.replace('1)', '0.22)');
      ctx.lineWidth = 1;
      const x = b.l - cam + VIEW_W / 2;
      const y = FLOOR_SCREEN_Y - b.t;
      ctx.fillRect(x, y, b.r - b.l, b.t - b.b);
      ctx.strokeRect(x + 0.5, y + 0.5, b.r - b.l - 1, b.t - b.b - 1);
    };
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i];
      rect(worldBox(f, pushbox(f, chars[i])), 'rgba(90,160,255,1)');
      for (const h of hurtboxes(f, chars[i])) rect(worldBox(f, h), 'rgba(80,220,120,1)');
      for (const h of hitboxes(f, chars[i])) rect(worldBox(f, h), 'rgba(255,70,70,1)');
    }
  }

  private drawDebugText(
    ctx: CanvasRenderingContext2D,
    s: MatchState,
    chars: [CharacterDef, CharacterDef],
  ): void {
    ctx.save();
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i];
      const m = currentMove(f, chars[i]);
      const x = i === 0 ? 16 : VIEW_W - 150;
      let y = 200;
      const lines = [
        `${f.state} ${f.stateFrame}/${f.stateDuration}`,
        m ? `${m.nameJa} ${f.moveFrame}F` : '',
        m ? `発生${m.startup} 持続${m.active} 硬直${m.recovery}` : '',
        m ? `ヒット${m.hit.hitAdvantage >= 0 ? '+' : ''}${m.hit.hitAdvantage} ガード${m.hit.blockAdvantage}` : '',
        `x=${toPx(f.x)} y=${toPx(f.y)} stop=${f.hitstop}`,
      ];
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 3, y - 9, 140, lines.filter(Boolean).length * 11 + 4);
      ctx.fillStyle = '#9ff0a0';
      for (const l of lines) {
        if (!l) continue;
        ctx.fillText(l, x, y);
        y += 11;
      }
    }
    const d = Math.abs(toPx(s.fighters[0].x) - toPx(s.fighters[1].x));
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`距離 ${d}px`, VIEW_W / 2, 196);
    ctx.restore();
  }

  private drawPhaseText(ctx: CanvasRenderingContext2D, s: MatchState): void {
    ctx.save();
    ctx.textAlign = 'center';
    if (s.phase === 'intro') {
      const t = s.phaseFrame;
      if (t < 60) {
        bigText(ctx, `ROUND ${s.round}`, VIEW_W / 2, 118, 34, '#ffffff', '#8a2a2a');
      } else {
        const scale = 1 + Math.max(0, (75 - t) / 15) * 0.8;
        ctx.save();
        ctx.translate(VIEW_W / 2, 118);
        ctx.scale(scale, scale);
        bigText(ctx, 'FIGHT!', 0, 0, 38, '#ffd94a', '#7a2a00');
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D): void {
    if (this.bannerTimer <= 0 || !this.banner) return;
    ctx.save();
    ctx.textAlign = 'center';
    const t = this.bannerTimer;
    const pop = Math.min(1, (90 - t) / 8);
    ctx.translate(VIEW_W / 2, 112);
    ctx.scale(1 + (1 - pop) * 1.2, 1 + (1 - pop) * 1.2);
    bigText(ctx, this.banner, 0, 0, 42, '#ffffff', '#a01a2a');
    if (this.bannerSub) {
      ctx.font = 'bold 14px "Noto Sans JP", sans-serif';
      ctx.fillStyle = '#ffe8a0';
      ctx.fillText(this.bannerSub, 0, 26);
    }
    ctx.restore();
  }
}

export function bigText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke: string,
): void {
  ctx.font = `bold ${size}px "Trebuchet MS", "Noto Sans JP", sans-serif`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.18;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawSpeedLines(ctx: CanvasRenderingContext2D, tick: number): void {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = ((i * 37 + tick * 9) % (VIEW_H + 40)) - 20;
    const w = 30 + ((i * 53) % 90);
    const x = (i % 2 === 0 ? 0 : VIEW_W - w) + ((tick * 3) % 20);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }
  ctx.restore();
}
