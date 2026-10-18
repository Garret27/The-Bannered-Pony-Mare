FROM python:3.12-alpine

WORKDIR /app
COPY lan-proxy.py /app/lan-proxy.py

ENV LISTEN_PORT=18096
ENV TARGET_HOST=192.168.0.130
ENV TARGET_PORT=8096

EXPOSE 18096
CMD ["sh", "-c", "python /app/lan-proxy.py \"$LISTEN_PORT\" \"$TARGET_HOST\" \"$TARGET_PORT\""]
