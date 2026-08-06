@echo off
rem ASCII only, no diacritics: cmd.exe renders this window in the OEM code page.
cd /d "%~dp0"
echo Dang go VibePPT khoi may...
echo.
call "%~dp0vibeppt.cmd" setup --remove
if exist ".vibeppt-registered" del ".vibeppt-registered"
echo.
echo Buoc cuoi: dong cua so nay, roi xoa thu muc VibePPT.
echo Cac file thuyet trinh ban da tao khong bi anh huong.
echo.
pause
