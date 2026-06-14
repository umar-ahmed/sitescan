FROM ghcr.io/tlsnotary/tlsn/notary-server:v0.1.0-alpha.12

ENV NS_HOST=0.0.0.0 \
    NS_TLS__ENABLED=false \
    NS_NOTARIZATION__MAX_SENT_DATA=16384 \
    NS_NOTARIZATION__MAX_RECV_DATA=262144

COPY entrypoint.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["sh", "/usr/local/bin/entrypoint.sh"]
