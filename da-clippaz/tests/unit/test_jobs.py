import json

from daclippaz.pipeline.jobs import create_job, publish_dir, slugify

CONFIG = {
    "jobs_root": "jobs",
    "output_dir": "out",
    "clip_settings": {"clip_length_seconds": 60, "overlap_seconds": 2},
}


def test_slugify_strips_punctuation_and_case():
    assert slugify("Caedrel Reacts! LCK Finals (Game 5)") == "caedrel-reacts-lck-finals-game-5"


def test_slugify_truncates_without_trailing_dash():
    assert not slugify("word " * 40).endswith("-")


def test_publish_dir_is_named_after_the_video():
    # The output folder is opened by hand when posting, so a job id alone
    # would make it unusable.
    target = publish_dir({"output_dir": "out"}, "abc123def", "LCK Finals Game 5")
    assert target.name == "lck-finals-game-5-abc123"


def test_publish_dir_falls_back_to_job_id_without_a_title():
    assert publish_dir({"output_dir": "out"}, "abc123def", None).name == "abc123def"


def test_create_job_writes_pending_status_and_duration(tmp_path):
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"x")
    config = dict(CONFIG, jobs_root=str(tmp_path / "jobs"))

    job_dir = create_job(source, config, 185.0, metadata={"title": "T"}, job_id="j1")

    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
    assert job["metadata"]["duration"] == 185.0
    assert job["parameters"]["clip_length_seconds"] == 60
    assert status == {"state": "pending", "retries": 0}
    assert source.exists()


def test_create_job_can_move_the_source_in(tmp_path):
    source = tmp_path / "drop.mkv"
    source.write_bytes(b"x")
    config = dict(CONFIG, jobs_root=str(tmp_path / "jobs"))

    job_dir = create_job(source, config, 10.0, job_id="j2", move_source=True)

    # The file has to leave input_dir, or the next poll adopts it again.
    assert not source.exists()
    assert (job_dir / "source.mkv").exists()


def test_slug_cuts_on_a_word_boundary():
    title = "New Skills v1 2 brings wait what writing for agents and fixes grill me"
    slug = slugify(title)
    assert len(slug) <= 60
    # No half-words at the end, and no trailing dash.
    assert slug == "new-skills-v1-2-brings-wait-what-writing-for-agents-and"
