/**
 * オンライン対戦の通信路。
 *
 * サーバを一切用意せずに遊べるよう、WebRTC の「手動での顔合わせ」を使います。
 * 片方が作った合言葉（招待コード）を相手に渡し、相手が返した合言葉を戻すと、
 * それ以降はブラウザどうしが直接つながります。
 * つながったあとは、毎フレームの入力を小さな数値として送り合うだけです。
 */

export type NetRole = 'host' | 'guest';

export type NetMessage =
  | { t: 'input'; f: number; b: number }
  | { t: 'hello'; char: number; role: NetRole }
  | { t: 'start'; seed: number; hostChar: number; guestChar: number }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number };

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

export class Transport {
  pc: RTCPeerConnection | null = null;
  channel: RTCDataChannel | null = null;
  role: NetRole = 'host';
  connected = false;
  /** 相手との往復時間（ミリ秒）。 */
  ping = 0;
  onMessage: (m: NetMessage) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  lastError = '';

  /** 招待コード（ホスト側）を作る。 */
  async createOffer(): Promise<string> {
    this.role = 'host';
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    const ch = pc.createDataChannel('fight', { ordered: false, maxRetransmits: 0 });
    this.bindChannel(ch);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitIce(pc);
    return encode(pc.localDescription!);
  }

  /** 招待コードを受け取って、返事コードを作る（ゲスト側）。 */
  async acceptOffer(code: string): Promise<string> {
    this.role = 'guest';
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    pc.ondatachannel = (e) => this.bindChannel(e.channel);
    await pc.setRemoteDescription(decode(code));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.waitIce(pc);
    return encode(pc.localDescription!);
  }

  /** 返事コードを受け取る（ホスト側）。 */
  async acceptAnswer(code: string): Promise<void> {
    if (!this.pc) throw new Error('先に招待コードを作ってください');
    await this.pc.setRemoteDescription(decode(code));
  }

  private bindChannel(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.onopen = () => {
      this.connected = true;
      this.onOpen();
    };
    ch.onclose = () => {
      this.connected = false;
      this.onClose();
    };
    ch.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data as string) as NetMessage;
        if (m.t === 'ping') {
          this.send({ t: 'pong', ts: m.ts });
          return;
        }
        if (m.t === 'pong') {
          this.ping = Math.round(performance.now() - m.ts);
          return;
        }
        this.onMessage(m);
      } catch {
        /* 壊れたメッセージは捨てる */
      }
    };
  }

  send(m: NetMessage): void {
    if (this.channel?.readyState === 'open') {
      try {
        this.channel.send(JSON.stringify(m));
      } catch {
        /* 送れないフレームがあっても、次のフレームで送り直す */
      }
    }
  }

  measurePing(): void {
    this.send({ t: 'ping', ts: performance.now() });
  }

  close(): void {
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc = null;
    this.connected = false;
  }

  /** ICE の候補が出そろうのを待つ（出そろってから 1 個のコードにまとめる）。 */
  private waitIce(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 2500);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }
}

function encode(d: RTCSessionDescription | RTCSessionDescriptionInit): string {
  const json = JSON.stringify({ type: d.type, sdp: d.sdp });
  return btoa(unescape(encodeURIComponent(json)));
}

function decode(code: string): RTCSessionDescriptionInit {
  const json = decodeURIComponent(escape(atob(code.trim())));
  return JSON.parse(json) as RTCSessionDescriptionInit;
}
