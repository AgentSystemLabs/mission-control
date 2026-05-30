# Mission Control sandbox runner — default base image.
#
# Tracks the docker/daytona-agent baseline (Node 24 + git/bash/curl + the agent
# CLIs) and adds the `mc-agent` process as CMD. Users may FROM this image and
# layer on their own toolchain (see docs/docker-sandbox-runner-plan.md, BYO
# Dockerfile contract).
#
# Build (context = mc-agent/, after `pnpm build:mc-agent` so dist/ exists):
#   docker build -f docker/sandbox-base/Dockerfile -t mission-control/sandbox-base:latest mc-agent
FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/workspace
# Prepend the agent bin dir but KEEP the base PATH (which includes /usr/sbin,
# where usermod/groupmod live) — don't clobber it.
ENV PATH=/home/workspace/.local/bin:$PATH

# System toolchain — bash/curl/git for the agents, build-essential + python3 so
# node-pty can compile its native addon against this image's Node ABI.
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

# Rename the stock `node` user to `workspace` with passwordless sudo.
RUN usermod -l workspace -d /home/workspace -m node \
  && groupmod -n workspace node \
  && echo "workspace ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/workspace \
  && chmod 0440 /etc/sudoers.d/workspace

# pnpm via corepack + the npm-distributed agent CLIs.
RUN corepack enable \
  && corepack prepare pnpm@11.1.2 --activate \
  && npm install -g @openai/codex@latest @anthropic-ai/claude-code@latest opencode-ai@latest

# cursor-agent ships via its own installer (separate CDN). Retry transient
# download failures, and don't hard-fail the whole image if cursor's CDN is down
# — claude/codex/opencode still install, the symlink + sanity steps below already
# tolerate a missing cursor-agent, and the runtime health probe reports it absent.
USER workspace
RUN for i in 1 2 3; do \
      curl https://cursor.com/install -fsS | bash && break; \
      echo "cursor-agent install attempt $i failed; retrying in 5s..."; sleep 5; \
    done || echo "WARNING: cursor-agent install failed (CDN down?); continuing without it"
USER root
RUN ln -sf /home/workspace/.local/bin/cursor-agent /usr/local/bin/cursor-agent \
  && ln -sf /home/workspace/.local/bin/agent /usr/local/bin/agent || true

# mc-agent: the prebuilt bundle (node-pty external) + its runtime deps. node-pty
# compiles here so it matches this image's Node ABI.
COPY package.json /opt/mc-agent/package.json
COPY dist/mc-agent.cjs /opt/mc-agent/mc-agent.cjs
RUN cd /opt/mc-agent \
  && npm install --omit=dev --no-package-lock \
  && chown -R workspace:workspace /opt/mc-agent

# Named-volume mount points. Pre-create them owned by `workspace` so a FRESH
# volume inherits that ownership; the entrypoint additionally re-chowns at boot
# to repair volumes that an older (root-owning) image already created.
RUN mkdir -p /workspace /home/workspace/.ssh /home/workspace/.config \
  && chown -R workspace:workspace /workspace /home/workspace/.ssh /home/workspace/.config \
  && chmod 700 /home/workspace/.ssh

# The root-run npm/corepack installs above wrote their caches to HOME
# (/home/workspace/.npm, /home/workspace/.cache) owned by root, so a runtime
# `npm i` / `pnpm i` as the `workspace` user (uid 1000) would fail with EACCES.
# Hand the whole home tree back to `workspace`.
RUN chown -R workspace:workspace /home/workspace

# Root entrypoint fixes volume ownership, then drops to `workspace` via setpriv.
COPY docker-entrypoint.sh /usr/local/bin/mc-entrypoint.sh
RUN chmod +x /usr/local/bin/mc-entrypoint.sh

ENV MC_AGENT_PORT=9333 \
    MC_WORKSPACE_ROOT=/workspace \
    MC_HOOK_API_HOST=host.docker.internal

EXPOSE 9333
WORKDIR /workspace

# Sanity-check the agent CLIs are on PATH at build time (non-fatal). Runs as the
# `workspace` user so it exercises the same PATH the agent will see at runtime.
USER workspace
# Each runs independently (`;`) so one missing CLI (e.g. cursor when its CDN is
# down) doesn't hide the others' versions.
RUN { claude --version; codex --version; cursor-agent --version; opencode --version; } || true
USER root

# NOTE: the container intentionally starts as root so the entrypoint can chown the
# mounted volumes; setpriv immediately drops to `workspace` before exec-ing node.
ENTRYPOINT ["/usr/local/bin/mc-entrypoint.sh"]
CMD ["node", "/opt/mc-agent/mc-agent.cjs"]
