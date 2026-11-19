# Dictate

A local push-to-talk dictation tool for Windows. Hold Ctrl+Win, speak, release, and the cleaned-up text is pasted into the focused window. Audio is transcribed on your own GPU with faster-whisper and tidied by a small local model through Ollama. Nothing leaves the machine.

## How it works

- `hotkey.py` installs a low-level keyboard hook for the Ctrl+Win hold key. `audio.py` records from the chosen microphone.
- `transcribe.py` runs faster-whisper and unloads the model after an idle period to free video memory.
- `cleanup.py` sends the text to an Ollama model with a tone that depends on the focused app (`profiles.py` matches the executable name, as set in `config.yaml`). Output whose length is far from the input's is rejected and the raw text is used.
- `dictionary.py` applies a term list from `dictionary.txt` (`Right: wrong one, wrong two`). `learn.py` can pick up corrections made after pasting.
- `inject.py` pastes through the clipboard. `overlay.py` and a tray icon show state. `gaming.py` unloads models while a flag file is present.
- `history.py` keeps recent dictations in `history.jsonl`.

## Setup and run

```
python -m venv venv
venv\Scripts\pip install faster-whisper sounddevice numpy requests pyyaml pystray pillow pywin32
ollama pull <the cleanup model named in config.yaml>
run.bat
```

Edit `config.yaml` for the microphone name (empty means the default device), the Whisper model, the cleanup model and the per-app tones. Edit `dictionary.txt` for your own terms.

## Requirements

Windows, Python 3.10+, an NVIDIA GPU with CUDA for faster-whisper, and a running Ollama server on `127.0.0.1:11434`. Windows may drop the paste into windows running as administrator.
