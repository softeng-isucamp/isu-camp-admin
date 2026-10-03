@echo off
:: Share mode selection and lifecycle handling with the PowerShell runner.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
exit /b %ERRORLEVEL%
