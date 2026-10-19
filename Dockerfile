FROM node:22-slim

# git: dibutuhkan npm untuk dependensi libsignal milik Baileys
# ffmpeg: stiker animasi + konversi audio | python3/pip: yt-dlp | fonts-dejavu-core: teks stiker .brat/.smeme
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ffmpeg python3 python3-pip ca-certificates fonts-dejavu-core fontconfig \
 && pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" \
 && echo "--js-runtimes node" > /etc/yt-dlp.conf \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./

# Gunakan npm install agar lockfile lama yang belum sinkron dengan package.json
# (misalnya setelah menambahkan socket.io) tidak membuat build gagal di npm ci.
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
 && git config --global --add url."https://github.com/".insteadOf git@github.com: \
 && npm install --omit=dev --no-audit --no-fund

# Chromium untuk cadangan downloader; kegagalan instalasi tidak menghentikan build.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN (npx --no-install playwright-core install --with-deps chromium && rm -rf /var/lib/apt/lists/*) \
 || echo "PERINGATAN: Chromium gagal dipasang, deteksi video via browser nonaktif"

COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    DATA_DIR=/data
RUN mkdir -p /data

CMD ["node", "src/index.js"]
