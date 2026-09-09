@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer first.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing required packages...
  call npm install
  if errorlevel 1 (
    echo Installation failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Created local settings.
)
node -e "const fs=require('node:fs'),c=require('node:crypto'),p='.env',s=fs.readFileSync(p,'utf8');if(/^SESSION_SECRET=\s*$/m.test(s)){fs.writeFileSync(p,s.replace(/^SESSION_SECRET=\s*$/m,'SESSION_SECRET='+c.randomBytes(32).toString('hex')));console.log('Created a secure session key.')}"

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
echo The site will open at http://localhost:3000
echo Keep this window open. Press Ctrl+C to stop the site.
call npm run dev
pause
