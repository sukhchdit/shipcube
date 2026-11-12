FROM node:24-bookworm-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm rebuild bcrypt --ignore-scripts=false
