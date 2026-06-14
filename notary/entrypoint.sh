#!/bin/sh
set -e

if [ -n "$NOTARY_PRIVATE_KEY_PEM" ]; then
  printf '%s\n' "$NOTARY_PRIVATE_KEY_PEM" >/root/.notary/notary.key
  chmod 600 /root/.notary/notary.key
  export NS_NOTARIZATION__PRIVATE_KEY_PATH=/root/.notary/notary.key
  echo "notary: using pinned signing key from NOTARY_PRIVATE_KEY_PEM"
else
  echo "notary: no NOTARY_PRIVATE_KEY_PEM set; using ephemeral key"
fi

export NS_PORT="${PORT:-7047}"
exec notary-server
