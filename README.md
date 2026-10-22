# 精神病理個案練習平台

臺大心理系臨床組的精神病理練習網站，開放給學弟妹自行註冊使用：讀個案 → 下診斷與明細 → 列鑑別 → 看解析、準則核對與複習卡。

- **註冊**：自己取暱稱（1–20 字，不可重複）＋密碼（至少 4 字元）＋通關密語。
- **登入**：暱稱＋密碼即可；伺服器驗證後才把通關密語交給瀏覽器解開題庫。同一台裝置下次打開會自動登入，右上角可登出。
- 作答紀錄依暱稱分開存在 Google Sheet，電腦和手機共用同一份進度；「訂正本」列出所有答錯的題目；「儀表板」可改密碼、下載／匯入備份。
- `js/config.js` 的 `SYNC_URL` 留空時是**本機模式**：輸入暱稱＋通關密語就能練習，紀錄只存在該瀏覽器。

## 帳號後端（Google Sheet）設定

1. 開一份新的 Google Sheet → 擴充功能 → Apps Script → 把 `gas/Code.gs` 整份貼上 → 儲存。
2. 在編輯器上方選 `setup` 執行一次（第一次會要求授權），Sheet 裡會出現三個工作表：
   - `settings`：在 `access_code` 那列的 value 填入通關密語（必須和題庫加密用的密語相同）。`registration_open` 填 `FALSE` 可暫停新註冊。
   - `users`：每位註冊者一列（密碼只存加鹽雜湊）。**忘記密碼**：刪掉那一列，請對方用同一個暱稱重新註冊，舊進度會接回來。
   - `progress`：一人一題一列的作答紀錄。
3. 部署 → 新增部署作業 → 類型「網頁應用程式」，執行身分「我」，存取權「所有人」→ 複製 `/exec` 網址貼到 `js/config.js` 的 `SYNC_URL`。
4. 之後改了 `Code.gs`：部署 → 管理部署作業 → 編輯 → 版本選「新版本」，網址不變。

通關密語只放在 Sheet 的 `settings`，不要寫進 repo（repo 是公開的）。登入連續錯 5 次會鎖 5 分鐘。

題庫依據：
- First & Skodol《Learning DSM-5-TR by Case Example》：個案敘述（中文精簡改寫）、標準答案、解析
- First《DSM-5-TR Handbook of Differential Diagnosis》：鑑別選項、複習卡的鑑別表、鑑別對決題（題幹自編）

診斷名稱採台灣精神醫學會 DSM-5 譯名。題目內容改寫自有版權的教科書，因此**一律加密**：repo 公開，但沒有密語就看不到任何明文。

## 題型

- **個案診斷**：先點大類別再點診斷 → 選明細 → 可加共病 → 勾鑑別（含「物質／藥物」「其他身體病況」兩個每案必查項）→ 送出後看評分、書中解析、準則核對（不計分）、複習卡。
- **鑑別對決**：兩個很像的診斷二選一，再選出決定性的區辨點。

評分：綠＝正確；黃＝可接受或類別對、診斷錯；紅＝錯誤或漏掉。書中沒有判定的明細不評分。

## 專案結構

```
index.html, css/, js/       前端（純靜態，無需 build step）
data/bank.enc               加密後的題庫（唯一進 git 的資料檔）
data-raw/                   明文題庫，gitignore，不進 git
  taxonomy.json             類別 → 診斷 → 明細（台灣精神醫學會譯名）
  disorders.json            複習卡、準則核對表、鑑別六步驟
  cases_*.json              個案診斷題（每章一檔）
  duels.json                鑑別對決題
scripts/build.py            驗證交叉引用 → 加密輸出 data/bank.enc
gas/Code.gs                 註冊／登入＋雲端同步後端（Google Apps Script）
scripts/rekey.py            只換通關密語：用舊密語解開 bank.enc，再用新密語加密
```

## 重新產生題庫（改了 data-raw 之後）

```bash
python3 scripts/build.py --password <通關密語>
```

`build.py` 會先驗證：答案、鑑別、排除項引用的診斷都存在；明細屬於該診斷且選項正確；準則核對的項目編號存在；每題鑑別候選 5–8 個。有問題就不輸出。密語若和現有的 `data/bank.enc` 不同也會中止（避免推出大家解不開的題庫）；真的要換密語時加 `--change-password`。

## 更換通關密語

```bash
python3 scripts/rekey.py --old <舊密語> --new <新密語>
```

不需要 `data-raw/`。換完記得 commit `data/bank.enc`，並把 Google Sheet `settings` 的 `access_code` 改成同一個值，否則登入後會顯示「題庫解不開」。

## 本機預覽

```bash
python3 -m http.server 8765
```

然後開 http://localhost:8765 。

## 改了 css/ 或 js/ 之後

把 `index.html` 裡所有 `?v=20261022` 改成新的日期（例如 `?v=20261105`）。GitHub Pages 會讓瀏覽器快取舊檔，不換版本號的話，回訪的人會拿到新的 HTML 配舊的 CSS／JS，畫面跑版、登入失效。
