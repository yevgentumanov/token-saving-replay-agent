from __future__ import annotations

import json
import logging
import sys
import time
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).parent
LOG_DIR = BASE_DIR / ".replay" / "logs"
APP_LOG_FILE = LOG_DIR / "app.log"
FRONTEND_LOG_FILE = LOG_DIR / "frontend.log"
STARTUP_LOG_FILE = LOG_DIR / "startup.log"
MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 5

_configured = False


class JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in getattr(record, "extra_data", {}).items():
            payload[key] = _safe_json_value(value)
        if record.exc_info:
            payload["exception"] = "".join(traceback.format_exception(*record.exc_info)).strip()
        return json.dumps(payload, ensure_ascii=False)


def _safe_json_value(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        return repr(value)


def setup_logging() -> None:
    global _configured
    if _configured:
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    app_handler = RotatingFileHandler(
        APP_LOG_FILE,
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    app_handler.setFormatter(JsonLineFormatter())
    app_handler.setLevel(logging.INFO)
    root.addHandler(app_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    console_handler.setLevel(logging.WARNING)
    root.addHandler(console_handler)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)

    _configured = True
    logging.getLogger(__name__).info(
        "Logging initialized",
        extra={"extra_data": {"log_dir": str(LOG_DIR), "app_log": str(APP_LOG_FILE)}},
    )


def get_logger(name: str) -> logging.Logger:
    setup_logging()
    return logging.getLogger(name)


def log_event(logger: logging.Logger, event: str, **data: Any) -> None:
    logger.info(event, extra={"extra_data": data})


def log_warning(logger: logging.Logger, event: str, **data: Any) -> None:
    logger.warning(event, extra={"extra_data": data})


def log_error(logger: logging.Logger, event: str, exc: BaseException | None = None, **data: Any) -> None:
    if exc is not None:
        logger.error(event, exc_info=(type(exc), exc, exc.__traceback__), extra={"extra_data": data})
    else:
        logger.error(event, extra={"extra_data": data})


def append_frontend_event(event: dict[str, Any]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "server_ts": time.time(),
        **event,
    }
    line = json.dumps(_safe_json_value(payload), ensure_ascii=False)
    with FRONTEND_LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def append_startup_event(event: str, **data: Any) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "server_ts": time.time(),
        "event": event,
        **data,
    }
    line = json.dumps(_safe_json_value(payload), ensure_ascii=False)
    with STARTUP_LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def recent_log_lines(path: Path, max_lines: int = 80) -> list[str]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    return [line.rstrip("\n") for line in lines[-max_lines:]]
