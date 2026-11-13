#!/bin/sh
# tls-init one-shot (TASK-014; platform.md §2.2 tls-init row, OI-11): creates the local TLS material of the edge in the
# edgecerts volume (mounted at /certs) on first run; later runs keep material that is valid for at least one more day.
#   ca.crt    a local, per-volume CA (CA:TRUE, keyCertSign only). Clients that must verify the edge (the stack suite,
#             Playwright, a developer's trust store) trust this file; its key is deleted right after signing.
#   edge.crt  the edge leaf (CN/SAN localhost and 127.0.0.1, serverAuth, CA:FALSE) followed by ca.crt (full chain).
#   edge.key  the leaf key, owned by the edge's nginx user (UID 101), mode 0400.
# OpenSSL refuses a self-signed CA:FALSE leaf as its own trust anchor ("unable to verify the first certificate"), hence
# the two-level chain. No key is ever committed or printed.
set -eu
umask 077

dir=/certs
ca="$dir/ca.crt"
crt="$dir/edge.crt"
key="$dir/edge.key"

if [ -s "$ca" ] && [ -s "$crt" ] && [ -s "$key" ] && openssl x509 -in "$crt" -noout -checkend 86400 >/dev/null 2>&1; then
  echo "[tls-init] certificate present and valid"
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cat > "$work/ca.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = shipcube local edge CA
[v3]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
CNF

cat > "$work/leaf.cnf" <<'CNF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = localhost
[v3]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, IP:127.0.0.1
authorityKeyIdentifier = keyid
CNF

openssl req -x509 -config "$work/ca.cnf" -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 398 \
  -keyout "$work/ca.key" -out "$work/ca.crt" 2>/dev/null
openssl req -new -config "$work/leaf.cnf" -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout "$work/edge.key" -out "$work/edge.csr" 2>/dev/null
openssl x509 -req -in "$work/edge.csr" -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial -days 397 \
  -extfile "$work/leaf.cnf" -extensions v3 -out "$work/edge-leaf.crt" 2>/dev/null
cat "$work/edge-leaf.crt" "$work/ca.crt" > "$work/edge.crt"

# Copy into the volume while still root-owned (the container has CAP_CHOWN but not CAP_DAC_OVERRIDE, so it cannot read
# a 0400 file it already gave away), then chown and rename within the volume (atomic replace).
for name in edge.key edge.crt ca.crt; do
  cp "$work/$name" "$dir/$name.tmp"
done
chmod 0400 "$dir/edge.key.tmp"
chmod 0444 "$dir/edge.crt.tmp" "$dir/ca.crt.tmp"
chown 101:101 "$dir/edge.key.tmp" "$dir/edge.crt.tmp" "$dir/ca.crt.tmp"
mv -f "$dir/edge.key.tmp" "$key"
mv -f "$dir/edge.crt.tmp" "$crt"
mv -f "$dir/ca.crt.tmp" "$ca"
echo "[tls-init] local CA and edge certificate created (CN=localhost, P-256, 397 days)"
