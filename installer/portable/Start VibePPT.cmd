@echo off
rem ASCII only, no diacritics: cmd.exe renders this window in the OEM code page.
cd /d "%~dp0"
if not exist ".vibeppt-registered" (
  echo Dang cai dat lan dau, vui long doi mot chut...
  echo.
  call "%~dp0vibeppt.cmd" setup
  if errorlevel 1 goto failed
  echo done>".vibeppt-registered"
  echo.
)
echo Dang mo VibePPT Studio. Trinh duyet se tu bat.
echo Dong cua so nay de tat Studio.
echo.
call "%~dp0vibeppt.cmd" studio
exit /b 0

:failed
echo.
echo Cai dat that bai. Doc thong bao ben tren.
echo Neu khong ro, gui lai toan bo noi dung cua so nay.
echo.
pause
exit /b 1
