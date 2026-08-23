# Da Clippaz

A local video clipping pipeline in Python. It takes a long recording (a YouTube
upload, a Twitch VOD export, a local file), cuts it into vertical 9:16 clips and
burns in captions, ready to post. Everything runs on this machine: FFmpeg,
yt-dlp, MediaPipe and NVENC. No API keys, no per-clip cost.

## Status

Working end to end. Local files and YouTube URLs both ingest, all three framing
modes render, captions burn in, and NVENC is used automatically when the card
supports it.

Verified on a 185s 1080p source: 4 clips at 1080x1920 in 15s with `crop` mode
and NVENC.

Not built yet:

- **Posting.** Clips land in the output folder and get uploaded by hand.
- **Karaoke captions.** The config option exists and is rejected at load time
  with a clear error. The plan is faster-whisper for word-level timestamps,
  which runs locally on the GPU.
- **Campaign monitoring.** Reading a clipping campaign's rules and configuring
  an account to match is still manual.

## How work flows

```
work/input/          drop a video here
   |  watcher waits for the file to stop growing, then
   v
work/jobs/<account>/<id>/    source + job.json + status.json
   |  runner cuts, frames, captions
   v
work/output/<account>/<video-name>-<id>/    finished clips, ready to post
```

Three ways in, one way out:

- **Drop a file** in `input_dir` and leave `watch` running. The watcher waits
  until the file has stopped growing (so it never windows a half-copied file),
  moves it into a job folder and processes it.
- **`run --source youtube --url ...`** downloads, creates the job, clips it.
- **`run`** on its own drains any job folder already sitting in `pending`.

Finished clips are moved out of the job folder into `output_dir`, in a folder
named after the video. The job folder keeps the source and the json, so a run
can be inspected or retried after the fact.

## Accounts

Each clipping account gets a profile under `configs/accounts/`. A profile only
states what differs from `configs/defaults.json`, so a campaign account and a
sequential-parts account can sit side by side without duplicating settings.

```
configs/defaults.json          shared settings
configs/accounts/lol.json      parts format, crop mode
configs/accounts/campaign.json highlights format, smart mode
```

Two clip formats:

- **`parts`** cuts the whole source into sequential overlapping clips, each
  labelled `Part N/Total`. Built for viewers who want the context around a
  moment, not just the moment.
- **`highlights`** cuts standalone clips with no part label, which is what most
  paid campaigns want.

## Quick start

### Prerequisites

- **Python 3.12**
- **FFmpeg** on `PATH`. The CLI runs `ffmpeg -version` and exits with a clear
  error if it is missing.
- An NVIDIA card is optional. Without one the encoder falls back to `libx264`
  and logs that it did.

### Install

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Fetch the face model used by `smart` mode. It is not committed, because a
text-mode round trip silently corrupts a `.tflite` and the failure only shows up
at render time as `not a valid Flatbuffer buffer`:

```powershell
curl -L -o models\blaze_face_short_range.tflite `
  https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
```

### Usage

```powershell
python -m daclippaz accounts                                  # list profiles
python -m daclippaz run --account lol                          # drain pending jobs once
python -m daclippaz run --account lol --source youtube --url <URL>
python -m daclippaz watch --account lol                        # poll and process
```

Drop a video into the account's `input_dir` while `watch` is running and it
gets picked up on the next poll.

`--config <path>` still works for a single standalone config file.

`run` processes every pending job in the account's `jobs_root` and exits, which
suits a scheduled task. `watch` polls on an interval and never exits, so it
wants a background window.

### Framing modes

| Mode | What it does | Cost |
|------|--------------|------|
| `crop` | Centre-crop to 9:16, then scale | Fast, roughly 12x realtime with NVENC |
| `blur` | Blurred full-frame background, video centred on top | Fast |
| `smart` | MediaPipe face tracking drives a moving crop | Slow, roughly realtime, CPU bound in the detection pass |

`smart` renders its intermediate through OpenCV, which writes MPEG-4 Part 2 at a
very high bitrate. The remux always re-encodes rather than copying, otherwise a
25 Mbps non-H.264 file would go to TikTok.

### Config reference

Everything below is settable in `defaults.json` or overridden per account.

| Key | Meaning |
|-----|---------|
| `input_dir` | Watched for dropped video files |
| `jobs_root` | Where job folders live. Working state. |
| `output_dir` | Where finished clips are published, ready to post |
| `temp_dir` | Scratch for smart mode intermediates, cleared after each job |
| `clip_settings.format` | `parts` or `highlights` |
| `clip_settings.clip_length_seconds` | Any positive integer. Campaigns dictate this. |
| `clip_settings.overlap_seconds` | Seconds of overlap between consecutive clips |
| `clip_settings.min_tail_seconds` | Shortest allowed final clip. A shorter remainder is folded into the previous window instead of posted as a stub. |
| `clip_settings.max_clips_per_video` | Hard cap on clips per source |
| `tiktok.mode` | `crop`, `blur` or `smart` |
| `encoder.video` | `auto`, `nvenc` or `libx264`. `auto` probes `ffmpeg -encoders`. |
| `captions.style` | `none`, `part_label`, or `karaoke` (rejected until built) |
| `captions.font_file` | Path to a `.ttf`. Required on Windows, where FFmpeg ships without fontconfig and cannot resolve a family name. |

### Project layout

| Folder / file | Purpose |
|---|---|
| `daclippaz/cli.py` | Argument parsing, account or config loading, dispatch |
| `daclippaz/config.py` | Validation, defaults merge, account profiles |
| `daclippaz/captioner.py` | Builds the `drawtext` filter chain |
| `daclippaz/encoders.py` | NVENC detection and encoder argument building |
| `daclippaz/pipeline/segmentation.py` | Clip windows and the FFmpeg render |
| `daclippaz/pipeline/ingest.py` | yt-dlp download and job creation |
| `daclippaz/pipeline/jobs.py` | Job folder creation, naming, publish paths |
| `daclippaz/pipeline/runner.py` | Job state machine, retries, one-shot drain |
| `daclippaz/pipeline/smart_framing.py` | MediaPipe face tracking and reframing |
| `daclippaz/watcher/watch.py` | Polls `input_dir` for drops and `jobs_root` for pending jobs |
| `daclippaz/clipper.py` | Standalone clipper used only by the GUI. Overlaps `segmentation.py` and should be folded into it. |
| `daclippaz/gui.py` | Tkinter front end |
| `configs/` | `defaults.json` plus one file per account |
| `work/` | Local job folders, downloads, rendered clips. Not committed. |

### Tests

```powershell
python -m pytest tests -q
```

Covers config validation and merging, clip window maths (including the tail case
that used to drop the end of every source), caption filter construction, job
creation and the watcher's settle logic.
