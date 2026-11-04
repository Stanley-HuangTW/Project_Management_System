import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
    // src/proxy.ts 在前面,Next 會把請求內容先緩衝起來,預設只留前 10 MB,超過的上傳(附件、BOM 檔案)
    // 會被截斷、整個表單解析失敗。跟上面 serverActions 的上限同一個數字。
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
