# Proxy settings for the api pool (included inside a location: a location that sets any proxy_set_header drops every
# inherited one, so the full set lives here). Like the ALB: X-Forwarded-For is appended (the api trusts one hop,
# TRUST_PROXY_HOPS=1) and X-Forwarded-Proto carries the scheme. Only idempotent requests are retried on another
# replica (proxy_next_upstream never retries POST, PUT, PATCH or DELETE by default; platform.md §2.5).
proxy_pass http://edge_api;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
# Outside APP_ENV=local the value is empty, so the client's X-Mock-Scenario is not forwarded (00-edge.conf).
proxy_set_header X-Mock-Scenario $edge_mock_scenario;
proxy_next_upstream error timeout http_502;
proxy_next_upstream_tries 2;
proxy_connect_timeout 2s;
proxy_read_timeout 30s;
client_max_body_size 10m;
