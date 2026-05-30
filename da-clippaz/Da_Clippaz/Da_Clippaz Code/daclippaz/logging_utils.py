"""Logging configuration for Da Clippaz.

This module centralises logging setup so that all parts of the
application use consistent log formatting and obey the configured log
level.  The :func:`configure_logging` function should be called
early in the CLI before any other modules import ``logging``.
"""

from __future__ import annotations

import logging
from typing import Any, Dict


def configure_logging(logging_config: Dict[str, Any]) -> None:
    """Configure the root logger based on configuration data.

    Parameters
    ----------
    logging_config : dict
        A dictionary containing logging configuration.  Currently supports
        the ``level`` key, whose value should be a valid logging level
        name (e.g. "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL").

    Notes
    -----
    If the provided level is unrecognised, defaults to ``INFO``.
    """
    level_str = logging_config.get("level", "INFO")
    try:
        level = getattr(logging, level_str.upper())
    except AttributeError:
        level = logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
