# Local TLS (included inside a server). The certificate and key are created by the tls-init one-shot in the edgecerts
# volume (infra/local/tls-init/tls-init.sh); no key is committed (platform.md §2.2 tls-init row, OI-11).
ssl_certificate /etc/nginx/certs/edge.crt;
ssl_certificate_key /etc/nginx/certs/edge.key;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_session_cache shared:edge_tls:1m;
ssl_session_tickets off;
