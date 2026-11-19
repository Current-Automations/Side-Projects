import numpy as np
import sounddevice as sd

RATE = 16000


def find_input(name):
    if not name:
        return None
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0 and name.lower() in d["name"].lower():
            return i
    raise RuntimeError(f"no input device matching '{name}'")


class Recorder:
    def __init__(self, device_name=None):
        self.device_name = device_name
        self.device = find_input(device_name)
        self._chunks = []
        self._stream = None

    def _open(self):
        stream = sd.InputStream(
            samplerate=RATE, channels=1, dtype="float32", device=self.device, callback=self._on_audio
        )
        stream.start()
        return stream

    def start(self):
        self._chunks = []
        try:
            self._stream = self._open()
        except sd.PortAudioError:
            # PortAudio keeps the device list from startup; after the mic drops off USB and
            # comes back, the old handle fails until the list is reloaded.
            sd._terminate()
            sd._initialize()
            self.device = find_input(self.device_name)
            self._stream = self._open()

    def _on_audio(self, indata, frames, time_info, status):
        self._chunks.append(indata.copy())

    def stop(self):
        stream, self._stream = self._stream, None
        if stream is None:
            return np.zeros(0, dtype=np.float32)
        stream.stop()
        stream.close()
        if not self._chunks:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(self._chunks)[:, 0]
