import ctypes
import json
import logging
import os
import queue
import subprocess
import sys
import threading
import time
import winsound

import pystray
import yaml
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY = os.path.join(HERE, "history.jsonl")
GAMING_FLAG = os.path.join(HERE, "gaming.flag")

logging.basicConfig(
    filename=os.path.join(HERE, "debug.log"),
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%m-%d %H:%M:%S",
)
log = logging.getLogger("dictate")

COLOURS = {"idle": "#3a9d5d", "unloaded": "#7a7a7a", "recording": "#d93b3b", "working": "#e0a020", "paused": "#444444", "error": "#8a2be2"}


def load_config():
    with open(os.path.join(HERE, "config.yaml"), encoding="utf-8") as f:
        return yaml.safe_load(f)


def dot(colour, raw=False):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((6, 6, 58, 58), fill=colour)
    if raw:
        d.ellipse((22, 22, 42, 42), fill="white")
    return img


def blip(kind):
    tones = {"start": [(880, 60)], "stop": [(660, 60)], "error": [(300, 150), (220, 200)]}
    threading.Thread(target=lambda: [winsound.Beep(f, ms) for f, ms in tones[kind]], daemon=True).start()


def say(*args):
    msg = " ".join(str(a) for a in args)
    log.info(msg)
    if sys.stdout:
        print(msg, flush=True)


def append_history(entry, keep):
    lines = []
    if os.path.exists(HISTORY):
        with open(HISTORY, encoding="utf-8") as f:
            lines = f.readlines()
    lines.append(json.dumps(entry, ensure_ascii=False) + "\n")
    with open(HISTORY, "w", encoding="utf-8") as f:
        f.writelines(lines[-keep:])


class App:
    def __init__(self):
        from audio import Recorder
        from cleanup import Cleaner
        from transcribe import Transcriber
        import dictionary

        self.cfg = load_config()
        self.dictionary = dictionary
        self.dict_path = os.path.join(HERE, self.cfg["dictionary"])
        self.dict_mtime = os.path.getmtime(self.dict_path)
        self.terms, self.fixes = dictionary.load(self.dict_path)
        self.recorder = Recorder(self.cfg["mic"])
        self.whisper = Transcriber(self.cfg["model"], self.cfg["language"], self.cfg["compute_type"], self.cfg["idle_unload_seconds"])
        self.cleaner = Cleaner(self.cfg, self.terms)
        self.events = queue.Queue()
        self.paused = False
        self.raw = not self.cfg["cleanup"]["enabled"]
        self.icon = None
        from overlay import Overlay
        self.overlay = Overlay()

    # tray

    def set_state(self, state):
        if state in ("recording", "working", "error"):
            self.overlay.show(state)
        else:
            self.overlay.hide()
        if self.icon:
            self.icon.icon = dot(COLOURS[state], self.raw)
            label = {"idle": "ready", "unloaded": "ready (whisper unloaded)"}.get(state, state)
            self.icon.title = f"Dictate: {label}" + (" | raw mode" if self.raw else "")

    def rest_state(self):
        self.set_state("paused" if self.paused else "idle" if self.whisper._model is not None else "unloaded")

    def toast(self, msg):
        say("TOAST", msg)
        if self.icon:
            try:
                self.icon.notify(msg, "Dictate")
            except Exception:
                pass

    def menu(self):
        return pystray.Menu(
            pystray.MenuItem("Recent dictations", self.open_history, default=True),
            pystray.MenuItem("Pause", self.toggle_pause, checked=lambda _: self.paused),
            pystray.MenuItem("Raw mode (no cleanup)", self.toggle_raw, checked=lambda _: self.raw),
            pystray.MenuItem("Reload dictionary", self.reload_dictionary),
            pystray.MenuItem("Open dictionary", lambda: os.startfile(os.path.join(HERE, self.cfg["dictionary"]))),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self.quit),
        )

    def open_history(self):
        subprocess.Popen([os.path.join(HERE, "venv", "Scripts", "pythonw.exe"), os.path.join(HERE, "history.py")], cwd=HERE)

    def maybe_reload_dictionary(self):
        m = os.path.getmtime(self.dict_path)
        if m != self.dict_mtime:
            self.dict_mtime = m
            self.terms, self.fixes = self.dictionary.load(self.dict_path)
            self.cleaner.terms = ", ".join(self.terms)
            say(f"dictionary reloaded: {len(self.terms)} terms, {len(self.fixes)} fixes")

    def toggle_pause(self):
        self.paused = not self.paused
        self.rest_state()

    def toggle_raw(self):
        self.raw = not self.raw
        self.rest_state()

    def reload_dictionary(self):
        self.terms, self.fixes = self.dictionary.load(os.path.join(HERE, self.cfg["dictionary"]))
        self.cleaner.terms = ", ".join(self.terms)
        self.toast(f"Dictionary reloaded, {len(self.terms)} terms, {len(self.fixes)} fixes")

    def quit(self):
        self.hold.stop()
        self.icon.stop()

    # dictation

    def run_worker(self):
        from audio import RATE
        from inject import paste
        from profiles import foreground, pick
        from cleanup import CleanupError

        recording = False
        while True:
            ev = self.events.get()
            log.info(f"key {ev}{' (paused)' if self.paused else ''}")
            if ev == "press":
                if self.paused:
                    continue
                try:
                    self.recorder.start()
                except Exception as e:
                    blip("error")
                    self.toast(f"Mic failed to open: {e}")
                    continue
                recording = True
                blip("start")
                # Load both models while he talks, so a cold first dictation is not 16s of waiting.
                if self.whisper._model is None:
                    threading.Thread(target=self.whisper.load, daemon=True).start()
                if not self.raw:
                    threading.Thread(target=self.cleaner.warm, daemon=True).start()
                self.set_state("recording")
                continue
            if not recording:
                continue
            recording = False
            audio = self.recorder.stop()
            blip("stop")
            seconds = len(audio) / RATE
            if seconds < self.cfg["min_seconds"]:
                self.rest_state()
                continue
            self.set_state("working")
            self.maybe_reload_dictionary()
            exe, blocked = foreground()
            profile = pick(exe, self.cfg["profiles"])
            try:
                t = time.time()
                raw_text = self.whisper.transcribe(audio, ", ".join(self.terms))
                t_whisper = time.time() - t
                if not raw_text:
                    say(f"empty transcript from {seconds:.1f}s (peak {abs(audio).max():.3f})")
                    self.rest_state()
                    continue
                raw_text = self.dictionary.apply(raw_text, self.fixes)
                text, t_clean, note = raw_text, 0.0, "raw mode" if self.raw else ""
                if not self.raw:
                    t = time.time()
                    try:
                        text = self.dictionary.apply(self.cleaner.clean(raw_text, profile), self.fixes)
                    except CleanupError as e:
                        note = str(e)
                        blip("error")
                        self.toast(f"{e}. Pasted the raw transcript.")
                    t_clean = time.time() - t
                if blocked:
                    self.toast(f"{exe} is running as admin, Windows may drop the paste. Text is in history.")
                paste(text)
            except Exception as e:
                log.exception("dictation failed")
                blip("error")
                self.toast(f"Dictation failed: {e}")
                self.set_state("error")
                continue
            say(f"{seconds:.1f}s {exe or '?'}>{profile} whisper {t_whisper:.2f}s clean {t_clean:.2f}s{' [' + note + ']' if note else ''}: {text}")
            append_history(
                {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "app": exe, "profile": profile, "seconds": round(seconds, 1), "raw": raw_text, "text": text, "note": note},
                self.cfg["history_keep"],
            )
            self.rest_state()

    def watch_unload(self):
        gaming = None
        while True:
            now = os.path.exists(GAMING_FLAG)
            if now != gaming and gaming is not None:
                if now:
                    self.whisper.unload()
                    self.whisper.idle_unload, self.cleaner.keep_alive = 60, "60s"
                    self.toast("Gaming mode on: models unloaded, they unload again 60s after each use")
                else:
                    self.whisper.idle_unload, self.cleaner.keep_alive = self.cfg["idle_unload_seconds"], self.cfg["cleanup"]["keep_alive"]
                    self.toast("Gaming mode off")
            elif gaming is None and now:
                self.whisper.idle_unload, self.cleaner.keep_alive = 60, "60s"
            gaming = now
            if self.icon and not self.paused and self.events.empty():
                self.rest_state()
            time.sleep(3)

    def run(self):
        from hotkey import HoldKey

        t = time.time()
        self.whisper.load()
        say(f"whisper loaded in {time.time() - t:.1f}s, mic device #{self.recorder.device}, cleanup {self.cfg['cleanup']['model']}")
        self.hold = HoldKey(lambda: self.events.put("press"), lambda: self.events.put("release"))
        self.hold.start()
        threading.Thread(target=self.run_worker, daemon=True, name="worker").start()
        threading.Thread(target=self.watch_unload, daemon=True, name="unload-watch").start()
        self.icon = pystray.Icon("dictate", dot(COLOURS["idle"], self.raw), "Dictate: ready", self.menu())
        self.rest_state()
        say("ready: hold Ctrl+Win to dictate")
        self.icon.run()


def main():
    # One copy only, so a Startup launch and a manual launch never both paste.
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW(None, False, "Local\\dictate-single-instance")
    if ctypes.get_last_error() == 183:
        say("already running")
        return 0
    try:
        App().run()
    except Exception as e:
        log.exception("startup failed")
        ctypes.windll.user32.MessageBoxW(None, f"Dictate failed to start:\n{e}", "Dictate", 0x10)
        return 1


if __name__ == "__main__":
    sys.exit(main())
