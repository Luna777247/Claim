@echo off
echo ===================================================
echo [1/2] Parsing Excel Ontology data...
python parser/parser.py
if %ERRORLEVEL% NEQ 0 (
    echo Error: Python parser failed!
    exit /b %ERRORLEVEL%
)

echo.
echo [2/2] Generating HTML, SVG, PNG, and PDF exports...
node export.js
if %ERRORLEVEL% NEQ 0 (
    echo Error: Puppeteer export failed!
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================
echo Automation pipeline executed successfully!
echo HTML Dashboard: web/index.html (double-click to view offline)
echo Vector SVG:     export/ontology.svg
echo High-Res PNG:   export/ontology.png
echo Vector PDF:     export/ontology.pdf
echo ===================================================
pause
