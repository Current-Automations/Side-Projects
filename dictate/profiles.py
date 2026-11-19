import ctypes
from ctypes import wintypes

import win32gui
import win32process

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
TOKEN_QUERY = 0x0008
TOKEN_ELEVATION = 20

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
advapi32.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]


def _is_elevated(handle):
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(handle, TOKEN_QUERY, ctypes.byref(token)):
        return None
    try:
        elevated = wintypes.DWORD()
        size = wintypes.DWORD()
        if not advapi32.GetTokenInformation(token, TOKEN_ELEVATION, ctypes.byref(elevated), 4, ctypes.byref(size)):
            return None
        return bool(elevated.value)
    finally:
        kernel32.CloseHandle(token)


def _self_elevated():
    return _is_elevated(kernel32.GetCurrentProcess()) or False


SELF_ELEVATED = _self_elevated()


def foreground():
    """(exe name lowercased, True if the window is elevated above us and will drop the paste)."""
    hwnd = win32gui.GetForegroundWindow()
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return "", False
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(len(buf))
        exe = buf.value.rsplit("\\", 1)[-1].lower() if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)) else ""
        # An unreadable token almost always means elevated; the paste is still attempted either way.
        blocked = _is_elevated(handle) is not False and not SELF_ELEVATED
        return exe, blocked
    finally:
        kernel32.CloseHandle(handle)


def pick(exe, table):
    for profile, exes in table.items():
        if exe in (e.lower() for e in exes):
            return profile
    return "default"
