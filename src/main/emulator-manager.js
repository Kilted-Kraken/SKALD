'use strict';

const { execFile } = require('child_process');
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

  const ROM_EXTS = ['.sfc', '.smc', '.snes', '.nes', '.gba', '.gbc', '.gb', '.md', '.gen', '.smd', '.n64', '.z64', '.v64', '.nds', '.pce', '.chd', '.cue', '.bin', '.img', '.iso', '.gcm', '.gcz', '.rvz', '.wbfs', '.wia', '.wad', '.m3u', '.pbp', '.xex', '.zip'];
  const RETROARCH_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'retroarch') : null;
  const PCSX2_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'pcsx2') : null;
  const DUCKSTATION_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'duckstation') : null;
  const DOLPHIN_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'dolphin') : null;
  const DOLPHIN_STABLE_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'dolphin-stable') : null;
  const DOLPHIN_DEVELOPMENT_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'dolphin-development') : null;
  const RPCS3_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'rpcs3') : null;
  const VLC_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'vlc') : null;
const XENIA_RUNTIME_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'xenia') : null;
const XENIA_EXTRACT_CACHE_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'xenia-extracted') : null;
const XENIA_PROFILE_METADATA_DIR = userDataDir ? path.join(userDataDir, 'emulators', 'xenia-profiles') : null;
  const XENIA_EXECUTABLE_NAMES = ['xenia_canary.exe', 'xenia.exe'];
  const DUCKSTATION_EXECUTABLE_NAMES = ['duckstation-qt-x64-releaseltcg.exe', 'duckstation-qt-x64-release.exe', 'duckstation-qt-x64.exe', 'duckstation-qt.exe', 'duckstation.exe'];
  const DOLPHIN_EXECUTABLE_NAMES = ['Dolphin.exe', 'dolphin.exe', 'DolphinQt2.exe', 'DolphinQt.exe'];
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
      next.emulators.pcsx2 = pcsx2;
      const duckstation = next.emulators.duckstation && typeof next.emulators.duckstation === 'object'
        ? { ...next.emulators.duckstation }
        : {};
      duckstation.mode = duckstation.mode === 'custom' ? 'custom' : 'bundled';
      duckstation.customExecutablePath = String(duckstation.customExecutablePath || duckstation.executablePath || '').trim();
      duckstation.executablePath = duckstation.customExecutablePath;
      duckstation.biosPath = String(duckstation.biosPath || '').trim();
      next.emulators.duckstation = duckstation;
      const dolphin = next.emulators.dolphin && typeof next.emulators.dolphin === 'object'
        ? { ...next.emulators.dolphin }
        : {};
      dolphin.mode = dolphin.mode === 'custom' ? 'custom' : 'bundled';
      dolphin.buildChannel = dolphin.buildChannel === 'development' ? 'development' : 'stable';
      dolphin.customExecutablePath = String(dolphin.customExecutablePath || dolphin.executablePath || '').trim();
      dolphin.executablePath = dolphin.customExecutablePath;
      next.emulators.dolphin = dolphin;
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
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
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
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
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
    } else if (customAvailable) {
      effective = { source: 'custom', path: customExecutablePath, mode: 'custom' };
    } else if (bundledCandidate) {
      effective = { source: bundledCandidate.source, path: bundledCandidate.path, mode: 'bundled' };
    } else if (customExecutablePath) {
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
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      if (fs.existsSync(DUCKSTATION_RUNTIME_DIR)) fs.renameSync(DUCKSTATION_RUNTIME_DIR, backupDir);
      try {
        fs.cpSync(sourceDir, DUCKSTATION_RUNTIME_DIR, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(DUCKSTATION_RUNTIME_DIR)) fs.rmSync(DUCKSTATION_RUNTIME_DIR, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, DUCKSTATION_RUNTIME_DIR);
        throw copyError;
      }
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
      if (!fs.existsSync(portableIniPath)) {
        fs.writeFileSync(portableIniPath, '; SKALD managed PCSX2 portable mode\n', 'utf8');
      }
      if (!fs.existsSync(inisDir)) fs.mkdirSync(inisDir, { recursive: true });
      let iniContent = fs.existsSync(pcsx2IniPath) ? fs.readFileSync(pcsx2IniPath, 'utf8') : '';
      if (runtime.biosPath) {
        iniContent = upsertIniValue(iniContent, 'Folders', 'Bios', runtime.biosPath);
      }
      iniContent = upsertIniValue(iniContent, 'UI', 'SetupWizardIncomplete', 'false');
      fs.writeFileSync(pcsx2IniPath, iniContent || '[Folders]\n', 'utf8');
      return {
        ok: true,
        runtimeRoot,
        inisDir,
        portableIniPath,
        pcsx2IniPath,
        biosPath: runtime.biosPath || '',
        biosAvailable: !!runtime.biosAvailable,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not prepare the PCSX2 portable config.' };
    }
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
      iniContent = upsertIniValue(iniContent, 'Main', 'SetupWizardIncomplete', 'false');
      iniContent = upsertIniValue(iniContent, 'Main', 'StartFullscreen', 'true');
      iniContent = upsertIniValue(iniContent, 'Main', 'HideCursorInFullscreen', 'true');
      iniContent = upsertIniValue(iniContent, 'BIOS', 'SearchDirectory', 'bios');
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
      const runtime = getXeniaRuntimeStatus(settings);
      if (!runtime.executablePath || !fs.existsSync(runtime.executablePath)) {
        return { ok: false, error: 'Xenia Canary runtime is not available yet.' };
      }
      executablePath = runtime.executablePath;
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
      getDuckStationRuntimeStatus,
      getDolphinRuntimeStatus,
      getRPCS3RuntimeStatus,
      getVLCRuntimeStatus,
    getXeniaRuntimeStatus,
    getLibretroCoreStatus,
    importRetroArchRuntime,
      importPCSX2Runtime,
      importDuckStationRuntime,
      importDolphinRuntime,
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
      getRPCS3ManagedExecutablePath,
      getVLCManagedExecutablePath,
    getXeniaManagedExecutablePath,
    syncPCSX2PortableConfig,
    syncDuckStationPortableConfig,
    syncDolphinPortableConfig,
    syncXeniaProfileConfig,
    getXeniaProfileStatus,
    resolveLibretroLaunch,
      resolvePCSX2Launch,
      resolveDuckStationLaunch,
      resolveDolphinLaunch,
      resolveRPCS3Launch,
      resolveXeniaLaunch,
      launchStandaloneEmulator,
      launchLibretroRom,
      launchDuckStationRom,
      launchDolphinRom,
      launchPCSX2Rom,
      launchRPCS3Rom,
      launchXeniaRom,
    getSessions,
    terminateSession,
    restartSession,
    minimizeSessionWindow,
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
