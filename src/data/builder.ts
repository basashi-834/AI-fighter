/**
 * 技データを書くための道具立て。
 *
 * 技は数が多いので、毎回すべての項目を書いていると
 * 「どこがこのキャラらしさなのか」が数字の海に埋もれてしまいます。
 * ここで既定値をまとめておき、キャラクターごとのファイルには
 * **そのキャラで変えたところだけ**を書くようにしています。
 */

import { px } from '../engine/constants';
import type {
  Box,
  Button,
  CancelRule,
  GuardKind,
  HitProps,
  MoveDef,
  Stance,
} from '../engine/types';

/** ヒット性能の既定値。 */
export const BASE_HIT: HitProps = {
  damage: 40,
  chip: 0,
  hitAdvantage: 3,
  blockAdvantage: 0,
  hitstop: 8,
  guardstop: 8,
  pushbackHit: px(1.6),
  pushbackBlock: px(2.2),
  selfPushback: px(0.8),
  guard: 'mid',
  knockdown: 'none',
  launchX: px(2.4),
  launchY: px(6.0),
  meterGainAttacker: 30,
  meterGainDefender: 15,
  counterBonus: 6,
  scalingWeight: 1,
  effect: 'light',
  shake: 2,
};

export function hit(over: Partial<HitProps>): HitProps {
  return { ...BASE_HIT, ...over };
}

/** 「通常技から必殺技へ」の標準のキャンセル設定。 */
export function specialCancel(from: number, to: number): CancelRule {
  return { kind: 'special', from, to, onHit: true, onBlock: true, onWhiff: false };
}

export function superCancel(from: number, to: number): CancelRule {
  return { kind: 'super', from, to, onHit: true, onBlock: true, onWhiff: false };
}

export function targetCancel(from: number, to: number, into: string[]): CancelRule {
  return { kind: 'target', from, to, onHit: true, onBlock: true, onWhiff: false, into };
}

/** 通常技を書くための短い形。 */
export interface NormalSpec {
  id: string;
  name: string;
  nameJa: string;
  stance: Stance;
  button: Button;
  /** 発生 / 持続 / 硬直 */
  f: [number, number, number];
  /** ヒット時 / ガード時の硬直差 */
  adv: [number, number];
  damage: number;
  /** 攻撃判定 [前方x, 高さy, 幅w, 高さh]。複数書ける。 */
  boxes: [number, number, number, number][];
  guard?: GuardKind;
  /** 技中の食らい判定（足払いなど、伸びた部分が殴られる技用）。 */
  hurt?: [number, number, number, number][];
  knockdown?: HitProps['knockdown'];
  launch?: [number, number];
  hitstop?: number;
  guardstop?: number;
  chip?: number;
  pushHit?: number;
  pushBlock?: number;
  effect?: HitProps['effect'];
  shake?: number;
  meterGain?: number;
  /** 空中技の着地硬直。 */
  landing?: number;
  cancels?: CancelRule[];
  pose: string;
  sfx?: MoveDef['sfx'];
  aiTags?: MoveDef['aiTags'];
  counterBonus?: number;
}

function toBox(b: [number, number, number, number]): Box {
  return { x: b[0], y: b[1], w: b[2], h: b[3] };
}

/** NormalSpec から MoveDef を作る。 */
export function normal(spec: NormalSpec): MoveDef {
  const air = spec.stance === 'air';
  const m: MoveDef = {
    id: spec.id,
    name: spec.name,
    nameJa: spec.nameJa,
    input: { motion: 'none', button: spec.button, stances: [spec.stance] },
    startup: spec.f[0],
    active: spec.f[1],
    recovery: spec.f[2],
    hitboxes: spec.boxes.map(toBox),
    hit: hit({
      damage: spec.damage,
      hitAdvantage: spec.adv[0],
      blockAdvantage: spec.adv[1],
      guard: spec.guard ?? (air ? 'high' : 'mid'),
      knockdown: spec.knockdown ?? 'none',
      launchX: spec.launch ? px(spec.launch[0]) : BASE_HIT.launchX,
      launchY: spec.launch ? px(spec.launch[1]) : BASE_HIT.launchY,
      hitstop: spec.hitstop ?? (spec.damage >= 80 ? 12 : spec.damage >= 55 ? 10 : 8),
      guardstop: spec.guardstop ?? (spec.damage >= 80 ? 11 : spec.damage >= 55 ? 9 : 7),
      chip: spec.chip ?? 0,
      pushbackHit: spec.pushHit != null ? px(spec.pushHit) : BASE_HIT.pushbackHit,
      pushbackBlock: spec.pushBlock != null ? px(spec.pushBlock) : BASE_HIT.pushbackBlock,
      effect: spec.effect ?? (spec.damage >= 80 ? 'heavy' : spec.damage >= 55 ? 'medium' : 'light'),
      shake: spec.shake ?? (spec.damage >= 80 ? 5 : spec.damage >= 55 ? 3 : 2),
      meterGainAttacker: spec.meterGain ?? Math.round(spec.damage * 0.7),
      meterGainDefender: Math.round((spec.meterGain ?? Math.round(spec.damage * 0.7)) / 2),
      counterBonus: spec.counterBonus ?? (spec.damage >= 80 ? 12 : 6),
    }),
    cancels: spec.cancels ?? [],
    pose: spec.pose,
  };
  if (spec.hurt) m.hurtboxes = spec.hurt.map(toBox);
  if (air) {
    m.landingRecovery = spec.landing ?? 4;
    m.air = true;
    m.airborne = { from: 1, to: 'landing' };
  }
  if (spec.sfx) m.sfx = spec.sfx;
  if (spec.aiTags) m.aiTags = spec.aiTags;
  return m;
}

/** 標準の体の判定。体格 build で全体を伸縮できる。 */
export function standardBoxes(build: number) {
  const s = (n: number) => Math.round(n * build);
  return {
    stand: {
      hurt: [
        { x: s(-14), y: 0, w: s(30), h: s(38) },
        { x: s(-16), y: s(38), w: s(34), h: s(38) },
        { x: s(-12), y: s(76), w: s(26), h: s(26) },
      ],
      push: { x: s(-19), y: 0, w: s(38), h: s(102) },
    },
    crouch: {
      hurt: [
        { x: s(-17), y: 0, w: s(36), h: s(26) },
        { x: s(-16), y: s(26), w: s(36), h: s(26) },
        { x: s(-13), y: s(52), w: s(28), h: s(20) },
      ],
      push: { x: s(-21), y: 0, w: s(42), h: s(72) },
    },
    air: {
      hurt: [
        { x: s(-16), y: s(6), w: s(30), h: s(20) },
        { x: s(-14), y: s(26), w: s(30), h: s(32) },
        { x: s(-12), y: s(58), w: s(26), h: s(24) },
      ],
      push: { x: s(-17), y: s(10), w: s(34), h: s(64) },
    },
  };
}
