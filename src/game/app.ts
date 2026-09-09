/**
 * ゲーム全体の進行。画面の切り替えとメインループ。
 *
 * 更新は必ず 1/60 秒きざみで行い、描画はブラウザの都合に合わせます
 * （固定タイムステップ）。こうしないと、画面の書き換え速度が 144Hz の
 * パソコンでは技の発生が速くなってしまい、フレームデータが意味を失います。
 */

import { ROSTER } from '../data';
import { FPS, VIEW_H, VIEW_W, toPx } from '../engine/constants';
import { isActionable } from '../engine/fighter';
import { DEFAULT_CONFIG, createMatch, stepMatch, type MatchConfig, type MatchState, type TrainingDummyAction } from '../engine/match';
import type { CharacterDef } from '../engine/types';
import { CpuBrain, type Difficulty } from '../ai/cpu';
import { Renderer, bigText } from '../render/renderer';
import { STAGES } from '../render/stage';
import { sound } from '../audio/sound';
import { Controls } from './controls';
import { drawCharSelect, drawHowTo, drawOptions, drawPause, drawResult, drawTitle, drawVersus, drawTrainingPanel } from './screens';
import { drawMoveList } from './movelist';
import { drawInputDisplay } from './screens';
import { NetSession } from '../net/session';

export type Mode =
  | 'title'
  | 'select'
  | 'versus'
  | 'fight'
  | 'result'
  | 'howto'
  | 'options'
  | 'movelist'
  | 'online';

export interface Settings {
  difficulty: Difficulty;
  rounds: number;
  timeLimit: number;
  master: number;
  music: number;
  sfx: number;
  showBoxes: boolean;
}

export interface SelectState {
  cursor: [number, number];
  locked: [boolean, boolean];
  stage: number;
}

export class App {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  controls = new Controls();
  renderer = new Renderer();
  mode: Mode = 'title';
  menuIndex = 0;
  optionIndex = 0;

  /** 対戦の種類。 */
  vsMode: 'cpu' | 'local' | 'training' | 'online' = 'cpu';

  settings: Settings = {
    difficulty: 'normal',
    rounds: 2,
    timeLimit: 99 * 60,
    master: 0.7,
    music: 0.34,
    sfx: 0.85,
    showBoxes: false,
  };

  select: SelectState = { cursor: [0, 1], locked: [false, false], stage: 0 };

  match: MatchState | null = null;
  chars: [CharacterDef, CharacterDef] = [ROSTER[0], ROSTER[1]];
  cpu: CpuBrain | null = null;
  cpuP1: CpuBrain | null = null;
  paused = false;
  pauseIndex = 0;
  trainingIndex = 0;
  moveListChar = 0;
  moveListScroll = 0;
  /** 技表から戻る先。 */
  private moveListReturn: Mode = 'title';
  net: NetSession | null = null;

  private slowCounter = 0;
  private accumulator = 0;
  private lastTime = 0;
  private resultTimer = 0;
  private introShown = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D コンテキストが取得できませんでした');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.controls.attach();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loadSettings();
  }

  /* ---------------- 設定の保存 ---------------- */

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem('aifighter.settings');
      if (raw) Object.assign(this.settings, JSON.parse(raw));
    } catch {
      /* 読めなくても既定値で動く */
    }
    sound.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
    this.renderer.debug = this.settings.showBoxes;
  }

  saveSettings(): void {
    try {
      localStorage.setItem('aifighter.settings', JSON.stringify(this.settings));
    } catch {
      /* 保存できなくても続行 */
    }
  }

  /* ---------------- 画面の大きさ ---------------- */

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.max(1, Math.min(Math.floor(w / VIEW_W), Math.floor(h / VIEW_H)));
    // 整数倍に収まらないときは小数倍で目いっぱいに広げる。
    const s = scale >= 1 && w >= VIEW_W && h >= VIEW_H ? scale : Math.min(w / VIEW_W, h / VIEW_H);
    this.canvas.style.width = `${Math.floor(VIEW_W * s)}px`;
    this.canvas.style.height = `${Math.floor(VIEW_H * s)}px`;
  }

  /* ---------------- ループ ---------------- */

  start(): void {
    this.lastTime = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(100, t - this.lastTime);
      this.lastTime = t;
      this.accumulator += dt;
      const step = 1000 / FPS;
      let steps = 0;
      while (this.accumulator >= step && steps < 5) {
        this.accumulator -= step;
        steps++;
        this.update();
      }
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---------------- 更新 ---------------- */

  private update(): void {
    this.controls.beginFrame();
    switch (this.mode) {
      case 'title':
        this.updateTitle();
        break;
      case 'select':
        this.updateSelect();
        break;
      case 'versus':
        this.updateVersus();
        break;
      case 'fight':
        this.updateFight();
        break;
      case 'result':
        this.updateResult();
        break;
      case 'howto':
      case 'options':
        this.updateSubScreen();
        break;
      case 'movelist':
        this.updateMoveList();
        break;
      case 'online':
        this.updateOnline();
        break;
    }
    this.renderer.update(this.match ?? createEmpty());
  }

  private menuNav(count: number, index: number): number {
    if (this.controls.justPressed('KeyW', 'ArrowUp')) {
      sound.play('menu');
      return (index - 1 + count) % count;
    }
    if (this.controls.justPressed('KeyS', 'ArrowDown')) {
      sound.play('menu');
      return (index + 1) % count;
    }
    return index;
  }

  private confirmPressed(): boolean {
    return this.controls.justPressed('Enter', 'Space', 'KeyU', 'Numpad4', 'KeyZ');
  }

  private cancelPressed(): boolean {
    return this.controls.justPressed('Escape', 'Backspace', 'KeyO', 'KeyX');
  }

  readonly titleItems = [
    { id: 'cpu', label: 'CPU と対戦', sub: 'ARCADE / VS CPU' },
    { id: 'local', label: '2 人対戦', sub: '1 台のキーボードで' },
    { id: 'training', label: 'トレーニング', sub: '技と判定の確認' },
    { id: 'online', label: 'オンライン対戦', sub: 'ロールバック方式' },
    { id: 'movelist', label: '技表', sub: 'MOVE LIST' },
    { id: 'howto', label: '操作説明', sub: 'HOW TO PLAY' },
    { id: 'options', label: '設定', sub: 'OPTIONS' },
  ];

  private updateTitle(): void {
    this.menuIndex = this.menuNav(this.titleItems.length, this.menuIndex);
    if (this.confirmPressed()) {
      sound.ensure();
      sound.play('select');
      const id = this.titleItems[this.menuIndex].id;
      if (id === 'howto') this.mode = 'howto';
      else if (id === 'movelist') {
        this.mode = 'movelist';
        this.moveListScroll = 0;
      }
      else if (id === 'options') this.mode = 'options';
      else if (id === 'online') {
        this.vsMode = 'online';
        this.mode = 'online';
        this.net = this.net ?? new NetSession();
      } else {
        this.vsMode = id as 'cpu' | 'local' | 'training';
        this.mode = 'select';
        this.select = { cursor: [0, 1], locked: [false, false], stage: 0 };
      }
    }
  }

  private updateSelect(): void {
    const n = ROSTER.length;
    // P1 の操作。
    if (!this.select.locked[0]) {
      if (this.controls.justPressed('KeyA')) {
        this.select.cursor[0] = (this.select.cursor[0] - 1 + n) % n;
        sound.play('menu');
      }
      if (this.controls.justPressed('KeyD')) {
        this.select.cursor[0] = (this.select.cursor[0] + 1) % n;
        sound.play('menu');
      }
      if (this.controls.justPressed('KeyU', 'Space', 'Enter')) {
        this.select.locked[0] = true;
        sound.play('select');
      }
    }
    // P2 の操作（CPU 戦・トレーニングでは自動で決まる）。
    const p2Human = this.vsMode === 'local';
    if (!this.select.locked[1]) {
      if (p2Human) {
        if (this.controls.justPressed('ArrowLeft')) {
          this.select.cursor[1] = (this.select.cursor[1] - 1 + n) % n;
          sound.play('menu');
        }
        if (this.controls.justPressed('ArrowRight')) {
          this.select.cursor[1] = (this.select.cursor[1] + 1) % n;
          sound.play('menu');
        }
        if (this.controls.justPressed('Numpad4', 'Numpad1', 'KeyT')) {
          this.select.locked[1] = true;
          sound.play('select');
        }
      } else if (this.select.locked[0]) {
        this.select.locked[1] = true;
      }
    }
    // ステージ選択。
    if (this.controls.justPressed('KeyQ')) {
      this.select.stage = (this.select.stage + STAGES.length - 1) % STAGES.length;
      sound.play('menu');
    }
    if (this.controls.justPressed('KeyE')) {
      this.select.stage = (this.select.stage + 1) % STAGES.length;
      sound.play('menu');
    }

    if (this.cancelPressed()) {
      if (this.select.locked[1] && p2Human) this.select.locked[1] = false;
      else if (this.select.locked[0]) this.select.locked[0] = false;
      else this.mode = 'title';
    }

    if (this.select.locked[0] && this.select.locked[1]) {
      this.beginMatch();
    }
  }

  private updateVersus(): void {
    this.resultTimer--;
    if (this.resultTimer <= 0 || this.confirmPressed()) {
      this.mode = 'fight';
      sound.startMusic('battle');
    }
  }

  beginMatch(): void {
    this.chars = [ROSTER[this.select.cursor[0]], ROSTER[this.select.cursor[1]]];
    const config: MatchConfig = {
      ...DEFAULT_CONFIG,
      roundsToWin: this.vsMode === 'training' ? 99 : this.settings.rounds,
      timeLimit: this.vsMode === 'training' ? 0 : this.settings.timeLimit,
      training: this.vsMode === 'training',
      autoRecover: this.vsMode === 'training',
      dummyAction: 'stand',
      infiniteMeter: this.vsMode === 'training',
    };
    this.match = createMatch(this.chars, config);
    this.cpu = this.vsMode === 'cpu' ? new CpuBrain(1, this.settings.difficulty, Date.now() & 0xffff) : null;
    this.cpuP1 = null;
    this.renderer.setStage(STAGES[this.select.stage].id);
    this.renderer.hud.reset();
    this.renderer.effects.clear();
    this.introShown = false;
    this.paused = false;
    this.mode = 'versus';
    this.resultTimer = 110;
    sound.stopMusic();
  }

  private updateFight(): void {
    const s = this.match;
    if (!s) return;

    // ポーズ。
    if (this.controls.justPressed('Escape', 'KeyP')) {
      this.paused = !this.paused;
      this.pauseIndex = 0;
      sound.play('menu');
    }
    if (this.paused) {
      this.updatePause();
      return;
    }

    // トレーニングの設定変更。
    if (s.config.training) this.updateTrainingControls(s);

    // 判定表示の切り替え。
    if (this.controls.justPressed('F1')) {
      this.renderer.debug = !this.renderer.debug;
      this.settings.showBoxes = this.renderer.debug;
      this.saveSettings();
    }

    // オンライン対戦はロールバック側が進行を持つ。
    if (this.vsMode === 'online' && this.net?.rollback) {
      const local = this.controls.bits(0);
      const next = this.net.tickOnline(local);
      if (next) {
        this.match = next;
        this.renderer.consume(next, this.chars);
        this.playEventSounds(next);
      }
      return;
    }

    const p1 = this.controls.bits(0);
    let p2 = 0;
    if (this.vsMode === 'cpu' && this.cpu) p2 = this.cpu.think(s, this.chars);
    else if (this.vsMode === 'local') p2 = this.controls.bits(1);
    else if (this.vsMode === 'training' && s.config.dummyAction === 'cpu' && this.cpu) p2 = this.cpu.think(s, this.chars);
    else if (this.vsMode === 'training') p2 = this.controls.bits(1);

    // 決着直後はスローモーションにして、決め手を見せる。
    // シミュレーションのフレーム番号には手を触れず、「進めない」だけにする。
    if (s.slowmo > 0 && s.phase === 'ko') {
      this.slowCounter++;
      if (this.slowCounter % 3 !== 0) return;
    } else {
      this.slowCounter = 0;
    }

    stepMatch(s, this.chars, [p1, p2]);
    this.renderer.consume(s, this.chars);
    this.playEventSounds(s);
    this.showOutcomeBanner(s);

    if (!this.introShown && s.phase === 'intro' && s.phaseFrame === 1) this.introShown = true;

    if (s.phase === 'matchEnd' && s.phaseFrame > 90) {
      this.mode = 'result';
      this.resultTimer = 60 * 8;
      sound.stopMusic();
    }
  }

  private updateTrainingControls(s: MatchState): void {
    const actions: TrainingDummyAction[] = ['stand', 'crouch', 'jump', 'guard', 'guardAll', 'cpu'];
    if (this.controls.justPressed('F2')) {
      const i = actions.indexOf(s.config.dummyAction);
      s.config.dummyAction = actions[(i + 1) % actions.length];
      if (s.config.dummyAction === 'cpu' && !this.cpu) {
        this.cpu = new CpuBrain(1, this.settings.difficulty, 4242);
      }
      sound.play('menu');
    }
    if (this.controls.justPressed('F3')) {
      s.config.autoRecover = !s.config.autoRecover;
      sound.play('menu');
    }
    if (this.controls.justPressed('F4')) {
      // 位置のリセット。
      const fresh = createMatch(this.chars, s.config);
      fresh.phase = 'fight';
      fresh.wins = s.wins;
      this.match = fresh;
      sound.play('menu');
    }
  }

  private updatePause(): void {
    this.pauseIndex = this.menuNav(PAUSE_ITEMS.length, this.pauseIndex);
    if (this.confirmPressed()) {
      sound.play('select');
      switch (this.pauseIndex) {
        case 0:
          this.paused = false;
          break;
        case 1:
          this.beginMatch();
          break;
        case 2:
          // 技表。試合はそのまま残しておき、閉じたら戻ってくる。
          this.moveListChar = ROSTER.indexOf(this.chars[0]);
          this.moveListScroll = 0;
          this.moveListReturn = 'fight';
          this.mode = 'movelist';
          break;
        case 3:
          this.mode = 'select';
          this.select.locked = [false, false];
          sound.stopMusic();
          break;
        case 4:
          this.mode = 'title';
          sound.stopMusic();
          break;
      }
    }
    if (this.cancelPressed()) this.paused = false;
  }

  private updateResult(): void {
    this.resultTimer--;
    if (this.confirmPressed() || this.resultTimer <= 0) {
      this.mode = 'select';
      this.select.locked = [false, false];
    }
    if (this.cancelPressed()) this.mode = 'title';
  }

  private updateSubScreen(): void {
    if (this.mode === 'options') {
      const count = 7;
      this.optionIndex = this.menuNav(count, this.optionIndex);
      const left = this.controls.justPressed('KeyA', 'ArrowLeft');
      const right = this.controls.justPressed('KeyD', 'ArrowRight');
      if (left || right) {
        const d = right ? 1 : -1;
        const diffs: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];
        switch (this.optionIndex) {
          case 0: {
            const i = diffs.indexOf(this.settings.difficulty);
            this.settings.difficulty = diffs[(i + d + diffs.length) % diffs.length];
            break;
          }
          case 1:
            this.settings.rounds = Math.max(1, Math.min(5, this.settings.rounds + d));
            break;
          case 2:
            this.settings.timeLimit = Math.max(0, Math.min(99 * 60, this.settings.timeLimit + d * 30 * 60));
            break;
          case 3:
            this.settings.master = clamp01(this.settings.master + d * 0.1);
            break;
          case 4:
            this.settings.music = clamp01(this.settings.music + d * 0.1);
            break;
          case 5:
            this.settings.sfx = clamp01(this.settings.sfx + d * 0.1);
            break;
          case 6:
            this.settings.showBoxes = !this.settings.showBoxes;
            this.renderer.debug = this.settings.showBoxes;
            break;
        }
        sound.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
        sound.play('menu');
        this.saveSettings();
      }
    }
    if (this.cancelPressed() || this.confirmPressed()) {
      this.mode = 'title';
      sound.play('menu');
    }
  }

  private updateMoveList(): void {
    if (this.controls.justPressed('KeyW', 'ArrowUp')) this.moveListScroll--;
    if (this.controls.justPressed('KeyS', 'ArrowDown')) this.moveListScroll++;
    this.moveListScroll = Math.max(0, this.moveListScroll);
    if (this.controls.justPressed('KeyA', 'ArrowLeft')) {
      this.moveListChar = (this.moveListChar - 1 + ROSTER.length) % ROSTER.length;
      this.moveListScroll = 0;
      sound.play('menu');
    }
    if (this.controls.justPressed('KeyD', 'ArrowRight')) {
      this.moveListChar = (this.moveListChar + 1) % ROSTER.length;
      this.moveListScroll = 0;
      sound.play('menu');
    }
    if (this.cancelPressed()) {
      this.mode = this.moveListReturn;
      sound.play('menu');
    }
  }

  private updateOnline(): void {
    const net = this.net;
    if (!net) return;
    net.pump();
    if (net.state === 'menu') {
      if (this.controls.justPressed('KeyW', 'ArrowUp')) {
        net.moveMenu(-1);
        sound.play('menu');
      }
      if (this.controls.justPressed('KeyS', 'ArrowDown')) {
        net.moveMenu(1);
        sound.play('menu');
      }
      if (this.controls.justPressed('KeyA', 'ArrowLeft')) {
        net.changeCharacter(-1);
        sound.play('menu');
      }
      if (this.controls.justPressed('KeyD', 'ArrowRight')) {
        net.changeCharacter(1);
        sound.play('menu');
      }
      if (this.confirmPressed()) {
        sound.play('select');
        if (net.menuIndex === 3) {
          this.mode = 'title';
          return;
        }
        void net.choose();
      }
    }
    if (net.state === 'playing' && this.mode === 'online') {
      // 対戦開始。相手のキャラは接続時に決めてある。
      this.select.cursor = net.characters;
      this.vsMode = 'online';
      this.beginMatchOnline();
      return;
    }
    if (this.cancelPressed()) {
      net.close();
      this.net = null;
      this.mode = 'title';
    }
  }

  private beginMatchOnline(): void {
    this.chars = [ROSTER[this.select.cursor[0]], ROSTER[this.select.cursor[1]]];
    const config: MatchConfig = {
      ...DEFAULT_CONFIG,
      roundsToWin: this.settings.rounds,
      timeLimit: this.settings.timeLimit,
    };
    this.match = createMatch(this.chars, config);
    this.net?.begin(this.match, this.chars);
    this.renderer.setStage(STAGES[this.select.stage].id);
    this.renderer.hud.reset();
    this.renderer.effects.clear();
    this.mode = 'fight';
    sound.startMusic('battle');
  }

  /**
   * 決着の見出しを出す。
   * 「K.O.」で終わらせず、無傷なら PERFECT、時間切れなら TIME UP と出し分ける。
   * 同じ勝ちでも中身が違うことが一目で分かるようにするための演出です。
   */
  private showOutcomeBanner(s: MatchState): void {
    if (!s.events.some((e) => e.type === 'ko')) return;
    const w = s.roundWinner;
    if (w < 0) {
      this.renderer.showBanner('DOUBLE K.O.', '相打ち', 130);
      return;
    }
    const winner = s.fighters[w];
    const loser = s.fighters[1 - w];
    if (loser.health > 0) {
      this.renderer.showBanner('TIME UP', `${this.chars[w].nameJa} の勝ち`, 130);
    } else if (winner.health >= winner.maxHealth) {
      this.renderer.showBanner('PERFECT', '一発ももらわず', 140);
    } else {
      this.renderer.showBanner('K.O.', '', 120);
    }
  }

  /** イベントに合わせて音を鳴らす。 */
  private playEventSounds(s: MatchState): void {
    for (const e of s.events) {
      switch (e.type) {
        case 'hit':
          if (e.counter) sound.play('counter');
          sound.play(
            e.props.effect === 'heavy' || e.props.effect === 'burn'
              ? 'hit_heavy'
              : e.props.effect === 'light'
                ? 'hit_light'
                : 'hit_medium',
          );
          break;
        case 'block':
          sound.play('block');
          break;
        case 'armor':
          sound.play('block');
          break;
        case 'whiff':
          sound.play(e.sfx as never);
          break;
        case 'throw':
          sound.play('grab');
          break;
        case 'throwTech':
          sound.play('block');
          break;
        case 'jump':
          sound.play('jump');
          break;
        case 'land':
          if (e.hard) sound.play('land');
          break;
        case 'dash':
          sound.play('dash');
          break;
        case 'superFlash':
          sound.play('super');
          break;
        case 'ko':
          sound.play('ko');
          break;
        case 'clash':
          sound.play('block');
          break;
        default:
          break;
      }
    }
  }

  /* ---------------- 描画 ---------------- */

  private draw(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    switch (this.mode) {
      case 'title':
        drawTitle(ctx, this.renderer.tick, this.titleItems, this.menuIndex);
        break;
      case 'select':
        drawCharSelect(ctx, this.select, this.vsMode, this.renderer.tick);
        break;
      case 'versus':
        drawVersus(ctx, this.chars, this.renderer.tick, STAGES[this.select.stage]);
        break;
      case 'fight':
        if (this.match) {
          this.renderer.render(ctx, this.match, this.chars);
          if (this.match.config.training) {
            drawTrainingPanel(ctx, this.match, this.chars);
            drawInputDisplay(ctx, this.match.fighters[0]);
          }
          if (this.vsMode === 'online') this.net?.drawNetHud(ctx);
          if (this.paused) drawPause(ctx, this.pauseIndex);
        }
        break;
      case 'result':
        if (this.match) {
          this.renderer.render(ctx, this.match, this.chars);
          drawResult(ctx, this.match, this.chars, this.renderer.tick);
        }
        break;
      case 'howto':
        drawHowTo(ctx, this.renderer.tick);
        break;
      case 'options':
        drawOptions(ctx, this.settings, this.optionIndex);
        break;
      case 'movelist':
        drawMoveList(ctx, ROSTER[this.moveListChar], this.moveListScroll, this.moveListChar, ROSTER.length);
        break;
      case 'online':
        this.net?.draw(ctx, this.renderer.tick);
        break;
    }
    ctx.restore();
  }
}

/** ポーズ中のメニュー項目。画面側と共有する。 */
export const PAUSE_ITEMS = ['続ける', '仕切り直し', '技表', 'キャラクター選択', 'タイトルへ'];

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 10) / 10));
}

/** レンダラの update に渡すための空の状態（タイトル画面など試合が無いとき）。 */
let emptyCache: MatchState | null = null;
function createEmpty(): MatchState {
  if (!emptyCache) emptyCache = createMatch([ROSTER[0], ROSTER[1]]);
  return emptyCache;
}

export { bigText, isActionable, toPx, VIEW_W, VIEW_H, FPS };
