import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const screenshot = require('screenshot-desktop');
const runFile = promisify(execFile);

const WIN32 = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class SomaInput {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
 [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
 [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
 public static uint InputTick() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); if (!GetLastInputInfo(ref i)) throw new Exception("Last input state unavailable"); return i.dwTime; }
}
'@
[SomaInput]::SetProcessDPIAware() | Out-Null
`;

export function powershellInvocation(script) {
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference = 'Stop'\n" + script, 'utf16le').toString('base64')] };
}

export function literalSendKeys(text) {
    return text.replace(/\r\n/g, '\n').split('').map(c => {
        if (c === '\n' || c === '\r') return '{ENTER}';
        if (c === '\t') return '{TAB}';
        return '+^%~(){}[]'.includes(c) ? `{${c}}` : c;
    }).join('');
}

export function normalizeKey(key) {
    if (typeof key !== 'string') throw new Error('key must be a supported key or chord');
    const parts = key.toLowerCase().split('+');
    const last = parts.pop();
    const modifiers = { ctrl: '^', alt: '%', shift: '+' };
    if (parts.some(p => !modifiers[p]) || new Set(parts).size !== parts.length) throw new Error('Unsupported key modifier');
    const keys = { enter: '{ENTER}', escape: '{ESC}', tab: '{TAB}', backspace: '{BACKSPACE}', delete: '{DELETE}', home: '{HOME}', end: '{END}', left: '{LEFT}', right: '{RIGHT}', up: '{UP}', down: '{DOWN}', pageup: '{PGUP}', pagedown: '{PGDN}', space: ' ' };
    const value = keys[last] || (/^[a-z0-9]$/.test(last) ? last : /^f([1-9]|1[0-2])$/.test(last) ? `{${last.toUpperCase()}}` : null);
    if (!value) throw new Error('Unsupported key');
    return parts.map(p => modifiers[p]).join('') + value;
}

export function validateDesktopAction(action, frame, now = Date.now()) {
    if (!action || !['mouse_move', 'click', 'double_click', 'right_click', 'type', 'key'].includes(action.type)) throw new Error('Unknown/unsupported action type');
    if (!frame || action.frameId !== frame.frameId || now - frame.observedAt > 30000 || frame.observedAt > now + 1000) throw new Error('Capture a fresh screen and supply its frameId before acting');
    if (!Number.isFinite(frame.observedAt) || !/^\d+$/.test(frame.foreground) || frame.foreground === '0' || !Number.isInteger(frame.inputTick) || frame.inputTick < 0 ||
        !Number.isInteger(frame.dimensions?.width) || frame.dimensions.width <= 0 || !Number.isInteger(frame.dimensions?.height) || frame.dimensions.height <= 0 ||
        !['left', 'top', 'width', 'height'].every(key => Number.isFinite(frame.display?.[key])) || frame.display.width <= 0 || frame.display.height <= 0) throw new Error('Screen geometry or foreground/input state is unavailable');
    const result = { type: action.type };
    if (['mouse_move', 'click', 'double_click', 'right_click'].includes(action.type)) {
        if (!Number.isInteger(action.x) || !Number.isInteger(action.y) || action.x < 0 || action.y < 0 || action.x >= frame.dimensions.width || action.y >= frame.dimensions.height) throw new Error('Coordinates must be integer pixels inside the observed screenshot');
        result.x = Math.round(frame.display.left + action.x * frame.display.width / frame.dimensions.width);
        result.y = Math.round(frame.display.top + action.y * frame.display.height / frame.dimensions.height);
    } else if (action.type === 'type') {
        if (typeof action.text !== 'string' || !action.text.length || action.text.length > 2000 || /\x00/.test(action.text)) throw new Error('text must contain 1–2000 non-NUL characters');
        result.keys = literalSendKeys(action.text);
    } else result.keys = normalizeKey(action.key);
    return result;
}

export function desktopActionScript(action, frame, enforceSafety = true) {
    // No user text is interpolated into executable PowerShell. Payloads are base64 data.
    const encoded = Buffer.from(action.keys || '', 'utf8').toString('base64');
    let script = WIN32;
    script += `\nif ([SomaInput]::GetForegroundWindow().ToInt64().ToString() -ne '${frame.foreground}') { throw 'Foreground window changed; observe again' }\n`;
    if (enforceSafety) script += `if ([SomaInput]::InputTick() -ne ${frame.inputTick}) { throw 'Human input since observation; safety stop' }\n`;
    if (action.keys !== undefined) {
        script += `$somaLiteral = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))\n[System.Windows.Forms.SendKeys]::SendWait($somaLiteral)`;
    } else {
        script += `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${action.x}, ${action.y})\n`;
        if (action.type !== 'mouse_move') {
            const down = action.type === 'right_click' ? 8 : 2, up = action.type === 'right_click' ? 16 : 4;
            const click = `[SomaInput]::mouse_event(${down},0,0,0,[UIntPtr]::Zero); [SomaInput]::mouse_event(${up},0,0,0,[UIntPtr]::Zero)\n`;
            script += click;
            if (action.type === 'double_click') script += 'Start-Sleep -Milliseconds 80\n' + click;
        }
    }
    return script;
}

export default class WindowsDesktopDriver {
    constructor({ run = runFile, capture = screenshot } = {}) { this.run = run; this.screenshot = capture; }
    async runScript(script, signal) {
        if (process.platform !== 'win32') throw new Error('Native desktop input requires Windows');
        const { file, args } = powershellInvocation(script);
        return this.run(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, signal });
    }
    async state(signal) {
        const { stdout } = await this.runScript(WIN32 + `
$somaScreen = [System.Windows.Forms.Screen]::PrimaryScreen
$somaCursor = [System.Windows.Forms.Cursor]::Position
@{ foreground = [SomaInput]::GetForegroundWindow().ToInt64().ToString(); inputTick = [SomaInput]::InputTick(); cursor = @{ x = $somaCursor.X; y = $somaCursor.Y }; display = @{ id = $somaScreen.DeviceName; left = $somaScreen.Bounds.X; top = $somaScreen.Bounds.Y; width = $somaScreen.Bounds.Width; height = $somaScreen.Bounds.Height } } | ConvertTo-Json -Compress
`, signal);
        const value = JSON.parse(stdout.trim());
        if (!/^\d+$/.test(value.foreground) || value.foreground === '0' || !Number.isInteger(value.inputTick) || !value.display?.width || !value.display?.height) throw new Error('No interactive desktop state is available');
        return value;
    }
    async capture() {
        const before = await this.state();
        const buffer = await this.screenshot({ format: 'png', screen: before.display.id });
        const after = await this.state();
        if (before.foreground !== after.foreground || before.inputTick !== after.inputTick || JSON.stringify(before.display) !== JSON.stringify(after.display)) throw new Error('Desktop changed during screenshot capture; retry when idle');
        if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Screen capture returned no PNG frame');
        return { buffer, ...after, dimensions: { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) } };
    }
    async execute(action, frame, { signal, safetyEnabled = true } = {}) {
        await this.runScript(desktopActionScript(action, frame, safetyEnabled), signal);
    }
}
