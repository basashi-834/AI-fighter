/**
 * ロールバック（巻き戻し）方式の同期。
 *
 * オンライン対戦では、相手の入力が届くのを待っていると、
 * その待ち時間ぶんだけ操作が遅れます。格闘ゲームではこれが致命的です。
 *
 * そこで
 *   1. 相手の入力が来ていないフレームは「たぶん前と同じ入力だろう」と決めつけて先に進む
 *   2. あとで本当の入力が届いて、予想と違っていたら、そのフレームまで巻き戻して
 *      正しい入力でやり直す
 * という方法を取ります。自分の操作は常に遅れなく反応し、
 * ずれたときだけ画面が少し飛びます。
 *
 * これが成り立つのは、シミュレーションが完全に決定論的だからです
 * （同じ状態 + 同じ入力 → 必ず同じ結果）。engine/ 以下で小数と乱数を
 * 使っていないのは、このためです。
 */

import { cloneMatch, stepMatch, type MatchState } from '../engine/match';
import type { CharacterDef } from '../engine/types';

export interface RollbackConfig {
  /** 自分がプレイヤー 0 か 1 か。 */
  localPlayer: 0 | 1;
  /** 入力遅延（フレーム）。増やすと巻き戻しが減るが、操作が遅れる。 */
  inputDelay: number;
  /** 何フレームまで巻き戻せるか。 */
  maxRollback: number;
}

export const DEFAULT_ROLLBACK: RollbackConfig = {
  localPlayer: 0,
  inputDelay: 2,
  maxRollback: 8,
};

export interface TickResult {
  /** 何フレーム巻き戻したか（0 なら巻き戻していない）。 */
  rolledBack: number;
  /** 予測で進んだフレーム数（未確定のフレーム）。 */
  predicted: number;
}

export class RollbackSession {
  state: MatchState;
  chars: [CharacterDef, CharacterDef];
  config: RollbackConfig;

  /** 各プレイヤーの入力履歴。frame 番号でそのまま引ける。 */
  private inputs: [number[], number[]] = [[], []];
  /** そのフレームで相手の入力を「予測」したかどうか。 */
  private predicted: boolean[] = [];
  /** フレーム開始時点の状態の控え。 */
  private snapshots = new Map<number, MatchState>();
  /** 次にシミュレートするフレーム番号。 */
  frame = 0;
  /** 相手の入力が確定している最後のフレーム。 */
  remoteConfirmed = -1;
  /** ずれが直せなかった回数（表示用）。 */
  desyncs = 0;
  /** 直近の tick で巻き戻したフレーム数。 */
  private pendingRollback = 0;

  constructor(state: MatchState, chars: [CharacterDef, CharacterDef], config: Partial<RollbackConfig> = {}) {
    this.state = state;
    this.chars = chars;
    this.config = { ...DEFAULT_ROLLBACK, ...config };
  }

  private get remotePlayer(): 0 | 1 {
    return this.config.localPlayer === 0 ? 1 : 0;
  }

  /** 自分の入力を積む。実際に使われるのは inputDelay フレーム後。 */
  pushLocalInput(bits: number): number {
    const target = this.frame + this.config.inputDelay;
    this.inputs[this.config.localPlayer][target] = bits;
    return target;
  }

  /** 相手から届いた入力。frame は「そのフレームの入力」。 */
  pushRemoteInput(frame: number, bits: number): void {
    const rp = this.remotePlayer;
    const known = this.inputs[rp][frame];
    this.inputs[rp][frame] = bits;
    if (frame > this.remoteConfirmed) this.remoteConfirmed = frame;
    // すでにそのフレームを予測で通り過ぎていて、予測が外れていたら巻き戻す。
    if (frame < this.frame && this.predicted[frame] && known !== bits) {
      this.rollbackTo(frame);
    }
    if (frame < this.frame) this.predicted[frame] = false;
  }

  private inputFor(player: 0 | 1, frame: number): number {
    const v = this.inputs[player][frame];
    return v == null ? 0 : v;
  }

  /** 相手の入力の予測。直前に確定している入力をそのまま使う。 */
  private predictRemote(frame: number): number {
    const rp = this.remotePlayer;
    for (let f = Math.min(frame, this.remoteConfirmed); f >= 0; f--) {
      const v = this.inputs[rp][f];
      if (v != null) return v;
    }
    return 0;
  }

  /** 1 フレーム進める。 */
  tick(localBits: number): TickResult {
    this.pushLocalInput(localBits);
    // 巻き戻しは pushRemoteInput の中で済ませてある。ここでは前へ進めるだけ。
    const rolled = this.pendingRollback;
    this.pendingRollback = 0;
    this.simulateFrame(this.frame);

    const predictedCount = this.frame - 1 - this.remoteConfirmed;
    return { rolledBack: rolled, predicted: Math.max(0, predictedCount) };
  }

  private simulateFrame(frame: number): void {
    // フレーム開始時点を控えておく（巻き戻し先）。
    this.snapshots.set(frame, cloneMatch(this.state));
    const limit = frame - this.config.maxRollback - 2;
    for (const key of this.snapshots.keys()) {
      if (key < limit) this.snapshots.delete(key);
    }

    const rp = this.remotePlayer;
    const known = this.inputs[rp][frame];
    const remote = known != null ? known : this.predictRemote(frame);
    this.predicted[frame] = known == null;

    const local = this.inputFor(this.config.localPlayer, frame);
    const pair: [number, number] =
      this.config.localPlayer === 0 ? [local, remote] : [remote, local];
    stepMatch(this.state, this.chars, pair);
    this.frame = frame + 1;
  }

  /** frame まで巻き戻して、そこからやり直す。 */
  private rollbackTo(frame: number): number {
    const snap = this.snapshots.get(frame);
    if (!snap) {
      // 控えが残っていない＝巻き戻せる範囲を超えた。
      this.desyncs++;
      return 0;
    }
    const target = this.frame;
    this.state = cloneMatch(snap);
    this.frame = frame;
    while (this.frame < target) this.simulateFrame(this.frame);
    this.pendingRollback = Math.max(this.pendingRollback, target - frame);
    return target - frame;
  }

  /** 表示用：今どのくらい予測で走っているか。 */
  get predictionDepth(): number {
    return Math.max(0, this.frame - 1 - this.remoteConfirmed);
  }
}
