@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js instalado.
  echo Instala Node.js 20 o superior y vuelve a abrir este archivo.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
