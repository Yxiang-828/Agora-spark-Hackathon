#!/usr/bin/env python3
"""Repackage a Mattermost plugin bundle so the Linux/macOS server binaries are
executable (0755). Needed when `make dist` runs on Windows, where NTFS doesn't
carry the Unix execute bit, so the bundled plugin-*-* binaries land non-executable
and the server fails activation with 'fork/exec ... permission denied'.

Usage: python build/fixperms.py <in.tar.gz> <out.tar.gz>
Cross-OS: uses tarfile, so it works the same on Windows/macOS/Linux.
"""
import io
import sys
import tarfile


def main(src: str, dst: str) -> None:
    with tarfile.open(src, "r:gz") as tin, tarfile.open(dst, "w:gz") as tout:
        for m in tin.getmembers():
            data = tin.extractfile(m).read() if m.isfile() else None
            if m.isdir():
                m.mode = 0o755
            elif m.isfile() and "/server/dist/" in m.name:
                m.mode = 0o755  # server executables
            tout.addfile(m, io.BytesIO(data) if data is not None else None)
    print(f"wrote {dst} (server/dist/* set executable)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: fixperms.py <in.tar.gz> <out.tar.gz>")
    main(sys.argv[1], sys.argv[2])
