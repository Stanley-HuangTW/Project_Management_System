@echo off
REM 產一份上一週的週報:存檔 + 寄信 + 寫進系統裡的週報頁面。
REM
REM 金鑰從環境變數讀,不寫在這個檔案裡 —— 這個檔案會進版控,
REM 而排程器的工作內容在介面上是看得到的。
REM
REM 設定一次(用你自己的帳號,系統設定 → 整合 產生金鑰):
REM   setx HRAPP_API_KEY "hrapp_你的金鑰"
REM 然後關掉這個視窗重開,環境變數才會生效。

setlocal

if "%HRAPP_API_KEY%"=="" (
  echo [錯誤] 沒有設定 HRAPP_API_KEY。
  echo 先執行:setx HRAPP_API_KEY "hrapp_你的金鑰"
  exit /b 1
)

if "%HRAPP_BASE_URL%"=="" set HRAPP_BASE_URL=http://localhost:3000

echo 正在產生上一週的週報...
curl -sS -X POST ^
  -H "Authorization: Bearer %HRAPP_API_KEY%" ^
  "%HRAPP_BASE_URL%/api/reports/weekly?week=last&deliver=1" ^
  -o "%TEMP%\hrapp-weekly-report.json" ^
  -w "HTTP %%{http_code}\n"

if errorlevel 1 (
  echo [錯誤] 連不上 %HRAPP_BASE_URL%,確認 Docker 有在跑。
  exit /b 1
)

echo 回應存在 %TEMP%\hrapp-weekly-report.json
endlocal
