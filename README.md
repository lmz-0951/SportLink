# SportLink V1 — 可部署網站

此資料夾可直接部署至 Vercel，公開網址可由任何人開啟。

## 不需要寫程式的部署步驟
1. 前往 https://github.com/new ，建立公開或私人儲存庫 `sportlink`。
2. 將 `index.html`、`vercel.json` 上傳到儲存庫根目錄（GitHub 的 Add file → Upload files）。
3. 前往 https://vercel.com/new ，用 GitHub 登入，選擇 `sportlink` 儲存庫。
4. Framework Preset 選 `Other`，Root Directory 留 `./`，Build Command 留空，Output Directory 留空。
5. 按 Deploy，完成後取得 `https://你的專案名稱.vercel.app` 公開網址。
6. 修改網站後將檔案重新上傳 GitHub，Vercel 會自動部署。

## 重要限制
目前是可公開瀏覽的前端試營運原型。示範帳號、預約與代課資料存於各個使用者的瀏覽器 localStorage，**不同使用者無法共享資料**；沒有真正的帳號驗證、資料庫或支付功能。請勿收集真實個資或宣稱可完成真實預約。

要正式開放學生與教練註冊使用，下一步必須導入 Supabase Auth、PostgreSQL 資料庫、Row Level Security、管理員審核與通知機制。
