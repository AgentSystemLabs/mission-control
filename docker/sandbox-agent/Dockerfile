# Standalone mc-agent image for remote VM / Railway deployments.
# Build context: repo root.
#
#   docker build -f docker/sandbox-agent/Dockerfile -t mission-control/sandbox-agent:latest .
FROM node:24-bookworm AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY mc-agent/package.json ./mc-agent/package.json

RUN corepack enable \
  && corepack prepare pnpm@11.1.2 --activate \
  && pnpm install --frozen-lockfile --ignore-scripts

COPY mc-agent ./mc-agent
COPY src/shared ./src/shared

RUN pnpm build:mc-agent

FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/workspace \
    PATH=/home/workspace/.local/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    gnupg \
    jq \
    less \
    openssh-client \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    sudo \
    unzip \
    xz-utils \
    zip \
    zsh \
  && rm -rf /var/lib/apt/lists/*

RUN usermod -l workspace -d /home/workspace -m node \
  && groupmod -n workspace node \
  && echo "workspace ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/workspace \
  && chmod 0440 /etc/sudoers.d/workspace

RUN corepack enable \
  && corepack prepare pnpm@11.1.2 --activate \
  && npm install -g @openai/codex@latest @anthropic-ai/claude-code@latest opencode-ai@latest

USER workspace
RUN for i in 1 2 3; do \
      curl https://cursor.com/install -fsS | bash && break; \
      echo "cursor-agent install attempt $i failed; retrying in 5s..."; sleep 5; \
    done || echo "WARNING: cursor-agent install failed (CDN down?); continuing without it"
USER root
RUN ln -sf /home/workspace/.local/bin/cursor-agent /usr/local/bin/cursor-agent \
  && ln -sf /home/workspace/.local/bin/agent /usr/local/bin/agent || true

COPY --from=build /app/mc-agent/package.json /opt/mc-agent/package.json
COPY --from=build /app/mc-agent/dist/mc-agent.cjs /opt/mc-agent/mc-agent.cjs
RUN cd /opt/mc-agent \
  && npm install --omit=dev --no-package-lock \
  && chown -R workspace:workspace /opt/mc-agent

RUN mkdir -p /workspace /home/workspace/.ssh /home/workspace/.config \
  && chown -R workspace:workspace /workspace /home/workspace/.ssh /home/workspace/.config \
  && chmod 700 /home/workspace/.ssh \
  && chown -R workspace:workspace /home/workspace

COPY mc-agent/docker-entrypoint.sh /usr/local/bin/mc-entrypoint.sh
RUN chmod +x /usr/local/bin/mc-entrypoint.sh

ENV MC_WORKSPACE_ROOT=/workspace \
    MC_AGENT_BIND_HOST=0.0.0.0 \
    CLAUDE_CONFIG_DIR=/home/workspace/.claude

EXPOSE 9333
WORKDIR /workspace

USER workspace
RUN { claude --version; codex --version; cursor-agent --version; opencode --version; } || true
USER root

ENTRYPOINT ["/usr/local/bin/mc-entrypoint.sh"]
CMD ["node", "/opt/mc-agent/mc-agent.cjs"]
