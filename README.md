# McAiBot

Minecraft 自動化倉庫管理系統 — 基於 Mineflayer，支援倉庫掃描、物品管理、LLM 語意空投。

> 本專案參考了 [SuperWY](https://github.com/unionofblackbean/superwy) 的原始程式碼進行改進與擴充。

## 快速開始

```bash
npm run setup      # 互動式引導設定（伺服器、LLM、掃描區域）
npm install        # 安裝相依套件
npm start          # 啟動
```

或直接執行平台專用腳本：

| 平台 | 設定引導 | 啟動 | 開發模式 |
|------|----------|------|----------|
| Windows | `setup.bat` | `start.bat` | `dev.bat` |
| Linux/macOS | `./setup.sh` | `./start.sh` | `./dev.sh` |

> Linux/macOS 首次需 `chmod +x *.sh`

或手動編輯 `config.js` 後直接啟動：

```bash
npm install
npm start
npm run dev        # 開發模式（--watch 自動重啟）
```

開啟 `http://localhost:3000` 進入管理面板。

## 環境變數

| 變數 | 說明 | 預設 |
|------|------|------|
| `MC_HOST` | 伺服器位址 | config.js |
| `MC_PORT` | 伺服器埠 | 25565 |
| `MC_USERNAME` | 微軟帳號 | config.js |
| `MC_VERSION` | 遊戲版本 | 1.21.11 |
| `MC_AUTH` | 認證方式 | microsoft |
| `MINECRAFT_PASSWORD` | 密碼 | - |
| `LLM_PROVIDER` | LLM 類型 | openai |
| `LLM_API_KEY` | API 金鑰 | - |
| `LLM_MODEL` | 模型名稱 | gpt-4o-mini |

## 聊天指令

在遊戲聊天頻道發送：

| 指令 | 範例 | 說明 |
|------|------|------|
| `!goto me` | `!goto me` | 前往發令者 |
| `!goto x y z` | `!goto 100 50 200` | 前往座標 |
| `!!grab <物品> [數量]` | `!!grab white_concrete 64` | 從倉庫取貨 |
| `!!d <物品>` | `!!d white_concrete` | 投擲物品 |
| `!!kd <物品> [數量]` | `!!kd white_concrete 20` | 空投（取貨→返回→投擲） |
| `!!kd <文字>~~` | `!!kd 快遞20個白色混凝土~~` | 語意空投（LLM 解析） |
| `!!gg` | `!!gg` | 補充金胡蘿蔔 |

語意空投也可以省略 `!!kd`，直接傳送以 `~~` 結尾的文字。

## Web 管理面板

- **📦 庫存盤點**：物品列表、分類過濾、搜尋、掃描控制、任務佇列
- **📍 平鋪畫面**：按 Y 層切換容器地圖，懸停查看庫存
- **🏗️ 材料計算器**：上傳 `.litematic` 藍圖，自動比對庫存

## 專案結構

```
├── index.js             主入口（Express + Socket.IO）
├── auth.js              身分驗證（PBKDF2 + AES Token）
├── scan.js              倉庫掃描
├── chat.js              聊天指令路由
├── grab.js              物品取貨
├── deliver.js           物品投擲
├── Airdrop.js           空投流程（取貨→返回→投擲）
├── keepalive.js         保活（低血量吃金蘿蔔、擬人）
├── pathfinder.js        尋路（mineflayer-pathfinder）
├── db.js                資料庫（SQLite + WAL）
├── config.js            設定檔
├── taskQueue.js         任務佇列
├── litematica.js        Litematica 藍圖解析
├── llmProvider.js       多模型 LLM 提供者
├── packetHandler.js     Minecraft 封包處理
├── public/              Web 前端（Vue 3 + Element Plus）
│   ├── index.html       管理面板
│   ├── items/           物品圖示
│   └── blocks/          方塊圖示
├── list.csv             物品中英文翻譯
└── main_storage_itemscsv.txt  預載物品清單
```

## LLM 支援

| 類型 | providerType |
|------|-------------|
| OpenAI | `openai` |
| Anthropic Claude | `claude` |
| Google Gemini | `gemini` |
| 通義千問 | `qwen` |
| 百度文心 | `wenxin` |
| Azure OpenAI | `azure` |
| Ollama（本地） | `ollama` |

## 技術棧

Node.js / Express / Socket.IO / Mineflayer / SQLite (better-sqlite3) / Vue 3 / Element Plus
