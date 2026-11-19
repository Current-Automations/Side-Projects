"""Rebuild podcast notes as book-style folders: a hub note plus one deep-dive per segment.

Usage:
  py -3 rebuild.py                 # nightly: next N from the queue
  py -3 rebuild.py --limit 1
  py -3 rebuild.py --limit 60 --hours 10   # run straight through the night
  py -3 rebuild.py --note "1150 - Guest Name - Episode Title"
  py -3 rebuild.py --note "..." --dry-run    # fetch + segment only, write nothing to the vault
"""
import argparse, datetime as dt, difflib, glob, json, os, re, shutil, subprocess, sys, time, traceback
from pathlib import Path

import requests

VAULT = Path(os.environ.get("NOTES_DIR", str(Path.home() / "notes")))
PODS = VAULT / "Knowledge" / "Podcasts"
QUEUE = PODS / "Rebuild Queue.md"
HERE = Path(__file__).parent
STAGING = HERE / "staging"
LOG = HERE / "rebuild.log"
LOCK = HERE / "rebuild.lock"
OLLAMA = "http://localhost:11434/api/chat"
MODEL = "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M"
CLAUDE_MODEL = "sonnet"
MIN_SEG_MIN = 12
FALLBACK_SEG_MIN = 18
SHORT_EP_MIN = 45
MAX_RUN_HOURS = 4
RUN_STARTED = time.time()

if sys.stdout:  # None under pythonw (the scheduled task)
    sys.stdout.reconfigure(encoding="utf-8")
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
CLAUDE = shutil.which("claude.cmd") or shutil.which("claude") or "claude"


def log(msg):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M} {msg}"
    print(line)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def safe(s):
    s = s.replace("—", "-").replace("–", "-")
    return re.sub(r'[<>:"/\\|?*]', "", s).strip().rstrip(".")


# ── Queue ─────────────────────────────────────────────────────────────────

def read_queue():
    items = []
    for i, line in enumerate(QUEUE.read_text(encoding="utf-8").splitlines()):
        m = re.match(r"^- \[ \] \[\[([^\]|]+)(?:\|[^\]]*)?\]\]", line)
        if m:
            items.append((i, m.group(1)))
    return items


def mark_queue(name, status):
    lines = QUEUE.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        if re.match(rf"^- \[ \] \[\[{re.escape(name)}(\|[^\]]*)?\]\]", line):
            if status == "done":
                lines[i] = line.replace("- [ ]", "- [x]", 1) + f" (rebuilt {dt.date.today()})"
            else:
                lines[i] = re.sub(r" ⚠️.*$", "", line) + f" ⚠️ {status}"
            break
    QUEUE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def find_note(name):
    hits = [Path(p) for p in glob.glob(str(PODS / "**" / f"{glob.escape(name)}.md"), recursive=True)]
    hits = [h for h in hits if "_transcripts" not in h.parts and "Solved" not in h.parts]
    if not hits:
        raise RuntimeError(f"note not found: {name}")
    return hits[0]


# ── Transcript ────────────────────────────────────────────────────────────

def show_of(note):
    return note.relative_to(PODS).parts[0]


def release_date(show, name, note_text=""):
    key = name.split(" - ")[0]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", key):
        return dt.date.fromisoformat(key)
    m = re.search(r"^released:\s*(\d{4}-\d{2}-\d{2})", note_text or "", re.M)
    if m:
        return dt.date.fromisoformat(m.group(1))
    if not key.isdigit():
        return None
    feeds = json.loads((HERE / "feeds.json").read_text(encoding="utf-8")) if (HERE / "feeds.json").exists() else {}
    for it in feeds.get(show, []):
        if it.get("ep") == str(int(key)) or re.match(rf"#?0*{int(key)}\b", it["t"]) or re.search(rf"#0*{int(key)}\b", it["t"]):
            return dt.date.fromisoformat(it["d"])
    return None


def youtube_lookup(note_text, show, name):
    py = sys.executable.replace("pythonw.exe", "python.exe")
    m = re.search(r"(?:v=|youtu\.be/|YouTube )([A-Za-z0-9_-]{11})", note_text)
    if m:
        r = subprocess.run([py, "-m", "yt_dlp", "--skip-download", "--dump-json", m.group(1)],
                           capture_output=True, text=True, encoding="utf-8", timeout=180, creationflags=NOWIN)
        return json.loads(r.stdout.splitlines()[0]) if r.returncode == 0 and r.stdout.strip() else None
    title = re.sub(r"^[0-9-]+ - ", "", name)
    guest = title.split(" - ")[0]
    released = release_date(show, name, note_text)
    host = HOSTS.get(show, "").split(",")[0]
    for query in (f"{show} {title}", f"{host} {guest}"):
        r = subprocess.run([py, "-m", "yt_dlp", "--skip-download", "--dump-json", f"ytsearch5:{query}"],
                           capture_output=True, text=True, encoding="utf-8", timeout=300, creationflags=NOWIN)
        for line in r.stdout.splitlines():
            info = json.loads(line)
            if (info.get("duration") or 0) < 15 * 60:
                continue
            score = difflib.SequenceMatcher(None, title.lower(), info["title"].lower()).ratio()
            up = info.get("upload_date")
            near = released and up and abs((dt.date(int(up[:4]), int(up[4:6]), int(up[6:])) - released).days) <= 4
            if score >= 0.6 or (near and guest.split()[-1].lower() in info["title"].lower()) or (near and score >= 0.35):
                return info
    log(f"  youtube search miss for '{title}' (released {released})")
    return None


def fetch_captions(info):
    STAGING.mkdir(exist_ok=True)
    vid = info["id"]
    for f in STAGING.glob(f"{vid}*"):
        f.unlink()
    subprocess.run([sys.executable.replace("pythonw.exe", "python.exe"), "-m", "yt_dlp", "--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "en.*,en",
                    "--sub-format", "json3", "-o", str(STAGING / "%(id)s"), f"https://www.youtube.com/watch?v={vid}"],
                   capture_output=True, text=True, encoding="utf-8", timeout=300, creationflags=NOWIN)
    files = sorted(STAGING.glob(f"{vid}*.json3"), key=lambda p: ("orig" not in p.name, len(p.name)))
    if not files:
        return None
    ev = json.loads(files[0].read_text(encoding="utf-8")).get("events", [])
    words = []
    for e in ev:
        segs = e.get("segs")
        if not segs:
            continue
        t = e.get("tStartMs", 0) / 1000
        txt = "".join(s.get("utf8", "") for s in segs).replace("\n", " ").strip()
        if txt:
            words.append((t, txt))
    return words


def whisper_from_feed(show, name):
    feeds = json.loads((HERE / "feeds.json").read_text(encoding="utf-8")) if (HERE / "feeds.json").exists() else {}
    want = re.sub(r"^[0-9-]+ - ", "", name).lower()
    num = re.match(r"^(\d+) - ", name)
    best, bs = None, 0
    for it in feeds.get(show, []):
        t = it["t"].lower()
        if num and (it.get("ep") == num[1] or re.match(rf"^#?{num[1]}\b", t)) and it.get("audio"):
            best, bs = it, 1
            break
        # feed titles carry a long tail after a dash or bar that sinks the ratio on short note names
        head = re.split(r"\s[—|-]\s|\s\|\s", re.sub(r"^#?\d+:\s*", "", t))[0]
        s = max(difflib.SequenceMatcher(None, want, t).ratio(), difflib.SequenceMatcher(None, want, head).ratio())
        if s > bs and it.get("audio"):
            best, bs = it, s
    if not best or bs < 0.5:
        return None
    STAGING.mkdir(exist_ok=True)
    audio = STAGING / "episode.mp3"
    with requests.get(best["audio"], stream=True, timeout=120, headers={"User-Agent": "Mozilla/5.0"}) as r:
        r.raise_for_status()
        with open(audio, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return transcribe(audio)


def whisper_from_youtube(info):
    STAGING.mkdir(exist_ok=True)
    for f in STAGING.glob("ytaudio.*"):
        f.unlink()
    subprocess.run([sys.executable.replace("pythonw.exe", "python.exe"), "-m", "yt_dlp", "-f", "bestaudio", "-o", str(STAGING / "ytaudio.%(ext)s"),
                    f"https://www.youtube.com/watch?v={info['id']}"],
                   capture_output=True, text=True, encoding="utf-8", timeout=900, creationflags=NOWIN)
    files = list(STAGING.glob("ytaudio.*"))
    return transcribe(files[0]) if files else None


def transcribe(audio):
    import site
    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        for b in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            os.add_dll_directory(b)
            os.environ["PATH"] = b + os.pathsep + os.environ["PATH"]
    from faster_whisper import WhisperModel
    model = WhisperModel("turbo", device="cuda", compute_type="float16")
    segs, _ = model.transcribe(str(audio), vad_filter=True)
    out = [(s.start, s.text.strip()) for s in segs]
    audio.unlink()
    return out


def lines_to_text(lines):
    return re.sub(r"\s+", " ", " ".join(t for _, t in lines)).strip()


# ── Segments ──────────────────────────────────────────────────────────────

def segment(lines, chapters, duration):
    if chapters:
        groups, cur = [], None
        for c in chapters:
            if cur and (c["start_time"] - cur["start"]) < MIN_SEG_MIN * 60:
                cur["titles"].append(c["title"])
                continue
            if cur:
                groups.append(cur)
            cur = {"start": c["start_time"], "titles": [c["title"]]}
        if cur:
            groups.append(cur)
        if len(groups) > 1 and (duration - groups[-1]["start"]) < 6 * 60:
            groups[-2]["titles"] += groups[-1]["titles"]
            groups.pop()
    else:
        n = max(1, round(duration / (FALLBACK_SEG_MIN * 60)))
        groups = [{"start": i * duration / n, "titles": []} for i in range(n)]
    for i, g in enumerate(groups):
        end = groups[i + 1]["start"] if i + 1 < len(groups) else duration + 1
        g["end"] = end
        g["text"] = lines_to_text([l for l in lines if g["start"] <= l[0] < end])
    return [g for g in groups if len(g["text"]) > 200]


def ts(sec):
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


# ── Qwen segment notes ────────────────────────────────────────────────────

SEG_SYSTEM = """You write deep, structured study notes from podcast transcript segments.
Rules: terse, concrete, no filler, never an em dash (use commas or colons), no emojis beyond the section markers given.
Only state what the speakers actually said. Never invent a study, number, story or quote.
Credit a speaker only as the host or guest named in the prompt; if you cannot tell who said it, write "a speaker"."""

HOSTS_FILE = Path(__file__).parent / "hosts.json"
HOSTS = json.loads(HOSTS_FILE.read_text(encoding="utf-8")) if HOSTS_FILE.exists() else {}

SEG_PROMPT = """Podcast: {show}, host {host}. Episode: {episode}. Guest: {guest}.
Spell the host and guest names exactly as written here, whatever the captions say.
Segment {n} of {total}, {start} to {end}{covers}.

Transcript of this segment (auto-captions, may have small errors):
\"\"\"{text}\"\"\"

Write the segment note in exactly this markdown shape. Fill every section from the transcript; if a section has nothing, write "_None in this segment._"

TITLE: <a short title for this segment, max 8 words>

🎯 **Purpose**

<1-2 sentences: the specific mechanism or claim this segment delivers>

🧠 **Big Idea**

<2-3 sentences, lead with the most concrete insight or number>

👀 **What to Watch For**

<1-2 sentences: the real-life moment where this becomes relevant>

🔁 **One-Line Takeaway**

<one punchy sentence, your synthesis, not a quote>

---

## 📊 Quick Reference

### Stories at a Glance
- **<name>:** <half a sentence on who and what>. <result>

### Key Numbers & Data
- <every number that carries a finding, dose, time or result, one per line with what it measures. Skip incidental numbers in stories and banter.>

### Frameworks
- **<name>:** <one sentence on what it does>

---

## Full Segment Deep-Dive

### 🔄 Stories & Examples

* **<story name>**
  * **Who:** <1 sentence>
  * **What happened:** <2-3 sentences with the key result>
  * **What it illustrates:** <1 sentence>

### 🔬 The Science & Research

* **<study or claim>**
  * **Source:** <researcher, study or who said it>
  * **Finding:** <what they found, with numbers>
  * **Mechanism:** <why it works, if explained>
  * **Implication:** <what to do with it>

### 🧩 Frameworks & Protocols

<each framework or protocol with every step or element written out in full>

### 💬 Key Quotes

> "<exact words copied from the transcript>"
> - <speaker>

<3-5 quotes. Copy them word for word from the transcript above. If you cannot find exact words, write fewer quotes.>

### 🏷️ Key Distinctions & Concepts

- **<term>:** <definition as used in the segment>
"""



def streaming():
    tasks = subprocess.run(["tasklist", "/FI", "IMAGENAME eq obs64.exe", "/NH"], capture_output=True, text=True).stdout
    return "obs64.exe" in tasks.lower()


def stand_down(started):
    """Qwen shares the GPU with OBS. A run that loaded it mid-stream took the stream from 15% to 95% dropped frames, so it waits."""
    waited = False
    while streaming() and time.time() - started < MAX_RUN_HOURS * 3600:
        if not waited:
            log("  OBS is open, waiting for it to close before the next segment")
            waited = True
        time.sleep(60)
    return not streaming()

def qwen(prompt):
    r = requests.post(OLLAMA, json={
        "model": MODEL, "stream": False, "think": False,
        "options": {"num_ctx": 16384, "temperature": 0.3, "num_predict": 4000},
        "messages": [{"role": "system", "content": SEG_SYSTEM}, {"role": "user", "content": prompt}],
    }, timeout=1800)
    r.raise_for_status()
    out = r.json()["message"]["content"]
    return re.sub(r"<think>.*?</think>", "", out, flags=re.S).strip()


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower())


def check_quotes(md, source_text):
    src = norm(source_text)
    dropped = 0
    out_lines, lines, i = [], md.splitlines(), 0
    while i < len(lines):
        m = re.match(r'^>\s*"(.+)"\s*$', lines[i])
        if m:
            q = norm(m.group(1))
            words = q.split()
            ok = len(words) >= 4 and (q in src or all(" ".join(words[k:k + 5]) in src for k in range(0, max(1, len(words) - 4), 5)))
            if not ok:
                dropped += 1
                i += 1
                if i < len(lines) and lines[i].startswith(">"):
                    i += 1
                if i < len(lines) and not lines[i].strip():
                    i += 1
                continue
        out_lines.append(lines[i])
        i += 1
    return "\n".join(out_lines), dropped


# ── Claude hub ────────────────────────────────────────────────────────────

HUB_PROMPT = """You are rebuilding the hub note for a podcast episode in an Obsidian vault. The episode now has one deep-dive note per segment (below). Write the full hub note in markdown and output ONLY the note, starting with the frontmatter line '---'.

Rules:
- Never use an em dash anywhere. No emojis except the section markers already used below.
- Keep the old note's frontmatter (up, tags, released) and the **Podcast/Guest/Source/Transcript** lines. The H1 stays exactly as in the old note.
- Keep, word for word, anything the reader wrote by hand in the old note: any "My read" paragraph, anything under "## 🔗 Linked Work", any Apply line. Put them in the same places.
- Sections, in order: 🎯 **Why This Episode**, 🧠 **Big Idea**, 🔑 **Key Takeaways** (6-10 bullets across the whole episode, bold lead phrase each), 🏗️ **Apply** (tie to the reader's own projects and goals as described in the old note; never generic), 🔁 **One-Line Takeaway**, then `---`, then `## 🗺️ Segment Map` as a table | Segment | Time | Core Idea | with each cell in column 1 a wikilink [[FILENAME|Seg. NN: Title]], then `## 📊 Quick Reference` with ### Topics Covered, ### Key Quotes (only quotes that appear in the segment notes, attributed with "> - Name"), ### Resources Mentioned, then `## 🔗 Linked Work` carried from the old note.
- Only claim what the segment notes support.

OLD NOTE:
<<<
{old}
>>>

SEGMENT NOTES (filename, then content):
{segs}
"""


def claude_hub(prompt):
    r = subprocess.run([CLAUDE, "-p", "--model", CLAUDE_MODEL, "--output-format", "text"],
                       input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=900, cwd=str(HERE), creationflags=NOWIN)
    if r.returncode != 0 or not r.stdout.strip().startswith("---"):
        raise RuntimeError(f"claude hub failed: {r.stderr.strip()[:300] or r.stdout[:300]}")
    return r.stdout.strip() + "\n"


# ── Main per-episode build ────────────────────────────────────────────────

def build(name, dry=False):
    # A sync plugin that encrypts names makes long ones fail, so cap them
    if len(name) > 60:
        raise RuntimeError(f"name is {len(name)} chars, over the 60 cap: shorten the note name first")
    note = find_note(name)
    old = note.read_text(encoding="utf-8")
    show = show_of(note)
    guest = (re.search(r"^\*\*Guest:\*\*\s*(.+)$", old, re.M) or [None, ""])[1][:200]
    log(f"build {show} / {name}")

    info = youtube_lookup(old, show, name)
    lines, chapters, duration, src = None, [], 0, ""
    if info:
        lines = fetch_captions(info)
        chapters = info.get("chapters") or []
        duration = info.get("duration") or 0
        src = f"https://www.youtube.com/watch?v={info['id']}"
    if not lines:
        log("  no captions, trying feed audio + whisper")
        lines = whisper_from_feed(show, name)
        chapters = []
        duration = lines[-1][0] + 5 if lines else 0
    if not lines and info:
        log("  no feed audio, trying YouTube audio + whisper")
        lines = whisper_from_youtube(info)
        chapters = info.get("chapters") or []
        duration = info.get("duration") or (lines[-1][0] + 5 if lines else 0)
    if not lines:
        raise RuntimeError("no transcript source (no YouTube captions, no feed audio, no YouTube audio)")

    minutes = duration / 60
    segs = segment(lines, chapters if minutes >= SHORT_EP_MIN else [], duration)
    if minutes < SHORT_EP_MIN:
        segs = [{"start": 0, "end": duration, "titles": [], "text": lines_to_text(lines)}]
    log(f"  {minutes:.0f} min, {len(segs)} segment(s), {sum(len(s['text']) for s in segs)} chars")
    if dry:
        for s in segs:
            print(f"   {ts(s['start'])}-{ts(s['end'])} {' / '.join(s['titles'])[:90]} ({len(s['text'])} chars)")
        return

    show_dir = note.parent.parent if note.parent.name == name else note.parent
    folder = show_dir / name
    folder.mkdir(exist_ok=True)
    seg_files, seg_dump, dropped_total = [], [], 0
    existing = sorted(folder.glob("Seg. *.md"))
    if len(existing) == len(segs):
        log("  resuming: segment notes already written, rebuilding the hub only")
        for n, f in enumerate(existing, 1):
            body = f.read_text(encoding="utf-8")
            md = body[body.find("**Time:**"):].split("\n---\n\n", 1)[-1]
            seg_files.append(f.stem)
            seg_dump.append(f"### FILENAME: {f.stem}\nTime: {ts(segs[n - 1]['start'])} to {ts(segs[n - 1]['end'])}\n{md}")
        segs_to_write = []
    else:
        for f in existing:
            f.unlink()
        segs_to_write = segs
    for n, s in enumerate(segs_to_write, 1):
        covers = f", YouTube chapters: {'; '.join(s['titles'])}" if s["titles"] else ""
        if not stand_down(RUN_STARTED):
            raise RuntimeError("OBS stayed open past the run window")
        t0 = time.time()
        md = qwen(SEG_PROMPT.format(show=show, host=HOSTS.get(show, ""), episode=re.sub(r"^[0-9-]+ - ", "", name), guest=guest, n=n,
                                    total=len(segs), start=ts(s["start"]), end=ts(s["end"]), covers=covers,
                                    text=s["text"][:40000]))
        tm = re.search(r"^TITLE:\s*(.+)$", md, re.M)
        title = safe(tm.group(1).strip().strip("*")) if tm else (s["titles"][0] if s["titles"] else f"Part {n}")
        md = re.sub(r"^TITLE:.*\n+", "", md, flags=re.M).replace("—", ",")
        md, dropped = check_quotes(md, s["text"])
        dropped_total += dropped
        fname = safe(f"Seg. {n:02d} - {title}")[:120]
        body = (f'---\nup: "[[{name}]]"\n---\n\n# Seg. {n}: {title}\n\n'
                f"**Time:** {ts(s['start'])} to {ts(s['end'])}" + (f"  ·  [watch]({src}&t={int(s['start'])}s)" if src else "")
                + ("\n**Covers:** " + "; ".join(s["titles"]) if s["titles"] else "") + "\n\n---\n\n" + md + "\n")
        (folder / f"{fname}.md").write_text(body, encoding="utf-8")
        seg_files.append(fname)
        seg_dump.append(f"### FILENAME: {fname}\nTime: {ts(s['start'])} to {ts(s['end'])}\n{md}")
        log(f"  seg {n}/{len(segs)} '{title}' {time.time() - t0:.0f}s, {dropped} unverified quote(s) dropped")

    tdir = show_dir / "_transcripts"
    has_transcript = re.search(r"\*\*Transcript:\*\*\s*\[\[", old)
    key = name.split(" - ")[0]
    if not has_transcript and tdir.exists() and re.fullmatch(r"\d{3,4}", key):
        prior = [f for f in tdir.glob("*.md") if re.search(r"\b%d\b" % int(key), f.stem)]
        if prior:
            old = re.sub(r"(^\*\*Source:\*\*.*$)", lambda m: m.group(1) + "\n**Transcript:** [[" + prior[0].stem + "]]", old, count=1, flags=re.M)
            has_transcript = True
    if not has_transcript:
        tdir.mkdir(exist_ok=True)
        tname = f"{name} (transcript)"
        ttext = "\n\n".join(f"## {ts(s['start'])} {' / '.join(s['titles'])}\n\n{s['text']}" for s in segs)
        (tdir / f"{tname}.md").write_text(f"Source: {src or 'feed audio, faster-whisper'}\n\n{ttext}\n", encoding="utf-8")
        old = re.sub(r"(^\*\*Source:\*\*.*$)", rf"\1\n**Transcript:** [[{tname}]]", old, count=1, flags=re.M)

    hub = claude_hub(HUB_PROMPT.format(old=old, segs="\n\n".join(seg_dump)[:150000]))
    hub = hub.replace("—", ",")
    missing = [f for f in seg_files if f"[[{f}" not in hub]
    if missing:
        hub += "\n## 🗺️ Segments (auto-added, missing from the map)\n" + "\n".join(f"- [[{f}]]" for f in missing) + "\n"
    hub_path = folder / f"{name}.md"
    hub_path.write_text(hub, encoding="utf-8")
    if note.resolve() != hub_path.resolve():
        note.unlink()
    log(f"  done: {len(seg_files)} segments, {dropped_total} unverified quotes dropped")


def main():
    global MAX_RUN_HOURS
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=7)
    ap.add_argument("--note")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--hours", type=float, default=MAX_RUN_HOURS)
    ap.add_argument("--until", help="HH:MM; stop starting new work at this clock time, even if the machine woke late")
    ap.add_argument("--switch", action="store_true", help="started by the heavy switch: stop starting new work once it goes off")
    a = ap.parse_args()
    switch_on = lambda: True
    if a.switch:
        sys.path.insert(0, os.environ.get("HEAVY_SWITCH_DIR", str(HERE.parent / "heavy_switch")))
        from heavyswitch import is_night as switch_on
    MAX_RUN_HOURS = a.hours
    if a.until:
        now = dt.datetime.now()
        stop = dt.datetime.combine(now.date(), dt.time.fromisoformat(a.until))
        if stop <= now:
            stop += dt.timedelta(days=1)
        MAX_RUN_HOURS = (stop - now).total_seconds() / 3600

    # 12h, not the run window: a long overnight run must still block a second scheduled task from starting beside it.
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 12 * 3600:
        log("another run holds the lock, exiting")
        return
    LOCK.write_text(str(os.getpid()))
    try:
        if a.note:
            build(a.note, a.dry_run)
            return
        try:
            requests.get("http://localhost:11434/api/tags", timeout=10).raise_for_status()
        except Exception:
            log("Ollama is not running, skipping tonight (nothing marked failed)")
            return
        global RUN_STARTED
        RUN_STARTED = started = time.time()
        done = 0
        for _, name in read_queue():
            if done >= a.limit or time.time() - started > MAX_RUN_HOURS * 3600 or not switch_on():
                break
            # the queue can be edited mid-run (a renamed link), so a vanished line is skipped and logged, never a crash
            line = next((l for l in QUEUE.read_text(encoding="utf-8").splitlines() if f"[[{name}" in l), None)
            if line is None:
                log(f"  skipped {name}: no longer in the queue (renamed or removed mid-run)")
                continue
            if "⚠️" in line:
                continue
            try:
                build(name)
                mark_queue(name, "done")
                done += 1
            except Exception as e:
                log(f"  FAILED {name}: {e}\n{traceback.format_exc()}")
                mark_queue(name, f"failed {dt.date.today()}: {str(e)[:120]}")
        log(f"run finished: {done} rebuilt")
    finally:
        LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
