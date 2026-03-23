FROM ghcr.io/m1k1o/neko/firefox:latest

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    xdotool \
    xclip \
    --no-install-recommends \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /solarcast
COPY server/package*.json ./server/
RUN cd server && npm install --production
COPY server/ ./server/
COPY public/ ./public/
COPY navigate.sh /solarcast/navigate.sh
RUN chmod +x /solarcast/navigate.sh

# Install Firefox policy
COPY firefox-policy/policies.json /tmp/policies.json
RUN FFDIR=$(find /usr/lib /usr/lib64 /opt -maxdepth 3 \( -name "firefox" -o -name "firefox-esr" \) -type d 2>/dev/null | head -1) && \
    mkdir -p "$FFDIR/distribution" && \
    cp /tmp/policies.json "$FFDIR/distribution/policies.json"

COPY supervisord.solarcast.conf /etc/neko/supervisord/solarcast.conf

EXPOSE 3000