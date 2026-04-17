# capture-screenshot.ps1
# Captures the running LTCast Electron window and saves to resources/screenshot.png.
# Usage: pwsh ./scripts/capture-screenshot.ps1 [-OutPath <path>] [-WindowTitle <title>]

param(
    [string]$OutPath = "resources/screenshot.png",
    [string]$WindowTitle = "LTCast"
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Find the Electron window — match by title AND process name
# (avoid matching browser tabs whose title contains "LTCast")
$proc = Get-Process | Where-Object {
    $_.ProcessName -eq 'electron' -and
    $_.MainWindowTitle -match [regex]::Escape($WindowTitle) -and
    $_.MainWindowHandle -ne 0
} | Select-Object -First 1

if (-not $proc) {
    Write-Error "No visible window with title matching '$WindowTitle' found. Launch 'npm run dev' first and wait for the Electron window to appear."
    exit 1
}

Write-Host "Found window: '$($proc.MainWindowTitle)' (PID $($proc.Id))"

# Bring window to foreground so no other app overlaps
[Win32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
[Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400

# Prefer DWM bounds (excludes invisible resize borders on Win10/11). Fall back to GetWindowRect.
$rect = New-Object Win32+RECT
$dwmOk = [Win32]::DwmGetWindowAttribute($proc.MainWindowHandle, 9, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect)) -eq 0
if (-not $dwmOk) {
    [Win32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
}

$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) {
    Write-Error "Invalid window rect ${w}x${h} — is the window minimised?"
    exit 2
}

Write-Host "Capturing ${w}x${h} at ($($rect.Left), $($rect.Top)) via PrintWindow..."

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT = 0x00000002 — required for Chromium/Electron content
$ok = [Win32]::PrintWindow($proc.MainWindowHandle, $hdc, 2)
$g.ReleaseHdc($hdc)
if (-not $ok) {
    Write-Warning "PrintWindow returned false — falling back to screen copy"
    $g2 = [System.Drawing.Graphics]::FromImage($bmp)
    $g2.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    $g2.Dispose()
}

# Resolve out path relative to repo root (assume script is run from repo root)
$full = [System.IO.Path]::GetFullPath($OutPath)
$dir = [System.IO.Path]::GetDirectoryName($full)
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

$size = (Get-Item $full).Length
Write-Host "Saved: $full ($size bytes, ${w}x${h})"
