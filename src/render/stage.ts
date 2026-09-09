/**
 * ステージの背景。
 *
 * カメラの動きに合わせて、奥のものはゆっくり、手前のものは速く流します
 * （多重スクロール）。これがあるだけで奥行きの感じがまるで変わります。
 */

import { FLOOR_SCREEN_Y, STAGE_HALF, VIEW_H, VIEW_W } from '../engine/constants';

export interface StageDef {
  id: string;
  name: string;
  nameJa: string;
  sky: [string, string, string];
  ground: string;
  groundDark: string;
  accent: string;
  kind: 'dojo' | 'shrine' | 'rooftop';
}

export const STAGES: StageDef[] = [
  {
    id: 'dojo',
    name: 'Sunset Dojo',
    nameJa: '夕暮れの道場',
    sky: ['#2b1b3d', '#7d3550', '#e08a4e'],
    ground: '#6b4a33',
    groundDark: '#4a3122',
    accent: '#f0c26b',
    kind: 'dojo',
  },
  {
    id: 'shrine',
    name: 'Night Shrine',
    nameJa: '夜の神社',
    sky: ['#070a1e', '#131b40', '#2c3a6b'],
    ground: '#2f3350',
    groundDark: '#1d2039',
    accent: '#e2555f',
    kind: 'shrine',
  },
  {
    id: 'rooftop',
    name: 'Neon Rooftop',
    nameJa: 'ネオンの屋上',
    sky: ['#120a26', '#3a1350', '#7a2b6b'],
    ground: '#242433',
    groundDark: '#171722',
    accent: '#4ce0d0',
    kind: 'rooftop',
  },
];

function px(v: number): number {
  return Math.round(v);
}

export function drawStage(
  ctx: CanvasRenderingContext2D,
  stage: StageDef,
  cameraX: number,
  tick: number,
): void {
  // 空。
  const g = ctx.createLinearGradient(0, 0, 0, FLOOR_SCREEN_Y);
  g.addColorStop(0, stage.sky[0]);
  g.addColorStop(0.55, stage.sky[1]);
  g.addColorStop(1, stage.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (stage.kind === 'shrine' || stage.kind === 'rooftop') drawStars(ctx, cameraX, tick, stage);
  if (stage.kind === 'dojo') drawSun(ctx, cameraX);

  drawFarLayer(ctx, stage, cameraX);
  drawMidLayer(ctx, stage, cameraX, tick);
  drawGround(ctx, stage, cameraX);
  drawWalls(ctx, stage, cameraX);
}

function drawStars(ctx: CanvasRenderingContext2D, cameraX: number, tick: number, stage: StageDef): void {
  const ox = -cameraX * 0.06;
  ctx.save();
  for (let i = 0; i < 60; i++) {
    const x = ((i * 97) % 720) + ox;
    const y = (i * 53) % 110;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(tick * 0.02 + i));
    ctx.globalAlpha = tw;
    ctx.fillStyle = i % 9 === 0 ? stage.accent : '#ffffff';
    ctx.fillRect(px(x % (VIEW_W + 40)) - 20, px(y), 1, 1);
  }
  ctx.restore();
}

function drawSun(ctx: CanvasRenderingContext2D, cameraX: number): void {
  const x = VIEW_W / 2 - cameraX * 0.05;
  ctx.save();
  ctx.globalAlpha = 0.85;
  const g = ctx.createRadialGradient(x, 120, 6, x, 120, 70);
  g.addColorStop(0, '#ffe9a8');
  g.addColorStop(0.4, '#ffb45e');
  g.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, 120, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 遠景（山なみ・ビル）。 */
function drawFarLayer(ctx: CanvasRenderingContext2D, stage: StageDef, cameraX: number): void {
  const ox = -cameraX * 0.12;
  ctx.save();
  if (stage.kind === 'rooftop') {
    ctx.fillStyle = 'rgba(20,12,40,0.85)';
    for (let i = -2; i < 14; i++) {
      const bx = px(i * 62 + ox);
      const h = 40 + ((i * 37) % 70);
      ctx.fillRect(bx, FLOOR_SCREEN_Y - 40 - h, 48, h + 40);
    }
    // 窓明かり。
    for (let i = -2; i < 14; i++) {
      const bx = px(i * 62 + ox);
      const h = 40 + ((i * 37) % 70);
      for (let r = 0; r < Math.floor(h / 14); r++) {
        for (let c = 0; c < 3; c++) {
          if ((i * 7 + r * 3 + c) % 4 === 0) {
            ctx.fillStyle = c % 2 ? '#ffd98a' : '#8ff0ff';
            ctx.fillRect(bx + 8 + c * 13, FLOOR_SCREEN_Y - 36 - h + r * 14, 6, 7);
          }
        }
      }
    }
  } else {
    ctx.fillStyle = 'rgba(30,20,45,0.7)';
    ctx.beginPath();
    ctx.moveTo(-40, FLOOR_SCREEN_Y - 20);
    for (let i = -1; i < 10; i++) {
      const bx = i * 110 + ox;
      ctx.lineTo(bx, FLOOR_SCREEN_Y - 20 - (i % 3 === 0 ? 96 : i % 3 === 1 ? 64 : 78));
      ctx.lineTo(bx + 55, FLOOR_SCREEN_Y - 20);
    }
    ctx.lineTo(VIEW_W + 60, FLOOR_SCREEN_Y);
    ctx.lineTo(-60, FLOOR_SCREEN_Y);
    ctx.fill();
  }
  ctx.restore();
}

/** 中景（建物・鳥居・提灯）。 */
function drawMidLayer(ctx: CanvasRenderingContext2D, stage: StageDef, cameraX: number, tick: number): void {
  const ox = -cameraX * 0.35;
  ctx.save();
  if (stage.kind === 'dojo') {
    // 道場の壁と屋根。
    ctx.fillStyle = '#3d2b1f';
    ctx.fillRect(-100 + ox, FLOOR_SCREEN_Y - 108, 1200, 88);
    ctx.fillStyle = '#57402c';
    for (let i = 0; i < 16; i++) {
      const x = px(-100 + ox + i * 76);
      ctx.fillStyle = '#d9c9a8';
      ctx.fillRect(x + 8, FLOOR_SCREEN_Y - 100, 58, 60);
      ctx.strokeStyle = '#3d2b1f';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 8, FLOOR_SCREEN_Y - 100, 58, 60);
      ctx.beginPath();
      ctx.moveTo(x + 37, FLOOR_SCREEN_Y - 100);
      ctx.lineTo(x + 37, FLOOR_SCREEN_Y - 40);
      ctx.stroke();
    }
    // 屋根。
    ctx.fillStyle = '#2a1b12';
    ctx.beginPath();
    ctx.moveTo(-120 + ox, FLOOR_SCREEN_Y - 108);
    ctx.lineTo(1220 + ox, FLOOR_SCREEN_Y - 108);
    ctx.lineTo(1200 + ox, FLOOR_SCREEN_Y - 126);
    ctx.lineTo(-100 + ox, FLOOR_SCREEN_Y - 126);
    ctx.fill();
  } else if (stage.kind === 'shrine') {
    // 鳥居を並べる。
    for (let i = -1; i < 8; i++) {
      const x = px(i * 150 + ox);
      ctx.fillStyle = '#8f2230';
      ctx.fillRect(x, FLOOR_SCREEN_Y - 96, 8, 96);
      ctx.fillRect(x + 78, FLOOR_SCREEN_Y - 96, 8, 96);
      ctx.fillRect(x - 12, FLOOR_SCREEN_Y - 100, 110, 8);
      ctx.fillRect(x - 6, FLOOR_SCREEN_Y - 84, 98, 6);
    }
    // 提灯。
    for (let i = -1; i < 12; i++) {
      const x = px(i * 96 + ox + 40);
      const sway = Math.sin(tick * 0.03 + i) * 2;
      ctx.fillStyle = '#e2555f';
      ctx.beginPath();
      ctx.ellipse(x + sway, FLOOR_SCREEN_Y - 128, 7, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd9a0';
      ctx.fillRect(x + sway - 5, FLOOR_SCREEN_Y - 130, 10, 3);
    }
  } else {
    // 屋上のネオン看板。
    const signs = ['拳', '龍', '闘', '風'];
    for (let i = -1; i < 8; i++) {
      const x = px(i * 160 + ox);
      const on = (Math.floor(tick / 20) + i) % 5 !== 0;
      ctx.globalAlpha = on ? 1 : 0.35;
      ctx.fillStyle = i % 2 ? '#4ce0d0' : '#ff5f9e';
      ctx.fillRect(x, FLOOR_SCREEN_Y - 150, 4, 60);
      ctx.font = 'bold 26px "Noto Sans JP", sans-serif';
      ctx.fillText(signs[((i % 4) + 4) % 4], x + 10, FLOOR_SCREEN_Y - 112);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D, stage: StageDef, cameraX: number): void {
  ctx.fillStyle = stage.ground;
  ctx.fillRect(0, FLOOR_SCREEN_Y, VIEW_W, VIEW_H - FLOOR_SCREEN_Y);
  // 床の板目（手前ほど間隔が広い）。
  ctx.strokeStyle = stage.groundDark;
  ctx.lineWidth = 1;
  const ox = -cameraX;
  for (let i = -20; i < 60; i++) {
    const x = px(i * 40 + ox + VIEW_W / 2);
    ctx.beginPath();
    ctx.moveTo(x, FLOOR_SCREEN_Y);
    ctx.lineTo(x + (x - VIEW_W / 2) * 0.35, VIEW_H);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, FLOOR_SCREEN_Y, VIEW_W, 3);
  ctx.fillStyle = stage.accent;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, FLOOR_SCREEN_Y, VIEW_W, 1);
  ctx.globalAlpha = 1;
}

/** ステージの端（壁）。ここまで押し込むと画面端になる。 */
function drawWalls(ctx: CanvasRenderingContext2D, stage: StageDef, cameraX: number): void {
  const left = -STAGE_HALF - cameraX + VIEW_W / 2;
  const right = STAGE_HALF - cameraX + VIEW_W / 2;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = stage.groundDark;
  if (left > -40) ctx.fillRect(left - 40, 0, 40, VIEW_H);
  if (right < VIEW_W + 40) ctx.fillRect(right, 0, 40, VIEW_H);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = stage.accent;
  if (left > -40) ctx.fillRect(left - 2, 0, 2, VIEW_H);
  if (right < VIEW_W + 40) ctx.fillRect(right, 0, 2, VIEW_H);
  ctx.restore();
}
