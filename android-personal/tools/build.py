#!/usr/bin/env python3
"""Build and personally sign the dependency-free Android app inside Termux."""
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
PRIVATE = Path.home() / ".local/share/live-rhetoric-build"
ANDROID_JAR = Path(os.environ.get("RHETORIC_ANDROID_JAR", str(PRIVATE / "android.jar")))
D8_JAR = Path(os.environ.get("RHETORIC_D8_JAR", str(PRIVATE / "d8.jar")))


def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def main():
    for tool in ("aapt2", "java", "javac", "apksigner", "keytool"):
        if not shutil.which(tool):
            raise SystemExit("Missing build tool: " + tool)
    if not ANDROID_JAR.is_file():
        raise SystemExit("Set RHETORIC_ANDROID_JAR to the official Android 35 android.jar")
    if not D8_JAR.is_file():
        raise SystemExit("Set RHETORIC_D8_JAR to the official build-tools 35 lib/d8.jar")
    if BUILD.exists():
        shutil.rmtree(BUILD)
    for directory in (BUILD / "gen", BUILD / "classes", BUILD / "dex"):
        directory.mkdir(parents=True)
    print("Compiling Android resources", flush=True)
    run(["aapt2", "compile", "--dir", ROOT / "res", "-o", BUILD / "resources.zip"])
    run(["aapt2", "link", "-o", BUILD / "unsigned.apk", "-I", ANDROID_JAR,
         "--manifest", ROOT / "AndroidManifest.xml", "--java", BUILD / "gen",
         "-A", ROOT / "assets", "--min-sdk-version", "31", "--target-sdk-version", "35",
         BUILD / "resources.zip"])
    sources = sorted((ROOT / "src").rglob("*.java")) + sorted((BUILD / "gen").rglob("*.java"))
    print("Compiling native Android shell", flush=True)
    run(["javac", "--release", "8", "-encoding", "UTF-8", "-classpath", ANDROID_JAR,
         "-d", BUILD / "classes", *sources])
    run(["java", "-cp", D8_JAR, "com.android.tools.r8.D8", "--release", "--min-api", "31",
         "--lib", ANDROID_JAR, "--output", BUILD / "dex", *sorted((BUILD / "classes").rglob("*.class"))])
    with zipfile.ZipFile(BUILD / "unsigned.apk", "a", compression=zipfile.ZIP_STORED) as archive:
        archive.write(BUILD / "dex/classes.dex", "classes.dex")
    PRIVATE.mkdir(parents=True, exist_ok=True)
    PRIVATE.chmod(0o700)
    password_path = PRIVATE / "signing-password"
    if not password_path.exists():
        password_path.write_text(secrets.token_urlsafe(32), encoding="utf-8")
        password_path.chmod(0o600)
    environment = os.environ.copy()
    environment["RHETORIC_SIGNING_PASSWORD"] = password_path.read_text(encoding="utf-8").strip()
    key_path = PRIVATE / "signing.jks"
    if not key_path.exists():
        print("Creating a private signing key for future app updates", flush=True)
        run(["keytool", "-genkeypair", "-keystore", key_path, "-storetype", "JKS",
             "-storepass:env", "RHETORIC_SIGNING_PASSWORD", "-keypass:env", "RHETORIC_SIGNING_PASSWORD",
             "-alias", "live-rhetoric", "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
             "-dname", "CN=Live Rhetoric Personal, O=Personal, C=US", "-noprompt"], env=environment)
        key_path.chmod(0o600)
    final = BUILD / "Live-Rhetoric-personal.apk"
    run(["apksigner", "sign", "--ks", key_path, "--ks-key-alias", "live-rhetoric",
         "--ks-pass", "env:RHETORIC_SIGNING_PASSWORD", "--key-pass", "env:RHETORIC_SIGNING_PASSWORD",
         "--out", final, BUILD / "unsigned.apk"], env=environment)
    run(["apksigner", "verify", "--verbose", final])
    destination = Path("/storage/emulated/0/Download/Live-Rhetoric-personal.apk")
    shutil.copy2(final, destination)
    print("APK_READY " + str(destination), flush=True)


if __name__ == "__main__":
    main()
