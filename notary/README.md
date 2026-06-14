# Hosted TLSNotary notary-server (Railway)

**Live:** `https://proof-of-scan-notary-production.up.railway.app` (`GET /info`
returns the notary's public key).

Deploys the upstream `notary-server` image so the demo can point at a public
notary instead of a local Docker container. The notary's own TLS stays **off**
(`NS_TLS__ENABLED=false`) — Railway terminates TLS at its edge and forwards to
the container on `$PORT`, and `tlsn-js` connects over `wss://` automatically.
This is the same shape as the public `notary.pse.dev` notary.

## Deploy

```bash
cd scan-market-app/notary
railway login
railway init                 # create a new project (or `railway link` an existing one)
railway up                   # builds the Dockerfile and deploys
railway domain               # generate a public https domain
```

The marketplace already defaults to this hosted notary (`DEFAULT_NOTARY_URL` in
`scripts/tlsn/harness.ts`), so the scanner and verifier agree without extra
config:

```bash
TLSN_ENABLED=1 SUI_SECRET_KEY=…      pnpm scan
TLSN_ENABLED=1 VERIFIER_SECRET_KEY=… pnpm verify
```

To point at a different notary, set `TLSN_NOTARY_URL` for both.

Sanity check the live notary:

```bash
curl -s "$TLSN_NOTARY_URL/info" | jq .publicKey
```

## Pinned signing key (redeploy-safe)

The notary uses a **stable** secp256k1 signing key so proofs stay verifiable
across redeploys. The key lives only as the Railway secret
`NOTARY_PRIVATE_KEY_PEM` (a PKCS#8 PEM); `entrypoint.sh` writes it to
`/root/.notary/notary.key` at boot and sets `NS_NOTARIZATION__PRIVATE_KEY_PATH`.
If the secret is absent the server falls back to an ephemeral key.

Current key fingerprint (compressed pubkey, matches `GET /info`):
`02ccc94691cd6b8ab5dc04b5528ddda3b51ba050f5761fa6be133e94379ab6df2e`

Generate / rotate the key (never commit it — `*.key` is gitignored):

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp256k1 -out notary.key
railway variables --service proof-of-scan-notary --set "NOTARY_PRIVATE_KEY_PEM=$(cat notary.key)"
railway up --ci --service proof-of-scan-notary
```

## Notes

- **TLS 1.2 targets only** (tlsn alpha.12) — independent of where the notary
  runs.
- **Local alternative:** `pnpm tlsn:notary` runs the same image on `:7047`
  (ephemeral key — it doesn't mount `NOTARY_PRIVATE_KEY_PEM`).
