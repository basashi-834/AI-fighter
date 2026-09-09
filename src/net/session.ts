/**
 * オンライン対戦の進行役。
 *
 * 招待コードのやり取りだけは、文字を貼り付ける必要があるので
 * HTML の入力欄を画面に重ねて使います。つながったあとはキャンバスだけで進みます。
 */

import { ROSTER } from '../data';
import { VIEW_H, VIEW_W } from '../engine/constants';
import type { MatchState } from '../engine/match';
import type { CharacterDef } from '../engine/types';
import { bigText } from '../render/renderer';
import { RollbackSession } from './rollback';
import { Transport, type NetMessage } from './transport';

export type NetState = 'menu' | 'hosting' | 'joining' | 'waiting' | 'playing' | 'error';

export class NetSession {
  transport = new Transport();
  state: NetState = 'menu';
  rollback: RollbackSession | null = null;
  /** [プレイヤー0, プレイヤー1] のキャラクター番号。 */
  characters: [number, number] = [0, 1];
  myCharacter = 0;
  message = '';
  menuIndex = 0;
  private overlay: HTMLDivElement | null = null;
  private offerCode = '';
  private remoteChar: number | null = null;
  private pingTimer = 0;
  lastRollback = 0;
  predictionDepth = 0;

  constructor() {
    this.transport.onMessage = (m) => this.onMessage(m);
    this.transport.onOpen = () => {
      this.message = 'つながりました。開始を待っています…';
      this.transport.send({ t: 'hello', char: this.myCharacter, role: this.transport.role });
      this.tryStart();
    };
    this.transport.onClose = () => {
      this.message = '接続が切れました';
      this.state = 'error';
    };
  }

  /* ---------------- メニュー ---------------- */

  readonly menuItems = ['部屋を作る（ホスト）', '部屋に入る（ゲスト）', 'キャラクターを変える', '戻る'];

  moveMenu(d: number): void {
    this.menuIndex = (this.menuIndex + d + this.menuItems.length) % this.menuItems.length;
  }

  changeCharacter(d: number): void {
    this.myCharacter = (this.myCharacter + d + ROSTER.length) % ROSTER.length;
  }

  async choose(): Promise<void> {
    switch (this.menuIndex) {
      case 0:
        await this.host();
        break;
      case 1:
        this.join();
        break;
      case 2:
        this.changeCharacter(1);
        break;
      default:
        break;
    }
  }

  /* ---------------- 接続 ---------------- */

  async host(): Promise<void> {
    this.state = 'hosting';
    this.message = '招待コードを作っています…';
    try {
      this.offerCode = await this.transport.createOffer();
      this.message = '招待コードを相手に送り、返事コードを貼り付けてください';
      this.showOverlay('host');
    } catch (e) {
      this.state = 'error';
      this.message = `接続の準備に失敗しました: ${String(e)}`;
    }
  }

  join(): void {
    this.state = 'joining';
    this.message = '相手からの招待コードを貼り付けてください';
    this.showOverlay('guest');
  }

  private onMessage(m: NetMessage): void {
    switch (m.t) {
      case 'hello':
        this.remoteChar = m.char;
        this.tryStart();
        break;
      case 'start':
        this.characters = [m.hostChar, m.guestChar];
        this.startMatch();
        break;
      case 'input':
        this.rollback?.pushRemoteInput(m.f, m.b);
        break;
      default:
        break;
    }
  }

  private tryStart(): void {
    if (this.transport.role !== 'host') return;
    if (this.remoteChar == null || !this.transport.connected) return;
    this.characters = [this.myCharacter, this.remoteChar];
    this.transport.send({
      t: 'start',
      seed: 1,
      hostChar: this.characters[0],
      guestChar: this.characters[1],
    });
    this.startMatch();
  }

  private startMatch(): void {
    this.hideOverlay();
    this.state = 'playing';
    this.message = '';
  }

  /** App から呼ばれて、試合の同期をはじめる。 */
  begin(state: MatchState, chars: [CharacterDef, CharacterDef]): void {
    this.rollback = new RollbackSession(state, chars, {
      localPlayer: this.transport.role === 'host' ? 0 : 1,
      inputDelay: 2,
      maxRollback: 8,
    });
  }

  /** 対戦中、1 フレームぶん進める。 */
  tickOnline(localBits: number): MatchState | null {
    const rb = this.rollback;
    if (!rb) return null;
    const targetFrame = rb.frame + rb.config.inputDelay;
    this.transport.send({ t: 'input', f: targetFrame, b: localBits });
    const r = rb.tick(localBits);
    this.lastRollback = r.rolledBack;
    this.predictionDepth = r.predicted;
    return rb.state;
  }

  pump(): void {
    this.pingTimer++;
    if (this.pingTimer % 60 === 0) this.transport.measurePing();
  }

  close(): void {
    this.hideOverlay();
    this.transport.close();
    this.rollback = null;
    this.state = 'menu';
  }

  /* ---------------- コードのやり取り（HTML を重ねる） ---------------- */

  private showOverlay(kind: 'host' | 'guest'): void {
    this.hideOverlay();
    const div = document.createElement('div');
    div.className = 'net-overlay';
    const title = kind === 'host' ? '招待コード（相手に送る）' : '招待コード（相手から受け取る）';
    div.innerHTML = `
      <div class="net-card">
        <h2>${kind === 'host' ? 'ホスト' : 'ゲスト'}</h2>
        <label>${title}</label>
        <textarea class="net-a" spellcheck="false"></textarea>
        <div class="net-row">
          <button class="net-copy">コピー</button>
          <button class="net-paste">貼り付け</button>
        </div>
        <label class="net-l2">${kind === 'host' ? '返事コード（相手から受け取る）' : '返事コード（相手に送り返す）'}</label>
        <textarea class="net-b" spellcheck="false"></textarea>
        <div class="net-row">
          <button class="net-copy2">コピー</button>
          <button class="net-go">${kind === 'host' ? '接続する' : '返事コードを作る'}</button>
          <button class="net-cancel">やめる</button>
        </div>
        <p class="net-hint">コードは長いので、そのままメッセージアプリなどに貼って渡してください。</p>
      </div>`;
    document.body.appendChild(div);
    this.overlay = div;

    const ta = div.querySelector<HTMLTextAreaElement>('.net-a')!;
    const tb = div.querySelector<HTMLTextAreaElement>('.net-b')!;
    if (kind === 'host') ta.value = this.offerCode;

    div.querySelector('.net-copy')!.addEventListener('click', () => void navigator.clipboard?.writeText(ta.value));
    div.querySelector('.net-copy2')!.addEventListener('click', () => void navigator.clipboard?.writeText(tb.value));
    div.querySelector('.net-paste')!.addEventListener('click', async () => {
      try {
        ta.value = await navigator.clipboard.readText();
      } catch {
        ta.focus();
      }
    });
    div.querySelector('.net-cancel')!.addEventListener('click', () => this.close());
    div.querySelector('.net-go')!.addEventListener('click', async () => {
      try {
        if (kind === 'host') {
          await this.transport.acceptAnswer(tb.value);
          this.message = '接続中…';
          this.state = 'waiting';
        } else {
          tb.value = await this.transport.acceptOffer(ta.value);
          this.message = '返事コードを相手に送ってください';
          this.state = 'waiting';
        }
      } catch (e) {
        this.message = `コードが正しくないようです: ${String(e)}`;
      }
    });
  }

  private hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  /* ---------------- 画面 ---------------- */

  draw(ctx: CanvasRenderingContext2D, tick: number): void {
    ctx.fillStyle = '#080a18';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    bigText(ctx, 'オンライン対戦', VIEW_W / 2, 34, 20, '#ffffff', '#22264a');

    if (this.state === 'menu') {
      this.menuItems.forEach((label, i) => {
        const y = 78 + i * 24;
        const on = i === this.menuIndex;
        ctx.font = `bold ${on ? 14 : 12}px "Noto Sans JP", sans-serif`;
        ctx.fillStyle = on ? '#ffd94a' : 'rgba(255,255,255,0.6)';
        ctx.fillText(label, VIEW_W / 2, y);
      });
      ctx.font = '10px "Noto Sans JP", sans-serif';
      ctx.fillStyle = '#8fd0ff';
      ctx.fillText(`使うキャラクター: ${ROSTER[this.myCharacter].nameJa}`, VIEW_W / 2, 188);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '9px "Noto Sans JP", sans-serif';
      ctx.fillText('相手と招待コードを交換すると、サーバ無しで直接つながります', VIEW_W / 2, 214);
      ctx.fillText('ロールバック方式なので、多少の遅延でも操作は遅れません', VIEW_W / 2, 226);
    } else {
      ctx.font = '11px "Noto Sans JP", sans-serif';
      ctx.fillStyle = '#ffffff';
      wrapText(ctx, this.message, VIEW_W / 2, 100, 380, 16);
      const dots = '.'.repeat(1 + (Math.floor(tick / 20) % 3));
      if (this.state === 'waiting') {
        ctx.fillStyle = '#8fd0ff';
        ctx.fillText(`接続中${dots}`, VIEW_W / 2, 150);
      }
    }
    ctx.font = '9px "Noto Sans JP", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Esc で戻る', VIEW_W / 2, VIEW_H - 12);
  }

  /** 対戦中に出す通信状況。 */
  drawNetHud(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(6, VIEW_H - 30, 108, 24);
    ctx.fillStyle = this.transport.ping > 120 ? '#ff8a8a' : '#9ff0a0';
    ctx.fillText(`ping ${this.transport.ping}ms`, 10, VIEW_H - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`予測 ${this.predictionDepth}F / 巻戻 ${this.lastRollback}F`, 10, VIEW_H - 10);
    ctx.restore();
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const chars = [...text];
  let line = '';
  let yy = y;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, yy);
}
