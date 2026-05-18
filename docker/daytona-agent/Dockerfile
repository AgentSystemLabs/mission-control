FROM node:24-bookworm

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/workspace \
    PATH="/home/workspace/.local/bin:/root/.local/bin:/usr/local/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
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

RUN usermod --login workspace --home /home/workspace --move-home --shell /bin/bash node \
  && groupmod --new-name workspace node \
  && chown -R workspace:workspace /home/workspace \
  && echo "workspace ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/workspace \
  && chmod 0440 /etc/sudoers.d/workspace

RUN corepack enable \
  && corepack prepare pnpm@11.1.2 --activate \
  && npm install -g @openai/codex@latest @anthropic-ai/claude-code@latest \
  && npm cache clean --force

USER workspace

RUN curl https://cursor.com/install -fsS | bash

USER root

RUN ln -sf /home/workspace/.local/bin/agent /usr/local/bin/agent \
  && ln -sf /home/workspace/.local/bin/agent /usr/local/bin/cursor-agent

USER workspace
WORKDIR /home/workspace

RUN claude --version \
  && codex --version \
  && cursor-agent --version

CMD ["/bin/bash"]
