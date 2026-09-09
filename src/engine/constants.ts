/**
 * ゲーム全体で使う定数。
 *
 * 座標について
 * ------------
 * 内部の座標はすべて「整数」で持ちます。小数を使うと機種やブラウザによって
 * 計算結果が 1 ビットずれることがあり、ロールバック（巻き戻し）や
 * オンライン対戦で「同じ入力なのに違う結果になる」事故が起きるためです。
 *
 * 1 ピクセル = FP 単位（サブピクセル）として持ち、描画や判定のときだけ
 * ピクセルへ落とします。落とすときは常に floor（切り捨て）で統一します。
 */
export const FPS = 60;

/** 1 ピクセルあたりの内部単位数。2 の累乗にしておくとビットシフトで割れる。 */
export const FP = 256;
export const FP_SHIFT = 8;

/** ピクセル値 → 内部単位。データ記述用のヘルパ。 */
export function px(n: number): number {
  return Math.round(n * FP);
}

/** 内部単位 → ピクセル（常に切り捨て。負数でも floor になる算術シフト）。 */
export function toPx(n: number): number {
  return n >> FP_SHIFT;
}

/** 描画の内部解像度。ここに描いてから整数倍で拡大する。 */
export const VIEW_W = 480;
export const VIEW_H = 270;

/** 地面の高さ（画面下からのピクセル数）。 */
export const FLOOR_SCREEN_Y = 232;

/** ステージの半幅（px）。x = -STAGE_HALF 〜 +STAGE_HALF が壁の内側。 */
export const STAGE_HALF = 520;

/**
 * 2 人が離れられる最大距離（px）。
 * カメラ幅 480 からキャラクター 1 体ぶん（約 76px）を引いた値にしてあるので、
 * いちばん離れたときに 2 人の絵の外側が画面の左右の端とちょうど重なる。
 */
export const MAX_SEPARATION = 404;

/** 重力（内部単位 / フレーム^2）。 */
export const GRAVITY = px(0.62);

/** 1 ラウンドの制限時間（フレーム）。99 カウント x 60F。 */
export const ROUND_TIME_FRAMES = 99 * 60;

/** 超必殺技ゲージの最大値。1 本 = 1000。 */
export const METER_MAX = 3000;
export const METER_PER_BAR = 1000;

/** 入力バッファの長さ（フレーム）。 */
export const INPUT_BUFFER_FRAMES = 10;

/** コマンド入力の猶予（フレーム）。 */
export const MOTION_WINDOW = 14;

/** ダッシュ・バックダッシュの 2 回入力猶予（フレーム）。 */
export const DASH_WINDOW = 12;

/** ラウンド開始演出・決着演出の長さ（フレーム）。 */
export const ROUND_INTRO_FRAMES = 100;
export const ROUND_OUTRO_FRAMES = 150;

/** 何ラウンド先取で勝ちか。 */
export const ROUNDS_TO_WIN = 2;

/** ダメージ補正の下限（%）。 */
export const MIN_SCALING = 10;

/**
 * 空中の相手を続けて打ち上げられる回数の上限。
 * これが無いと、浮かせた相手を延々と殴り続けられてしまいます。
 */
export const JUGGLE_LIMIT = 4;

/**
 * のけぞり時間の減衰。
 *
 * コンボが伸びるほど、のけぞりが 1 フレームずつ短くなります。
 * これが無いと「発生 4F・ヒット +5F」の弱パンチが自分自身に
 * 永久につながってしまいます（+5 >= 4 なので、いつまでも間に合う）。
 * 減っていくことで、3 発目あたりで自然につながらなくなります。
 */
export const HITSTUN_DECAY_START = 2;
export const HITSTUN_DECAY_MAX = 6;
/** 減衰しても、元ののけぞりのこの割合は下回らない（%）。 */
export const HITSTUN_DECAY_FLOOR = 60;

/** のけぞり中に受け身を取れない（ダウン）時間などの共通値。 */
export const WAKEUP_FRAMES = 26;
export const HARD_KNOCKDOWN_FRAMES = 46;
export const SOFT_KNOCKDOWN_FRAMES = 30;
