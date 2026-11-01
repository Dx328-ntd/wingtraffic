@echo off
rem Chay server Omni va TU CHAY LAI khi server thoat (kể cả nut "Khoi dong lai server" trong Admin).
cd /d "C:\CONG VIEC\CLOUD CODE\Omni"
:loop
"C:\Program Files\nodejs\node.exe" --env-file-if-exists=.env server.mjs >> "C:\CONG VIEC\CLOUD CODE\Omni\server-task.log" 2>&1
echo [%date% %time%] Server thoat, chay lai sau 3 giay... >> "C:\CONG VIEC\CLOUD CODE\Omni\server-task.log"
timeout /t 3 /nobreak >nul
goto loop
