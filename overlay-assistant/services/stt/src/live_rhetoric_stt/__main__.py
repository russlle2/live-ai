from __future__ import annotations

import uvicorn

from .settings import Settings


def main() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        "live_rhetoric_stt.main:app",
        host=settings.host,
        port=settings.port,
        workers=1,
    )


if __name__ == "__main__":
    main()
