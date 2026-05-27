// Native helper used by SKALD to interact with RPCS3 modal prompts.
#if false
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

namespace Skald.Rpcs3Helper;

internal static class Program
{
    private const int SW_RESTORE = 9;
    private const uint INPUT_MOUSE = 0;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    private static int Main(string[] args)
    {
        if (args.Length == 0 || !string.Equals(args[0], "confirm-firmware", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine("usage: Skald.Rpcs3Helper confirm-firmware --pid <pid> [--timeout-ms <ms>]");
            return 2;
        }

        var pid = ReadIntArg(args, "--pid");
        var timeoutMs = ReadIntArg(args, "--timeout-ms") ?? 15000;
        if (pid is null or <= 0)
        {
            Console.WriteLine("invalid-pid");
            return 2;
        }

        var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(1000, timeoutMs));
        var lastState = "not-started";
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var result = TryConfirmFirmwarePrompt(pid.Value);
                lastState = result.State;
                if (result.Success)
                {
                    Console.WriteLine(result.State);
                    return 0;
                }
            }
            catch (Exception ex)
            {
                lastState = $"error:{ex.GetType().Name}:{ex.Message}";
            }

            Thread.Sleep(250);
        }

        Console.WriteLine(lastState);
        return 1;
    }

    private static HelperResult TryConfirmFirmwarePrompt(int pid)
    {
        var dialog = FindFirmwareDialog(pid);
        if (dialog is null)
        {
            return new HelperResult(false, "dialog-not-found");
        }

        TryActivateWindow(dialog);

        var yesButton = FindYesButton(dialog);
        if (yesButton is null)
        {
            return TryClickLikelyYesButton(dialog, "button-not-found");
        }

        try
        {
            if (yesButton.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern) && pattern is InvokePattern invoke)
            {
                invoke.Invoke();
                return new HelperResult(true, "clicked-uia-invoke");
            }
        }
        catch
        {
            // Qt controls do not always expose an invokable button, so fall back to native input below.
        }

        try
        {
            var rect = yesButton.Current.BoundingRectangle;
            if (!rect.IsEmpty && rect.Width > 0 && rect.Height > 0)
            {
                ClickScreenPoint((int)Math.Round(rect.Left + rect.Width / 2), (int)Math.Round(rect.Top + rect.Height / 2));
                return new HelperResult(true, "clicked-uia-bounds");
            }
        }
        catch
        {
            // Keep falling through. The rectangle fallback below is deliberately broad.
        }

        return TryClickLikelyYesButton(dialog, "button-click-fallback");
    }

    private static AutomationElement? FindFirmwareDialog(int pid)
    {
        var root = AutomationElement.RootElement;
        var windows = root.FindAll(TreeScope.Children, Condition.TrueCondition);
        AutomationElement? processWindow = null;
        for (var i = 0; i < windows.Count; i++)
        {
            var window = windows[i];
            if (!SafeEqualsPid(window, pid)) continue;

            processWindow ??= window;
            var name = SafeName(window);
            var automationId = SafeAutomationId(window);
            if (LooksLikeFirmwareDialog(name, automationId))
            {
                return window;
            }

            var dialog = FindDescendant(window, element =>
            {
                var elementName = SafeName(element);
                var elementId = SafeAutomationId(element);
                return LooksLikeFirmwareDialog(elementName, elementId) || LooksLikeFirmwareText(elementName);
            });
            if (dialog is not null)
            {
                return dialog;
            }
        }

        return processWindow is null ? null : FindDescendant(processWindow, element => LooksLikeFirmwareText(SafeName(element))) ?? processWindow;
    }

    private static AutomationElement? FindYesButton(AutomationElement dialog)
    {
        return FindDescendant(dialog, element =>
        {
            try
            {
                if (element.Current.ControlType != ControlType.Button) return false;
                var name = SafeName(element);
                return string.Equals(name, "Yes", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(name, "&Yes", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("Yes", StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        });
    }

    private static HelperResult TryClickLikelyYesButton(AutomationElement dialog, string state)
    {
        try
        {
            var rect = dialog.Current.BoundingRectangle;
            if (rect.IsEmpty || rect.Width <= 0 || rect.Height <= 0)
            {
                return new HelperResult(false, $"{state}:no-dialog-rect");
            }

            // RPCS3/Qt keeps the Yes button in the lower-right cluster, just left of No.
            // This is a fallback only; UIA button invoke/bounds are preferred above.
            var x = (int)Math.Round(rect.Left + rect.Width * 0.74);
            var y = (int)Math.Round(rect.Top + rect.Height * 0.82);
            ClickScreenPoint(x, y);
            return new HelperResult(true, $"{state}:clicked-dialog-relative");
        }
        catch (Exception ex)
        {
            return new HelperResult(false, $"{state}:click-error:{ex.GetType().Name}");
        }
    }

    private static void TryActivateWindow(AutomationElement element)
    {
        try
        {
            var hwnd = new IntPtr(element.Current.NativeWindowHandle);
            if (hwnd == IntPtr.Zero)
            {
                var ancestor = TreeWalker.RawViewWalker.GetParent(element);
                while (ancestor is not null)
                {
                    hwnd = new IntPtr(ancestor.Current.NativeWindowHandle);
                    if (hwnd != IntPtr.Zero) break;
                    ancestor = TreeWalker.RawViewWalker.GetParent(ancestor);
                }
            }

            if (hwnd == IntPtr.Zero) return;

            var targetThread = GetWindowThreadProcessId(hwnd, out _);
            var foreground = GetForegroundWindow();
            var foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out _);
            if (foregroundThread != 0 && targetThread != 0 && foregroundThread != targetThread)
            {
                AttachThreadInput(foregroundThread, targetThread, true);
            }

            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
            SetActiveWindow(hwnd);
            SetFocus(hwnd);
            Thread.Sleep(150);

            if (foregroundThread != 0 && targetThread != 0 && foregroundThread != targetThread)
            {
                AttachThreadInput(foregroundThread, targetThread, false);
            }
        }
        catch
        {
            // Activation is best effort; UIA invoke can still succeed without it.
        }
    }

    private static AutomationElement? FindDescendant(AutomationElement root, Func<AutomationElement, bool> predicate)
    {
        var stack = new Stack<AutomationElement>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            try
            {
                if (predicate(current)) return current;
                var children = current.FindAll(TreeScope.Children, Condition.TrueCondition);
                for (var i = children.Count - 1; i >= 0; i--)
                {
                    stack.Push(children[i]);
                }
            }
            catch
            {
                // Ignore transient/stale UIA elements.
            }
        }

        return null;
    }

    private static bool LooksLikeFirmwareDialog(string name, string automationId)
    {
        return name.Contains("Firmware Installer", StringComparison.OrdinalIgnoreCase)
            || name.Contains("RPCS3 Firmware", StringComparison.OrdinalIgnoreCase)
            || automationId.Contains("firmware", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksLikeFirmwareText(string name)
    {
        return name.Contains("Install firmware:", StringComparison.OrdinalIgnoreCase)
            || name.Contains("PS3UPDAT.PUP", StringComparison.OrdinalIgnoreCase);
    }

    private static bool SafeEqualsPid(AutomationElement element, int pid)
    {
        try { return element.Current.ProcessId == pid; }
        catch { return false; }
    }

    private static string SafeName(AutomationElement element)
    {
        try { return element.Current.Name ?? string.Empty; }
        catch { return string.Empty; }
    }

    private static string SafeAutomationId(AutomationElement element)
    {
        try { return element.Current.AutomationId ?? string.Empty; }
        catch { return string.Empty; }
    }

    private static int? ReadIntArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (!string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) continue;
            if (int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
            {
                return value;
            }
        }

        return null;
    }

    private static void ClickScreenPoint(int x, int y)
    {
        SetCursorPos(x, y);
        Thread.Sleep(75);

        var virtualLeft = GetSystemMetrics(76);
        var virtualTop = GetSystemMetrics(77);
        var virtualWidth = GetSystemMetrics(78);
        var virtualHeight = GetSystemMetrics(79);
        if (virtualWidth <= 0 || virtualHeight <= 0)
        {
            virtualLeft = 0;
            virtualTop = 0;
            virtualWidth = GetSystemMetrics(0);
            virtualHeight = GetSystemMetrics(1);
        }

        var absoluteX = (int)Math.Round((x - virtualLeft) * 65535.0 / Math.Max(1, virtualWidth - 1));
        var absoluteY = (int)Math.Round((y - virtualTop) * 65535.0 / Math.Max(1, virtualHeight - 1));
        var inputs = new[]
        {
            MouseInput(absoluteX, absoluteY, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE),
            MouseInput(absoluteX, absoluteY, MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE),
            MouseInput(absoluteX, absoluteY, MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE),
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    private static INPUT MouseInput(int x, int y, uint flags)
    {
        return new INPUT
        {
            type = INPUT_MOUSE,
            u = new InputUnion
            {
                mi = new MOUSEINPUT
                {
                    dx = x,
                    dy = y,
                    dwFlags = flags,
                },
            },
        };
    }

    private readonly record struct HelperResult(bool Success, string State);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
}
#endif

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Skald.Rpcs3Helper;

internal static class Program
{
    private const int SW_RESTORE = 9;
    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;
    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;
    private const uint INPUT_MOUSE = 0;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    private static int Main(string[] args)
    {
        if (args.Length == 0 || !string.Equals(args[0], "confirm-firmware", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine("usage: Skald.Rpcs3Helper confirm-firmware --pid <pid> [--timeout-ms <ms>]");
            return 2;
        }

        var pid = ReadIntArg(args, "--pid");
        var timeoutMs = ReadIntArg(args, "--timeout-ms") ?? 15000;
        if (pid is null or <= 0)
        {
            Console.WriteLine("invalid-pid");
            return 2;
        }

        var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(1000, timeoutMs));
        var lastState = "not-started";
        while (DateTime.UtcNow < deadline)
        {
            var result = TryConfirmFirmwarePrompt(pid.Value);
            lastState = result.State;
            if (result.Success)
            {
                Console.WriteLine(result.State);
                return 0;
            }
            Thread.Sleep(250);
        }

        Console.WriteLine(lastState);
        return 1;
    }

    private static HelperResult TryConfirmFirmwarePrompt(int pid)
    {
        var windows = GetProcessWindows(pid);
        if (windows.Count == 0)
        {
            return new HelperResult(false, "window-not-found");
        }

        var target = ChooseFirmwareWindow(windows);
        if (target.Hwnd == IntPtr.Zero)
        {
            return new HelperResult(false, "firmware-window-not-found");
        }

        ActivateWindow(target.Hwnd);

        if (target.Title.Contains("Firmware Installer", StringComparison.OrdinalIgnoreCase)
            || target.Title.Contains("Install firmware", StringComparison.OrdinalIgnoreCase))
        {
            SendKeyboardYes();
            return new HelperResult(true, $"sent-key-y hwnd=0x{target.Hwnd.ToInt64():x} title={TrimForLog(target.Title)} rect={target.Width}x{target.Height}");
        }

        if (target.Width <= 900 && target.Height <= 500)
        {
            ClickYesInDialog(target.Rect);
            return new HelperResult(true, $"clicked-yes hwnd=0x{target.Hwnd.ToInt64():x} title={TrimForLog(target.Title)} rect={target.Width}x{target.Height}");
        }

        SendKeyboardYes();
        return new HelperResult(true, $"sent-key-y hwnd=0x{target.Hwnd.ToInt64():x} title={TrimForLog(target.Title)} rect={target.Width}x{target.Height}");
    }

    private static WindowInfo ChooseFirmwareWindow(IReadOnlyList<WindowInfo> windows)
    {
        foreach (var window in windows)
        {
            if (window.Title.Contains("Firmware Installer", StringComparison.OrdinalIgnoreCase)
                || window.Title.Contains("Install firmware", StringComparison.OrdinalIgnoreCase)
                || window.Title.Contains("PS3UPDAT", StringComparison.OrdinalIgnoreCase))
            {
                return window;
            }
        }

        WindowInfo bestSmall = default;
        foreach (var window in windows)
        {
            if (window.Width is >= 250 and <= 900 && window.Height is >= 120 and <= 500)
            {
                if (bestSmall.Hwnd == IntPtr.Zero || window.Area < bestSmall.Area)
                {
                    bestSmall = window;
                }
            }
        }
        if (bestSmall.Hwnd != IntPtr.Zero) return bestSmall;

        foreach (var window in windows)
        {
            if (window.Title.Contains("RPCS3", StringComparison.OrdinalIgnoreCase)) return window;
        }

        return windows[0];
    }

    private static List<WindowInfo> GetProcessWindows(int pid)
    {
        var windows = new List<WindowInfo>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            GetWindowThreadProcessId(hwnd, out var windowPid);
            if (windowPid != (uint)pid) return true;
            var rectOk = GetWindowRect(hwnd, out var rect);
            if (!rectOk) return true;
            var width = rect.Right - rect.Left;
            var height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0) return true;
            windows.Add(new WindowInfo(hwnd, GetWindowTitle(hwnd), GetClassNameText(hwnd), rect));
            return true;
        }, IntPtr.Zero);

        try
        {
            foreach (ProcessThread thread in Process.GetProcessById(pid).Threads)
            {
                EnumThreadWindows((uint)thread.Id, (hwnd, _) =>
                {
                    if (!IsWindowVisible(hwnd)) return true;
                    var rectOk = GetWindowRect(hwnd, out var rect);
                    if (!rectOk) return true;
                    var width = rect.Right - rect.Left;
                    var height = rect.Bottom - rect.Top;
                    if (width <= 0 || height <= 0) return true;
                    if (windows.Exists(window => window.Hwnd == hwnd)) return true;
                    windows.Add(new WindowInfo(hwnd, GetWindowTitle(hwnd), GetClassNameText(hwnd), rect));
                    return true;
                }, IntPtr.Zero);
            }
        }
        catch
        {
            // Process may exit while polling. The next loop will handle it.
        }

        return windows;
    }

    private static void ActivateWindow(IntPtr hwnd)
    {
        var targetThread = GetWindowThreadProcessId(hwnd, out _);
        var foreground = GetForegroundWindow();
        var foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out _);
        var attached = false;
        if (foregroundThread != 0 && targetThread != 0 && foregroundThread != targetThread)
        {
            attached = AttachThreadInput(foregroundThread, targetThread, true);
        }

        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        SetActiveWindow(hwnd);
        SetFocus(hwnd);
        Thread.Sleep(200);

        if (attached)
        {
            AttachThreadInput(foregroundThread, targetThread, false);
        }
    }

    private static void ClickYesInDialog(RECT rect)
    {
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        var x = rect.Right - Math.Min(180, Math.Max(110, width / 4));
        var y = rect.Bottom - Math.Min(42, Math.Max(30, height / 5));
        ClickScreenPoint(x, y);
    }

    private static void SendKeyboardYes()
    {
        keybd_event((byte)'Y', 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event((byte)'Y', 0, 2, UIntPtr.Zero);
    }

    private static void ClickScreenPoint(int x, int y)
    {
        SetCursorPos(x, y);
        Thread.Sleep(75);
        var virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
        var virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
        var virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        var virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if (virtualWidth <= 0 || virtualHeight <= 0)
        {
            virtualLeft = 0;
            virtualTop = 0;
            virtualWidth = GetSystemMetrics(SM_CXSCREEN);
            virtualHeight = GetSystemMetrics(SM_CYSCREEN);
        }

        var absoluteX = (int)Math.Round((x - virtualLeft) * 65535.0 / Math.Max(1, virtualWidth - 1));
        var absoluteY = (int)Math.Round((y - virtualTop) * 65535.0 / Math.Max(1, virtualHeight - 1));
        var inputs = new[]
        {
            MouseInput(absoluteX, absoluteY, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE),
            MouseInput(absoluteX, absoluteY, MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE),
            MouseInput(absoluteX, absoluteY, MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE),
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    private static string GetWindowTitle(IntPtr hwnd)
    {
        var builder = new StringBuilder(512);
        GetWindowTextW(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    private static string GetClassNameText(IntPtr hwnd)
    {
        var builder = new StringBuilder(256);
        GetClassNameW(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    private static string TrimForLog(string value)
    {
        value = (value ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ').Trim();
        return value.Length > 120 ? value[..120] : value;
    }

    private static int? ReadIntArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (!string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) continue;
            if (int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
            {
                return value;
            }
        }
        return null;
    }

    private static INPUT MouseInput(int x, int y, uint flags)
    {
        return new INPUT
        {
            type = INPUT_MOUSE,
            u = new InputUnion
            {
                mi = new MOUSEINPUT
                {
                    dx = x,
                    dy = y,
                    dwFlags = flags,
                },
            },
        };
    }

    private readonly record struct HelperResult(bool Success, string State);

    private readonly record struct WindowInfo(IntPtr Hwnd, string Title, string ClassName, RECT Rect)
    {
        public int Width => Rect.Right - Rect.Left;
        public int Height => Rect.Bottom - Rect.Top;
        public int Area => Width * Height;
    }

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumThreadWindows(uint dwThreadId, EnumWindowsProc lpfn, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
}
