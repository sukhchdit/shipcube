#!/bin/sh
# tls-init one-shot (TASK-014; platform.md §2.2 tls-init row, OI-11): creates the self-signed local certificate of the
# edge in the edgecerts volume (mounted at /certs) on first run; later runs keep a certificate that is valid for at
# least one more day. No key is ever committed or printed. The key is owned by the edge's nginx user (UID 101), 0400.
set -eu
umask 077

dir=/certs
crt="$dir/edge.crt"
key="$dir/edge.key"

if [ -s "$crt" ] && [ -s "$key" ] && openssl x509 -in "$crt" -noout -checkend 86400 >/dev/null 2>&1; then
  echo "[tls-init] certificate present and valid"
  exit 0
fi

cat > /tmp/edge.cnf <<'CNF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = localhost
[v3]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, IP:127.0.0.1
CNF

openssl req -x509 -config /tmp/edge.cnf -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 397 \
  -keyout "$key.tmp" -out "$crt.tmp" 2>/dev/null
chmod 0400 "$key.tmp"
chmod 0444 "$crt.tmp"
chown 101:101 "$key.tmp" "$crt.tmp"
mv -f "$key.tmp" "$key"
mv -f "$crt.tmp" "$crt"
echo "[tls-init] certificate created (CN=localhost, P-256, 397 days)"
