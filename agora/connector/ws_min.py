"""Minimal asyncio WebSocket client (RFC 6455) — stdlib only, NO external deps.

Enough for the Agora connector: text frames, client-side masking, ping/pong,
close, ws:// and wss://. This removes the `websockets` pip dependency so the
connector runs on any Python 3.8+ with zero installs (Constitution Art. I).

Usage:
    async with ws_connect(url) as ws:
        await ws.send('{"hello":1}')
        async for message in ws:
            ...
"""
import asyncio
import base64
import os
import ssl
import struct
from urllib.parse import urlparse


class WSClosed(Exception):
    pass


class _WS:
    def __init__(self, reader, writer):
        self.r = reader
        self.w = writer

    async def send(self, data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        await self._send_frame(0x1, data)

    async def _send_frame(self, opcode, data):
        header = bytearray([0x80 | opcode])  # FIN + opcode
        n = len(data)
        if n < 126:
            header.append(0x80 | n)           # MASK bit + len
        elif n < (1 << 16):
            header.append(0x80 | 126)
            header += struct.pack("!H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack("!Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.w.write(bytes(header) + masked)
        await self.w.drain()

    async def _recv_frame(self):
        b1, b2 = await self.r.readexactly(2)
        fin = b1 & 0x80
        opcode = b1 & 0x0F
        length = b2 & 0x7F
        if length == 126:
            length = struct.unpack("!H", await self.r.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await self.r.readexactly(8))[0]
        mask = await self.r.readexactly(4) if (b2 & 0x80) else None
        payload = await self.r.readexactly(length) if length else b""
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return fin, opcode, payload

    async def recv(self):
        """Next complete text message (str); handles control + fragmented frames."""
        data = bytearray()
        while True:
            try:
                fin, opcode, payload = await self._recv_frame()
            except asyncio.IncompleteReadError:
                raise WSClosed("connection closed")
            if opcode == 0x8:                 # close
                raise WSClosed("server closed")
            if opcode == 0x9:                 # ping -> pong
                await self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:                 # pong
                continue
            data.extend(payload)              # 0x0 cont / 0x1 text / 0x2 binary
            if fin:
                return data.decode("utf-8", "replace")

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return await self.recv()
        except WSClosed:
            raise StopAsyncIteration

    async def close(self):
        try:
            await self._send_frame(0x8, b"")
        except Exception:  # noqa: BLE001
            pass
        try:
            self.w.close()
            await self.w.wait_closed()
        except Exception:  # noqa: BLE001
            pass


class ws_connect:
    """async context manager performing the RFC 6455 upgrade handshake."""

    def __init__(self, url):
        self.url = url
        self.ws = None

    async def __aenter__(self):
        u = urlparse(self.url)
        host = u.hostname
        port = u.port or (443 if u.scheme == "wss" else 80)
        path = (u.path or "/") + (("?" + u.query) if u.query else "")
        ctx = ssl.create_default_context() if u.scheme == "wss" else None
        reader, writer = await asyncio.open_connection(host, port, ssl=ctx)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        writer.write(req.encode())
        await writer.drain()
        status = await reader.readuntil(b"\r\n\r\n")
        if b"101" not in status.split(b"\r\n", 1)[0]:
            writer.close()
            raise WSClosed(f"handshake failed: {status.split(chr(13).encode(), 1)[0]!r}")
        self.ws = _WS(reader, writer)
        return self.ws

    async def __aexit__(self, *exc):
        if self.ws:
            await self.ws.close()
