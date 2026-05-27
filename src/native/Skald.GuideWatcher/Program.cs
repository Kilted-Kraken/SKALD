using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text.Json;

var options = WatcherOptions.Parse(args);
if (string.IsNullOrWhiteSpace(options.EventPipe))
{
    Console.Error.WriteLine("Missing required --event-pipe argument.");
    return 1;
}

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};
AppDomain.CurrentDomain.ProcessExit += (_, _) => cts.Cancel();

var watcher = new GuideWatcher(options);
await watcher.RunAsync(cts.Token);
return 0;

sealed class GuideWatcher
{
    private readonly WatcherOptions _options;
    private ushort _previousButtons;
    private bool _hasPreviousState;

    public GuideWatcher(WatcherOptions options)
    {
        _options = options;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                if (TryGetState(_options.UserIndex, out var state))
                {
                    var currentButtons = state.Gamepad.Buttons;
                    if (IsButtonPressed(currentButtons, _previousButtons, XInputGamepadButtons.Guide))
                    {
                        await SendHostEventAsync("guide", cancellationToken).ConfigureAwait(false);
                    }
                    _previousButtons = currentButtons;
                    _hasPreviousState = true;
                }
                else
                {
                    _hasPreviousState = false;
                    _previousButtons = 0;
                }
            }
            catch
            {
                _hasPreviousState = false;
                _previousButtons = 0;
            }

            try
            {
                await Task.Delay(_options.PollMs, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private bool IsButtonPressed(ushort current, ushort previous, XInputGamepadButtons button)
    {
        var effectivePrevious = _hasPreviousState ? previous : (ushort)0;
        var mask = (ushort)button;
        return (current & mask) != 0 && (effectivePrevious & mask) == 0;
    }

    private async Task SendHostEventAsync(string action, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_options.EventPipe) || string.IsNullOrWhiteSpace(action)) return;
        await using var client = new NamedPipeClientStream(".", _options.EventPipe, PipeDirection.Out, PipeOptions.Asynchronous);
        await client.ConnectAsync(Math.Max(100, _options.ConnectTimeoutMs), cancellationToken).ConfigureAwait(false);
        await using var writer = new StreamWriter(client) { AutoFlush = true };
        var payload = JsonSerializer.Serialize(new { action });
        await writer.WriteAsync(payload.AsMemory(), cancellationToken).ConfigureAwait(false);
    }

    private static bool TryGetState(uint userIndex, out XInputState state)
    {
        state = default;
        try
        {
            var result = XInputGetStateEx(userIndex, out state);
            if (result == 0) return true;
        }
        catch
        {
            // Fall through to the standard API for environments where the extended ordinal isn't available.
        }

        try
        {
            var result = XInputGetState(userIndex, out state);
            return result == 0;
        }
        catch
        {
            state = default;
            return false;
        }
    }

    [DllImport("xinput1_4.dll", EntryPoint = "#100", CallingConvention = CallingConvention.StdCall)]
    private static extern uint XInputGetStateEx(uint dwUserIndex, out XInputState pState);

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
        Guide = 0x0400,
    }
}

sealed record WatcherOptions(string EventPipe, int PollMs, int ConnectTimeoutMs, uint UserIndex)
{
    public static WatcherOptions Parse(IEnumerable<string> args)
    {
        string eventPipe = string.Empty;
        var pollMs = 35;
        var connectTimeoutMs = 250;
        uint userIndex = 0;

        var values = args.ToArray();
        for (var i = 0; i < values.Length; i += 1)
        {
            var arg = values[i];
            if (arg.Equals("--event-pipe", StringComparison.OrdinalIgnoreCase) && i + 1 < values.Length)
            {
                eventPipe = values[++i].Trim();
                continue;
            }
            if (arg.Equals("--poll-ms", StringComparison.OrdinalIgnoreCase) && i + 1 < values.Length)
            {
                if (int.TryParse(values[++i], out var parsedPoll) && parsedPoll >= 10 && parsedPoll <= 1000)
                {
                    pollMs = parsedPoll;
                }
                continue;
            }
            if (arg.Equals("--connect-timeout-ms", StringComparison.OrdinalIgnoreCase) && i + 1 < values.Length)
            {
                if (int.TryParse(values[++i], out var parsedTimeout) && parsedTimeout >= 50 && parsedTimeout <= 5000)
                {
                    connectTimeoutMs = parsedTimeout;
                }
                continue;
            }
            if (arg.Equals("--user-index", StringComparison.OrdinalIgnoreCase) && i + 1 < values.Length)
            {
                if (uint.TryParse(values[++i], out var parsedIndex) && parsedIndex <= 3)
                {
                    userIndex = parsedIndex;
                }
            }
        }

        return new WatcherOptions(eventPipe, pollMs, connectTimeoutMs, userIndex);
    }
}
