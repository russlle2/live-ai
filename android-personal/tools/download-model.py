#!/usr/bin/env python3
"""Download and verify the pinned Qwen3-4B-Instruct-2507 Q4_K_M GGUF."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import time
import urllib.request

REVISION = "a06e946bb6b655725eafa393f4a9745d460374c9"
FILENAME = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
SIZE = 2497281120
SHA256 = "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597"
URL = "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/" + REVISION + "/" + FILENAME
DEFAULT_OUTPUT = Path.home() / "models/live-rhetoric" / FILENAME


def hash_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified(path):
    return path.is_file() and path.stat().st_size == SIZE and hash_file(path) == SHA256


def transfer(partial):
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": "Live-Rhetoric-model/0.1", "Accept-Encoding": "identity"}
    if offset:
        headers["Range"] = "bytes=" + str(offset) + "-"
    request = urllib.request.Request(URL, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        if offset and response.status == 206:
            expected_prefix = "bytes " + str(offset) + "-"
            if not response.headers.get("Content-Range", "").startswith(expected_prefix):
                raise RuntimeError("Server returned an unexpected resume range.")
            mode = "ab"
        elif response.status == 200:
            mode, offset = "wb", 0
        else:
            raise RuntimeError("Unexpected download response: " + str(response.status))
        print("Downloading pinned model from " + str(offset) + " / " + str(SIZE) + " bytes", flush=True)
        progress = offset // (128 * 1024 * 1024)
        with partial.open(mode) as output:
            partial.chmod(0o600)
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                offset += len(chunk)
                if offset > SIZE:
                    raise RuntimeError("Download exceeded the expected model size.")
                output.write(chunk)
                next_progress = offset // (128 * 1024 * 1024)
                if next_progress != progress:
                    progress = next_progress
                    print(str(offset) + " / " + str(SIZE) + " bytes", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    destination = args.output.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if verified(destination):
        print("Verified model already present: " + str(destination))
        return
    partial = destination.with_name(destination.name + ".part")
    if partial.exists() and partial.stat().st_size >= SIZE:
        if verified(partial):
            os.replace(partial, destination)
            print("Verified completed download: " + str(destination))
            return
        raise SystemExit("Existing .part file failed verification. Remove that .part file and retry: " + str(partial))
    remaining = SIZE - (partial.stat().st_size if partial.exists() else 0)
    if shutil.disk_usage(destination.parent).free < remaining + 64 * 1024 * 1024:
        raise SystemExit("Not enough free space for the verified model download.")
    for attempt in range(3):
        try:
            transfer(partial)
            break
        except OSError:
            if attempt == 2:
                raise
            print("Download interrupted; resuming the partial file.", flush=True)
            time.sleep(2)
    print("Verifying exact size and SHA-256…", flush=True)
    if not verified(partial):
        raise SystemExit("Model verification failed; final model was not replaced. Retained partial: " + str(partial))
    os.replace(partial, destination)
    destination.chmod(0o600)
    print("Verified model ready: " + str(destination), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        raise SystemExit("Model download failed; rerun to resume: " + str(error))
