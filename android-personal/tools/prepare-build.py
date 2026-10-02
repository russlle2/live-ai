#!/usr/bin/env python3
"""Fetch pinned, official Android 35 compile/D8 JARs without installing an SDK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile

DEFAULT_DIRECTORY = Path.home() / ".local/share/live-rhetoric-build"
ARTIFACTS = (
    {
        "name": "android.jar",
        "url": "https://dl.google.com/android/repository/platform-35-ext15_r01.zip",
        "suffix": "/android.jar",
        "required_entry": "android/app/Activity.class",
    },
    {
        "name": "d8.jar",
        "url": "https://dl.google.com/android/repository/build-tools_r35_linux.zip",
        "suffix": "/lib/d8.jar",
        "required_entry": "com/android/tools/r8/D8.class",
    },
)


def valid_jar(path, required_entry):
    try:
        with zipfile.ZipFile(path) as jar:
            return required_entry in jar.namelist() and jar.testzip() is None
    except (OSError, zipfile.BadZipFile):
        return False


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(artifact, directory, refresh=False):
    destination = directory / artifact["name"]
    if not refresh and valid_jar(destination, artifact["required_entry"]):
        print("Using existing validated " + str(destination), flush=True)
        return None
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=directory) as temporary:
        temporary = Path(temporary)
        archive_path = temporary / "official-sdk.zip"
        archive_digest = hashlib.sha256()
        size = 0
        print("Downloading " + artifact["url"], flush=True)
        request = urllib.request.Request(artifact["url"], headers={"User-Agent": "Live-Rhetoric-build/0.1"})
        with urllib.request.urlopen(request, timeout=60) as response, archive_path.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > 512 * 1024 * 1024:
                    raise RuntimeError("Unexpected SDK archive size; refusing this download.")
                archive_digest.update(chunk)
                output.write(chunk)
        jar_path = temporary / artifact["name"]
        with zipfile.ZipFile(archive_path) as archive:
            matches = [name for name in archive.namelist() if name.endswith(artifact["suffix"])]
            if len(matches) != 1:
                raise RuntimeError("Expected exactly one " + artifact["suffix"] + " in the official archive.")
            member = matches[0]
            # Read only the selected member. Never extract archive-controlled paths.
            with archive.open(member) as source, jar_path.open("wb") as output:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
        if not valid_jar(jar_path, artifact["required_entry"]):
            raise RuntimeError("Downloaded JAR failed ZIP/class validation.")
        artifact_digest = digest_file(jar_path)
        jar_path.chmod(0o600)
        os.replace(jar_path, destination)
        print("Prepared " + str(destination) + " SHA256=" + artifact_digest, flush=True)
        return {
            "url": artifact["url"],
            "archive_member": member,
            "archive_sha256": archive_digest.hexdigest(),
            "artifact_sha256": artifact_digest,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY,
                        help="Private destination; default matches tools/build.py")
    parser.add_argument("--refresh", action="store_true", help="Download again instead of reusing valid JARs")
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    manifest_path = directory / "sdk-downloads.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            manifest = {}
    except (OSError, ValueError):
        manifest = {}
    for artifact in ARTIFACTS:
        evidence = prepare(artifact, directory, args.refresh)
        if evidence is not None:
            manifest[artifact["name"]] = evidence
        temporary_manifest = directory / "sdk-downloads.json.part"
        temporary_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        temporary_manifest.chmod(0o600)
        os.replace(temporary_manifest, manifest_path)
    print("Build dependencies ready. Run: python tools/build.py", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        raise SystemExit("Build dependency download failed: " + str(error))
