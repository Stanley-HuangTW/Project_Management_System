// Clustered production server. `next start` runs as a single Node process,
// so under concurrent load every request — including CPU-heavy ones like
// rendering a large board — queues behind the one event loop even though
// the container has multiple cores sitting idle. This forks one Next.js
// request handler per core (capped — see WORKERS below) behind Node's
// built-in cluster module, which round-robins incoming connections across
// them, so concurrent requests actually run in parallel instead of taking
// turns on a single thread.
const cluster = require("cluster");
const os = require("os");
const http = require("http");
const next = require("next");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
// Leave at least one core free for the OS/Postgres client work; cap at 4
// even on bigger hosts since each worker holds its own Prisma connection
// pool and duplicates Next.js's in-memory caches.
const WORKERS = Math.max(1, Math.min(4, os.cpus().length - 1 || 1));

if (cluster.isPrimary && !dev) {
  console.log(`Starting ${WORKERS} worker process(es)...`);

  // worker 剛起來就又掛掉(例如建置壞了)時,立刻重開只會把 CPU 燒滿、log 灌爆;
  // 活不到 10 秒的,隔 2 秒再開。正常運作中偶發的掛掉(活了很久)還是馬上補一個。
  const startedAt = new Map();
  const forkWorker = () => startedAt.set(cluster.fork().id, Date.now());
  for (let i = 0; i < WORKERS; i++) forkWorker();

  cluster.on("exit", (worker, code, signal) => {
    const livedMs = Date.now() - (startedAt.get(worker.id) ?? 0);
    startedAt.delete(worker.id);
    console.error(`Worker ${worker.process.pid} exited (code=${code} signal=${signal}, lived ${Math.round(livedMs / 1000)}s), restarting...`);
    if (livedMs < 10_000) setTimeout(forkWorker, 2000);
    else forkWorker();
  });

  // 專案週報分發、資料庫備份、MantisBT 同步、待辦事項期限提醒的排程心跳。Primary process 從不接請求、整個
  // 部署裡天然只有一份,是放這種「一定只能跑一次」的計時器最乾淨的地方——
  // 不用另外裝 cron 套件,也不用在多個 worker 之間搶鎖。實際「現在該不該
  // 動作」的判斷都在各自那支 /api/internal/*-tick 路由裡,這裡只是每五
  // 分鐘戳它們一下。
  const cronSecret = process.env.INTERNAL_CRON_SECRET;
  if (cronSecret) {
    const tick = (name) => {
      fetch(`http://127.0.0.1:${port}/api/internal/${name}`, {
        method: "POST",
        headers: { "x-internal-key": cronSecret },
      }).catch((err) => console.error(`${name} failed:`, err.message));
    };
    setInterval(() => {
      tick("weekly-report-tick");
      tick("backup-tick");
      tick("mantis-sync-tick");
      tick("todo-deadline-tick");
    }, 5 * 60 * 1000);
  } else {
    console.warn("INTERNAL_CRON_SECRET not set — 專案週報排程、資料庫備份排程都不會自動觸發。");
  }
} else {
  // Node 20 預設遇到沒人接的 Promise 失敗就整個行程結束——這個 worker 上所有正在處理的請求
  // 會一起斷掉。記下來就好,行程留著繼續服務(真正的同步例外仍然讓行程結束、由 primary 補一個)。
  process.on("unhandledRejection", (reason) => {
    console.error(`Worker ${process.pid} unhandledRejection:`, reason);
  });

  const app = next({ dev });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    http
      .createServer((req, res) => {
        // handle 回傳的 Promise 以前沒人接;它失敗時回 500,不要讓整個行程因此倒掉。
        Promise.resolve(handle(req, res)).catch((err) => {
          console.error(`Worker ${process.pid} request failed (${req.method} ${req.url?.slice(0, 200)}):`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end("Internal Server Error");
          } else {
            res.destroy();
          }
        });
      })
      .listen(port, () => {
        console.log(`Worker ${process.pid} ready on http://localhost:${port}`);
      });
  });
}
