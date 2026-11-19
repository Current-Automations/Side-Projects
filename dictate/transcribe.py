import gc
import glob
import os
import site
import threading
import time

for _base in site.getsitepackages() + [site.getusersitepackages()]:
    for _d in glob.glob(os.path.join(_base, "nvidia", "*", "bin")):
        os.add_dll_directory(_d)
        os.environ["PATH"] = _d + os.pathsep + os.environ["PATH"]

from faster_whisper import WhisperModel


class Transcriber:
    def __init__(self, model, language="en", compute_type="int8_float16", idle_unload=600):
        self.model_id = model
        self.language = language
        self.compute_type = compute_type
        self.idle_unload = idle_unload
        self._model = None
        self._lock = threading.Lock()
        self._last_used = time.time()
        threading.Thread(target=self._watch_idle, daemon=True, name="whisper-idle").start()

    def load(self):
        with self._lock:
            if self._model is None:
                self._model = WhisperModel(self.model_id, device="cuda", compute_type=self.compute_type, local_files_only=True)
            self._last_used = time.time()

    def transcribe(self, audio, hotwords=None):
        self.load()
        with self._lock:
            # hotwords, not initial_prompt: with condition_on_previous_text off, initial_prompt is
            # dropped after the first 30s window, hotwords ride along on every window.
            segments, _ = self._model.transcribe(
                audio,
                language=self.language,
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
                hotwords=hotwords or None,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            self._last_used = time.time()
        return text

    def unload(self):
        with self._lock:
            self._model = None
            gc.collect()

    def _watch_idle(self):
        while True:
            time.sleep(5)
            with self._lock:
                if self._model is not None and time.time() - self._last_used > self.idle_unload:
                    self._model = None
                    gc.collect()
