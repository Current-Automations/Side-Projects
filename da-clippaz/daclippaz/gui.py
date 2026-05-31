"""Tkinter GUI for Da Clippaz.

Single-window interface for downloading a YouTube or Twitch video and
splitting it into equal-length clips. All processing runs on a background
thread so the UI stays responsive.
"""

from __future__ import annotations

import queue
import re
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox

from .ffmpeg_utils import check_ffmpeg
from .pipeline.ingest import download_video
from .clipper import clip_video


def _sanitize_folder_name(name: str) -> str:
    """Strip characters that are invalid in directory names."""
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    return name.strip("_ ") or "video"


def launch() -> None:
    """Open the Da Clippaz GUI window and block until it is closed."""
    root = tk.Tk()
    root.title("Da Clippaz")
    root.resizable(False, False)
    _App(root)
    root.mainloop()


class _App:
    def __init__(self, root: tk.Tk) -> None:
        self._root = root
        self._queue: queue.Queue[str] = queue.Queue()
        self._running = False
        self._build_ui()

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        pad = {"padx": 10, "pady": 5}

        # URL row
        tk.Label(self._root, text="Video URL:").grid(
            row=0, column=0, sticky="e", **pad
        )
        self._url_var = tk.StringVar()
        tk.Entry(self._root, textvariable=self._url_var, width=56).grid(
            row=0, column=1, columnspan=2, sticky="ew", **pad
        )

        # Clip length row
        tk.Label(self._root, text="Clip Length (sec):").grid(
            row=1, column=0, sticky="e", **pad
        )
        self._clip_len_var = tk.IntVar(value=60)
        tk.Spinbox(
            self._root,
            from_=5, to=3600,
            textvariable=self._clip_len_var,
            width=8,
        ).grid(row=1, column=1, sticky="w", **pad)

        self._keep_partial_var = tk.BooleanVar(value=False)
        tk.Checkbutton(
            self._root,
            text="Keep partial final clip",
            variable=self._keep_partial_var,
        ).grid(row=1, column=2, sticky="w", **pad)

        # Format row
        tk.Label(self._root, text="Format:").grid(
            row=2, column=0, sticky="e", **pad
        )
        self._mode_var = tk.StringVar(value="crop")
        format_frame = tk.Frame(self._root)
        format_frame.grid(row=2, column=1, columnspan=2, sticky="w", **pad)
        for label, value in [
            ("Original (keep aspect ratio)", "original"),
            ("Crop 9:16 (TikTok)", "crop"),
            ("Blur 9:16 (TikTok)", "blur"),
        ]:
            tk.Radiobutton(
                format_frame,
                text=label,
                variable=self._mode_var,
                value=value,
            ).pack(side="left", padx=(0, 12))

        # Output folder row
        tk.Label(self._root, text="Output Folder:").grid(
            row=3, column=0, sticky="e", **pad
        )
        self._output_var = tk.StringVar()
        tk.Entry(self._root, textvariable=self._output_var, width=44).grid(
            row=3, column=1, sticky="ew", **pad
        )
        tk.Button(self._root, text="Browse", command=self._browse).grid(
            row=3, column=2, sticky="w", **pad
        )

        # Start button
        self._start_btn = tk.Button(
            self._root,
            text="Start",
            width=24,
            command=self._start,
            bg="#2a7ae2",
            fg="white",
            font=("", 11, "bold"),
        )
        self._start_btn.grid(row=4, column=0, columnspan=3, pady=12)

        # Progress log
        self._log = tk.Text(
            self._root,
            height=14,
            width=74,
            state="disabled",
            bg="#1e1e1e",
            fg="#d4d4d4",
            font=("Consolas", 9),
            wrap="word",
        )
        self._log.grid(row=5, column=0, columnspan=3, padx=10, pady=(0, 10))

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    def _browse(self) -> None:
        folder = filedialog.askdirectory(title="Select Output Folder")
        if folder:
            self._output_var.set(folder)

    def _start(self) -> None:
        url = self._url_var.get().strip()
        output_root = self._output_var.get().strip()
        clip_len = self._clip_len_var.get()
        keep_partial = self._keep_partial_var.get()
        mode = self._mode_var.get()

        if not url:
            messagebox.showerror("Missing URL", "Please enter a video URL.")
            return
        if not output_root:
            messagebox.showerror(
                "Missing Output Folder", "Please select an output folder."
            )
            return

        try:
            check_ffmpeg()
        except FileNotFoundError as exc:
            messagebox.showerror("FFmpeg Not Found", str(exc))
            return

        # Clear log
        self._log.configure(state="normal")
        self._log.delete("1.0", "end")
        self._log.configure(state="disabled")

        self._start_btn.configure(state="disabled")
        self._running = True
        self._root.after(100, self._poll_queue)

        threading.Thread(
            target=self._run,
            args=(url, clip_len, Path(output_root), mode, keep_partial),
            daemon=True,
        ).start()

    # ------------------------------------------------------------------
    # Background worker
    # ------------------------------------------------------------------

    def _run(
        self,
        url: str,
        clip_len: int,
        output_root: Path,
        mode: str,
        keep_partial: bool,
    ) -> None:
        def progress(msg: str) -> None:
            self._queue.put(msg)

        try:
            progress(f"Downloading: {url}")
            source_path, title, duration = download_video(
                url, output_root / "_downloads", progress
            )
            progress(f"Title   : {title}")
            progress(f"Duration: {duration:.0f}s")

            folder_name = _sanitize_folder_name(title)
            output_dir = output_root / folder_name
            output_dir.mkdir(parents=True, exist_ok=True)

            progress(f"Output  : {output_dir}")
            progress(f"Format  : {mode}")
            progress(f"Clipping into {clip_len}s segments...")

            clips = clip_video(
                source_path, clip_len, output_dir,
                mode=mode, keep_partial=keep_partial, progress=progress,
            )

            progress("-" * 50)
            progress(f"Done. {len(clips)} clip(s) saved to:")
            progress(f"  {output_dir}")
        except Exception as exc:
            progress(f"ERROR: {exc}")
        finally:
            self._running = False
            self._root.after(0, lambda: self._start_btn.configure(state="normal"))

    # ------------------------------------------------------------------
    # Queue polling (runs on main thread)
    # ------------------------------------------------------------------

    def _poll_queue(self) -> None:
        while True:
            try:
                msg = self._queue.get_nowait()
                self._append_log(msg)
            except queue.Empty:
                break
        if self._running:
            self._root.after(100, self._poll_queue)

    def _append_log(self, msg: str) -> None:
        self._log.configure(state="normal")
        self._log.insert("end", msg + "\n")
        self._log.see("end")
        self._log.configure(state="disabled")
