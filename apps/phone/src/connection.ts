import {
  type DesktopMessage,
  type PhoneMessage,
  type RemoteMode,
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
} from "@gepetta/protocol";
import { deviceName, pairingToken } from "./device";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "no-token";

export interface ConnectionHandlers {
  onStatus?(status: ConnectionStatus): void;
  /** Called after hello was sent on every (re)connection. */
  onOpen?(): void;
  onMessage?(header: DesktopMessage, payload: Uint8Array | null): void;
  /** Called when a connection that was open goes away. */
  onClose?(): void;
}

const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 5000;

/** WebSocket to the desktop app with hello handshake and auto-reconnect. */
export class Connection {
  status: ConnectionStatus = "connecting";
  sessionId: string | null = null;
  private ws: WebSocket | null = null;
  private backoff = MIN_BACKOFF;
  private retryTimer: number | undefined;
  private readonly token = pairingToken();
  private closed = false;

  constructor(
    private readonly mode: RemoteMode,
    private readonly handlers: ConnectionHandlers,
  ) {
    // Phones drop sockets in the background; reconnect right away when back.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !this.ws && this.token && !this.closed) {
        clearTimeout(this.retryTimer);
        this.connect();
      }
    });
    if (this.token) this.connect();
    else this.setStatus("no-token");
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** Returns false when not connected (the message is dropped). */
  send(header: PhoneMessage, payload?: Uint8Array | null): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(encodeMessage(header, payload) as Uint8Array<ArrayBuffer>);
    return true;
  }

  /** Resolves true once everything queued was handed to the network, false if the socket closed first. */
  async drained(): Promise<boolean> {
    const ws = this.ws;
    while (ws && ws === this.ws && ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount === 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /** Closes for good (no reconnect). */
  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private connect() {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws?t=${encodeURIComponent(this.token ?? "")}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let wasOpen = false;

    ws.onopen = () => {
      wasOpen = true;
      this.backoff = MIN_BACKOFF;
      this.send({ t: "hello", protocol: PROTOCOL_VERSION, device: deviceName(), mode: this.mode });
      this.setStatus("open");
      this.handlers.onOpen?.();
    };
    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      let envelope;
      try {
        envelope = decodeMessage<DesktopMessage>(event.data);
      } catch (error) {
        console.warn("Mensaje inválido de la compu", error);
        return;
      }
      if (envelope.header.t === "welcome") this.sessionId = envelope.header.sessionId;
      this.handlers.onMessage?.(envelope.header, envelope.payload);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (wasOpen) this.handlers.onClose?.();
      this.setStatus("reconnecting");
      this.retryTimer = window.setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(MAX_BACKOFF, this.backoff * 1.6);
    };
    // onclose always follows onerror; nothing else to do here.
    ws.onerror = () => {};
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.handlers.onStatus?.(status);
  }
}
