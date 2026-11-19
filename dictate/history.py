import ctypes
import os
import sys
import tkinter as tk
from tkinter import font as tkfont

import win32clipboard as cb
import win32con

import learn

BG, PANEL, FG, DIM, ACCENT, GOOD = "#16181d", "#1f2229", "#e8e8e8", "#8a8f98", "#3a9d5d", "#2f7a4a"


def copy(text):
    cb.OpenClipboard()
    try:
        cb.EmptyClipboard()
        cb.SetClipboardData(win32con.CF_UNICODETEXT, text)
    finally:
        cb.CloseClipboard()


class HistoryWindow:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Dictate: recent dictations")
        self.root.geometry("1100x640")
        self.root.configure(bg=BG)
        self.base = tkfont.Font(family="Segoe UI", size=11)
        self.small = tkfont.Font(family="Segoe UI", size=9)
        self.rows = []
        self.current = None
        self._mtime = 0

        left = tk.Frame(self.root, bg=BG)
        left.pack(side="left", fill="y", padx=(12, 6), pady=12)
        tk.Label(left, text="Recent", bg=BG, fg=DIM, font=self.small).pack(anchor="w")
        self.listbox = tk.Listbox(left, width=52, bg=PANEL, fg=FG, selectbackground=ACCENT, font=self.small,
                                  activestyle="none", borderwidth=0, highlightthickness=0)
        self.listbox.pack(fill="y", expand=True)
        self.listbox.bind("<<ListboxSelect>>", lambda e: self.select())

        right = tk.Frame(self.root, bg=BG)
        right.pack(side="left", fill="both", expand=True, padx=(6, 12), pady=12)
        self.meta = tk.Label(right, text="", bg=BG, fg=DIM, font=self.small, anchor="w")
        self.meta.pack(fill="x")
        self.text = tk.Text(right, wrap="word", bg=PANEL, fg=FG, insertbackground=FG, font=self.base,
                            borderwidth=0, padx=10, pady=8, height=12, undo=True)
        self.text.pack(fill="both", expand=True)

        bar = tk.Frame(right, bg=BG)
        bar.pack(fill="x", pady=8)
        for label, cmd in (("Copy", self.do_copy), ("Save edit", self.do_save), ("Revert", self.select)):
            tk.Button(bar, text=label, command=cmd, bg=PANEL, fg=FG, activebackground=ACCENT, borderwidth=0,
                      padx=14, pady=4, font=self.small).pack(side="left", padx=(0, 6))
        self.status = tk.Label(bar, text="", bg=BG, fg=DIM, font=self.small)
        self.status.pack(side="left", padx=8)

        self.learn_box = tk.Frame(right, bg=BG)
        self.learn_box.pack(fill="x")

        tk.Label(right, text="What whisper heard", bg=BG, fg=DIM, font=self.small, anchor="w").pack(fill="x", pady=(8, 0))
        self.raw = tk.Label(right, text="", bg=BG, fg=DIM, font=self.small, anchor="w", justify="left", wraplength=560)
        self.raw.pack(fill="x")

        self.root.bind("<Control-s>", lambda e: self.do_save())
        self.refresh()
        self.root.after(1500, self.poll)

    def poll(self):
        try:
            m = os.path.getmtime(learn.HISTORY)
        except OSError:
            m = 0
        if m != self._mtime:
            self.refresh(keep=True)
        self.root.after(1500, self.poll)

    def refresh(self, keep=False):
        at = self.current["at"] if keep and self.current else None
        try:
            self._mtime = os.path.getmtime(learn.HISTORY)
        except OSError:
            self._mtime = 0
        self.rows = learn.entries()
        self.listbox.delete(0, "end")
        for r in self.rows:
            mark = "*" if "edited" in r else " "
            first = (r.get("edited") or r["text"]).replace("\n", " ")
            self.listbox.insert("end", f"{mark} {r['at'][5:16]}  {r.get('profile', '')[:8]:<8}  {first[:70]}")
        idx = next((i for i, r in enumerate(self.rows) if r["at"] == at), 0 if not keep else None)
        if idx is not None and self.rows:
            self.listbox.selection_clear(0, "end")
            self.listbox.selection_set(idx)
            if not keep:
                self.select()

    def select(self):
        sel = self.listbox.curselection()
        if not sel:
            return
        self.current = self.rows[sel[0]]
        r = self.current
        self.meta.config(text=f"{r['at']}   {r.get('app', '')} ({r.get('profile', '')})   {r.get('seconds', '')}s"
                              + (f"   note: {r['note']}" if r.get("note") else "") + ("   edited" if "edited" in r else ""))
        self.text.delete("1.0", "end")
        self.text.insert("1.0", r.get("edited") or r["text"])
        self.raw.config(text=r.get("raw", ""))
        self.status.config(text="")
        self.clear_learn()

    def do_copy(self):
        copy(self.text.get("1.0", "end").strip())
        self.status.config(text="Copied")

    def do_save(self):
        if not self.current:
            return
        new = self.text.get("1.0", "end").strip()
        before = self.current.get("edited") or self.current["text"]
        if new == before:
            self.status.config(text="No changes")
            return
        learn.save_edit(self.current["at"], new)
        self.current["edited"] = new
        self.status.config(text="Saved")
        self.show_learn(learn.suggestions(self.current["text"], new))

    def clear_learn(self):
        for w in self.learn_box.winfo_children():
            w.destroy()

    def show_learn(self, pairs):
        self.clear_learn()
        if not pairs:
            return
        tk.Label(self.learn_box, text="Teach the dictionary? Only what you click gets added.", bg=BG, fg=DIM,
                 font=self.small, anchor="w").pack(fill="x", pady=(2, 4))
        for heard, written in pairs:
            row = tk.Frame(self.learn_box, bg=BG)
            row.pack(fill="x", pady=1)
            tk.Label(row, text=f'Heard "{heard}"  ->  "{written}"', bg=BG, fg=FG, font=self.small).pack(side="left")
            btn = tk.Button(row, text="Add", bg=PANEL, fg=FG, activebackground=ACCENT, borderwidth=0, padx=10, font=self.small)
            btn.config(command=lambda h=heard, w=written, b=btn: self.add(h, w, b))
            btn.pack(side="left", padx=8)

    def add(self, heard, written, btn):
        learn.add_alias(heard, written)
        btn.config(text="Added", state="disabled", bg=GOOD)

    def run(self):
        self.root.mainloop()


def main():
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW(None, False, "Local\\dictate-history-window")
    if ctypes.get_last_error() == 183:
        hwnd = ctypes.windll.user32.FindWindowW(None, "Dictate: recent dictations")
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 9)
            ctypes.windll.user32.SetForegroundWindow(hwnd)
        return 0
    HistoryWindow().run()


if __name__ == "__main__":
    sys.exit(main())
