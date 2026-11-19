import ctypes
import threading
import time
from ctypes import wintypes

WH_KEYBOARD_LL = 13
WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP = 0x100, 0x101, 0x104, 0x105
LLKHF_INJECTED = 0x10
CTRL_KEYS = {0xA2, 0xA3}
WIN_KEYS = {0x5B, 0x5C}
UNASSIGNED_VK = 0xE8
WM_REFRESH = 0x8000 + 1

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)

user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HHOOK
user32.CallNextHookEx.argtypes = [wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
user32.CallNextHookEx.restype = ctypes.c_ssize_t
user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = wintypes.HMODULE


class HoldKey:
    """Fires on_press when Ctrl and Win are both down, on_release when either lifts.

    Callbacks run on the hook thread and must return fast.
    """

    def __init__(self, on_press, on_release, allow_injected=False):
        self.on_press = on_press
        self.on_release = on_release
        self.allow_injected = allow_injected
        self._held = set()
        self._active = False
        self._hook = None
        self._thread_id = None
        self._ready = threading.Event()
        self._proc = HOOKPROC(self._callback)

    def start(self):
        threading.Thread(target=self._run, daemon=True, name="hotkey").start()
        self._ready.wait(5)
        if not self._hook:
            raise RuntimeError("could not install the keyboard hook")

    def stop(self):
        if self._thread_id:
            user32.PostThreadMessageW(self._thread_id, 0x0012, 0, 0)

    def _run(self):
        self._thread_id = kernel32.GetCurrentThreadId()
        self._hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._proc, kernel32.GetModuleHandleW(None), 0)
        self._ready.set()
        threading.Thread(target=self._refresh_loop, daemon=True, name="hotkey-refresh").start()
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_REFRESH and not self._active:
                # Windows silently unhooks a low-level hook that once answered too slowly,
                # so reinstall it on a timer rather than trust it stays alive.
                user32.UnhookWindowsHookEx(self._hook)
                self._held.clear()
                self._hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._proc, kernel32.GetModuleHandleW(None), 0)
        if self._hook:
            user32.UnhookWindowsHookEx(self._hook)
            self._hook = None

    def _refresh_loop(self):
        while self._hook is not None or self._thread_id:
            time.sleep(60)
            user32.PostThreadMessageW(self._thread_id, WM_REFRESH, 0, 0)

    def _callback(self, n_code, w_param, l_param):
        if n_code == 0:
            k = ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if (self.allow_injected or not k.flags & LLKHF_INJECTED) and (k.vkCode in CTRL_KEYS or k.vkCode in WIN_KEYS):
                if w_param in (WM_KEYDOWN, WM_SYSKEYDOWN):
                    self._held.add(k.vkCode)
                elif w_param in (WM_KEYUP, WM_SYSKEYUP):
                    self._held.discard(k.vkCode)
                both = bool(self._held & CTRL_KEYS) and bool(self._held & WIN_KEYS)
                if both and not self._active:
                    self._active = True
                    self._swallow_start_menu()
                    self.on_press()
                elif not both and self._active:
                    self._active = False
                    self.on_release()
        return user32.CallNextHookEx(self._hook, n_code, w_param, l_param)

    @staticmethod
    def _swallow_start_menu():
        # Win-up opens Start unless another key went down while Win was held; an unassigned vk cancels it.
        user32.keybd_event(UNASSIGNED_VK, 0, 0, 0)
        user32.keybd_event(UNASSIGNED_VK, 0, 2, 0)
