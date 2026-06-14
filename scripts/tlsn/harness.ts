import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { WebSocketServer } from "ws";
import { chromium, type Browser } from "playwright";

// Default to the hosted notary (pinned signing key) so the scanner and verifier
// agree on the same notary without extra config. Override with TLSN_NOTARY_URL
// (e.g. http://127.0.0.1:7047 for a local `pnpm tlsn:notary`).
export const DEFAULT_NOTARY_URL =
  "https://proof-of-scan-notary-production.up.railway.app";

const HERE = dirname(fileURLToPath(import.meta.url));
const TLSN_BUILD = join(HERE, "..", "..", "node_modules", "tlsn-js", "build");
const PROVER_HTML = join(HERE, "prover.html");
const PROVER_WORKER = join(HERE, "prover.worker.js");

export interface PresentationJSON {
  version: string;
  data: string;
  meta: { notaryUrl?: string; websocketProxyUrl?: string; pluginUrl?: string };
}

export interface VerifyResult {
  verifyingKeyHex: string;
  verifyingKeyRaw: unknown;
  out: {
    server_name?: string;
    connection_info?: Record<string, unknown>;
    transcript?: { sent?: number[]; recv?: number[] };
  };
}

export interface ProveResult extends VerifyResult {
  presentationJSON: PresentationJSON;
  notaryKeyPem: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function isolationHeaders(): Record<string, string> {
  return {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Access-Control-Allow-Origin": "*",
  };
}

export interface HarnessOptions {
  notaryUrl?: string;
  debug?: boolean;
}

// Hosts the real tlsn-js wasm prover in a cross-origin-isolated Chromium page
// and bridges its TLS traffic to a local WebSocket->TCP proxy. One instance can
// produce many proofs / verify many presentations before being stopped.
export class TlsnHarness {
  private notaryUrl: string;
  private debug: boolean;
  private httpServer?: Server;
  private wss?: WebSocketServer;
  private browser?: Browser;
  private httpPort = 0;
  private wsPort = 0;

  constructor(opts: HarnessOptions = {}) {
    this.notaryUrl = opts.notaryUrl ?? DEFAULT_NOTARY_URL;
    this.debug = opts.debug ?? Boolean(process.env.TLSN_DEBUG);
  }

  async start(): Promise<void> {
    this.httpServer = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        let filePath: string;
        if (url.pathname === "/" || url.pathname === "/index.html") {
          filePath = PROVER_HTML;
        } else if (url.pathname === "/prover.worker.js") {
          filePath = PROVER_WORKER;
        } else {
          const rel = normalize(url.pathname.replace(/^\/(tlsnbuild\/)?/, ""));
          if (rel.startsWith("..")) {
            res.writeHead(403).end("forbidden");
            return;
          }
          filePath = join(TLSN_BUILD, rel);
        }
        const body = await readFile(filePath);
        res.writeHead(200, {
          ...isolationHeaders(),
          "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        if (this.debug) console.log(`  [http 404] ${req.url}`);
        res.writeHead(404, isolationHeaders()).end("not found");
      }
    });
    await new Promise<void>((resolve) =>
      this.httpServer!.listen(0, "127.0.0.1", resolve),
    );
    this.httpPort = (this.httpServer!.address() as net.AddressInfo).port;

    this.wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    this.wss.on("connection", (ws, req) => {
      const match = (req.url ?? "").match(/^\/([^/]+)\/(\d+)/);
      if (!match) {
        ws.close();
        return;
      }
      const [, host, portStr] = match;
      const socket = net.connect(Number(portStr), host);
      socket.on("data", (d) => ws.readyState === ws.OPEN && ws.send(d));
      socket.on("close", () => ws.close());
      socket.on("error", () => ws.close());
      ws.on("message", (data: Buffer) => socket.write(data));
      ws.on("close", () => socket.destroy());
      ws.on("error", () => socket.destroy());
    });
    await new Promise<void>((resolve) => this.wss!.on("listening", resolve));
    this.wsPort = (this.wss!.address() as net.AddressInfo).port;

    this.browser = await chromium.launch({ headless: true });
  }

  // Relaunch the headless browser if it died (e.g. an OOM kill during a heavy
  // proof). Without this, one crash would make every subsequent prove/verify
  // throw "browser has been closed" — which the verifier would otherwise
  // misread as an invalid proof.
  private async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: true });
    }
  }

  private async newPage() {
    await this.ensureBrowser();
    const context = await this.browser!.newContext();
    const page = await context.newPage();
    if (this.debug) {
      page.on("console", (m) => console.log(`  [page] ${m.text()}`));
      page.on("pageerror", (e) => console.log(`  [page error] ${e.message}`));
    }
    await page.goto(`http://127.0.0.1:${this.httpPort}/`, {
      waitUntil: "load",
    });
    return { context, page };
  }

  async prove(
    target: string,
    maxRecv = 16384,
    timeoutMs = 0,
    creds: { cookies?: string; userAgent?: string; headBytes?: number } = {},
  ): Promise<ProveResult> {
    const host = new URL(target).hostname;
    const proxyUrl = `ws://127.0.0.1:${this.wsPort}/${host}/443`;
    const { context, page } = await this.newPage();
    const evaluation = page.evaluate(
      async ([t, n, p, m, cookies, ua, headBytes]) =>
        // @ts-expect-error injected by prover.html
        await window.runProof({
          target: t,
          notaryUrl: n,
          proxyUrl: p,
          maxRecv: m,
          cookies,
          userAgent: ua,
          headBytes,
        }),
      [
        target,
        this.notaryUrl,
        proxyUrl,
        maxRecv,
        creds.cookies ?? "",
        creds.userAgent ?? "",
        creds.headBytes ?? 0,
      ] as const,
    ) as Promise<ProveResult>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (timeoutMs <= 0) return await evaluation;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`prove timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      return await Promise.race([evaluation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      await context.close();
      evaluation.catch(() => {});
    }
  }

  async verify(presentationJSON: PresentationJSON): Promise<VerifyResult> {
    const { context, page } = await this.newPage();
    try {
      return (await page.evaluate(
        // @ts-expect-error injected by prover.html
        async (pj) => await window.verifyProof(pj),
        presentationJSON,
      )) as VerifyResult;
    } finally {
      await context.close();
    }
  }

  async stop(): Promise<void> {
    await this.browser?.close();
    this.wss?.close();
    this.httpServer?.close();
  }
}
