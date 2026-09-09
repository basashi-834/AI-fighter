/**
 * 入口。キャンバスを用意してゲームを起動する。
 */

import './style.css';
import { App } from './game/app';
import { sound } from './audio/sound';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const boot = document.getElementById('boot') as HTMLDivElement;

const app = new App(canvas);
app.start();

// 開発時に中身をのぞけるようにしておく（自動テストからも使う）。
(window as unknown as { __aifighter: App }).__aifighter = app;

// 音は「利用者が一度なにか操作してから」でないと鳴らせない決まりがあるので、
// 最初の 1 回だけ案内を出しておく。
function begin(): void {
  boot.classList.add('hidden');
  sound.ensure();
  window.removeEventListener('keydown', begin);
  boot.removeEventListener('click', begin);
  window.removeEventListener('pointerdown', begin);
}
boot.addEventListener('click', begin);
window.addEventListener('keydown', begin);
window.addEventListener('pointerdown', begin);
