import time

import win32api
import win32clipboard as cb
import win32con

VK_CONTROL, VK_LWIN, VK_RWIN, VK_V = 0x11, 0x5B, 0x5C, 0x56
HANDLE_FORMATS = {win32con.CF_BITMAP, win32con.CF_PALETTE, win32con.CF_METAFILEPICT, win32con.CF_ENHMETAFILE}


def _open_clipboard():
    for _ in range(20):
        try:
            cb.OpenClipboard()
            return
        except Exception:
            time.sleep(0.02)
    raise RuntimeError("clipboard is locked by another app")


def _save():
    saved = {}
    _open_clipboard()
    try:
        fmt = cb.EnumClipboardFormats(0)
        while fmt:
            if fmt not in HANDLE_FORMATS:
                try:
                    saved[fmt] = cb.GetClipboardData(fmt)
                except Exception:
                    pass
            fmt = cb.EnumClipboardFormats(fmt)
    finally:
        cb.CloseClipboard()
    return saved


def _restore(saved):
    _open_clipboard()
    try:
        cb.EmptyClipboard()
        for fmt, data in saved.items():
            try:
                cb.SetClipboardData(fmt, data)
            except Exception:
                pass
    finally:
        cb.CloseClipboard()


def _set_text(text):
    _open_clipboard()
    try:
        cb.EmptyClipboard()
        cb.SetClipboardData(win32con.CF_UNICODETEXT, text)
    finally:
        cb.CloseClipboard()


def _wait_modifiers_up(timeout=1.5):
    # A held Win key would turn our Ctrl+V into Win+V (clipboard history).
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not any(win32api.GetAsyncKeyState(k) & 0x8000 for k in (VK_CONTROL, VK_LWIN, VK_RWIN)):
            return True
        time.sleep(0.01)
    return False


def paste(text, restore_delay=0.25):
    if not _wait_modifiers_up():
        raise RuntimeError("Ctrl/Win still held, refusing to paste")
    saved = _save()
    _set_text(text)
    win32api.keybd_event(VK_CONTROL, 0, 0, 0)
    win32api.keybd_event(VK_V, 0, 0, 0)
    win32api.keybd_event(VK_V, 0, win32con.KEYEVENTF_KEYUP, 0)
    win32api.keybd_event(VK_CONTROL, 0, win32con.KEYEVENTF_KEYUP, 0)
    time.sleep(restore_delay)
    _restore(saved)
