@echo off
chcp 65001 >nul
setlocal
title Omni - Cai tu khoi dong cung Windows
set "OMNI_DIR=%~dp0.."
for %%I in ("%OMNI_DIR%") do set "OMNI_DIR=%%~fI"

echo ============================================================
echo   OMNI - TU KHOI DONG KHI DANG NHAP WINDOWS
echo   Thu muc app: %OMNI_DIR%
echo ============================================================
echo.
echo File nay tao mot tac vu trong Task Scheduler ten "Omni - tu khoi dong":
echo   moi lan ban dang nhap Windows ^(ke ca khi vao lai RDP sau khi may khoi dong lai^),
echo   se tu mo start.bat sau 30 giay ^(doi OmniLogin va mang san sang^).
echo Neu app dang chay san thi start.bat chi mo trinh duyet, khong chay them ban nua.
echo.

if not exist "%OMNI_DIR%\start.bat" (
  echo [X] Khong thay start.bat trong %OMNI_DIR%
  pause
  exit /b 1
)

schtasks /Create /TN "Omni - tu khoi dong" /TR "\"%OMNI_DIR%\start.bat\"" /SC ONLOGON /DELAY 0000:30 /F
if errorlevel 1 (
  echo.
  echo [X] Khong tao duoc tac vu. Thu bam chuot phai file nay ^> Run as administrator.
  pause
  exit /b 1
)

echo.
echo [OK] Da cai. Kiem tra: mo Task Scheduler ^> Task Scheduler Library ^> "Omni - tu khoi dong".
echo      Go bo: chay file go-tu-khoi-dong.bat
echo.
echo Luu y: Windows chi chay tac vu nay khi co nguoi DANG NHAP. Tren RDP, sau khi may khoi dong lai
echo        hay dang nhap RDP mot lan; sau do dong cua so RDP bang nut X ^(Disconnect^), dung Sign out.
pause
