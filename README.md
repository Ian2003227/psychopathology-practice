# 精神病理個案練習平台

給郭、彥、慧、言四人使用的精神病理練習網站：讀個案 → 下診斷與明細 → 列鑑別 → 看解析、準則核對與複習卡。與羅夏克編碼練習平台是**各自獨立**的 repo，通關密語相同。

作答紀錄依登入名字分開，下次回來會接著上次的位置；「訂正本」列出所有答錯的題目。設定 `js/config.js` 的 `SYNC_URL`（Google Apps Script，程式在 `gas/Code.gs`）後，紀錄會同步到 Google Sheet，電腦和手機共用同一份進度；沒設定時只存在本機瀏覽器，可在「儀表板」下載／匯入備份。

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
gas/Code.gs                 雲端同步後端（Google Apps Script，一人一題一列）
```

## 重新產生題庫（改了 data-raw 之後）

```bash
python3 scripts/build.py --password <通關密語>
```

`build.py` 會先驗證：答案、鑑別、排除項引用的診斷都存在；明細屬於該診斷且選項正確；準則核對的項目編號存在；每題鑑別候選 5–8 個。有問題就不輸出。

## 本機預覽

```bash
python3 -m http.server 8765
```

然後開 http://localhost:8765 。
