using System.Runtime.InteropServices;
using System.IO.Pipes;
using System.Text.Json;
using LibVLCSharp.Shared;
using LibVLCSharp.WinForms;

namespace Skald.VlcHost;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var options = PlayerOptions.Parse(args);
        if (string.IsNullOrWhiteSpace(options.Url))
        {
            MessageBox.Show("No media URL was provided to the SKALD VLC host.", "SKALD VLC Host", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        Core.Initialize();
        ApplicationConfiguration.Initialize();
        using var form = new PlayerForm(options);
        Application.Run(form);
        return 0;
    }
}

internal sealed class PlayerOptions
{
    public string Url { get; init; } = string.Empty;
    public string Title { get; init; } = "SKALD Video Player";
    public int X { get; init; } = -1;
    public int Y { get; init; } = -1;
    public int Width { get; init; } = 1280;
    public int Height { get; init; } = 720;
    public bool Borderless { get; init; }
    public bool TopMost { get; init; }
    public nint ParentHwnd { get; init; }
    public string ControlPipe { get; init; } = string.Empty;
    public string EventPipe { get; init; } = string.Empty;
    public bool AudioOnly { get; init; }

    public static PlayerOptions Parse(IReadOnlyList<string> args)
    {
        string url = string.Empty;
        string title = "SKALD Video Player";
        var x = -1;
        var y = -1;
        var width = 1280;
        var height = 720;
        var borderless = false;
        var topMost = false;
        nint parentHwnd = 0;
        string controlPipe = string.Empty;
        string eventPipe = string.Empty;
        var audioOnly = false;
        for (var i = 0; i < args.Count; i += 1)
        {
            var arg = args[i] ?? string.Empty;
            if (arg.Equals("--url", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count)
            {
                url = args[++i] ?? string.Empty;
                continue;
            }
            if (arg.Equals("--title", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count)
            {
                title = args[++i] ?? title;
                continue;
            }
            if (arg.Equals("--x", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count && int.TryParse(args[++i], out var nextX))
            {
                x = nextX;
                continue;
            }
            if (arg.Equals("--y", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count && int.TryParse(args[++i], out var nextY))
            {
                y = nextY;
                continue;
            }
            if (arg.Equals("--width", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count && int.TryParse(args[++i], out var nextWidth))
            {
                width = Math.Max(320, nextWidth);
                continue;
            }
            if (arg.Equals("--height", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count && int.TryParse(args[++i], out var nextHeight))
            {
                height = Math.Max(180, nextHeight);
                continue;
            }
            if (arg.Equals("--borderless", StringComparison.OrdinalIgnoreCase))
            {
                borderless = true;
                continue;
            }
            if (arg.Equals("--topmost", StringComparison.OrdinalIgnoreCase))
            {
                topMost = true;
                continue;
            }
            if (arg.Equals("--parent-hwnd", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count)
            {
                var raw = args[++i] ?? string.Empty;
                if (TryParsePointer(raw, out var parsed))
                {
                    parentHwnd = parsed;
                }
                continue;
            }
            if (arg.Equals("--control-pipe", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count)
            {
                controlPipe = args[++i] ?? string.Empty;
                continue;
            }
            if (arg.Equals("--event-pipe", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count)
            {
                eventPipe = args[++i] ?? string.Empty;
                continue;
            }
            if (arg.Equals("--audio-only", StringComparison.OrdinalIgnoreCase))
            {
                audioOnly = true;
                continue;
            }
            if (string.IsNullOrWhiteSpace(url) && !arg.StartsWith("--", StringComparison.Ordinal))
            {
                url = arg;
            }
        }
        return new PlayerOptions
        {
            Url = url.Trim(),
            Title = string.IsNullOrWhiteSpace(title) ? "SKALD Video Player" : title.Trim(),
            X = x,
            Y = y,
            Width = width,
            Height = height,
            Borderless = borderless,
            TopMost = topMost,
            ParentHwnd = parentHwnd,
            ControlPipe = string.IsNullOrWhiteSpace(controlPipe) ? string.Empty : controlPipe.Trim(),
            EventPipe = string.IsNullOrWhiteSpace(eventPipe) ? string.Empty : eventPipe.Trim(),
            AudioOnly = audioOnly,
        };
    }

    private static bool TryParsePointer(string value, out nint result)
    {
        result = 0;
        var raw = (value ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(raw)) return false;
        if (raw.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            raw = raw[2..];
        }
        if (ulong.TryParse(raw, System.Globalization.NumberStyles.HexNumber, null, out var hex))
        {
            result = (nint)hex;
            return true;
        }
        if (long.TryParse(raw, out var dec))
        {
            result = (nint)dec;
            return true;
        }
        return false;
    }
}

internal sealed class PlayerForm : Form
{
    private const int GwlStyle = -16;
    private const int WsChild = 0x40000000;
    private const int WsVisible = 0x10000000;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint SetParent(nint hWndChild, nint hWndNewParent);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern nint GetWindowLongPtr(nint hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern nint SetWindowLongPtr(nint hWnd, int nIndex, nint dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool MoveWindow(nint hWnd, int x, int y, int nWidth, int nHeight, bool bRepaint);

    private readonly LibVLC _libVlc;
    private readonly MediaPlayer _mediaPlayer;
    private readonly VideoView _videoView;
    private readonly Label _errorLabel;
    private readonly PlayerOptions _options;
    private CancellationTokenSource? _controlLoopCts;
    private readonly System.Windows.Forms.Timer _xinputTimer;
    private XInputState _lastXInputState;
    private bool _hasXInputState;

    public PlayerForm(PlayerOptions options)
    {
        _options = options;
        Text = options.Title;
        StartPosition = options.X >= 0 && options.Y >= 0 ? FormStartPosition.Manual : FormStartPosition.CenterScreen;
        BackColor = Color.Black;
        KeyPreview = true;
        if (!options.AudioOnly && options.ParentHwnd == 0)
        {
            MinimumSize = new Size(960, 600);
        }
        if (options.Borderless || options.AudioOnly)
        {
            FormBorderStyle = FormBorderStyle.None;
            MaximizeBox = false;
            MinimizeBox = false;
        }
        ShowInTaskbar = !options.AudioOnly;
        if (options.X >= 0 && options.Y >= 0)
        {
            Location = new Point(options.X, options.Y);
        }
        Size = options.AudioOnly ? new Size(1, 1) : new Size(Math.Max(320, options.Width), Math.Max(180, options.Height));
        TopMost = options.AudioOnly ? false : options.TopMost;
        if (options.AudioOnly)
        {
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            Opacity = 0;
        }

        Shown += (_, _) =>
        {
            if (_options.ParentHwnd != 0 && !_options.AudioOnly)
            {
                AttachToParent(_options.ParentHwnd, _options.X, _options.Y, _options.Width, _options.Height);
            }
        };

        _videoView = new VideoView
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black,
        };

        _errorLabel = new Label
        {
            Dock = DockStyle.Bottom,
            Height = 36,
            ForeColor = Color.White,
            BackColor = Color.FromArgb(32, 32, 32),
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(12, 0, 12, 0),
            Visible = false,
        };

        if (!options.AudioOnly)
        {
            Controls.Add(_videoView);
        }
        Controls.Add(_errorLabel);

        _libVlc = new LibVLC(
            "--no-video-title-show",
            "--quiet"
        );
        _mediaPlayer = new MediaPlayer(_libVlc);
        _videoView.MediaPlayer = _mediaPlayer;
        _xinputTimer = new System.Windows.Forms.Timer
        {
            Interval = 90,
            Enabled = false,
        };
        _xinputTimer.Tick += (_, _) => PollXInput();

        _mediaPlayer.EncounteredError += (_, _) => BeginInvoke(() =>
        {
            _errorLabel.Text = "The SKALD VLC host could not play this video.";
            _errorLabel.Visible = true;
        });

        _mediaPlayer.EndReached += (_, _) => BeginInvoke(Close);

        Load += (_, _) =>
        {
            PlayUri(options.Url);
            StartControlLoop();
            if (!options.AudioOnly)
            {
                _xinputTimer.Start();
            }
        };

        FormClosed += (_, _) =>
        {
            try { _controlLoopCts?.Cancel(); } catch {}
            _controlLoopCts?.Dispose();
            _xinputTimer.Stop();
            _xinputTimer.Dispose();
            _videoView.MediaPlayer = null;
            _mediaPlayer.Dispose();
            _libVlc.Dispose();
        };

        KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Escape)
            {
                Close();
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.Space)
            {
                if (_mediaPlayer.IsPlaying) _mediaPlayer.Pause();
                else _mediaPlayer.Play();
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.Enter && e.Alt)
            {
                WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                e.Handled = true;
            }
        };
    }

    private void StartControlLoop()
    {
        if (string.IsNullOrWhiteSpace(_options.ControlPipe)) return;
        _controlLoopCts = new CancellationTokenSource();
        var token = _controlLoopCts.Token;
        _ = Task.Run(async () =>
        {
            while (!token.IsCancellationRequested && !IsDisposed)
            {
                try
                {
                    using var server = new NamedPipeServerStream(
                        _options.ControlPipe,
                        PipeDirection.In,
                        1,
                        PipeTransmissionMode.Message,
                        PipeOptions.Asynchronous
                    );
                    await server.WaitForConnectionAsync(token).ConfigureAwait(false);
                    using var reader = new StreamReader(server);
                    var payload = await reader.ReadToEndAsync().ConfigureAwait(false);
                    if (!string.IsNullOrWhiteSpace(payload))
                    {
                        HandleControlPayload(payload);
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch
                {
                    // Ignore bad control payloads and keep serving future commands.
                }
            }
        }, token);
    }

    private void HandleControlPayload(string payload)
    {
        try
        {
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;
            var command = new ControlCommand
            {
                Name = root.TryGetProperty("command", out var commandProp)
                    ? (commandProp.GetString() ?? string.Empty).Trim().ToLowerInvariant()
                    : string.Empty,
                X = ReadInt(root, "x", Left),
                Y = ReadInt(root, "y", Top),
                Width = ReadInt(root, "width", Width),
                Height = ReadInt(root, "height", Height),
                Url = root.TryGetProperty("url", out var urlProp) ? (urlProp.GetString() ?? string.Empty).Trim() : string.Empty,
                Title = root.TryGetProperty("title", out var titleProp) ? (titleProp.GetString() ?? string.Empty).Trim() : string.Empty,
            };
            if (string.IsNullOrWhiteSpace(command.Name)) return;
            BeginInvoke(() => ApplyControlCommand(command));
        }
        catch
        {
            // Ignore malformed payloads.
        }
    }

    private void ApplyControlCommand(ControlCommand command)
    {
        switch (command.Name)
        {
            case "playpause":
                if (_mediaPlayer.IsPlaying) _mediaPlayer.Pause();
                else _mediaPlayer.Play();
                break;
            case "play":
                _mediaPlayer.Play();
                break;
            case "pause":
                if (_mediaPlayer.IsPlaying) _mediaPlayer.Pause();
                break;
            case "stop":
                _mediaPlayer.Stop();
                break;
            case "close":
                Close();
                break;
            case "bounds":
                ApplyBoundsCommand(command);
                break;
            case "load":
                ApplyLoadCommand(command);
                break;
            case "rewind":
                SeekRelative(-10000);
                break;
            case "fastforward":
                SeekRelative(10000);
                break;
        }
    }

    private void ApplyBoundsCommand(ControlCommand command)
    {
        if (_options.AudioOnly) return;
        var x = command.X;
        var y = command.Y;
        var width = Math.Max(320, command.Width);
        var height = Math.Max(180, command.Height);
        if (_options.ParentHwnd != 0)
        {
            try
            {
                MoveWindow(Handle, Math.Max(0, x), Math.Max(0, y), width, height, true);
            }
            catch {}
            return;
        }
        SetBounds(x, y, width, height);
    }

    private void ApplyLoadCommand(ControlCommand command)
    {
        var url = command.Url;
        if (string.IsNullOrWhiteSpace(url)) return;
        var title = command.Title;
        if (!string.IsNullOrWhiteSpace(title))
        {
            Text = title;
        }
        PlayUri(url);
    }

    private void PlayUri(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        using var media = new Media(_libVlc, new Uri(url));
        _mediaPlayer.Play(media);
    }

    private void SeekRelative(long deltaMs)
    {
        try
        {
            var length = _mediaPlayer.Length;
            var current = _mediaPlayer.Time;
            var next = Math.Max(0, current + deltaMs);
            if (length > 0)
            {
                next = Math.Min(length, next);
            }
            _mediaPlayer.Time = next;
        }
        catch
        {
            // Ignore seek failures for streams that do not support seeking.
        }
    }

    private void PollXInput()
    {
        if (_options.AudioOnly) return;
        try
        {
            var result = XInputGetState(0, out var state);
            if (result != 0)
            {
                _hasXInputState = false;
                return;
            }

            var previousButtons = _hasXInputState ? _lastXInputState.Gamepad.Buttons : (ushort)0;
            var currentButtons = state.Gamepad.Buttons;

            if (IsButtonPressed(currentButtons, previousButtons, XInputGamepadButtons.A))
            {
                if (_mediaPlayer.IsPlaying) _mediaPlayer.Pause();
                else _mediaPlayer.Play();
                SendHostEvent("playpause");
            }
            if (IsButtonPressed(currentButtons, previousButtons, XInputGamepadButtons.X))
            {
                _mediaPlayer.Stop();
                SendHostEvent("stop");
            }
            if (IsButtonPressed(currentButtons, previousButtons, XInputGamepadButtons.LeftShoulder))
            {
                SendHostEvent("previous");
            }
            if (IsButtonPressed(currentButtons, previousButtons, XInputGamepadButtons.RightShoulder))
            {
                SendHostEvent("next");
            }
            if (IsButtonPressed(currentButtons, previousButtons, XInputGamepadButtons.B))
            {
                SendHostEvent("back");
            }

            var previousLt = _hasXInputState ? _lastXInputState.Gamepad.LeftTrigger : (byte)0;
            var previousRt = _hasXInputState ? _lastXInputState.Gamepad.RightTrigger : (byte)0;
            if (state.Gamepad.LeftTrigger > 30 && previousLt <= 30)
            {
                SeekRelative(-10000);
                SendHostEvent("rewind");
            }
            if (state.Gamepad.RightTrigger > 30 && previousRt <= 30)
            {
                SeekRelative(10000);
                SendHostEvent("fastforward");
            }

            _lastXInputState = state;
            _hasXInputState = true;
        }
        catch
        {
            // Ignore controller polling failures and keep playback alive.
        }
    }

    private static bool IsButtonPressed(ushort current, ushort previous, XInputGamepadButtons button)
    {
        var mask = (ushort)button;
        return (current & mask) != 0 && (previous & mask) == 0;
    }

    private void SendHostEvent(string action)
    {
        if (string.IsNullOrWhiteSpace(_options.EventPipe) || string.IsNullOrWhiteSpace(action)) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await using var client = new NamedPipeClientStream(".", _options.EventPipe, PipeDirection.Out, PipeOptions.Asynchronous);
                await client.ConnectAsync(250).ConfigureAwait(false);
                await using var writer = new StreamWriter(client) { AutoFlush = true };
                var payload = JsonSerializer.Serialize(new { action });
                await writer.WriteAsync(payload).ConfigureAwait(false);
            }
            catch
            {
                // Ignore event propagation failures; local playback should still work.
            }
        });
    }

    private static int ReadInt(JsonElement root, string propertyName, int fallback)
    {
        if (!root.TryGetProperty(propertyName, out var prop)) return fallback;
        if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt32(out var number)) return number;
        if (prop.ValueKind == JsonValueKind.String && int.TryParse(prop.GetString(), out var parsed)) return parsed;
        return fallback;
    }

    private sealed class ControlCommand
    {
        public string Name { get; init; } = string.Empty;
        public int X { get; init; }
        public int Y { get; init; }
        public int Width { get; init; }
        public int Height { get; init; }
        public string Url { get; init; } = string.Empty;
        public string Title { get; init; } = string.Empty;
    }

    [DllImport("xinput1_4.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint XInputGetState(uint dwUserIndex, out XInputState pState);

    [StructLayout(LayoutKind.Sequential)]
    private struct XInputState
    {
        public uint PacketNumber;
        public XInputGamepad Gamepad;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct XInputGamepad
    {
        public ushort Buttons;
        public byte LeftTrigger;
        public byte RightTrigger;
        public short ThumbLX;
        public short ThumbLY;
        public short ThumbRX;
        public short ThumbRY;
    }

    [Flags]
    private enum XInputGamepadButtons : ushort
    {
        DPadUp = 0x0001,
        DPadDown = 0x0002,
        DPadLeft = 0x0004,
        DPadRight = 0x0008,
        Start = 0x0010,
        Back = 0x0020,
        LeftThumb = 0x0040,
        RightThumb = 0x0080,
        LeftShoulder = 0x0100,
        RightShoulder = 0x0200,
        A = 0x1000,
        B = 0x2000,
        X = 0x4000,
        Y = 0x8000,
    }

    private void AttachToParent(nint parentHwnd, int x, int y, int width, int height)
    {
        try
        {
            TopLevel = false;
            var style = GetWindowLongPtr(Handle, GwlStyle).ToInt64();
            style |= WsChild | WsVisible;
            SetWindowLongPtr(Handle, GwlStyle, (nint)style);
            SetParent(Handle, parentHwnd);
            MoveWindow(Handle, Math.Max(0, x), Math.Max(0, y), Math.Max(320, width), Math.Max(180, height), true);
        }
        catch
        {
            // Fall back to normal top-level window behavior if parenting fails.
        }
    }
}
