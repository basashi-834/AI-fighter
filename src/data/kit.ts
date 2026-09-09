/**
 * 通常技の基本セット。
 *
 * どのキャラクターも「立ち・しゃがみ・ジャンプ × 弱中強 × パンチ・キック」の
 * 18 個の通常技を持ちます。数字の骨格はここで共通に決めておき、
 * キャラクターごとのファイルでは
 *   - 全体の倍率（リーチ・威力・発生）
 *   - 個別に差し替えたい技
 * だけを書きます。こうすると「このキャラはここが違う」が一目で分かります。
 */

import type { MoveDef } from '../engine/types';
import { normal, specialCancel, superCancel, targetCancel, type NormalSpec } from './builder';

/** 弱攻撃から繋げられる技（チェーンコンボ）。 */
const LIGHT_CHAIN = ['5lp', '2lp', '5lk', '2lk', '5mp', '2mp', '5mk', '2mk'];

export interface KitProfile {
  /** 攻撃の届く距離の倍率。1.0 が標準。 */
  reach: number;
  /** 威力の倍率。 */
  power: number;
  /** 発生フレームの増減（＋で遅くなる）。 */
  startupDelta: number;
  /** 硬直フレームの増減。 */
  recoveryDelta: number;
  /** 体格。判定の縦の位置に効く。 */
  build: number;
}

export const STANDARD_PROFILE: KitProfile = {
  reach: 1,
  power: 1,
  startupDelta: 0,
  recoveryDelta: 0,
  build: 1,
};

type Spec = Omit<NormalSpec, 'cancels'> & { cancels?: NormalSpec['cancels'] };

/** 技の骨格。ここの数字が全キャラ共通の土台になる。 */
function baseSpecs(): Spec[] {
  return [
    // ---- 立ち ----
    {
      id: '5lp', name: 'Stand LP', nameJa: '立ち弱パンチ', stance: 'stand', button: 'LP',
      f: [4, 3, 7], adv: [5, 2], damage: 30, boxes: [[14, 58, 40, 18]],
      pose: 'jab', sfx: 'swing_l', aiTags: ['poke', 'combo'],
    },
    {
      id: '5mp', name: 'Stand MP', nameJa: '立ち中パンチ', stance: 'stand', button: 'MP',
      f: [6, 3, 12], adv: [4, 0], damage: 60, boxes: [[12, 54, 52, 22]],
      pose: 'straight', sfx: 'swing_m', aiTags: ['poke', 'combo'],
    },
    {
      id: '5hp', name: 'Stand HP', nameJa: '立ち強パンチ', stance: 'stand', button: 'HP',
      f: [9, 4, 17], adv: [3, -4], damage: 90, boxes: [[10, 50, 62, 28]],
      pose: 'hook', sfx: 'swing_h', aiTags: ['punish', 'combo'],
    },
    {
      id: '5lk', name: 'Stand LK', nameJa: '立ち弱キック', stance: 'stand', button: 'LK',
      f: [5, 3, 8], adv: [4, 1], damage: 30, boxes: [[14, 28, 42, 18]],
      pose: 'lowkick', sfx: 'swing_l', aiTags: ['poke'],
    },
    {
      id: '5mk', name: 'Stand MK', nameJa: '立ち中キック', stance: 'stand', button: 'MK',
      f: [8, 4, 13], adv: [3, -2], damage: 65, boxes: [[12, 34, 60, 24]],
      hurt: [[-14, 0, 30, 38], [-16, 38, 34, 38], [-12, 76, 26, 26], [16, 30, 34, 18]],
      pose: 'roundhouse', sfx: 'swing_m', aiTags: ['poke'],
    },
    {
      id: '5hk', name: 'Stand HK', nameJa: '立ち強キック', stance: 'stand', button: 'HK',
      f: [12, 4, 20], adv: [8, -8], damage: 95, boxes: [[10, 40, 66, 30]],
      knockdown: 'soft', launch: [3.2, 5.2], effect: 'heavy',
      hurt: [[-14, 0, 30, 38], [-16, 38, 34, 38], [-12, 76, 26, 26], [16, 36, 42, 22]],
      pose: 'highkick', sfx: 'swing_h', aiTags: ['punish'],
    },

    // ---- しゃがみ ----
    {
      id: '2lp', name: 'Crouch LP', nameJa: 'しゃがみ弱パンチ', stance: 'crouch', button: 'LP',
      f: [4, 3, 7], adv: [5, 2], damage: 28, boxes: [[12, 42, 40, 16]],
      pose: 'crouchjab', sfx: 'swing_l', aiTags: ['poke', 'combo'],
    },
    {
      id: '2mp', name: 'Crouch MP', nameJa: 'しゃがみ中パンチ', stance: 'crouch', button: 'MP',
      f: [6, 4, 11], adv: [4, 0], damage: 55, boxes: [[12, 38, 50, 22]],
      pose: 'crouchpunch', sfx: 'swing_m', aiTags: ['poke', 'combo'],
    },
    {
      id: '2hp', name: 'Crouch HP', nameJa: 'しゃがみ強パンチ', stance: 'crouch', button: 'HP',
      f: [8, 5, 19], adv: [10, -9], damage: 85, boxes: [[6, 44, 46, 54]],
      knockdown: 'launch', launch: [2.0, 8.4], effect: 'heavy',
      pose: 'antiair', sfx: 'swing_h', aiTags: ['antiAir'],
    },
    {
      id: '2lk', name: 'Crouch LK', nameJa: 'しゃがみ弱キック', stance: 'crouch', button: 'LK',
      f: [5, 3, 8], adv: [4, 0], damage: 25, boxes: [[14, 6, 42, 16]], guard: 'low',
      pose: 'lowjab', sfx: 'swing_l', aiTags: ['lowStarter', 'combo'],
    },
    {
      id: '2mk', name: 'Crouch MK', nameJa: 'しゃがみ中キック', stance: 'crouch', button: 'MK',
      f: [8, 4, 14], adv: [2, -3], damage: 60, boxes: [[12, 4, 60, 20]], guard: 'low',
      hurt: [[-17, 0, 36, 26], [-16, 26, 36, 26], [-13, 52, 28, 20], [18, 0, 40, 16]],
      pose: 'lowpoke', sfx: 'swing_m', aiTags: ['lowStarter', 'poke'],
    },
    {
      id: '2hk', name: 'Sweep', nameJa: '足払い', stance: 'crouch', button: 'HK',
      f: [10, 4, 22], adv: [20, -12], damage: 85, boxes: [[10, 2, 70, 18]], guard: 'low',
      knockdown: 'hard', launch: [3.6, 2.2], effect: 'heavy', shake: 5,
      hurt: [[-17, 0, 36, 26], [-16, 26, 36, 26], [-13, 52, 28, 20], [20, 0, 52, 16]],
      pose: 'sweep', sfx: 'swing_h', aiTags: ['lowStarter', 'punish'],
    },

    // ---- ジャンプ ----
    {
      id: 'jlp', name: 'Jump LP', nameJa: 'ジャンプ弱パンチ', stance: 'air', button: 'LP',
      f: [5, 6, 8], adv: [6, 3], damage: 30, boxes: [[10, 32, 42, 20]], landing: 3,
      pose: 'airjab', sfx: 'swing_l', aiTags: ['poke'],
    },
    {
      id: 'jmp', name: 'Jump MP', nameJa: 'ジャンプ中パンチ', stance: 'air', button: 'MP',
      f: [7, 6, 10], adv: [6, 3], damage: 60, boxes: [[10, 26, 48, 26]], landing: 4,
      pose: 'airpunch', sfx: 'swing_m', aiTags: ['poke'],
    },
    {
      id: 'jhp', name: 'Jump HP', nameJa: 'ジャンプ強パンチ', stance: 'air', button: 'HP',
      f: [9, 5, 12], adv: [7, 4], damage: 90, boxes: [[8, 18, 54, 34]], landing: 5,
      pose: 'airsmash', sfx: 'swing_h', aiTags: ['combo'],
    },
    {
      id: 'jlk', name: 'Jump LK', nameJa: 'ジャンプ弱キック', stance: 'air', button: 'LK',
      f: [5, 6, 8], adv: [6, 3], damage: 30, boxes: [[12, 14, 40, 22]], landing: 3,
      pose: 'airkick', sfx: 'swing_l', aiTags: ['poke'],
    },
    {
      id: 'jmk', name: 'Jump MK', nameJa: 'ジャンプ中キック', stance: 'air', button: 'MK',
      f: [7, 8, 10], adv: [6, 3], damage: 65, boxes: [[10, 4, 50, 32]], landing: 4,
      pose: 'jumpin', sfx: 'swing_m', aiTags: ['combo'],
    },
    {
      id: 'jhk', name: 'Jump HK', nameJa: 'ジャンプ強キック', stance: 'air', button: 'HK',
      f: [9, 5, 14], adv: [7, 4], damage: 95, boxes: [[8, -2, 54, 36]], landing: 6,
      knockdown: 'soft', launch: [3.0, 4.0], effect: 'heavy',
      pose: 'divekick', sfx: 'swing_h', aiTags: ['combo'],
    },
  ];
}

/** 弱・中・強のどれかを id から判定する。 */
function strengthOf(id: string): 'l' | 'm' | 'h' {
  if (id.endsWith('lp') || id.endsWith('lk')) return 'l';
  if (id.endsWith('mp') || id.endsWith('mk')) return 'm';
  return 'h';
}

/** 既定のキャンセル設定を技につける。 */
function defaultCancels(spec: Spec): NormalSpec['cancels'] {
  if (spec.stance === 'air') return [];
  const total = spec.f[0] - 1 + spec.f[1] + spec.f[2];
  const from = spec.f[0];
  const to = Math.min(total, spec.f[0] + spec.f[1] + 3);
  const s = strengthOf(spec.id);
  const rules: NormalSpec['cancels'] = [specialCancel(from, to), superCancel(from, to)];
  if (s === 'l') {
    rules.unshift(targetCancel(from, to, LIGHT_CHAIN.filter((x) => x !== spec.id)));
  }
  if (spec.id === '2hk') {
    // 足払いは必殺技キャンセルできない（強すぎるため）。超必のみ。
    return [superCancel(from, to)];
  }
  return rules;
}

/**
 * 通常技一式を作る。
 * overrides に同じ id の NormalSpec の一部を渡すと、その項目だけ差し替わる。
 */
export function buildNormals(
  profile: Partial<KitProfile> = {},
  overrides: Partial<Record<string, Partial<NormalSpec>>> = {},
): MoveDef[] {
  const p = { ...STANDARD_PROFILE, ...profile };
  return baseSpecs().map((base) => {
    const ov = overrides[base.id] ?? {};
    const spec: NormalSpec = {
      ...base,
      ...ov,
      cancels: ov.cancels ?? base.cancels ?? defaultCancels({ ...base, ...ov } as Spec),
    } as NormalSpec;

    // プロファイルの倍率をかける（overrides で明示したものはそのまま）。
    if (ov.damage == null) spec.damage = Math.round(base.damage * p.power);
    if (ov.f == null) {
      spec.f = [
        Math.max(1, base.f[0] + p.startupDelta),
        base.f[1],
        Math.max(1, base.f[2] + p.recoveryDelta),
      ];
    }
    if (ov.boxes == null) {
      spec.boxes = base.boxes.map(([x, y, w, h]) => [
        Math.round(x * p.reach),
        Math.round(y * p.build),
        Math.round(w * p.reach),
        Math.round(h * p.build),
      ]);
    }
    if (ov.hurt == null && base.hurt) {
      spec.hurt = base.hurt.map(([x, y, w, h]) => [
        Math.round(x * (x > 0 ? p.reach : p.build)),
        Math.round(y * p.build),
        Math.round(w * (x > 0 ? p.reach : p.build)),
        Math.round(h * p.build),
      ]);
    }
    return normal(spec);
  });
}

/** 全キャラ共通の投げ。 */
export function makeThrow(id: string, nameJa: string, damage: number, range: number): MoveDef {
  return {
    id,
    name: 'Throw',
    nameJa,
    input: { motion: 'none', stances: ['stand', 'crouch'], buttons: ['LP', 'LK'] },
    startup: 5,
    active: 2,
    recovery: 20,
    hitboxes: [],
    hit: {
      damage,
      chip: 0,
      hitAdvantage: 0,
      blockAdvantage: 0,
      hitstop: 10,
      guardstop: 0,
      pushbackHit: 0,
      pushbackBlock: 0,
      selfPushback: 0,
      guard: 'unblockable',
      knockdown: 'hard',
      launchX: 0,
      launchY: 0,
      meterGainAttacker: 80,
      meterGainDefender: 40,
      counterBonus: 0,
      scalingWeight: 1,
      effect: 'heavy',
      shake: 5,
    },
    throwSpec: {
      range,
      hitsAir: false,
      hitsGround: true,
      holdFrames: 14,
      techable: true,
      dropX: -46,
      damage,
      knockdown: 'hard',
      launchX: 0,
      launchY: 0,
      meterGainAttacker: 80,
      meterGainDefender: 40,
      hitstun: 40,
    },
    cancels: [],
    pose: 'throw',
    sfx: 'grab',
    aiTags: ['grab'],
  };
}
