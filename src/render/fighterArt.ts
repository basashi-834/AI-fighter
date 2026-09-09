/**
 * ファイターの描画。骨格を組んでその場で描く方式。
 *
 * 「今どのポーズであるべきか」を状態から決めて、
 * 前のポーズとの間を補間しながら線を引いていきます。
 */

import { FLOOR_SCREEN_Y, toPx } from '../engine/constants';
import { currentMove, type Fighter } from '../engine/fighter';
import type { CharacterDef } from '../engine/types';
import {
  AIR_HURT,
  ATTACK_POSES,
  BACKDASH,
  BLOCK_CROUCH,
  BLOCK_STAND,
  CROUCH,
  DASH,
  DIZZY,
  GRABBED,
  HITSTUN,
  HITSTUN_CROUCH,
  IDLE,
  IDLE_B,
  INTRO,
  JUMP_FALL,
  JUMP_UP,
  KNOCKDOWN,
  LAND,
  WAKEUP,
  WALK_B,
  WALK_B2,
  WALK_F,
  WALK_F2,
  WIN,
  lerpPose,
  type Pose,
} from './pose';

const D2R = Math.PI / 180;

/** なめらかな増減（0→1）。 */
function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** 攻撃の勢いを出すための、はじめゆっくり・あとで一気の曲線。 */
function easeOutFast(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

/** 今のフレームのポーズを決める。 */
export function poseFor(f: Fighter, char: CharacterDef, tick: number): Pose {
  const m = currentMove(f, char);

  if (f.state === 'attack' && m) {
    const ap = ATTACK_POSES[m.pose] ?? ATTACK_POSES.jab;
    const fr = f.moveFrame;
    const st = m.startup;
    const activeEnd = st + m.active - 1;
    const total = st - 1 + m.active + m.recovery;
    if (fr < st) {
      const t = st <= 1 ? 1 : (fr - 1) / (st - 1);
      // 前半はためる、後半は伸ばす。
      if (t < 0.45) return lerpPose(IDLE, ap.wind, ease(t / 0.45));
      return lerpPose(ap.wind, ap.strike, easeOutFast((t - 0.45) / 0.55));
    }
    if (fr <= activeEnd) return ap.strike;
    const t = (fr - activeEnd) / Math.max(1, total - activeEnd);
    if (t < 0.5) return lerpPose(ap.strike, ap.rec, ease(t / 0.5));
    return lerpPose(ap.rec, IDLE, ease((t - 0.5) / 0.5));
  }

  switch (f.state) {
    case 'idle': {
      const t = (Math.sin(tick * 0.09) + 1) / 2;
      return lerpPose(IDLE, IDLE_B, t);
    }
    case 'walkF': {
      const t = (f.stateFrame % 18) / 18;
      return t < 0.5 ? lerpPose(WALK_F, WALK_F2, ease(t * 2)) : lerpPose(WALK_F2, WALK_F, ease((t - 0.5) * 2));
    }
    case 'walkB': {
      const t = (f.stateFrame % 20) / 20;
      return t < 0.5 ? lerpPose(WALK_B, WALK_B2, ease(t * 2)) : lerpPose(WALK_B2, WALK_B, ease((t - 0.5) * 2));
    }
    case 'crouch':
      return f.guarding ? BLOCK_CROUCH : CROUCH;
    case 'jumpStart':
      return lerpPose(IDLE, LAND, ease(f.stateFrame / Math.max(1, f.stateDuration)));
    case 'air':
      return f.vy > 0 ? JUMP_UP : JUMP_FALL;
    case 'landing':
      return lerpPose(LAND, IDLE, ease(f.stateFrame / Math.max(1, f.stateDuration)));
    case 'dash':
      return lerpPose(DASH, IDLE, ease(f.stateFrame / Math.max(1, f.stateDuration)));
    case 'backdash':
      return lerpPose(BACKDASH, IDLE, ease(f.stateFrame / Math.max(1, f.stateDuration)));
    case 'blockstun':
      return f.guardLow ? BLOCK_CROUCH : BLOCK_STAND;
    case 'hitstun': {
      if (f.y > 0) {
        const spin = { ...AIR_HURT, lean: (AIR_HURT.lean ?? 0) - f.stateFrame * 1.5 };
        return spin;
      }
      return f.stance === 'crouch' ? HITSTUN_CROUCH : HITSTUN;
    }
    case 'knockdown':
      return lerpPose(HITSTUN, KNOCKDOWN, ease(f.stateFrame / 6));
    case 'wakeup':
      return lerpPose(KNOCKDOWN, WAKEUP, ease(f.stateFrame / Math.max(1, f.stateDuration - 6)));
    case 'dizzy': {
      const w = Math.sin(tick * 0.25) * 6;
      return { ...DIZZY, torso: DIZZY.torso + w, head: DIZZY.head - w };
    }
    case 'grabbed':
      return GRABBED;
    case 'intro':
      return INTRO;
    case 'win':
      return WIN;
    case 'ko':
    case 'lose':
      return KNOCKDOWN;
    default:
      return IDLE;
  }
}

interface Vec {
  x: number;
  y: number;
}

/** 手足の向き（真下が 0 度、前方へ回すと +）。 */
function limbDir(deg: number, s: number): Vec {
  const r = deg * D2R;
  return { x: s * Math.sin(r), y: Math.cos(r) };
}

/** 胴や首の向き（真上が 0 度）。 */
function upDir(deg: number, s: number): Vec {
  const r = deg * D2R;
  return { x: s * Math.sin(r), y: -Math.cos(r) };
}

function seg(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, w: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export interface DrawOptions {
  /** 白く光らせる量（0..1）。ヒットストップ中などに使う。 */
  flash: number;
  alpha: number;
  /** 残像として描くか。 */
  ghost: boolean;
  /** 色を上書きする（超必殺技の暗転など）。 */
  tint?: string;
}

const DEFAULT_OPTS: DrawOptions = { flash: 0, alpha: 1, ghost: false };

/** 1 人ぶん描く。 */
export function drawFighter(
  ctx: CanvasRenderingContext2D,
  f: Fighter,
  char: CharacterDef,
  cameraX: number,
  viewW: number,
  tick: number,
  opts: Partial<DrawOptions> = {},
): void {
  const o = { ...DEFAULT_OPTS, ...opts };
  const pose = poseFor(f, char, tick);
  const build = char.appearance.build;
  const s = f.facingRight ? 1 : -1;

  const baseX = toPx(f.x) - cameraX + viewW / 2;
  const baseY = FLOOR_SCREEN_Y - toPx(f.y);

  // 影。地面からの高さで薄く小さくなる。
  if (!o.ghost) {
    const h = toPx(f.y);
    const shrink = Math.max(0.35, 1 - h / 200);
    ctx.save();
    ctx.globalAlpha = 0.28 * shrink;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(baseX, FLOOR_SCREEN_Y + 1, 20 * build * shrink, 5 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const lean = (pose.lean ?? 0) * D2R;
  const hip: Vec = {
    x: baseX + s * pose.hip[0] * build,
    y: baseY - pose.hip[1] * build,
  };

  // 全身の傾き（吹き飛び・ダウン）は腰を中心に回す。
  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.translate(hip.x, hip.y);
  ctx.rotate(s * lean);
  ctx.translate(-hip.x, -hip.y);

  const L = (n: number) => n * build;
  const upperArm = L(16);
  const lowerArm = L(15);
  const upperLeg = L(23);
  const lowerLeg = L(23);
  const torsoLen = L(30);

  const a = char.appearance;
  const flashC = o.flash > 0.5 ? '#ffffff' : null;
  const tint = o.tint;
  const cGi = flashC ?? tint ?? a.gi;
  const cGiDark = flashC ?? tint ?? a.giDark;
  const cSkin = flashC ?? tint ?? a.skin;
  const cHair = flashC ?? tint ?? a.hair;
  const cAcc = flashC ?? tint ?? a.accent;
  // 輪郭。背景に溶けないよう、キャラの外側を一段暗く縁取る。
  const outline = flashC ? '#ffffff' : o.ghost ? 'rgba(0,0,0,0)' : '#14101c';

  const torsoDir = upDir(pose.torso, s);
  const shoulder: Vec = { x: hip.x + torsoDir.x * torsoLen, y: hip.y + torsoDir.y * torsoLen };

  /** 2 本の骨からなる手足の関節位置を求める。 */
  function joints(root: Vec, angles: [number, number], l1: number, l2: number): [Vec, Vec] {
    const d1 = limbDir(angles[0], s);
    const mid = { x: root.x + d1.x * l1, y: root.y + d1.y * l1 };
    const d2 = limbDir(angles[1], s);
    const end = { x: mid.x + d2.x * l2, y: mid.y + d2.y * l2 };
    return [mid, end];
  }

  const [elbowF, handF] = joints(shoulder, pose.armF, upperArm, lowerArm);
  const [elbowB, handB] = joints(shoulder, pose.armB, upperArm, lowerArm);
  const [kneeF, footF] = joints(hip, pose.legF, upperLeg, lowerLeg);
  const [kneeB, footB] = joints(hip, pose.legB, upperLeg, lowerLeg);

  const headDir = upDir(pose.torso + pose.head, s);
  const headC = { x: shoulder.x + headDir.x * L(13), y: shoulder.y + headDir.y * L(13) };
  const headR = L(10);

  const OUT = L(2.6);

  /** 手足を「輪郭 → 中身」の順に描く。 */
  function limb(root: Vec, mid: Vec, end: Vec, w1: number, w2: number, c1: string, c2: string, tip: string, tipR: number): void {
    if (outline !== 'rgba(0,0,0,0)') {
      seg(ctx, root, mid, w1 + OUT, outline);
      seg(ctx, mid, end, w2 + OUT, outline);
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.arc(end.x, end.y, tipR + OUT / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    seg(ctx, root, mid, w1, c1);
    seg(ctx, mid, end, w2, c2);
    ctx.fillStyle = tip;
    ctx.beginPath();
    ctx.arc(end.x, end.y, tipR, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 奥側（暗い色）----
  limb(hip, kneeB, footB, L(9), L(7.5), cGiDark, cGiDark, cGiDark, L(4.5));
  limb(shoulder, elbowB, handB, L(7.5), L(6.5), cGiDark, cGiDark, cGiDark, L(4));

  // ---- 胴 ----
  // 肩を広く、腰を細く。四角い棒に見えないようにする。
  const sideDir = { x: -torsoDir.y, y: torsoDir.x };
  const hw = L(7.5);
  const sw = L(10.5);
  const torsoPath = () => {
    ctx.beginPath();
    ctx.moveTo(hip.x - sideDir.x * hw, hip.y - sideDir.y * hw);
    ctx.lineTo(shoulder.x - sideDir.x * sw, shoulder.y - sideDir.y * sw);
    ctx.lineTo(shoulder.x + sideDir.x * sw, shoulder.y + sideDir.y * sw);
    ctx.lineTo(hip.x + sideDir.x * hw, hip.y + sideDir.y * hw);
    ctx.closePath();
  };
  if (outline !== 'rgba(0,0,0,0)') {
    ctx.strokeStyle = outline;
    ctx.lineWidth = OUT * 2;
    ctx.lineJoin = 'round';
    torsoPath();
    ctx.stroke();
  }
  ctx.fillStyle = cGi;
  torsoPath();
  ctx.fill();
  // 道着の合わせ目。
  ctx.strokeStyle = cGiDark;
  ctx.lineWidth = L(2);
  ctx.beginPath();
  ctx.moveTo(shoulder.x + sideDir.x * s * L(4), shoulder.y + sideDir.y * s * L(4));
  ctx.lineTo(hip.x - sideDir.x * s * L(2), hip.y - sideDir.y * s * L(2));
  ctx.stroke();
  // 帯。
  const beltP = { x: hip.x + torsoDir.x * L(4), y: hip.y + torsoDir.y * L(4) };
  seg(ctx, { x: beltP.x - sideDir.x * L(8.5), y: beltP.y - sideDir.y * L(8.5) },
      { x: beltP.x + sideDir.x * L(8.5), y: beltP.y + sideDir.y * L(8.5) }, L(5.5), cAcc);

  // ---- 首と頭 ----
  if (outline !== 'rgba(0,0,0,0)') {
    seg(ctx, shoulder, headC, L(7) + OUT, outline);
    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.arc(headC.x, headC.y, headR + OUT / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  seg(ctx, shoulder, headC, L(7), cSkin);
  ctx.fillStyle = cSkin;
  ctx.beginPath();
  ctx.arc(headC.x, headC.y, headR, 0, Math.PI * 2);
  ctx.fill();
  drawHair(ctx, headC, headR, s, a.hairStyle, cHair, headDir);
  if (!flashC && !tint) {
    ctx.fillStyle = '#1c1c22';
    ctx.beginPath();
    ctx.arc(headC.x + s * L(4.5), headC.y - L(1), L(1.7), 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 手前側 ----
  limb(hip, kneeF, footF, L(9.5), L(8), cGi, cSkin, cAcc, L(5));
  limb(shoulder, elbowF, handF, L(8), L(7), cGi, cSkin, cSkin, L(4.5));

  ctx.restore();
}

function drawHair(
  ctx: CanvasRenderingContext2D,
  c: Vec,
  r: number,
  s: number,
  style: string,
  color: string,
  dir: Vec,
): void {
  ctx.fillStyle = color;
  switch (style) {
    case 'bald':
      ctx.beginPath();
      ctx.arc(c.x, c.y - r * 0.25, r * 0.95, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
      break;
    case 'ponytail': {
      ctx.beginPath();
      ctx.arc(c.x, c.y - r * 0.15, r * 1.02, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
      // 後ろに垂らす。
      ctx.beginPath();
      ctx.moveTo(c.x - s * r * 0.7, c.y - r * 0.3);
      ctx.quadraticCurveTo(c.x - s * r * 2.4, c.y + r * 0.2, c.x - s * r * 1.9, c.y + r * 1.7);
      ctx.quadraticCurveTo(c.x - s * r * 1.2, c.y + r * 0.4, c.x - s * r * 0.5, c.y + r * 0.2);
      ctx.fill();
      break;
    }
    case 'spiky': {
      ctx.beginPath();
      ctx.arc(c.x, c.y - r * 0.16, r * 1.04, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
      // 逆立てた髪。後ろへ流す。とがらせすぎると冠のように見えるので控えめに。
      for (let i = -1; i <= 2; i++) {
        const bx = c.x - s * i * r * 0.4;
        ctx.beginPath();
        ctx.moveTo(bx - r * 0.22, c.y - r * 0.7);
        ctx.lineTo(bx - s * r * 0.45, c.y - r * 1.35);
        ctx.lineTo(bx + r * 0.24, c.y - r * 0.7);
        ctx.fill();
      }
      break;
    }
    case 'long':
      ctx.beginPath();
      ctx.arc(c.x, c.y - r * 0.1, r * 1.05, Math.PI * 0.85, Math.PI * 2.15);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x - s * r * 0.5, c.y + r * 0.6, r * 0.9, r * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.arc(c.x, c.y - r * 0.18, r * 1.02, Math.PI * 0.92, Math.PI * 2.08);
      ctx.fill();
      break;
  }
  void dir;
}
