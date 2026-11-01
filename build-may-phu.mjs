import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_BASE = path.resolve(ROOT, '..', 'Omni may phu');
const OUT = path.join(OUT_BASE, 'may-phu');

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const copyDir = (from, to, filter = () => true) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (!filter(a, e)) continue;
    if (e.isDirectory()) copyDir(a, b, filter); else copy(a, b);
  }
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

copy(path.join(ROOT, 'agent', 'agent.mjs'), path.join(OUT, 'agent', 'agent.mjs'));
copy(path.join(ROOT, 'agent', 'agent.config.example.json'), path.join(OUT, 'agent', 'agent.config.example.json'));
copyDir(path.join(ROOT, 'workflow'), path.join(OUT, 'workflow'), (p, e) => e.isDirectory() || p.endsWith('.mjs'));
for (const f of ['campaign-types.mjs', 'proxy-pool.mjs', 'omnilogin-launcher.mjs', 'monitor.mjs', 'package-hash.mjs']) copy(path.join(ROOT, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'wingtraffic-may-phu', version: '1.0.0', private: true, type: 'module' }, null, 2));
copyDir(path.join(ROOT, 'node_modules', '@omnilogin'), path.join(OUT, 'node_modules', '@omnilogin'));
copy(process.execPath, path.join(OUT, 'node.exe'));

const CRLF = s => s.replace(/\r?\n/g, '\r\n');
fs.writeFileSync(path.join(OUT, 'chay-may-phu.bat'), CRLF(`@echo off
title WingTraffic - May phu
cd /d "%~dp0"
set "NODE=%~dp0node.exe"
if not exist "%NODE%" set "NODE=node"
:loop
"%NODE%" agent\\agent.mjs
echo.
echo May phu da dung - thu lai sau 10 giay (dong cua so nay de thoat hoan toan)...
timeout /t 10 >nul
goto loop
`));
fs.writeFileSync(path.join(OUT, 'cai-tu-chay.bat'), CRLF(`@echo off
rem Cai may phu TU CHAY moi khi dang nhap Windows: dat 1 file khoi dong vao thu muc Startup cua nguoi dung (khong can quyen Admin).
set "ST=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
> "%ST%\\WingTraffic-May-Phu.bat" echo @echo off
>> "%ST%\\WingTraffic-May-Phu.bat" echo start "WingTraffic May phu" /min cmd /c ""%~dp0chay-may-phu.bat""
if exist "%ST%\\WingTraffic-May-Phu.bat" (
  echo Da cai: may phu se tu chay moi khi dang nhap Windows.
  echo Go bo: xoa file "%ST%\\WingTraffic-May-Phu.bat"
) else (
  echo Cai that bai. Cach thu cong: bam Windows+R, go shell:startup, tao shortcut tro toi chay-may-phu.bat
)
pause
`));
fs.writeFileSync(path.join(OUT, 'HUONG-DAN.txt'), '\uFEFF' + CRLF(`MAY PHU WINGTRAFFIC - HUONG DAN CAI DAT (5 buoc)
================================================

May phu chi lam mot viec: nhan tung luot chay tu MAY CHINH, mo profile OmniLogin cua CHINH may nay, chay xong gui ket qua ve.
May phu tu goi RA may chinh (https) nen KHONG can mo cong, KHONG can ten mien.

1. Cai OmniLogin tren may phu, dang nhap, bat Preferences > Enable Bridge API (giong may chinh).
   Tao san cac profile dung cho proxy xoay (neu dung che do "omni") - ten profile phai KHOP voi danh sach "profiles" o buoc 3.

2. Giai nen thu muc may-phu vao mot cho co dinh, vi du C:\\may-phu.

3. Lay KHOA: tren may chinh vao http://localhost:3300/admin > He thong > May phu > nhap ten > "Tao may phu & lay khoa".
   Chep noi dung khung vua hien ra vao file agent\\agent.config.json (copy tu agent.config.example.json neu chua co).
   Sua cho dung may nay:
     "threads"   : so luong chay cung luc (tuy RAM may phu, thuong 3-5)
     "profiles"  : ten cac profile OmniLogin cua may phu (so profile >= threads)
     "rotateSec" : thoi gian doi IP cua nha cung cap proxy (giay)

4. Bam dup chay-may-phu.bat. Cua so hien "May phu khoi dong" va "Luong N: nhan luot..." la dang chay.
   Tren may chinh, trang Admin > May phu se hien may nay "Online".
   Muon tu chay khi may khoi dong lai: bam dup cai-tu-chay.bat (1 lan).

5. DUNG DONG cua so chay-may-phu.bat (dong la dung may phu). Khi dong RDP hay bam Disconnect, KHONG bam Sign out.

Ghi chu
- Mat khoa / nghi lo khoa: o trang May phu tren may chinh bam "Doi khoa", roi cap nhat agent.config.json.
- Tat tam may phu: bam "Tat" o trang May phu tren may chinh (khong can vao may phu).
- Cac thiet lap chung (thoi gian o lai, ti le 70/30, CapSolver...) lay tu may chinh. Rieng proxy/profile, chay an, RAM toi thieu do may phu tu khai bao trong agent.config.json.
- Nhat ky hien trong cua so chay-may-phu.bat.
`));

fs.mkdirSync(OUT_BASE, { recursive: true });
fs.writeFileSync(path.join(OUT_BASE, 'zip-may-phu.ps1'), CRLF(`Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = Join-Path $PSScriptRoot 'may-phu'
$zip = Join-Path $PSScriptRoot 'may-phu.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$za = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
Get-ChildItem $src -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length + 1).Replace('\\', '/')
  $e = $za.CreateEntry('may-phu/' + $rel, [System.IO.Compression.CompressionLevel]::Optimal)
  $in = [System.IO.File]::OpenRead($_.FullName); $out = $e.Open(); $in.CopyTo($out); $out.Dispose(); $in.Dispose()
}
$za.Dispose(); $fs.Dispose()
Write-Host ('Da tao ' + $zip + ' (' + [math]::Round((Get-Item $zip).Length / 1MB, 1) + ' MB)')
`));
console.log('Đã dựng gói máy phụ tại', OUT);
console.log('Nén zip: powershell -File "' + path.join(OUT_BASE, 'zip-may-phu.ps1') + '"');
