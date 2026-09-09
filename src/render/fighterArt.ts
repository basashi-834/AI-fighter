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

/**
 * 先細りの骨（手足・胴）の輪郭を作る。
 *
 * 太さが両端で違う「カプセル」です。丸い棒をそのまま並べると
 * どうしても棒人間に見えてしまうので、付け根を太く、先を細くしています。
 * これだけで、腕や脚が「肉のついたもの」に見えるようになります。
 */
function bonePath(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, w1: number, w2: number): void {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const r1 = w1 / 2;
  const r2 = w2 / 2;
  const H = Math.PI / 2;
  ctx.beginPath();
  // a 側の丸い端。b と反対側へふくらむように半周する。
  ctx.arc(a.x, a.y, r1, ang + H, ang + H * 3);
  // b 側の丸い端。こちらは a と反対側へふくらむ。
  // arc() が現在位置から自動で線を引いてくれるので、側面はそれで埋まる。
  ctx.arc(b.x, b.y, r2, ang + H * 3, ang + H * 5);
  ctx.closePath();
}

/** 骨を「陰つき」で塗る。手前側を明るく、奥側を暗くする。 */
function fillBone(
  ctx: CanvasRenderingContext2D,
  a: Vec,
  b: Vec,
  w1: number,
  w2: number,
  color: string,
  shade: string | null,
  facing: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * facing;
  const ny = (dx / len) * facing;
  const w = Math.max(w1, w2);
  bonePath(ctx, a, b, w1, w2);
  if (shade) {
    const g = ctx.createLinearGradient(
      a.x + nx * w * 0.6, a.y + ny * w * 0.6,
      a.x - nx * w * 0.7, a.y - ny * w * 0.7,
    );
    g.addColorStop(0, color);
    g.addColorStop(0.55, color);
    g.addColorStop(1, shade);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fill();
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
  /** 表情。 */
  expression?: 'idle' | 'attack' | 'hurt';
}

const DEFAULT_OPTS: DrawOptions = { flash: 0, alpha: 1, ghost: false, expression: 'idle' };

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
  // 表情は状態から自動で決める。攻撃中は食いしばり、喰らったら目を閉じる。
  if (!opts.expression) {
    o.expression =
      f.state === 'hitstun' || f.state === 'knockdown' || f.state === 'dizzy' || f.state === 'grabbed'
        ? 'hurt'
        : f.state === 'attack'
          ? 'attack'
          : 'idle';
  }
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

  const OUT = L(2.4);
  const shade = (c: string) => mixColor(c, '#101018', 0.42);
  const light = (c: string) => mixColor(c, '#ffffff', 0.18);

  /** 輪郭をなぞる（背景から浮かせるため、キャラの外周を一段暗く縁取る）。 */
  function outlineBone(a: Vec, b: Vec, w1: number, w2: number): void {
    if (outline === 'rgba(0,0,0,0)') return;
    bonePath(ctx, a, b, w1 + OUT, w2 + OUT);
    ctx.fillStyle = outline;
    ctx.fill();
  }

  /**
   * 手先・足先。丸い玉を置くと風船のように見えてしまうので、
   * 拳は前腕の向きに、足は進行方向にそれぞれ伸ばした楕円で描きます。
   */
  function drawTip(
    from: Vec, at: Vec, kind: 'fist' | 'foot', color: string, size: number, pad: number,
  ): void {
    const ang = kind === 'foot' ? 0 : Math.atan2(at.y - from.y, at.x - from.x);
    const rx = kind === 'foot' ? size * 1.5 : size * 1.15;
    const ry = kind === 'foot' ? size * 0.62 : size * 0.92;
    const ox = kind === 'foot' ? s * size * 0.45 : 0;
    const oy = kind === 'foot' ? size * 0.2 : 0;
    ctx.beginPath();
    ctx.ellipse(at.x + ox, at.y + oy, rx + pad, ry + pad, ang, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** 手足を「輪郭 → 上腕/太もも → 前腕/すね → 手先」の順に描く。 */
  function limb(
    root: Vec, mid: Vec, end: Vec,
    w1: number, w2: number, w3: number,
    cUpper: string, cLower: string, tip: string, tipR: number,
    kind: 'fist' | 'foot',
  ): void {
    outlineBone(root, mid, w1, w2);
    outlineBone(mid, end, w2, w3);
    if (outline !== 'rgba(0,0,0,0)') drawTip(mid, end, kind, outline, tipR, OUT / 2);
    fillBone(ctx, root, mid, w1, w2, cUpper, flashC ? null : shade(cUpper), s);
    fillBone(ctx, mid, end, w2, w3, cLower, flashC ? null : shade(cLower), s);
    drawTip(mid, end, kind, tip, tipR, 0);
  }

  const gear = a.gear ?? [];
  const has = (g: string) => gear.includes(g as never);

  // ---- 奥側（暗い色）----
  limb(hip, kneeB, footB, L(11), L(8), L(6.5), cGiDark, cGiDark, cGiDark, L(4), 'foot');
  limb(shoulder, elbowB, handB, L(8.5), L(6.5), L(5.5), cGiDark, cGiDark, cGiDark, L(3.6), 'fist');

  // ---- 胴 ----
  // 肩を広く、腰を細く。棒に見えないよう、胸と腹で幅を変える。
  const sideDir = { x: -torsoDir.y, y: torsoDir.x };
  const chest = { x: hip.x + torsoDir.x * torsoLen * 0.62, y: hip.y + torsoDir.y * torsoLen * 0.62 };
  const hw = L(9);
  const cw = L(11.5);
  const sw = L(10);
  const quad = (p1: Vec, w1: number, p2: Vec, w2: number) => {
    ctx.moveTo(p1.x - sideDir.x * w1, p1.y - sideDir.y * w1);
    ctx.lineTo(p2.x - sideDir.x * w2, p2.y - sideDir.y * w2);
    ctx.lineTo(p2.x + sideDir.x * w2, p2.y + sideDir.y * w2);
    ctx.lineTo(p1.x + sideDir.x * w1, p1.y + sideDir.y * w1);
  };
  const torsoPath = (pad: number) => {
    ctx.beginPath();
    quad(hip, hw + pad, chest, cw + pad);
    ctx.closePath();
    ctx.beginPath();
    ctx.moveTo(hip.x - sideDir.x * (hw + pad), hip.y - sideDir.y * (hw + pad));
    ctx.lineTo(chest.x - sideDir.x * (cw + pad), chest.y - sideDir.y * (cw + pad));
    ctx.lineTo(shoulder.x - sideDir.x * (sw + pad), shoulder.y - sideDir.y * (sw + pad));
    ctx.lineTo(shoulder.x + sideDir.x * (sw + pad), shoulder.y + sideDir.y * (sw + pad));
    ctx.lineTo(chest.x + sideDir.x * (cw + pad), chest.y + sideDir.y * (cw + pad));
    ctx.lineTo(hip.x + sideDir.x * (hw + pad), hip.y + sideDir.y * (hw + pad));
    ctx.closePath();
  };
  if (outline !== 'rgba(0,0,0,0)') {
    torsoPath(OUT);
    ctx.fillStyle = outline;
    ctx.fill();
  }
  torsoPath(0);
  if (flashC) {
    ctx.fillStyle = flashC;
  } else {
    const gt = ctx.createLinearGradient(
      chest.x + sideDir.x * s * cw, chest.y + sideDir.y * s * cw,
      chest.x - sideDir.x * s * cw, chest.y - sideDir.y * s * cw,
    );
    gt.addColorStop(0, light(cGi));
    gt.addColorStop(0.5, cGi);
    gt.addColorStop(1, shade(cGi));
    ctx.fillStyle = gt;
  }
  ctx.fill();

  if (!flashC && !tint) {
    // 上着の合わせ目。前を開けているキャラは肌を見せる。
    ctx.save();
    torsoPath(0);
    ctx.clip();
    if (has('openJacket')) {
      ctx.fillStyle = cSkin;
      ctx.beginPath();
      quad(hip, hw * 0.62, shoulder, sw * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = mixColor(cSkin, '#101018', 0.3);
      ctx.beginPath();
      quad(chest, cw * 0.2, shoulder, sw * 0.2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = shade(cGiDark);
      ctx.lineWidth = L(2.2);
      ctx.beginPath();
      ctx.moveTo(shoulder.x + sideDir.x * s * L(4), shoulder.y + sideDir.y * s * L(4));
      ctx.lineTo(hip.x - sideDir.x * s * L(2), hip.y - sideDir.y * s * L(2));
      ctx.stroke();
    }
    if (has('sash')) {
      ctx.strokeStyle = cAcc;
      ctx.lineWidth = L(4);
      ctx.beginPath();
      ctx.moveTo(shoulder.x + sideDir.x * s * L(8), shoulder.y + sideDir.y * s * L(8));
      ctx.lineTo(hip.x - sideDir.x * s * L(8), hip.y - sideDir.y * s * L(8));
      ctx.stroke();
    }
    ctx.restore();
  }

  // 帯。前で結んで、端が垂れる。
  const beltP = { x: hip.x + torsoDir.x * L(4), y: hip.y + torsoDir.y * L(4) };
  seg(ctx, { x: beltP.x - sideDir.x * L(10), y: beltP.y - sideDir.y * L(10) },
      { x: beltP.x + sideDir.x * L(10), y: beltP.y + sideDir.y * L(10) }, L(6), cAcc);
  if (!o.ghost) {
    ctx.strokeStyle = cAcc;
    ctx.lineWidth = L(3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(beltP.x + s * L(3), beltP.y);
    ctx.quadraticCurveTo(beltP.x + s * L(6), beltP.y + L(10), beltP.x + s * L(2), beltP.y + L(18));
    ctx.stroke();
  }

  // 肩当て。
  if (has('shoulderpads') && !flashC) {
    ctx.fillStyle = cAcc;
    ctx.beginPath();
    ctx.ellipse(shoulder.x + s * L(2), shoulder.y + L(1), L(9), L(6.5), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- 首と頭 ----
  drawHead(ctx, {
    shoulder, headC, headR, s, L, outline, cSkin, cHair, cAcc,
    flash: flashC != null, tint: tint != null,
    style: a.hairStyle, face: a.face ?? 'stern', gear,
    expression: o.expression ?? 'idle', headDir,
  });

  // ---- 手前側 ----
  const bootCol = has('boots') ? cAcc : has('barefoot') ? cSkin : cGiDark;
  limb(hip, kneeF, footF, L(12), L(8.5), L(7), cGi, has('boots') ? cAcc : cSkin, bootCol, L(4.4), 'foot');
  limb(shoulder, elbowF, handF, L(9), L(7), L(6), cGi,
       has('gloves') ? cAcc : cSkin, has('gloves') ? cAcc : cSkin, L(4), 'fist');

  // 手首の巻き布。
  if (has('wristwraps') && !flashC) {
    ctx.strokeStyle = '#e8e4dc';
    ctx.lineWidth = L(6);
    ctx.lineCap = 'butt';
    const d = { x: handF.x - elbowF.x, y: handF.y - elbowF.y };
    const l = Math.hypot(d.x, d.y) || 1;
    ctx.beginPath();
    ctx.moveTo(handF.x - (d.x / l) * L(7), handF.y - (d.y / l) * L(7));
    ctx.lineTo(handF.x - (d.x / l) * L(2), handF.y - (d.y / l) * L(2));
    ctx.stroke();
  }

  ctx.restore();
}

/** 2 色を混ぜる（陰やハイライトを作るため）。 */
function mixColor(hex: string, other: string, t: number): string {
  const p = (h: string) => {
    const v = h.replace('#', '');
    const n = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  };
  try {
    const A = p(hex);
    const B = p(other);
    const m = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  } catch {
    return hex;
  }
}

interface HeadOpts {
  shoulder: Vec;
  headC: Vec;
  headR: number;
  s: number;
  L: (n: number) => number;
  outline: string;
  cSkin: string;
  cHair: string;
  cAcc: string;
  flash: boolean;
  tint: boolean;
  style: string;
  face: string;
  gear: string[];
  expression: string;
  headDir: Vec;
}

/**
 * 頭。首・耳・眉・目・口まで描く。
 *
 * 小さいので細かくは見えませんが、目と眉があるだけで
 * 「どちらを向いているか」「今どんな状態か」が伝わります。
 * 殴っているときは食いしばり、喰らったときは目を閉じる、というふうに
 * 表情を変えています。
 */
function drawHead(ctx: CanvasRenderingContext2D, o: HeadOpts): void {
  const { shoulder, headC, headR: r, s, L, outline, cSkin, cHair, cAcc } = o;
  const dark = mixColor(cSkin, '#101018', 0.38);

  // 首。
  if (outline !== 'rgba(0,0,0,0)') {
    bonePath(ctx, shoulder, headC, L(9) + L(2.4), L(8) + L(2.4));
    ctx.fillStyle = outline;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headC.x, headC.y, r + L(1.2), 0, Math.PI * 2);
    ctx.fill();
  }
  fillBone(ctx, shoulder, headC, L(9), L(8), cSkin, o.flash ? null : dark, s);

  // 顔の輪郭。あごを少し前へ出す。
  ctx.beginPath();
  ctx.ellipse(headC.x + s * L(0.6), headC.y, r * 0.96, r, 0, 0, Math.PI * 2);
  if (o.flash) {
    ctx.fillStyle = cSkin;
  } else {
    const g = ctx.createLinearGradient(headC.x + s * r, headC.y - r, headC.x - s * r, headC.y + r);
    g.addColorStop(0, mixColor(cSkin, '#ffffff', 0.16));
    g.addColorStop(0.6, cSkin);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
  }
  ctx.fill();

  // 耳。
  if (!o.flash && !o.tint) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(headC.x - s * r * 0.55, headC.y + r * 0.1, r * 0.22, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawHair(ctx, headC, r, s, o.style, cHair, o.headDir);

  // 鉢巻き。
  if (o.gear.includes('headband') && !o.flash) {
    ctx.strokeStyle = cAcc;
    ctx.lineWidth = L(4);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(headC.x - s * r * 1.02, headC.y - r * 0.42);
    ctx.lineTo(headC.x + s * r * 1.02, headC.y - r * 0.5);
    ctx.stroke();
    // 後ろに垂れる端。
    ctx.lineWidth = L(3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headC.x - s * r * 0.9, headC.y - r * 0.4);
    ctx.quadraticCurveTo(headC.x - s * r * 2.2, headC.y - r * 0.1, headC.x - s * r * 2.6, headC.y + r * 0.9);
    ctx.stroke();
  }

  if (o.flash || o.tint) return;

  // 眉と目。表情はここで変える。
  const ex = headC.x + s * L(4.2);
  const ey = headC.y - L(1.2);
  const angry = o.expression === 'attack';
  const hurt = o.expression === 'hurt';
  ctx.strokeStyle = mixColor(cHair, '#000000', 0.25);
  ctx.lineWidth = L(1.8);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ex - s * L(2.6), ey - L(angry ? 2.4 : 3.2));
  ctx.lineTo(ex + s * L(2.4), ey - L(angry ? 3.6 : 3.4));
  ctx.stroke();

  if (hurt) {
    // 目を閉じる。
    ctx.strokeStyle = '#2a2028';
    ctx.lineWidth = L(1.6);
    ctx.beginPath();
    ctx.moveTo(ex - s * L(2), ey);
    ctx.lineTo(ex + s * L(2), ey);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, ey, L(2.4), L(angry ? 1.7 : 2.1), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20202c';
    ctx.beginPath();
    ctx.arc(ex + s * L(0.7), ey, L(1.3), 0, Math.PI * 2);
    ctx.fill();
  }

  // 鼻と口。
  ctx.strokeStyle = dark;
  ctx.lineWidth = L(1.4);
  ctx.beginPath();
  ctx.moveTo(headC.x + s * L(6.4), headC.y + L(1.6));
  ctx.lineTo(headC.x + s * L(7.6), headC.y + L(3.4));
  ctx.stroke();

  ctx.strokeStyle = '#7a3a3a';
  ctx.lineWidth = L(1.5);
  ctx.beginPath();
  if (hurt || angry) {
    // 食いしばる / 声を出す。
    ctx.moveTo(headC.x + s * L(3), headC.y + L(5));
    ctx.lineTo(headC.x + s * L(6.6), headC.y + L(5));
    ctx.stroke();
    ctx.fillStyle = '#5a2828';
    ctx.beginPath();
    ctx.ellipse(headC.x + s * L(4.8), headC.y + L(5.6), L(2.2), L(1.6), 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(headC.x + s * L(3.4), headC.y + L(5.2));
    ctx.lineTo(headC.x + s * L(6.2), headC.y + L(4.8));
    ctx.stroke();
  }
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
