// Main controller: login/decrypt, practice (case diagnosis + differential duels), dashboard, reference.

const S = {
  user: null,
  bank: null,
  dx: {},          // dxId -> diagnosis (with .cat and expanded .spec groups)
  cat: {},         // catId -> category
  items: [],       // cases + duels, each with .type
  byId: {},
  order: [],
  pos: 0,
  draft: null,
  dashLevel: "cat",
  reviewFilter: "wrong",
  refSel: null,
};

// ---------- storage (every access guarded; the page must work without it) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked or full */ } },
};
const K = {
  attempts: () => `psy_attempts_${S.user}`,
  last: () => `psy_last_${S.user}`,
  prefs: () => `psy_prefs_${S.user}`,
  flags: () => `psy_flags_${S.user}`,
};
function attempts() { return store.get(K.attempts(), {}); }
function saveAttempt(item, answer, result) {
  const map = attempts();
  const prev = map[item.id];
  map[item.id] = { count: (prev ? prev.count : 0) + 1, at: Date.now(), answer, result, allCorrect: !!result.allCorrect };
  store.set(K.attempts(), map);
}
function statusOf(id) {
  const a = attempts()[id];
  if (!a) return "none";
  return a.allCorrect ? "ok" : "part";
}

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function stableShuffle(arr, seed, keyFn) {
  return [...arr].sort((a, b) => hash(seed + keyFn(a)) - hash(seed + keyFn(b)));
}
function dxName(id) { return S.dx[id] ? S.dx[id].name : id; }
function catName(id) { return S.cat[id] ? S.cat[id].name : id; }
function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "—"; }
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function optName(dxId, gid, v) {
  const g = (S.dx[dxId].spec || []).find(x => x.id === gid);
  const o = g && g.options.find(x => x.id === v);
  return o ? o.name : v;
}
function specText(dxId, spec) {
  if (!spec || !S.dx[dxId]) return "";
  const parts = [];
  for (const g of S.dx[dxId].spec || []) {
    const v = spec[g.id];
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length) parts.push(v.map(x => optName(dxId, g.id, x)).join("、")); }
    else parts.push(optName(dxId, g.id, v));
  }
  return parts.join("，");
}

// ---------- login ----------
function initLogin() {
  const sel = document.getElementById("userSelect");
  sel.innerHTML = window.PsyConfig.USERS.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
  document.getElementById("loginBtn").addEventListener("click", doLogin);
  document.getElementById("pwInput").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
}

async function doLogin() {
  const pw = document.getElementById("pwInput").value;
  const user = document.getElementById("userSelect").value;
  const err = document.getElementById("loginError");
  err.textContent = "";
  if (!pw) { err.textContent = "請輸入密語"; return; }
  try {
    const res = await fetch("data/bank.enc", { cache: "no-store" });
    if (!res.ok) throw new Error("bank.enc 讀取失敗（" + res.status + "）");
    const bank = await window.PsyCrypto.decryptEnvelope(pw, await res.json());
    S.bank = bank;
    S.user = user;
    for (const c of bank.taxonomy) {
      S.cat[c.id] = c;
      for (const d of c.diagnoses) S.dx[d.id] = d;
    }
    S.items = [
      ...bank.cases.map(c => ({ ...c, type: "case" })),
      ...bank.duels.map(d => ({ ...d, type: "duel" })),
    ];
    for (const it of S.items) S.byId[it.id] = it;
    document.getElementById("loginPanel").classList.add("hidden");
    document.getElementById("appRoot").classList.remove("hidden");
    document.getElementById("userBadge").textContent = "使用者：" + user;
    initApp();
  } catch (e) {
    err.textContent = String(e.message).includes("WRONG_PASSWORD") ? "密語錯誤，請再試一次" : "發生錯誤：" + e.message;
  }
}

// ---------- app shell ----------
function initApp() {
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
  const chapters = [...new Set(S.items.map(i => i.chapter))];
  document.getElementById("chapterFilter").innerHTML =
    `<option value="">全部</option>` + chapters.map(c => `<option value="${esc(c)}">${esc(catName(c))}</option>`).join("");
  const prefs = store.get(K.prefs(), {});
  for (const [id, key] of [["typeFilter", "type"], ["orderMode", "order"], ["chapterFilter", "chapter"]]) {
    const el = document.getElementById(id);
    if (prefs[key] != null && [...el.options].some(o => o.value === prefs[key])) el.value = prefs[key];
    el.addEventListener("change", () => { savePrefs(); rebuildOrder(true); });
  }
  document.getElementById("overviewBtn").addEventListener("click", () => {
    document.getElementById("overviewPanel").classList.toggle("hidden");
    renderOverview();
  });
  const panel = document.getElementById("itemPanel");
  panel.addEventListener("click", onItemClick);
  panel.addEventListener("change", onItemChange);
  document.getElementById("overviewPanel").addEventListener("click", e => {
    const b = e.target.closest("[data-jump]");
    if (b) jumpTo(b.dataset.jump);
  });
  document.getElementById("dashboardPanel").addEventListener("click", onDashClick);
  document.getElementById("dashboardPanel").addEventListener("change", e => { if (e.target.id === "importFile") importBackup(e.target); });
  document.getElementById("reviewPanel").addEventListener("click", onReviewClick);
  document.getElementById("referencePanel").addEventListener("click", onRefClick);
  document.getElementById("referencePanel").addEventListener("input", e => {
    if (e.target.id === "refSearch") renderRefList(e.target.value);
  });
  rebuildOrder(false);
  const last = store.get(K.last(), null);
  if (last && S.order.includes(last)) S.pos = S.order.indexOf(last);
  renderItem();
  const done = Object.keys(attempts()).filter(id => S.byId[id]).length;
  if (done) toast(`歡迎回來！已作答 ${done} 題，接著上次的位置繼續`);
}

function savePrefs() {
  store.set(K.prefs(), {
    type: document.getElementById("typeFilter").value,
    order: document.getElementById("orderMode").value,
    chapter: document.getElementById("chapterFilter").value,
  });
}

function switchView(view) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  for (const v of ["practice", "review", "dashboard", "reference"]) {
    document.getElementById("view-" + v).classList.toggle("hidden", v !== view);
  }
  if (view === "review") renderReview();
  if (view === "dashboard") renderDashboard();
  if (view === "reference") renderReference();
  window.scrollTo(0, 0);
}

function rebuildOrder(fromUser) {
  const type = document.getElementById("typeFilter").value;
  const mode = document.getElementById("orderMode").value;
  const chapter = document.getElementById("chapterFilter").value;
  const current = S.order[S.pos];
  let list = S.items.filter(i => (type === "all" || i.type === type) && (!chapter || i.chapter === chapter));
  const map = attempts();
  if (mode === "unanswered") list = list.filter(i => !map[i.id]);
  if (mode === "wrong") list = list.filter(i => map[i.id] && !map[i.id].allCorrect);
  if (mode === "random") list = stableShuffle(list, String(Math.random()), i => i.id);
  else list.sort((a, b) => a.code.localeCompare(b.code));
  S.order = list.map(i => i.id);
  S.pos = Math.max(0, S.order.indexOf(current));
  if (fromUser && mode !== "random" && S.order.indexOf(current) < 0) S.pos = 0;
  renderItem();
  if (!document.getElementById("overviewPanel").classList.contains("hidden")) renderOverview();
}

function jumpTo(id, showLast) {
  if (!S.order.includes(id)) {
    document.getElementById("typeFilter").value = "all";
    document.getElementById("chapterFilter").value = "";
    document.getElementById("orderMode").value = "code";
    savePrefs();
    rebuildOrder(false);
  }
  S.pos = S.order.indexOf(id);
  switchView("practice");
  renderItem();
  if (showLast) showLastAttempt(S.byId[id]);
}

function showLastAttempt(item) {
  const a = attempts()[item.id];
  if (!a) return;
  S.draft = freshDraft(item);
  Object.assign(S.draft, JSON.parse(JSON.stringify(a.answer)));
  S.draft.submitted = true;
  S.draft.showingLast = true;
  S.draft.grade = item.type === "case" ? window.PsyGrade.gradeCase(item, a.answer, S.dx) : window.PsyGrade.gradeDuel(item, a.answer);
  renderItem();
  const fb = document.getElementById("feedback");
  if (fb) fb.scrollIntoView({ block: "start" });
}

function renderOverview() {
  const el = document.getElementById("overviewPanel");
  if (el.classList.contains("hidden")) return;
  const cells = S.order.map((id, i) => {
    const it = S.byId[id];
    const st = statusOf(id);
    return `<button class="ov-cell ${st === "ok" ? "ok" : st === "part" ? "part" : ""} ${i === S.pos ? "current" : ""}" data-jump="${esc(id)}">
      #${esc(it.code)}<small>${it.type === "case" ? "個案" : "對決"}${st === "ok" ? " ✔" : st === "part" ? " △" : ""}</small></button>`;
  }).join("");
  el.innerHTML = `<h2>總覽</h2><p class="muted small">綠色＝完全正確，黃色＝作答過但不完全正確。點一下跳到該題。</p><div class="ov-grid">${cells || "（目前篩選條件下沒有題目）"}</div>`;
}

// ---------- practice: shared ----------
function currentItem() { return S.byId[S.order[S.pos]] || null; }

function freshDraft(item) {
  if (item.type === "case") {
    return { itemId: item.id, entries: [{ cat: null, dx: null, spec: {}, open: true }], ruleOut: { substance: false, medical: false }, ddx: [], submitted: false, grade: null, showingLast: false };
  }
  return { itemId: item.id, choice: null, key: null, submitted: false, grade: null, showingLast: false };
}

function renderItem() {
  const panel = document.getElementById("itemPanel");
  const item = currentItem();
  document.getElementById("progressText").textContent = S.order.length ? `第 ${S.pos + 1} / ${S.order.length} 題` : "";
  if (!item) {
    panel.innerHTML = `<p>目前的篩選條件下沒有題目。可以把「順序」改回「隨機」或「依編號」，或把範圍改成「全部」。</p>`;
    return;
  }
  if (!S.draft || S.draft.itemId !== item.id) S.draft = freshDraft(item);
  store.set(K.last(), item.id);
  panel.innerHTML = item.type === "case" ? caseHtml(item) : duelHtml(item);
  renderOverview();
}

function headHtml(item) {
  const a = attempts()[item.id];
  const st = statusOf(item.id);
  const stPill = st === "ok" ? `<span class="pill ok">已答對</span>` : st === "part" ? `<span class="pill part">作答過・未全對</span>` : `<span class="pill">未作答</span>`;
  const diff = item.difficulty ? `<span class="pill" title="難度">${"●".repeat(item.difficulty)}${"○".repeat(3 - item.difficulty)}</span>` : "";
  const lastBtn = a && !S.draft.submitted ? `<button class="linkbtn" data-act="showlast">看上次的作答結果（第 ${a.count} 次作答）</button>` : "";
  return `<div class="item-head"><span class="code">#${esc(item.code)}</span>
    <span class="pill type">${item.type === "case" ? "個案診斷" : "鑑別對決"}</span>${diff}${stPill}${lastBtn}</div>`;
}

function navHtml() {
  return `<div class="action-row">
    <button class="btn-secondary" data-act="prev" ${S.pos <= 0 ? "disabled" : ""}>← 上一題</button>
    <button class="btn-secondary" data-act="next" ${S.pos >= S.order.length - 1 ? "disabled" : ""}>下一題 →</button>
  </div>`;
}

function onItemChange(e) {
  const t = e.target;
  if (t.dataset.act === "ro" && !S.draft.submitted) S.draft.ruleOut[t.dataset.k] = t.checked;
}

function onItemClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  const item = currentItem();
  const d = S.draft;
  const ei = b.dataset.e != null ? Number(b.dataset.e) : null;

  if (act === "prev" && S.pos > 0) { S.pos--; renderItem(); window.scrollTo(0, 0); return; }
  if (act === "next" && S.pos < S.order.length - 1) { S.pos++; renderItem(); window.scrollTo(0, 0); return; }
  if (act === "flag") { doFlag(item); return; }
  if (act === "goCase") { jumpTo(b.dataset.id); window.scrollTo(0, 0); return; }
  if (act === "card") { S.refSel = b.dataset.id; switchView("reference"); return; }
  if (act === "showlast") { showLastAttempt(item); return; }
  if (act === "retry") { S.draft = freshDraft(item); renderItem(); return; }
  if (act === "critCheck") { checkCriteria(b); return; }

  if (item.type === "duel") {
    if (d.submitted) return;
    if (act === "duelChoice") { d.choice = b.dataset.v; renderItem(); }
    if (act === "duelKey") { d.key = Number(b.dataset.i); renderItem(); }
    if (act === "duelSubmit") submitDuel(item);
    return;
  }

  if (d.submitted) return;
  if (act === "cat") { const en = d.entries[ei]; en.cat = en.cat === b.dataset.id ? null : b.dataset.id; en.dx = null; en.spec = {}; }
  else if (act === "dx") { const en = d.entries[ei]; en.dx = b.dataset.id; en.spec = {}; en.open = false; }
  else if (act === "edit") { d.entries[ei].open = true; }
  else if (act === "rm") { d.entries.splice(ei, 1); if (!d.entries.length) d.entries.push({ cat: null, dx: null, spec: {}, open: true }); }
  else if (act === "add") { d.entries.forEach(x => { if (x.dx) x.open = false; }); d.entries.push({ cat: null, dx: null, spec: {}, open: true }); }
  else if (act === "spec") {
    const en = d.entries[ei];
    const g = S.dx[en.dx].spec.find(x => x.id === b.dataset.g);
    const v = b.dataset.v;
    if (g.multi) {
      const arr = en.spec[g.id] || [];
      en.spec[g.id] = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
    } else en.spec[g.id] = en.spec[g.id] === v ? undefined : v;
  }
  else if (act === "ddx") { const id = b.dataset.id; d.ddx = d.ddx.includes(id) ? d.ddx.filter(x => x !== id) : [...d.ddx, id]; }
  else if (act === "submit") { submitCase(item); return; }
  else return;
  rerenderBuilder(item);
}

function rerenderBuilder(item) {
  const box = document.getElementById("builder");
  if (box) box.innerHTML = builderHtml(item);
}

// ---------- practice: case ----------
function caseHtml(item) {
  const d = S.draft;
  return `${headHtml(item)}
    <div class="prompt">${esc(item.prompt)}</div>
    <div class="narrative">${item.narrative.map(p => `<p>${esc(p)}</p>`).join("")}</div>
    <div id="builder">${builderHtml(item)}</div>
    ${d.submitted ? caseFeedbackHtml(item, d, d.grade) : ""}
    ${navHtml()}`;
}

function builderHtml(item) {
  const d = S.draft;
  const dis = d.submitted ? "disabled" : "";
  const entries = d.entries.map((en, i) => entryHtml(en, i, dis)).join("");
  const cands = stableShuffle(item.ddx, item.id, x => x.dx);
  const ddChips = cands.map(c => `<button class="chip ${d.ddx.includes(c.dx) ? "selected" : ""}" data-act="ddx" data-id="${esc(c.dx)}" ${dis}>${esc(dxName(c.dx))}</button>`).join("");
  const actions = d.submitted
    ? `<div class="action-row"><button class="btn-secondary" data-act="retry">重新作答這題</button><button class="btn-flag" data-act="flag">標記討論</button></div>`
    : `<div class="action-row"><button class="btn-primary" data-act="submit">送出並對答案</button><button class="btn-flag" data-act="flag">標記討論</button></div>`;
  return `
    <div class="step">
      <div class="step-title">步驟一：診斷</div>
      <div class="step-hint">先點大類別，再點診斷，最後選明細。第一個是主要診斷；有共病可以再新增。</div>
      ${entries}
      ${d.submitted ? "" : `<button class="add-btn" data-act="add">＋ 新增共病診斷</button>`}
    </div>
    <div class="step">
      <div class="step-title">步驟二：鑑別診斷</div>
      <div class="step-hint">勾出你會列入考慮、需要排除的診斷（正確答案不在清單裡）。</div>
      <div class="ruleout">
        <label><input type="checkbox" data-act="ro" data-k="substance" ${d.ruleOut.substance ? "checked" : ""} ${dis}/> 已考慮：物質／藥物所致</label>
        <label><input type="checkbox" data-act="ro" data-k="medical" ${d.ruleOut.medical ? "checked" : ""} ${dis}/> 已考慮：其他身體病況所致</label>
      </div>
      <div class="chips">${ddChips}</div>
    </div>
    ${actions}`;
}

function entryHtml(en, i, dis) {
  const label = i === 0 ? "診斷 1（主要診斷）" : `診斷 ${i + 1}（共病）`;
  const rm = dis ? "" : `<button class="dangerbtn" data-act="rm" data-e="${i}">移除</button>`;
  let body = "";
  if (en.dx && !en.open) {
    body = `<div class="entry-summary"><span class="muted small">${esc(catName(en.cat))} ›</span> <b>${esc(dxName(en.dx))}</b>
      ${dis ? "" : `<button class="linkbtn" data-act="edit" data-e="${i}">更改</button>`}</div>`;
  } else {
    const cats = S.bank.taxonomy.map(c => `<button class="chip ${en.cat === c.id ? "selected" : ""}" data-act="cat" data-e="${i}" data-id="${esc(c.id)}" ${dis}>${esc(c.name)}</button>`).join("");
    body = `<div class="spec-group"><div class="glabel">大類別</div><div class="chips">${cats}</div></div>`;
    if (en.cat) {
      const dxs = S.cat[en.cat].diagnoses.map(x => `<button class="chip ${en.dx === x.id ? "selected" : ""}" data-act="dx" data-e="${i}" data-id="${esc(x.id)}" ${dis}>${esc(x.name)}</button>`).join("");
      body += `<div class="spec-group"><div class="glabel">診斷</div><div class="chips">${dxs}</div></div>`;
    }
  }
  if (en.dx) {
    for (const g of S.dx[en.dx].spec || []) {
      const chips = g.options.map(o => {
        const sel = g.multi ? (en.spec[g.id] || []).includes(o.id) : en.spec[g.id] === o.id;
        return `<button class="chip ${sel ? "selected" : ""}" data-act="spec" data-e="${i}" data-g="${esc(g.id)}" data-v="${esc(o.id)}" ${dis}>${esc(o.name)}</button>`;
      }).join("");
      body += `<div class="spec-group"><div class="glabel">${esc(g.label)}</div><div class="chips">${chips}</div></div>`;
    }
  }
  return `<div class="entry"><div class="entry-head"><span class="lbl">${label}</span>${rm}</div>${body}</div>`;
}

function currentCaseAnswer() {
  const d = S.draft;
  return {
    entries: d.entries.filter(e => e.dx).map(e => {
      const spec = {};
      for (const [k, v] of Object.entries(e.spec)) if (v != null && !(Array.isArray(v) && !v.length)) spec[k] = v;
      return { cat: e.cat, dx: e.dx, spec };
    }),
    ruleOut: { ...d.ruleOut },
    ddx: [...d.ddx],
  };
}

function submitCase(item) {
  const ans = currentCaseAnswer();
  if (!ans.entries.length) { toast("請至少選一個診斷"); return; }
  const g = window.PsyGrade.gradeCase(item, ans, S.dx);
  S.draft.submitted = true;
  S.draft.grade = g;
  saveAttempt(item, ans, g.result);
  renderItem();
  const fb = document.getElementById("feedback");
  if (fb) fb.scrollIntoView({ behavior: "smooth", block: "start" });
}

function doFlag(item) {
  const note = window.prompt("想在讀書會討論這題的什麼？（可留空）", "");
  if (note === null) return;
  const flags = store.get(K.flags(), []);
  flags.push({ item_id: item.id, note, at: Date.now() });
  store.set(K.flags(), flags);
  toast("已標記，可以在「訂正本」找到");
}

const ROW_RESULT = {
  ok: ["cell-ok", "✔ 正確"],
  alt: ["cell-lenient", "△ 可接受"],
  cat: ["cell-lenient", "△ 類別對，診斷不同"],
  missed: ["cell-bad", "✘ 漏掉了"],
  optional_missed: ["cell-neutral", "— 選填，沒列也可以"],
};
const ROLE_LABEL = { primary: "主要", comorbid: "共病", optional: "選填" };

function caseFeedbackHtml(item, ans, g) {
  const r = g.result;
  const entries = (ans.entries || []).filter(e => e.dx);
  const sum = [];
  const pmap = { ok: ["st-ok", "正確"], alt: ["st-lenient", "可接受"], cat: ["st-lenient", "類別對、診斷錯"], missed: ["st-bad", "錯誤"] };
  const pm = pmap[r.primaryStatus];
  sum.push(`<div class="sum ${pm[0]}"><b>主要診斷</b>${pm[1]}</div>`);
  if (r.comorbidTotal) sum.push(`<div class="sum ${r.comorbidHit === r.comorbidTotal ? "st-ok" : "st-bad"}"><b>共病</b>${r.comorbidHit} / ${r.comorbidTotal}</div>`);
  if (r.extraWrong) sum.push(`<div class="sum st-bad"><b>多餘診斷</b>${r.extraWrong} 個</div>`);
  if (r.specTotal) sum.push(`<div class="sum ${r.specOk === r.specTotal ? "st-ok" : "st-lenient"}"><b>明細</b>${r.specOk} / ${r.specTotal}</div>`);
  sum.push(`<div class="sum ${r.ddMustHit === r.ddMustTotal ? "st-ok" : "st-bad"}"><b>必須考慮的鑑別</b>${r.ddMustHit} / ${r.ddMustTotal}</div>`);
  sum.push(`<div class="sum ${r.ruleOutOk === 2 ? "st-ok" : "st-bad"}"><b>物質／身體病況</b>${r.ruleOutOk} / 2</div>`);

  // Diagnosis table
  const dxRows = g.rows.map(row => {
    const k = row.key;
    const user = row.userIdx != null ? entries[row.userIdx] : null;
    const [cls, txt] = ROW_RESULT[row.status];
    let note = "";
    if (row.status === "alt") note = ((item.answer.alt || []).find(a => a.dx === user.dx) || {}).note || "";
    if (k.role === "optional" || k.note) note = note || k.note || "";
    const keySpec = specText(k.dx, k.spec);
    return `<tr>
      <td><span class="tag ${k.role === "primary" ? "must" : k.role === "comorbid" ? "consider" : "distractor"}">${ROLE_LABEL[k.role]}</span><b>${esc(dxName(k.dx))}</b>${keySpec ? `<div class="small muted">${esc(keySpec)}</div>` : ""}</td>
      <td>${user ? `${esc(dxName(user.dx))}${specText(user.dx, user.spec) ? `<div class="small muted">${esc(specText(user.dx, user.spec))}</div>` : ""}` : `<span class="muted">（沒有列出）</span>`}</td>
      <td class="${cls}">${txt}${note ? `<div class="small">${esc(note)}</div>` : ""}</td></tr>`;
  }).join("");
  const exRows = g.extras.map(x => {
    const cls = x.status === "lenient" ? "cell-lenient" : "cell-bad";
    const txt = x.status === "lenient" ? "△ 可以討論" : x.status === "wrong" ? "✘ 不應該下這個診斷" : "✘ 多餘的診斷";
    return `<tr><td class="muted">—</td><td>${esc(dxName(x.entry.dx))}</td><td class="${cls}">${txt}${x.note ? `<div class="small">${esc(x.note)}</div>` : ""}</td></tr>`;
  }).join("");

  // Specifier detail
  const specBlocks = g.rows.filter(row => row.specs && row.specs.length).map(row => {
    const lines = row.specs.map(s => {
      const show = (v, multi) => {
        if (multi) return v && v.length ? v.map(x => optName(row.key.dx, s.id, x)).join("、") : "無";
        return v ? optName(row.key.dx, s.id, v) : "（未選）";
      };
      if (!s.graded) {
        const opt = s.optional && s.optional.length ? `（選了「${s.optional.map(x => optName(row.key.dx, s.id, x)).join("、")}」也可以）` : "";
        return `<tr><td>${esc(s.label)}</td><td class="muted">書中未判定</td><td>${esc(show(s.user, Array.isArray(s.user)))}</td><td class="cell-neutral">不評分${esc(opt)}</td></tr>`;
      }
      const cls = s.status === "ok" ? "cell-ok" : s.status === "lenient" ? "cell-lenient" : "cell-bad";
      let txt = s.status === "ok" ? "✔" : s.status === "lenient" ? "△ 可接受" : s.status === "missing" ? "✘ 沒選" : "✘";
      if (s.multi && s.status !== "ok") {
        const bits = [];
        if (s.missed.length) bits.push("漏了：" + s.missed.map(x => optName(row.key.dx, s.id, x)).join("、"));
        if (s.extra.length) bits.push("多選：" + s.extra.map(x => optName(row.key.dx, s.id, x)).join("、"));
        txt += " " + bits.join("；");
      }
      const keyTxt = show(s.key, s.multi) + (s.optional && s.optional.length ? `（另可加：${s.optional.map(x => optName(row.key.dx, s.id, x)).join("、")}）` : "");
      return `<tr><td>${esc(s.label)}</td><td>${esc(keyTxt)}</td><td>${esc(show(s.user, s.multi))}</td><td class="${cls}">${esc(txt)}</td></tr>`;
    }).join("");
    return `<h4>明細：${esc(dxName(row.key.dx))}</h4><table class="fb"><tr><th>明細</th><th>標準答案</th><th>你的選擇</th><th>結果</th></tr>${lines}</table>`;
  }).join("");

  // Differential table
  const levelTag = { must: "必須考慮", consider: "合理可考慮", distractor: "較不需要" };
  const ddRows = stableShuffle(g.ddRows, item.id, x => x.dx)
    .sort((a, b) => ["must", "consider", "distractor"].indexOf(a.level) - ["must", "consider", "distractor"].indexOf(b.level))
    .map(dd => {
      const cls = dd.status === "ok" ? (dd.picked ? "cell-ok" : "") : dd.status === "missed" ? "cell-bad" : dd.status === "lenient" ? "cell-lenient" : "";
      const mark = dd.picked ? "✔ 有勾" : "—";
      const extra = dd.status === "missed" ? "（漏掉了）" : dd.status === "lenient" ? "（這個比較不需要考慮）" : "";
      return `<tr><td class="${cls}"><b>${esc(dxName(dd.dx))}</b></td><td><span class="tag ${dd.level}">${levelTag[dd.level]}</span></td><td class="${cls}">${mark}${extra}</td><td>${esc(dd.why)}</td></tr>`;
    }).join("");
  const ro = ["substance", "medical"].map(k => {
    const ok = g.ruleOut[k];
    return `<tr><td class="${ok ? "cell-ok" : "cell-bad"}"><b>${k === "substance" ? "物質／藥物所致" : "其他身體病況所致"}</b></td><td><span class="tag must">每案必查</span></td><td class="${ok ? "cell-ok" : "cell-bad"}">${ok ? "✔ 有勾" : "✘ 沒勾"}</td><td>${esc(item.rule_out[k])}</td></tr>`;
  }).join("");

  // Cards for answer diagnoses
  const cardIds = item.answer.dx.filter(k => k.role !== "optional").map(k => k.dx);
  const cards = cardIds.map((id, i) => cardHtml(id, { open: i === 0, exclude: item.id })).join("");

  return `<div class="feedback" id="feedback">
    ${S.draft.showingLast ? `<p class="small muted">以下是你上次的作答與結果。</p>` : ""}
    <h2>結果</h2>
    <div class="summary-bar">${sum.join("")}</div>
    <h3>診斷對照</h3>
    <table class="fb"><tr><th>標準答案</th><th>你的作答</th><th>結果</th></tr>${dxRows}${exRows}</table>
    ${specBlocks}
    <h3>鑑別診斷</h3>
    <table class="fb"><tr><th>候選診斷</th><th>層級</th><th>你</th><th>為什麼</th></tr>${ro}${ddRows}</table>
    <div class="reveal">書中個案：<b>「${esc(item.src.title_en)}」</b>（${esc(item.title_zh)}）・《Learning DSM-5-TR by Case Example》p. ${esc(item.src.page)}</div>
    <h3>關鍵線索</h3>
    <ul class="tight">${item.key_clues.map(k => `<li>${esc(k)}</li>`).join("")}</ul>
    <h3>本題解析</h3>
    <div class="explain">${item.explanation.map(p => `<p>${esc(p)}</p>`).join("")}</div>
    ${criteriaHtml(item)}
    <h3>複習卡</h3>
    ${cards}
  </div>`;
}

function criteriaHtml(item) {
  if (!item.criteria || !item.criteria.length) return "";
  const blocks = item.criteria.map((c, ci) => {
    const cl = S.bank.checklists[c.card];
    const rows = cl.items.map(([id, text]) => `<label class="crit-item" data-cid="${esc(id)}"><input type="checkbox" value="${esc(id)}" /><span class="cid">${esc(id)}</span><span>${esc(text)}</span><span class="verdict"></span></label>`).join("");
    return `<div class="crit" data-ci="${ci}"><b>${esc(cl.title)}</b><div class="small muted">${esc(cl.note || "")}</div>${rows}
      <div class="action-row"><button class="btn-secondary" data-act="critCheck" data-ci="${ci}">核對</button></div><div class="crit-result small"></div></div>`;
  }).join("");
  return `<h3>準則核對（不計分）</h3><p class="small muted">勾出這位個案符合的準則項目，再按「核對」對照書中的判斷。</p>${blocks}`;
}

function checkCriteria(btn) {
  const item = currentItem();
  const ci = Number(btn.dataset.ci);
  const box = btn.closest(".crit");
  const met = new Set(item.criteria[ci].met);
  let hit = 0, miss = 0, extra = 0;
  box.querySelectorAll(".crit-item").forEach(row => {
    const id = row.dataset.cid;
    const checked = row.querySelector("input").checked;
    const v = row.querySelector(".verdict");
    row.classList.remove("cell-ok", "cell-bad", "cell-lenient");
    if (met.has(id) && checked) { row.classList.add("cell-ok"); v.textContent = "✔ 符合"; hit++; }
    else if (met.has(id)) { row.classList.add("cell-bad"); v.textContent = "漏掉：書中判斷符合"; miss++; }
    else if (checked) { row.classList.add("cell-lenient"); v.textContent = "書中未判定符合"; extra++; }
    else v.textContent = "";
  });
  box.querySelector(".crit-result").textContent = `符合的項目找到 ${hit} / ${met.size}；漏掉 ${miss}；多勾 ${extra}。`;
}

// ---------- practice: duel ----------
function duelHtml(item) {
  const d = S.draft;
  const dis = d.submitted ? "disabled" : "";
  const opts = item.options.map(o => {
    let cls = d.choice === o ? "selected" : "";
    if (d.submitted) cls = o === item.answer ? "correct" : d.choice === o ? "wrong" : "";
    return `<button class="duel-opt ${cls}" data-act="duelChoice" data-v="${esc(o)}" ${dis}><b>${esc(dxName(o))}</b><div class="small muted">${esc(S.dx[o].en)}</div></button>`;
  }).join("");
  const kpOrder = stableShuffle(item.keypoints.map((t, i) => i), item.id, i => String(i));
  const kps = kpOrder.map(i => {
    let cls = "";
    if (d.submitted) cls = i === item.key_answer ? "correct" : d.key === i ? "wrong" : "";
    return `<div class="kp ${cls}" data-act="duelKey" data-i="${i}"><input type="radio" name="kp" ${d.key === i ? "checked" : ""} ${dis} tabindex="-1" /><span>${esc(item.keypoints[i])}</span></div>`;
  }).join("");
  let fb = "";
  if (d.submitted) {
    const g = d.grade;
    fb = `<div class="feedback" id="feedback">
      ${d.showingLast ? `<p class="small muted">以下是你上次的作答與結果。</p>` : ""}
      <div class="summary-bar">
        <div class="sum ${g.choiceOk ? "st-ok" : "st-bad"}"><b>診斷</b>${g.choiceOk ? "正確" : "錯誤"}</div>
        <div class="sum ${g.keyOk ? "st-ok" : "st-bad"}"><b>區辨點</b>${g.keyOk ? "正確" : "錯誤"}</div>
      </div>
      <h3>解析</h3><div class="explain"><p>${esc(item.explanation)}</p></div>
      <p class="small muted">出處：${esc(item.ref)}（題幹為依鑑別表自編）</p>
      <h3>複習卡</h3>${item.options.map(o => cardHtml(o, { open: false })).join("")}
      <div class="action-row"><button class="btn-secondary" data-act="retry">重新作答這題</button><button class="btn-flag" data-act="flag">標記討論</button></div>
    </div>`;
  }
  return `${headHtml(item)}
    <div class="narrative"><p>${esc(item.vignette)}</p></div>
    <div class="step"><div class="step-title">一、這位個案比較符合哪一個診斷？</div><div class="duel-opts">${opts}</div></div>
    <div class="step"><div class="step-title">二、決定性的區辨點是？</div>${kps}</div>
    ${d.submitted ? "" : `<div class="action-row"><button class="btn-primary" data-act="duelSubmit">送出並對答案</button><button class="btn-flag" data-act="flag">標記討論</button></div>`}
    ${fb}
    ${navHtml()}`;
}

function submitDuel(item) {
  const d = S.draft;
  if (!d.choice || d.key == null) { toast("兩題都要作答"); return; }
  const ans = { choice: d.choice, key: d.key };
  const g = window.PsyGrade.gradeDuel(item, ans);
  d.submitted = true;
  d.grade = g;
  saveAttempt(item, ans, g.result);
  renderItem();
  const fb = document.getElementById("feedback");
  if (fb) fb.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- review card ----------
function cardHtml(dxId, opts = {}) {
  const dx = S.dx[dxId];
  const card = S.bank.cards[dxId];
  const title = `${esc(dx ? dx.name : dxId)} <span class="muted small">${esc(dx ? dx.en : "")}</span>`;
  if (!card) {
    return `<details class="card" ${opts.open ? "open" : ""}><summary>${title}</summary><div class="card-body"><p class="muted">這個診斷的複習卡還沒建立，之後擴充題庫時會補上。</p></div></details>`;
  }
  const nums = (card.numbers || []).map(([k, v]) => `<span class="num"><b>${esc(k)}</b>${esc(v)}</span>`).join("");
  const cls = (card.checklists || []).map(id => {
    const cl = S.bank.checklists[id];
    return `<h4>${esc(cl.title)}</h4><div class="small muted">${esc(cl.note || "")}</div><div class="cl-list">${cl.items.map(([i, t]) => `<div><span class="cid">${esc(i)}</span>${esc(t)}</div>`).join("")}</div>`;
  }).join("");
  const specs = (card.specifiers || []).length
    ? `<h4>明細與臨床意義</h4><table class="ref">${card.specifiers.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : "";
  const ddx = (card.ddx || []).length
    ? `<h4>鑑別表：和這些診斷怎麼區分</h4><table class="ref">${card.ddx.map(([vs, pt]) => {
        const label = S.dx[vs] ? (S.bank.cards[vs] ? `<button class="linkbtn" data-act="card" data-id="${esc(vs)}">${esc(dxName(vs))}</button>` : esc(dxName(vs))) : esc(vs);
        return `<tr><th>${label}</th><td>${esc(pt)}</td></tr>`;
      }).join("")}</table>` : "";
  const pit = (card.pitfalls || []).length ? `<h4>常見陷阱</h4><ul class="tight">${card.pitfalls.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
  const epi = card.epi ? `<h4>流行病學與病程</h4><p class="small">${esc(card.epi)}</p>` : "";
  const related = S.bank.cases.filter(c => c.id !== opts.exclude && c.answer.dx.some(k => k.dx === dxId && k.role !== "optional"));
  const rel = related.length
    ? `<h4>同診斷的其他練習個案</h4><div class="chips">${related.map(c => `<button class="chip" data-act="goCase" data-id="${esc(c.id)}">#${esc(c.code)} ${statusOf(c.id) === "ok" ? "✔" : statusOf(c.id) === "part" ? "△" : ""}</button>`).join("")}</div>` : "";
  return `<details class="card" ${opts.open ? "open" : ""}><summary>${title}</summary><div class="card-body">
    <p class="card-summary">${esc(card.summary)}</p>
    <div class="refs">${[card.refs.dsm, card.refs.hb, card.refs.case].filter(Boolean).map(esc).join("　｜　")}</div>
    <div class="numbers">${nums}</div>
    <h4>核心重點</h4><ul class="tight">${card.core.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
    ${specs}${ddx}${pit}${epi}
    <details><summary class="small" style="cursor:pointer">展開準則清單</summary>${cls}</details>
    ${rel}
  </div></details>`;
}

// ---------- dashboard ----------
function metrics(resultsById) {
  const m = { cases: 0, primaryOk: 0, catOk: 0, specOk: 0, specTotal: 0, ddHit: 0, ddTotal: 0, roOk: 0, duels: 0, duelChoice: 0, duelKey: 0, allOk: 0 };
  for (const [id, r] of Object.entries(resultsById)) {
    const it = S.byId[id];
    if (!it || !r) continue;
    if (it.type === "case") {
      m.cases++;
      if (r.primaryStatus === "ok" || r.primaryStatus === "alt") m.primaryOk++;
      if (r.userCat && r.userCat === r.trueCat) m.catOk++;
      m.specOk += r.specOk || 0; m.specTotal += r.specTotal || 0;
      m.ddHit += r.ddMustHit || 0; m.ddTotal += r.ddMustTotal || 0;
      m.roOk += r.ruleOutOk || 0;
      if (r.allCorrect) m.allOk++;
    } else {
      m.duels++;
      if (r.choiceOk) m.duelChoice++;
      if (r.keyOk) m.duelKey++;
    }
  }
  return m;
}

function renderDashboard() {
  const panel = document.getElementById("dashboardPanel");
  const map = attempts();
  const mine = {};
  for (const [id, a] of Object.entries(map)) mine[id] = a.result;
  const m = metrics(mine);
  const totalCases = S.bank.cases.length, totalDuels = S.bank.duels.length;
  const stat = (n, l) => `<div class="stat-card"><div class="n">${n}</div><div class="l">${l}</div></div>`;

  // chapter table
  const chapters = [...new Set(S.items.map(i => i.chapter))];
  const chRows = chapters.map(ch => {
    const sub = {};
    for (const [id, r] of Object.entries(mine)) if (S.byId[id] && S.byId[id].chapter === ch) sub[id] = r;
    const mm = metrics(sub);
    const n = S.items.filter(i => i.chapter === ch && i.type === "case").length;
    return `<tr><th class="rowh">${esc(catName(ch))}</th><td>${mm.cases} / ${n}</td><td>${pct(mm.primaryOk, mm.cases)}</td><td>${pct(mm.specOk, mm.specTotal)}</td><td>${pct(mm.ddHit, mm.ddTotal)}</td><td>${pct(mm.duelChoice, mm.duels)}</td></tr>`;
  }).join("");

  // missed must-consider differentials
  const missCount = {};
  for (const [id, a] of Object.entries(map)) {
    const it = S.byId[id];
    if (!it || it.type !== "case" || !a.answer) continue;
    const picks = a.answer.ddx || [];
    for (const d of it.ddx) if (d.level === "must" && !picks.includes(d.dx)) missCount[d.dx] = (missCount[d.dx] || 0) + 1;
  }
  const missList = Object.entries(missCount).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([dx, n]) => `<li>${esc(dxName(dx))}：漏掉 ${n} 次</li>`).join("");

  panel.innerHTML = `
    <h2>我的表現</h2>
    <div class="stat-grid">
      ${stat(`${m.cases} / ${totalCases}`, "已作答個案")}
      ${stat(pct(m.primaryOk, m.cases), "主要診斷正確率")}
      ${stat(pct(m.catOk, m.cases), "大類別正確率")}
      ${stat(pct(m.specOk, m.specTotal), "明細正確率")}
      ${stat(pct(m.ddHit, m.ddTotal), "必須考慮的鑑別命中率")}
      ${stat(pct(m.roOk, m.cases * 2), "有勾物質／身體病況")}
      ${stat(`${m.duels} / ${totalDuels}`, "已作答對決題")}
      ${stat(pct(m.duelChoice, m.duels), "對決診斷正確率")}
      ${stat(pct(m.duelKey, m.duels), "對決區辨點正確率")}
    </div>
    <p class="small muted">以每題最後一次作答計算。</p>
    <h3>分章節</h3>
    <div class="table-scroll"><table class="cmp"><tr><th>範圍</th><th>個案作答</th><th>主要診斷</th><th>明細</th><th>必考鑑別</th><th>對決</th></tr>${chRows}</table></div>
    <h3>混淆矩陣：你常把什麼判成什麼</h3>
    <div class="seg"><button data-dash="cat" class="${S.dashLevel === "cat" ? "active" : ""}">大類別</button><button data-dash="dx" class="${S.dashLevel === "dx" ? "active" : ""}">診斷</button></div>
    <div id="confusion">${confusionHtml(mine)}</div>
    <h3>最常漏掉的「必須考慮」鑑別</h3>
    ${missList ? `<ul class="tight">${missList}</ul>` : `<p class="muted small">還沒有資料。</p>`}
    <h3>進度備份</h3>
    <p class="small muted">作答紀錄存在這台裝置的瀏覽器裡，下次用同一個瀏覽器、選同一個名字登入就會接著做。換電腦或換瀏覽器前，先下載備份，再到新的地方匯入。</p>
    <div class="action-row"><button class="btn-secondary" data-backup="export">下載進度備份</button>
      <label class="btn-secondary" style="padding:10px 18px;border-radius:8px;cursor:pointer">匯入備份<input type="file" accept=".json,application/json" id="importFile" hidden /></label></div>`;
}

function confusionHtml(results) {
  const pairs = [];
  for (const [id, r] of Object.entries(results)) {
    const it = S.byId[id];
    if (!it || it.type !== "case" || !r || !r.userPrimary) continue;
    pairs.push(S.dashLevel === "cat" ? [r.trueCat, r.userCat] : [r.truePrimary, r.userPrimary]);
  }
  if (!pairs.length) return `<p class="muted small">還沒有資料，做幾題個案診斷之後再來看。</p>`;
  const nameOf = S.dashLevel === "cat" ? catName : dxName;
  const rows = [...new Set(pairs.map(p => p[0]))];
  const cols = [...new Set([...rows, ...pairs.map(p => p[1])])];
  const count = (a, b) => pairs.filter(p => p[0] === a && p[1] === b).length;
  const head = cols.map(c => `<th>${esc(nameOf(c))}</th>`).join("");
  const body = rows.map(rw => `<tr><th class="rowh">${esc(nameOf(rw))}</th>${cols.map(c => {
    const n = count(rw, c);
    return `<td class="${n ? (rw === c ? "diag" : "off") : ""}">${n || ""}</td>`;
  }).join("")}</tr>`).join("");
  const offs = [];
  for (const rw of rows) for (const c of cols) if (rw !== c && count(rw, c)) offs.push([rw, c, count(rw, c)]);
  offs.sort((a, b) => b[2] - a[2]);
  const list = offs.slice(0, 6).map(([a, b, n]) => `<li>正確是「${esc(nameOf(a))}」，你選了「${esc(nameOf(b))}」：${n} 次</li>`).join("");
  return `<p class="small muted">列＝正確答案，欄＝你選的主要診斷。綠色是對角線（答對），紅色是誤判。</p>
    <div class="table-scroll"><table class="cmp"><tr><th>正確 ＼ 你選</th>${head}</tr>${body}</table></div>
    ${list ? `<h4>最常見的誤判</h4><ul class="tight">${list}</ul>` : ""}`;
}

function onDashClick(e) {
  const seg = e.target.closest("[data-dash]");
  if (seg) {
    S.dashLevel = seg.dataset.dash;
    document.querySelectorAll("[data-dash]").forEach(b => b.classList.toggle("active", b.dataset.dash === S.dashLevel));
    const mine = {};
    for (const [id, a] of Object.entries(attempts())) mine[id] = a.result;
    document.getElementById("confusion").innerHTML = confusionHtml(mine);
    return;
  }
  if (e.target.closest("[data-backup='export']")) exportBackup();
}

// ---------- backup ----------
function exportBackup() {
  const data = { app: "psychopathology-practice", user: S.user, exportedAt: new Date().toISOString(),
    attempts: attempts(), flags: store.get(K.flags(), []), last: store.get(K.last(), null) };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `精神病理練習進度_${S.user}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importBackup(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.app !== "psychopathology-practice" || typeof data.attempts !== "object") throw new Error("不是這個網站的備份檔");
      if (data.user !== S.user && !window.confirm(`這份備份屬於「${data.user}」，確定要匯入到「${S.user}」嗎？`)) return;
      const mine = attempts();
      let added = 0;
      for (const [id, rec] of Object.entries(data.attempts)) {
        if (!S.byId[id]) continue;
        if (!mine[id] || (rec.at || 0) > (mine[id].at || 0)) { mine[id] = rec; added++; }
      }
      store.set(K.attempts(), mine);
      const flags = store.get(K.flags(), []);
      for (const f of data.flags || []) if (!flags.some(x => x.item_id === f.item_id && x.at === f.at)) flags.push(f);
      store.set(K.flags(), flags);
      if (data.last && S.byId[data.last]) store.set(K.last(), data.last);
      toast(`已匯入，更新了 ${added} 題的紀錄`);
      renderDashboard();
    } catch (e) {
      toast("匯入失敗：" + e.message);
    } finally {
      input.value = "";
    }
  };
  reader.readAsText(file);
}

// ---------- review (訂正本) ----------
function problemsOf(item, r) {
  const p = [];
  if (item.type === "case") {
    if (r.primaryStatus === "missed") p.push("主要診斷錯");
    else if (r.primaryStatus === "cat") p.push("類別對、診斷錯");
    else if (r.primaryStatus === "alt") p.push("主要診斷可接受");
    if (r.comorbidHit < r.comorbidTotal) p.push(`漏共病 ${r.comorbidTotal - r.comorbidHit}`);
    if (r.extraWrong) p.push(`多餘診斷 ${r.extraWrong}`);
    if (r.specOk < r.specTotal) p.push(`明細 ${r.specOk}/${r.specTotal}`);
    if (r.ddMustHit < r.ddMustTotal) p.push(`漏必考鑑別 ${r.ddMustTotal - r.ddMustHit}`);
    if (r.ruleOutOk < 2) p.push("沒勾物質／身體病況");
  } else {
    if (!r.choiceOk) p.push("診斷錯");
    if (!r.keyOk) p.push("區辨點錯");
  }
  return p;
}

function renderReview() {
  const panel = document.getElementById("reviewPanel");
  const map = attempts();
  const flags = store.get(K.flags(), []);
  const flaggedIds = new Set(flags.map(f => f.item_id));
  let ids = Object.keys(map).filter(id => S.byId[id]);
  const wrongCount = ids.filter(id => !map[id].allCorrect).length;
  if (S.reviewFilter === "wrong") ids = ids.filter(id => !map[id].allCorrect);
  if (S.reviewFilter === "flagged") ids = [...flaggedIds].filter(id => S.byId[id]);
  ids.sort((a, b) => ((map[b] || {}).at || 0) - ((map[a] || {}).at || 0));
  const rows = ids.map(id => {
    const it = S.byId[id];
    const a = map[id];
    const note = flags.filter(f => f.item_id === id && f.note).map(f => f.note).join("；");
    let what = "", mine = "", right = "", probs = [];
    if (it.type === "case") {
      what = `${esc(it.title_zh)} <span class="muted small">${esc(it.src.title_en)}</span>`;
      if (a) {
        const r = a.result;
        mine = r.userPrimary ? esc(dxName(r.userPrimary)) : "—";
        right = esc(dxName(r.truePrimary));
        probs = problemsOf(it, r);
      }
    } else {
      what = `對決：${esc(dxName(it.options[0]))} vs ${esc(dxName(it.options[1]))}`;
      if (a) { mine = esc(dxName(a.answer.choice)); right = esc(dxName(it.answer)); probs = problemsOf(it, a.result); }
    }
    const st = !a ? `<span class="pill">未作答</span>` : a.allCorrect ? `<span class="pill ok">全對</span>` : `<span class="pill part">待訂正</span>`;
    const chips = probs.map(x => `<span class="tag must">${esc(x)}</span>`).join("");
    const when = a ? new Date(a.at).toLocaleDateString("zh-TW") + `・第 ${a.count} 次` : "";
    return `<div class="rv-row">
      <div class="rv-main"><span class="code">#${esc(it.code)}</span> ${st} ${what}
        ${a ? `<div class="small">你選：${mine}　｜　正確：<b>${right}</b></div>` : ""}
        ${chips ? `<div class="rv-tags">${chips}</div>` : ""}
        ${note ? `<div class="small muted">📌 ${esc(note)}</div>` : ""}
        <div class="small muted">${esc(catName(it.chapter))}${when ? "・" + when : ""}</div></div>
      <div class="rv-btns">${a ? `<button class="btn-secondary" data-rv="show" data-id="${esc(id)}">看訂正</button>` : ""}<button class="btn-primary" data-rv="redo" data-id="${esc(id)}">重做</button></div>
    </div>`;
  }).join("");
  const seg = [["wrong", `待訂正（${wrongCount}）`], ["all", `全部作答過（${Object.keys(map).filter(id => S.byId[id]).length}）`], ["flagged", `標記討論（${flaggedIds.size}）`]]
    .map(([k, l]) => `<button data-rvf="${k}" class="${S.reviewFilter === k ? "active" : ""}">${l}</button>`).join("");
  panel.innerHTML = `<h2>訂正本</h2>
    <p class="small muted">「看訂正」會打開你最後一次的作答，逐項對照標準答案與解析；「重做」會清空作答重新來。答錯的題目重做到全對，就會從「待訂正」移除。</p>
    <div class="seg">${seg}</div>
    <div>${rows || `<p class="muted">${S.reviewFilter === "wrong" ? "目前沒有待訂正的題目 🎉" : "還沒有資料。"}</p>`}</div>`;
}

function onReviewClick(e) {
  const f = e.target.closest("[data-rvf]");
  if (f) { S.reviewFilter = f.dataset.rvf; renderReview(); return; }
  const b = e.target.closest("[data-rv]");
  if (!b) return;
  if (b.dataset.rv === "show") jumpTo(b.dataset.id, true);
  else { jumpTo(b.dataset.id); S.draft = freshDraft(S.byId[b.dataset.id]); renderItem(); window.scrollTo(0, 0); }
}

// ---------- reference ----------
function renderReference() {
  const panel = document.getElementById("referencePanel");
  panel.innerHTML = `<div class="ref-layout">
    <div class="ref-side"><input id="refSearch" type="search" placeholder="搜尋診斷（中文或英文）" /><div id="refList"></div></div>
    <div id="refMain"></div></div>`;
  renderRefList("");
  renderRefMain();
}

function renderRefList(q) {
  const qq = q.trim().toLowerCase();
  const html = S.bank.taxonomy.map(c => {
    const dxs = c.diagnoses.filter(d => !qq || d.name.toLowerCase().includes(qq) || d.en.toLowerCase().includes(qq));
    if (!dxs.length) return "";
    return `<div class="ref-cat"><div class="cname">${esc(c.name)}</div>${dxs.map(d => {
      const has = !!S.bank.cards[d.id];
      return `<button class="ref-dx ${has ? "" : "nocard"} ${S.refSel === d.id ? "active" : ""}" data-ref="${esc(d.id)}">${has ? `<span class="dot">●</span> ` : ""}${esc(d.name)}</button>`;
    }).join("")}</div>`;
  }).join("");
  document.getElementById("refList").innerHTML = `<button class="ref-dx ${S.refSel ? "" : "active"}" data-ref="">鑑別診斷六步驟</button>${html}
    <p class="small muted">● ＝ 已有複習卡（目前涵蓋雙相與憂鬱類）</p>`;
}

function renderRefMain() {
  const main = document.getElementById("refMain");
  if (!S.refSel) {
    const st = S.bank.steps;
    main.innerHTML = `<h2>${esc(st.title)}</h2><p class="small muted">${esc(st.ref)}</p>
      <table class="ref">${st.items.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
      <p class="small muted">練習時的「已考慮：物質／藥物所致」「已考慮：其他身體病況所致」兩個勾選，就是步驟二與步驟三。</p>`;
    return;
  }
  main.innerHTML = cardHtml(S.refSel, { open: true });
}

function onRefClick(e) {
  const r = e.target.closest("[data-ref]");
  if (r) {
    S.refSel = r.dataset.ref || null;
    renderRefList(document.getElementById("refSearch").value);
    renderRefMain();
    if (window.innerWidth <= 720) document.getElementById("refMain").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  if (b.dataset.act === "card") { S.refSel = b.dataset.id; renderRefList(document.getElementById("refSearch").value); renderRefMain(); window.scrollTo(0, 0); }
  if (b.dataset.act === "goCase") jumpTo(b.dataset.id);
}

initLogin();
