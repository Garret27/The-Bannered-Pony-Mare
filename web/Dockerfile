FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TESSDATA_PREFIX=/usr/share/tessdata
RUN apk add --no-cache \
      ffmpeg \
      python3 \
      py3-pip \
      py3-numpy \
      py3-opencv \
      tesseract-ocr \
      tesseract-ocr-data-eng \
      tiff \
      leptonica \
 && apk add --no-cache --virtual .ocr-build \
      git \
      cmake \
      g++ \
      make \
      pkgconf \
      tesseract-ocr-dev \
      tiff-dev \
      leptonica-dev \
 && git clone --depth 1 https://github.com/ruediger/VobSub2SRT.git /tmp/vobsub2srt \
 && sed -i 's/cmake_minimum_required(VERSION 2.6.4 FATAL_ERROR)/cmake_minimum_required(VERSION 3.10)/' /tmp/vobsub2srt/CMakeLists.txt \
 && sed -i 's/set(CMAKE_CXX_FLAGS "-ansi -pedantic -Wall -Wextra -Wno-long-long")/set(CMAKE_CXX_FLAGS "-std=gnu++17 -Wall -Wextra -Wno-long-long")/' /tmp/vobsub2srt/CMakeLists.txt \
 && sed -i 's/char \*text = tess_base_api.TesseractRect(image, 1, stride, 0, 0, width, height);/tess_base_api.SetImage(image, static_cast<int>(width), static_cast<int>(height), 1, static_cast<int>(stride)); char *text = tess_base_api.GetUTF8Text();/' /tmp/vobsub2srt/src/vobsub2srt.c++ \
 && sed -i '/#include "cmd_options.h++"/a #include <climits>' /tmp/vobsub2srt/src/vobsub2srt.c++ \
 && cmake -S /tmp/vobsub2srt -B /tmp/vobsub2srt/build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build /tmp/vobsub2srt/build -j"$(nproc)" \
 && install -m 0755 /tmp/vobsub2srt/build/bin/vobsub2srt /usr/local/bin/vobsub2srt \
 && rm -rf /usr/lib/python3.12/site-packages/opencv-python-4.12.0.dist-info \
 && pip3 install --break-system-packages --no-deps "pgsrip==0.3.0" \
 && pip3 install --break-system-packages babelfish cleanit click pysrt pyyaml pytesseract appdirs trakit \
 && rm -rf /tmp/vobsub2srt \
 && apk del .ocr-build \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs
RUN apk add --no-cache mkvtoolnix

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --chown=nextjs:nodejs scripts/ocr_bitmap.py /app/scripts/ocr_bitmap.py
COPY --chown=nextjs:nodejs lib/english-words.txt /app/lib/english-words.txt

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATA_ROOT=/data

CMD ["node", "server.js"]
