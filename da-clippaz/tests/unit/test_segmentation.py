from daclippaz.pipeline.segmentation import compute_clip_windows


def test_tail_is_covered():
    # 185s at 60s clips with 2s overlap leaves an 11s remainder. Dropping it
    # would mean every parts series is missing its ending.
    windows = compute_clip_windows(185.0, 60, 2, 40)
    assert windows == [(0, 60), (58, 118), (116, 176), (174, 185)]


def test_short_tail_folds_into_previous_window():
    windows = compute_clip_windows(124.0, 60, 2, 40, min_tail_seconds=10)
    assert windows[-1] == (58, 124)
    assert len(windows) == 2


def test_source_shorter_than_clip_length_still_produces_one_clip():
    assert compute_clip_windows(30.0, 60, 2, 99) == [(0, 30)]


def test_max_clips_is_respected():
    assert len(compute_clip_windows(3600.0, 60, 2, 5)) == 5


def test_overlap_at_or_above_clip_length_yields_nothing():
    assert compute_clip_windows(185.0, 60, 60, 10) == []
