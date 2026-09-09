/**
 * キーボードとゲームパッドを、1 フレームぶんの入力ビットに変換する。
 *
 * 「どのキーを押したか」をここで吸収してしまうので、
 * ゲーム本体は入力ビットしか知りません。あとからパッドを足すのも簡単です。
 */

import {
  IN_DOWN,
  IN_HK,
  IN_HP,
  IN_LEFT,
  IN_LK,
  IN_LP,
  IN_MK,
  IN_MP,
  IN_RIGHT,
  IN_UP,
} from '../engine/input';

export interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  lp: string[];
  mp: string[];
  hp: string[];
  lk: string[];
  mk: string[];
  hk: string[];
}

export const DEFAULT_KEYS: [KeyMap, KeyMap] = [
  {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    lp: ['KeyU'],
    mp: ['KeyI'],
    hp: ['KeyO'],
    lk: ['KeyJ'],
    mk: ['KeyK'],
    hk: ['KeyL'],
  },
  {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    // テンキーが無いキーボードでも 2 人で遊べるよう、
    // 1P と重ならない Z X C V B N を予備に割り当てている。
    // （1P は W A S D / U I O / J K L を使う）
    lp: ['Numpad4', 'KeyZ'],
    mp: ['Numpad5', 'KeyX'],
    hp: ['Numpad6', 'KeyC'],
    lk: ['Numpad1', 'KeyV'],
    mk: ['Numpad2', 'KeyB'],
    hk: ['Numpad3', 'KeyN'],
  },
];

export class Controls {
  /** 実際に押されている（物理的に下がっている）キー。 */
  private held = new Set<string>();
  /** 前のフレームからこのフレームまでの間に押されたキー。 */
  private downEvents = new Set<string>();
  /** このフレームでゲームが「押されている」とみなすキー。 */
  private frameHeld = new Set<string>();
  /** このフレームに押された瞬間のキー（メニュー用）。 */
  pressed = new Set<string>();
  keys: [KeyMap, KeyMap] = [DEFAULT_KEYS[0], DEFAULT_KEYS[1]];

  attach(target: Window = window): void {
    target.addEventListener('keydown', (e) => {
      if (
        [
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab',
          'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6',
          'F1', 'F2', 'F3', 'F4',
        ].includes(e.code)
      ) {
        e.preventDefault();
      }
      // OS のキーリピートは「押した瞬間」ではないので無視する。
      if (!e.repeat) this.downEvents.add(e.code);
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => {
      this.held.clear();
      this.downEvents.clear();
    });
  }

  /**
   * 1 フレームの始めに呼ぶ。
   *
   * 「押してすぐ離した」キーを取りこぼさないのが要点です。
   * 画面の更新は 1/60 秒ごとですが、キーを押している時間はそれより短いことが
   * ふつうにあります。押した記録が残っていれば、離したあとでも
   * そのフレームは「押されている」として扱います。
   */
  beginFrame(): void {
    this.pressed = new Set(this.downEvents);
    this.frameHeld = new Set(this.held);
    for (const k of this.downEvents) this.frameHeld.add(k);
    this.downEvents.clear();
  }

  isDown(code: string): boolean {
    return this.frameHeld.has(code);
  }

  justPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  private any(list: string[]): boolean {
    return list.some((k) => this.frameHeld.has(k));
  }

  /** プレイヤー index のキーボード入力。 */
  keyboardBits(index: number): number {
    const m = this.keys[index];
    let b = 0;
    if (this.any(m.up)) b |= IN_UP;
    if (this.any(m.down)) b |= IN_DOWN;
    if (this.any(m.left)) b |= IN_LEFT;
    if (this.any(m.right)) b |= IN_RIGHT;
    if (this.any(m.lp)) b |= IN_LP;
    if (this.any(m.mp)) b |= IN_MP;
    if (this.any(m.hp)) b |= IN_HP;
    if (this.any(m.lk)) b |= IN_LK;
    if (this.any(m.mk)) b |= IN_MK;
    if (this.any(m.hk)) b |= IN_HK;
    return b;
  }

  /** ゲームパッド。index 番目のパッドを読む。 */
  gamepadBits(index: number): number {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads[index];
    if (!pad) return 0;
    let b = 0;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const dead = 0.45;
    if (ax < -dead) b |= IN_LEFT;
    if (ax > dead) b |= IN_RIGHT;
    if (ay < -dead) b |= IN_UP;
    if (ay > dead) b |= IN_DOWN;
    const btn = (i: number) => (pad.buttons[i]?.pressed ? 1 : 0);
    // 十字キー（標準配置）。
    if (btn(12)) b |= IN_UP;
    if (btn(13)) b |= IN_DOWN;
    if (btn(14)) b |= IN_LEFT;
    if (btn(15)) b |= IN_RIGHT;
    // パンチ = X / Y / RB、キック = A / B / RT。
    if (btn(2)) b |= IN_LP;
    if (btn(3)) b |= IN_MP;
    if (btn(5)) b |= IN_HP;
    if (btn(0)) b |= IN_LK;
    if (btn(1)) b |= IN_MK;
    if (btn(7)) b |= IN_HK;
    // LB は投げ（弱P + 弱K）。
    if (btn(4)) b |= IN_LP | IN_LK;
    return b;
  }

  /** キーボードとパッドを合わせた入力。 */
  bits(index: number): number {
    return this.keyboardBits(index) | this.gamepadBits(index);
  }

  /** メニュー操作用（どちらのプレイヤーからでも動かせる）。 */
  menuBits(): number {
    return this.bits(0) | this.bits(1);
  }
}
