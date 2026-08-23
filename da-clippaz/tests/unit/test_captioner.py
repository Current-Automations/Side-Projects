from daclippaz.captioner import build_caption_filter, escape_drawtext

CFG = {"style": "part_label", "font_file": "C:/Windows/Fonts/arial.ttf"}


def test_part_label_only_for_parts_format():
    parts = build_caption_filter(CFG, "parts", 2, 4, None)
    highlights = build_caption_filter(CFG, "highlights", 2, 4, None)
    assert "Part 2/4" in parts
    assert highlights is None


def test_font_file_colon_is_escaped():
    assert r"fontfile='C\:/Windows/Fonts/arial.ttf'" in build_caption_filter(CFG, "parts", 1, 3, None)


def test_style_none_and_karaoke_draw_nothing():
    assert build_caption_filter({"style": "none"}, "parts", 1, 3, "T") is None
    assert build_caption_filter({"style": "karaoke"}, "parts", 1, 3, "T") is None


def test_title_is_truncated_and_escaped():
    cfg = dict(CFG, show_title=True, title_max_chars=20)
    out = build_caption_filter(cfg, "highlights", 1, 3, "A very long stream title that runs on")
    assert "..." in out
    assert escape_drawtext("a:b'c") == r"a\:b\'c"
