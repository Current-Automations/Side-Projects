"""Command-line interface for Da Clippaz.

The CLI exposes two subcommands:

* ``run`` – run the clipping pipeline on existing jobs.
* ``watch`` – watch the input directory for new video files and process them automatically.

Both subcommands require a configuration file. The CLI verifies that
FFmpeg is installed before proceeding.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .config import load_config, ValidationError
from .logging_utils import configure_logging
from .ffmpeg_utils import check_ffmpeg
from .pipeline.runner import run_pipeline
from .watcher.watch import watch
from .pipeline.ingest import ingest_youtube  # PR2 import


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="daclippaz",
        description="Da Clippaz – local video clipping pipeline"
    )

    subparsers = parser.add_subparsers(
        dest="command",
        required=True,
        help="Available commands"
    )

    # RUN command
    run_parser = subparsers.add_parser(
        "run",
        help="Run the clipping pipeline"
    )

    run_parser.add_argument(
        "--config",
        type=str,
        required=True,
        help="Path to the configuration JSON file"
    )

    run_parser.add_argument(
        "--source",
        type=str,
        default="local",
        choices=["local", "youtube"],
        help="Source type for processing"
    )

    run_parser.add_argument(
        "--url",
        type=str,
        help="YouTube URL when --source youtube is used"
    )

    # WATCH command
    watch_parser = subparsers.add_parser(
        "watch",
        help="Watch the input directory for new files"
    )

    watch_parser.add_argument(
        "--config",
        type=str,
        required=True,
        help="Path to the configuration JSON file"
    )

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Load configuration
    config_path = Path(args.config)
    try:
        config = load_config(config_path)
    except (FileNotFoundError, ValidationError) as exc:
        parser.error(str(exc))
        return

    # Configure logging
    configure_logging(config.get("logging", {}))

    # Check FFmpeg availability
    try:
        check_ffmpeg()
    except FileNotFoundError as exc:
        parser.error(str(exc))
        return

    # Dispatch
    if args.command == "run":

        if args.source == "youtube":
            if not args.url:
                parser.error("--url is required when --source youtube is used")
                return
            ingest_youtube(args.url, config)
        else:
            run_pipeline(config)

    elif args.command == "watch":
        watch(config)

    else:
        parser.error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
