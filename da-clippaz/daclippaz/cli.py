"""Command-line interface for Da Clippaz.

Subcommands:

* ``run`` - drain every pending job once, or ingest a YouTube URL and clip it.
* ``watch`` - poll the jobs folder and process new jobs as they appear.
* ``accounts`` - list the account profiles under ``configs/accounts/``.

Configuration comes from either ``--account NAME`` (a profile merged over
``configs/defaults.json``) or ``--config PATH`` for a single standalone file.
The account form is the one to use day to day, since each clipping account has
its own format, crop mode and output folder.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import load_config, load_account_config, list_accounts, ValidationError
from .logging_utils import configure_logging
from .ffmpeg_utils import check_ffmpeg
from .pipeline.runner import run_pipeline
from .watcher.watch import watch
from .pipeline.ingest import ingest_youtube


def _add_config_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--account",
        type=str,
        help="Account profile name from configs/accounts/ (merged over defaults.json)",
    )
    group.add_argument(
        "--config",
        type=str,
        help="Path to a standalone configuration JSON file",
    )
    parser.add_argument(
        "--configs-dir",
        type=str,
        default="configs",
        help="Directory holding defaults.json and accounts/ (default: configs)",
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="daclippaz",
        description="Da Clippaz - local video clipping pipeline",
    )

    subparsers = parser.add_subparsers(
        dest="command",
        required=True,
        help="Available commands",
    )

    run_parser = subparsers.add_parser("run", help="Run the clipping pipeline")
    _add_config_args(run_parser)
    run_parser.add_argument(
        "--source",
        type=str,
        default="local",
        choices=["local", "youtube"],
        help="Source type for processing",
    )
    run_parser.add_argument(
        "--url",
        type=str,
        help="YouTube URL when --source youtube is used",
    )

    watch_parser = subparsers.add_parser(
        "watch", help="Watch the jobs directory for new jobs"
    )
    _add_config_args(watch_parser)

    accounts_parser = subparsers.add_parser(
        "accounts", help="List available account profiles"
    )
    accounts_parser.add_argument(
        "--configs-dir",
        type=str,
        default="configs",
        help="Directory holding defaults.json and accounts/ (default: configs)",
    )

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "accounts":
        names = list_accounts(args.configs_dir)
        if not names:
            print(f"No account profiles found in {Path(args.configs_dir) / 'accounts'}")
        else:
            for name in names:
                print(name)
        return

    try:
        if args.account:
            config = load_account_config(args.account, args.configs_dir)
        else:
            config = load_config(Path(args.config))
    except (FileNotFoundError, ValidationError) as exc:
        parser.error(str(exc))
        return

    configure_logging(config.get("logging", {}))

    try:
        check_ffmpeg()
    except FileNotFoundError as exc:
        parser.error(str(exc))
        return

    if args.command == "run":
        if args.source == "youtube":
            if not args.url:
                parser.error("--url is required when --source youtube is used")
                return
            if not ingest_youtube(args.url, config):
                sys.exit(1)
        else:
            _, failed = run_pipeline(config)
            if failed:
                sys.exit(1)

    elif args.command == "watch":
        watch(config)

    else:
        parser.error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
