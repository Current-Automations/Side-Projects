"""Burned-in caption overlays.

Two styles are planned:

``part_label``
    A persistent "Part N" label plus the source title, drawn with FFmpeg's
    ``drawtext`` filter. No speech recognition needed. This is what makes the
    sequential-parts format legible: a viewer landing on part 14 can see there
    are 13 before it and what they are watching.

``karaoke``
    Word-level captions timed to speech. Not implemented. The intended local
    implementation is faster-whisper for word-level timestamps, which runs on
    the GPU with no API cost.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# drawtext treats these as syntax, so they have to be escaped in any text
# coming from a video title.
_ESCAPE_MAP = {
    "\\": r"\\",
    ":": r"\:",
    "'": r"\'",
    "%": r"\%",
}


def escape_drawtext(text: str) -> str:
    """Escape a string for safe use inside an FFmpeg drawtext filter."""
    return "".join(_ESCAPE_MAP.get(ch, ch) for ch in text)


def _font_option(captions_cfg: Dict[str, Any]) -> str:
    """Return the drawtext font option for the configured font file.

    Windows FFmpeg builds usually ship without fontconfig, so drawtext cannot
    resolve a family name and fails with "Cannot find a valid font". Pointing
    at a font file directly avoids that. The path separator has to be escaped
    because drawtext parses ':' as its own option delimiter.
    """
    font_file = captions_cfg.get("font_file")
    if not font_file:
        return ""
    escaped = str(font_file).replace("\\", "/").replace(":", r"\:")
    return f":fontfile='{escaped}'"


def build_caption_filter(
    captions_cfg: Dict[str, Any],
    clip_format: str,
    part_number: Optional[int] = None,
    total_parts: Optional[int] = None,
    source_title: Optional[str] = None,
) -> Optional[str]:
    """Build a drawtext filter chain, or None when no caption is wanted.

    Returns a filter string suitable for appending to an FFmpeg filter chain.
    """
    style = str(captions_cfg.get("style", "part_label")).strip().lower()
    if style == "none":
        return None
    if style == "karaoke":
        logger.warning("karaoke captions are not implemented yet; skipping captions")
        return None

    font_size = int(captions_cfg.get("font_size", 56))
    font_color = str(captions_cfg.get("font_color", "white"))
    box_color = str(captions_cfg.get("box_color", "black@0.5"))
    margin = int(captions_cfg.get("margin_px", 120))
    show_title = bool(captions_cfg.get("show_title", True))
    font_option = _font_option(captions_cfg)

    filters = []

    # The "Part N" label only makes sense for the sequential-parts format.
    # Highlights are standalone units, so a part number would mislead.
    if clip_format == "parts" and part_number is not None:
        label = f"Part {part_number}/{total_parts}" if total_parts else f"Part {part_number}"
        filters.append(
            f"drawtext=text='{escape_drawtext(label)}'"
            f"{font_option}"
            f":fontsize={font_size}"
            f":fontcolor={font_color}"
            f":box=1:boxcolor={box_color}:boxborderw=16"
            f":x=(w-text_w)/2"
            f":y={margin}"
        )

    if show_title and source_title:
        title_size = max(int(font_size * 0.6), 20)
        max_chars = int(captions_cfg.get("title_max_chars", 40))
        title = (
            source_title
            if len(source_title) <= max_chars
            else source_title[: max_chars - 3] + "..."
        )
        filters.append(
            f"drawtext=text='{escape_drawtext(title)}'"
            f"{font_option}"
            f":fontsize={title_size}"
            f":fontcolor={font_color}"
            f":box=1:boxcolor={box_color}:boxborderw=12"
            f":x=(w-text_w)/2"
            f":y=h-{margin}-text_h"
        )

    return ",".join(filters) if filters else None
