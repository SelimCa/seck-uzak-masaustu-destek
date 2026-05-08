Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeInput {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

Add-Type -AssemblyName System.Windows.Forms

$MouseEventMove = 0x0001
$MouseEventLeftDown = 0x0002
$MouseEventLeftUp = 0x0004
$MouseEventRightDown = 0x0008
$MouseEventRightUp = 0x0010
$MouseEventMiddleDown = 0x0020
$MouseEventMiddleUp = 0x0040
$MouseEventWheel = 0x0800

function Convert-KeyToken {
    param([string]$Key)

    switch ($Key) {
        'Enter' { return '{ENTER}' }
        'Tab' { return '{TAB}' }
        'Escape' { return '{ESC}' }
        'Backspace' { return '{BACKSPACE}' }
        'Delete' { return '{DELETE}' }
        'ArrowLeft' { return '{LEFT}' }
        'ArrowRight' { return '{RIGHT}' }
        'ArrowUp' { return '{UP}' }
        'ArrowDown' { return '{DOWN}' }
        'Home' { return '{HOME}' }
        'End' { return '{END}' }
        'PageUp' { return '{PGUP}' }
        'PageDown' { return '{PGDN}' }
        'Insert' { return '{INSERT}' }
        'Space' { return ' ' }
        default {
            if ($Key -match '^F([1-9]|1[0-2])$') {
                return "{$Key}"
            }

            if ($Key.Length -eq 1) {
                return $Key
            }

            return $null
        }
    }
}

function Move-CursorIfNeeded {
    param([object]$Payload)

    if ($null -eq $Payload) {
        return
    }

    if ($Payload.PSObject.Properties.Name -contains 'x' -and $Payload.PSObject.Properties.Name -contains 'y') {
        [NativeInput]::SetCursorPos([int]$Payload.x, [int]$Payload.y) | Out-Null
    }
}

function Send-KeyStroke {
    param([object]$Payload)

    $token = Convert-KeyToken -Key $Payload.key
    if (-not $token) {
        return
    }

    $prefix = ''
    if ($Payload.ctrl) { $prefix += '^' }
    if ($Payload.alt) { $prefix += '%' }
    if ($Payload.shift) { $prefix += '+' }

    [System.Windows.Forms.SendKeys]::SendWait($prefix + $token)
}

function Invoke-MouseButton {
    param([string]$Button, [bool]$Down)

    $eventCode = $null

    switch ($Button) {
        'right' {
            if ($Down) {
                $eventCode = $MouseEventRightDown
            }
            else {
                $eventCode = $MouseEventRightUp
            }

            [NativeInput]::mouse_event($eventCode, 0, 0, 0, [UIntPtr]::Zero)
            return
        }
        'middle' {
            if ($Down) {
                $eventCode = $MouseEventMiddleDown
            }
            else {
                $eventCode = $MouseEventMiddleUp
            }

            [NativeInput]::mouse_event($eventCode, 0, 0, 0, [UIntPtr]::Zero)
            return
        }
        default {
            if ($Down) {
                $eventCode = $MouseEventLeftDown
            }
            else {
                $eventCode = $MouseEventLeftUp
            }

            [NativeInput]::mouse_event($eventCode, 0, 0, 0, [UIntPtr]::Zero)
        }
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) {
        break
    }

    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    try {
        $payload = $line | ConvertFrom-Json

        switch ($payload.type) {
            'move' {
                [NativeInput]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null
            }
            'click' {
                Move-CursorIfNeeded -Payload $payload
                Invoke-MouseButton -Button $payload.button -Down $true
                Invoke-MouseButton -Button $payload.button -Down $false
            }
            'doubleClick' {
                Move-CursorIfNeeded -Payload $payload
                Invoke-MouseButton -Button $payload.button -Down $true
                Invoke-MouseButton -Button $payload.button -Down $false
                Start-Sleep -Milliseconds 80
                Invoke-MouseButton -Button $payload.button -Down $true
                Invoke-MouseButton -Button $payload.button -Down $false
            }
            'scroll' {
                [NativeInput]::mouse_event($MouseEventWheel, 0, 0, [uint32]([int]$payload.deltaY), [UIntPtr]::Zero)
            }
            'text' {
                [System.Windows.Forms.SendKeys]::SendWait($payload.text)
            }
            'key' {
                Send-KeyStroke -Payload $payload
            }
        }
    }
    catch {
        Write-Error $_
    }
}