@echo off
cd /d "%~dp0"
python -m pip install -q -r requirements.txt
python -m pip install -q docx2pdf
set PDF_ENGINE=auto
python app.py
pause
