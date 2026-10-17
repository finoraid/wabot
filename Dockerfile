FROM node:22-slim

# git: dibutuhkan npm untuk dependensi libsignal milik Baileys
# ffmpeg: stiker animasi + konversi audio | python3/pip: yt-dlp | fonts-dejavu-core: teks stiker .brat/.smeme
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ffmpeg python3 python3-pip ca-certificates fonts-dejavu-core fontconfig \
 && pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" \
 && echo "--js-runtimes node" > /etc/yt-dlp.conf \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# package*.json: ikut menyalin package-lock.json kalau ada (lihat README, bagian "Lockfile").
COPY package*.json ./
# libsignal diambil dari git (kadang ssh://); di container tidak ada kunci SSH, jadi paksa lewat HTTPS.
# Pakai `npm ci` kalau lockfile ada, kalau tidak `npm install`.
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
 && git config --global --add url."https://github.com/".insteadOf git@github.com: \
 && if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi

COPY src ./src

ENV NODE_ENV=production \
    DATA_DIR=/data
RUN mkdir -p /data

CMD ["node", "src/index.js"]
