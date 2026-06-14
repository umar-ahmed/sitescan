FROM ghcr.io/tlsnotary/tlsn/notary-server:v0.1.0-alpha.12

ENV NS_HOST=0.0.0.0 \
    NS_TLS__ENABLED=false

COPY entrypoint.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["sh", "/usr/local/bin/entrypoint.sh"]
