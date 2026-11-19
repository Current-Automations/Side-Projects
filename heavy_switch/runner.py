"""Does the heavy work while the switch is on, one GPU job at a time, then turns the switch off.
Day: queued podcasts from the last 7 days. Night: podcasts with the backlog first,
then the Podcast Rebuild until 8am; when both queues empty the PC sleeps. OBS open always wins: the runner waits, and says so on Discord the moment it starts waiting.
Started by heavyswitch.turn_on, never by a timer.
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from heavyswitch import (POD_APP, LOG, MIN_FREE_VRAM_MB, MORNING, NOWIN, RUNNER_LOCK, pod_waiting, free_gpu, is_night, is_on,
                         note_plan, rebuild_waiting, runner_alive, shows_line, state, turn_off, discord, vram_free_mb)

POD_PY = POD_APP / ".venv" / "Scripts" / "pythonw.exe"
REBUILD_DIR = os.environ.get("REBUILD_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "podcast_rebuild"))
REBUILD_PY = os.environ.get("REBUILD_PYTHON", sys.executable)
OBS_WAIT_S = 120


def log(msg: str) -> None:
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def obs_open() -> bool:
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq obs64.exe", "/NH"], capture_output=True, text=True, creationflags=NOWIN).stdout
    return "obs64.exe" in out.lower()


def run(cmd: list, cwd) -> str:
    log("run: " + " ".join(str(c) for c in cmd[1:]))
    p = subprocess.run([str(c) for c in cmd], cwd=str(cwd), capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN,
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    out = (p.stdout or "") + (p.stderr or "")
    failed = re.findall(r"FAILED (.+?): ", out)
    if failed:
        NOTES.append(f"{cmd[1]} failed on {len(failed)}: {'; '.join(failed)[:200]}")
    if "Traceback (most recent call last)" in out and "run finished:" not in out:
        # a crash used to end the run as "2 done, 40 waiting" with no reason given
        NOTES.append(f"{cmd[1]} crashed: {out.strip().splitlines()[-1][:200]}")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(out[-4000:] + "\n")
    return out


def sleep_pc() -> None:
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"],
                   creationflags=NOWIN)


NOTES = []
PLANNED = []
OBS_SINCE = []
DONE_SHOWS = []


def wait_for_obs() -> None:
    """A silent wait behind OBS can sit for hours, so the first check of each wait logs and pings."""
    if not OBS_SINCE:
        OBS_SINCE.append(time.time())
        log("waiting: OBS is open")
        discord("Heavy work is paused: OBS is open. Close OBS and it carries on by itself.")
    time.sleep(OBS_WAIT_S)


POD_SINCE = []


def pod_run_busy() -> bool:
    """The timer's podcast run holds data/pod_run.lock while a model reads; a GPU run started then just leaves."""
    try:
        pid = int((POD_APP / "data" / "pod_run.lock").read_text())
    except (OSError, ValueError):
        return False
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, creationflags=NOWIN).stdout
    return "python" in out.lower()


def wait_for_pod_run() -> None:
    if not POD_SINCE:
        POD_SINCE.append(time.time())
        log("waiting: a podcast run is already going")
        discord("Heavy work is waiting: the timer's podcast run is still going. It starts by itself when that one finishes.")
    time.sleep(OBS_WAIT_S)


def card_full() -> bool:
    """A card this full makes speaker ID spill into system RAM and run at CPU pace, so the run stops and says so instead."""
    free_gpu()
    free = vram_free_mb()
    if free is None or free >= MIN_FREE_VRAM_MB:
        return False
    if any(n.startswith("Stopped before starting") for n in NOTES):
        return True
    NOTES.append(f"Stopped before starting: only {free / 1024:.1f} GB free on the graphics card, speaker ID needs about "
                 f"{MIN_FREE_VRAM_MB / 1024:.0f}. Something open is holding it (a game, a dictation tool, a wallpaper app). Close it and press again.")
    log(NOTES[-1])
    return True


def run_pods(night: bool, only, sport=None) -> int:
    done = 0
    while is_on():
        if obs_open():
            wait_for_obs()
            continue
        OBS_SINCE.clear()
        if pod_run_busy():
            wait_for_pod_run()
            continue
        POD_SINCE.clear()
        waiting = pod_waiting(backlog=night, only=only, sport=sport)
        before = waiting["count"]
        if not before or card_full():
            break
        note_plan(night, only, fresh=not PLANNED, sport=sport)
        PLANNED.append(1)
        pick = ["--only", ",".join(map(str, only))] if only else ["--backlog"] if night else []
        if sport:
            pick += ["--sport", sport]
        out = run([POD_PY, "scripts/pull_podcasts.py", "--gpu"] + pick, POD_APP)
        NOTES.extend(l.split(" ", 1)[1] for l in out.splitlines() if " SLOW speaker ID" in l or " Transcribed without voice labels" in l)
        left = pod_waiting(backlog=night, only=only, sport=sport)
        after = left["count"]
        done += max(0, before - after)
        DONE_SHOWS.extend(r[6] for r in waiting["rows"] if r[0] not in set(left["ids"]))
        # stood down for OBS: go back to the wait, which pings the webhook, instead of ending with no reason given
        if after >= before and (obs_open() or "Another podcast run is still going" in out):
            continue
        # nothing moved: an error or a missing drive, which the run's own alerts report. Looping would spin all night.
        if after >= before:
            break
    return done


def rebuild() -> int:
    done = 0
    while is_night() and rebuild_waiting():
        if obs_open():
            wait_for_obs()
            continue
        OBS_SINCE.clear()
        if card_full():
            break
        out = run([REBUILD_PY, "rebuild.py", "--limit", "999", "--until", MORNING.strftime("%H:%M"), "--switch"], REBUILD_DIR)
        m = re.findall(r"run finished: (\d+) rebuilt", out)
        got = int(m[-1]) if m else 0
        done += got
        if not got:
            break
    return done


def take_lock() -> bool:
    """Two quick presses start two runners; whoever creates the lock file first runs. A lock left by a dead runner is cleared once."""
    for _ in range(2):
        try:
            with open(RUNNER_LOCK, "x") as f:
                f.write(str(os.getpid()))
            return True
        except FileExistsError:
            if runner_alive():
                return False
            RUNNER_LOCK.unlink(missing_ok=True)
    return False


def main() -> int:
    if not take_lock():
        return 0
    night, only, sport = is_night(), state()["only"], state().get("sport")
    log(f"start ({'night' if night else 'day'}{f', picked {len(only)}' if only else ''}{f', {sport} only' if sport else ''})")
    try:
        pods = run_pods(night, only, sport)
        notes = rebuild() if night else 0
    finally:
        free_gpu()
        RUNNER_LOCK.unlink(missing_ok=True)
    stopped_by_hand = not is_on()
    still = pod_waiting(backlog=night, only=only, sport=sport)
    left_pods, left_notes = still["count"], rebuild_waiting() if night else 0
    if is_on():
        turn_off("runner")
    what = f"{pods} podcast episode{'s' if pods != 1 else ''}" + (f" ({shows_line(DONE_SHOWS)})" if DONE_SHOWS else "")
    what += f", {notes} Podcast Rebuild note{'s' if notes != 1 else ''}" if night else ""
    if NOTES and not pods and not notes:
        text = "Heavy work did nothing."
    elif not pods and not notes and not left_pods and not left_notes:
        text = "Nothing was waiting."
    else:
        left_shows = f" ({still['shows']})" if still["shows"] else ""
        left = f" Still waiting: {left_pods} podcast{left_shows}, {left_notes} rebuild." if (left_pods or left_notes) else ""
        text = f"{'Overnight' if night else 'Heavy work'}{f' ({sport.upper()} only)' if sport else ''} done: {what}.{left}"
    emptied = not left_pods and not left_notes
    will_sleep = night and emptied and not stopped_by_hand
    text += "".join(" " + n for n in NOTES)
    discord(text + (" PC going to sleep." if will_sleep else " Heavy work is off."))
    log(f"end: {text}")
    if will_sleep:
        sleep_pc()
    return 0


if __name__ == "__main__":
    if sys.stderr is None:
        sys.stdout = sys.stderr = open(os.devnull, "w")
    raise SystemExit(main())
