#!/usr/bin/env python3
"""Validate data-raw/*.json and encrypt the question bank into data/bank.enc.
Run locally before each commit; never commit plaintext (data-raw/ and data/bank.json are gitignored).

Usage: python3 scripts/build.py --password <通關密語>     (or set PSY_PASSWORD)
"""
import argparse
import base64
import glob
import hashlib
import json
import os
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data-raw")
OUT = os.path.join(ROOT, "data")
ITERATIONS = 250000
DDX_LEVELS = {"must", "consider", "distractor"}
ROLES = {"primary", "comorbid", "optional"}


def load(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as f:
        return json.load(f)


def expand_taxonomy(tax, problems):
    groups = tax["spec_groups"]
    dx_index = {}
    for cat in tax["categories"]:
        for dx in cat["diagnoses"]:
            if dx["id"] in dx_index:
                problems.append(f"taxonomy: duplicate diagnosis id {dx['id']}")
            spec_out = []
            for gid in dx.get("spec", []):
                if gid not in groups:
                    problems.append(f"taxonomy: {dx['id']} references unknown spec group {gid}")
                    continue
                g = groups[gid]
                spec_out.append({
                    "id": gid, "label": g["label"], "multi": bool(g.get("multi")),
                    "options": [{"id": o[0], "name": o[1]} for o in g["options"]],
                })
            dx["spec"] = spec_out
            dx["cat"] = cat["id"]
            dx_index[dx["id"]] = dx
    del tax["spec_groups"]
    return dx_index


def check_spec(where, dx, specmap, problems, allow_list_for_single=False):
    groups = {g["id"]: g for g in dx["spec"]}
    for gid, val in specmap.items():
        if gid not in groups:
            problems.append(f"{where}: spec group '{gid}' not valid for {dx['id']}")
            continue
        opts = {o["id"] for o in groups[gid]["options"]}
        vals = val if isinstance(val, list) else [val]
        if isinstance(val, list) and not groups[gid]["multi"] and not allow_list_for_single:
            problems.append(f"{where}: spec group '{gid}' is single-choice but got a list")
        for v in vals:
            if v not in opts:
                problems.append(f"{where}: spec '{gid}' has unknown option '{v}'")


def validate_cases(cases, dx_index, checklists, problems):
    seen = set()
    for c in cases:
        cid = c.get("id", "?")
        if cid in seen:
            problems.append(f"duplicate case id {cid}")
        seen.add(cid)
        for field in ["chapter", "src", "title_zh", "prompt", "narrative", "answer", "ddx", "explanation", "rule_out"]:
            if not c.get(field):
                problems.append(f"{cid}: missing field '{field}'")
        ans = c.get("answer", {})
        prim = [d for d in ans.get("dx", []) if d.get("role") == "primary"]
        if len(prim) != 1:
            problems.append(f"{cid}: needs exactly one primary dx (got {len(prim)})")
        answer_ids = set()
        for d in ans.get("dx", []):
            if d.get("role") not in ROLES:
                problems.append(f"{cid}: bad role {d.get('role')}")
            dx = dx_index.get(d["dx"])
            if not dx:
                problems.append(f"{cid}: unknown answer dx {d['dx']}")
                continue
            answer_ids.add(d["dx"])
            check_spec(f"{cid}/{d['dx']}", dx, d.get("spec", {}), problems)
            check_spec(f"{cid}/{d['dx']} spec_alt", dx, d.get("spec_alt", {}), problems, allow_list_for_single=True)
            check_spec(f"{cid}/{d['dx']} spec_optional", dx, d.get("spec_optional", {}), problems)
        for key in ["alt", "excluded"]:
            for e in ans.get(key, []):
                if e["dx"] not in dx_index:
                    problems.append(f"{cid}: unknown {key} dx {e['dx']}")
                if e["dx"] in answer_ids:
                    problems.append(f"{cid}: {key} dx {e['dx']} is also an answer dx")
        ddx_ids = set()
        for r in c.get("ddx", []):
            if r["dx"] not in dx_index:
                problems.append(f"{cid}: unknown ddx {r['dx']}")
            if r.get("level") not in DDX_LEVELS:
                problems.append(f"{cid}: bad ddx level {r.get('level')}")
            if r["dx"] in ddx_ids:
                problems.append(f"{cid}: duplicate ddx {r['dx']}")
            if r["dx"] in answer_ids:
                problems.append(f"{cid}: ddx {r['dx']} is also an answer dx (remove it from the candidate list)")
            ddx_ids.add(r["dx"])
        if not (5 <= len(ddx_ids) <= 8):
            problems.append(f"{cid}: ddx should have 5–8 candidates (got {len(ddx_ids)})")
        for crit in c.get("criteria", []):
            cl = checklists.get(crit["card"])
            if not cl:
                problems.append(f"{cid}: unknown checklist {crit['card']}")
                continue
            ids = {i[0] for i in cl["items"]}
            for m in crit["met"]:
                if m not in ids:
                    problems.append(f"{cid}: checklist {crit['card']} has no item {m}")


def validate_cards(dis, dx_index, problems):
    for key, card in dis["cards"].items():
        if key not in dx_index:
            problems.append(f"card '{key}' is not a taxonomy diagnosis")
        for cl in card.get("checklists", []):
            if cl not in dis["checklists"]:
                problems.append(f"card '{key}': unknown checklist {cl}")
        for row in card.get("ddx", []):
            vs = row[0]
            if vs not in dx_index and all(ord(ch) < 128 for ch in vs):
                problems.append(f"card '{key}': ddx '{vs}' looks like an id but is not in taxonomy")


def validate_duels(duels, dx_index, problems):
    seen = set()
    for d in duels:
        if d["id"] in seen:
            problems.append(f"duplicate duel id {d['id']}")
        seen.add(d["id"])
        for o in d["options"]:
            if o not in dx_index:
                problems.append(f"duel {d['id']}: unknown option {o}")
        if d["answer"] not in d["options"]:
            problems.append(f"duel {d['id']}: answer not among options")
        if not (0 <= d["key_answer"] < len(d["keypoints"])):
            problems.append(f"duel {d['id']}: key_answer out of range")


def short_code(item_id):
    return hashlib.sha1(("psy:" + item_id).encode()).hexdigest()[:4].upper()


def encrypt(plain, password):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(password.encode())
    ct = AESGCM(key).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"salt": b64(salt), "iv": b64(iv), "iterations": ITERATIONS, "ciphertext": b64(ct)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", default=os.environ.get("PSY_PASSWORD"))
    ap.add_argument("--allow-problems", action="store_true")
    args = ap.parse_args()
    if not args.password:
        sys.exit("請用 --password 或環境變數 PSY_PASSWORD 提供通關密語")

    problems = []
    tax = load("taxonomy.json")
    dx_index = expand_taxonomy(tax, problems)
    dis = load("disorders.json")
    cases = []
    for path in sorted(glob.glob(os.path.join(RAW, "cases_*.json"))):
        with open(path, encoding="utf-8") as f:
            arr = json.load(f)
        print(f"{os.path.basename(path)}: {len(arr)} cases")
        cases.extend(arr)
    duels = load("duels.json")
    print(f"duels.json: {len(duels)} duels")

    validate_cases(cases, dx_index, dis["checklists"], problems)
    validate_cards(dis, dx_index, problems)
    validate_duels(duels, dx_index, problems)

    codes = {}
    for it in cases + duels:
        code = short_code(it["id"])
        if code in codes:
            problems.append(f"code collision {code}: {codes[code]} / {it['id']}")
        codes[code] = it["id"]
        it["code"] = code

    if problems:
        print("\n--- VALIDATION PROBLEMS ---")
        for p in problems:
            print(" -", p)
        if not args.allow_problems:
            sys.exit("\n驗證失敗，未輸出。請修正 data-raw/ 後再試。")

    bank = {
        "version": 1,
        "taxonomy": tax["categories"],
        "steps": dis["steps"],
        "checklists": dis["checklists"],
        "cards": dis["cards"],
        "cases": cases,
        "duels": duels,
    }
    plain = json.dumps(bank, ensure_ascii=False).encode("utf-8")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "bank.json"), "w", encoding="utf-8") as f:  # gitignored debug copy
        json.dump(bank, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, "bank.enc"), "w", encoding="utf-8") as f:
        json.dump(encrypt(plain, args.password), f)
    print(f"\n{len(cases)} cases, {len(duels)} duels, {len(dis['cards'])} review cards")
    print(f"Wrote data/bank.enc ({os.path.getsize(os.path.join(OUT, 'bank.enc')) / 1024:.1f} KB). Commit bank.enc only.")


if __name__ == "__main__":
    main()
