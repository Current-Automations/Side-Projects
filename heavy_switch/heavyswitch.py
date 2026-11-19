"""One switch for the work that loads the PC: Whisper, speaker ID and the local model. Light polls never read it.

  py -3 heavyswitch.py on [--night] [--by NAME] [--sport nfl|nba|cbb]   night = queued podcasts then the Podcast Rebuild, off at 8am, PC sleeps after
  py -3 heavyswitch.py off [--by NAME]
  py -3 heavyswitch.py toggle [--by NAME]           a hotkey or dashboard toggle (daytime: queued podcasts only)
  py -3 heavyswitch.py status                       on/off and what is waiting

Stdlib only, so any Python on the machine can call it.
"""
import datetime as dt
import json
import os
import sqlite3
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "state.json"
RUNNER_LOCK = HERE / "runner.lock"
LOG = HERE / "runner.log"
PLAN = HERE / "plan.json"
MORNING = dt.time(8, 0)
OLLAMA = "http://localhost:11434"
POD_APP = Path(os.environ.get("POD_APP_DIR", str(HERE.parent / "pod_app")))
POD_DB = POD_APP / "data" / "podcasts.db"
REBUILD_QUEUE = Path(os.environ.get("REBUILD_QUEUE_FILE", str(HERE.parent / "podcast_rebuild" / "Rebuild Queue.md")))
# the timer only transcribes the last 7 days (SHALLOW_DAYS in the app's podcast ingest), counted from the last run that
# cleared the queue (pod_window_from); night runs take the backlog too
SHALLOW_DAYS = 7
# GPU seconds per minute of audio, read off the last runs in pod_timings (median, so one slow run does not move it).
# These are the fallback before there are enough runs: download + Whisper + speaker ID, then the model reading the transcript.
TRANSCRIBE_S_PER_MIN, EXTRACT_S_PER_MIN = 5.0, 9.0
PACE_RUNS = 15
# speaker ID on a card with less free than this spills into system RAM and crawls; the runner stops and says so
MIN_FREE_VRAM_MB = 4000
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DETACHED = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)


# a run can be one league's shows only. A show marked 'all' counts for every league; a plain press runs everything
SPORT_LEAGUES = {"nfl": ("nfl", "cfb", "both", "all"), "nba": ("nba", "all")}


def _sport_where(sport) -> str:
    leagues = SPORT_LEAGUES.get(sport or "")
    return " AND s.league IN (%s)" % ",".join(f"'{l}'" for l in leagues) if leagues else ""


def _write(on: bool, mode, by: str, until=None, only=None, sport=None) -> dict:
    s = {"on": on, "mode": mode if on else None, "until": until, "by": by, "at": dt.datetime.now().isoformat(timespec="seconds"),
         "only": sorted(only) if on and only else None, "sport": sport if on and sport in SPORT_LEAGUES else None}
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s), encoding="utf-8")
    tmp.replace(STATE)
    return s


def state() -> dict:
    try:
        s = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        s = {}
    if s.get("on") and s.get("until") and dt.datetime.now() >= dt.datetime.fromisoformat(s["until"]):
        s = _write(False, None, "8am")
    return {"on": False, "mode": None, "until": None, "only": None, "sport": None, **s}


def is_on() -> bool:
    return state()["on"]


def is_night() -> bool:
    s = state()
    return s["on"] and s["mode"] == "night"


def turn_on(night: bool = False, by: str = "deck", only=None, sport=None) -> dict:
    """only: episode ids picked off the queue (picked from the queue UI). The run does those and nothing else, then switches off.
    sport: 'nfl' or 'nba' runs that league's shows only."""
    until = None
    if night:
        now = dt.datetime.now()
        stop = dt.datetime.combine(now.date(), MORNING)
        if stop <= now:
            stop += dt.timedelta(days=1)
        until = stop.isoformat(timespec="minutes")
    s = _write(True, "night" if night else "day", by, until, only, sport)
    start_runner()
    return s


def turn_off(by: str = "deck") -> dict:
    s = _write(False, None, by)
    free_gpu()
    return s


def toggle(by: str = "deck") -> dict:
    return turn_off(by) if is_on() else turn_on(False, by)


def free_gpu() -> None:
    """Qwen stays in video memory for minutes after a run unless asked to leave; that lag is what made the PC feel slow."""
    try:
        with urllib.request.urlopen(f"{OLLAMA}/api/ps", timeout=5) as r:
            loaded = [m["name"] for m in json.load(r).get("models", [])]
    except (OSError, ValueError):
        return
    for name in loaded:
        body = json.dumps({"model": name, "keep_alive": 0}).encode()
        try:
            urllib.request.urlopen(urllib.request.Request(f"{OLLAMA}/api/generate", data=body, headers={"Content-Type": "application/json"}), timeout=30).read()
        except OSError:
            pass


def _log(msg: str) -> None:
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def webhook() -> str:
    """Webhook URL for status pings, read from the DISCORD_WEBHOOK environment variable. Empty means no pings."""
    return os.environ.get("DISCORD_WEBHOOK", "").strip()


def discord(text: str) -> bool:
    url = webhook()
    if not url:
        _log(f"NO DISCORD_WEBHOOK set, this line went nowhere: {text}")
        return False
    body = json.dumps({"content": text, "username": "heavy-switch", "allowed_mentions": {"parse": []}}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "User-Agent": "heavy-switch/1.0"})
    try:
        urllib.request.urlopen(req, timeout=10).close()
        return True
    except OSError as e:
        _log(f"Discord refused: {e!r}: {text}")
        return False


def pid_alive(pid: int) -> bool:
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, creationflags=NOWIN).stdout
    return str(pid) in out


def runner_alive() -> bool:
    try:
        return pid_alive(int(RUNNER_LOCK.read_text()))
    except (OSError, ValueError):
        return False


def start_runner() -> None:
    if runner_alive():
        return
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    subprocess.Popen([str(pythonw if pythonw.exists() else sys.executable), str(HERE / "runner.py")], cwd=str(HERE),
                     creationflags=DETACHED | NOWIN, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _median(xs: list, fallback: float) -> float:
    xs = sorted(xs)
    return xs[len(xs) // 2] if len(xs) >= 3 else fallback


def pace(conn) -> tuple[float, float]:
    try:
        t = [((r[0] or 0) + (r[1] or 0) + (r[2] or 0)) / (r[3] / 60) for r in conn.execute(
            "SELECT fetch_s, whisper_s, diarize_s, audio_s FROM pod_timings WHERE stage = 'transcribe' AND audio_s > 60 ORDER BY id DESC LIMIT ?", (PACE_RUNS,))]
        e = [r[0] / (r[1] / 60) for r in conn.execute(
            "SELECT extract_s, audio_s FROM pod_timings WHERE stage = 'extract' AND audio_s > 60 ORDER BY id DESC LIMIT ?", (PACE_RUNS,))]
    except sqlite3.Error:
        t, e = [], []
    return _median(t, TRANSCRIBE_S_PER_MIN), _median(e, EXTRACT_S_PER_MIN)


def pod_waiting(backlog: bool = False, only=None, sport=None) -> dict:
    """Episodes the GPU still owes: new ones to transcribe (last 7 days, or everything at night) and transcripts not yet read.
    only narrows it to picked episodes, whatever their age; sport to one sport's shows."""
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=SHALLOW_DAYS)).isoformat()[:10]
    statuses = ("new", "deferred") if backlog else ("new",)
    try:
        conn = sqlite3.connect(f"file:{POD_DB}?mode=ro", uri=True, timeout=10)
        held = conn.execute("SELECT value FROM app_state WHERE key = 'pod_window_from'").fetchone()
        since = "0000" if backlog else min(since, held[0]) if held else since
        marks = ",".join("?" * len(statuses))
        rows = conn.execute(f"""SELECT e.id, e.show_key, e.duration_s, e.status, e.published_at, s.lane, COALESCE(s.name, e.show_key) FROM pod_episodes e
                                LEFT JOIN pod_shows s ON s.key = e.show_key
                                WHERE ((e.status IN ({marks}) AND substr(e.published_at, 1, 10) >= ?) OR e.status = 'transcribed'){_sport_where(sport)}""",
                            (*statuses, since)).fetchall()
        if only:
            picked = ",".join(str(int(i)) for i in only)
            rows = conn.execute(f"""SELECT e.id, e.show_key, e.duration_s, e.status, e.published_at, s.lane, COALESCE(s.name, e.show_key) FROM pod_episodes e
                                    LEFT JOIN pod_shows s ON s.key = e.show_key
                                    WHERE e.id IN ({picked}) AND e.status IN ('new', 'deferred', 'transcribed')""").fetchall()
        t_pace, e_pace = pace(conn)
        conn.close()
    except sqlite3.Error:
        return {"count": 0, "minutes": 0, "ids": [], "rows": [], "shows": ""}
    # a feed that never said how long it is gets an hour
    seconds = sum((r[2] or 3600) / 60 * (e_pace if r[3] == "transcribed" else t_pace + e_pace) for r in rows)
    return {"count": len(rows), "minutes": max(1, round(seconds / 60)) if rows else 0, "ids": [r[0] for r in rows], "rows": rows,
            "shows": shows_line(r[6] for r in rows)}


def shows_line(names) -> str:
    """"Show A 2, Show B": the shows behind a count, most episodes first, so a Discord line says what is waiting."""
    counts = {}
    for n in names:
        counts[n] = counts.get(n, 0) + 1
    return ", ".join(f"{n} {c}" if c > 1 else n for n, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def queue() -> list:
    """Everything the GPU could do, for a queue picker: this week's first, then the older backlog."""
    week = pod_waiting()
    soon = set(week["ids"])
    try:
        conn = sqlite3.connect(f"file:{POD_DB}?mode=ro", uri=True, timeout=10)
        t_pace, e_pace = pace(conn)
        rows = conn.execute("""SELECT e.id, COALESCE(s.name, e.show_key), e.title, e.published_at, e.duration_s, e.status, s.league FROM pod_episodes e
                               LEFT JOIN pod_shows s ON s.key = e.show_key
                               WHERE e.status IN ('new', 'deferred', 'transcribed') ORDER BY e.published_at DESC""").fetchall()
        conn.close()
    except sqlite3.Error:
        return []
    return [{"id": r[0], "show": r[1], "title": r[2], "date": (r[3] or "")[:10], "status": r[5], "this_week": r[0] in soon,
             "sport": "nba" if r[6] == "nba" else "both" if r[6] == "all" else "nfl",
             "minutes": max(1, round((r[4] or 3600) / 60 * (e_pace if r[5] == "transcribed" else t_pace + e_pace) / 60))} for r in rows]


def note_plan(night: bool, only, fresh: bool = False, sport=None) -> None:
    """The runner's list of episodes for this run, so a UI can draw how far along it is. Episodes polled mid-run join it."""
    rows = pod_waiting(backlog=night, only=only, sport=sport)["rows"]
    try:
        plan = {} if fresh else json.loads(PLAN.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        plan = {}
    eps = {str(i): d for i, d in plan.get("eps", {}).items()}
    for r in rows:
        eps.setdefault(str(r[0]), r[2] or 3600)
    plan = {"at": plan.get("at") or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "eps": eps}
    tmp = PLAN.with_suffix(".tmp")
    tmp.write_text(json.dumps(plan), encoding="utf-8")
    tmp.replace(PLAN)


def progress():
    """How far the podcast part of a run has got, as a share of the estimated GPU seconds. Each episode moves in two steps
    (transcribe, then read); between steps the bar creeps on the clock since the last step finished, never past 90% of the next one."""
    if not is_on():
        return None
    try:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        ids = [int(i) for i in plan["eps"]]
        conn = sqlite3.connect(f"file:{POD_DB}?mode=ro", uri=True, timeout=10)
        status = dict(conn.execute(f"SELECT id, status FROM pod_episodes WHERE id IN ({','.join(map(str, ids))})").fetchall()) if ids else {}
        last = conn.execute(f"SELECT MAX(at) FROM pod_timings WHERE episode_id IN ({','.join(map(str, ids))})").fetchone()[0] if ids else None
        t_pace, e_pace = pace(conn)
        conn.close()
    except (OSError, ValueError, KeyError, sqlite3.Error):
        return None
    if not ids:
        return None
    total = left = 0.0
    to_transcribe, to_read, done = [], [], 0
    for i in ids:
        mins = plan["eps"][str(i)] / 60
        t, e = mins * t_pace, mins * e_pace
        total += t + e
        st = status.get(i, "extracted")
        if st in ("new", "deferred"):
            left += t + e
            to_transcribe.append(t)
        elif st == "transcribed":
            left += e
            to_read.append(e)
        else:
            done += 1
    nxt = to_transcribe[0] if to_transcribe else to_read[0] if to_read else 0
    since = max(x for x in (plan.get("at"), last) if x)
    elapsed = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(since)).total_seconds()
    creep = min(max(elapsed, 0), 0.9 * nxt)
    pct = round(100 * (total - left + creep) / total) if total else 100
    step = "transcribing" if to_transcribe else "reading" if to_read else "finishing"
    # the bar is the episode in hand (fills, then starts over), the counter is the whole run.
    # Episodes are transcribed a few at a time and then read, so the bar runs once per step.
    cur = len(ids) - len(to_transcribe) + 1 if to_transcribe else done + 1 if to_read else len(ids)
    ep_pct = round(100 * min(max(elapsed, 0) / nxt, 0.95)) if nxt else 100
    return {"pct": min(pct, 100), "ep_pct": ep_pct, "cur": min(cur, len(ids)), "done": done, "of": len(ids), "step": step,
            "minutes": max(0, round((left - creep) / 60))}


def vram_free_mb():
    """Free memory on the card per nvidia-smi, or None when it cannot be read. Windows gives no per-app split."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=15, creationflags=NOWIN).stdout
        used, total = (int(x) for x in out.strip().splitlines()[0].split(","))
        return total - used
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        return None


def rebuild_waiting() -> int:
    try:
        lines = REBUILD_QUEUE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0
    return sum(1 for l in lines if l.startswith("- [ ] [[") and "⚠️" not in l)


def status_line() -> str:
    s = state()
    b, r = pod_waiting(backlog=True), rebuild_waiting()
    head = "off" if not s["on"] else f"on ({s['mode']}{', ' + s['sport'].upper() + ' only' if s.get('sport') else ''}{', until ' + s['until'][11:] if s['until'] else ''})"
    return f"Heavy work {head}. Waiting: {b['count']} podcast episode{'s' if b['count'] != 1 else ''} (about {b['minutes']} min), {r} Podcast Rebuild note{'s' if r != 1 else ''}."


def main(argv: list) -> int:
    cmd = argv[0] if argv else "status"
    by = argv[argv.index("--by") + 1] if "--by" in argv else "cli"
    sport = argv[argv.index("--sport") + 1] if "--sport" in argv else None
    if cmd == "on":
        turn_on("--night" in argv, by, sport=sport)
    elif cmd == "off":
        turn_off(by)
    elif cmd == "toggle":
        toggle(by)
    elif cmd != "status":
        print(__doc__)
        return 2
    print(status_line())
    return 0


if __name__ == "__main__":
    if sys.stdout:
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main(sys.argv[1:]))
