FROM node:22-slim

# git: dibutuhkan npm untuk dependensi libsignal milik Baileys
# ffmpeg: stiker animasi + konversi audio | python3/pip: yt-dlp
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ffmpeg python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" \
 && echo "--js-runtimes node" > /etc/yt-dlp.conf \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# Lockfile menyimpan libsignal sebagai git+ssh; di container tidak ada kunci SSH, jadi paksa lewat HTTPS.
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
 && git config --global --add url."https://github.com/".insteadOf git@github.com: \
 && npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production \
    DATA_DIR=/data
RUN mkdir -p /data

CMD ["node", "src/index.js"]
