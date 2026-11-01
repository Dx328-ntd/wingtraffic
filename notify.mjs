import { spawn } from 'node:child_process';

const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;

export function focusProfileWindow(profileName) {
  if (process.platform !== 'win32' || !profileName) return;
  const script = `
Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, int f, int e);'
$name = ${psQuote(profileName)}
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle.StartsWith($name) } | Select-Object -First 1
if ($p) {
  $h = $p.MainWindowHandle
  if ([U.W]::IsIconic($h)) { [void][U.W]::ShowWindow($h, 9) }
  [U.W]::keybd_event(0x12, 0, 0, 0)
  [void][U.W]::SetForegroundWindow($h)
  [U.W]::keybd_event(0x12, 0, 2, 0)
}`;
  runPs(script);
}

function runPs(script) {
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      stdio: 'ignore', windowsHide: true,
    });
    p.unref();
  } catch {}
}

export function notifyWindows(title, text) {
  if (process.platform !== 'win32') return;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Media.SystemSounds]::Exclamation.Play()
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Warning
$n.BalloonTipIcon = 'Warning'
$n.BalloonTipTitle = ${psQuote(title)}
$n.BalloonTipText = ${psQuote(text)}
$n.Visible = $true
$n.ShowBalloonTip(10000)
Start-Sleep -Seconds 10
$n.Dispose()`;
  runPs(script);
}
