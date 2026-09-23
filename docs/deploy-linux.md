# 搬遷到 Linux Server + 自動部署設定

這份文件說明如何把這個專案從目前的 Windows Docker Desktop 環境，搬到一台 Linux
server 上長期運行，並設定「push 到 GitHub 後自動部署」。假設 Linux server 是
Ubuntu/Debian（其他發行版指令大同小異，主要是安裝 Docker 的部分不同）。

整體分五個階段：

1. Linux server 前置準備（安裝 Docker、clone 專案、設定 `.env.production`）
2. 把現有資料庫搬過去
3. 第一次手動部署、驗證
4. 設定 GitHub Actions，讓之後 `git push` 自動部署到這台 server
5. 設定每週自動備份資料庫

完成後的日常工作流程：你回報問題 → 我在本機（Windows Docker Desktop）除錯、
修好、驗證 → `git push` → GitHub Actions 自動 SSH 進 Linux server 拉新版、重新
build、重啟——不需要我直接連進你的 server。

---

## 0. 你需要先準備好的東西

- Linux server 的 IP（或網域）、一組可以 SSH 登入、且有 sudo 權限的帳號。
- 這個 GitHub repo 的存取權限（已經有了）。
- 一小段停機時間可以接受（資料庫搬遷 + 第一次部署期間，現有 Windows 版本可以
  繼續開著給大家用，等 Linux 版本驗證沒問題後再切換）。

---

## 1. Linux Server 前置準備

### 1.1 安裝 Docker

SSH 進 server 後：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

跑完 `usermod` 之後**登出再重新登入一次**，讓群組設定生效，之後才不用每個指令都加
`sudo`。用這個確認安裝成功：

```bash
docker compose version
```

### 1.2 建立一個專門跑部署的帳號（建議，非必要）

如果你目前用來 SSH 的帳號本身權限就夠、也願意讓 GitHub Actions 用同一組帳號部署，
可以跳過這步。想額外建一個專用帳號的話：

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
```

以下都用 `deploy` 這個帳號名稱示範，換成你實際要用的帳號即可。

### 1.3 Clone 專案

```bash
sudo -iu deploy
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/stanleyhuang-urs/ursrobot_project.git
cd ursrobot_project
```

之後 GitHub Actions 要 SSH 進來部署的路徑就是這裡（例如
`/home/deploy/apps/ursrobot_project`），先記下來，第 4 節設定 `DEPLOY_PATH`
會用到。

### 1.4 建立 `.env.production`

```bash
cp .env.production.example .env.production
nano .env.production   # 或你熟悉的編輯器
```

把裡面的值填成真的：

- `POSTGRES_PASSWORD`：如果第 2 節要把現有資料庫搬過來，**這裡建議填一組新密
  碼即可**（跟 Windows 那邊的密碼是否相同不影響資料搬遷，資料庫內容跟這組密碼
  無關）。
- `AUTH_SECRET`：用 `openssl rand -base64 32` 產生一組新的，不需要跟 Windows
  那邊一樣（換一組新的只是會讓現有登入 session 失效，使用者要重新登入一次，資
  料不受影響）。
- `APP_BASE_URL`：填使用者實際會連到的網址，例如 `http://<server-ip>:3000`，
  之後如果有網域/HTTPS 再改成正式網址。
- `SMTP_*`、`GOOGLE_CLIENT_*`：直接照抄 Windows 那邊 `.env.production` 裡的值
  （這些是外部服務的憑證，兩邊要一樣才能正常運作）。
- `INTERNAL_CRON_SECRET`：用 `openssl rand -base64 32` 產生一組新的，不需要跟
  Windows 那邊一樣——這是 `server.js` 用來觸發「專案週報分發」排程心跳的內部
  密鑰，不會給任何使用者看到，只要有值就好。沒填的話專案週報排程不會自動
  觸發（系統設定裡的「啟用排程」開關仍然可以打開，但不會真的寄出去），log
  裡會看到一行警告。

`.env.production` 不會被 git 追蹤（已經在 `.gitignore` 裡），所以之後
`git pull`/GitHub Actions 更新程式碼都不會動到它，改一次設定就會一直留著。

---

## 2. 搬移現有資料庫

現有資料庫的內容（看板、項目、使用者帳號等）要從 Windows 上的 Postgres 匯出，
搬到 Linux 上的新 Postgres。兩邊都是 `postgres:16-alpine`，版本完全一致，用
`pg_dump`/還原即可，不會有相容性問題。

> **要搬的是兩樣東西，不是一樣。** 資料庫裡只存附件的「資料列」，檔案本體在
> 另一個 volume（`hrapp_uploads_data`，掛在容器的 `/app/public/uploads`）。
> 只搬資料庫的話，每個附件的紀錄都在、點下去檔案不見。

### 2.1 在 Windows 端匯出

在專案資料夾裡跑備份腳本，資料庫和附件會一起匯出到 `backups/`：

```bash
bash scripts/backup-db.sh
```

跑完會看到兩個檔案，都要搬：

- `backups/hrapp_db_<時間戳記>.sql.gz` — 資料庫
- `backups/uploads_<時間戳記>.tgz` — 附件檔案

（腳本會自己讀 `.env.production` 裡的 `POSTGRES_USER`/`POSTGRES_DB`，
不必手改指令。）

### 2.2 把備份檔傳到 Linux server

```bash
scp backups/hrapp_db_<時間戳記>.sql.gz backups/uploads_<時間戳記>.tgz deploy@<server-ip>:~/apps/ursrobot_project/
```

### 2.3 在 Linux 端還原

先只啟動資料庫、等它就緒，再還原、最後才啟動 app（app 啟動時會自動跑
`prisma migrate deploy`，資料庫裡本來就有的資料不受影響）：

```bash
cd ~/apps/ursrobot_project
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production exec -T db pg_isready -U hrapp -d hrapp_db   # 確認顯示 accepting connections
gunzip -c hrapp_db_<時間戳記>.sql.gz | docker compose -p hrapp --env-file .env.production exec -T db psql -U hrapp -d hrapp_db
```

附件要還原進 volume，透過一個用完即丟的容器寫進去（volume 不在 host 的檔案
系統上，複製檔案進去沒有用）：

```bash
docker volume create hrapp_uploads_data
docker run --rm -v hrapp_uploads_data:/v -v "$PWD":/in alpine tar xzf /in/uploads_<時間戳記>.tgz -C /v
```

還原完可以隨手檢查一下筆數對不對：

```bash
docker compose --env-file .env.production exec -T db psql -U hrapp -d hrapp_db -c 'SELECT count(*) FROM "Item";'
```

跟 Windows 那邊用同樣的指令（把 `docker compose` 換成 Windows 那邊的
working directory）比對數字，確認一致。

---

## 3. 第一次手動部署

```bash
cd ~/apps/ursrobot_project
docker compose --env-file .env.production build app
docker compose --env-file .env.production up -d app
```

看 log 確認正常啟動、沒有 migration 或連線錯誤：

```bash
docker compose logs -f app
```

瀏覽器打開 `http://<server-ip>:3000`，用原本的帳號登入，確認資料（看板、項目、
使用者）都在，功能正常。

確認沒問題之後，才把使用者導向這個新網址，Windows 那邊可以停用了。

> 如果之後要掛網域 + HTTPS，會需要在這台 server 上另外加一層 reverse proxy
> （例如 Caddy 或 nginx），這份文件先不涵蓋——等基本部署穩定後，需要的話我可以
> 再另外處理。

---

## 4. 設定 GitHub Actions 自動部署

這個 repo 裡已經有 `.github/workflows/deploy.yml`：每次 push 到 `main`，會自動
SSH 進 server 執行 `git pull` + 重新 build + 重啟 `app` container。要讓它能連
進你的 server，需要在 GitHub 設定幾個 secret。

### 4.1 產生一組專用的 SSH 金鑰

在**你自己的電腦**（不是 server 上）跑：

```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
```

會產生 `deploy_key`（私鑰）和 `deploy_key.pub`（公鑰）兩個檔案。

### 4.2 把公鑰加到 server

```bash
ssh-copy-id -i deploy_key.pub deploy@<server-ip>
```

（沒有 `ssh-copy-id` 的話，手動把 `deploy_key.pub` 的內容貼進 server 上
`~deploy/.ssh/authorized_keys` 也可以。）

貼完之後測試一下能不能用這把私鑰直接登入：

```bash
ssh -i deploy_key deploy@<server-ip>
```

能登入才繼續下一步。

### 4.3 在 GitHub 設定 repo secrets

到 repo 的 **Settings → Secrets and variables → Actions → New repository
secret**，依序新增：

| Secret 名稱 | 值 |
| --- | --- |
| `DEPLOY_HOST` | server 的 IP 或網域 |
| `DEPLOY_USER` | `deploy`（或你實際用的帳號） |
| `DEPLOY_SSH_KEY` | `deploy_key` **私鑰**的完整內容（含 `-----BEGIN...`/`-----END...`） |
| `DEPLOY_PATH` | repo 在 server 上的絕對路徑，例如 `/home/deploy/apps/ursrobot_project` |

`DEPLOY_PORT` 是選填的（SSH port 不是預設 22 才需要加）。

設定好之後，`deploy_key`（私鑰檔）就可以從你電腦上刪掉了——GitHub 那邊存的
才是之後實際會用到的那份。

### 4.4 驗證

設定完 secrets 後，隨便 push 一個小改動到 `main`（或直接到 repo 的
**Actions** 分頁，選 `Deploy to production` 這個 workflow，點
**Run workflow** 手動觸發一次），確認：

1. Actions 分頁裡這次 run 顯示綠色勾勾
2. Linux server 上 `docker compose ps` 看得到 `app` container 剛剛重啟過
3. 網站上看得到這次改動的效果

---

## 5. 設定每週自動備份資料庫

repo 裡有 `scripts/backup-db.sh`：對資料庫跑 `pg_dump` 壓成
`backups/hrapp_db_<時間戳記>.sql.gz`，把附件 volume 打包成
`backups/uploads_<時間戳記>.tgz`，並自動刪除超過保留天數（預設 60 天）的
舊備份。兩個檔案都寫成 `.part` 再改名，指令失敗時不會留下一個看起來像備份的
空檔。在 server 上，repo 目錄裡先手動跑一次確認正常：

```bash
cd ~/apps/ursrobot_project
./scripts/backup-db.sh
```

跑完應該會看到 `backups/` 目錄下多一個 `.sql.gz` 檔案。確認沒問題後，用
`crontab -e` 加一行，設定每週一凌晨 3 點自動跑：

```cron
0 3 * * 1 cd /home/deploy/apps/ursrobot_project && ./scripts/backup-db.sh >> /home/deploy/apps/ursrobot_project/backups/backup.log 2>&1
```

路徑記得換成第 1.3 節實際 clone 的位置。之後每週備份的輸出都會附加寫進
`backups/backup.log`，方便事後查有沒有跑成功。

想改保留天數的話，設定環境變數再跑（或直接把 crontab 那行的
`./scripts/backup-db.sh` 前面加上 `RETENTION_DAYS=90`）：

```bash
RETENTION_DAYS=90 ./scripts/backup-db.sh
```

備份檔留在 server 本機的 `backups/` 目錄——如果想要異地備份（server 本身故障
時也不會連備份一起丟掉），之後可以再加一步把 `backups/` 同步到別的地方（例如
另一台機器、雲端物件儲存），需要的話跟我說，我再幫忙加。

還原方式跟第 2.3 節搬移資料庫時一樣，把 `< backup.sql` 換成
`gunzip -c backups/<檔名>.sql.gz |` 接 `psql` 就可以：

```bash
gunzip -c backups/hrapp_db_2026-09-02_030000.sql.gz | docker compose --env-file .env.production exec -T db psql -U hrapp -d hrapp_db
```

> ⚠️ 還原會把資料庫現有內容整個覆蓋回備份當下的狀態，正式還原前務必先確認
> 你要的就是這個時間點的備份。

---

## 6. 之後的日常工作流程

設定完成後：

- 你在 Linux server 上使用、操作系統本身；發現問題就直接告訴我。
- 我在本機的 Windows Docker Desktop 環境重現、除錯、修好，跟現在一樣的方式
  驗證過。
- 我 `git push` 到 `main`。
- GitHub Actions 自動 SSH 進你的 Linux server，拉新版、重新 build、重啟——
  全程不需要我直接連進你的 server。

### 疑難排解

- **看 log**：`docker compose --env-file .env.production logs -f app`
- **確認 container 狀態**：`docker compose ps`
- **手動重新部署**（不想等 push，或 Actions 失敗要重跑一次）：直接在 server 上
  跑第 3 節的兩行指令。
- **這次 deploy 有問題想先退回上一版**：在 server 上
  `git log --oneline -5` 找到上一個穩定的 commit，`git checkout <commit>`，
  再重新 build + up 一次；確認穩定後記得 `git checkout main` 切回去，之後才
  能繼續正常自動部署。
- **GitHub Actions 那次 run 失敗**：Actions 分頁點進那次 run 可以看到完整的
  SSH 執行過程/錯誤訊息，把訊息貼給我就可以直接除錯。
