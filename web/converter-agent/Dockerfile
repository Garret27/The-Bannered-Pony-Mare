FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    handbrake-cli \
    ffmpeg \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY config ./config
COPY src ./src
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN groupadd --system --gid 1001 agent && \
    useradd --system --uid 1001 --gid agent agent && \
    mkdir -p /work /tmp/agent-ssh && \
    chown -R agent:agent /work /tmp/agent-ssh

EXPOSE 8765

ENV AGENT_HOST=0.0.0.0
ENV AGENT_PORT=8765
ENV AGENT_ENABLED=false
ENV WORK_ROOT=/work
ENV MOVIES_OUTPUT_DIR=/work/jellyfin-cache
ENV HANDBRAKE_PATH=/usr/bin/HandBrakeCLI
ENV HANDBRAKE_ENCODER=nvenc_h264
ENV FEDORA_SSH_KEY_PATH=/run/secrets/fedora_ssh
ENV FEDORA_SSH_KNOWN_HOSTS=/run/secrets/fedora_known_hosts

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python3", "src/converter_agent.py"]
