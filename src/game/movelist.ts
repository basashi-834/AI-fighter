/**
 * 技表。
 *
 * 対戦格闘ゲームは、技の数字が分からないと組み立てが作れません。
 * 発生・持続・硬直・硬直差を、ゲームの中からいつでも見られるようにしています。
 * ここに出る数字は、データからそのまま読んでいるので、
 * 調整したら表も自動でついてきます。
 */

import { METER_PER_BAR, VIEW_H, VIEW_W } from '../engine/constants';
import { moveTotal } from '../engine/fighter';
import type { CharacterDef, MoveDef } from '../engine/types';
import { bigText } from '../render/renderer';

const MOTION_LABEL: Record<string, string> = {
  none: '',
  '236': '↓↘→',
  '214': '↓↙←',
  '623': '→↓↘',
  '421': '←↓↙',
  '41236': '←↓→',
  '63214': '→↓←',
  '236236': '↓↘→↓↘→',
  '214214': '↓↙←↓↙←',
  '632146': '→↓←↓→',
  charge_back: '←ため→',
  charge_down: '↓ため↑',
};

const BUTTON_LABEL: Record<string, string> = {
  LP: '弱P', MP: '中P', HP: '強P', LK: '弱K', MK: '中K', HK: '強K',
};

function commandOf(m: MoveDef): string {
  const motion = MOTION_LABEL[m.input.motion] ?? '';
  const btn = m.input.buttons
    ? m.input.buttons.map((b) => BUTTON_LABEL[b]).join('+')
    : m.input.button
      ? BUTTON_LABEL[m.input.button]
      : '';
  const stance = m.input.stances.includes('air')
    ? '空中 '
    : m.input.stances.length === 1 && m.input.stances[0] === 'crouch'
      ? '↓ '
      : '';
  return `${stance}${motion}${motion ? ' ' : ''}${btn}`;
}

function guardLabel(m: MoveDef): string {
  if (m.throwSpec) return '投げ';
  switch (m.hit.guard) {
    case 'high':
      return '中段';
    case 'low':
      return '下段';
    case 'unblockable':
      return '不能';
    default:
      return '中';
  }
}

interface Row {
  name: string;
  command: string;
  frames: string;
  adv: string;
  damage: string;
  guard: string;
  meter: string;
  special: boolean;
}

export function rowsFor(char: CharacterDef): Row[] {
  return char.moves.map((m) => {
    const total = moveTotal(m);
    const cost = m.meterCost ?? 0;
    return {
      name: m.nameJa,
      command: commandOf(m),
      frames: m.throwSpec ? `${m.startup} / — / ${m.recovery}` : `${m.startup} / ${m.active} / ${m.recovery}`,
      adv: m.throwSpec
        ? '—'
        : `${fmt(m.hit.hitAdvantage)} / ${fmt(m.hit.blockAdvantage)}`,
      damage: String(m.throwSpec ? m.throwSpec.damage : m.hit.damage),
      guard: guardLabel(m),
      meter: cost >= METER_PER_BAR ? '1本' : cost > 0 ? '0.5本' : '',
      special: m.input.motion !== 'none',
      // 全体フレームは名前の横に出す。
      ...(total ? {} : {}),
    };
  });
}

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

const PAGE = 14;

export function drawMoveList(
  ctx: CanvasRenderingContext2D,
  char: CharacterDef,
  scroll: number,
  charIndex: number,
  total: number,
): void {
  ctx.fillStyle = '#0a0c1a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  bigText(ctx, `技表 — ${char.nameJa}`, VIEW_W / 2, 22, 15, '#ffffff', '#22264a');

  const rows = rowsFor(char);
  const start = Math.max(0, Math.min(scroll, Math.max(0, rows.length - PAGE)));
  const shown = rows.slice(start, start + PAGE);

  // 見出し。
  const cols = [
    { x: 14, label: '技', align: 'left' as const },
    { x: 124, label: 'コマンド', align: 'left' as const },
    { x: 246, label: '発生/持続/硬直', align: 'right' as const },
    { x: 328, label: 'ヒット/ガード', align: 'right' as const },
    { x: 380, label: '威力', align: 'right' as const },
    { x: 420, label: 'ガード', align: 'right' as const },
    { x: 466, label: 'ゲージ', align: 'right' as const },
  ];
  ctx.font = 'bold 8px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#8fd0ff';
  for (const c of cols) {
    ctx.textAlign = c.align;
    ctx.fillText(c.label, c.x, 38);
  }
  ctx.strokeStyle = 'rgba(143,208,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(12, 42);
  ctx.lineTo(VIEW_W - 12, 42);
  ctx.stroke();

  shown.forEach((r, i) => {
    const y = 54 + i * 14;
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(10, y - 9, VIEW_W - 20, 13);
    }
    const values = [r.name, r.command, r.frames, r.adv, r.damage, r.guard, r.meter];
    values.forEach((v, ci) => {
      const c = cols[ci];
      ctx.textAlign = c.align;
      ctx.font = `${ci === 0 && r.special ? 'bold ' : ''}9px "Noto Sans JP", sans-serif`;
      ctx.fillStyle = ci === 0
        ? r.special ? '#ffd94a' : '#ffffff'
        : ci === 3
          ? 'rgba(200,255,200,0.8)'
          : 'rgba(255,255,255,0.7)';
      ctx.fillText(v, c.x, y);
    });
  });

  // 下の案内。
  ctx.textAlign = 'center';
  ctx.font = '9px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  if (rows.length > PAGE) {
    ctx.fillText(`▲▼ でスクロール（${start + 1}-${start + shown.length} / ${rows.length}）`, VIEW_W / 2, 248);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(
    `A / D でキャラクター切り替え（${charIndex + 1} / ${total}）　Esc で戻る`,
    VIEW_W / 2,
    260,
  );
}
