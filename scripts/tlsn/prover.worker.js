// Runs the real TLSNotary MPC prover / verifier off the main thread (blocking
// Atomics are only allowed inside a worker). The UMD bundle attaches
// Prover/Presentation/NotaryServer/default onto the worker global.
importScripts("/tlsnbuild/lib.js");

const init = self.default || self.init;
const { Prover, Presentation, NotaryServer } = self;

const toHex = (bytes) =>
  Array.from(bytes || [])
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const clean = (obj) =>
  JSON.parse(
    JSON.stringify(obj, (_k, v) =>
      v instanceof Uint8Array ? Array.from(v) : v,
    ),
  );

let ready = false;
async function ensureInit() {
  if (ready) return;
  await init({ loggingLevel: "Info" });
  ready = true;
}

// Verify a presentation locally and return what it cryptographically proves.
async function verify(presentationJSON) {
  await ensureInit();
  const presentation = new Presentation(presentationJSON.data);
  const verifyingKey = await presentation.verifyingKey();
  const out = await presentation.verify();
  return {
    verifyingKeyHex: toHex(
      verifyingKey && (verifyingKey.data || verifyingKey.key),
    ),
    verifyingKeyRaw: clean(verifyingKey),
    out: clean(out),
  };
}

// Produce a real presentation over MPC-TLS, then verify it for convenience.
async function prove({
  target,
  notaryUrl,
  proxyUrl,
  maxRecv,
  cookies,
  userAgent,
  headBytes,
}) {
  await ensureInit();
  const host = new URL(target).hostname;
  const notary = NotaryServer.from(notaryUrl);
  const notaryKeyPem = await notary.publicKey("pem");

  // When a human cleared a bot-wall, reuse the exact User-Agent + clearance
  // cookies they obtained so the notarized request is authenticated and the
  // server returns the real page (HTTP 200) instead of the challenge (403).
  const headers = {
    Host: host,
    Connection: "close",
    "User-Agent": userAgent || "proof-of-scan-tlsn/0.1",
    Accept: "*/*",
  };
  if (cookies) headers.Cookie = cookies;
  // Head-only proving: ask the server for just the first N bytes so the MPC
  // transcript stays small and heavy pages still prove quickly. Servers that
  // honor Range reply 206 Partial Content (accepted by the verifier).
  if (headBytes && headBytes > 0) headers.Range = `bytes=0-${headBytes - 1}`;

  const presentationJSON = await Prover.notarize({
    url: target,
    notaryUrl,
    websocketProxyUrl: proxyUrl,
    method: "GET",
    headers,
    maxRecvData: maxRecv || 16384,
  });

  const verified = await verify(presentationJSON);
  return { presentationJSON, notaryKeyPem, ...verified };
}

self.onmessage = async (e) => {
  const { cmd } = e.data;
  try {
    const result =
      cmd === "verify"
        ? await verify(e.data.presentationJSON)
        : await prove(e.data);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
