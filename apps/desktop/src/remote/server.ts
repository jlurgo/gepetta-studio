import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { type DesktopMessage, type PhoneMessage, decodeMessage, encodeMessage } from "@gepetta/protocol";
import QRCode from "qrcode";
import { WebSocket, WebSocketServer } from "ws";
import { certToDer, loadCertificates } from "./certs";
import { lanAddresses } from "./net";

/** Mirrors RemoteDevice / RemoteServerInfo / RemoteEvent in apps/studio/src/native.d.ts. */
export interface RemoteDevice {
  sessionId: string;
  device: string;
  mode: "live" | "photo";
  connectedAt: number;
}

export interface RemoteServerInfo {
  httpUrl: string;
  httpsUrl: string;
  caUrl: string;
  addresses: string[];
  qrDataUrl: string;
}

export type RemoteEvent =
  | { type: "devices"; devices: RemoteDevice[] }
  | { type: "message"; sessionId: string; header: PhoneMessage; payload: Uint8Array | null };

const HTTP_PORT = 8790;
const HTTPS_PORT = 8791;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

interface Session {
  socket: WebSocket;
  device: RemoteDevice | null;
  alive: boolean;
}

/** Listens on the first free port from `port` upward. */
function listen(server: http.Server | https.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number) => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE" && p < port + 10) tryPort(p + 1);
        else reject(e);
      });
      server.listen(p, "0.0.0.0", () => resolve((server.address() as AddressInfo).port));
    };
    tryPort(port);
  });
}

/**
 * LAN server for phones: serves the phone page over HTTP (photo mode, setup help)
 * and HTTPS (live camera), and relays protocol messages between phones and the
 * renderer. Every connection must present the pairing token from the QR code.
 */
export class RemoteServer {
  private readonly token = randomBytes(12).toString("base64url");
  private servers: (http.Server | https.Server)[] = [];
  private sockets: WebSocketServer[] = [];
  private sessions = new Map<string, Session>();
  private heartbeat: NodeJS.Timeout | undefined;
  private info: RemoteServerInfo | null = null;
  private starting: Promise<RemoteServerInfo> | null = null;
  private caDer: Buffer | null = null;

  constructor(
    private readonly opts: { certDir: string; phoneDir: string; onEvent(e: RemoteEvent): void },
  ) {}

  start(): Promise<RemoteServerInfo> {
    if (this.info) return Promise.resolve(this.info);
    this.starting ??= this.doStart().finally(() => (this.starting = null));
    return this.starting;
  }

  private async doStart(): Promise<RemoteServerInfo> {
    const addresses = lanAddresses();
    if (addresses.length === 0) throw new Error("La computadora no está conectada a ninguna red WiFi o cableada.");
    const { ca, server } = await loadCertificates(this.opts.certDir, [...addresses, "localhost", "127.0.0.1"]);
    this.caDer = certToDer(ca.cert);

    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => void this.handleHttp(req, res);
    const plain = http.createServer(handler);
    const secure = https.createServer({ cert: server.cert, key: server.key }, handler);
    const httpPort = await listen(plain, HTTP_PORT);
    const httpsPort = await listen(secure, HTTPS_PORT);
    this.servers = [plain, secure];
    this.sockets = this.servers.map((s) => {
      const wss = new WebSocketServer({ server: s, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });
      wss.on("connection", (socket, req) => this.handleSocket(socket, req));
      return wss;
    });
    this.heartbeat = setInterval(() => this.ping(), 15_000);

    const host = addresses[0]!;
    const httpUrl = `http://${host}:${httpPort}/?t=${this.token}`;
    this.info = {
      httpUrl,
      httpsUrl: `https://${host}:${httpsPort}/?t=${this.token}`,
      caUrl: `http://${host}:${httpPort}/ca.crt`,
      addresses,
      qrDataUrl: await QRCode.toDataURL(httpUrl, { margin: 1, width: 320 }),
    };
    return this.info;
  }

  async stop() {
    clearInterval(this.heartbeat);
    for (const s of this.sessions.values()) s.socket.terminate();
    this.sessions.clear();
    this.sockets.forEach((w) => w.close());
    await Promise.all(this.servers.map((s) => new Promise((r) => s.close(r))));
    this.servers = [];
    this.sockets = [];
    this.info = null;
    this.emitDevices();
  }

  send(sessionId: string, header: DesktopMessage, payload?: Uint8Array | null) {
    const session = this.sessions.get(sessionId);
    if (session?.socket.readyState === WebSocket.OPEN) session.socket.send(encodeMessage(header, payload));
  }

  private validToken(req: http.IncomingMessage): boolean {
    return new URL(req.url ?? "/", "http://x").searchParams.get("t") === this.token;
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: string | Buffer, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
      res.end(body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "Método no permitido");

    if (url.pathname === "/ca.crt") {
      return send(200, this.caDer!, "application/x-x509-ca-cert", {
        "Content-Disposition": 'attachment; filename="GepettaStudio.crt"',
      });
    }
    if (url.pathname === "/info.json") {
      if (!this.validToken(req) || !this.info) return send(403, "Código de conexión inválido");
      const { httpUrl, httpsUrl, caUrl } = this.info;
      return send(200, JSON.stringify({ httpUrl, httpsUrl, caUrl }), MIME[".json"]);
    }

    // Static phone page. Resolve inside phoneDir only.
    const root = path.resolve(this.opts.phoneDir);
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.resolve(root, "." + rel);
    if (!file.startsWith(root + path.sep)) return send(404, "No encontrado");
    try {
      const body = await readFile(file);
      send(200, body, MIME[path.extname(file)] ?? "application/octet-stream");
    } catch {
      send(404, "No encontrado");
    }
  }

  private handleSocket(socket: WebSocket, req: http.IncomingMessage) {
    if (!this.validToken(req)) {
      socket.close(4001, "token");
      return;
    }
    const sessionId = randomUUID();
    const session: Session = { socket, device: null, alive: true };
    this.sessions.set(sessionId, session);
    socket.on("pong", () => (session.alive = true));
    socket.on("message", (data, isBinary) => {
      if (!isBinary) return;
      try {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        const { header, payload } = decodeMessage<PhoneMessage>(buf);
        if (header.t === "hello") {
          session.device = { sessionId, device: String(header.device).slice(0, 60), mode: header.mode, connectedAt: Date.now() };
          this.send(sessionId, { t: "welcome", sessionId, filmName: null });
          this.emitDevices();
        }
        this.opts.onEvent({ type: "message", sessionId, header, payload });
      } catch (e) {
        console.warn("[remote] bad message", e);
      }
    });
    socket.on("close", () => {
      this.sessions.delete(sessionId);
      if (session.device) this.emitDevices();
    });
  }

  private ping() {
    for (const s of this.sessions.values()) {
      if (!s.alive) {
        s.socket.terminate();
        continue;
      }
      s.alive = false;
      s.socket.ping();
    }
  }

  private emitDevices() {
    const devices = [...this.sessions.values()].flatMap((s) => (s.device ? [s.device] : []));
    this.opts.onEvent({ type: "devices", devices });
  }
}
