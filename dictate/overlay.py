import queue
import threading
import tkinter as tk

import win32api
import win32con
import win32gui

STYLES = {
    "recording": ("#d93b3b", "●  Listening"),
    "working": ("#c98a10", "Transcribing..."),
    "error": ("#7b2cbf", "Dictation failed, see toast"),
    "loading": ("#555555", "Loading whisper..."),
}


class Overlay:
    """Bottom-centre pill that never takes focus, so the paste still lands where he was typing."""

    def __init__(self):
        self._q = queue.Queue()
        threading.Thread(target=self._run, daemon=True, name="overlay").start()

    def show(self, state):
        self._q.put(state)

    def hide(self):
        self._q.put(None)

    def _run(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.92)
        self.label = tk.Label(self.root, font=("Segoe UI Semibold", 12), fg="white", padx=18, pady=6)
        self.label.pack()
        self.root.withdraw()
        self.root.update_idletasks()
        self.hwnd = win32gui.GetParent(self.root.winfo_id())
        ex = win32gui.GetWindowLong(self.hwnd, win32con.GWL_EXSTYLE)
        ex |= win32con.WS_EX_NOACTIVATE | win32con.WS_EX_TOOLWINDOW | win32con.WS_EX_TRANSPARENT | win32con.WS_EX_LAYERED
        win32gui.SetWindowLong(self.hwnd, win32con.GWL_EXSTYLE, ex)
        self._hide_after = None
        self.root.after(50, self._poll)
        self.root.mainloop()

    def _poll(self):
        try:
            while True:
                self._apply(self._q.get_nowait())
        except queue.Empty:
            pass
        self.root.after(50, self._poll)

    def _apply(self, state):
        if self._hide_after:
            self.root.after_cancel(self._hide_after)
            self._hide_after = None
        if state is None:
            win32gui.ShowWindow(self.hwnd, win32con.SW_HIDE)
            return
        bg, text = STYLES[state]
        self.root.configure(bg=bg)
        self.label.configure(bg=bg, text=text)
        self.root.update_idletasks()
        w, h = self.label.winfo_reqwidth(), self.label.winfo_reqheight()
        # Bottom centre of the monitor he is working on, not always the primary one.
        mon = win32api.MonitorFromWindow(win32gui.GetForegroundWindow(), win32con.MONITOR_DEFAULTTOPRIMARY)
        left, top, right, bottom = win32api.GetMonitorInfo(mon)["Work"]
        x, y = left + (right - left - w) // 2, bottom - h - 40
        win32gui.SetWindowPos(self.hwnd, win32con.HWND_TOPMOST, x, y, w, h, win32con.SWP_NOACTIVATE | win32con.SWP_SHOWWINDOW)
        if state == "error":
            self._hide_after = self.root.after(4000, lambda: self._apply(None))
