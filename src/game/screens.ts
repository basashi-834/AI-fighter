/**
 * 試合以外の画面（タイトル・キャラクター選択・設定など）。
 */

import { ROSTER } from '../data';
import { FLOOR_SCREEN_Y, VIEW_H, VIEW_W, px } from '../engine/constants';
import { createFighter, type Fighter } from '../engine/fighter';
import { ALL_BUTTONS, BUTTON_BITS, inputAt, toNumpad } from '../engine/input';
import type { MatchState } from '../engine/match';
import type { CharacterDef } from '../engine/types';
import { drawFighter } from '../render/fighterArt';
import { bigText } from '../render/renderer';
import type { StageDef } from '../render/stage';
import { STAGES, drawStage } from '../render/stage';
import { PAUSE_ITEMS, type Settings, type SelectState } from './app';

/** 画面に立たせるだけの、飾り用ファイター。 */
function dummyFighter(charIndex: number, side: number, x: number, state: Fighter['state'] = 'idle'): Fighter {
  const f = createFighter(charIndex, side, ROSTER[charIndex], px(x));
  f.facingRight = side === 0;
  f.state = state;
  return f;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.66): void {
  ctx.fillStyle = `rgba(6,8,18,${alpha})`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/* ------------------------------------------------------------------ */

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  tick: number,
  items: { id: string; label: string; sub: string }[],
  index: number,
): void {
  drawStage(ctx, STAGES[0], Math.sin(tick * 0.004) * 60, tick);
  ctx.fillStyle = 'rgba(4,4,12,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 背後に 2 人立たせる。
  const a = dummyFighter(0, 0, -110);
  const b = dummyFighter(1, 1, 110);
  drawFighter(ctx, a, ROSTER[0], 0, VIEW_W, tick, { alpha: 0.5 });
  drawFighter(ctx, b, ROSTER[1], 0, VIEW_W, tick, { alpha: 0.5 });
  ctx.fillStyle = 'rgba(4,4,12,0.35)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  const bob = Math.sin(tick * 0.05) * 2;
  bigText(ctx, 'AI FIGHTER', VIEW_W / 2, 46 + bob, 38, '#ffd94a', '#7a1020');
  ctx.font = 'bold 10px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#e8e8f0';
  ctx.fillText('２Ｄ 対戦格闘ゲーム', VIEW_W / 2, 61 + bob);

  const top = 84;
  const step = 21;
  // 背後のキャラクターと文字が重なって読みにくくなるので、下敷きを敷く。
  ctx.fillStyle = 'rgba(6,8,18,0.82)';
  ctx.fillRect(VIEW_W / 2 - 124, top - 16, 248, items.length * step + 8);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.strokeRect(VIEW_W / 2 - 123.5, top - 15.5, 247, items.length * step + 7);

  for (let i = 0; i < items.length; i++) {
    const y = top + i * step;
    const on = i === index;
    if (on) {
      ctx.fillStyle = 'rgba(255,217,74,0.18)';
      ctx.fillRect(VIEW_W / 2 - 120, y - 12, 240, 18);
      ctx.fillStyle = '#ffd94a';
      ctx.font = 'bold 11px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('▶', VIEW_W / 2 - 102, y + 1);
    }
    ctx.textAlign = 'left';
    ctx.font = `bold ${on ? 14 : 12}px "Noto Sans JP", sans-serif`;
    ctx.fillStyle = on ? '#ffffff' : 'rgba(230,230,240,0.6)';
    ctx.fillText(items[i].label, VIEW_W / 2 - 94, y + 2);
    ctx.font = '8px "Trebuchet MS", sans-serif';
    ctx.fillStyle = on ? 'rgba(255,217,74,0.9)' : 'rgba(200,200,220,0.3)';
    ctx.textAlign = 'right';
    ctx.fillText(items[i].sub, VIEW_W / 2 + 110, y + 1);
  }

  ctx.textAlign = 'center';
  ctx.font = '9px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('W / S で選択、Enter か U で決定', VIEW_W / 2, VIEW_H - 14);
}

/* ------------------------------------------------------------------ */

export function drawCharSelect(
  ctx: CanvasRenderingContext2D,
  select: SelectState,
  vsMode: string,
  tick: number,
): void {
  ctx.fillStyle = '#0b0d1c';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // 背景の斜め線。
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#4a5fa8';
  for (let i = -10; i < 40; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 20 + (tick % 20), 0);
    ctx.lineTo(i * 20 - 60 + (tick % 20), VIEW_H);
    ctx.stroke();
  }
  ctx.restore();

  ctx.textAlign = 'center';
  bigText(ctx, 'キャラクター選択', VIEW_W / 2, 26, 18, '#ffffff', '#22264a');

  // 中央にカード。
  const cardH = 104;
  const gap = 8;
  const cardW = Math.min(82, Math.floor((VIEW_W - 40 - gap * (ROSTER.length - 1)) / ROSTER.length));
  const totalW = ROSTER.length * cardW + (ROSTER.length - 1) * gap;
  const startX = Math.round((VIEW_W - totalW) / 2);
  const cardY = 42;

  for (let i = 0; i < ROSTER.length; i++) {
    const c = ROSTER[i];
    const x = startX + i * (cardW + gap);
    const p1 = select.cursor[0] === i;
    const p2 = select.cursor[1] === i;
    ctx.fillStyle = '#161a2e';
    ctx.fillRect(x, cardY, cardW, cardH);
    // キャラの立ち絵。体格の大きいキャラが枠からはみ出ないよう縮める。
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, cardY, cardW, cardH);
    ctx.clip();
    const scale = Math.min(1, (cardH - 8) / (108 * c.appearance.build));
    const f = dummyFighter(i, 0, 0);
    ctx.translate(x + cardW / 2, cardY + cardH - 4);
    ctx.scale(scale, scale);
    ctx.translate(-VIEW_W / 2, -FLOOR_SCREEN_Y);
    drawFighter(ctx, f, c, 0, VIEW_W, tick);
    ctx.restore();

    ctx.strokeStyle = p1 && p2 ? '#ffd94a' : p1 ? '#ff6b6b' : p2 ? '#6bb8ff' : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = p1 || p2 ? 2 : 1;
    ctx.strokeRect(x + 0.5, cardY + 0.5, cardW - 1, cardH - 1);

    ctx.textAlign = 'center';
    ctx.font = 'bold 11px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c.nameJa, x + cardW / 2, cardY + cardH + 13);
    ctx.font = '8px "Trebuchet MS", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(c.name.toUpperCase(), x + cardW / 2, cardY + cardH + 23);
  }

  // 選ばれているキャラの説明。
  const c1 = ROSTER[select.cursor[0]];
  panel(ctx, 14, 178, 214, 58);
  drawCharInfo(ctx, c1, 20, 190, '#ff6b6b', 'P1', select.locked[0]);
  const c2 = ROSTER[select.cursor[1]];
  panel(ctx, VIEW_W - 228, 178, 214, 58);
  drawCharInfo(ctx, c2, VIEW_W - 222, 190, '#6bb8ff', vsMode === 'local' ? 'P2' : 'CPU', select.locked[1]);

  ctx.textAlign = 'center';
  ctx.font = '9px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(
    `ステージ: ${STAGES[select.stage].nameJa}  （Q / E で変更）`,
    VIEW_W / 2,
    VIEW_H - 22,
  );
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('P1: A / D で選択、U で決定   P2: ← → で選択、T で決定', VIEW_W / 2, VIEW_H - 9);
}

function drawCharInfo(
  ctx: CanvasRenderingContext2D,
  c: CharacterDef,
  x: number,
  y: number,
  color: string,
  tag: string,
  locked: boolean,
): void {
  ctx.textAlign = 'left';
  ctx.font = 'bold 9px "Trebuchet MS", sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(tag, x, y);
  ctx.font = 'bold 13px "Noto Sans JP", sans-serif';
  ctx.fillStyle = locked ? '#ffd94a' : '#ffffff';
  ctx.fillText(c.nameJa, x + 22, y + 1);
  ctx.font = '9px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(c.tagline, x, y + 15);

  // 能力の目安。
  const stats: [string, number][] = [
    ['体力', c.health / 1200],
    ['速さ', c.walkForward / px(2.2)],
    ['威力', c.moves.reduce((a, m) => Math.max(a, m.hit.damage), 0) / 360],
  ];
  stats.forEach(([label, v], i) => {
    const by = y + 26 + i * 8;
    ctx.font = '8px "Noto Sans JP", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(label, x, by + 3);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 26, by - 3, 80, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x + 26, by - 3, 80 * Math.max(0.08, Math.min(1, v)), 5);
  });
}

/* ------------------------------------------------------------------ */

export function drawVersus(
  ctx: CanvasRenderingContext2D,
  chars: [CharacterDef, CharacterDef],
  tick: number,
  stage: StageDef,
  arcade: { index: number; total: number } | null = null,
): void {
  drawStage(ctx, stage, 0, tick);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const slide = Math.min(1, tick % 200 / 20);
  void slide;
  const a = dummyFighter(ROSTER.indexOf(chars[0]), 0, -120, 'intro');
  const b = dummyFighter(ROSTER.indexOf(chars[1]), 1, 120, 'intro');
  drawFighter(ctx, a, chars[0], 0, VIEW_W, tick);
  drawFighter(ctx, b, chars[1], 0, VIEW_W, tick);

  ctx.textAlign = 'center';
  bigText(ctx, 'VS', VIEW_W / 2, 116, 48, '#ffd94a', '#7a1020');
  ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(chars[0].nameJa, 24, 40);
  ctx.textAlign = 'right';
  ctx.fillText(chars[1].nameJa, VIEW_W - 24, 40);
  ctx.textAlign = 'center';
  ctx.font = '9px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(stage.nameJa, VIEW_W / 2, VIEW_H - 16);
  if (arcade) {
    ctx.font = 'bold 11px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#ffd94a';
    ctx.fillText(`${arcade.index + 1} 人目 / ${arcade.total}`, VIEW_W / 2, 150);
  }
}

/* ------------------------------------------------------------------ */

export function drawResult(
  ctx: CanvasRenderingContext2D,
  s: MatchState,
  chars: [CharacterDef, CharacterDef],
  tick: number,
  arcade?: { active: boolean; index: number; queue: number[]; cleared: boolean },
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const w = s.matchWinner;
  ctx.textAlign = 'center';
  if (w >= 0) {
    bigText(ctx, `${chars[w].nameJa} WIN`, VIEW_W / 2, 100, 30, '#ffd94a', '#7a1020');
  } else {
    bigText(ctx, 'DRAW', VIEW_W / 2, 100, 30, '#dddddd', '#333333');
  }
  ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${s.wins[0]} - ${s.wins[1]}`, VIEW_W / 2, 126);

  if (arcade?.active) {
    ctx.font = 'bold 13px "Noto Sans JP", sans-serif';
    if (arcade.cleared) {
      ctx.fillStyle = '#ffd94a';
      ctx.fillText('アーケード 全員抜き達成', VIEW_W / 2, 150);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`${arcade.index} 人抜きで敗退`, VIEW_W / 2, 150);
    }
  }

  const alpha = 0.5 + Math.sin(tick * 0.1) * 0.4;
  ctx.globalAlpha = alpha;
  ctx.font = '10px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Enter でキャラクター選択へ / Esc でタイトルへ', VIEW_W / 2, VIEW_H - 26);
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */

export function drawPause(ctx: CanvasRenderingContext2D, index: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  bigText(ctx, 'PAUSE', VIEW_W / 2, 82, 26, '#ffffff', '#222');
  PAUSE_ITEMS.forEach((label, i) => {
    const y = 116 + i * 22;
    const on = i === index;
    ctx.font = `bold ${on ? 14 : 12}px "Noto Sans JP", sans-serif`;
    ctx.fillStyle = on ? '#ffd94a' : 'rgba(255,255,255,0.6)';
    ctx.fillText(label, VIEW_W / 2, y);
  });
}

/* ------------------------------------------------------------------ */

export function drawTrainingPanel(
  ctx: CanvasRenderingContext2D,
  s: MatchState,
  chars: [CharacterDef, CharacterDef],
): void {
  const labels: Record<string, string> = {
    stand: '立ち',
    crouch: 'しゃがみ',
    jump: 'ジャンプ',
    guard: 'ガード（当たる瞬間だけ）',
    guardAll: 'ガードしっぱなし',
    cpu: 'CPU',
  };
  panel(ctx, VIEW_W - 168, 60, 156, 62, 0.55);
  ctx.textAlign = 'left';
  ctx.font = '9px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#9ff0a0';
  ctx.fillText(`F1 判定表示  F4 位置リセット`, VIEW_W - 162, 72);
  ctx.fillText(`F2 相手の行動: ${labels[s.config.dummyAction]}`, VIEW_W - 162, 84);
  ctx.fillText(`F3 自動回復: ${s.config.autoRecover ? 'ON' : 'OFF'}`, VIEW_W - 162, 96);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`${chars[0].nameJa} vs ${chars[1].nameJa}`, VIEW_W - 162, 112);
}

/* ------------------------------------------------------------------ */

/**
 * 入力表示（トレーニング用）。
 *
 * 「今なにを入れたつもりだったのか」が見えると、
 * 技が出なかった理由がその場で分かります。
 * 方向はテンキー表記、ボタンは押した瞬間だけ出します。
 */
export function drawInputDisplay(ctx: CanvasRenderingContext2D, f: Fighter): void {
  const rows = 14;
  const x = 12;
  const bottom = 236;
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,18,0.34)';
  ctx.fillRect(x - 5, bottom - rows * 9 - 12, 66, rows * 9 + 14);
  ctx.font = '8px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(143,208,255,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText('入力', x, bottom - rows * 9 - 3);

  // 新しいものほど下。格闘ゲームの入力表示はこの向きが標準。
  for (let i = 0; i < rows; i++) {
    const bits = inputAt(f.input, i);
    const prev = inputAt(f.input, i + 1);
    const dir = toNumpad(bits, f.facingRight);
    const y = bottom - i * 9;
    const fade = 1 - i / rows;
    ctx.globalAlpha = 0.25 + fade * 0.75;
    // 方向。
    ctx.fillStyle = dir === 5 ? 'rgba(255,255,255,0.3)' : '#ffffff';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(ARROWS[dir] ?? '・', x, y);
    // 押した瞬間のボタンだけ。
    let bx = x + 14;
    ctx.font = 'bold 8px "Noto Sans JP", sans-serif';
    for (const b of ALL_BUTTONS) {
      const bit = BUTTON_BITS[b];
      if ((bits & bit) !== 0 && (prev & bit) === 0) {
        ctx.fillStyle = b.endsWith('P') ? '#ff9a6b' : '#6bd0ff';
        ctx.fillText(BTN_LABEL[b], bx, y);
        bx += 15;
      }
    }
  }
  ctx.restore();
}

const ARROWS: Record<number, string> = {
  1: '↙', 2: '↓', 3: '↘', 4: '←', 5: '・', 6: '→', 7: '↖', 8: '↑', 9: '↗',
};
const BTN_LABEL: Record<string, string> = {
  LP: '弱P', MP: '中P', HP: '強P', LK: '弱K', MK: '中K', HK: '強K',
};

export function drawHowTo(ctx: CanvasRenderingContext2D, tick: number): void {
  ctx.fillStyle = '#0a0c1a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  bigText(ctx, '操作説明', VIEW_W / 2, 26, 18, '#ffffff', '#22264a');

  const rows: [string, string][] = [
    ['移動', 'A / D（1P）　← → （2P）'],
    ['しゃがみ・ガード', 'S でしゃがみ、後ろを入れるとガード'],
    ['ジャンプ', 'W（前後に入れながらで前後ジャンプ）'],
    ['パンチ', 'U 弱 / I 中 / O 強'],
    ['キック', 'J 弱 / K 中 / L 強'],
    ['投げ', '弱P + 弱K（近距離で）'],
    ['ダッシュ', '前・前　／　バックダッシュ 後ろ・後ろ'],
    ['必殺技', '236 + P（波動）、623 + P（昇龍）、214 + K'],
    ['ため技', '後ろにためて前 + P ／ 下にためて上 + K（黒羽）'],
    ['EX 必殺技', '同じコマンド + パンチ 2 つ（ゲージ 0.5 本）'],
    ['超必殺技', '236236 + P（ゲージ 1 本）'],
    ['判定表示', 'F1（トレーニング中）'],
    ['技表', 'タイトル画面 / ポーズメニューから'],
  ];
  ctx.textAlign = 'left';
  rows.forEach(([k, v], i) => {
    const y = 46 + i * 16;
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(30, y - 11, VIEW_W - 60, 15);
    }
    ctx.font = 'bold 10px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#ffd94a';
    ctx.fillText(k, 38, y);
    ctx.font = '10px "Noto Sans JP", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(v, 146, y);
  });

  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.5 + Math.sin(tick * 0.1) * 0.4;
  ctx.font = '10px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Enter / Esc で戻る', VIEW_W / 2, VIEW_H - 14);
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */

export function drawOptions(ctx: CanvasRenderingContext2D, s: Settings, index: number): void {
  ctx.fillStyle = '#0a0c1a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  bigText(ctx, '設定', VIEW_W / 2, 30, 18, '#ffffff', '#22264a');

  const diffLabel: Record<string, string> = {
    easy: 'やさしい',
    normal: 'ふつう',
    hard: 'つよい',
    expert: '鬼',
  };
  const rows: [string, string][] = [
    ['CPU の強さ', diffLabel[s.difficulty]],
    ['先取ラウンド数', `${s.rounds}`],
    ['制限時間', s.timeLimit === 0 ? 'なし' : `${Math.round(s.timeLimit / 60)} 秒`],
    ['全体の音量', `${Math.round(s.master * 100)}%`],
    ['音楽の音量', `${Math.round(s.music * 100)}%`],
    ['効果音の音量', `${Math.round(s.sfx * 100)}%`],
    ['当たり判定の表示', s.showBoxes ? 'ON' : 'OFF'],
  ];
  rows.forEach(([k, v], i) => {
    const y = 62 + i * 22;
    const on = i === index;
    if (on) {
      ctx.fillStyle = 'rgba(255,217,74,0.14)';
      ctx.fillRect(70, y - 13, VIEW_W - 140, 20);
    }
    ctx.textAlign = 'left';
    ctx.font = `bold ${on ? 12 : 11}px "Noto Sans JP", sans-serif`;
    ctx.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.6)';
    ctx.fillText(k, 82, y + 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = on ? '#ffd94a' : 'rgba(255,255,255,0.5)';
    ctx.fillText(on ? `◀ ${v} ▶` : v, VIEW_W - 82, y + 2);
  });

  ctx.textAlign = 'center';
  ctx.font = '9px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('W / S で項目、A / D で変更、Enter で戻る', VIEW_W / 2, VIEH_BOTTOM);
}

const VIEH_BOTTOM = VIEW_H - 14;
