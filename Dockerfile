# ==========================================
# 1. Rust Axum Backend Builder (Alpine / Musl)
# ==========================================
FROM rust:1.80-alpine as backend-builder
RUN apk add --no-cache musl-dev gcc g++ make perl
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# ==========================================
# 2. Next.js Frontend Builder
# ==========================================
FROM node:20-alpine as frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV OUTPUT_EXPORT=true
RUN npm run build

# ==========================================
# 3. Production Linux Work OS Container (~30MB)
# ==========================================
FROM alpine:3.20

LABEL maintainer="TheySynced Headquarters <support@theysynced.com>"
LABEL description="TheySynced Real Enterprise Linux Work OS with Tor Privacy & Real PTY"

# Install real Alpine Linux system packages, developer runtimes, shells, and privacy stack
RUN apk add --no-cache \
    ca-certificates \
    curl \
    wget \
    bash \
    fish \
    git \
    python3 \
    py3-pip \
    nodejs \
    npm \
    make \
    gcc \
    g++ \
    musl-dev \
    shadow \
    sudo \
    procps \
    coreutils \
    tar \
    gzip \
    zip \
    unzip \
    neofetch \
    tree \
    jq \
    nano \
    vim \
    tor \
    proxychains-ng \
    iproute2 \
    net-tools \
    bind-tools

# Configure Tor and Proxychains for seamless private networking
RUN mkdir -p /etc/tor /etc/proxychains /var/lib/tor /var/log && \
    printf 'strict_chain\nproxy_dns\nremote_dns_subnet 224\ntcp_read_time_out 15000\ntcp_connect_time_out 8000\n[ProxyList]\nsocks5 127.0.0.1 9050\n' > /etc/proxychains.conf && \
    printf 'SocksPort 127.0.0.1:9050\nLog notice /var/log/tor.log\nDataDirectory /var/lib/tor\n' > /etc/tor/torrc

# Provide native CLI compatibility wrappers for pacman and apt that delegate directly to apk
RUN printf '#!/bin/sh\ncase "$1" in\n  -S|-Sy|-Syu) shift; exec apk add "$@" ;;\n  -R|-Rs) shift; exec apk del "$@" ;;\n  -Ss) shift; exec apk search "$@" ;;\n  -Q|-Qe) exec apk info ;;\n  *) exec apk "$@" ;;\nesac\n' > /usr/local/bin/pacman && \
    chmod +x /usr/local/bin/pacman && \
    printf '#!/bin/sh\ncase "$1" in\n  install) shift; exec apk add "$@" ;;\n  remove|purge) shift; exec apk del "$@" ;;\n  update) exec apk update ;;\n  search) shift; exec apk search "$@" ;;\n  *) exec apk "$@" ;;\nesac\n' > /usr/local/bin/apt && \
    chmod +x /usr/local/bin/apt && \
    ln -sf /usr/local/bin/apt /usr/local/bin/apt-get

WORKDIR /app

# Copy Rust backend binary and static frontend assets
COPY --from=backend-builder /app/target/release/theysynced /app/theysynced
COPY --from=frontend-builder /app/out /app/static
COPY public /app/public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Setup shared workspace mounts and standard POSIX permissions
RUN mkdir -p /workspace/chats /workspace/docs /workspace/spreadsheets /workspace/drawings /workspace/tasks /workspace/files /workspace/export && \
    chmod -R 777 /workspace

EXPOSE 8000
EXPOSE 3000

ENV PORT=8000
ENV HOST=0.0.0.0
ENV RUST_LOG=info

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/app/theysynced"]
