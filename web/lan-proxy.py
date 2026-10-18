#!/usr/bin/env python3
"""Forward a local TCP port to a LAN host that Docker containers cannot reach directly."""

from __future__ import annotations

import socket
import sys
import threading


def pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            src.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            dst.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def handle(client: socket.socket, target: tuple[str, int]) -> None:
    try:
        remote = socket.create_connection(target, timeout=10)
    except OSError:
        client.close()
        return
    threading.Thread(target=pipe, args=(client, remote), daemon=True).start()
    pipe(remote, client)
    client.close()
    remote.close()


def main() -> None:
    if len(sys.argv) != 4:
        print("usage: lan-proxy.py <listen-port> <target-host> <target-port>", file=sys.stderr)
        sys.exit(2)
    listen_port = int(sys.argv[1])
    target = (sys.argv[2], int(sys.argv[3]))
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", listen_port))
    server.listen(64)
    print(f"proxy 0.0.0.0:{listen_port} -> {target[0]}:{target[1]}", flush=True)
    while True:
        client, _ = server.accept()
        threading.Thread(target=handle, args=(client, target), daemon=True).start()


if __name__ == "__main__":
    main()
