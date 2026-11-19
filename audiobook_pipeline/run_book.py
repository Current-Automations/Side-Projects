"""End-to-end: EPUB -> segmented, chapter-tagged m4b, with a Whisper warning log.

Usage:
  venv\\Scripts\\python.exe run_book.py "<path to .epub>" [voice]

Circuit breaker: any single segment that fails synthesis (or normalization) 3
times in a row stops the whole run with exit code 1 rather than looping.
Resumable: a killed run keeps its normalized segments in WORK_ROOT and the
next invocation skips them. Output is disposable (listen, delete), so
there is no library management.
"""
import os
import shutil
import sys
import time
from pathlib import Path

import soundfile as sf

from epub_extract import extract_chapters, read_metadata, safe_name
from segment import segment_book, spoken_label, HARD_CEILING_MIN
from synthesize import synthesize_segment, SR

# Final deliverable only. Point AUDIOBOOK_OUT_DIR at a synced folder to reach a phone.
OUT_ROOT = Path(os.environ.get("AUDIOBOOK_OUT_DIR", str(Path.home() / "Audiobooks")))
# Intermediate raw/normalized wavs -- local only. These used to sit under
# OUT_ROOT and a sync client would queue gigabytes of throwaway audio ahead of the
# actual m4b, delaying it reaching the phone. Never put scratch work in a
# synced folder again.
WORK_ROOT = Path(os.environ.get("AUDIOBOOK_WORK_DIR", str(Path(__file__).resolve().parent / "_work")))
MAX_RETRIES = 3


def _retry(what: str, fn, i: int, n: int, label: str):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn()
        except Exception as e:
            print(f"    [{i}/{n}] {what} attempt {attempt}/{MAX_RETRIES} FAILED: {e}")
    print(f"CIRCUIT BREAKER: segment {i} ({label!r}) {what} failed {MAX_RETRIES}x. Stopping run.")
    sys.exit(1)


def run(epub_path: Path, voice: str = "af_heart"):
    meta = read_metadata(epub_path)
    book_name = safe_name(f"{meta['title']} - {meta['author']}" if meta["author"] else meta["title"])
    work_dir = WORK_ROOT / book_name
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = OUT_ROOT / book_name
    out_m4b = out_dir / f"{book_name}.m4b"
    log_path = out_dir / "validation_log.txt"
    run_log_path = out_dir / "run_log.txt"

    print(f"[1/5] Extracting chapters from {epub_path.name}")
    print(f"    {meta['title']} -- {meta['author'] or 'unknown author'}")
    chapters = extract_chapters(epub_path)
    print(f"    {len(chapters)} chapters")

    print("[2/5] Segmenting")
    segments = segment_book(chapters)
    for i, seg in enumerate(segments, 1):
        w = len(seg.text.split())
        print(f"    {i:2d}. {seg.label!r} (~{w/150:.1f} min)")

    print("[3/5] Synthesizing + normalizing each segment")
    from normalize import normalize_wav

    norm_wavs, labels, texts = [], [], []
    n = len(segments)
    for i, seg in enumerate(segments, 1):
        raw_wav = work_dir / f"seg_{i:03d}_raw.wav"
        norm_wav = work_dir / f"seg_{i:03d}_norm.wav"

        if norm_wav.exists() and norm_wav.stat().st_size > 0:
            print(f"    [{i}/{n}] {seg.label!r} -> cached from earlier run")
        else:
            t0 = time.time()

            announce = spoken_label(seg.label)
            if i == 1:
                by = f", by {meta['author']}" if meta["author"] else ""
                announce = f"{meta['title']}{by}.\n\n{announce}"

            def synth():
                audio = synthesize_segment(seg.text, voice, announce=announce)
                sf.write(raw_wav, audio, SR)

            _retry("synthesis", synth, i, n, seg.label)
            _retry("normalize", lambda: normalize_wav(raw_wav, norm_wav), i, n, seg.label)
            raw_wav.unlink(missing_ok=True)
            print(f"    [{i}/{n}] {seg.label!r} -> {time.time()-t0:.1f}s")
        norm_wavs.append(norm_wav)
        labels.append(seg.label)
        texts.append(seg.text)

    print("[4/5] Packaging m4b")
    from package import package_m4b

    result_path, total_min = package_m4b(
        norm_wavs, labels, out_m4b, work_dir,
        title=meta["title"], author=meta["author"], cover=meta["cover"],
    )
    print(f"    {result_path} ({total_min:.1f} min total)")

    durations = [sf.info(str(w)).duration / 60 for w in norm_wavs]
    over = [(l, d) for l, d in zip(labels, durations) if d > HARD_CEILING_MIN]
    run_lines = [f"{meta['title']} -- {meta['author']}", f"{len(chapters)} chapters, {n} segments, {total_min:.1f} min total", ""]
    run_lines += [f"{i:3d}. {d:5.1f} min  {l}" for i, (l, d) in enumerate(zip(labels, durations), 1)]
    if over:
        run_lines += ["", f"WARNING: {len(over)} segment(s) over the {HARD_CEILING_MIN} min ceiling:"]
        run_lines += [f"  {d:.1f} min  {l}" for l, d in over]
        print(f"    WARNING: {len(over)} segment(s) over {HARD_CEILING_MIN} min, see run_log.txt")
    run_log_path.write_text("\n".join(run_lines) + "\n", encoding="utf-8")

    print("[5/5] Whisper validation (warning log only)")
    from validate import validate_segment

    all_warnings = []
    for i, (wav, label, text) in enumerate(zip(norm_wavs, labels, texts), 1):
        try:
            warnings = validate_segment(str(wav), text, label)
            if warnings:
                print(f"    [{i}/{n}] {len(warnings)} warning(s)")
                all_warnings.extend(warnings)
            else:
                print(f"    [{i}/{n}] clean")
        except Exception as e:
            print(f"    [{i}/{n}] validation error (non-fatal): {e}")
            all_warnings.append(f"[{label}] VALIDATION ERROR: {e}")

    log_path.write_text(
        "\n".join(all_warnings) if all_warnings else "Clean: no comprehension-breaking gaps found in any segment.",
        encoding="utf-8",
    )

    shutil.rmtree(work_dir, ignore_errors=True)

    print(f"\nDone. m4b: {result_path}\nLog: {log_path}")
    return result_path


if __name__ == "__main__":
    sys.stdout.reconfigure(line_buffering=True)
    epub = Path(sys.argv[1])
    voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
    run(epub, voice)
