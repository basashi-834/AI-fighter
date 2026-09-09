/**
 * 技データ・キャラクターデータの型定義。
 *
 * フレームの数えかた（前作から引き継いだ決めごと）
 * ------------------------------------------------
 *   技は 1F 目から始まり、全体フレーム T = (発生 - 1) + 持続 + 硬直 まで続く。
 *
 *     1 .. startup-1                     発生前
 *     startup .. startup+active-1        攻撃判定が出ている
 *     startup+active .. T                硬直
 *     T+1                                行動可能
 *
 *   つまり「発生 4F」は 4 フレーム目に最初の攻撃判定が出るという意味。
 *
 * 硬直差について
 * --------------
 *   hitAdvantage / blockAdvantage を**データに直接書きます**。
 *   のけぞり時間はそこから逆算するので、表に書いた数字と実際の挙動が
 *   食い違うことがありません。
 *
 *     のけぞり H = 硬直差 + (T - startup) + 1
 *
 *   これで「発生フレームちょうどで当てたとき」に書いたとおりの硬直差になり、
 *   持続の後ろのほうを当てる（＝重ねる）ほど自動的に有利になります。
 *
 *   コンボ確定 : 前の技の hitAdvantage >= 次の技の startup
 *   確定反撃   : |blockAdvantage| >= 相手の技の startup
 */

/** 当たり判定の矩形。前方が +x、足元が y=0 で上が +y。単位はピクセル。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ガードの種類。 */
export type GuardKind = 'high' | 'low' | 'mid' | 'unblockable';

/** 立ち／しゃがみ／空中。 */
export type Stance = 'stand' | 'crouch' | 'air';

/** ボタン。 */
export type Button = 'LP' | 'MP' | 'HP' | 'LK' | 'MK' | 'HK';

/** コマンド入力の種類。 */
export type Motion =
  | 'none'
  | '236'    // 波動拳
  | '214'    // 逆
  | '623'    // 昇龍拳
  | '421'    // 逆昇龍
  | '41236'  // 半回転（前）
  | '63214'  // 半回転（後ろ）
  | '236236' // 超必殺（前）
  | '214214' // 超必殺（後ろ）
  | '632146' // コマンド投げ超必殺
  | 'charge_back'  // ため（後ろ→前）
  | 'charge_down'; // ため（下→上）

/** ダウンの種類。 */
export type KnockdownKind = 'none' | 'soft' | 'hard' | 'launch' | 'wallbounce';

/** 無敵の種類。 */
export type InvulnKind = 'full' | 'strike' | 'throw' | 'projectile';

export interface InvulnWindow {
  from: number;
  to: number;
  kind: InvulnKind;
}

/** スーパーアーマー（のけぞらずに耐える）。 */
export interface ArmorWindow {
  from: number;
  to: number;
  /** 何発まで耐えるか。 */
  hits: number;
  /** アーマーで受けたときのダメージ倍率（%）。 */
  damageScale: number;
}

/** ヒット時の性質。 */
export interface HitProps {
  damage: number;
  /** ガードされたときの削りダメージ。 */
  chip: number;
  /** ヒット時硬直差。 */
  hitAdvantage: number;
  /** ガード時硬直差（ふつうは負の数）。 */
  blockAdvantage: number;
  /** ヒットストップ（当てた側・喰らった側の両方が同時に止まる）。 */
  hitstop: number;
  /** ガードストップ。 */
  guardstop: number;
  /** ヒット時に相手を押し出す初速。 */
  pushbackHit: number;
  /** ガード時に相手を押し出す初速。 */
  pushbackBlock: number;
  /** 自分が下がる初速（画面端で相手が下がれないぶんの反作用にも使う）。 */
  selfPushback: number;
  guard: GuardKind;
  knockdown: KnockdownKind;
  /** 打ち上げ／吹き飛ばしの初速（内部単位）。 */
  launchX: number;
  launchY: number;
  /** 空中の相手に当てたときののけぞり（省略時は地上と同じ）。 */
  airHitstun?: number;
  /** 当てたときのゲージ増加量。 */
  meterGainAttacker: number;
  /** 喰らったときのゲージ増加量。 */
  meterGainDefender: number;
  /** カウンターヒット時の追加のけぞりフレーム。 */
  counterBonus: number;
  /** ダメージ補正の重み（コンボ中に何段目として数えるか）。1.0 = 通常。 */
  scalingWeight: number;
  /** ヒット演出の大きさ（描画用）。 */
  effect: 'light' | 'medium' | 'heavy' | 'slash' | 'burn';
  /** 画面揺れの強さ。 */
  shake: number;
}

/** キャンセルの種類。 */
export type CancelKind = 'special' | 'super' | 'target' | 'dash';

export interface CancelRule {
  kind: CancelKind;
  /** 何フレーム目から何フレーム目までキャンセルできるか（技の 1F 目基準）。 */
  from: number;
  to: number;
  onHit: boolean;
  onBlock: boolean;
  onWhiff: boolean;
  /** kind === 'target' のときの派生先技 ID。 */
  into?: string[];
}

/** 技中に自分を動かすベクトル。frame 目に速度を上書きする。 */
export interface MoveVelocity {
  frame: number;
  vx: number;
  vy: number;
  /** true なら加算、false なら上書き。 */
  add?: boolean;
}

/** 飛び道具の仕様。 */
export interface ProjectileSpec {
  /** 何フレーム目に出すか。 */
  spawnFrame: number;
  /** 出現位置（前方 +x、足元から上へ +y、px）。 */
  ox: number;
  oy: number;
  vx: number;
  /** 判定の大きさ。 */
  box: Box;
  /** 消えるまでのフレーム数。 */
  life: number;
  /** 相殺の強さ。同じか弱い弾を消す。 */
  power: number;
  hit: HitProps;
  /** 描画スタイル。 */
  style: 'fireball' | 'orb' | 'wave';
  /** 画面に同時に出せる数。 */
  maxActive: number;
}

/** 投げの仕様。 */
export interface ThrowSpec {
  /** 掴める距離（px）。 */
  range: number;
  /** 空中の相手を掴めるか。 */
  hitsAir: boolean;
  /** 地上の相手を掴めるか。 */
  hitsGround: boolean;
  /** 掴んでから離すまでのフレーム数（この間は相手を拘束）。 */
  holdFrames: number;
  /** 投げ抜け可能か。 */
  techable: boolean;
  /** 投げ後に相手を置く位置（前方 +x, px）。負なら後ろ。 */
  dropX: number;
  damage: number;
  /** 投げ終わりの相手の状態。 */
  knockdown: KnockdownKind;
  launchX: number;
  launchY: number;
  meterGainAttacker: number;
  meterGainDefender: number;
  /** 相手の硬直（投げ抜け不可の拘束が解けたあと）。 */
  hitstun: number;
}

/** 技の発動条件。 */
export interface MoveInput {
  motion: Motion;
  button?: Button;
  /** どの姿勢から出せるか。 */
  stances: Stance[];
  /** 同時押しで出す（投げなど）。 */
  buttons?: Button[];
}

/** 1 フレームだけ判定を差し替えるための指定。 */
export interface FrameBoxes {
  frame: number;
  hitboxes?: Box[];
  hurtboxes?: Box[];
}

export interface MoveDef {
  id: string;
  name: string;
  /** 表示名（日本語）。 */
  nameJa: string;
  input: MoveInput;
  startup: number;
  active: number;
  recovery: number;
  /** 空中技が着地したあとの硬直。 */
  landingRecovery?: number;
  /** 攻撃判定（持続中ずっと有効）。 */
  hitboxes: Box[];
  /** 技中の食らい判定の差し替え。省略時は姿勢どおり。 */
  hurtboxes?: Box[];
  /** フレーム単位の差し替え。 */
  frameBoxes?: FrameBoxes[];
  hit: HitProps;
  cancels: CancelRule[];
  /** ゲージ消費量。 */
  meterCost?: number;
  /** 技中の空中判定。'landing' なら着地するまで空中扱い。 */
  airborne?: { from: number; to: number | 'landing' };
  invuln?: InvulnWindow[];
  armor?: ArmorWindow;
  velocity?: MoveVelocity[];
  projectile?: ProjectileSpec;
  throwSpec?: ThrowSpec;
  /** 多段ヒット。interval フレームおきに times 回まで当たる。 */
  multiHit?: { times: number; interval: number };
  /** 超必殺技の暗転フレーム。 */
  superFreeze?: number;
  /** 技終了後の姿勢（省略時は出したときの姿勢へ戻る）。 */
  endStance?: Stance;
  /** 空中で出せる技か。 */
  air?: boolean;
  /** 1 回の空中行動で 1 回だけ出せる（空中必殺技用）。 */
  onceInAir?: boolean;
  /** 描画用のポーズ名。 */
  pose: string;
  /** 効果音の種類。 */
  sfx?: 'swing_l' | 'swing_m' | 'swing_h' | 'fire' | 'shout' | 'grab';
  /** CPU が使うときのおおまかな用途。 */
  aiTags?: AiTag[];
}

export type AiTag =
  | 'poke'        // 差し合いの牽制
  | 'antiAir'     // 対空
  | 'lowStarter'  // 下段始動
  | 'overhead'    // 中段
  | 'combo'       // コンボパーツ
  | 'reversal'    // 無敵切り返し
  | 'zoning'      // 飛び道具
  | 'punish'      // 確定反撃用の大技
  | 'grab';       // 投げ

/** 姿勢ごとの標準の判定。 */
export interface StanceBoxes {
  hurt: Box[];
  push: Box;
}

/** 見た目の設定。 */
export interface Appearance {
  /** 基本色（胴・脚・肌・髪・アクセント）。 */
  gi: string;
  giDark: string;
  skin: string;
  hair: string;
  accent: string;
  /** 体格。1.0 が標準。 */
  build: number;
  /** 髪型。 */
  hairStyle: 'short' | 'long' | 'spiky' | 'bun' | 'bald' | 'ponytail';
  /** 肌の陰の色。省略時は肌色から自動で作る。 */
  skinDark?: string;
  /** 身につけているもの。描画のときに追加で描く。 */
  gear?: Gear[];
  /** 顔立ち。 */
  face?: 'stern' | 'sharp' | 'calm' | 'fierce';
}

/** 装備品。キャラクターの見分けをつけるための描き足し。 */
export type Gear =
  | 'headband'      // 鉢巻き（後ろに垂れる）
  | 'gloves'        // 手甲
  | 'boots'         // ブーツ
  | 'barefoot'      // 裸足
  | 'shoulderpads'  // 肩当て
  | 'wristwraps'    // 手首の巻き布
  | 'openJacket'    // 前を開けた上着
  | 'sash';         // たすき

export interface CharacterDef {
  id: string;
  name: string;
  nameJa: string;
  /** ひとことキャッチ。 */
  tagline: string;
  health: number;
  /** スタン値（気絶するまで）。 */
  stun: number;
  walkForward: number;
  walkBack: number;
  jumpVy: number;
  jumpVx: number;
  /** 前ジャンプ・後ろジャンプの水平速度が違う場合に使う。 */
  backJumpVx: number;
  /** ジャンプの予備動作（この間は地上判定）。 */
  jumpStartup: number;
  /** 着地硬直。 */
  landingLag: number;
  /** 前進の方式。 */
  dash: { kind: 'dash' | 'step'; frames: number; speed: number; recovery: number };
  backdash: { frames: number; speed: number; recovery: number; invuln: number };
  /** 体重（吹き飛びやすさ）。100 が標準。数字が大きいほど飛ばない。 */
  weight: number;
  boxes: { stand: StanceBoxes; crouch: StanceBoxes; air: StanceBoxes };
  moves: MoveDef[];
  appearance: Appearance;
  /** CPU の性格（0-100）。 */
  ai: { aggression: number; defense: number; zoning: number; execution: number };
}
