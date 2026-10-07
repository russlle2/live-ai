#!/usr/bin/env python3
"""Build a private ARM CPU engine without changing Termux or the source checkout."""
import argparse
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

REVISION = "a95a11e5b834057e684712963f90bbb730f4745c"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path.home() / "llama.cpp")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    prefix = os.environ.get("PREFIX") or str(Path(sys.executable).resolve().parent.parent)
    if platform.machine() not in ("aarch64", "arm64") or not prefix.startswith("/data/data/com.termux/"):
        raise SystemExit("Run this build in Termux on the target ARM64 phone.")
    features = Path("/proc/cpuinfo").read_text().lower().split()
    if not {"asimddp", "i8mm"}.issubset(features):
        raise SystemExit("This build requires verified ARM dot-product and int8 matrix instructions.")
    for tool in ("git", "cmake", "ninja", "clang", "clang++"):
        if not shutil.which(tool):
            raise SystemExit("Missing build tool: " + tool)
    revision = subprocess.check_output(["git", "-C", source, "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise SystemExit("Expected llama.cpp revision " + REVISION + "; source checkout left unchanged.")
    if subprocess.check_output(["git", "-C", source, "status", "--porcelain"], text=True).strip():
        raise SystemExit("Source checkout has changes; leave it intact and use a separate clean checkout.")
    build = Path.home() / ".local/build/live-guide-cpu-a95a11e"
    flags = {
        "CMAKE_BUILD_TYPE": "Release", "BUILD_SHARED_LIBS": "OFF",
        "LLAMA_USE_SYSTEM_GGML": "OFF", "GGML_NATIVE": "OFF", "GGML_CPU": "ON",
        "GGML_CPU_ARM_ARCH": "armv8.6-a+dotprod+i8mm", "GGML_CPU_REPACK": "ON",
        "GGML_BACKEND_DL": "OFF", "GGML_CPU_ALL_VARIANTS": "OFF",
        "GGML_OPENMP": "OFF", "GGML_LLAMAFILE": "OFF", "GGML_CPU_KLEIDIAI": "OFF",
        "GGML_VULKAN": "OFF", "GGML_OPENCL": "OFF", "GGML_CUDA": "OFF",
        "GGML_METAL": "OFF", "GGML_RPC": "OFF", "GGML_HEXAGON": "OFF",
        "LLAMA_OPENSSL": "OFF", "LLAMA_BUILD_TESTS": "OFF",
        "LLAMA_BUILD_EXAMPLES": "OFF", "LLAMA_BUILD_TOOLS": "ON",
        "LLAMA_BUILD_SERVER": "ON", "LLAMA_BUILD_WEBUI": "OFF",
    }
    environment = os.environ.copy()
    environment["PREFIX"] = prefix
    subprocess.run(["cmake", "-S", source, "-B", build, "-G", "Ninja",
                    *["-D" + k + "=" + v for k, v in flags.items()]], check=True, env=environment)
    subprocess.run(["cmake", "--build", build, "--target", "llama-server",
                    "-j", str(max(1, min(args.jobs, 4)))], check=True, env=environment)
    print("CPU_ENGINE_READY " + str(build / "bin/llama-server"), flush=True)
    print("Select it with cpu_binary in private models.json only after inference checks pass.")


if __name__ == "__main__":
    main()
