// Optional cloud sync through a Google Apps Script web app (see gas/Code.gs).
// Every record keeps an `at` timestamp; when local and cloud disagree, the newer one wins.
// Pushes that fail (offline, quota) wait in a per-user queue and are retried later.

const PsySync = (() => {
  let user = null;
  let state = "off";           // off | syncing | ok | offline
  let listeners = [];
  let lastTimer = null;

  const url = () => (window.PsyConfig.SYNC_URL || "").trim();
  const enabled = () => !!url();
  const qKey = () => `psy_sync_queue_${user}`;

  function setState(s) { state = s; listeners.forEach(fn => fn(s)); }
  function readQueue() { try { return JSON.parse(localStorage.getItem(qKey()) || "[]"); } catch { return []; } }
  function writeQueue(q) { try { localStorage.setItem(qKey(), JSON.stringify(q)); } catch { /* storage blocked */ } }

  async function call(action, payload) {
    const res = await fetch(url(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight on Apps Script
      body: JSON.stringify({ action, payload: { user, ...payload } }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "sync failed");
    return data;
  }

  async function flush() {
    if (!enabled() || !user) return;
    const q = readQueue();
    if (!q.length) { setState("ok"); return; }
    // Keep only the newest pending write per item.
    const latest = {};
    for (const it of q) if (!latest[it.item_id] || latest[it.item_id].at <= it.at) latest[it.item_id] = it;
    const items = Object.values(latest);
    setState("syncing");
    try {
      for (let i = 0; i < items.length; i += 50) await call("put", { items: items.slice(i, i + 50) });
      writeQueue([]);
      setState("ok");
    } catch {
      writeQueue(items);
      setState("offline");
    }
  }

  function push(item_id, record, at) {
    if (!enabled() || !user) return;
    const q = readQueue();
    q.push({ item_id, record, at: at || Date.now() });
    writeQueue(q);
    flush();
  }

  // Debounced, because the last-viewed item changes every time someone clicks "next".
  function pushLast(itemId) {
    if (!enabled() || !user) return;
    clearTimeout(lastTimer);
    lastTimer = setTimeout(() => push("__last__", itemId), 4000);
  }

  // Merge cloud records into the local store and send up anything that is newer locally.
  async function pull(local) {
    if (!enabled() || !user) return null;
    setState("syncing");
    try {
      const { records } = await call("get", {});
      const toPush = [];
      const attemptsLocal = local.attempts;
      for (const [id, rec] of Object.entries(attemptsLocal)) {
        const remote = records[id];
        if (!remote || (rec.at || 0) > remote.at) toPush.push({ item_id: id, record: rec, at: rec.at || Date.now() });
      }
      for (const [id, remote] of Object.entries(records)) {
        if (id.startsWith("__")) continue;
        const mine = attemptsLocal[id];
        if (!mine || remote.at > (mine.at || 0)) attemptsLocal[id] = remote.record;
      }
      // Flags: union of both lists.
      const remoteFlags = records.__flags__ ? records.__flags__.record : [];
      const flags = [...local.flags];
      for (const f of remoteFlags) if (!flags.some(x => x.item_id === f.item_id && x.at === f.at)) flags.push(f);
      if (flags.length !== remoteFlags.length) toPush.push({ item_id: "__flags__", record: flags, at: Date.now() });
      // Last position: newer wins.
      let last = local.last;
      if (records.__last__ && (!local.lastAt || records.__last__.at > local.lastAt)) last = records.__last__.record;
      if (toPush.length) {
        const q = readQueue();
        writeQueue(q.concat(toPush));
      }
      await flush();
      return { attempts: attemptsLocal, flags, last };
    } catch {
      setState("offline");
      return null;
    }
  }

  function start(u) {
    user = u;
    setState(enabled() ? "syncing" : "off");
    window.addEventListener("online", flush);
    setInterval(() => { if (state === "offline") flush(); }, 60000);
  }

  return {
    start, pull, push, pushLast, flush, enabled,
    get state() { return state; },
    onChange(fn) { listeners.push(fn); },
  };
})();

window.PsySync = PsySync;
