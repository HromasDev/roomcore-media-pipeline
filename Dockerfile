FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .

# Команда задаётся в docker-compose.yml: api или worker
CMD ["bun", "run", "src/api.ts"]
