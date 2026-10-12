@echo off
cd /d "%~dp0"
if not exist .env (
  echo [ERREUR] Le fichier .env n'existe pas.
  echo Copie .env.example en .env puis remplis DISCORD_TOKEN et CLIENT_ID.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installation des dependances...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
npm start
pause
