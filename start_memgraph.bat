@echo off
rem Start Memgraph (+ Memgraph Lab) and load the full Elliptic dataset into it.
rem Replaces whatever graph is already in the database. Extra arguments are
rem passed to scripts\load_elliptic_memgraph.py (e.g. --shards 4).
setlocal
cd /d "%~dp0"

where python >nul 2>&1 || (echo ERROR: python not found on PATH. & goto :fail)

docker info >nul 2>&1 && goto :docker_up
echo Docker is not running, starting Docker Desktop...
rem Docker Desktop installs per-user (%LOCALAPPDATA%\Programs) or for all
rem users (Program Files). Its docker.exe sits in <install>\resources\bin.
set "DD_EXE="
for /f "delims=" %%D in ('where docker.exe 2^>nul') do if not defined DD_EXE if exist "%%~dpD..\..\Docker Desktop.exe" set "DD_EXE=%%~dpD..\..\Docker Desktop.exe"
if not defined DD_EXE if exist "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe" set "DD_EXE=%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
if not defined DD_EXE if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "DD_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not defined DD_EXE (echo ERROR: Docker Desktop.exe not found. Start Docker Desktop yourself and rerun. & goto :fail)
start "" "%DD_EXE%"
set /a tries=0
:wait_docker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1 && goto :docker_up
set /a tries+=1
if %tries% geq 40 (echo ERROR: Docker did not start within 2 minutes. & goto :fail)
echo   waiting for Docker... (%tries%/40)
goto :wait_docker

:docker_up
echo Starting Memgraph...
docker compose up -d memgraph memgraph-lab || (echo ERROR: docker compose up failed. & goto :fail)

python scripts\load_elliptic_memgraph.py %* || goto :fail

echo.
echo Memgraph is running: bolt://localhost:7687, Memgraph Lab at http://localhost:3000
endlocal
pause
exit /b 0

:fail
endlocal
pause
exit /b 1
