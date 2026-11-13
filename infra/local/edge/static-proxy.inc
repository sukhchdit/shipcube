# Proxy settings for the web and admin Nginx images (included inside a location, after its proxy_pass).
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 2s;
proxy_read_timeout 30s;
