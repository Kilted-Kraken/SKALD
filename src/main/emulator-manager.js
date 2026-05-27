'use strict';

const { execFile, execFileSync } = require('child_process');
const crypto = require('crypto');

function createEmulatorManager({
  fs,
  path,
  spawn,
  userDataDir,
  loadSettings,
  markGamePlayed,
  onSessionsChanged,
  onSessionStarted,
  onSessionEnded,
}) {
  const LIBRETRO_SYSTEMS = [
    { id: 'snes', label: 'SNES', coreExample: 'bsnes_mercury_balanced_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'bsnes_mercury_balanced_libretro.dll', label: 'bsnes-mercury Balanced' },
      { fileName: 'snes9x_libretro.dll', label: 'Snes9x', recommendedForAchievements: true },
      { fileName: 'mesen-s_libretro.dll', label: 'Mesen-S' },
    ] },
    { id: 'nes', label: 'NES', coreExample: 'mesen_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'mesen_libretro.dll', label: 'Mesen' },
      { fileName: 'nestopia_libretro.dll', label: 'Nestopia' },
      { fileName: 'fceumm_libretro.dll', label: 'FCEUmm' },
    ] },
    { id: 'gba', label: 'Game Boy Advance', coreExample: 'mgba_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'mgba_libretro.dll', label: 'mGBA' },
      { fileName: 'gpsp_libretro.dll', label: 'gpSP' },
    ] },
    { id: 'gbc', label: 'Game Boy Color', coreExample: 'mgba_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'mgba_libretro.dll', label: 'mGBA' },
      { fileName: 'gambatte_libretro.dll', label: 'Gambatte' },
      { fileName: 'sameboy_libretro.dll', label: 'SameBoy' },
    ] },
    { id: 'gb', label: 'Game Boy', coreExample: 'gambatte_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'gambatte_libretro.dll', label: 'Gambatte' },
      { fileName: 'sameboy_libretro.dll', label: 'SameBoy' },
      { fileName: 'mgba_libretro.dll', label: 'mGBA' },
    ] },
    { id: 'genesis', label: 'Genesis / Mega Drive', coreExample: 'genesis_plus_gx_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'genesis_plus_gx_libretro.dll', label: 'Genesis Plus GX', recommendedForAchievements: true },
      { fileName: 'picodrive_libretro.dll', label: 'PicoDrive' },
    ] },
    { id: 'n64', label: 'Nintendo 64', coreExample: 'mupen64plus_next_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'mupen64plus_next_libretro.dll', label: 'Mupen64Plus-Next' },
      { fileName: 'parallel_n64_libretro.dll', label: 'Parallel N64' },
    ] },
    { id: 'nds', label: 'Nintendo DS', coreExample: 'melondsds_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'melondsds_libretro.dll', label: 'melonDS DS' },
      { fileName: 'desmume_libretro.dll', label: 'DeSmuME' },
    ] },
    { id: 'pce', label: 'PC Engine / TurboGrafx-16', coreExample: 'mednafen_pce_fast_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'mednafen_pce_fast_libretro.dll', label: 'Beetle PCE FAST' },
      { fileName: 'mednafen_supergrafx_libretro.dll', label: 'Beetle SuperGrafx' },
    ] },
    { id: 'psx', label: 'PlayStation', coreExample: 'mednafen_psx_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'mednafen_psx_hw_libretro.dll', label: 'Beetle PSX HW', recommendedForAchievements: true },
      { fileName: 'mednafen_psx_libretro.dll', label: 'Beetle PSX' },
      { fileName: 'swanstation_libretro.dll', label: 'SwanStation' },
      { fileName: 'pcsx_rearmed_libretro.dll', label: 'PCSX-ReARMed' },
    ] },
    { id: 'ps2', label: 'PlayStation 2', coreExample: 'pcsx2_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'pcsx2_libretro.dll', label: 'PCSX2' },
    ] },
    { id: 'psp', label: 'PSP', coreExample: 'ppsspp_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'ppsspp_libretro.dll', label: 'PPSSPP', recommendedForAchievements: true },
    ] },
    { id: 'dc', label: 'Sega Dreamcast', coreExample: 'flycast_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'flycast_libretro.dll', label: 'Flycast', recommendedForAchievements: true },
    ] },
    { id: 'dolphin', label: 'GameCube / Wii (Dolphin core)', coreExample: 'dolphin_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'dolphin_libretro.dll', label: 'Dolphin' },
    ] },
    { id: 'pcsx2', label: 'PlayStation 2 (PCSX2 core)', coreExample: 'pcsx2_libretro.dll', launcher: 'retroarch', coreChoices: [
      { fileName: 'pcsx2_libretro.dll', label: 'PCSX2' },
    ] },
  ];

  const ROM_EXTS = ['.sfc', '.smc', '.snes', '.nes', '.gba', '.gbc', '.gb', '.md', '.gen', '.smd', '.n64', '.z64', '.v64', '.nds', '.pce', '.chd', '.cue', '.bin', '.img', '.iso', '.gcm', '.gcz', '.rvz', '.wbfs', '.wia', '.wad', '.wux', '.m3u', '.pbp', '.xex', '.zip'];
  const RETROARCH_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'retroarch') : null;
  const PCSX2_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'pcsx2') : null;
  const DUCKSTATION_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'duckstation') : null;
  const DOLPHIN_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'dolphin') : null;
  const DOLPHIN_STABLE_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'dolphin-stable') : null;
  const DOLPHIN_DEVELOPMENT_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'dolphin-development') : null;
  const CEMU_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'cemu') : null;
  const RPCS3_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'rpcs3') : null;
  const VLC_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'vlc') : null;
  const XEMU_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'xemu') : null;
  const DEFAULT_GAMES_DIR = userDataDir ? path.join(userDataDir, 'games') : '';
const XENIA_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'xenia') : null;
const XENIA_EXTRACT_CACHE_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'xenia-extracted') : null;
const XENIA_PROFILE_METADATA_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'xenia-profiles') : null;
  const XENIA_EXECUTABLE_NAMES = ['xenia_canary.exe', 'xenia.exe'];
  const DUCKSTATION_EXECUTABLE_NAMES = ['duckstation-qt-x64-releaseltcg.exe', 'duckstation-qt-x64-release.exe', 'duckstation-qt-x64.exe', 'duckstation-qt.exe', 'duckstation.exe'];
  const DOLPHIN_EXECUTABLE_NAMES = ['Dolphin.exe', 'dolphin.exe', 'DolphinQt2.exe', 'DolphinQt.exe'];
  const CEMU_EXECUTABLE_NAMES = ['Cemu.exe', 'cemu.exe'];
  const XEMU_EXECUTABLE_NAMES = ['xemu.exe'];
const XENIA_PROFILE_TITLE_ID = 'FFFE07D1';
const XENIA_PROFILE_CONTENT_TYPE = '00010000';
const XENIA_ACCOUNT_RETAIL_KEY = Buffer.from([0xE1, 0xBC, 0x15, 0x9C, 0x73, 0xB1, 0xEA, 0xE9, 0xAB, 0x31, 0x70, 0xF3, 0xAD, 0x47, 0xEB, 0xF3]);
  const SESSION_CONFIG_DIR = RETROARCH_RUNTIME_DIR ? path.join(RETROARCH_RUNTIME_DIR, 'session-overrides') : null;
  let nextSessionId = 1;
  const activeSessions = new Map();
  let foregroundPollTimer = null;
  let foregroundPollBusy = false;

  function emitSessionsChanged() {
    if (typeof onSessionsChanged === 'function') onSessionsChanged(getSessions());
  }

  function notifySessionStarted(session) {
    if (typeof onSessionStarted !== 'function') return;
    try { onSessionStarted(serializeSession(session)); } catch {}
  }

  function notifySessionEnded(session) {
    if (typeof onSessionEnded !== 'function') return;
    try { onSessionEnded(serializeSession(session)); } catch {}
  }

  function startForegroundPolling() {
    if (foregroundPollTimer) return;
    foregroundPollTimer = setInterval(pollForegroundSession, 2000);
  }

  function stopForegroundPolling() {
    if (!foregroundPollTimer) return;
    clearInterval(foregroundPollTimer);
    foregroundPollTimer = null;
  }

  function runPowerShell(command) {
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout || '').trim());
      });
    });
  }

  async function getForegroundPid() {
    try {
      const output = await runPowerShell(`Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Focus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@;
$hwnd=[Win32Focus]::GetForegroundWindow();
if($hwnd -eq [IntPtr]::Zero){ '' ; exit 0 }
$pid=0;
[void][Win32Focus]::GetWindowThreadProcessId($hwnd,[ref]$pid);
Write-Output $pid`);
      const pid = Number(output);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  async function pollForegroundSession() {
    if (foregroundPollBusy || !activeSessions.size) return;
    foregroundPollBusy = true;
    try {
      const foregroundPid = await getForegroundPid();
      let changed = false;
      for (const session of activeSessions.values()) {
        const focused = !!foregroundPid && !!session.pid && Number(session.pid) === Number(foregroundPid);
        if (!!session.isForeground !== focused) {
          session.isForeground = focused;
          changed = true;
        }
      }
      if (changed) emitSessionsChanged();
    } finally {
      foregroundPollBusy = false;
      if (!activeSessions.size) stopForegroundPolling();
    }
  }

  async function terminateSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
    try {
      if (process.platform === 'win32') {
        await runPowerShell(`taskkill /PID ${Number(session.pid)} /T /F | Out-Null; 'ok'`);
      } else {
        try { process.kill(session.pid, 'SIGTERM'); } catch {}
      }
      return { ok: true, session: serializeSession(session) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not close the emulator session.' };
    }
  }

  async function restartSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
    const command = String(session.command || '').trim();
    const args = Array.isArray(session.args) ? [...session.args] : [];
    if (!command) return { ok: false, error: 'The active emulator session has no restart command.' };
    const cwd = command ? path.dirname(command) : undefined;
    try {
      await terminateSession(sessionId);
    } catch {}
    const child = spawn(command, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd,
    });
    const nextSession = {
      ...session,
      id: `emu-${nextSessionId++}`,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
      isForeground: false,
    };
    activeSessions.set(nextSession.id, nextSession);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();

    child.once('error', (error) => {
      nextSession.status = 'error';
      nextSession.error = error?.message || 'Failed to restart emulator.';
      emitSessionsChanged();
      activeSessions.delete(nextSession.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      nextSession.status = 'exited';
      nextSession.exitCode = code;
      emitSessionsChanged();
      activeSessions.delete(nextSession.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (nextSession.identifier) markGamePlayed(nextSession.identifier);
    return { ok: true, session: serializeSession(nextSession) };
  }

  async function minimizeSessionWindow(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
    try {
      if (process.platform === 'win32') {
        const output = await runPowerShell(`Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NativeMinimize {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  public static IntPtr[] GetVisibleWindowsForProcess(int pid) {
    var handles = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint windowPid;
      GetWindowThreadProcessId(hWnd, out windowPid);
      if (windowPid == pid && IsWindowVisible(hWnd)) handles.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return handles.ToArray();
  }
}
"@;
$p=Get-Process -Id ${Number(session.pid)} -ErrorAction Stop;
$handles=[NativeMinimize]::GetVisibleWindowsForProcess(${Number(session.pid)});
if($handles.Count -eq 0 -and $p.MainWindowHandle -ne 0){ $handles=@([IntPtr]$p.MainWindowHandle) }
if($handles.Count -eq 0){ 'no-window' } else {
  foreach($hwnd in $handles){ [void][NativeMinimize]::ShowWindowAsync([IntPtr]$hwnd,6) }
  "ok:$($handles.Count)"
}`);
        if (!String(output || '').toLowerCase().includes('ok')) {
          return { ok: false, error: 'Could not minimize the emulator window.' };
        }
      }
      return { ok: true, session: serializeSession(session) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not minimize the emulator window.' };
    }
  }

  async function restoreSessionWindow(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
    try {
      if (process.platform === 'win32') {
        const output = await runPowerShell(`Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NativeRestore {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public static IntPtr[] GetVisibleWindowsForProcess(int pid) {
    var handles = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint windowPid;
      GetWindowThreadProcessId(hWnd, out windowPid);
      if (windowPid == pid && IsWindowVisible(hWnd)) handles.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return handles.ToArray();
  }
  public static long Area(IntPtr hWnd) {
    RECT rect;
    if (!GetWindowRect(hWnd, out rect)) return 0;
    return Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top);
  }
}
"@;
$p=Get-Process -Id ${Number(session.pid)} -ErrorAction Stop;
$handles=[NativeRestore]::GetVisibleWindowsForProcess(${Number(session.pid)});
if($handles.Count -eq 0 -and $p.MainWindowHandle -ne 0){ $handles=@([IntPtr]$p.MainWindowHandle) }
if($handles.Count -eq 0){ 'no-window' } else {
  $hwnd=$handles | Sort-Object { [NativeRestore]::Area($_) } -Descending | Select-Object -First 1
  [void][NativeRestore]::ShowWindowAsync([IntPtr]$hwnd,9);
  Start-Sleep -Milliseconds 60
  [void][NativeRestore]::SetForegroundWindow([IntPtr]$hwnd);
  'ok'
}`);
        if (!String(output || '').toLowerCase().includes('ok')) {
          return { ok: false, error: 'Could not restore the emulator window.' };
        }
      }
      return { ok: true, session: serializeSession(session) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not restore the emulator window.' };
    }
  }

  async function maximizeSessionWindow(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
    try {
      if (process.platform === 'win32') {
        const output = await runPowerShell(`Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NativeMaximize {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public static IntPtr[] GetVisibleWindowsForProcess(int pid) {
    var handles = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint windowPid;
      GetWindowThreadProcessId(hWnd, out windowPid);
      if (windowPid == pid && IsWindowVisible(hWnd)) handles.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return handles.ToArray();
  }
  public static bool FitToMonitor(IntPtr hWnd) {
    var monitor = MonitorFromWindow(hWnd, 2);
    if (monitor == IntPtr.Zero) return false;
    var info = new MONITORINFO();
    info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(monitor, ref info)) return false;
    var rect = info.rcMonitor;
    return SetWindowPos(hWnd, IntPtr.Zero, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top, 0x0040);
  }
}
"@;
$p=Get-Process -Id ${Number(session.pid)} -ErrorAction Stop;
$handles=[NativeMaximize]::GetVisibleWindowsForProcess(${Number(session.pid)});
if($handles.Count -eq 0 -and $p.MainWindowHandle -ne 0){ $handles=@([IntPtr]$p.MainWindowHandle) }
if($handles.Count -eq 0){ 'no-window' } else {
  foreach($hwnd in $handles){
    [void][NativeMaximize]::ShowWindowAsync([IntPtr]$hwnd,3);
    Start-Sleep -Milliseconds 40
    [void][NativeMaximize]::FitToMonitor([IntPtr]$hwnd);
    Start-Sleep -Milliseconds 40
    [void][NativeMaximize]::SetForegroundWindow([IntPtr]$hwnd);
  }
  "ok:$($handles.Count)"
}`);
        if (!String(output || '').toLowerCase().includes('ok')) {
          return { ok: false, error: 'Could not maximize the emulator window.' };
        }
      }
      return { ok: true, session: serializeSession(session) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not maximize the emulator window.' };
    }
  }

  function maximizeSessionWindowRepeatedly(sessionId, { attempts = 24, intervalMs = 700 } = {}) {
    const id = String(sessionId || '').trim();
    if (!id) return;
    let count = 0;
    const tick = () => {
      count += 1;
      maximizeSessionWindow(id).catch(() => null);
      if (count < attempts) setTimeout(tick, intervalMs);
    };
    setTimeout(tick, 250);
  }


  async function suspendSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
    if (session.status === 'suspended') return { ok: true, session: serializeSession(session) };
    try {
      if (process.platform === 'win32') {
        await runPowerShell(`Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeSuspend {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(UInt32 access, bool inheritHandle, UInt32 processId);
  [DllImport("ntdll.dll", SetLastError=true)]
  public static extern int NtSuspendProcess(IntPtr processHandle);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr handle);
}
"@;
$PROCESS_SUSPEND_RESUME = 0x0800;
$PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
$handle = [NativeSuspend]::OpenProcess($PROCESS_SUSPEND_RESUME -bor $PROCESS_QUERY_LIMITED_INFORMATION, $false, ${Number(session.pid)});
if($handle -eq [IntPtr]::Zero){ throw "Could not open process ${Number(session.pid)}" }
try {
  $result = [NativeSuspend]::NtSuspendProcess($handle);
  if($result -ne 0){ throw "NtSuspendProcess failed: $result" }
  'ok'
} finally {
  [void][NativeSuspend]::CloseHandle($handle);
}`);
      } else {
        try { process.kill(session.pid, 'SIGSTOP'); } catch {}
      }
      session.status = 'suspended';
      session.isForeground = false;
      emitSessionsChanged();
      return { ok: true, session: serializeSession(session) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not suspend the emulator session.' };
    }
  }

  async function resumeSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
    if (session.status !== 'suspended') return { ok: true, session: serializeSession(session) };
    try {
      if (process.platform === 'win32') {
        await runPowerShell(`Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeResume {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(UInt32 access, bool inheritHandle, UInt32 processId);
  [DllImport("ntdll.dll", SetLastError=true)]
  public static extern int NtResumeProcess(IntPtr processHandle);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr handle);
}
"@;
$PROCESS_SUSPEND_RESUME = 0x0800;
$PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
$handle = [NativeResume]::OpenProcess($PROCESS_SUSPEND_RESUME -bor $PROCESS_QUERY_LIMITED_INFORMATION, $false, ${Number(session.pid)});
if($handle -eq [IntPtr]::Zero){ throw "Could not open process ${Number(session.pid)}" }
try {
  $result = [NativeResume]::NtResumeProcess($handle);
  if($result -ne 0){ throw "NtResumeProcess failed: $result" }
  'ok'
} finally {
  [void][NativeResume]::CloseHandle($handle);
}`);
      } else {
        try { process.kill(session.pid, 'SIGCONT'); } catch {}
      }
      session.status = 'running';
      emitSessionsChanged();
      pollForegroundSession().catch(() => {});
      return { ok: true, session: serializeSession(session) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not resume the emulator session.' };
    }
  }

  function getSystems() {
    return LIBRETRO_SYSTEMS.map(system => ({ ...system }));
  }

  function getSystem(systemId) {
    return LIBRETRO_SYSTEMS.find(system => system.id === systemId) || null;
  }

  function getBundledRetroArchExecutableCandidates() {
    const candidates = [];
    if (process.platform === 'win32') {
      const resourcePath = process.resourcesPath || '';
      if (resourcePath) {
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'retroarch', 'retroarch.exe') });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'retroarch', 'retroarch.exe') });
      }
      if (userDataDir) {
        candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'retroarch', 'retroarch.exe') });
      }
    }
    return candidates.filter(candidate => candidate.path);
  }

    function getBundledPCSX2ExecutableCandidates() {
    const candidates = [];
    if (process.platform === 'win32') {
      const resourcePath = process.resourcesPath || '';
      if (resourcePath) {
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'pcsx2', 'pcsx2-qt.exe') });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'pcsx2', 'pcsx2.exe') });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'pcsx2', 'pcsx2-qt.exe') });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'pcsx2', 'pcsx2.exe') });
      }
      if (userDataDir) {
        candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'pcsx2', 'pcsx2-qt.exe') });
        candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'pcsx2', 'pcsx2.exe') });
      }
    }
      return candidates.filter(candidate => candidate.path);
    }

    function getBundledDuckStationExecutableCandidates() {
      const candidates = [];
      if (process.platform !== 'win32') return candidates;
      const resourcePath = process.resourcesPath || '';
      for (const executableName of DUCKSTATION_EXECUTABLE_NAMES) {
        if (resourcePath) {
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'duckstation', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'tools', 'duckstation', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'duckstation', executableName) });
        }
        if (userDataDir) {
          candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'duckstation', executableName) });
        }
      }
      return uniqueCandidateList(candidates);
    }

    function getBundledDolphinExecutableCandidates() {
      const candidates = [];
      if (process.platform !== 'win32') return candidates;
      const resourcePath = process.resourcesPath || '';
      for (const executableName of DOLPHIN_EXECUTABLE_NAMES) {
        if (resourcePath) {
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'dolphin', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'tools', 'dolphin', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'dolphin', executableName) });
        }
        if (userDataDir) {
          candidates.push({ source: 'managed', channel: 'stable', path: path.join(userDataDir, 'emulators', 'dolphin-stable', executableName) });
          candidates.push({ source: 'managed', channel: 'development', path: path.join(userDataDir, 'emulators', 'dolphin-development', executableName) });
          candidates.push({ source: 'managed', channel: 'legacy', path: path.join(userDataDir, 'emulators', 'dolphin', executableName) });
        }
      }
      return uniqueCandidateList(candidates);
    }

    function getBundledCemuExecutableCandidates() {
      const candidates = [];
      if (process.platform !== 'win32') return candidates;
      const resourcePath = process.resourcesPath || '';
      for (const executableName of CEMU_EXECUTABLE_NAMES) {
        if (resourcePath) {
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'cemu', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'tools', 'cemu', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'cemu', executableName) });
        }
        if (userDataDir) {
          candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'cemu', executableName) });
        }
      }
      return uniqueCandidateList(candidates);
    }

    function getBundledXemuExecutableCandidates() {
      const candidates = [];
      if (process.platform !== 'win32') return candidates;
      const resourcePath = process.resourcesPath || '';
      for (const executableName of XEMU_EXECUTABLE_NAMES) {
        if (resourcePath) {
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'xemu', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'tools', 'xemu', executableName) });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'xemu', executableName) });
        }
        if (userDataDir) {
          candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'xemu', executableName) });
        }
      }
      return uniqueCandidateList(candidates);
    }

      function getBundledRPCS3ExecutableCandidates() {
      const candidates = [];
      if (process.platform === 'win32') {
        const resourcePath = process.resourcesPath || '';
        if (resourcePath) {
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'rpcs3', 'rpcs3.exe') });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'rpcs3', 'rpcs3.exe') });
          candidates.push({ source: 'bundled', path: path.join(resourcePath, 'tools', 'rpcs3', 'rpcs3.exe') });
        }
        if (userDataDir) {
          candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'rpcs3', 'rpcs3.exe') });
        }
      }
      return uniqueCandidateList(candidates);
    }

  function getBundledVLCExecutableCandidates() {
    const candidates = [];
    if (process.platform === 'win32') {
      const resourcePath = process.resourcesPath || '';
      if (resourcePath) {
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'vlc', 'vlc.exe') });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'tools', 'vlc', 'vlc.exe') });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'vlc', 'vlc.exe') });
      }
      if (userDataDir) {
        candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'vlc', 'vlc.exe') });
      }
    }
    return candidates.filter(candidate => candidate.path);
  }

  function uniqueCandidateList(candidates = []) {
    const seen = new Set();
    const next = [];
    for (const candidate of candidates) {
      const candidatePath = String(candidate?.path || '').trim();
      if (!candidatePath || seen.has(candidatePath.toLowerCase())) continue;
      seen.add(candidatePath.toLowerCase());
      next.push({ ...candidate, path: candidatePath });
    }
    return next;
  }

  function getBundledXeniaExecutableCandidates() {
    const candidates = [];
    if (process.platform !== 'win32') return candidates;
    const resourcePath = process.resourcesPath || '';
    for (const executableName of XENIA_EXECUTABLE_NAMES) {
      if (resourcePath) {
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'xenia', executableName) });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'tools', 'xenia', executableName) });
        candidates.push({ source: 'bundled', path: path.join(resourcePath, 'bin', 'xenia', executableName) });
      }
      if (userDataDir) {
        candidates.push({ source: 'managed', path: path.join(userDataDir, 'emulators', 'xenia', executableName) });
      }
    }
    return uniqueCandidateList(candidates);
  }

  function ensureDir(dirPath) {
    if (!dirPath) return;
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  }

  function toPowerShellLiteral(value) {
    return `'${String(value || '').replace(/'/g, "''")}'`;
  }

  function sanitizeCacheName(value) {
    return String(value || '')
      .replace(/[^a-z0-9._-]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'xenia-game';
  }

  async function extractZipArchive(zipPath, destDir) {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Zip extraction for Xenia is currently implemented for Windows only.' };
    }
    try {
      ensureDir(path.dirname(destDir));
      await runPowerShell(`$src=${toPowerShellLiteral(zipPath)}; $dst=${toPowerShellLiteral(destDir)}; if(Test-Path -LiteralPath $dst){ Remove-Item -LiteralPath $dst -Recurse -Force }; New-Item -ItemType Directory -Path $dst -Force | Out-Null; Expand-Archive -LiteralPath $src -DestinationPath $dst -Force; 'ok'`);
      return { ok: true, extractedDir: destDir };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not extract the Xbox 360 zip archive.' };
    }
  }

  function findFirstFileRecursive(dirPath, predicate) {
    if (!dirPath || !fs.existsSync(dirPath)) return '';
    const queue = [dirPath];
    while (queue.length) {
      const current = queue.shift();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isFile() && predicate(fullPath, entry.name)) return fullPath;
        if (entry.isDirectory()) queue.push(fullPath);
      }
    }
    return '';
  }

  function findXeniaLaunchablePath(targetPath) {
    const target = String(targetPath || '').trim();
    if (!target || !fs.existsSync(target)) return '';
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      const ext = path.extname(target).toLowerCase();
      return ['.xex', '.iso'].includes(ext) ? target : '';
    }
    const preferred = findFirstFileRecursive(target, (_, name) => String(name || '').toLowerCase() === 'default.xex');
    if (preferred) return preferred;
    const xex = findFirstFileRecursive(target, (fullPath) => path.extname(fullPath).toLowerCase() === '.xex');
    if (xex) return xex;
    return findFirstFileRecursive(target, (fullPath) => path.extname(fullPath).toLowerCase() === '.iso');
  }

  async function resolveXeniaRomPath(romPath) {
    const baseResolved = resolveRomPath(romPath);
    if (!baseResolved.ok) return baseResolved;
    const initialPath = baseResolved.romPath;
    if (!initialPath || !fs.existsSync(initialPath)) {
      return { ok: false, error: `Xbox 360 content not found for Xenia: ${initialPath}` };
    }
    const initialStat = fs.statSync(initialPath);
    if (initialStat.isDirectory()) {
      const launchable = findXeniaLaunchablePath(initialPath);
      if (!launchable) return { ok: false, error: `No launchable Xbox 360 file found for Xenia: ${initialPath}` };
      return { ok: true, romPath: launchable, sourcePath: romPath, extracted: false };
    }
    const ext = path.extname(initialPath).toLowerCase();
    if (ext !== '.zip') {
      const launchable = findXeniaLaunchablePath(initialPath);
      if (!launchable) return { ok: false, error: `No launchable Xbox 360 file found for Xenia: ${initialPath}` };
      return { ok: true, romPath: launchable, sourcePath: romPath, extracted: false };
    }
    if (!XENIA_EXTRACT_CACHE_DIR) {
      return { ok: false, error: 'SKALD user-data extraction folder is not available for Xenia.' };
    }
    const stats = fs.statSync(initialPath);
    const cacheKey = `${sanitizeCacheName(path.basename(initialPath, path.extname(initialPath)))}_${stats.size}_${Math.floor(stats.mtimeMs)}`;
    const extractDir = path.join(XENIA_EXTRACT_CACHE_DIR, cacheKey);
    ensureDir(XENIA_EXTRACT_CACHE_DIR);
    let launchable = findXeniaLaunchablePath(extractDir);
    if (!launchable) {
      const extractResult = await extractZipArchive(initialPath, extractDir);
      if (!extractResult?.ok) return extractResult;
      launchable = findXeniaLaunchablePath(extractDir);
    }
    if (!launchable) {
      return { ok: false, error: `SKALD extracted the Xbox 360 zip, but could not find a launchable .xex or .iso inside ${initialPath}.` };
    }
    return {
      ok: true,
      romPath: launchable,
      sourcePath: romPath,
      extracted: true,
      extractedDir: extractDir,
      archivePath: initialPath,
    };
  }

  function getRetroArchManagedExecutablePath() {
    if (process.platform !== 'win32' || !RETROARCH_RUNTIME_DIR) return '';
    return path.join(RETROARCH_RUNTIME_DIR, 'retroarch.exe');
  }

      function getPCSX2ManagedExecutablePath() {
        if (process.platform !== 'win32' || !PCSX2_RUNTIME_DIR) return '';
        const candidates = [
          path.join(PCSX2_RUNTIME_DIR, 'pcsx2-qt.exe'),
          path.join(PCSX2_RUNTIME_DIR, 'pcsx2.exe'),
        ];
        return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
      }

      function getDuckStationManagedExecutablePath() {
        if (process.platform !== 'win32' || !DUCKSTATION_RUNTIME_DIR) return '';
        const candidates = DUCKSTATION_EXECUTABLE_NAMES.map(name => path.join(DUCKSTATION_RUNTIME_DIR, name));
        const exact = candidates.find(candidate => fs.existsSync(candidate));
        if (exact) return exact;
        if (fs.existsSync(DUCKSTATION_RUNTIME_DIR)) {
          try {
            const fuzzy = fs.readdirSync(DUCKSTATION_RUNTIME_DIR, { withFileTypes: true })
              .filter(entry => entry.isFile())
              .map(entry => entry.name)
              .find(name => {
                const lower = String(name || '').toLowerCase();
                return lower.startsWith('duckstation')
                  && lower.endsWith('.exe')
                  && !lower.includes('arm64')
                  && !lower.includes('updater')
                  && !lower.includes('uninstaller');
              });
            if (fuzzy) return path.join(DUCKSTATION_RUNTIME_DIR, fuzzy);
          } catch {}
        }
        return candidates[0] || '';
      }

      function getDolphinManagedRuntimeDir(channel = 'stable') {
        const normalizedChannel = String(channel || '').trim().toLowerCase() === 'development' ? 'development' : 'stable';
        return normalizedChannel === 'development'
          ? (DOLPHIN_DEVELOPMENT_RUNTIME_DIR || DOLPHIN_RUNTIME_DIR || '')
          : (DOLPHIN_STABLE_RUNTIME_DIR || DOLPHIN_RUNTIME_DIR || '');
      }

      function getDolphinManagedExecutablePath(channel = 'stable') {
        const runtimeDir = getDolphinManagedRuntimeDir(channel);
        if (process.platform !== 'win32' || !runtimeDir) return '';
        const candidates = DOLPHIN_EXECUTABLE_NAMES.map(name => path.join(runtimeDir, name));
        const exact = candidates.find(candidate => fs.existsSync(candidate));
        if (exact) return exact;
        if (fs.existsSync(runtimeDir)) {
          try {
            const fuzzy = fs.readdirSync(runtimeDir, { withFileTypes: true })
              .filter(entry => entry.isFile())
              .map(entry => entry.name)
              .find(name => {
                const lower = String(name || '').toLowerCase();
                return lower.startsWith('dolphin')
                  && lower.endsWith('.exe')
                  && !lower.includes('updater')
                  && !lower.includes('uninstall');
              });
            if (fuzzy) return path.join(runtimeDir, fuzzy);
          } catch {}
        }
        return candidates[0] || '';
      }

      function getRPCS3ManagedExecutablePath() {
      if (process.platform !== 'win32' || !RPCS3_RUNTIME_DIR) return '';
      const candidates = [
        path.join(RPCS3_RUNTIME_DIR, 'rpcs3.exe'),
      ];
      return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
    }

  function getCemuManagedExecutablePath() {
    if (process.platform !== 'win32' || !CEMU_RUNTIME_DIR) return '';
    const candidates = CEMU_EXECUTABLE_NAMES.map(name => path.join(CEMU_RUNTIME_DIR, name));
    const exact = candidates.find(candidate => fs.existsSync(candidate));
    if (exact) return exact;
    if (fs.existsSync(CEMU_RUNTIME_DIR)) {
      try {
        const fuzzy = fs.readdirSync(CEMU_RUNTIME_DIR, { withFileTypes: true })
          .filter(entry => entry.isFile())
          .map(entry => entry.name)
          .find(name => {
            const lower = String(name || '').toLowerCase();
            return lower === 'cemu.exe'
              || (lower.startsWith('cemu') && lower.endsWith('.exe') && !lower.includes('installer') && !lower.includes('setup'));
          });
        if (fuzzy) return path.join(CEMU_RUNTIME_DIR, fuzzy);
      } catch {}
    }
    return candidates[0] || '';
  }

  function getXemuManagedExecutablePath() {
    if (process.platform !== 'win32' || !XEMU_RUNTIME_DIR) return '';
    const candidates = XEMU_EXECUTABLE_NAMES.map(name => path.join(XEMU_RUNTIME_DIR, name));
    const exact = candidates.find(candidate => fs.existsSync(candidate));
    if (exact) return exact;
    if (fs.existsSync(XEMU_RUNTIME_DIR)) {
      try {
        const fuzzy = fs.readdirSync(XEMU_RUNTIME_DIR, { withFileTypes: true })
          .filter(entry => entry.isFile())
          .map(entry => entry.name)
          .find(name => String(name || '').toLowerCase() === 'xemu.exe');
        if (fuzzy) return path.join(XEMU_RUNTIME_DIR, fuzzy);
      } catch {}
    }
    return candidates[0] || '';
  }

  function getVLCManagedExecutablePath() {
    if (process.platform !== 'win32' || !VLC_RUNTIME_DIR) return '';
    const candidates = [
      path.join(VLC_RUNTIME_DIR, 'vlc.exe'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
  }

  function getXeniaManagedExecutablePath() {
    if (process.platform !== 'win32' || !XENIA_RUNTIME_DIR) return '';
    const candidates = XENIA_EXECUTABLE_NAMES.map(executableName => path.join(XENIA_RUNTIME_DIR, executableName));
    return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
  }

  function getRetroArchCoresDirCandidates(runtimeExecutablePath) {
    const executablePath = String(runtimeExecutablePath || '').trim();
    if (!executablePath) return [];
    const runtimeDir = path.dirname(executablePath);
    return [
      path.join(runtimeDir, 'cores'),
      path.join(runtimeDir, 'libretro', 'cores'),
    ];
  }

  function resolveManagedCorePath(runtimeExecutablePath, coreFileName) {
    const expectedName = String(coreFileName || '').trim();
    if (!expectedName) return '';
    for (const dirPath of getRetroArchCoresDirCandidates(runtimeExecutablePath)) {
      const candidatePath = path.join(dirPath, expectedName);
      if (fs.existsSync(candidatePath)) return candidatePath;
    }
    return '';
  }

  function sanitizeFolderName(name) {
    return String(name || '').replace(/[.\s]+$/, '').replace(/[<>:"/\\|?*]/g, '_') || '_';
  }

  function systemInstallFolderName(system = '') {
    const normalized = String(system || '').trim().toLowerCase();
    if (!normalized) return '';
    const folderMap = {
      snes: 'Super Nintendo',
      genesis: 'Sega Genesis',
      psx: 'PlayStation',
      ps2: 'PlayStation 2',
      ps3: 'PlayStation 3',
      psp: 'PlayStation Portable',
      dc: 'Dreamcast',
      xbox: 'Xbox',
      x360: 'Xbox 360',
      nes: 'Nintendo Entertainment System',
      gba: 'Game Boy Advance',
      n64: 'Nintendo 64',
      gamecube: 'GameCube',
      wii: 'Wii',
      wiiu: 'Wii U',
      switch: 'Nintendo Switch',
      pc: 'PC',
    };
    return sanitizeFolderName(folderMap[normalized] || normalized.toUpperCase());
  }

  function resolveSystemStorageRoot(baseDir, system = '') {
    const root = String(baseDir || '').trim() || DEFAULT_GAMES_DIR;
    const systemFolder = systemInstallFolderName(system);
    return systemFolder ? path.join(root, systemFolder) : root;
  }

  function escapeXmlText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function unescapeXmlText(value) {
    return String(value || '')
      .replace(/&apos;/g, '\'')
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  }

  function ensureSimpleXmlRoot(content = '') {
    const trimmed = String(content || '').trim();
    if (trimmed && /<content[\s>]/i.test(trimmed)) return trimmed;
    return '<?xml version="1.0" encoding="UTF-8"?>\n<content>\n</content>\n';
  }

  function upsertSimpleXmlTag(content, tagName, value) {
    const xml = ensureSimpleXmlRoot(content);
    const tag = String(tagName || '').trim();
    if (!tag) return xml;
    const encodedValue = escapeXmlText(value);
    const pattern = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i');
    if (pattern.test(xml)) return xml.replace(pattern, `<${tag}>${encodedValue}</${tag}>`);
    return xml.replace(/<\/content>\s*$/i, `  <${tag}>${encodedValue}</${tag}>\n</content>`);
  }

  function upsertCemuGamePaths(content, entries = []) {
    const xml = ensureSimpleXmlRoot(content);
    const normalizedEntries = Array.from(new Set((Array.isArray(entries) ? entries : [])
      .map(entry => String(entry || '').trim())
      .filter(Boolean)));
    const block = normalizedEntries.length
      ? `  <GamePaths>\n${normalizedEntries.map(entry => `    <Entry>${escapeXmlText(entry)}</Entry>`).join('\n')}\n  </GamePaths>`
      : '  <GamePaths/>';
    if (/<GamePaths[\s>]/i.test(xml)) {
      return xml.replace(/<GamePaths[\s\S]*?<\/GamePaths>|<GamePaths\s*\/>/i, block);
    }
    return xml.replace(/<\/content>\s*$/i, `${block}\n</content>`);
  }

  function upsertCemuAudioConfig(content, options = {}) {
    const xml = ensureSimpleXmlRoot(content);
    const audioApi = Number.isFinite(Number(options.audioApi)) ? String(Number(options.audioApi)) : '2';
    const delay = Number.isFinite(Number(options.delay)) ? String(Number(options.delay)) : '2';
    const tvChannels = Number.isFinite(Number(options.tvChannels)) ? String(Number(options.tvChannels)) : '1';
    const padChannels = Number.isFinite(Number(options.padChannels)) ? String(Number(options.padChannels)) : '1';
    const inputChannels = Number.isFinite(Number(options.inputChannels)) ? String(Number(options.inputChannels)) : '0';
    const tvVolume = Number.isFinite(Number(options.tvVolume)) ? String(Number(options.tvVolume)) : '100';
    const padVolume = Number.isFinite(Number(options.padVolume)) ? String(Number(options.padVolume)) : '100';
    const inputVolume = Number.isFinite(Number(options.inputVolume)) ? String(Number(options.inputVolume)) : '20';
    const tvDevice = escapeXmlText(options.tvDevice || 'default');
    const padDevice = escapeXmlText(options.padDevice || 'default');
    const inputDevice = escapeXmlText(options.inputDevice || '');
    const block = [
      '  <Audio>',
      `    <api>${audioApi}</api>`,
      `    <delay>${delay}</delay>`,
      `    <TVChannels>${tvChannels}</TVChannels>`,
      `    <PadChannels>${padChannels}</PadChannels>`,
      `    <InputChannels>${inputChannels}</InputChannels>`,
      `    <TVVolume>${tvVolume}</TVVolume>`,
      `    <PadVolume>${padVolume}</PadVolume>`,
      `    <InputVolume>${inputVolume}</InputVolume>`,
      `    <TVDevice>${tvDevice}</TVDevice>`,
      `    <PadDevice>${padDevice}</PadDevice>`,
      `    <InputDevice>${inputDevice}</InputDevice>`,
      '  </Audio>',
    ].join('\n');
    if (/<Audio[\s>]/i.test(xml)) {
      return xml.replace(/<Audio[\s\S]*?<\/Audio>/i, block);
    }
    return xml.replace(/<\/content>\s*$/i, `${block}\n</content>`);
  }

  function readCemuGamePathsFromXml(content = '') {
    const xml = String(content || '');
    const match = xml.match(/<GamePaths[\s\S]*?>([\s\S]*?)<\/GamePaths>/i);
    if (!match) return [];
    const entries = [];
    const entryPattern = /<Entry>([\s\S]*?)<\/Entry>/gi;
    let current = null;
    while ((current = entryPattern.exec(match[1])) !== null) {
      const value = unescapeXmlText(current[1]).trim();
      if (value) entries.push(value);
    }
    return Array.from(new Set(entries));
  }

  function readSimpleXmlTag(content = '', tagName = '') {
    const tag = String(tagName || '').trim();
    if (!tag) return '';
    const match = String(content || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? unescapeXmlText(match[1]).trim() : '';
  }

  function normalizeCemuGamePathForXml(dirPath = '') {
    const resolved = path.resolve(String(dirPath || '').trim());
    return resolved.replace(/\\/g, '/');
  }

  function buildCemuXInputDefaultProfileText() {
    return [
      '# SKALD managed Cemu controller profile',
      '# First pass: Xbox/XInput mapped as Wii U GamePad',
      '[General]',
      'emulate = Wii U GamePad',
      'api = XInput',
      'controller = 0',
      '',
      '[Controller]',
      'rumble = 0',
      'leftRange = 1',
      'rightRange = 1',
      'leftDeadzone = 0.2',
      'rightDeadzone = 0.2',
      'buttonThreshold = 0.5',
      '1 = button_1',
      '2 = button_2',
      '3 = button_4',
      '4 = button_8',
      '5 = button_10',
      '6 = button_20',
      '7 = button_10',
      '8 = button_20',
      '9 = button_40',
      '10 = button_80',
      '11 = button_4000000',
      '12 = button_8000000',
      '13 = button_10000000',
      '14 = button_20000000',
      '15 = button_100',
      '16 = button_200',
      '17 = button_80000000',
      '18 = button_2000000000',
      '19 = button_1000000000',
      '20 = button_40000000',
      '21 = button_400000000',
      '22 = button_10000000000',
      '23 = button_8000000000',
      '24 = button_200000000',
      '',
    ].join('\n');
  }

  function parseCemuControllerProfileSummary(content = '') {
    const text = String(content || '');
    const emulate = text.match(/^\s*emulate\s*=\s*(.+)$/mi)?.[1]?.trim() || '';
    const api = text.match(/^\s*api\s*=\s*(.+)$/mi)?.[1]?.trim() || '';
    const controller = text.match(/^\s*controller\s*=\s*(.+)$/mi)?.[1]?.trim() || '';
    const preset = /SKALD managed Cemu controller profile/i.test(text) && /^xinput$/i.test(api) && /^wii u gamepad$/i.test(emulate)
      ? 'xinput-default'
      : '';
    return { emulate, api, controller, preset };
  }

  function normalizeSettings(settings = loadSettings()) {
    const next = settings && typeof settings === 'object' ? { ...settings } : {};
    if (!next.emulators || typeof next.emulators !== 'object') next.emulators = {};
    const retroarch = next.emulators.retroarch && typeof next.emulators.retroarch === 'object'
      ? { ...next.emulators.retroarch }
      : {};
    retroarch.mode = retroarch.mode === 'custom' ? 'custom' : 'bundled';
    retroarch.customExecutablePath = String(retroarch.customExecutablePath || retroarch.executablePath || next.retroarchPath || '').trim();
    retroarch.executablePath = retroarch.customExecutablePath;
    retroarch.cores = { ...(next.cores || {}), ...(retroarch.cores || {}) };
    retroarch.managedCoreNames = { ...(retroarch.managedCoreNames || {}) };
    next.emulators.retroarch = retroarch;
      const pcsx2 = next.emulators.pcsx2 && typeof next.emulators.pcsx2 === 'object'
        ? { ...next.emulators.pcsx2 }
        : {};
    pcsx2.mode = pcsx2.mode === 'custom' ? 'custom' : 'bundled';
    pcsx2.customExecutablePath = String(pcsx2.customExecutablePath || pcsx2.executablePath || '').trim();
    pcsx2.executablePath = pcsx2.customExecutablePath;
    pcsx2.biosPath = String(pcsx2.biosPath || '').trim();
    pcsx2.displaySettings = pcsx2.displaySettings && typeof pcsx2.displaySettings === 'object'
      ? { ...pcsx2.displaySettings }
      : {};
    pcsx2.audioSettings = pcsx2.audioSettings && typeof pcsx2.audioSettings === 'object'
      ? { ...pcsx2.audioSettings }
      : {};
    pcsx2.speedSettings = pcsx2.speedSettings && typeof pcsx2.speedSettings === 'object'
      ? { ...pcsx2.speedSettings }
      : {};
    next.emulators.pcsx2 = pcsx2;
      const duckstation = next.emulators.duckstation && typeof next.emulators.duckstation === 'object'
        ? { ...next.emulators.duckstation }
        : {};
      duckstation.mode = duckstation.mode === 'custom' ? 'custom' : 'bundled';
      duckstation.customExecutablePath = String(duckstation.customExecutablePath || duckstation.executablePath || '').trim();
      duckstation.executablePath = duckstation.customExecutablePath;
      duckstation.biosPath = String(duckstation.biosPath || '').trim();
      const duckstationGuideSettings = duckstation.guideSettings && typeof duckstation.guideSettings === 'object'
        ? { ...duckstation.guideSettings }
        : {};
      duckstation.displaySettings = duckstation.displaySettings && typeof duckstation.displaySettings === 'object'
        ? { ...duckstation.displaySettings }
        : {};
      duckstation.guideSettings = {
        startFullscreen: duckstationGuideSettings.startFullscreen !== false,
        hideCursorInFullscreen: duckstationGuideSettings.hideCursorInFullscreen !== false,
        pauseOnFocusLost: duckstationGuideSettings.pauseOnFocusLost === true,
        enableCheats: duckstationGuideSettings.enableCheats === true,
      };
      next.emulators.duckstation = duckstation;
      const dolphin = next.emulators.dolphin && typeof next.emulators.dolphin === 'object'
        ? { ...next.emulators.dolphin }
        : {};
      dolphin.mode = dolphin.mode === 'custom' ? 'custom' : 'bundled';
      dolphin.buildChannel = 'stable';
      dolphin.customExecutablePath = String(dolphin.customExecutablePath || dolphin.executablePath || '').trim();
      dolphin.executablePath = dolphin.customExecutablePath;
      next.emulators.dolphin = dolphin;
      const cemu = next.emulators.cemu && typeof next.emulators.cemu === 'object'
        ? { ...next.emulators.cemu }
        : {};
      cemu.mode = cemu.mode === 'custom' ? 'custom' : 'bundled';
      cemu.customExecutablePath = String(cemu.customExecutablePath || cemu.executablePath || '').trim();
      cemu.executablePath = cemu.customExecutablePath;
      cemu.graphicsPacksAutoDownload = cemu.graphicsPacksAutoDownload === true;
      cemu.controllerPreset = cemu.controllerPreset === 'xinput-default' ? 'xinput-default' : '';
      next.emulators.cemu = cemu;
      const xemu = next.emulators.xemu && typeof next.emulators.xemu === 'object'
        ? { ...next.emulators.xemu }
        : {};
      xemu.mode = xemu.mode === 'custom' ? 'custom' : 'bundled';
      xemu.customExecutablePath = String(xemu.customExecutablePath || xemu.executablePath || '').trim();
      xemu.executablePath = xemu.customExecutablePath;
      xemu.flashRomPath = String(xemu.flashRomPath || '').trim();
      xemu.mcpxBootRomPath = String(xemu.mcpxBootRomPath || '').trim();
      xemu.hardDiskImagePath = String(xemu.hardDiskImagePath || '').trim();
      next.emulators.xemu = xemu;
      const rpcs3 = next.emulators.rpcs3 && typeof next.emulators.rpcs3 === 'object'
        ? { ...next.emulators.rpcs3 }
        : {};
      rpcs3.mode = rpcs3.mode === 'custom' ? 'custom' : 'bundled';
      rpcs3.customExecutablePath = String(rpcs3.customExecutablePath || rpcs3.executablePath || '').trim();
      rpcs3.executablePath = rpcs3.customExecutablePath;
      rpcs3.firmwarePackagePath = String(rpcs3.firmwarePackagePath || '').trim();
      rpcs3.welcomeCompleted = rpcs3.welcomeCompleted === true;
      next.emulators.rpcs3 = rpcs3;
      const vlc = next.emulators.vlc && typeof next.emulators.vlc === 'object'
        ? { ...next.emulators.vlc }
        : {};
    vlc.mode = vlc.mode === 'custom' ? 'custom' : 'bundled';
    vlc.customExecutablePath = String(vlc.customExecutablePath || vlc.executablePath || '').trim();
    vlc.executablePath = vlc.customExecutablePath;
    next.emulators.vlc = vlc;
    const xenia = next.emulators.xenia && typeof next.emulators.xenia === 'object'
      ? { ...next.emulators.xenia }
      : {};
    xenia.mode = xenia.mode === 'custom' ? 'custom' : 'bundled';
    xenia.customExecutablePath = String(xenia.customExecutablePath || xenia.executablePath || '').trim();
    xenia.executablePath = xenia.customExecutablePath;
    xenia.guideSettings = xenia.guideSettings && typeof xenia.guideSettings === 'object'
      ? { ...xenia.guideSettings }
      : {};
    xenia.gameProfiles = xenia.gameProfiles && typeof xenia.gameProfiles === 'object' ? { ...xenia.gameProfiles } : {};
    xenia.lastGameProfileRef = xenia.lastGameProfileRef && typeof xenia.lastGameProfileRef === 'object'
      ? { ...xenia.lastGameProfileRef }
      : null;
    next.emulators.xenia = xenia;
    next.retroarchPath = retroarch.customExecutablePath;
    next.cores = { ...retroarch.cores };
    return next;
  }

  function getManagedCoreChoices(systemId) {
    const system = getSystem(systemId);
    const choices = Array.isArray(system?.coreChoices) && system.coreChoices.length
      ? system.coreChoices
      : (system?.coreExample ? [{ fileName: system.coreExample, label: system.label }] : []);
    return choices.map(choice => ({ ...choice }));
  }

  function getPreferredManagedCoreChoice(settings, system) {
    const normalized = normalizeSettings(settings);
    const choices = getManagedCoreChoices(system?.id);
    const preferredFileName = String(normalized.emulators?.retroarch?.managedCoreNames?.[system?.id] || '').trim();
    const preferred = choices.find(choice => choice.fileName === preferredFileName);
    if (preferred) return preferred;
    const recommended = choices.find(choice => choice.recommendedForAchievements);
    if (recommended) return recommended;
    return choices.find(choice => choice.fileName === system?.coreExample) || choices[0] || null;
  }

  function getRetroArchRuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const retroarch = normalized.emulators?.retroarch || {};
    const bundledCandidate = getBundledRetroArchExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(retroarch.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const preferredMode = retroarch.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (preferredMode === 'custom' && customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (preferredMode === 'custom' && customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    return {
      managedRuntimeDir: RETROARCH_RUNTIME_DIR || '',
      managedCoresDir: effective?.path ? (getRetroArchCoresDirCandidates(effective.path).find(dirPath => fs.existsSync(dirPath)) || '') : '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getPCSX2RuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const pcsx2 = normalized.emulators?.pcsx2 || {};
    const bundledCandidate = getBundledPCSX2ExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(pcsx2.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const biosPath = String(pcsx2.biosPath || '').trim();
    const biosAvailable = !!biosPath && fs.existsSync(biosPath);
    const preferredMode = pcsx2.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (preferredMode === 'custom' && customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (preferredMode === 'custom' && customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    return {
      managedRuntimeDir: PCSX2_RUNTIME_DIR || '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      biosPath,
      biosAvailable,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getPCSX2IniSections(settings = loadSettings()) {
    const runtime = getPCSX2RuntimeStatus(settings);
    if (!runtime?.executablePath) return new Map();
    const pcsx2IniPath = path.join(path.dirname(runtime.executablePath), 'inis', 'PCSX2.ini');
    if (!pcsx2IniPath || !fs.existsSync(pcsx2IniPath)) return new Map();
    try {
      return parseIniSections(fs.readFileSync(pcsx2IniPath, 'utf8'));
    } catch {
      return new Map();
    }
  }

  function getPCSX2AudioSettingsDefaults() {
    return {
      backend: 'Cubeb',
      driverName: '',
      deviceName: '',
      syncMode: 'TimeStretch',
      expansionMode: 'Disabled',
      standardVolume: 100,
      fastForwardVolume: 100,
      outputMuted: false,
      outputLatencyMinimal: false,
      bufferMs: 50,
      outputLatencyMs: 20,
    };
  }

  function getPCSX2AudioSettingsStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const defaults = getPCSX2AudioSettingsDefaults();
    const stored = normalized?.emulators?.pcsx2?.audioSettings && typeof normalized.emulators.pcsx2.audioSettings === 'object'
      ? { ...normalized.emulators.pcsx2.audioSettings }
      : {};
    const ini = getPCSX2IniSections(normalized);
    const iniSettings = {
      backend: getIniStringValue(ini, 'SPU2/Output', 'Backend', defaults.backend),
      driverName: getIniStringValue(ini, 'SPU2/Output', 'DriverName', defaults.driverName),
      deviceName: getIniStringValue(ini, 'SPU2/Output', 'DeviceName', defaults.deviceName),
      syncMode: getIniStringValue(ini, 'SPU2/Output', 'SyncMode', defaults.syncMode),
      expansionMode: getIniStringValue(ini, 'SPU2/Output', 'ExpansionMode', defaults.expansionMode),
      standardVolume: getIniIntValue(ini, 'SPU2/Output', 'StandardVolume', defaults.standardVolume),
      fastForwardVolume: getIniIntValue(ini, 'SPU2/Output', 'FastForwardVolume', defaults.fastForwardVolume),
      outputMuted: getIniBoolValue(ini, 'SPU2/Output', 'OutputMuted', defaults.outputMuted),
      outputLatencyMinimal: getIniBoolValue(ini, 'SPU2/Output', 'OutputLatencyMinimal', defaults.outputLatencyMinimal),
      bufferMs: getIniIntValue(ini, 'SPU2/Output', 'BufferMS', defaults.bufferMs),
      outputLatencyMs: getIniIntValue(ini, 'SPU2/Output', 'OutputLatencyMS', defaults.outputLatencyMs),
    };
    return {
      ok: true,
      ...defaults,
      ...iniSettings,
      ...stored,
    };
  }

  function updatePCSX2AudioSettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getPCSX2AudioSettingsStatus(normalized);
    const nextAudioSettings = {
      ...current,
      ...(updates && typeof updates === 'object' ? updates : {}),
    };
    delete nextAudioSettings.ok;
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        pcsx2: {
          ...((normalized.emulators || {}).pcsx2 || {}),
          audioSettings: nextAudioSettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getPCSX2AudioSettingsStatus(next),
    };
  }

  function getPCSX2SpeedSettingsDefaults() {
    return {
      nominalScalar: 1.0,
      turboScalar: 2.0,
      slomoScalar: 0.5,
      syncToHostRefreshRate: false,
      useVSyncForTiming: false,
      inhibitScreensaver: true,
      enableFastBootFastForward: false,
    };
  }

  function getPCSX2SpeedSettingsStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const defaults = getPCSX2SpeedSettingsDefaults();
    const stored = normalized?.emulators?.pcsx2?.speedSettings && typeof normalized.emulators.pcsx2.speedSettings === 'object'
      ? { ...normalized.emulators.pcsx2.speedSettings }
      : {};
    const ini = getPCSX2IniSections(normalized);
    const iniSettings = {
      nominalScalar: getIniFloatValue(ini, 'Framerate', 'NominalScalar', defaults.nominalScalar),
      turboScalar: getIniFloatValue(ini, 'Framerate', 'TurboScalar', defaults.turboScalar),
      slomoScalar: getIniFloatValue(ini, 'Framerate', 'SlomoScalar', defaults.slomoScalar),
      syncToHostRefreshRate: getIniBoolValue(ini, 'EmuCore/GS', 'SyncToHostRefreshRate', defaults.syncToHostRefreshRate),
      useVSyncForTiming: getIniBoolValue(ini, 'EmuCore/GS', 'UseVSyncForTiming', defaults.useVSyncForTiming),
      inhibitScreensaver: getIniBoolValue(ini, 'UI', 'InhibitScreensaver', defaults.inhibitScreensaver),
      enableFastBootFastForward: getIniBoolValue(ini, 'EmuCore', 'EnableFastBootFastForward', defaults.enableFastBootFastForward),
    };
    return {
      ok: true,
      ...defaults,
      ...iniSettings,
      ...stored,
    };
  }

  function updatePCSX2SpeedSettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getPCSX2SpeedSettingsStatus(normalized);
    const nextSpeedSettings = {
      ...current,
      ...(updates && typeof updates === 'object' ? updates : {}),
    };
    delete nextSpeedSettings.ok;
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        pcsx2: {
          ...((normalized.emulators || {}).pcsx2 || {}),
          speedSettings: nextSpeedSettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getPCSX2SpeedSettingsStatus(next),
    };
  }

  function getPCSX2DisplaySettingsDefaults() {
    return {
      renderer: '',
      aspectRatio: 'Auto Standard',
      fmvAspectRatioSwitch: 'Off',
      upscaleMultiplier: 2,
      maxAnisotropy: 0,
      integerScaling: false,
      bilinearUpscale: true,
      fxaa: false,
      shadeBoost: false,
      mipmapping: 'Automatic',
      textureFiltering: 'Bilinear (PS2)',
      trilinearFiltering: 'Automatic',
      interlaceMode: 'Automatic',
      tvShader: 'None',
    };
  }

  function getPCSX2DisplaySettingsStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const defaults = getPCSX2DisplaySettingsDefaults();
    const stored = normalized?.emulators?.pcsx2?.displaySettings && typeof normalized.emulators.pcsx2.displaySettings === 'object'
      ? { ...normalized.emulators.pcsx2.displaySettings }
      : {};
    const ini = getPCSX2IniSections(normalized);
    const iniSettings = {
      renderer: getIniStringValue(ini, 'EmuCore/GS', 'Renderer', defaults.renderer),
      aspectRatio: getIniStringValue(ini, 'EmuCore/GS', 'AspectRatio', defaults.aspectRatio),
      fmvAspectRatioSwitch: getIniStringValue(ini, 'EmuCore/GS', 'FMVAspectRatioSwitch', defaults.fmvAspectRatioSwitch),
      upscaleMultiplier: getIniIntValue(ini, 'EmuCore/GS', 'UpscaleMultiplier', defaults.upscaleMultiplier),
      maxAnisotropy: getIniIntValue(ini, 'EmuCore/GS', 'MaxAnisotropy', defaults.maxAnisotropy),
      integerScaling: getIniBoolValue(ini, 'EmuCore/GS', 'IntegerScaling', defaults.integerScaling),
      bilinearUpscale: getIniBoolValue(ini, 'EmuCore/GS', 'BilinearUpscale', defaults.bilinearUpscale),
      fxaa: getIniBoolValue(ini, 'EmuCore/GS', 'FXAA', defaults.fxaa),
      shadeBoost: getIniBoolValue(ini, 'EmuCore/GS', 'ShadeBoost', defaults.shadeBoost),
      mipmapping: getIniStringValue(ini, 'EmuCore/GS', 'Mipmapping', defaults.mipmapping),
      textureFiltering: getIniStringValue(ini, 'EmuCore/GS', 'TextureFiltering', defaults.textureFiltering),
      trilinearFiltering: getIniStringValue(ini, 'EmuCore/GS', 'TriFilter', defaults.trilinearFiltering),
      interlaceMode: getIniStringValue(ini, 'EmuCore/GS', 'InterlaceMode', defaults.interlaceMode),
      tvShader: getIniStringValue(ini, 'EmuCore/GS', 'TVShader', defaults.tvShader),
    };
    return {
      ok: true,
      ...defaults,
      ...iniSettings,
      ...stored,
    };
  }

  function updatePCSX2DisplaySettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getPCSX2DisplaySettingsStatus(normalized);
    const nextDisplaySettings = {
      ...current,
      ...(updates && typeof updates === 'object' ? updates : {}),
    };
    delete nextDisplaySettings.ok;
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        pcsx2: {
          ...((normalized.emulators || {}).pcsx2 || {}),
          displaySettings: nextDisplaySettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getPCSX2DisplaySettingsStatus(next),
    };
  }

  function getDuckStationRuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const duckstation = normalized.emulators?.duckstation || {};
    const bundledCandidate = getBundledDuckStationExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(duckstation.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const biosPath = String(duckstation.biosPath || '').trim();
    const biosFiles = getDuckStationBiosFiles(biosPath);
    const configuredBiosAvailable = biosFiles.length > 0;
    const preferredMode = duckstation.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    const runtimeRoot = effective?.path ? path.dirname(effective.path) : (DUCKSTATION_RUNTIME_DIR || '');
    const portableBiosPath = runtimeRoot ? path.join(runtimeRoot, 'bios') : '';
    const portableBiosFiles = getDuckStationBiosFiles(portableBiosPath);
    const portableBiosAvailable = portableBiosFiles.length > 0;

    return {
      managedRuntimeDir: DUCKSTATION_RUNTIME_DIR || '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      biosPath,
      biosAvailable: configuredBiosAvailable || portableBiosAvailable,
      configuredBiosAvailable,
      configuredBiosCount: biosFiles.length,
      portableBiosPath,
      portableBiosAvailable,
      portableBiosCount: portableBiosFiles.length,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getDolphinRuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const dolphin = normalized.emulators?.dolphin || {};
    const buildChannel = dolphin.buildChannel === 'development' ? 'development' : 'stable';
    const availableCandidates = getBundledDolphinExecutableCandidates().filter(candidate => fs.existsSync(candidate.path));
    const bundledCandidate = availableCandidates.find(candidate => candidate.channel === buildChannel)
      || availableCandidates.find(candidate => candidate.channel === 'stable')
      || availableCandidates.find(candidate => candidate.channel === 'development')
      || availableCandidates[0]
      || null;
    const customExecutablePath = String(dolphin.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const preferredMode = dolphin.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (preferredMode === 'custom' && customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (preferredMode === 'custom' && customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    const preferredManagedRuntimeDir = buildChannel === 'development' ? (DOLPHIN_DEVELOPMENT_RUNTIME_DIR || DOLPHIN_RUNTIME_DIR || '') : (DOLPHIN_STABLE_RUNTIME_DIR || DOLPHIN_RUNTIME_DIR || '');
    const runtimeRoot = effective?.path ? path.dirname(effective.path) : preferredManagedRuntimeDir;
    const stableExecutablePath = getDolphinManagedExecutablePath('stable');
    const developmentExecutablePath = getDolphinManagedExecutablePath('development');
    return {
      managedRuntimeDir: preferredManagedRuntimeDir,
      legacyManagedRuntimeDir: DOLPHIN_RUNTIME_DIR || '',
      stableRuntimeDir: DOLPHIN_STABLE_RUNTIME_DIR || '',
      developmentRuntimeDir: DOLPHIN_DEVELOPMENT_RUNTIME_DIR || '',
      buildChannel,
      builds: {
        stable: {
          managedRuntimeDir: DOLPHIN_STABLE_RUNTIME_DIR || '',
          executablePath: stableExecutablePath,
          available: !!stableExecutablePath && fs.existsSync(stableExecutablePath),
        },
        development: {
          managedRuntimeDir: DOLPHIN_DEVELOPMENT_RUNTIME_DIR || '',
          executablePath: developmentExecutablePath,
          available: !!developmentExecutablePath && fs.existsSync(developmentExecutablePath),
        },
      },
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      runtimeRoot,
      portableFilePath: runtimeRoot ? path.join(runtimeRoot, 'portable.txt') : '',
      portableAvailable: !!(runtimeRoot && fs.existsSync(path.join(runtimeRoot, 'portable.txt'))),
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getCemuRuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const cemu = normalized.emulators?.cemu || {};
    const bundledCandidate = getBundledCemuExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(cemu.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const preferredMode = cemu.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    const runtimeRoot = effective?.path ? path.dirname(effective.path) : (CEMU_RUNTIME_DIR || '');
    const portableDirPath = runtimeRoot ? path.join(runtimeRoot, 'portable') : '';
    const settingsPath = portableDirPath ? path.join(portableDirPath, 'settings.xml') : '';
    const controllerProfilePath = portableDirPath ? path.join(portableDirPath, 'controllerProfiles', 'controller0.txt') : '';
    let configuredGamePaths = [];
    let graphicsPacksAutoDownload = cemu.graphicsPacksAutoDownload === true;
    let controllerConfig = { emulate: '', api: '', controller: '', preset: '' };
    if (settingsPath && fs.existsSync(settingsPath)) {
      try {
        const xml = fs.readFileSync(settingsPath, 'utf8');
        configuredGamePaths = readCemuGamePathsFromXml(xml);
        const gpDownload = readSimpleXmlTag(xml, 'gp_download').toLowerCase();
        if (gpDownload === 'true' || gpDownload === 'false') {
          graphicsPacksAutoDownload = gpDownload === 'true';
        }
      } catch {}
    }
    if (controllerProfilePath && fs.existsSync(controllerProfilePath)) {
      try {
        controllerConfig = parseCemuControllerProfileSummary(fs.readFileSync(controllerProfilePath, 'utf8'));
      } catch {}
    }
    const preferredGamePath = normalizeCemuGamePathForXml(resolveSystemStorageRoot(
      String(normalized.installPath || DEFAULT_GAMES_DIR).trim() || DEFAULT_GAMES_DIR,
      'wiiu',
    ));
    return {
      managedRuntimeDir: CEMU_RUNTIME_DIR || '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      runtimeRoot,
      portableDirPath,
      settingsPath,
      controllerProfilePath,
      controllerProfileAvailable: !!(controllerProfilePath && fs.existsSync(controllerProfilePath)),
      controllerApi: controllerConfig.api,
      controllerEmulate: controllerConfig.emulate,
      controllerDevice: controllerConfig.controller,
      controllerPreset: controllerConfig.preset || cemu.controllerPreset || '',
      portableAvailable: !!(portableDirPath && fs.existsSync(portableDirPath)),
      configuredGamePaths,
      preferredGamePath,
      graphicsPacksAutoDownload,
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getStoredDuckStationGuideSettings(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const raw = normalized?.emulators?.duckstation?.guideSettings && typeof normalized.emulators.duckstation.guideSettings === 'object'
      ? normalized.emulators.duckstation.guideSettings
      : {};
    return {
      startFullscreen: raw.startFullscreen !== false,
      hideCursorInFullscreen: raw.hideCursorInFullscreen !== false,
      pauseOnFocusLost: raw.pauseOnFocusLost === true,
      enableCheats: raw.enableCheats === true,
    };
  }

  function getDuckStationGuideSettingsStatus(settings = loadSettings()) {
    return {
      ok: true,
      ...getStoredDuckStationGuideSettings(settings),
    };
  }

  function updateDuckStationGuideSettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getStoredDuckStationGuideSettings(normalized);
    const nextGuideSettings = {
      startFullscreen: updates?.startFullscreen == null ? current.startFullscreen : !!updates.startFullscreen,
      hideCursorInFullscreen: updates?.hideCursorInFullscreen == null ? current.hideCursorInFullscreen : !!updates.hideCursorInFullscreen,
      pauseOnFocusLost: updates?.pauseOnFocusLost == null ? current.pauseOnFocusLost : !!updates.pauseOnFocusLost,
      enableCheats: updates?.enableCheats == null ? current.enableCheats : !!updates.enableCheats,
    };
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        duckstation: {
          ...((normalized.emulators || {}).duckstation || {}),
          guideSettings: nextGuideSettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getDuckStationGuideSettingsStatus(next),
    };
  }

  function getDuckStationDisplaySettingsDefaults() {
    return {
      renderer: 'Automatic',
      adapter: '',
      resolutionScale: 1,
      multisamples: 1,
      downsampleMode: 'Disabled',
      textureFilter: 'Nearest-Neighbor',
      spriteTextureFilter: 'Nearest-Neighbor',
      ditheringMode: 'Scaled',
      deinterlacingMode: 'Progressive (Optimal)',
      lineDetectMode: 'Disabled',
      widescreenHack: false,
      enableModulationCrop: false,
      enableTextureCache: true,
      chromaSmoothing24Bit: false,
      pgxpEnable: false,
      pgxpCulling: true,
      pgxpTextureCorrection: true,
      pgxpColorCorrection: false,
      pgxpVertexCache: false,
      pgxpCpu: false,
      pgxpPreserveProjFP: false,
      pgxpTolerance: -1,
      pgxpDepthBuffer: false,
      pgxpDisableOn2DPolygons: false,
      pgxpTransparentDepthTest: false,
      pgxpDepthThreshold: 4096,
      aspectRatio: 'Auto (Game Native)',
      cropMode: 'Only Overscan Area',
      force4_3For24Bit: false,
      activeStartOffset: 0,
      activeEndOffset: 0,
      lineStartOffset: 0,
      lineEndOffset: 0,
      fineCropMode: 'None',
      fineCropLeft: 0,
      fineCropTop: 0,
      fineCropRight: 0,
      fineCropBottom: 0,
      alignment: 'Center',
      rotation: 'No Rotation',
      scaling: 'Bilinear (Smooth)',
      scaling24Bit: 'Bilinear (Smooth)',
      exclusiveFullscreenControl: 'Automatic',
      optimalFramePacing: true,
      preFrameSleep: false,
      skipPresentingDuplicateFrames: false,
      vsync: false,
      disableMailboxPresentation: false,
      autoResizeWindow: false,
      useThread: true,
      useSoftwareRendererForReadbacks: false,
      scaledInterlacing: true,
      forceRoundTextureCoordinates: false,
      maxQueuedFrames: 2,
      enableTextureReplacements: false,
      enableVRAMWriteReplacements: false,
      alwaysTrackUploads: false,
      preloadTextures: false,
      dumpVRAMWrites: false,
      dumpTextures: false,
      dumpReplacedTextures: false,
      dumpTexturePages: false,
      dumpFullTexturePages: false,
      dumpTextureForceAlphaChannel: false,
      dumpVRAMWriteForceAlphaChannel: true,
      dumpC16Textures: false,
      reducePaletteRange: true,
      convertCopiesToWrites: false,
      replacementScaleLinearFilter: false,
      maxHashCacheEntries: 65536,
      maxHashCacheVRAMUsageMB: 512,
      maxReplacementCacheVRAMUsage: 512,
      maxVRAMWriteSplits: 0,
      maxVRAMWriteCoalesceWidth: 0,
      maxVRAMWriteCoalesceHeight: 0,
      dumpTextureWidthThreshold: 16,
      dumpTextureHeightThreshold: 16,
      dumpVRAMWriteWidthThreshold: 16,
      dumpVRAMWriteHeightThreshold: 16,
    };
  }

  function getDuckStationIniSections(settings = loadSettings()) {
    const runtime = getDuckStationRuntimeStatus(settings);
    if (!runtime?.executablePath) return new Map();
    const settingsIniPath = path.join(path.dirname(runtime.executablePath), 'settings.ini');
    if (!settingsIniPath || !fs.existsSync(settingsIniPath)) return new Map();
    try {
      return parseIniSections(fs.readFileSync(settingsIniPath, 'utf8'));
    } catch {
      return new Map();
    }
  }

  function getDuckStationDisplaySettingsStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const defaults = getDuckStationDisplaySettingsDefaults();
    const stored = normalized?.emulators?.duckstation?.displaySettings && typeof normalized.emulators.duckstation.displaySettings === 'object'
      ? { ...normalized.emulators.duckstation.displaySettings }
      : {};
    const ini = getDuckStationIniSections(normalized);
    const iniSettings = {
      renderer: getIniStringValue(ini, 'GPU', 'Renderer', defaults.renderer),
      adapter: getIniStringValue(ini, 'GPU', 'Adapter', defaults.adapter),
      resolutionScale: getIniIntValue(ini, 'GPU', 'ResolutionScale', defaults.resolutionScale),
      multisamples: getIniIntValue(ini, 'GPU', 'Multisamples', defaults.multisamples),
      downsampleMode: getIniStringValue(ini, 'GPU', 'DownsampleMode', defaults.downsampleMode),
      textureFilter: getIniStringValue(ini, 'GPU', 'TextureFilter', defaults.textureFilter),
      spriteTextureFilter: getIniStringValue(ini, 'GPU', 'SpriteTextureFilter', defaults.spriteTextureFilter),
      ditheringMode: getIniStringValue(ini, 'GPU', 'DitheringMode', defaults.ditheringMode),
      deinterlacingMode: getIniStringValue(ini, 'GPU', 'DeinterlacingMode', defaults.deinterlacingMode),
      lineDetectMode: getIniStringValue(ini, 'GPU', 'LineDetectMode', defaults.lineDetectMode),
      widescreenHack: getIniBoolValue(ini, 'GPU', 'WidescreenHack', defaults.widescreenHack),
      enableModulationCrop: getIniBoolValue(ini, 'GPU', 'EnableModulationCrop', defaults.enableModulationCrop),
      enableTextureCache: getIniBoolValue(ini, 'GPU', 'EnableTextureCache', defaults.enableTextureCache),
      chromaSmoothing24Bit: getIniBoolValue(ini, 'GPU', 'ChromaSmoothing24Bit', defaults.chromaSmoothing24Bit),
      pgxpEnable: getIniBoolValue(ini, 'GPU', 'PGXPEnable', defaults.pgxpEnable),
      pgxpCulling: getIniBoolValue(ini, 'GPU', 'PGXPCulling', defaults.pgxpCulling),
      pgxpTextureCorrection: getIniBoolValue(ini, 'GPU', 'PGXPTextureCorrection', defaults.pgxpTextureCorrection),
      pgxpColorCorrection: getIniBoolValue(ini, 'GPU', 'PGXPColorCorrection', defaults.pgxpColorCorrection),
      pgxpVertexCache: getIniBoolValue(ini, 'GPU', 'PGXPVertexCache', defaults.pgxpVertexCache),
      pgxpCpu: getIniBoolValue(ini, 'GPU', 'PGXPCPU', defaults.pgxpCpu),
      pgxpPreserveProjFP: getIniBoolValue(ini, 'GPU', 'PGXPPreserveProjFP', defaults.pgxpPreserveProjFP),
      pgxpTolerance: getIniFloatValue(ini, 'GPU', 'PGXPTolerance', defaults.pgxpTolerance),
      pgxpDepthBuffer: getIniBoolValue(ini, 'GPU', 'PGXPDepthBuffer', defaults.pgxpDepthBuffer),
      pgxpDisableOn2DPolygons: getIniBoolValue(ini, 'GPU', 'PGXPDisableOn2DPolygons', defaults.pgxpDisableOn2DPolygons),
      pgxpTransparentDepthTest: getIniBoolValue(ini, 'GPU', 'PGXPTransparentDepthTest', defaults.pgxpTransparentDepthTest),
      pgxpDepthThreshold: getIniFloatValue(ini, 'GPU', 'PGXPDepthThreshold', defaults.pgxpDepthThreshold),
      aspectRatio: getIniStringValue(ini, 'Display', 'AspectRatio', defaults.aspectRatio),
      cropMode: getIniStringValue(ini, 'Display', 'CropMode', defaults.cropMode),
      force4_3For24Bit: getIniBoolValue(ini, 'Display', 'Force4_3For24Bit', defaults.force4_3For24Bit),
      activeStartOffset: getIniIntValue(ini, 'Display', 'ActiveStartOffset', defaults.activeStartOffset),
      activeEndOffset: getIniIntValue(ini, 'Display', 'ActiveEndOffset', defaults.activeEndOffset),
      lineStartOffset: getIniIntValue(ini, 'Display', 'LineStartOffset', defaults.lineStartOffset),
      lineEndOffset: getIniIntValue(ini, 'Display', 'LineEndOffset', defaults.lineEndOffset),
      fineCropMode: getIniStringValue(ini, 'Display', 'FineCropMode', defaults.fineCropMode),
      fineCropLeft: getIniIntValue(ini, 'Display', 'FineCropLeft', defaults.fineCropLeft),
      fineCropTop: getIniIntValue(ini, 'Display', 'FineCropTop', defaults.fineCropTop),
      fineCropRight: getIniIntValue(ini, 'Display', 'FineCropRight', defaults.fineCropRight),
      fineCropBottom: getIniIntValue(ini, 'Display', 'FineCropBottom', defaults.fineCropBottom),
      alignment: getIniStringValue(ini, 'Display', 'Alignment', defaults.alignment),
      rotation: getIniStringValue(ini, 'Display', 'Rotation', defaults.rotation),
      scaling: getIniStringValue(ini, 'Display', 'Scaling', defaults.scaling),
      scaling24Bit: getIniStringValue(ini, 'Display', 'Scaling24Bit', defaults.scaling24Bit),
      exclusiveFullscreenControl: getIniStringValue(ini, 'Display', 'ExclusiveFullscreenControl', defaults.exclusiveFullscreenControl),
      optimalFramePacing: getIniBoolValue(ini, 'Display', 'OptimalFramePacing', defaults.optimalFramePacing),
      preFrameSleep: getIniBoolValue(ini, 'Display', 'PreFrameSleep', defaults.preFrameSleep),
      skipPresentingDuplicateFrames: getIniBoolValue(ini, 'Display', 'SkipPresentingDuplicateFrames', defaults.skipPresentingDuplicateFrames),
      vsync: getIniBoolValue(ini, 'Display', 'VSync', defaults.vsync),
      disableMailboxPresentation: getIniBoolValue(ini, 'Display', 'DisableMailboxPresentation', defaults.disableMailboxPresentation),
      autoResizeWindow: getIniBoolValue(ini, 'Display', 'AutoResizeWindow', defaults.autoResizeWindow),
      useThread: getIniBoolValue(ini, 'GPU', 'UseThread', defaults.useThread),
      useSoftwareRendererForReadbacks: getIniBoolValue(ini, 'GPU', 'UseSoftwareRendererForReadbacks', defaults.useSoftwareRendererForReadbacks),
      scaledInterlacing: getIniBoolValue(ini, 'GPU', 'ScaledInterlacing', defaults.scaledInterlacing),
      forceRoundTextureCoordinates: getIniBoolValue(ini, 'GPU', 'ForceRoundTextureCoordinates', defaults.forceRoundTextureCoordinates),
      maxQueuedFrames: getIniIntValue(ini, 'GPU', 'MaxQueuedFrames', defaults.maxQueuedFrames),
      enableTextureReplacements: getIniBoolValue(ini, 'TextureReplacements', 'EnableTextureReplacements', defaults.enableTextureReplacements),
      enableVRAMWriteReplacements: getIniBoolValue(ini, 'TextureReplacements', 'EnableVRAMWriteReplacements', defaults.enableVRAMWriteReplacements),
      alwaysTrackUploads: getIniBoolValue(ini, 'TextureReplacements', 'AlwaysTrackUploads', defaults.alwaysTrackUploads),
      preloadTextures: getIniBoolValue(ini, 'TextureReplacements', 'PreloadTextures', defaults.preloadTextures),
      dumpVRAMWrites: getIniBoolValue(ini, 'TextureReplacements', 'DumpVRAMWrites', defaults.dumpVRAMWrites),
      dumpTextures: getIniBoolValue(ini, 'TextureReplacements', 'DumpTextures', defaults.dumpTextures),
      dumpReplacedTextures: getIniBoolValue(ini, 'TextureReplacements', 'DumpReplacedTextures', defaults.dumpReplacedTextures),
      dumpTexturePages: getIniBoolValue(ini, 'TextureReplacements', 'DumpTexturePages', defaults.dumpTexturePages),
      dumpFullTexturePages: getIniBoolValue(ini, 'TextureReplacements', 'DumpFullTexturePages', defaults.dumpFullTexturePages),
      dumpTextureForceAlphaChannel: getIniBoolValue(ini, 'TextureReplacements', 'DumpTextureForceAlphaChannel', defaults.dumpTextureForceAlphaChannel),
      dumpVRAMWriteForceAlphaChannel: getIniBoolValue(ini, 'TextureReplacements', 'DumpVRAMWriteForceAlphaChannel', defaults.dumpVRAMWriteForceAlphaChannel),
      dumpC16Textures: getIniBoolValue(ini, 'TextureReplacements', 'DumpC16Textures', defaults.dumpC16Textures),
      reducePaletteRange: getIniBoolValue(ini, 'TextureReplacements', 'ReducePaletteRange', defaults.reducePaletteRange),
      convertCopiesToWrites: getIniBoolValue(ini, 'TextureReplacements', 'ConvertCopiesToWrites', defaults.convertCopiesToWrites),
      replacementScaleLinearFilter: getIniBoolValue(ini, 'TextureReplacements', 'ReplacementScaleLinearFilter', defaults.replacementScaleLinearFilter),
      maxHashCacheEntries: getIniIntValue(ini, 'TextureReplacements', 'MaxHashCacheEntries', defaults.maxHashCacheEntries),
      maxHashCacheVRAMUsageMB: getIniIntValue(ini, 'TextureReplacements', 'MaxHashCacheVRAMUsageMB', defaults.maxHashCacheVRAMUsageMB),
      maxReplacementCacheVRAMUsage: getIniIntValue(ini, 'TextureReplacements', 'MaxReplacementCacheVRAMUsage', defaults.maxReplacementCacheVRAMUsage),
      maxVRAMWriteSplits: getIniIntValue(ini, 'TextureReplacements', 'MaxVRAMWriteSplits', defaults.maxVRAMWriteSplits),
      maxVRAMWriteCoalesceWidth: getIniIntValue(ini, 'TextureReplacements', 'MaxVRAMWriteCoalesceWidth', defaults.maxVRAMWriteCoalesceWidth),
      maxVRAMWriteCoalesceHeight: getIniIntValue(ini, 'TextureReplacements', 'MaxVRAMWriteCoalesceHeight', defaults.maxVRAMWriteCoalesceHeight),
      dumpTextureWidthThreshold: getIniIntValue(ini, 'TextureReplacements', 'DumpTextureWidthThreshold', defaults.dumpTextureWidthThreshold),
      dumpTextureHeightThreshold: getIniIntValue(ini, 'TextureReplacements', 'DumpTextureHeightThreshold', defaults.dumpTextureHeightThreshold),
      dumpVRAMWriteWidthThreshold: getIniIntValue(ini, 'TextureReplacements', 'DumpVRAMWriteWidthThreshold', defaults.dumpVRAMWriteWidthThreshold),
      dumpVRAMWriteHeightThreshold: getIniIntValue(ini, 'TextureReplacements', 'DumpVRAMWriteHeightThreshold', defaults.dumpVRAMWriteHeightThreshold),
    };
    return {
      ok: true,
      ...defaults,
      ...iniSettings,
      ...stored,
    };
  }

  function updateDuckStationDisplaySettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getDuckStationDisplaySettingsStatus(normalized);
    const nextDisplaySettings = {
      ...current,
      ...(updates && typeof updates === 'object' ? updates : {}),
    };
    delete nextDisplaySettings.ok;
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        duckstation: {
          ...((normalized.emulators || {}).duckstation || {}),
          displaySettings: nextDisplaySettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getDuckStationDisplaySettingsStatus(next),
    };
  }

  function getDuckStationAudioSettingsDefaults() {
    return {
      backend: 'Cubeb',
      driver: '',
      outputDevice: '',
      outputVolume: 100,
      fastForwardVolume: 100,
      outputMuted: false,
    };
  }

  function getDuckStationAudioSettingsStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const defaults = getDuckStationAudioSettingsDefaults();
    const stored = normalized?.emulators?.duckstation?.audioSettings && typeof normalized.emulators.duckstation.audioSettings === 'object'
      ? { ...normalized.emulators.duckstation.audioSettings }
      : {};
    const ini = getDuckStationIniSections(normalized);
    const iniSettings = {
      backend: getIniStringValue(ini, 'Audio', 'Backend', defaults.backend),
      driver: getIniStringValue(ini, 'Audio', 'Driver', defaults.driver),
      outputDevice: getIniStringValue(ini, 'Audio', 'OutputDevice', defaults.outputDevice),
      outputVolume: getIniIntValue(ini, 'Audio', 'OutputVolume', defaults.outputVolume),
      fastForwardVolume: getIniIntValue(ini, 'Audio', 'FastForwardVolume', defaults.fastForwardVolume),
      outputMuted: getIniBoolValue(ini, 'Audio', 'OutputMuted', defaults.outputMuted),
    };
    return {
      ok: true,
      ...defaults,
      ...iniSettings,
      ...stored,
    };
  }

  function updateDuckStationAudioSettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getDuckStationAudioSettingsStatus(normalized);
    const nextAudioSettings = {
      ...current,
      ...(updates && typeof updates === 'object' ? updates : {}),
    };
    delete nextAudioSettings.ok;
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        duckstation: {
          ...((normalized.emulators || {}).duckstation || {}),
          audioSettings: nextAudioSettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getDuckStationAudioSettingsStatus(next),
    };
  }

  function getDuckStationSpeedSettingsDefaults() {
    return {
      emulationSpeed: 1.0,
      fastForwardSpeed: 0.0,
      turboSpeed: 0.0,
      syncToHostRefreshRate: false,
      inhibitScreensaver: true,
      disableBackgroundInput: false,
    };
  }

  function getDuckStationSpeedSettingsStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const defaults = getDuckStationSpeedSettingsDefaults();
    const stored = normalized?.emulators?.duckstation?.speedSettings && typeof normalized.emulators.duckstation.speedSettings === 'object'
      ? { ...normalized.emulators.duckstation.speedSettings }
      : {};
    const ini = getDuckStationIniSections(normalized);
    const iniSettings = {
      emulationSpeed: getIniFloatValue(ini, 'Main', 'EmulationSpeed', defaults.emulationSpeed),
      fastForwardSpeed: getIniFloatValue(ini, 'Main', 'FastForwardSpeed', defaults.fastForwardSpeed),
      turboSpeed: getIniFloatValue(ini, 'Main', 'TurboSpeed', defaults.turboSpeed),
      syncToHostRefreshRate: getIniBoolValue(ini, 'Main', 'SyncToHostRefreshRate', defaults.syncToHostRefreshRate),
      inhibitScreensaver: getIniBoolValue(ini, 'Main', 'InhibitScreensaver', defaults.inhibitScreensaver),
      disableBackgroundInput: getIniBoolValue(ini, 'Main', 'DisableBackgroundInput', defaults.disableBackgroundInput),
    };
    return {
      ok: true,
      ...defaults,
      ...iniSettings,
      ...stored,
    };
  }

  function updateDuckStationSpeedSettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getDuckStationSpeedSettingsStatus(normalized);
    const nextSpeedSettings = {
      ...current,
      ...(updates && typeof updates === 'object' ? updates : {}),
    };
    delete nextSpeedSettings.ok;
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        duckstation: {
          ...((normalized.emulators || {}).duckstation || {}),
          speedSettings: nextSpeedSettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getDuckStationSpeedSettingsStatus(next),
    };
  }

  function getXemuRuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const xemu = normalized.emulators?.xemu || {};
    const bundledCandidate = getBundledXemuExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(xemu.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const flashRomPath = String(xemu.flashRomPath || '').trim();
    const mcpxBootRomPath = String(xemu.mcpxBootRomPath || '').trim();
    const hardDiskImagePath = String(xemu.hardDiskImagePath || '').trim();
    const flashRomAvailable = !!flashRomPath && fs.existsSync(flashRomPath);
    const mcpxBootRomAvailable = !!mcpxBootRomPath && fs.existsSync(mcpxBootRomPath);
    const hardDiskImageAvailable = !!hardDiskImagePath && fs.existsSync(hardDiskImagePath);
    const preferredMode = xemu.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    const runtimeRoot = effective?.path ? path.dirname(effective.path) : (XEMU_RUNTIME_DIR || '');
    const configPath = runtimeRoot ? path.join(runtimeRoot, 'xemu.toml') : '';
    return {
      managedRuntimeDir: XEMU_RUNTIME_DIR || '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      flashRomPath,
      flashRomAvailable,
      mcpxBootRomPath,
      mcpxBootRomAvailable,
      hardDiskImagePath,
      hardDiskImageAvailable,
      requiredFilesAvailable: flashRomAvailable && mcpxBootRomAvailable && hardDiskImageAvailable,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      runtimeRoot,
      configPath,
      portableConfigAvailable: !!(configPath && fs.existsSync(configPath)),
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getRPCS3RuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const rpcs3 = normalized.emulators?.rpcs3 || {};
    const bundledCandidate = getBundledRPCS3ExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(rpcs3.customExecutablePath || '').trim();
    const firmwarePackagePath = String(rpcs3.firmwarePackagePath || '').trim();
    const firmwarePackageAvailable = !!firmwarePackagePath && fs.existsSync(firmwarePackagePath);
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const preferredMode = rpcs3.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    const runtimeRoot = effective?.path ? path.dirname(effective.path) : (RPCS3_RUNTIME_DIR || '');
    const devFlashDir = runtimeRoot ? path.join(runtimeRoot, 'dev_flash') : '';
    const firmwareVersionFile = runtimeRoot ? path.join(runtimeRoot, 'dev_flash', 'vsh', 'etc', 'version.txt') : '';
    const firmwareRequiredFiles = runtimeRoot ? [
      firmwareVersionFile,
      path.join(runtimeRoot, 'dev_flash', 'sys', 'external', 'liblv2.sprx'),
      path.join(runtimeRoot, 'dev_flash', 'sys', 'external', 'libsysmodule.sprx'),
    ] : [];
    const firmwareMissingFiles = firmwareRequiredFiles.filter(filePath => !filePath || !fs.existsSync(filePath));
    let firmwareInstalled = false;
    let firmwareVersion = '';
    if (firmwareVersionFile && fs.existsSync(firmwareVersionFile)) {
      try {
        const versionText = String(fs.readFileSync(firmwareVersionFile, 'utf8') || '');
        const versionMatch = versionText.match(/release:(\d+)\.(\d+)/i);
        if (versionMatch) {
          const major = String(versionMatch[1] || '').replace(/^0+/, '') || '0';
          const minorRaw = String(versionMatch[2] || '');
          const minor = minorRaw ? minorRaw.slice(0, 2) : '';
          firmwareVersion = minor ? `${major}.${minor}` : major;
        }
        firmwareInstalled = firmwareMissingFiles.length === 0;
      } catch {}
    }
    return {
      managedRuntimeDir: RPCS3_RUNTIME_DIR || '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      firmwarePackagePath,
      firmwarePackageAvailable,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      runtimeRoot,
      configDir: runtimeRoot ? path.join(runtimeRoot, 'config') : '',
      devHddHomeDir: runtimeRoot ? path.join(runtimeRoot, 'dev_hdd0', 'home', '00000001') : '',
      devFlashDir,
      firmwareInstalled,
      firmwareVersion,
      firmwareVersionFile,
      firmwareRequiredFiles,
      firmwareMissingFiles,
      ok: !!effective?.path && fs.existsSync(effective.path),
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
    };
  }

    function getVLCRuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const vlc = normalized.emulators?.vlc || {};
    const bundledCandidate = getBundledVLCExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(vlc.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const preferredMode = vlc.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    return {
      managedRuntimeDir: VLC_RUNTIME_DIR || '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getXeniaRuntimeStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const xenia = normalized.emulators?.xenia || {};
    const bundledCandidate = getBundledXeniaExecutableCandidates().find(candidate => fs.existsSync(candidate.path)) || null;
    const customExecutablePath = String(xenia.customExecutablePath || '').trim();
    const customAvailable = !!customExecutablePath && fs.existsSync(customExecutablePath);
    const preferredMode = xenia.mode === 'custom' ? 'custom' : 'bundled';
    let effective = null;

    if (preferredMode === 'bundled' && bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
      effective = { source: 'custom-missing', path: customExecutablePath, mode: 'custom' };
    }

    return {
      managedRuntimeDir: XENIA_RUNTIME_DIR || '',
      preferredMode,
      bundledAvailable: !!bundledCandidate,
      bundledExecutablePath: bundledCandidate?.path || '',
      customAvailable,
      customExecutablePath,
      effectiveMode: effective?.mode || null,
      effectiveSource: effective?.source || null,
      executablePath: effective?.path || '',
      usingBundled: effective?.mode === 'bundled',
      usingCustom: effective?.mode === 'custom',
      ok: !!effective?.path && fs.existsSync(effective.path),
    };
  }

  function getLibretroCoreStatus(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const runtime = getRetroArchRuntimeStatus(normalized);
    const configuredCores = normalized.emulators?.retroarch?.cores || {};
    const managedCoreNames = normalized.emulators?.retroarch?.managedCoreNames || {};
    const result = {};
    for (const system of LIBRETRO_SYSTEMS) {
      const configuredPath = String(configuredCores[system.id] || '').trim();
      const configuredAvailable = !!configuredPath && fs.existsSync(configuredPath);
      const preferredManagedChoice = getPreferredManagedCoreChoice(normalized, system);
      const preferredManagedName = preferredManagedChoice?.fileName || system.coreExample;
      const managedChoices = getManagedCoreChoices(system.id).map(choice => {
        const resolvedPath = runtime.ok ? resolveManagedCorePath(runtime.executablePath, choice.fileName) : '';
        return {
          fileName: choice.fileName,
          label: choice.label,
          recommendedForAchievements: !!choice.recommendedForAchievements,
          resolvedPath,
          available: !!resolvedPath,
        };
      });
      const preferredManaged = managedChoices.find(choice => choice.fileName === preferredManagedName) || null;
      const fallbackManaged = preferredManaged?.available
        ? preferredManaged
        : (managedChoices.find(choice => choice.available) || null);
      const managedPath = fallbackManaged?.resolvedPath || '';
      const resolvedPath = configuredAvailable ? configuredPath : managedPath;
      result[system.id] = {
        system: system.id,
        label: system.label,
        expectedCoreName: system.coreExample,
        configuredPath,
        configuredAvailable,
        managedPath,
        managedChoices,
        selectedManagedCoreName: String(managedCoreNames[system.id] || preferredManagedName || '').trim(),
        selectedManagedCoreLabel: preferredManagedChoice?.label || system.label,
        activeManagedCoreName: fallbackManaged?.fileName || '',
        activeManagedCoreLabel: fallbackManaged?.label || '',
        resolvedPath,
        available: !!resolvedPath && fs.existsSync(resolvedPath),
        source: configuredAvailable ? 'configured' : (managedPath ? 'managed-default' : 'missing'),
      };
    }

    return result;
  }

  function importRetroArchRuntime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No RetroArch executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!RETROARCH_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `RetroArch executable not found: ${sourcePath}` };
    }
    const sourceDir = path.dirname(sourcePath);
    const sourceExeName = path.basename(sourcePath).toLowerCase();
    if (sourceExeName !== 'retroarch.exe') {
      return { ok: false, error: 'Pick the RetroArch executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const targetParent = path.dirname(RETROARCH_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${RETROARCH_RUNTIME_DIR}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(RETROARCH_RUNTIME_DIR)) fs.renameSync(RETROARCH_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, RETROARCH_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(RETROARCH_RUNTIME_DIR)) fs.rmSync(RETROARCH_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, RETROARCH_RUNTIME_DIR);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getRetroArchManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'RetroArch import finished, but SKALD could not find retroarch.exe in the managed runtime.' };
      }
      return {
        ok: true,
        runtimeDir: RETROARCH_RUNTIME_DIR,
        executablePath: runtimeExe,
        status: getRetroArchRuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the RetroArch runtime into SKALD.' };
    }
  }

  function importPCSX2Runtime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No PCSX2 executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!PCSX2_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `PCSX2 executable not found: ${sourcePath}` };
    }
    const sourceDir = path.dirname(sourcePath);
    const sourceExeName = path.basename(sourcePath).toLowerCase();
    if (sourceExeName !== 'pcsx2-qt.exe' && sourceExeName !== 'pcsx2.exe') {
      return { ok: false, error: 'Pick the PCSX2 executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const targetParent = path.dirname(PCSX2_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${PCSX2_RUNTIME_DIR}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(PCSX2_RUNTIME_DIR)) fs.renameSync(PCSX2_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, PCSX2_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(PCSX2_RUNTIME_DIR)) fs.rmSync(PCSX2_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, PCSX2_RUNTIME_DIR);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getPCSX2ManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'PCSX2 import finished, but SKALD could not find pcsx2-qt.exe in the managed runtime.' };
      }
      return {
        ok: true,
        runtimeDir: PCSX2_RUNTIME_DIR,
        executablePath: runtimeExe,
        status: getPCSX2RuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the PCSX2 runtime into SKALD.' };
    }
  }

  function importDuckStationRuntime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No DuckStation executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!DUCKSTATION_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `DuckStation executable not found: ${sourcePath}` };
    }
    const sourceExeName = path.basename(sourcePath).toLowerCase();
    const isDuckStationExecutable = DUCKSTATION_EXECUTABLE_NAMES.includes(sourceExeName)
      || (sourceExeName.startsWith('duckstation') && sourceExeName.endsWith('.exe') && !sourceExeName.includes('arm64') && !sourceExeName.includes('updater') && !sourceExeName.includes('uninstaller'));
    if (!isDuckStationExecutable) {
      return { ok: false, error: 'Pick the DuckStation executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const sourceDir = path.dirname(sourcePath);
      const targetParent = path.dirname(DUCKSTATION_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${DUCKSTATION_RUNTIME_DIR}-backup`;
      const backupBiosDir = path.join(backupDir, 'bios');
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(DUCKSTATION_RUNTIME_DIR)) fs.renameSync(DUCKSTATION_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, DUCKSTATION_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(DUCKSTATION_RUNTIME_DIR)) fs.rmSync(DUCKSTATION_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, DUCKSTATION_RUNTIME_DIR);
        throw copyError;
      }
      try {
        const existingManagedBios = getDuckStationBiosFiles(path.join(DUCKSTATION_RUNTIME_DIR, 'bios'));
        const backupManagedBios = getDuckStationBiosFiles(backupBiosDir);
        if (!existingManagedBios.length && backupManagedBios.length) {
          const targetBiosDir = path.join(DUCKSTATION_RUNTIME_DIR, 'bios');
          ensureDir(targetBiosDir);
          for (const sourceBiosFile of backupManagedBios) {
            const targetFile = path.join(targetBiosDir, path.basename(sourceBiosFile));
            try { fs.copyFileSync(sourceBiosFile, targetFile); } catch {}
          }
        }
      } catch {}
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      try { fs.writeFileSync(path.join(DUCKSTATION_RUNTIME_DIR, 'portable.txt'), ''); } catch {}
      const runtimeExe = getDuckStationManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'DuckStation import finished, but SKALD could not find the emulator executable in the managed runtime.' };
      }
      const syncResult = syncDuckStationPortableConfig(loadSettings());
      return {
        ok: true,
        runtimeDir: DUCKSTATION_RUNTIME_DIR,
        executablePath: runtimeExe,
        portableConfig: syncResult,
        status: getDuckStationRuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the DuckStation runtime into SKALD.' };
    }
  }

  function importDolphinRuntime(sourceExecutablePath, { channel = 'stable' } = {}) {
    const normalizedChannel = String(channel || '').trim().toLowerCase() === 'development' ? 'development' : 'stable';
    const targetRuntimeDir = getDolphinManagedRuntimeDir(normalizedChannel);
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No Dolphin executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!targetRuntimeDir) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `Dolphin executable not found: ${sourcePath}` };
    }
    const sourceExeName = path.basename(sourcePath).toLowerCase();
    const isDolphinExecutable = DOLPHIN_EXECUTABLE_NAMES.map(name => name.toLowerCase()).includes(sourceExeName)
      || (sourceExeName.startsWith('dolphin') && sourceExeName.endsWith('.exe') && !sourceExeName.includes('updater') && !sourceExeName.includes('uninstall'));
    if (!isDolphinExecutable) {
      return { ok: false, error: 'Pick the Dolphin executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const sourceDir = path.dirname(sourcePath);
      const targetParent = path.dirname(targetRuntimeDir);
      ensureDir(targetParent);
      const backupDir = `${targetRuntimeDir}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(targetRuntimeDir)) fs.renameSync(targetRuntimeDir, backupDir);
      try {
        fs.cpSync(sourceDir, targetRuntimeDir, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(targetRuntimeDir)) fs.rmSync(targetRuntimeDir, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, targetRuntimeDir);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getDolphinManagedExecutablePath(normalizedChannel);
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'Dolphin import finished, but SKALD could not find Dolphin.exe in the managed runtime.' };
      }
      const existingSettings = loadSettings();
      const syncResult = syncDolphinPortableConfig({
        ...existingSettings,
        emulators: {
          ...(existingSettings.emulators || {}),
          dolphin: {
            ...((existingSettings.emulators || {}).dolphin || {}),
            buildChannel: normalizedChannel,
          },
        },
      });
      return {
        ok: true,
        channel: normalizedChannel,
        runtimeDir: targetRuntimeDir,
        executablePath: runtimeExe,
        portableConfig: syncResult,
        status: getDolphinRuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the Dolphin runtime into SKALD.' };
    }
  }

  function importCemuRuntime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No Cemu executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!CEMU_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `Cemu executable not found: ${sourcePath}` };
    }
    const sourceExeName = path.basename(sourcePath).toLowerCase();
    const isCemuExecutable = CEMU_EXECUTABLE_NAMES.map(name => name.toLowerCase()).includes(sourceExeName)
      || (sourceExeName.startsWith('cemu') && sourceExeName.endsWith('.exe') && !sourceExeName.includes('installer') && !sourceExeName.includes('setup'));
    if (!isCemuExecutable) {
      return { ok: false, error: 'Pick the Cemu executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const sourceDir = path.dirname(sourcePath);
      const targetParent = path.dirname(CEMU_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${CEMU_RUNTIME_DIR}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(CEMU_RUNTIME_DIR)) fs.renameSync(CEMU_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, CEMU_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(CEMU_RUNTIME_DIR)) fs.rmSync(CEMU_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, CEMU_RUNTIME_DIR);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getCemuManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'Cemu import finished, but SKALD could not find the emulator executable in the managed runtime.' };
      }
      const syncResult = syncCemuPortableConfig(loadSettings());
      return {
        ok: true,
        runtimeDir: CEMU_RUNTIME_DIR,
        executablePath: runtimeExe,
        portableConfig: syncResult,
        status: getCemuRuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the Cemu runtime into SKALD.' };
    }
  }

  function importXemuRuntime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No XEMU executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!XEMU_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `XEMU executable not found: ${sourcePath}` };
    }
    if (path.basename(sourcePath).toLowerCase() !== 'xemu.exe') {
      return { ok: false, error: 'Pick xemu.exe itself so SKALD can import the full runtime folder.' };
    }
    try {
      const sourceDir = path.dirname(sourcePath);
      const targetParent = path.dirname(XEMU_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${XEMU_RUNTIME_DIR}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(XEMU_RUNTIME_DIR)) fs.renameSync(XEMU_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, XEMU_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(XEMU_RUNTIME_DIR)) fs.rmSync(XEMU_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, XEMU_RUNTIME_DIR);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getXemuManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'XEMU import finished, but SKALD could not find xemu.exe in the managed runtime.' };
      }
      const syncResult = syncXemuPortableConfig(loadSettings());
      return {
        ok: true,
        runtimeDir: XEMU_RUNTIME_DIR,
        executablePath: runtimeExe,
        portableConfig: syncResult,
        status: getXemuRuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the XEMU runtime into SKALD.' };
    }
  }

  function importRPCS3Runtime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No RPCS3 executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!RPCS3_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `RPCS3 executable not found: ${sourcePath}` };
    }
    if (path.basename(sourcePath).toLowerCase() !== 'rpcs3.exe') {
      return { ok: false, error: 'Pick the RPCS3 executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const sourceDir = path.dirname(sourcePath);
      const targetParent = path.dirname(RPCS3_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${RPCS3_RUNTIME_DIR}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(RPCS3_RUNTIME_DIR)) fs.renameSync(RPCS3_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, RPCS3_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(RPCS3_RUNTIME_DIR)) fs.rmSync(RPCS3_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, RPCS3_RUNTIME_DIR);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getRPCS3ManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'RPCS3 import finished, but SKALD could not find the emulator executable in the managed runtime.' };
      }
      return {
        ok: true,
        runtimeDir: RPCS3_RUNTIME_DIR,
        executablePath: runtimeExe,
        status: getRPCS3RuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the RPCS3 runtime into SKALD.' };
    }
  }

  function importVLCRuntime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No VLC executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!VLC_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `VLC executable not found: ${sourcePath}` };
    }
    if (path.basename(sourcePath).toLowerCase() !== 'vlc.exe') {
      return { ok: false, error: 'Pick the VLC executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const sourceDir = path.dirname(sourcePath);
      const targetParent = path.dirname(VLC_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${VLC_RUNTIME_DIR}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(VLC_RUNTIME_DIR)) fs.renameSync(VLC_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, VLC_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(VLC_RUNTIME_DIR)) fs.rmSync(VLC_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, VLC_RUNTIME_DIR);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getVLCManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'VLC import finished, but SKALD could not find vlc.exe in the managed runtime.' };
      }
      return {
        ok: true,
        runtimeDir: VLC_RUNTIME_DIR,
        executablePath: runtimeExe,
        status: getVLCRuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the VLC runtime into SKALD.' };
    }
  }

  function importXeniaRuntime(sourceExecutablePath) {
    const sourcePath = String(sourceExecutablePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'No Xenia Canary executable was selected.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'SKALD runtime import is currently implemented for Windows only.' };
    }
    if (!XENIA_RUNTIME_DIR) {
      return { ok: false, error: 'SKALD user-data runtime folder is not available.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: `Xenia Canary executable not found: ${sourcePath}` };
    }
    if (!XENIA_EXECUTABLE_NAMES.includes(path.basename(sourcePath).toLowerCase())) {
      return { ok: false, error: 'Pick the Xenia Canary executable itself so SKALD can import the full runtime folder.' };
    }
    try {
      const sourceDir = path.dirname(sourcePath);
      const targetParent = path.dirname(XENIA_RUNTIME_DIR);
      ensureDir(targetParent);
      const backupDir = `${XENIA_RUNTIME_DIR}-backup`;
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(XENIA_RUNTIME_DIR)) fs.renameSync(XENIA_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, XENIA_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(XENIA_RUNTIME_DIR)) fs.rmSync(XENIA_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, XENIA_RUNTIME_DIR);
        throw copyError;
      }
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      const runtimeExe = getXeniaManagedExecutablePath();
      if (!runtimeExe || !fs.existsSync(runtimeExe)) {
        return { ok: false, error: 'Xenia Canary import finished, but SKALD could not find the emulator executable in the managed runtime.' };
      }
      return {
        ok: true,
        runtimeDir: XENIA_RUNTIME_DIR,
        executablePath: runtimeExe,
        status: getXeniaRuntimeStatus(),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not import the Xenia Canary runtime into SKALD.' };
    }
  }

  function resolveXeniaLaunch(settings) {
    const normalized = normalizeSettings(settings);
    const runtime = getXeniaRuntimeStatus(normalized);
    if (!runtime.ok || !runtime.executablePath) {
      return { ok: false, error: 'Xenia Canary runtime is not available. Download it into SKALD or set a custom override.' };
    }
    if (!fs.existsSync(runtime.executablePath)) {
      return { ok: false, error: `Xenia Canary executable not found: ${runtime.executablePath}` };
    }
    const profileSync = syncXeniaProfileConfig(normalized);
    if (!profileSync?.ok) return profileSync;
    return {
      ok: true,
      emulatorId: 'xenia',
      runtime,
      executablePath: runtime.executablePath,
      profileSync,
    };
  }

  function resolveLibretroLaunch(settings, system) {
    const normalized = normalizeSettings(settings);
    const libretroSystem = LIBRETRO_SYSTEMS.find(entry => entry.id === system);
    const runtime = getRetroArchRuntimeStatus(normalized);
    const raPath = runtime.executablePath || '';
    const coreStatus = getLibretroCoreStatus(normalized)[system];
    const corePath = coreStatus?.resolvedPath || '';

    if (!libretroSystem) return { ok: false, error: `System "${system}" is not registered as a libretro platform.` };
    if (!raPath) return { ok: false, error: 'RetroArch runtime is not available. Bundle it with SKALD or set a custom executable path.' };
    if (!corePath) return { ok: false, error: `No RetroArch core is available for ${libretroSystem.label}. Import a runtime with cores or set one in Settings.` };
    if (!fs.existsSync(raPath)) return { ok: false, error: `RetroArch not found: ${raPath}` };
    if (!fs.existsSync(corePath)) return { ok: false, error: `Core not found: ${corePath}` };

    return {
      ok: true,
      system: { ...libretroSystem },
      emulatorId: 'retroarch',
      runtime,
      raPath,
      corePath,
      coreSource: coreStatus?.source || 'missing',
    };
  }

  function resolveRomPath(romPath) {
    let actualRomPath = romPath;
    if (fs.existsSync(romPath) && fs.statSync(romPath).isDirectory()) {
      const entries = fs.readdirSync(romPath, { withFileTypes: true });
      const romFile = entries.find(e => e.isFile() && ROM_EXTS.filter(x => x !== '.zip').some(ext => e.name.toLowerCase().endsWith(ext)))
        || entries.find(e => e.isFile() && e.name.toLowerCase().endsWith('.zip'));
      if (!romFile) return { ok: false, error: `No ROM file found in install directory: ${romPath}` };
      actualRomPath = path.join(romPath, romFile.name);
    }
    if (!fs.existsSync(actualRomPath)) return { ok: false, error: `ROM file not found: ${actualRomPath}` };
    return { ok: true, romPath: actualRomPath };
  }

  function upsertIniValue(content, section, key, value) {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const sectionHeader = `[${section}]`;
    const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyLine = `${key} = ${value}`;
    if (!normalized.includes(sectionHeader)) {
      const suffix = normalized.trim() ? '\n\n' : '';
      return `${normalized.trimEnd()}${suffix}${sectionHeader}\n${keyLine}\n`;
    }
    const sectionRegex = new RegExp(`(\\[${escapedSection}\\]\\n)([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`, 'm');
    const match = normalized.match(sectionRegex);
    if (!match) return normalized;
    const body = match[2] || '';
    const keyRegex = new RegExp(`^\\s*${escapedKey}\\s*=.*(?:\\n|$)`, 'gm');
    const bodyWithoutKey = body.replace(keyRegex, '');
    const nextBody = `${bodyWithoutKey.trimEnd()}\n${keyLine}\n`;
    return normalized.replace(sectionRegex, `$1${nextBody}`);
  }

  function rewriteIniSectionKeys(content, section, entries = []) {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const sectionHeader = `[${section}]`;
    const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`(\\[${escapedSection}\\]\\n)([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`, 'm');
    const match = normalized.match(sectionRegex);
    let body = match?.[2] || '';
    for (const entry of entries) {
      const escapedKey = String(entry?.key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!escapedKey) continue;
      const keyRegex = new RegExp(`^\\s*${escapedKey}\\s*=.*(?:\\n|$)`, 'gm');
      body = body.replace(keyRegex, '');
    }
    const prefix = entries.map(entry => `${entry.key} = ${entry.value}`).join('\n');
    const remainder = body.trim();
    const mergedBody = prefix + (remainder ? `\n\n${remainder}\n` : '\n');
    if (!match) {
      const suffix = normalized.trim() ? '\n\n' : '';
      return `${normalized.trimEnd()}${suffix}${sectionHeader}\n${mergedBody}`;
    }
    return normalized.replace(sectionRegex, `${sectionHeader}\n${mergedBody}`);
  }

  function parseIniSections(content = '') {
    const text = String(content || '').replace(/^\uFEFF/, '');
    const sections = new Map();
    let currentSection = '';
    sections.set(currentSection, new Map());
    for (const rawLine of text.split(/\r?\n/)) {
      const line = String(rawLine || '').trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;
      const sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        if (!sections.has(currentSection)) sections.set(currentSection, new Map());
        continue;
      }
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();
      if (!sections.has(currentSection)) sections.set(currentSection, new Map());
      sections.get(currentSection).set(key, value);
    }
    return sections;
  }

  function getIniStringValue(sections, section, key, fallback = '') {
    const value = sections?.get(section)?.get(key);
    return value == null ? fallback : String(value);
  }

  function getIniBoolValue(sections, section, key, fallback = false) {
    const value = getIniStringValue(sections, section, key, '');
    if (!value) return !!fallback;
    const lower = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) return true;
    if (['false', '0', 'no', 'off'].includes(lower)) return false;
    return !!fallback;
  }

  function getIniIntValue(sections, section, key, fallback = 0) {
    const value = Number.parseInt(getIniStringValue(sections, section, key, ''), 10);
    return Number.isFinite(value) ? value : fallback;
  }

  function getIniFloatValue(sections, section, key, fallback = 0) {
    const value = Number.parseFloat(getIniStringValue(sections, section, key, ''));
    return Number.isFinite(value) ? value : fallback;
  }

  function toTomlBasicString(value) {
    return `"${String(value == null ? '' : value)
      .replace(/\\/g, '/')
      .replace(/"/g, '\\"')}"`;
  }

  function upsertTomlValue(content, section, key, valueExpression) {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const sectionHeader = `[${section}]`;
    const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyLine = `${key} = ${valueExpression}`;
    if (!normalized.includes(sectionHeader)) {
      const suffix = normalized.trim() ? '\n\n' : '';
      return `${normalized.trimEnd()}${suffix}${sectionHeader}\n${keyLine}\n`;
    }
    const sectionRegex = new RegExp(`(\\[${escapedSection}\\]\\n)([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`, 'm');
    const match = normalized.match(sectionRegex);
    if (!match) return normalized;
    const body = match[2] || '';
    const keyRegex = new RegExp(`^\\s*${escapedKey}\\s*=.*(?:\\n|$)`, 'gm');
    const bodyWithoutKey = body.replace(keyRegex, '');
    const nextBody = `${bodyWithoutKey.trimEnd()}\n${keyLine}\n`;
    return normalized.replace(sectionRegex, `$1${nextBody}`);
  }

  function rewriteTomlSectionKeys(content, section, entries = []) {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const sectionHeader = `[${section}]`;
    const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`(\\[${escapedSection}\\]\\n)([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`, 'm');
    const match = normalized.match(sectionRegex);
    const body = match?.[2] || '';
    let nextBody = body;
    for (const entry of entries) {
      const escapedKey = String(entry?.key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!escapedKey) continue;
      const keyRegex = new RegExp(`^\\s*${escapedKey}\\s*=.*(?:\\n|$)`, 'gm');
      nextBody = nextBody.replace(keyRegex, '');
    }
    const prefix = entries.map(entry => `${entry.key} = ${entry.valueExpression}`).join('\n');
    const trimmedRemainder = nextBody.trim();
    const mergedBody = prefix + (trimmedRemainder ? `\n\n${trimmedRemainder}\n` : '\n');
    if (!match) {
      const suffix = normalized.trim() ? '\n\n' : '';
      return `${normalized.trimEnd()}${suffix}${sectionHeader}\n${mergedBody}`;
    }
    return normalized.replace(sectionRegex, `${sectionHeader}\n${mergedBody}`);
  }

  function removeTomlKeysGlobally(content, keys = []) {
    let next = String(content || '').replace(/\r\n/g, '\n');
    for (const key of keys) {
      const escapedKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!escapedKey) continue;
      const keyRegex = new RegExp(`^\\s*${escapedKey}\\s*=.*(?:\\n|$)`, 'gm');
      next = next.replace(keyRegex, '');
    }
    return next.replace(/\n{3,}/g, '\n\n');
  }

  function getActiveStoatProfile(settings = loadSettings()) {
    const profiles = Array.isArray(settings?.stoatProfiles)
      ? settings.stoatProfiles.filter(profile => profile && typeof profile === 'object')
      : [];
    if (!profiles.length) return null;
    const activeUserId = String(settings?.stoatSession?.user_id || '').trim();
    if (activeUserId) {
      const active = profiles.find(profile => String(profile.id || '').trim() === activeUserId);
      if (active) return active;
    }
    return profiles[0] || null;
  }

  function buildStableXeniaXuid(profile) {
    const seed = [
      String(profile?.id || '').trim(),
      String(profile?.username || '').trim(),
      String(profile?.displayName || '').trim(),
    ].filter(Boolean).join('|') || 'skald-user';
    const digest = crypto.createHash('sha256').update(seed).digest('hex').toUpperCase();
    return `E${digest.slice(0, 15)}`;
  }

  function resolveXeniaProfileLocale() {
    return {
      userCountry: 103,
      userLanguage: 1,
    };
  }

  function getXeniaProfileRootPath(contentRoot, profileXuid) {
    if (!contentRoot || !profileXuid) return '';
    return path.join(contentRoot, profileXuid, XENIA_PROFILE_TITLE_ID, XENIA_PROFILE_CONTENT_TYPE, profileXuid);
  }

  function getXeniaAccountFilePath(contentRoot, profileXuid) {
    const rootPath = getXeniaProfileRootPath(contentRoot, profileXuid);
    return rootPath ? path.join(rootPath, 'Account') : '';
  }

  function hmacSha1(key, data, outputLength = 16) {
    const digest = crypto.createHmac('sha1', key).update(data).digest();
    return digest.subarray(0, outputLength);
  }

  function rc4Crypt(key, data) {
    const state = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) state[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i += 1) {
      j = (j + state[i] + key[i % key.length]) & 0xff;
      const tmp = state[i];
      state[i] = state[j];
      state[j] = tmp;
    }
    const output = Buffer.alloc(data.length);
    let i = 0;
    j = 0;
    for (let k = 0; k < data.length; k += 1) {
      i = (i + 1) & 0xff;
      j = (j + state[i]) & 0xff;
      const tmp = state[i];
      state[i] = state[j];
      state[j] = tmp;
      const byteIndex = (state[i] + state[j]) & 0xff;
      output[k] = data[k] ^ state[byteIndex];
    }
    return output;
  }

  function writeAsciiFixed(buffer, offset, value, length) {
    const encoded = Buffer.from(String(value || ''), 'ascii');
    encoded.copy(buffer, offset, 0, Math.min(encoded.length, length));
    return offset + length;
  }

  function buildXeniaAccountFile(displayName, profileXuid) {
    const accountData = Buffer.alloc(380);
    let offset = 0;
    accountData.writeUInt32BE(0x00000000, offset); offset += 4; // ReservedFlags.None
    accountData.writeUInt32BE(0x00000000, offset); offset += 4; // LiveFlags
    const gamertagBuffer = Buffer.from(String(displayName || 'SKALD Player').slice(0, 16), 'utf16le');
    for (let i = 0; i < Math.min(gamertagBuffer.length, 32); i += 2) {
      accountData[offset + i] = gamertagBuffer[i + 1] || 0;
      accountData[offset + i + 1] = gamertagBuffer[i] || 0;
    }
    offset += 32;
    accountData.writeBigUInt64BE(BigInt(0), offset); offset += 8; // offline account stores 0 in file
    accountData.writeUInt32BE(0x00000000, offset); offset += 4; // CachedUserFlags
    offset = writeAsciiFixed(accountData, offset, '', 4); // ServiceProvider
    offset += 4; // Passcode zeros already
    offset = writeAsciiFixed(accountData, offset, '', 20); // OnlineDomain
    offset = writeAsciiFixed(accountData, offset, '', 24); // OnlineKerberosRealm
    offset += 16; // OnlineKey zeros already
    offset = writeAsciiFixed(accountData, offset, '', 114);
    offset = writeAsciiFixed(accountData, offset, '', 32);
    offset = writeAsciiFixed(accountData, offset, '', 114);

    const confounder = crypto.randomBytes(8);
    const payload = Buffer.concat([confounder, accountData]);
    const hmac = hmacSha1(XENIA_ACCOUNT_RETAIL_KEY, payload, 16);
    const rc4Key = hmacSha1(XENIA_ACCOUNT_RETAIL_KEY, hmac, 16);
    const encryptedPayload = rc4Crypt(rc4Key, payload);
    return Buffer.concat([hmac, encryptedPayload]);
  }

  function normalizeXeniaGameProfileValue(value) {
    const normalized = String(value === true ? 'on' : value === false ? 'off' : value || '').trim().toLowerCase();
    return normalized === 'on' || normalized === 'off' ? normalized : 'inherit';
  }

  function normalizeXeniaGameProfile(profile = {}) {
    const source = profile && typeof profile === 'object' ? profile : {};
    return {
      fullscreen: normalizeXeniaGameProfileValue(source.fullscreen),
      presentLetterbox: normalizeXeniaGameProfileValue(source.presentLetterbox),
    };
  }

  function buildXeniaGameProfileRef({ identifier = null, title = null, romPath = null, sourcePath = null } = {}) {
    const cleanIdentifier = String(identifier || '').trim();
    const cleanTitle = String(title || '').trim();
    const cleanRomPath = String(romPath || '').trim();
    const cleanSourcePath = String(sourcePath || '').trim();
    let key = '';
    if (cleanIdentifier) {
      key = `id:${sanitizeCacheName(cleanIdentifier).toLowerCase()}`;
    } else {
      const seed = cleanSourcePath || cleanRomPath || cleanTitle || 'xenia-game';
      const digest = crypto.createHash('sha1').update(seed.toLowerCase()).digest('hex').slice(0, 16);
      key = `rom:${digest}`;
    }
    return {
      key,
      identifier: cleanIdentifier || '',
      title: cleanTitle || '',
      romPath: cleanRomPath || '',
      sourcePath: cleanSourcePath || cleanRomPath || '',
      label: cleanTitle || cleanIdentifier || path.basename(cleanSourcePath || cleanRomPath || '', path.extname(cleanSourcePath || cleanRomPath || '')) || 'Xbox 360 Game',
    };
  }

  function getStoredXeniaGameProfiles(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    return normalized?.emulators?.xenia?.gameProfiles && typeof normalized.emulators.xenia.gameProfiles === 'object'
      ? normalized.emulators.xenia.gameProfiles
      : {};
  }

  function getStoredXeniaGuideSettings(settings = loadSettings()) {
    const normalized = normalizeSettings(settings);
    const raw = normalized?.emulators?.xenia?.guideSettings && typeof normalized.emulators.xenia.guideSettings === 'object'
      ? normalized.emulators.xenia.guideSettings
      : {};
    return {
      fullscreen: raw.fullscreen !== false,
      presentLetterbox: raw.presentLetterbox === true,
      hidMode: String(raw.hidMode || '').trim().toLowerCase() === 'any' ? 'any' : 'xinput',
    };
  }

  function getXeniaGuideSettingsStatus(settings = loadSettings()) {
    const guideSettings = getStoredXeniaGuideSettings(settings);
    return {
      ok: true,
      ...guideSettings,
    };
  }

  function updateXeniaGuideSettings(settings = loadSettings(), updates = {}) {
    const normalized = normalizeSettings(settings);
    const current = getStoredXeniaGuideSettings(normalized);
    const nextGuideSettings = {
      fullscreen: updates?.fullscreen == null ? current.fullscreen : !!updates.fullscreen,
      presentLetterbox: updates?.presentLetterbox == null ? current.presentLetterbox : !!updates.presentLetterbox,
      hidMode: String(updates?.hidMode || current.hidMode || '').trim().toLowerCase() === 'any' ? 'any' : 'xinput',
    };
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        xenia: {
          ...((normalized.emulators || {}).xenia || {}),
          guideSettings: nextGuideSettings,
        },
      },
    });
    return {
      ok: true,
      settings: next,
      status: getXeniaGuideSettingsStatus(next),
    };
  }

  function applyXeniaGameProfileConfigOverrides(configPath, profile = {}) {
    if (!configPath || !fs.existsSync(configPath)) return { ok: false, skipped: true, reason: 'config unavailable' };
    const normalizedProfile = normalizeXeniaGameProfile(profile);
    const displayKeys = [];
    if (normalizedProfile.fullscreen !== 'inherit') {
      displayKeys.push({ key: 'fullscreen', valueExpression: normalizedProfile.fullscreen === 'on' ? 'true' : 'false' });
    }
    if (normalizedProfile.presentLetterbox !== 'inherit') {
      displayKeys.push({ key: 'present_letterbox', valueExpression: normalizedProfile.presentLetterbox === 'on' ? 'true' : 'false' });
    }
    if (!displayKeys.length) return { ok: true, skipped: true, reason: 'no overrides' };
    try {
      let tomlContent = fs.readFileSync(configPath, 'utf8');
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'Display', displayKeys);
      fs.writeFileSync(configPath, tomlContent, 'utf8');
      return { ok: true, applied: true, profile: normalizedProfile };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not apply Xenia game profile overrides.' };
    }
  }

  function getActiveXeniaSessionProfileRef() {
    const activeSession = Array.from(activeSessions.values())
      .filter(session => session?.emulatorId === 'xenia')
      .sort((a, b) => Number(b?.startedAt || 0) - Number(a?.startedAt || 0))[0];
    if (!activeSession) return null;
    return buildXeniaGameProfileRef({
      identifier: activeSession.identifier,
      title: activeSession.title,
      romPath: activeSession.romPath,
      sourcePath: activeSession.sourcePath,
    });
  }

  function getXeniaGameProfileStatus(settings = loadSettings(), options = {}) {
    const normalized = normalizeSettings(settings);
    const requestedTarget = options?.target && typeof options.target === 'object'
      ? buildXeniaGameProfileRef(options.target)
      : null;
    const activeTarget = getActiveXeniaSessionProfileRef();
    const storedLastTarget = normalized?.emulators?.xenia?.lastGameProfileRef
      ? buildXeniaGameProfileRef(normalized.emulators.xenia.lastGameProfileRef)
      : null;
    const target = requestedTarget || activeTarget || storedLastTarget || null;
    const profiles = getStoredXeniaGameProfiles(normalized);
    const profileKey = target?.key || '';
    const profile = normalizeXeniaGameProfile(profileKey ? profiles[profileKey] : {});
    return {
      ok: true,
      target,
      profileKey,
      profile,
      hasProfile: profileKey ? !!profiles[profileKey] : false,
      hasActiveSession: !!activeTarget,
      lastTarget: storedLastTarget,
      activeTarget,
    };
  }

  function updateXeniaGameProfileSettings(settings = loadSettings(), { target = null, profile = null, clear = false } = {}) {
    const normalized = normalizeSettings(settings);
    const status = getXeniaGameProfileStatus(normalized, { target });
    if (!status?.target?.key) {
      return { ok: false, error: 'No Xenia game target is available yet. Launch an Xbox 360 game first or keep one active while editing profiles.' };
    }
    const next = normalizeSettings({
      ...normalized,
      emulators: {
        ...(normalized.emulators || {}),
        xenia: {
          ...((normalized.emulators || {}).xenia || {}),
          gameProfiles: { ...getStoredXeniaGameProfiles(normalized) },
          lastGameProfileRef: { ...status.target },
        },
      },
    });
    if (clear) {
      delete next.emulators.xenia.gameProfiles[status.target.key];
    } else {
      next.emulators.xenia.gameProfiles[status.target.key] = normalizeXeniaGameProfile(profile || status.profile || {});
    }
    return {
      ok: true,
      settings: next,
      status: getXeniaGameProfileStatus(next, { target: status.target }),
    };
  }

  function syncXeniaProfileConfig(settings = loadSettings()) {
    const runtime = getXeniaRuntimeStatus(settings);
    if (!runtime?.ok || !runtime.executablePath) {
      return { ok: true, skipped: true, reason: 'runtime unavailable' };
    }
    const activeProfile = getActiveStoatProfile(settings);
    if (!activeProfile) {
      return { ok: true, skipped: true, reason: 'no stoat profile' };
    }

    const runtimeRoot = path.dirname(runtime.executablePath);
    const configPath = path.join(runtimeRoot, 'xenia-canary.config.toml');
    const contentRoot = path.join(runtimeRoot, 'content');
    const storageRoot = runtimeRoot;
    const profileXuid = buildStableXeniaXuid(activeProfile);
    const locale = resolveXeniaProfileLocale(settings);
    const guideSettings = getStoredXeniaGuideSettings(settings);
    const profileRootPath = getXeniaProfileRootPath(contentRoot, profileXuid);
    const accountFilePath = getXeniaAccountFilePath(contentRoot, profileXuid);

    try {
      ensureDir(runtimeRoot);
      ensureDir(contentRoot);
      if (profileRootPath) ensureDir(profileRootPath);
      if (accountFilePath && !fs.existsSync(accountFilePath)) {
        fs.writeFileSync(accountFilePath, buildXeniaAccountFile(
          String(activeProfile.displayName || activeProfile.username || 'SKALD Player'),
          profileXuid,
        ));
      }
      if (XENIA_PROFILE_METADATA_DIR) ensureDir(XENIA_PROFILE_METADATA_DIR);

      let tomlContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
      tomlContent = removeTomlKeysGlobally(tomlContent, [
        'logged_profile_slot_0_xuid',
        'logged_profile_slot_1_xuid',
        'logged_profile_slot_2_xuid',
        'logged_profile_slot_3_xuid',
        'content_root',
        'storage_root',
        'storage_selection_dialog',
        'user_country',
        'user_language',
        'fullscreen',
        'present_letterbox',
        'guide_button',
        'hid',
        'keyboard_mode',
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'Profiles', [
        { key: 'logged_profile_slot_0_xuid', valueExpression: toTomlBasicString(profileXuid) },
        { key: 'logged_profile_slot_1_xuid', valueExpression: toTomlBasicString('') },
        { key: 'logged_profile_slot_2_xuid', valueExpression: toTomlBasicString('') },
        { key: 'logged_profile_slot_3_xuid', valueExpression: toTomlBasicString('') },
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'Storage', [
        { key: 'content_root', valueExpression: toTomlBasicString(contentRoot) },
        { key: 'storage_root', valueExpression: toTomlBasicString(storageRoot) },
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'Display', [
        { key: 'fullscreen', valueExpression: guideSettings.fullscreen ? 'true' : 'false' },
        { key: 'present_letterbox', valueExpression: guideSettings.presentLetterbox ? 'true' : 'false' },
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'HID', [
        { key: 'guide_button', valueExpression: 'false' },
        { key: 'hid', valueExpression: toTomlBasicString(guideSettings.hidMode) },
        { key: 'keyboard_mode', valueExpression: '0' },
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'UI', [
        { key: 'storage_selection_dialog', valueExpression: 'false' },
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'XConfig', [
        { key: 'user_country', valueExpression: String(locale.userCountry) },
        { key: 'user_language', valueExpression: String(locale.userLanguage) },
      ]);
      fs.writeFileSync(configPath, tomlContent, 'utf8');

      if (XENIA_PROFILE_METADATA_DIR) {
        const metadataPath = path.join(XENIA_PROFILE_METADATA_DIR, `${profileXuid}.json`);
        const metadata = {
          xuid: profileXuid,
          stoatUserId: String(activeProfile.id || ''),
          username: String(activeProfile.username || ''),
          displayName: String(activeProfile.displayName || activeProfile.username || 'SKALD Player'),
          avatar: String(activeProfile.avatar || ''),
          syncedAt: Date.now(),
          contentRoot,
          storageRoot,
        profileRootPath,
        accountFilePath,
        locale,
        guideSettings,
      };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      }

      return {
        ok: true,
        runtimeRoot,
        configPath,
        contentRoot,
        storageRoot,
        profileRootPath,
        accountFilePath,
        metadataPath: XENIA_PROFILE_METADATA_DIR ? path.join(XENIA_PROFILE_METADATA_DIR, `${profileXuid}.json`) : '',
        profileXuid,
        displayName: String(activeProfile.displayName || activeProfile.username || 'SKALD Player'),
        stoatUserId: String(activeProfile.id || ''),
        locale,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not prepare the Xenia Canary profile config.' };
    }
  }

  function getXeniaProfileStatus(settings = loadSettings()) {
    const runtime = getXeniaRuntimeStatus(settings);
    const activeProfile = getActiveStoatProfile(settings);
    const runtimeRoot = runtime?.executablePath ? path.dirname(runtime.executablePath) : (XENIA_RUNTIME_DIR || '');
    const configPath = runtimeRoot ? path.join(runtimeRoot, 'xenia-canary.config.toml') : '';
    const contentRoot = runtimeRoot ? path.join(runtimeRoot, 'content') : '';
    const profileXuid = activeProfile ? buildStableXeniaXuid(activeProfile) : '';
    const profileRootPath = getXeniaProfileRootPath(contentRoot, profileXuid);
    const accountFilePath = getXeniaAccountFilePath(contentRoot, profileXuid);
    const metadataPath = profileXuid && XENIA_PROFILE_METADATA_DIR
      ? path.join(XENIA_PROFILE_METADATA_DIR, `${profileXuid}.json`)
      : '';
    let metadata = null;
    if (metadataPath && fs.existsSync(metadataPath)) {
      try { metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')); } catch {}
    }
    const contentEntries = contentRoot && fs.existsSync(contentRoot)
      ? fs.readdirSync(contentRoot, { withFileTypes: true }).map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }))
      : [];
    return {
      ok: true,
      runtimeAvailable: !!runtime?.ok,
      configPath,
      contentRoot,
      contentExists: !!(contentRoot && fs.existsSync(contentRoot)),
      contentEntries,
      activeStoatProfile: activeProfile ? {
        id: String(activeProfile.id || ''),
        username: String(activeProfile.username || ''),
        displayName: String(activeProfile.displayName || activeProfile.username || ''),
        avatar: String(activeProfile.avatar || ''),
      } : null,
      profileXuid,
      profileRootPath,
      profileRootExists: !!(profileRootPath && fs.existsSync(profileRootPath)),
      accountFilePath,
      accountFileExists: !!(accountFilePath && fs.existsSync(accountFilePath)),
      metadataPath,
      metadata,
    };
  }

  function syncPCSX2PortableConfig(settings = loadSettings()) {
    const runtime = getPCSX2RuntimeStatus(settings);
    if (!runtime?.ok || !runtime.executablePath) {
      return { ok: true, skipped: true, reason: 'runtime unavailable' };
    }
    const runtimeRoot = path.dirname(runtime.executablePath);
    const inisDir = path.join(runtimeRoot, 'inis');
    const portableIniPath = path.join(runtimeRoot, 'portable.ini');
    const pcsx2IniPath = path.join(inisDir, 'PCSX2.ini');
    try {
      if (!fs.existsSync(runtimeRoot)) return { ok: false, error: `PCSX2 runtime directory not found: ${runtimeRoot}` };
      const portableContent = fs.existsSync(portableIniPath) ? fs.readFileSync(portableIniPath, 'utf8') : null;
      if (portableContent !== '') {
        fs.writeFileSync(portableIniPath, '', 'utf8');
      }
      if (!fs.existsSync(inisDir)) fs.mkdirSync(inisDir, { recursive: true });
      let iniContent = fs.existsSync(pcsx2IniPath) ? fs.readFileSync(pcsx2IniPath, 'utf8') : '';
      const countIniKey = (content, section, key) => {
        const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sectionMatch = String(content || '').replace(/\r\n/g, '\n').match(new RegExp(`\\[${escapedSection}\\]\\n([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`, 'm'));
        if (!sectionMatch) return 0;
        return (sectionMatch[1].match(new RegExp(`^\\s*${escapedKey}\\s*=`, 'gmi')) || []).length;
      };
      const needsFreshConfig = !/^\s*SettingsVersion\s*=/mi.test(iniContent)
        || countIniKey(iniContent, 'Folders', 'Bios') > 1
        || countIniKey(iniContent, 'UI', 'SetupWizardIncomplete') > 1;
      if (needsFreshConfig) {
        let backupPath = '';
        try {
          if (fs.existsSync(pcsx2IniPath)) {
            backupPath = `${pcsx2IniPath}.skald-backup`;
            try { if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true }); } catch {}
            fs.renameSync(pcsx2IniPath, backupPath);
          }
          execFileSync(runtime.executablePath, ['-testconfig'], {
            cwd: runtimeRoot,
            windowsHide: true,
            stdio: 'ignore',
            timeout: 20000,
          });
          iniContent = fs.existsSync(pcsx2IniPath) ? fs.readFileSync(pcsx2IniPath, 'utf8') : iniContent;
        } catch {
          if (!fs.existsSync(pcsx2IniPath) && backupPath && fs.existsSync(backupPath)) {
            try { fs.renameSync(backupPath, pcsx2IniPath); } catch {}
          }
        }
      }
      const audioSettings = getPCSX2AudioSettingsStatus(settings);
      const speedSettings = getPCSX2SpeedSettingsStatus(settings);
      const displaySettings = getPCSX2DisplaySettingsStatus(settings);
      if (runtime.biosPath) {
        iniContent = rewriteIniSectionKeys(iniContent, 'Folders', [{ key: 'Bios', value: runtime.biosPath }]);
      }
      iniContent = rewriteIniSectionKeys(iniContent, 'UI', [{ key: 'SetupWizardIncomplete', value: 'false' }]);
      iniContent = rewriteIniSectionKeys(iniContent, 'UI', [{ key: 'InhibitScreensaver', value: speedSettings.inhibitScreensaver ? 'true' : 'false' }]);
      iniContent = rewriteIniSectionKeys(iniContent, 'EmuCore', [{ key: 'EnableFastBootFastForward', value: speedSettings.enableFastBootFastForward ? 'true' : 'false' }]);
      iniContent = rewriteIniSectionKeys(iniContent, 'EmuCore/GS', [
        { key: 'SyncToHostRefreshRate', value: speedSettings.syncToHostRefreshRate ? 'true' : 'false' },
        { key: 'UseVSyncForTiming', value: speedSettings.useVSyncForTiming ? 'true' : 'false' },
        { key: 'Renderer', value: String(displaySettings.renderer || '') },
        { key: 'AspectRatio', value: String(displaySettings.aspectRatio || 'Auto Standard') },
        { key: 'FMVAspectRatioSwitch', value: String(displaySettings.fmvAspectRatioSwitch || 'Off') },
        { key: 'UpscaleMultiplier', value: String(Math.max(1, Number(displaySettings.upscaleMultiplier ?? 2))) },
        { key: 'MaxAnisotropy', value: String(Math.max(0, Number(displaySettings.maxAnisotropy ?? 0))) },
        { key: 'IntegerScaling', value: displaySettings.integerScaling ? 'true' : 'false' },
        { key: 'BilinearUpscale', value: displaySettings.bilinearUpscale ? 'true' : 'false' },
        { key: 'FXAA', value: displaySettings.fxaa ? 'true' : 'false' },
        { key: 'ShadeBoost', value: displaySettings.shadeBoost ? 'true' : 'false' },
        { key: 'Mipmapping', value: String(displaySettings.mipmapping || 'Automatic') },
        { key: 'TextureFiltering', value: String(displaySettings.textureFiltering || 'Bilinear (PS2)') },
        { key: 'TriFilter', value: String(displaySettings.trilinearFiltering || 'Automatic') },
        { key: 'InterlaceMode', value: String(displaySettings.interlaceMode || 'Automatic') },
        { key: 'TVShader', value: String(displaySettings.tvShader || 'None') },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'Framerate', [
        { key: 'NominalScalar', value: String(Number(speedSettings.nominalScalar ?? 1.0)) },
        { key: 'TurboScalar', value: String(Number(speedSettings.turboScalar ?? 2.0)) },
        { key: 'SlomoScalar', value: String(Number(speedSettings.slomoScalar ?? 0.5)) },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'SPU2/Output', [
        { key: 'Backend', value: String(audioSettings.backend || 'Cubeb') },
        { key: 'DriverName', value: String(audioSettings.driverName || '') },
        { key: 'DeviceName', value: String(audioSettings.deviceName || '') },
        { key: 'SyncMode', value: String(audioSettings.syncMode || 'TimeStretch') },
        { key: 'ExpansionMode', value: String(audioSettings.expansionMode || 'Disabled') },
        { key: 'StandardVolume', value: String(Math.max(0, Math.min(100, Number(audioSettings.standardVolume ?? 100)))) },
        { key: 'FastForwardVolume', value: String(Math.max(0, Math.min(100, Number(audioSettings.fastForwardVolume ?? 100)))) },
        { key: 'OutputMuted', value: audioSettings.outputMuted ? 'true' : 'false' },
        { key: 'OutputLatencyMinimal', value: audioSettings.outputLatencyMinimal ? 'true' : 'false' },
        { key: 'BufferMS', value: String(Math.max(10, Number(audioSettings.bufferMs ?? 50))) },
        { key: 'OutputLatencyMS', value: String(Math.max(10, Number(audioSettings.outputLatencyMs ?? 20))) },
      ]);
      iniContent = applyPCSX2StandardControllerConfig(iniContent);
      fs.writeFileSync(pcsx2IniPath, iniContent || '[Folders]\n', 'utf8');
      return {
        ok: true,
        runtimeRoot,
        inisDir,
        portableIniPath,
        pcsx2IniPath,
        biosPath: runtime.biosPath || '',
        biosAvailable: !!runtime.biosAvailable,
        controllerPreset: 'sdl-standard',
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not prepare the PCSX2 portable config.' };
    }
  }

  function applyPCSX2StandardControllerConfig(iniContent) {
    let content = String(iniContent || '');
    const values = [
      ['InputSources', 'Keyboard', 'true'],
      ['InputSources', 'Mouse', 'true'],
      ['InputSources', 'SDL', 'true'],
      ['InputSources', 'DInput', 'false'],
      ['InputSources', 'XInput', 'false'],
      ['InputSources', 'SDLControllerEnhancedMode', 'false'],
      ['InputSources', 'SDLPS5PlayerLED', 'false'],
      ['Pad', 'MultitapPort1', 'false'],
      ['Pad', 'MultitapPort2', 'false'],
      ['Pad1', 'Type', 'DualShock2'],
      ['Pad1', 'InvertL', '0'],
      ['Pad1', 'InvertR', '0'],
      ['Pad1', 'Deadzone', '0'],
      ['Pad1', 'AnalogDeadzone', '0'],
      ['Pad1', 'ButtonDeadzone', '0'],
      ['Pad1', 'PressureModifier', '0.5'],
      ['Pad1', 'Up', 'SDL-0/DPadUp'],
      ['Pad1', 'Right', 'SDL-0/DPadRight'],
      ['Pad1', 'Down', 'SDL-0/DPadDown'],
      ['Pad1', 'Left', 'SDL-0/DPadLeft'],
      ['Pad1', 'Triangle', 'SDL-0/Y'],
      ['Pad1', 'Circle', 'SDL-0/B'],
      ['Pad1', 'Cross', 'SDL-0/A'],
      ['Pad1', 'Square', 'SDL-0/X'],
      ['Pad1', 'Select', 'SDL-0/Back'],
      ['Pad1', 'Start', 'SDL-0/Start'],
      ['Pad1', 'L1', 'SDL-0/LeftShoulder'],
      ['Pad1', 'R1', 'SDL-0/RightShoulder'],
      ['Pad1', 'L2', 'SDL-0/+LeftTrigger'],
      ['Pad1', 'R2', 'SDL-0/+RightTrigger'],
      ['Pad1', 'L3', 'SDL-0/LeftStick'],
      ['Pad1', 'R3', 'SDL-0/RightStick'],
      ['Pad1', 'LLeft', 'SDL-0/-LeftX'],
      ['Pad1', 'LRight', 'SDL-0/+LeftX'],
      ['Pad1', 'LDown', 'SDL-0/+LeftY'],
      ['Pad1', 'LUp', 'SDL-0/-LeftY'],
      ['Pad1', 'RLeft', 'SDL-0/-RightX'],
      ['Pad1', 'RRight', 'SDL-0/+RightX'],
      ['Pad1', 'RDown', 'SDL-0/+RightY'],
      ['Pad1', 'RUp', 'SDL-0/-RightY'],
      ['Pad1', 'LargeMotor', 'SDL-0/LargeMotor'],
      ['Pad1', 'SmallMotor', 'SDL-0/SmallMotor'],
    ];
    for (const [section, key, value] of values) {
      content = upsertIniValue(content, section, key, value);
    }
    for (let pad = 2; pad <= 8; pad += 1) {
      content = rewriteIniSectionKeys(content, `Pad${pad}`, [{ key: 'Type', value: 'None' }]);
    }
    return content;
  }

  function getDuckStationBiosFiles(dirPath) {
    const root = String(dirPath || '').trim();
    if (!root || !fs.existsSync(root)) return [];
    try {
      const stat = fs.statSync(root);
      if (!stat.isDirectory()) return [];
      return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => {
          const lower = String(name || '').toLowerCase();
          return (lower.endsWith('.bin') || lower.endsWith('.rom')) && !lower.includes('memory') && !lower.includes('card');
        })
        .map(name => path.join(root, name));
    } catch {
      return [];
    }
  }

  function applyDuckStationStandardControllerConfig(iniContent) {
    let content = String(iniContent || '');
    const values = [
      ['ControllerPorts', 'UseProfileHotkeyBindings', 'false'],
      ['InputSources', 'DInput', 'false'],
      ['InputSources', 'RawInput', 'false'],
      ['InputSources', 'SDL', 'true'],
      ['InputSources', 'SDLControllerEnhancedMode', 'false'],
      ['InputSources', 'SDLJoystickGameInput', 'true'],
      ['InputSources', 'SDLJoystickRawInput', 'true'],
      ['InputSources', 'SDLJoystickXboxHIDAPI', 'true'],
      ['InputSources', 'XInput', 'false'],
      ['Pad1', 'Type', 'AnalogController'],
      ['Pad1', 'Up', 'SDL-0/DPadUp'],
      ['Pad1', 'Right', 'SDL-0/DPadRight'],
      ['Pad1', 'Down', 'SDL-0/DPadDown'],
      ['Pad1', 'Left', 'SDL-0/DPadLeft'],
      ['Pad1', 'Select', 'SDL-0/Back'],
      ['Pad1', 'Start', 'SDL-0/Start'],
      ['Pad1', 'L1', 'SDL-0/LeftShoulder'],
      ['Pad1', 'R1', 'SDL-0/RightShoulder'],
      ['Pad1', 'L2', 'SDL-0/+LeftTrigger'],
      ['Pad1', 'R2', 'SDL-0/+RightTrigger'],
      ['Pad1', 'L3', 'SDL-0/LeftStick'],
      ['Pad1', 'R3', 'SDL-0/RightStick'],
      ['Pad1', 'LLeft', 'SDL-0/-LeftX'],
      ['Pad1', 'LRight', 'SDL-0/+LeftX'],
      ['Pad1', 'LDown', 'SDL-0/+LeftY'],
      ['Pad1', 'LUp', 'SDL-0/-LeftY'],
      ['Pad1', 'RLeft', 'SDL-0/-RightX'],
      ['Pad1', 'RRight', 'SDL-0/+RightX'],
      ['Pad1', 'RDown', 'SDL-0/+RightY'],
      ['Pad1', 'RUp', 'SDL-0/-RightY'],
      ['Pad1', 'Triangle', 'SDL-0/Y'],
      ['Pad1', 'Square', 'SDL-0/X'],
      ['Pad1', 'Circle', 'SDL-0/B'],
      ['Pad1', 'Cross', 'SDL-0/A'],
      ['Pad1', 'LargeMotor', 'SDL-0/LargeMotor'],
      ['Pad1', 'SmallMotor', 'SDL-0/SmallMotor'],
    ];
    for (const [section, key, value] of values) {
      content = upsertIniValue(content, section, key, value);
    }
    for (let pad = 2; pad <= 8; pad += 1) {
      content = upsertIniValue(content, `Pad${pad}`, 'Type', 'None');
    }
    return content;
  }

  function syncDuckStationPortableConfig(settings = loadSettings()) {
    const runtime = getDuckStationRuntimeStatus(settings);
    if (!runtime?.ok || !runtime.executablePath) {
      return { ok: true, skipped: true, reason: 'runtime unavailable' };
    }
    const runtimeRoot = path.dirname(runtime.executablePath);
    const biosDir = path.join(runtimeRoot, 'bios');
    const settingsIniPath = path.join(runtimeRoot, 'settings.ini');
    try {
      fs.writeFileSync(path.join(runtimeRoot, 'portable.txt'), '');
      ensureDir(biosDir);
      const sourceFiles = getDuckStationBiosFiles(runtime.biosPath);
      let copied = 0;
      for (const sourceFile of sourceFiles) {
        const targetFile = path.join(biosDir, path.basename(sourceFile));
        if (path.resolve(sourceFile).toLowerCase() === path.resolve(targetFile).toLowerCase()) continue;
        try {
          fs.copyFileSync(sourceFile, targetFile);
          copied += 1;
        } catch {}
      }
      let iniContent = fs.existsSync(settingsIniPath) ? fs.readFileSync(settingsIniPath, 'utf8') : '';
      const guideSettings = getStoredDuckStationGuideSettings(settings);
      const displaySettings = getDuckStationDisplaySettingsStatus(settings);
      const audioSettings = getDuckStationAudioSettingsStatus(settings);
      const speedSettings = getDuckStationSpeedSettingsStatus(settings);
      iniContent = rewriteIniSectionKeys(iniContent, 'Main', [
        { key: 'SetupWizardIncomplete', value: 'false' },
        { key: 'StartFullscreen', value: guideSettings.startFullscreen ? 'true' : 'false' },
        { key: 'HideCursorInFullscreen', value: guideSettings.hideCursorInFullscreen ? 'true' : 'false' },
        { key: 'PauseOnFocusLost', value: guideSettings.pauseOnFocusLost ? 'true' : 'false' },
        { key: 'EnableCheats', value: guideSettings.enableCheats ? 'true' : 'false' },
        { key: 'EmulationSpeed', value: String(Number(speedSettings.emulationSpeed ?? 1.0)) },
        { key: 'FastForwardSpeed', value: String(Number(speedSettings.fastForwardSpeed ?? 0.0)) },
        { key: 'TurboSpeed', value: String(Number(speedSettings.turboSpeed ?? 0.0)) },
        { key: 'SyncToHostRefreshRate', value: speedSettings.syncToHostRefreshRate ? 'true' : 'false' },
        { key: 'InhibitScreensaver', value: speedSettings.inhibitScreensaver ? 'true' : 'false' },
        { key: 'DisableBackgroundInput', value: speedSettings.disableBackgroundInput ? 'true' : 'false' },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'GPU', [
        { key: 'Renderer', value: displaySettings.renderer },
        { key: 'Adapter', value: displaySettings.adapter || '' },
        { key: 'ResolutionScale', value: String(Math.max(0, Number(displaySettings.resolutionScale || 0))) },
        { key: 'Multisamples', value: String(Math.max(1, Number(displaySettings.multisamples || 1))) },
        { key: 'DownsampleMode', value: displaySettings.downsampleMode },
        { key: 'TextureFilter', value: displaySettings.textureFilter },
        { key: 'SpriteTextureFilter', value: displaySettings.spriteTextureFilter },
        { key: 'DitheringMode', value: displaySettings.ditheringMode },
        { key: 'DeinterlacingMode', value: displaySettings.deinterlacingMode },
        { key: 'LineDetectMode', value: displaySettings.lineDetectMode },
        { key: 'WidescreenHack', value: displaySettings.widescreenHack ? 'true' : 'false' },
        { key: 'EnableModulationCrop', value: displaySettings.enableModulationCrop ? 'true' : 'false' },
        { key: 'EnableTextureCache', value: displaySettings.enableTextureCache ? 'true' : 'false' },
        { key: 'ChromaSmoothing24Bit', value: displaySettings.chromaSmoothing24Bit ? 'true' : 'false' },
        { key: 'PGXPEnable', value: displaySettings.pgxpEnable ? 'true' : 'false' },
        { key: 'PGXPCulling', value: displaySettings.pgxpCulling ? 'true' : 'false' },
        { key: 'PGXPTextureCorrection', value: displaySettings.pgxpTextureCorrection ? 'true' : 'false' },
        { key: 'PGXPColorCorrection', value: displaySettings.pgxpColorCorrection ? 'true' : 'false' },
        { key: 'PGXPVertexCache', value: displaySettings.pgxpVertexCache ? 'true' : 'false' },
        { key: 'PGXPCPU', value: displaySettings.pgxpCpu ? 'true' : 'false' },
        { key: 'PGXPPreserveProjFP', value: displaySettings.pgxpPreserveProjFP ? 'true' : 'false' },
        { key: 'PGXPTolerance', value: String(Number(displaySettings.pgxpTolerance ?? -1)) },
        { key: 'PGXPDepthBuffer', value: displaySettings.pgxpDepthBuffer ? 'true' : 'false' },
        { key: 'PGXPDisableOn2DPolygons', value: displaySettings.pgxpDisableOn2DPolygons ? 'true' : 'false' },
        { key: 'PGXPTransparentDepthTest', value: displaySettings.pgxpTransparentDepthTest ? 'true' : 'false' },
        { key: 'PGXPDepthThreshold', value: String(Number(displaySettings.pgxpDepthThreshold ?? 4096)) },
        { key: 'UseThread', value: displaySettings.useThread ? 'true' : 'false' },
        { key: 'UseSoftwareRendererForReadbacks', value: displaySettings.useSoftwareRendererForReadbacks ? 'true' : 'false' },
        { key: 'ScaledInterlacing', value: displaySettings.scaledInterlacing ? 'true' : 'false' },
        { key: 'ForceRoundTextureCoordinates', value: displaySettings.forceRoundTextureCoordinates ? 'true' : 'false' },
        { key: 'MaxQueuedFrames', value: String(Math.max(0, Number(displaySettings.maxQueuedFrames || 0))) },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'Display', [
        { key: 'AspectRatio', value: displaySettings.aspectRatio },
        { key: 'CropMode', value: displaySettings.cropMode },
        { key: 'Force4_3For24Bit', value: displaySettings.force4_3For24Bit ? 'true' : 'false' },
        { key: 'ActiveStartOffset', value: String(Number(displaySettings.activeStartOffset || 0)) },
        { key: 'ActiveEndOffset', value: String(Number(displaySettings.activeEndOffset || 0)) },
        { key: 'LineStartOffset', value: String(Number(displaySettings.lineStartOffset || 0)) },
        { key: 'LineEndOffset', value: String(Number(displaySettings.lineEndOffset || 0)) },
        { key: 'FineCropMode', value: displaySettings.fineCropMode },
        { key: 'FineCropLeft', value: String(Number(displaySettings.fineCropLeft || 0)) },
        { key: 'FineCropTop', value: String(Number(displaySettings.fineCropTop || 0)) },
        { key: 'FineCropRight', value: String(Number(displaySettings.fineCropRight || 0)) },
        { key: 'FineCropBottom', value: String(Number(displaySettings.fineCropBottom || 0)) },
        { key: 'Alignment', value: displaySettings.alignment },
        { key: 'Rotation', value: displaySettings.rotation },
        { key: 'Scaling', value: displaySettings.scaling },
        { key: 'Scaling24Bit', value: displaySettings.scaling24Bit },
        { key: 'ExclusiveFullscreenControl', value: displaySettings.exclusiveFullscreenControl },
        { key: 'OptimalFramePacing', value: displaySettings.optimalFramePacing ? 'true' : 'false' },
        { key: 'PreFrameSleep', value: displaySettings.preFrameSleep ? 'true' : 'false' },
        { key: 'SkipPresentingDuplicateFrames', value: displaySettings.skipPresentingDuplicateFrames ? 'true' : 'false' },
        { key: 'VSync', value: displaySettings.vsync ? 'true' : 'false' },
        { key: 'DisableMailboxPresentation', value: displaySettings.disableMailboxPresentation ? 'true' : 'false' },
        { key: 'AutoResizeWindow', value: displaySettings.autoResizeWindow ? 'true' : 'false' },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'BIOS', [
        { key: 'SearchDirectory', value: 'bios' },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'Audio', [
        { key: 'Backend', value: String(audioSettings.backend || 'Cubeb') },
        { key: 'Driver', value: String(audioSettings.driver || '') },
        { key: 'OutputDevice', value: String(audioSettings.outputDevice || '') },
        { key: 'OutputVolume', value: String(Math.max(0, Math.min(100, Number(audioSettings.outputVolume ?? 100)))) },
        { key: 'FastForwardVolume', value: String(Math.max(0, Math.min(100, Number(audioSettings.fastForwardVolume ?? 100)))) },
        { key: 'OutputMuted', value: audioSettings.outputMuted ? 'true' : 'false' },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'TextureReplacements', [
        { key: 'EnableTextureReplacements', value: displaySettings.enableTextureReplacements ? 'true' : 'false' },
        { key: 'EnableVRAMWriteReplacements', value: displaySettings.enableVRAMWriteReplacements ? 'true' : 'false' },
        { key: 'AlwaysTrackUploads', value: displaySettings.alwaysTrackUploads ? 'true' : 'false' },
        { key: 'PreloadTextures', value: displaySettings.preloadTextures ? 'true' : 'false' },
        { key: 'DumpVRAMWrites', value: displaySettings.dumpVRAMWrites ? 'true' : 'false' },
        { key: 'DumpTextures', value: displaySettings.dumpTextures ? 'true' : 'false' },
        { key: 'DumpReplacedTextures', value: displaySettings.dumpReplacedTextures ? 'true' : 'false' },
        { key: 'DumpTexturePages', value: displaySettings.dumpTexturePages ? 'true' : 'false' },
        { key: 'DumpFullTexturePages', value: displaySettings.dumpFullTexturePages ? 'true' : 'false' },
        { key: 'DumpTextureForceAlphaChannel', value: displaySettings.dumpTextureForceAlphaChannel ? 'true' : 'false' },
        { key: 'DumpVRAMWriteForceAlphaChannel', value: displaySettings.dumpVRAMWriteForceAlphaChannel ? 'true' : 'false' },
        { key: 'DumpC16Textures', value: displaySettings.dumpC16Textures ? 'true' : 'false' },
        { key: 'ReducePaletteRange', value: displaySettings.reducePaletteRange ? 'true' : 'false' },
        { key: 'ConvertCopiesToWrites', value: displaySettings.convertCopiesToWrites ? 'true' : 'false' },
        { key: 'ReplacementScaleLinearFilter', value: displaySettings.replacementScaleLinearFilter ? 'true' : 'false' },
        { key: 'MaxHashCacheEntries', value: String(Math.max(0, Number(displaySettings.maxHashCacheEntries || 0))) },
        { key: 'MaxHashCacheVRAMUsageMB', value: String(Math.max(0, Number(displaySettings.maxHashCacheVRAMUsageMB || 0))) },
        { key: 'MaxReplacementCacheVRAMUsage', value: String(Math.max(0, Number(displaySettings.maxReplacementCacheVRAMUsage || 0))) },
        { key: 'MaxVRAMWriteSplits', value: String(Math.max(0, Number(displaySettings.maxVRAMWriteSplits || 0))) },
        { key: 'MaxVRAMWriteCoalesceWidth', value: String(Math.max(0, Number(displaySettings.maxVRAMWriteCoalesceWidth || 0))) },
        { key: 'MaxVRAMWriteCoalesceHeight', value: String(Math.max(0, Number(displaySettings.maxVRAMWriteCoalesceHeight || 0))) },
        { key: 'DumpTextureWidthThreshold', value: String(Math.max(0, Number(displaySettings.dumpTextureWidthThreshold || 0))) },
        { key: 'DumpTextureHeightThreshold', value: String(Math.max(0, Number(displaySettings.dumpTextureHeightThreshold || 0))) },
        { key: 'DumpVRAMWriteWidthThreshold', value: String(Math.max(0, Number(displaySettings.dumpVRAMWriteWidthThreshold || 0))) },
        { key: 'DumpVRAMWriteHeightThreshold', value: String(Math.max(0, Number(displaySettings.dumpVRAMWriteHeightThreshold || 0))) },
      ]);
      iniContent = rewriteIniSectionKeys(iniContent, 'AutoUpdater', [
        { key: 'CheckAtStartup', value: 'false' },
      ]);
      iniContent = applyDuckStationStandardControllerConfig(iniContent);
      fs.writeFileSync(settingsIniPath, iniContent, 'utf8');
      const syncedFiles = getDuckStationBiosFiles(biosDir);
      return {
        ok: true,
        runtimeRoot,
        biosDir,
        settingsIniPath,
        sourceBiosPath: runtime.biosPath || '',
        copied,
        biosAvailable: syncedFiles.length > 0,
        biosCount: syncedFiles.length,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not prepare the DuckStation portable BIOS folder.' };
    }
  }

function syncDolphinPortableConfig(settings = loadSettings()) {
    const runtime = getDolphinRuntimeStatus(settings);
    if (!runtime?.ok || !runtime.executablePath) {
      return { ok: true, skipped: true, reason: 'runtime unavailable' };
    }
    const runtimeRoot = path.dirname(runtime.executablePath);
    const userDir = path.join(runtimeRoot, 'User');
    const configDir = path.join(userDir, 'Config');
    const dolphinIniPath = path.join(configDir, 'Dolphin.ini');
    const gfxIniPath = path.join(configDir, 'GFX.ini');
    const hotkeysIniPath = path.join(configDir, 'Hotkeys.ini');
    const gcPadIniPath = path.join(configDir, 'GCPadNew.ini');
    const wiimoteIniPath = path.join(configDir, 'WiimoteNew.ini');
    try {
      fs.writeFileSync(path.join(runtimeRoot, 'portable.txt'), '');
      ensureDir(configDir);
      let dolphinIni = fs.existsSync(dolphinIniPath) ? fs.readFileSync(dolphinIniPath, 'utf8') : '';
      dolphinIni = rewriteIniSectionKeys(dolphinIni, 'Interface', [
        { key: 'ConfirmStop', value: 'False' },
        { key: 'UsePanicHandlers', value: 'False' },
        { key: 'OnScreenDisplayMessages', value: 'False' },
        { key: 'PauseOnFocusLost', value: 'False' },
      ]);
      dolphinIni = rewriteIniSectionKeys(dolphinIni, 'Display', [
        { key: 'Fullscreen', value: 'True' },
        { key: 'RenderToMain', value: 'False' },
      ]);
      dolphinIni = rewriteIniSectionKeys(dolphinIni, 'Core', [
        { key: 'AutoDiscChange', value: 'True' },
        { key: 'EnableCheats', value: 'False' },
      ]);
      dolphinIni = rewriteIniSectionKeys(dolphinIni, 'Hotkeys', [
        { key: 'HotkeysRequireFocus', value: 'True' },
      ]);
      dolphinIni = rewriteIniSectionKeys(dolphinIni, 'SDL_Hints', [
        { key: 'SDL_JOYSTICK_DIRECTINPUT', value: '1' },
        { key: 'SDL_JOYSTICK_ENHANCED_REPORTS', value: '0' },
        { key: 'SDL_JOYSTICK_HIDAPI_XBOX', value: '0' },
        { key: 'SDL_JOYSTICK_WGI', value: '0' },
      ]);
      fs.writeFileSync(dolphinIniPath, dolphinIni, 'utf8');

      let gfxIni = fs.existsSync(gfxIniPath) ? fs.readFileSync(gfxIniPath, 'utf8') : '';
      gfxIni = rewriteIniSectionKeys(gfxIni, 'Settings', [
        { key: 'AspectRatio', value: '0' },
        { key: 'wideScreenHack', value: 'False' },
        { key: 'BorderlessFullscreen', value: 'True' },
        { key: 'FullscreenResolution', value: 'Auto' },
      ]);
      gfxIni = rewriteIniSectionKeys(gfxIni, 'Hardware', [
        { key: 'VSync', value: 'True' },
      ]);
      fs.writeFileSync(gfxIniPath, gfxIni, 'utf8');

      const hotkeysIni = [
        '[Hotkeys1]',
        'Device = DInput/0/Keyboard Mouse',
        '',
        '[Hotkeys2]',
        'Device = ',
        '',
        '[Hotkeys3]',
        'Device = ',
        '',
        '[Hotkeys4]',
        'Device = ',
        '',
      ].join('\n');
      fs.writeFileSync(hotkeysIniPath, hotkeysIni, 'utf8');

      const gcPadIni = [
        '[GCPad1]',
        'Device = XInput/0/Gamepad',
        'Buttons/A = `Button A`',
        'Buttons/B = `Button B`',
        'Buttons/X = `Button X`',
        'Buttons/Y = `Button Y`',
        'Buttons/Z = `Right Shoulder`',
        'Buttons/Start = Start',
        'Main Stick/Up = `Left Y-`',
        'Main Stick/Down = `Left Y+`',
        'Main Stick/Left = `Left X-`',
        'Main Stick/Right = `Left X+`',
        'C-Stick/Up = `Right Y-`',
        'C-Stick/Down = `Right Y+`',
        'C-Stick/Left = `Right X-`',
        'C-Stick/Right = `Right X+`',
        'Triggers/L = `Left Trigger`',
        'Triggers/R = `Right Trigger`',
        'D-Pad/Up = `Pad N`',
        'D-Pad/Down = `Pad S`',
        'D-Pad/Left = `Pad W`',
        'D-Pad/Right = `Pad E`',
        '',
        '[GCPad2]',
        'Device = ',
        '[GCPad3]',
        'Device = ',
        '[GCPad4]',
        'Device = ',
        '',
      ].join('\n');
      fs.writeFileSync(gcPadIniPath, gcPadIni, 'utf8');

      const wiimoteIni = [
        '[Wiimote1]',
        'Device = XInput/0/Gamepad',
        'Buttons/A = `Button A`',
        'Buttons/B = `Button B`',
        'Buttons/1 = `Button X`',
        'Buttons/2 = `Button Y`',
        'Buttons/- = Back',
        'Buttons/+ = Start',
        'Buttons/Home = ',
        'D-Pad/Up = `Pad N`',
        'D-Pad/Down = `Pad S`',
        'D-Pad/Left = `Pad W`',
        'D-Pad/Right = `Pad E`',
        'Extension = Nunchuk',
        'Nunchuk/Buttons/C = `Left Shoulder`',
        'Nunchuk/Buttons/Z = `Right Shoulder`',
        'Nunchuk/Stick/Up = `Left Y-`',
        'Nunchuk/Stick/Down = `Left Y+`',
        'Nunchuk/Stick/Left = `Left X-`',
        'Nunchuk/Stick/Right = `Left X+`',
        '',
        '[Wiimote2]',
        'Device = ',
        '[Wiimote3]',
        'Device = ',
        '[Wiimote4]',
        'Device = ',
        '[BalanceBoard]',
        'Device = ',
        '',
      ].join('\n');
      fs.writeFileSync(wiimoteIniPath, wiimoteIni, 'utf8');

      return {
        ok: true,
        runtimeRoot,
        userDir,
        configDir,
        dolphinIniPath,
        gfxIniPath,
        hotkeysIniPath,
        gcPadIniPath,
        wiimoteIniPath,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not prepare the Dolphin portable config.' };
    }
  }

  function resolvePCSX2Launch(settings) {
    const normalized = normalizeSettings(settings);
    const runtime = getPCSX2RuntimeStatus(normalized);
    if (!runtime.ok || !runtime.executablePath) {
      return { ok: false, error: 'PCSX2 runtime is not available. Download it into SKALD or set a custom override.' };
    }
    if (!fs.existsSync(runtime.executablePath)) {
      return { ok: false, error: `PCSX2 executable not found: ${runtime.executablePath}` };
    }
    if (!runtime.biosAvailable) {
      return { ok: false, error: runtime.biosPath ? `PCSX2 BIOS folder not found: ${runtime.biosPath}` : 'PCSX2 BIOS folder is not configured yet.' };
    }
    const syncResult = syncPCSX2PortableConfig(normalized);
    if (!syncResult?.ok) return syncResult;
    return {
      ok: true,
      emulatorId: 'pcsx2',
      runtime,
      executablePath: runtime.executablePath,
      biosPath: runtime.biosPath,
      portableConfig: syncResult,
    };
  }

  function resolveDuckStationLaunch(settings) {
    const normalized = normalizeSettings(settings);
    const runtime = getDuckStationRuntimeStatus(normalized);
    if (!runtime.ok || !runtime.executablePath) {
      return { ok: false, error: 'DuckStation runtime is not available. Download it into SKALD or set a custom override.' };
    }
    if (!fs.existsSync(runtime.executablePath)) {
      return { ok: false, error: `DuckStation executable not found: ${runtime.executablePath}` };
    }
    if (runtime.usingBundled) {
      try { fs.writeFileSync(path.join(path.dirname(runtime.executablePath), 'portable.txt'), ''); } catch {}
    }
    const syncResult = syncDuckStationPortableConfig(normalized);
    if (!syncResult?.ok) return syncResult;
    if (!syncResult.biosAvailable) {
      return { ok: false, error: runtime.biosPath ? `DuckStation BIOS files were not found in: ${runtime.biosPath}` : 'DuckStation BIOS folder is not configured yet.' };
    }
    return {
      ok: true,
      emulatorId: 'duckstation',
      runtime,
      executablePath: runtime.executablePath,
      biosPath: syncResult.biosDir,
      portableConfig: syncResult,
    };
  }

  function resolveDolphinLaunch(settings) {
    const normalized = normalizeSettings(settings);
    const runtime = getDolphinRuntimeStatus(normalized);
    if (!runtime.ok || !runtime.executablePath) {
      return { ok: false, error: 'Dolphin runtime is not available. Download it into SKALD or set a custom override.' };
    }
    if (!fs.existsSync(runtime.executablePath)) {
      return { ok: false, error: `Dolphin executable not found: ${runtime.executablePath}` };
    }
    const syncResult = syncDolphinPortableConfig(normalized);
    if (!syncResult?.ok) return syncResult;
    return {
      ok: true,
      emulatorId: 'dolphin',
      runtime,
      executablePath: runtime.executablePath,
      portableConfig: syncResult,
    };
  }

  function syncCemuPortableConfig(settings = loadSettings()) {
    const runtime = getCemuRuntimeStatus(settings);
    if (!runtime?.ok || !runtime.executablePath) {
      return { ok: true, skipped: true, reason: 'runtime unavailable' };
    }
    const runtimeRoot = path.dirname(runtime.executablePath);
    const portableDir = path.join(runtimeRoot, 'portable');
    const settingsPath = path.join(portableDir, 'settings.xml');
    const controllerProfilesDir = path.join(portableDir, 'controllerProfiles');
    const controllerProfilePath = path.join(controllerProfilesDir, 'controller0.txt');
    const normalized = normalizeSettings(settings);
    const preferredGamePath = normalizeCemuGamePathForXml(resolveSystemStorageRoot(
      String(normalized.installPath || DEFAULT_GAMES_DIR).trim() || DEFAULT_GAMES_DIR,
      'wiiu',
    ));
    const graphicsPacksAutoDownload = normalized?.emulators?.cemu?.graphicsPacksAutoDownload === true;
    const configuredControllerPreset = String(normalized?.emulators?.cemu?.controllerPreset || '').trim();
    try {
      ensureDir(portableDir);
      ensureDir(path.join(portableDir, 'mlc01'));
      ensureDir(controllerProfilesDir);
      ensureDir(preferredGamePath.replace(/\//g, path.sep));
      const controllerPreset = configuredControllerPreset || (fs.existsSync(controllerProfilePath) ? '' : 'xinput-default');
      let xmlContent = '';
      if (fs.existsSync(settingsPath)) {
        try { xmlContent = fs.readFileSync(settingsPath, 'utf8'); } catch {}
      }
      xmlContent = ensureSimpleXmlRoot(xmlContent);
      xmlContent = upsertSimpleXmlTag(xmlContent, 'mlc_path', '');
      xmlContent = upsertSimpleXmlTag(xmlContent, 'gp_download', graphicsPacksAutoDownload ? 'true' : 'false');
      xmlContent = upsertCemuGamePaths(xmlContent, [preferredGamePath]);
      xmlContent = upsertCemuAudioConfig(xmlContent, {
        audioApi: process.platform === 'win32' ? 2 : 3,
        delay: 2,
        tvChannels: 1,
        padChannels: 1,
        inputChannels: 0,
        tvVolume: 100,
        padVolume: 100,
        inputVolume: 20,
        tvDevice: 'default',
        padDevice: 'default',
      });
      fs.writeFileSync(settingsPath, xmlContent.endsWith('\n') ? xmlContent : `${xmlContent}\n`, 'utf8');
      if (controllerPreset === 'xinput-default') {
        fs.writeFileSync(controllerProfilePath, buildCemuXInputDefaultProfileText(), 'utf8');
      }
      return {
        ok: true,
        runtimeRoot,
        portableDir,
        settingsPath,
        gamePaths: [preferredGamePath],
        graphicsPacksAutoDownload,
        controllerProfilePath,
        controllerPreset,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not prepare the Cemu portable folder.' };
    }
  }

  function resolveCemuLaunch(settings) {
    const normalized = normalizeSettings(settings);
    const runtime = getCemuRuntimeStatus(normalized);
    if (!runtime.ok || !runtime.executablePath) {
      return { ok: false, error: 'Cemu runtime is not available. Download it into SKALD or set a custom override.' };
    }
    if (!fs.existsSync(runtime.executablePath)) {
      return { ok: false, error: `Cemu executable not found: ${runtime.executablePath}` };
    }
    const syncResult = syncCemuPortableConfig(normalized);
    if (!syncResult?.ok) return syncResult;
    return {
      ok: true,
      emulatorId: 'cemu',
      runtime,
      executablePath: runtime.executablePath,
      portableConfig: syncResult,
    };
  }

  function syncXemuPortableConfig(settings = loadSettings()) {
    const runtime = getXemuRuntimeStatus(settings);
    if (!runtime?.ok || !runtime.executablePath) {
      return { ok: true, skipped: true, reason: 'runtime unavailable' };
    }
    const runtimeRoot = path.dirname(runtime.executablePath);
    const configPath = path.join(runtimeRoot, 'xemu.toml');
    try {
      ensureDir(runtimeRoot);
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, '# SKALD managed portable XEMU config\n', 'utf8');
      }
      let tomlContent = fs.readFileSync(configPath, 'utf8');
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'general', [
        { key: 'show_welcome', valueExpression: 'false' },
        { key: 'skip_boot_anim', valueExpression: 'true' },
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'display.window', [
        { key: 'fullscreen_on_startup', valueExpression: 'true' },
      ]);
      tomlContent = rewriteTomlSectionKeys(tomlContent, 'sys.files', [
        { key: 'bootrom_path', valueExpression: toTomlBasicString(runtime.mcpxBootRomPath || '') },
        { key: 'flashrom_path', valueExpression: toTomlBasicString(runtime.flashRomPath || '') },
        { key: 'hdd_path', valueExpression: toTomlBasicString(runtime.hardDiskImagePath || '') },
      ]);
      fs.writeFileSync(configPath, tomlContent, 'utf8');
      return {
        ok: true,
        runtimeRoot,
        configPath,
        flashRomPath: runtime.flashRomPath || '',
        flashRomAvailable: !!runtime.flashRomAvailable,
        mcpxBootRomPath: runtime.mcpxBootRomPath || '',
        mcpxBootRomAvailable: !!runtime.mcpxBootRomAvailable,
        hardDiskImagePath: runtime.hardDiskImagePath || '',
        hardDiskImageAvailable: !!runtime.hardDiskImageAvailable,
        requiredFilesAvailable: !!runtime.requiredFilesAvailable,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not prepare the XEMU portable config.' };
    }
  }

  function resolveXemuLaunch(settings) {
    const normalized = normalizeSettings(settings);
    const runtime = getXemuRuntimeStatus(normalized);
    if (!runtime.ok || !runtime.executablePath) {
      return { ok: false, error: 'XEMU runtime is not available. Download it into SKALD or set a custom override.' };
    }
    if (!fs.existsSync(runtime.executablePath)) {
      return { ok: false, error: `XEMU executable not found: ${runtime.executablePath}` };
    }
    const syncResult = syncXemuPortableConfig(normalized);
    if (!syncResult?.ok) return syncResult;
    if (!syncResult.requiredFilesAvailable) {
      const missing = [];
      if (!syncResult.mcpxBootRomAvailable) missing.push('MCPX Boot ROM Image');
      if (!syncResult.flashRomAvailable) missing.push('Flash ROM Image (BIOS)');
      if (!syncResult.hardDiskImageAvailable) missing.push('Hard Disk Image');
      return { ok: false, error: `XEMU setup is incomplete. Locate the required file${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.` };
    }
    return {
      ok: true,
      emulatorId: 'xemu',
      runtime,
      executablePath: runtime.executablePath,
      portableConfig: syncResult,
    };
  }

    function resolveRPCS3Launch(settings) {
    const normalized = normalizeSettings(settings);
    const runtime = getRPCS3RuntimeStatus(normalized);
    if (!runtime.ok || !runtime.executablePath) {
      return { ok: false, error: 'RPCS3 runtime is not available. Download it into SKALD or set a custom override.' };
    }
    if (!fs.existsSync(runtime.executablePath)) {
      return { ok: false, error: `RPCS3 executable not found: ${runtime.executablePath}` };
    }
    return {
      ok: true,
      emulatorId: 'rpcs3',
      runtime,
      executablePath: runtime.executablePath,
    };
  }

  function resolveRPCS3RomPath(romPath) {
    const actualPath = String(romPath || '').trim();
    if (!actualPath) return { ok: false, error: 'No PlayStation 3 content path was provided for RPCS3.' };
    if (!fs.existsSync(actualPath)) return { ok: false, error: `PlayStation 3 content not found: ${actualPath}` };
    const stat = fs.statSync(actualPath);
    if (stat.isDirectory()) {
      const ps3GameDir = fs.existsSync(path.join(actualPath, 'PS3_GAME')) ? path.join(actualPath, 'PS3_GAME') : actualPath;
      const ebootPath = path.join(ps3GameDir, 'USRDIR', 'EBOOT.BIN');
      const paramSfoPath = path.join(ps3GameDir, 'PARAM.SFO');
      if (fs.existsSync(ebootPath)) {
        return { ok: true, romPath: ebootPath };
      }
      if (fs.existsSync(paramSfoPath)) {
        return { ok: false, error: `This PlayStation 3 folder has PARAM.SFO but no USRDIR/EBOOT.BIN, so RPCS3 cannot boot it directly: ${actualPath}` };
      }
      return { ok: false, error: `No launchable PlayStation 3 game folder found for RPCS3: ${actualPath}` };
    }
    const ext = path.extname(actualPath).toLowerCase();
    if (['.pkg', '.iso', '.bin', '.self', '.elf'].includes(ext)) {
      return { ok: true, romPath: actualPath };
    }
    return { ok: false, error: `Unsupported PlayStation 3 content for RPCS3: ${actualPath}` };
  }

  function serializeSession(session) {
    return {
      id: session.id,
      type: session.type,
      emulatorId: session.emulatorId,
      system: session.system,
      identifier: session.identifier || null,
      title: session.title || null,
      romPath: session.romPath || null,
      sourcePath: session.sourcePath || null,
      command: session.command || null,
      args: Array.isArray(session.args) ? [...session.args] : [],
      pid: session.pid || null,
      startedAt: session.startedAt,
      status: session.status,
      isSuspended: session.status === 'suspended',
      isForeground: !!session.isForeground,
      exitCode: session.exitCode ?? null,
      error: session.error || null,
    };
  }

  function getSessions() {
    return Array.from(activeSessions.values()).map(serializeSession);
  }

  function buildRetroArchSessionOverride(system) {
    if (!SESSION_CONFIG_DIR) return null;
    try {
      if (!fs.existsSync(SESSION_CONFIG_DIR)) fs.mkdirSync(SESSION_CONFIG_DIR, { recursive: true });
      const overridePath = path.join(SESSION_CONFIG_DIR, `skald-session-${String(system || 'generic').toLowerCase()}.cfg`);
      const content = [
        '# SKALD managed RetroArch session overrides',
        'input_menu_toggle_btn = "nul"',
        'input_menu_toggle_gamepad_combo = "0"',
        'input_enable_hotkey_btn = "nul"',
        'input_player1_guide_btn = "nul"',
        'all_users_control_menu = "false"',
        '',
      ].join('\n');
      fs.writeFileSync(overridePath, content, 'utf8');
      return overridePath;
    } catch {
      return null;
    }
  }

  function launchLibretroRom({ romPath, system, identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolveLibretroLaunch(settings, system);
    if (!resolved.ok) return resolved;

    const romResolved = resolveRomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const sessionOverride = buildRetroArchSessionOverride(system);
    const args = sessionOverride
      ? ['--appendconfig', sessionOverride, '-L', resolved.corePath, romResolved.romPath]
      : ['-L', resolved.corePath, romResolved.romPath];
    const child = spawn(resolved.raPath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'libretro',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      command: resolved.raPath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch emulator.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  function launchStandaloneEmulator(emulatorId, launchArgs = []) {
    const id = String(emulatorId || '').trim().toLowerCase();
    const settings = loadSettings();
    let executablePath = '';
    let args = Array.isArray(launchArgs) ? launchArgs.filter(Boolean).map(value => String(value)) : [];
    let title = '';
    let system = '';

    if (id === 'retroarch') {
      const runtime = getRetroArchRuntimeStatus(settings);
      if (!runtime.ok || !runtime.executablePath) {
        return { ok: false, error: 'RetroArch runtime is not available yet.' };
      }
      executablePath = runtime.executablePath;
      title = 'RetroArch';
    } else if (id === 'pcsx2') {
      const runtime = getPCSX2RuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'PCSX2 runtime is not available yet.' };
      }
      executablePath = runtime.executablePath;
      args = ['-portable', ...args];
      title = 'PCSX2';
      system = 'ps2';
    } else if (id === 'duckstation') {
      const runtime = getDuckStationRuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'DuckStation runtime is not available yet.' };
      }
      const syncResult = syncDuckStationPortableConfig(settings);
      if (!syncResult?.ok) return syncResult;
      executablePath = runtime.executablePath;
      title = 'DuckStation';
      system = 'psx';
    } else if (id === 'dolphin') {
      const runtime = getDolphinRuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'Dolphin runtime is not available yet.' };
      }
      const syncResult = syncDolphinPortableConfig(settings);
      if (!syncResult?.ok) return syncResult;
      executablePath = runtime.executablePath;
      title = 'Dolphin';
      system = 'gamecube';
    } else if (id === 'cemu') {
      const runtime = getCemuRuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'Cemu runtime is not available yet.' };
      }
      const syncResult = syncCemuPortableConfig(settings);
      if (!syncResult?.ok) return syncResult;
      executablePath = runtime.executablePath;
      title = 'Cemu';
      system = 'wiiu';
    } else if (id === 'xemu') {
      const runtime = getXemuRuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'XEMU runtime is not available yet.' };
      }
      const syncResult = syncXemuPortableConfig(settings);
      if (!syncResult?.ok) return syncResult;
      executablePath = runtime.executablePath;
      args = ['-config_path', syncResult.configPath, ...args];
      title = 'XEMU';
      system = 'xbox';
    } else if (id === 'rpcs3') {
      const runtime = getRPCS3RuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'RPCS3 runtime is not available yet.' };
      }
      executablePath = runtime.executablePath;
      title = 'RPCS3';
      system = 'ps3';
    } else if (id === 'vlc') {
      const runtime = getVLCRuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'VLC runtime is not available yet.' };
      }
      executablePath = runtime.executablePath;
      title = 'VLC';
    } else if (id === 'xenia') {
      const resolved = resolveXeniaLaunch(settings);
      if (!resolved?.ok || !resolved?.executablePath || !fs.existsSync(resolved.executablePath)) {
        return resolved?.ok === false
          ? resolved
          : { ok: false, error: 'Xenia Canary runtime is not available yet.' };
      }
      executablePath = resolved.executablePath;
      title = 'Xenia Canary';
      system = 'x360';
    } else {
      return { ok: false, error: 'That emulator does not support standalone launch yet.' };
    }

    const child = spawn(executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: id,
      emulatorId: id,
      system,
      identifier: null,
      title,
      romPath: null,
      command: executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || `Failed to launch ${title}.`;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    return { ok: true, session: serializeSession(session) };
  }

  function launchDuckStationRom({ romPath, system = 'psx', identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolveDuckStationLaunch(settings);
    if (!resolved.ok) return resolved;

    const romResolved = resolveRomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const args = ['-batch', '-fullscreen', '--', romResolved.romPath];
    const child = spawn(resolved.executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(resolved.executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'duckstation',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      command: resolved.executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch DuckStation.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  function launchDolphinRom({ romPath, system = 'gamecube', identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolveDolphinLaunch(settings);
    if (!resolved.ok) return resolved;

    const romResolved = resolveRomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const args = ['--batch', '--exec', romResolved.romPath];
    const child = spawn(resolved.executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(resolved.executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'dolphin',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      command: resolved.executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch Dolphin.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  function launchCemuRom({ romPath, system = 'wiiu', identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolveCemuLaunch(settings);
    if (!resolved.ok) return resolved;

    const romResolved = resolveRomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const args = ['-g', romResolved.romPath, '-f'];
    const child = spawn(resolved.executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(resolved.executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'cemu',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      command: resolved.executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch Cemu.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  function launchXemuRom({ romPath, system = 'xbox', identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolveXemuLaunch(settings);
    if (!resolved.ok) return resolved;

    const romResolved = resolveRomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const args = ['-config_path', resolved.portableConfig.configPath, '-full-screen', '-dvd_path', romResolved.romPath];
    const child = spawn(resolved.executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(resolved.executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'xemu',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      command: resolved.executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch XEMU.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  function launchPCSX2Rom({ romPath, system = 'ps2', identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolvePCSX2Launch(settings);
    if (!resolved.ok) return resolved;

    const romResolved = resolveRomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const args = ['-portable', '-batch', '-nogui', '-fullscreen', '--', romResolved.romPath];
    const child = spawn(resolved.executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(resolved.executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'pcsx2',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      command: resolved.executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch PCSX2.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  function launchRPCS3Rom({ romPath, system = 'ps3', identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolveRPCS3Launch(settings);
    if (!resolved.ok) return resolved;

    const romResolved = resolveRPCS3RomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const args = ['--no-gui', romResolved.romPath];
    const child = spawn(resolved.executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(resolved.executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'rpcs3',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      sourcePath: romPath || romResolved.romPath,
      command: resolved.executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch RPCS3.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  async function launchXeniaRom({ romPath, system = 'x360', identifier = null, title = null }) {
    const settings = loadSettings();
    const resolved = resolveXeniaLaunch(settings);
    if (!resolved.ok) return resolved;

    const romResolved = await resolveXeniaRomPath(romPath);
    if (!romResolved.ok) return romResolved;

    const gameProfileRef = buildXeniaGameProfileRef({
      identifier,
      title,
      romPath: romResolved.romPath,
      sourcePath: romResolved.sourcePath || romResolved.romPath,
    });
    const gameProfileStatus = getXeniaGameProfileStatus(settings, { target: gameProfileRef });
    const profileOverrideResult = applyXeniaGameProfileConfigOverrides(resolved?.profileSync?.configPath || '', gameProfileStatus?.profile || {});
    if (profileOverrideResult && profileOverrideResult.ok === false) return profileOverrideResult;

    const args = [romResolved.romPath];
    const child = spawn(resolved.executablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(resolved.executablePath),
    });

    const session = {
      id: `emu-${nextSessionId++}`,
      type: 'xenia',
      emulatorId: resolved.emulatorId,
      system,
      identifier,
      title: title || identifier || path.basename(romResolved.romPath, path.extname(romResolved.romPath)),
      romPath: romResolved.romPath,
      sourcePath: romResolved.sourcePath || romResolved.romPath,
      archivePath: romResolved.archivePath || null,
      extractedDir: romResolved.extractedDir || null,
      gameProfileKey: gameProfileRef.key,
      command: resolved.executablePath,
      args,
      pid: child.pid || null,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      error: null,
      child,
    };

    activeSessions.set(session.id, session);
    startForegroundPolling();
    pollForegroundSession().catch(() => {});
    emitSessionsChanged();
    notifySessionStarted(session);

    child.once('error', (error) => {
      session.status = 'error';
      session.error = error?.message || 'Failed to launch Xenia Canary.';
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.once('exit', (code) => {
      session.status = 'exited';
      session.exitCode = code;
      emitSessionsChanged();
      notifySessionEnded(session);
      activeSessions.delete(session.id);
      if (!activeSessions.size) stopForegroundPolling();
      emitSessionsChanged();
    });

    child.unref();
    if (identifier) markGamePlayed(identifier);
    return { ok: true, session: serializeSession(session) };
  }

  return {
    normalizeSettings,
    getRetroArchRuntimeStatus,
    getPCSX2RuntimeStatus,
    getPCSX2DisplaySettingsStatus,
    getPCSX2AudioSettingsStatus,
    getPCSX2SpeedSettingsStatus,
    getDuckStationRuntimeStatus,
    getDuckStationGuideSettingsStatus,
    getDuckStationDisplaySettingsStatus,
    getDuckStationAudioSettingsStatus,
    getDuckStationSpeedSettingsStatus,
      getDolphinRuntimeStatus,
      getCemuRuntimeStatus,
      getXemuRuntimeStatus,
      getRPCS3RuntimeStatus,
      getVLCRuntimeStatus,
    getXeniaRuntimeStatus,
    getLibretroCoreStatus,
    importRetroArchRuntime,
      importPCSX2Runtime,
      importDuckStationRuntime,
      importDolphinRuntime,
      importCemuRuntime,
      importXemuRuntime,
      importRPCS3Runtime,
      importVLCRuntime,
    importXeniaRuntime,
    getSystems,
    getSystem,
    getManagedCoreChoices,
    getPreferredManagedCoreChoice,
    getRetroArchManagedExecutablePath,
      getPCSX2ManagedExecutablePath,
      getDuckStationManagedExecutablePath,
      getDolphinManagedExecutablePath,
      getCemuManagedExecutablePath,
      getXemuManagedExecutablePath,
      getRPCS3ManagedExecutablePath,
      getVLCManagedExecutablePath,
    getXeniaManagedExecutablePath,
    syncPCSX2PortableConfig,
    updatePCSX2DisplaySettings,
    updatePCSX2AudioSettings,
    updatePCSX2SpeedSettings,
    syncDuckStationPortableConfig,
    updateDuckStationGuideSettings,
    updateDuckStationDisplaySettings,
    updateDuckStationAudioSettings,
    updateDuckStationSpeedSettings,
    syncDolphinPortableConfig,
    syncCemuPortableConfig,
    syncXemuPortableConfig,
    syncXeniaProfileConfig,
    getXeniaProfileStatus,
    getXeniaGuideSettingsStatus,
    updateXeniaGuideSettings,
    buildXeniaGameProfileRef,
    getXeniaGameProfileStatus,
    updateXeniaGameProfileSettings,
    resolveLibretroLaunch,
      resolvePCSX2Launch,
      resolveDuckStationLaunch,
      resolveDolphinLaunch,
      resolveCemuLaunch,
      resolveXemuLaunch,
      resolveRPCS3Launch,
      resolveXeniaLaunch,
      launchStandaloneEmulator,
      launchLibretroRom,
      launchDuckStationRom,
      launchDolphinRom,
      launchCemuRom,
      launchXemuRom,
      launchPCSX2Rom,
      launchRPCS3Rom,
      launchXeniaRom,
    getSessions,
    terminateSession,
    restartSession,
    minimizeSessionWindow,
    maximizeSessionWindow,
    restoreSessionWindow,
    suspendSession,
    resumeSession,
    async focusSession(sessionId) {
      const session = activeSessions.get(sessionId);
      if (!session?.pid) return { ok: false, error: 'No active emulator session found.' };
      try {
        const restored = await restoreSessionWindow(sessionId).catch(() => null);
        if (restored?.ok) {
          session.isForeground = true;
          emitSessionsChanged();
          return { ok: true, session: serializeSession(session) };
        }
        const output = await runPowerShell(`$ws=New-Object -ComObject WScript.Shell; if($ws.AppActivate(${Number(session.pid)})){ 'ok' } else { 'fail' }`);
        const ok = output.toLowerCase().includes('ok');
        if (ok) {
          session.isForeground = true;
          emitSessionsChanged();
          return { ok: true, session: serializeSession(session) };
        }
        return { ok: false, error: 'Could not focus the emulator window.' };
      } catch (error) {
        return { ok: false, error: error?.message || 'Could not focus the emulator window.' };
      }
    },
  };
}

module.exports = {
  createEmulatorManager,
};
