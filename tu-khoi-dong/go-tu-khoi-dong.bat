@echo off
chcp 65001 >nul
title Omni - Go tu khoi dong
schtasks /Delete /TN "Omni - tu khoi dong" /F
if errorlevel 1 (
  echo [!] Khong thay tac vu "Omni - tu khoi dong" ^(co the chua cai hoac da go roi^).
) else (
  echo [OK] Da go tac vu tu khoi dong.
)
pause
