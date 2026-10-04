// Grading for case-diagnosis items and differential duels.
// A case answer is { entries: [{ cat, dx, spec }], ruleOut: { substance, medical }, ddx: [dxId] }.

function sameSet(a, b) {
  return a.length === b.length && a.every(x => b.includes(x));
}

// Compare the user's specifiers for one matched diagnosis against the key.
// Groups absent from the key are not graded (the book did not determine them).
function gradeSpecs(dxDef, keyRow, userSpec) {
  const groups = [];
  const keySpec = keyRow.spec || {};
  const alt = keyRow.spec_alt || {};
  const optional = keyRow.spec_optional || {};
  for (const g of dxDef.spec || []) {
    const user = userSpec[g.id];
    if (!(g.id in keySpec)) {
      const hasPick = g.multi ? (user || []).length > 0 : !!user;
      if (hasPick || (optional[g.id] || []).length) {
        groups.push({ id: g.id, label: g.label, graded: false, user, key: null, optional: optional[g.id] || [] });
      }
      continue;
    }
    const key = keySpec[g.id];
    if (g.multi) {
      const req = key || [];
      const opt = optional[g.id] || [];
      const picked = user || [];
      const missed = req.filter(v => !picked.includes(v));
      const extra = picked.filter(v => !req.includes(v) && !opt.includes(v));
      const status = !missed.length && !extra.length ? "ok" : "wrong";
      groups.push({ id: g.id, label: g.label, graded: true, multi: true, user: picked, key: req, optional: opt, missed, extra, status });
    } else {
      let status = "wrong";
      if (user === key) status = "ok";
      else if (user && (alt[g.id] || []).includes(user)) status = "lenient";
      else if (!user) status = "missing";
      groups.push({ id: g.id, label: g.label, graded: true, user, key, status, alt: alt[g.id] || [] });
    }
  }
  return groups;
}

function gradeCase(item, ans, dxIndex) {
  const key = item.answer;
  const entries = (ans.entries || []).filter(e => e.dx);
  const used = new Set();
  const rows = [];
  const altIds = (key.alt || []).map(a => a.dx);

  // Pass 1: exact matches.
  for (const k of key.dx) {
    const idx = entries.findIndex((e, i) => !used.has(i) && e.dx === k.dx);
    rows.push({ key: k, userIdx: idx >= 0 ? idx : null, status: idx >= 0 ? "ok" : null });
    if (idx >= 0) used.add(idx);
  }
  // Pass 2: accepted alternatives, then same-category picks, for required rows still unmatched.
  for (const r of rows) {
    if (r.status || r.key.role === "optional") continue;
    let idx = r.key.role === "primary" ? entries.findIndex((e, i) => !used.has(i) && altIds.includes(e.dx)) : -1;
    if (idx >= 0) { r.status = "alt"; r.userIdx = idx; used.add(idx); continue; }
    const cat = dxIndex[r.key.dx].cat;
    idx = entries.findIndex((e, i) => !used.has(i) && dxIndex[e.dx] && dxIndex[e.dx].cat === cat
      && !key.dx.some(k2 => k2.dx === e.dx));
    if (idx >= 0) { r.status = "cat"; r.userIdx = idx; used.add(idx); continue; }
    r.status = "missed";
  }
  for (const r of rows) if (!r.status) r.status = "optional_missed";

  // Leftover user entries.
  const extras = [];
  entries.forEach((e, i) => {
    if (used.has(i)) return;
    const ex = (key.excluded || []).find(x => x.dx === e.dx);
    const al = (key.alt || []).find(x => x.dx === e.dx);
    if (ex) extras.push({ entry: e, status: ex.level === "lenient" ? "lenient" : "wrong", note: ex.note });
    else if (al) extras.push({ entry: e, status: "lenient", note: al.note });
    else extras.push({ entry: e, status: "extra", note: null });
  });

  // Specifiers for exact matches.
  let specOk = 0, specTotal = 0;
  for (const r of rows) {
    if (r.status !== "ok") continue;
    r.specs = gradeSpecs(dxIndex[r.key.dx], r.key, entries[r.userIdx].spec || {});
    for (const g of r.specs) {
      if (!g.graded) continue;
      specTotal++;
      if (g.status === "ok" || g.status === "lenient") specOk++;
    }
  }

  // Differential candidates.
  const picks = ans.ddx || [];
  const ddRows = item.ddx.map(d => {
    const picked = picks.includes(d.dx);
    let status;
    if (d.level === "must") status = picked ? "ok" : "missed";
    else if (d.level === "consider") status = picked ? "ok" : "neutral";
    else status = picked ? "lenient" : "ok";
    return { ...d, picked, status };
  });
  const must = ddRows.filter(d => d.level === "must");
  const ruleOut = { substance: !!(ans.ruleOut || {}).substance, medical: !!(ans.ruleOut || {}).medical };

  const primaryRow = rows.find(r => r.key.role === "primary");
  const required = rows.filter(r => r.key.role !== "optional");
  const comorbid = rows.filter(r => r.key.role === "comorbid");
  const firstUser = entries[0] || null;
  const result = {
    primaryStatus: primaryRow.status,
    comorbidHit: comorbid.filter(r => r.status === "ok").length,
    comorbidTotal: comorbid.length,
    extraWrong: extras.filter(x => x.status === "wrong" || x.status === "extra").length,
    specOk, specTotal,
    ddMustHit: must.filter(d => d.picked).length,
    ddMustTotal: must.length,
    ddDistractorPicked: ddRows.filter(d => d.level === "distractor" && d.picked).length,
    ruleOutOk: (ruleOut.substance ? 1 : 0) + (ruleOut.medical ? 1 : 0),
    truePrimary: primaryRow.key.dx,
    trueCat: dxIndex[primaryRow.key.dx].cat,
    userPrimary: firstUser ? firstUser.dx : null,
    userCat: firstUser ? (dxIndex[firstUser.dx] || {}).cat || null : null,
  };
  result.allCorrect = required.every(r => r.status === "ok") && result.extraWrong === 0;
  return { rows, extras, ddRows, ruleOut, result };
}

function gradeDuel(item, ans) {
  const choiceOk = ans.choice === item.answer;
  const keyOk = ans.key === item.key_answer;
  return { choiceOk, keyOk, result: { choiceOk, keyOk, allCorrect: choiceOk && keyOk } };
}

window.PsyGrade = { gradeCase, gradeDuel, sameSet };
