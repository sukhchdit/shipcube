# api routes of the web and admin servers (included inside their server blocks; TASK-014, platform.md §2.2 edge row).

# /metrics is never answered at the edge (sheet line 527): without these locations it would reach the SPA fallback.
location = /metrics {
    return 404;
}
location ^~ /metrics/ {
    return 404;
}

# Server-sent events (quote result stream): no response buffering, long read timeout.
location ~ ^/api/v1/quotes/[^/]+/stream$ {
    include /etc/nginx/conf.d/api-proxy.inc;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}

location /api/ {
    include /etc/nginx/conf.d/api-proxy.inc;
    proxy_read_timeout 30s;
}

location /health/ {
    include /etc/nginx/conf.d/api-proxy.inc;
    proxy_read_timeout 30s;
}
