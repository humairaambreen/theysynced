# ==========================================
# 1. Rust Axum Backend Builder
# ==========================================
FROM rust:1.80-slim as backend-builder
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
RUN npm run build

# ==========================================
# 3. Production Runner Container
# ==========================================
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /app/target/release/theysynced /app/theysynced
COPY --from=frontend-builder /app/.next /app/.next
COPY --from=frontend-builder /app/public /app/public
COPY --from=frontend-builder /app/package.json /app/package.json
COPY --from=frontend-builder /app/node_modules /app/node_modules

EXPOSE 8000
EXPOSE 3000

ENV PORT=8000
ENV RUST_LOG=info

CMD ["/app/theysynced"]
