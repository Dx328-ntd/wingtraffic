@echo off
chcp 65001 >nul
setlocal
title Omni Google Search
cd /d "%~dp0"
set "PORT=3300"
set "URL=http://localhost:%PORT%"

rem --- Da co instance dang chay -> chi mo trinh duyet, khong chay them (tranh loi EADDRINUSE) ---
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo [i] App da chay san o cong %PORT% - dang mo trinh duyet...
  start "" "%URL%"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

rem --- Mo trinh duyet sau 3 giay cho server kip listen ---
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process '%URL%'"

echo ============================================================
echo   Omni Google Search  -  cong %PORT%
echo   Cua vao app      : %URL%/          (tu chuyen toi /admin, /my hoac /login)
echo   Trang gioi thieu : %URL%/gioi-thieu  (form dang ky cho khach)
echo   Bang dieu khien  : %URL%/my
echo   Cau hinh engine  : %URL%/campaign    (chi tai khoan admin)
echo   Chay thu 1 luot : %URL%/test        (chi tai khoan admin)
echo   Dung app        : nhan Ctrl+C tai cua so nay (se don profile tam)
echo ============================================================
echo.

rem --- Nap .env (JWT_SECRET, AUTH_REQUIRED, PORT...) neu co ---
rem OMNI_SUPERVISED=1: bao cho server biet start.bat se chay lai khi server thoat ma 75 (nut "Khoi dong lai server" o /admin)
set "OMNI_SUPERVISED=1"
:run
node --env-file-if-exists=.env server.mjs
if errorlevel 75 if not errorlevel 76 (
  echo.
  echo [i] Dang khoi dong lai server theo yeu cau...
  ping -n 3 127.0.0.1 >nul
  goto run
)
echo.
echo [!] Server da dung (ma thoat %errorlevel%). Nhan phim bat ky de dong cua so...
pause >nul
