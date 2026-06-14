import { readFile } from "node:fs/promises";
import {
  TlsnHarness,
  DEFAULT_NOTARY_URL,
  type PresentationJSON,
} from "./tlsn/harness";
import { checkProvenance, notaryPemToKeyHex } from "../src/lib/tlsnotary";

const FILE = process.argv[2];
const EXPECTED_HOST = process.argv[3];
const NOTARY_URL =
  process.env.TLSN_NOTARY_URL ?? process.env.NOTARY_URL ?? DEFAULT_NOTARY_URL;

if (!FILE) {
  console.error(
    "usage: tsx scripts/tlsn-verify.ts <presentation.json> [expectedHost]",
  );
  process.exit(1);
}

async function trustedNotaryKeyHex(): Promise<string> {
  const res = await fetch(`${NOTARY_URL}/info`);
  const info = (await res.json()) as { publicKey: string };
  return notaryPemToKeyHex(info.publicKey);
}

async function main() {
  const presentationJSON = JSON.parse(
    await readFile(FILE, "utf8"),
  ) as PresentationJSON;
  console.log(
    `verifying presentation (${presentationJSON.version}) from ${FILE}`,
  );

  const trustedKey = await trustedNotaryKeyHex();
  const harness = new TlsnHarness({ notaryUrl: NOTARY_URL });
  await harness.start();
  try {
    const verified = await harness.verify(presentationJSON);
    const serverName = verified.out.server_name ?? "";
    const provenance = await checkProvenance(verified, {
      expectedHost: EXPECTED_HOST ?? serverName,
      trustedNotaryKeyHex: trustedKey,
    });

    console.log(`\nproven server_name : ${provenance.serverName}`);
    console.log(`signed by notary   : ${verified.verifyingKeyHex}`);
    console.log(`trusted notary key : ${trustedKey}`);
    console.log(`http status        : ${provenance.statusCode ?? "?"}`);
    console.log(`html content hash  : ${provenance.htmlContentHash ?? "-"}`);
    console.log(`\nverdict: ${provenance.status} — ${provenance.reason}`);
    process.exitCode = provenance.status === "PROVEN" ? 0 : 2;
  } finally {
    await harness.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
