import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TlsnHarness } from "./tlsn/harness";
import { checkProvenance, notaryPemToKeyHex } from "../src/lib/tlsnotary";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = process.argv[2] ?? "https://example.com/";
const OUT =
  process.argv[3] ??
  join(HERE, "tlsn", "out", `${new URL(TARGET).hostname}.presentation.json`);
const NOTARY_URL =
  process.env.TLSN_NOTARY_URL ??
  process.env.NOTARY_URL ??
  "http://127.0.0.1:7047";

async function main() {
  console.log(`TLSNotary prove → ${TARGET}`);
  console.log(`notary = ${NOTARY_URL}`);

  const harness = new TlsnHarness({ notaryUrl: NOTARY_URL });
  await harness.start();
  try {
    console.log("running real MPC-TLS proof in headless Chromium…");
    const result = await harness.prove(TARGET);

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(result.presentationJSON, null, 2));

    const provenance = await checkProvenance(
      { verifyingKeyHex: result.verifyingKeyHex, out: result.out },
      {
        expectedHost: new URL(TARGET).hostname,
        trustedNotaryKeyHex: notaryPemToKeyHex(result.notaryKeyPem),
      },
    );

    console.log(`\nproven server_name : ${provenance.serverName}`);
    console.log(`notary key         : ${result.verifyingKeyHex}`);
    console.log(`http status        : ${provenance.statusCode ?? "?"}`);
    console.log(`html content hash  : ${provenance.htmlContentHash ?? "-"}`);
    console.log(
      `provenance         : ${provenance.status} — ${provenance.reason}`,
    );
    console.log(`\npresentation saved → ${OUT}`);
  } finally {
    await harness.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
