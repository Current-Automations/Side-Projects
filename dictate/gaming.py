import os
import subprocess
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
FLAG = os.path.join(HERE, "gaming.flag")
OLLAMA = "http://127.0.0.1:11434"
WALLPAPER = r"D:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe"


def unload_ollama():
    try:
        for m in requests.get(f"{OLLAMA}/api/ps", timeout=3).json().get("models", []):
            requests.post(f"{OLLAMA}/api/generate", json={"model": m["name"], "keep_alive": 0}, timeout=10)
    except requests.RequestException:
        pass


def wallpaper(cmd):
    if os.path.exists(WALLPAPER):
        subprocess.Popen([WALLPAPER, "-control", cmd])


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "toggle"
    on = not os.path.exists(FLAG) if arg == "toggle" else arg == "on"
    if on:
        open(FLAG, "w").close()
        unload_ollama()
        wallpaper("pause")
    else:
        if os.path.exists(FLAG):
            os.remove(FLAG)
        wallpaper("play")


if __name__ == "__main__":
    main()
