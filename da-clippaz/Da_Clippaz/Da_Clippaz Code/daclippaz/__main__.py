"""Entry point for running Da Clippaz as a module.

Usage
-----
    python -m daclippaz gui          # open the GUI
    python -m daclippaz <cli args>   # run the CLI (run / watch subcommands)
"""

from __future__ import annotations

import sys


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "gui":
        from .gui import launch
        launch()
    else:
        from .cli import main as cli_main
        cli_main()


if __name__ == "__main__":
    main()
