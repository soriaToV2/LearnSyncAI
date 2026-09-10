"""
Builds a VERIFICATION workbook for the mastery-evidence export.

Every number the platform computed is placed beside a LIVE EXCEL FORMULA that
recomputes it from the raw parameters, so a reader can click any cell and see the
arithmetic. Nothing in the derived columns is a pasted value.

What it verifies
  1. EQ(1)/EQ(2) evidence phase   - per observation, against p_l_evidence
  2. EQ(3)  transition phase      - per observation, against p_l_posterior
  3. P(G) selection               - the applied guess rate against the rate the
                                    parameter table says that context should use
                                    (catches a wrong GUESS_KEY mapping, which an
                                    equation-only check cannot see)
  4. Chain integrity              - each concept's newest posterior against the
                                    stored bkt_mastery.latent_mastery
  5. The export's aggregates      - start_mastery / end_mastery / growth / m_doc,
                                    rebuilt with AVERAGEIFS + EQ(4)

Usage
  python scripts/mastery-evidence-xlsx.py [-o OUT.xlsx] [--material <uuid>]

Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env. Read-only: it issues
GETs and never writes to the database.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    from openpyxl import Workbook
    from openpyxl.formatting.rule import CellIsRule
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.workbook.defined_name import DefinedName
except ImportError:
    sys.exit("openpyxl is required:  pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = 1000  # PostgREST default cap - every fetch below pages explicitly.

# The eleven seeded bkt_parameters rows (server/lib/bkt.ts).
GUESS_KEYS = {
    "g_mc": 0.25,
    "g_tf": 0.50,
    "g_id": 0.05,
    "g_fib": 0.05,
    "g_match": 0.17,
    "g_easy": 0.05,
    "g_medium": 0.25,
    "g_hard": 0.10,
}
GUESS_BY_FORMAT = {
    "multiple_choice": "g_mc",
    "true_or_false": "g_tf",
    "identification": "g_id",
    "fill_in_the_blank": "g_fib",
    "matching_type": "g_match",
}
GUESS_BY_RATING = {"easy": "g_easy", "medium": "g_medium", "hard": "g_hard"}

HDR = PatternFill("solid", fgColor="1F3864")
HDR_FONT = Font(color="FFFFFF", bold=True, size=10)
SUB = PatternFill("solid", fgColor="D9E2F3")
CALC = PatternFill("solid", fgColor="FFF2CC")  # Excel-computed
APP = PatternFill("solid", fgColor="E2EFDA")  # what the platform stored
GOOD = PatternFill("solid", fgColor="C6EFCE")
BAD = PatternFill("solid", fgColor="FFC7CE")
TITLE = Font(bold=True, size=14, color="1F3864")
MONO = Font(name="Consolas", size=9)
THIN = Border(*[Side(style="thin", color="BFBFBF")] * 4)

SECTIONS = {
    "VERDICT",
    "HOW TO READ IT",
    "SHEETS",
    "WHAT EACH CHECK CATCHES",
    "READ THIS BEFORE QUOTING m_doc",
    "start_mastery IS NOT A PRE-TEST",
}


def load_env() -> tuple[str, str]:
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        sys.exit(f".env not found at {path}")
    env = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env")
    return url.rstrip("/"), key


def fetch(base: str, key: str, table: str, select: str, params: dict | None = None) -> list[dict]:
    """GET every row of `table`, paging past PostgREST's 1000-row cap."""
    rows: list[dict] = []
    offset = 0
    while True:
        query = {"select": select}
        if params:
            query.update(params)
        url = f"{base}/rest/v1/{table}?{urllib.parse.urlencode(query)}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + PAGE - 1}",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            page = json.loads(resp.read().decode("utf-8"))
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def head(ws, row: int, labels: list[str], widths: list[int]) -> None:
    for i, (label, width) in enumerate(zip(labels, widths), start=1):
        cell = ws.cell(row=row, column=i, value=label)
        cell.fill, cell.font, cell.border = HDR, HDR_FONT, THIN
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = ws.cell(row=row + 1, column=1)


def flag(ws, ref: str, word: str, fill: PatternFill) -> None:
    ws.conditional_formatting.add(
        ref, CellIsRule(operator="equal", formula=[f'"{word}"'], fill=fill)
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "-o", "--out", default=os.path.join(ROOT, "mastery-evidence-verification.xlsx")
    )
    ap.add_argument("--material", help="restrict to one material id")
    args = ap.parse_args()

    base, key = load_env()
    print("Fetching (read-only)...")

    profiles = fetch(base, key, "profiles", "id,username,first_name,last_name,grade_level,role,status")
    materials = fetch(base, key, "materials", "id,title,subject,grade_levels,is_archived")
    concepts = fetch(base, key, "concepts", "id,material_id,term")
    mastery = fetch(
        base, key, "bkt_mastery",
        "student_id,concept_id,latent_mastery,opportunity_count,last_updated",
    )
    logs = fetch(
        base, key, "bkt_update_logs",
        "student_id,concept_id,source,observation,p_l_prior,p_guess,p_slip,p_transit,"
        "p_l_evidence,p_l_posterior,rating,question_type,created_at",
        {"order": "created_at.asc"},
    )

    print(f"  profiles {len(profiles)}  materials {len(materials)}  concepts {len(concepts)}")
    print(f"  bkt_mastery {len(mastery)}  bkt_update_logs {len(logs)}")

    pro = {p["id"]: p for p in profiles}
    mat = {m["id"]: m for m in materials}
    con = {c["id"]: c for c in concepts}

    if args.material:
        keep = {c["id"] for c in concepts if c["material_id"] == args.material}
        concepts = [c for c in concepts if c["id"] in keep]
        mastery = [m for m in mastery if m["concept_id"] in keep]
        logs = [row for row in logs if row["concept_id"] in keep]

    # Opportunity index t, per (student, concept), in created_at order.
    counter: dict[tuple[str, str], int] = {}
    for row in logs:
        pair = (row["student_id"], row["concept_id"])
        counter[pair] = counter.get(pair, 0) + 1
        row["_t"] = counter[pair]

    wb = Workbook()

    # -- Parameters -----------------------------------------------------------
    ws = wb.active
    ws.title = "Parameters"
    ws["A1"] = "BKT parameters"
    ws["A1"].font = TITLE
    ws["A2"] = (
        "Every formula in this workbook references these cells by name. "
        "Change one and the whole workbook recomputes."
    )
    ws["A2"].font = Font(italic=True, size=9)

    for col, label in zip("ABC", ("name", "value", "meaning")):
        ws[f"{col}4"] = label
        ws[f"{col}4"].fill, ws[f"{col}4"].font = HDR, HDR_FONT

    core = [
        ("P_L0", 0.10, "P(L0) - prior for a concept never assessed"),
        ("P_T", 0.20, "P(T)  - learning rate per opportunity"),
        ("P_S", 0.15, "P(S)  - slip: knows it, answers wrong anyway"),
    ]
    for i, (name, value, meaning) in enumerate(core, start=5):
        ws.cell(row=i, column=1, value=name).font = Font(bold=True)
        ws.cell(row=i, column=2, value=value).fill = SUB
        ws.cell(row=i, column=3, value=meaning)
        wb.defined_names.add(DefinedName(name, attr_text=f"Parameters!$B${i}"))

    ws["A9"] = "P(G) by assessment context - never one fixed value (paper p. 72)"
    ws["A9"].font = Font(bold=True)
    for col, label in zip("ABC", ("key", "value", "context")):
        ws[f"{col}10"] = label
        ws[f"{col}10"].fill, ws[f"{col}10"].font = HDR, HDR_FONT

    notes = {
        "g_mc": "adaptive test - multiple choice (1/4)",
        "g_tf": "adaptive test - true or false (1/2)",
        "g_id": "adaptive test - identification",
        "g_fib": "adaptive test - fill in the blank",
        "g_match": "adaptive test - matching (1 of 6, per matched item)",
        "g_easy": "flashcard rated Easy   -> observation 1",
        "g_medium": "flashcard rated Medium -> observation 1",
        "g_hard": "flashcard rated Hard   -> observation 0",
    }
    for i, (gkey, value) in enumerate(GUESS_KEYS.items(), start=11):
        ws.cell(row=i, column=1, value=gkey).font = MONO
        ws.cell(row=i, column=2, value=value).fill = SUB
        ws.cell(row=i, column=3, value=notes[gkey])
    wb.defined_names.add(
        DefinedName("ParamTable", attr_text=f"Parameters!$A$11:$B${10 + len(GUESS_KEYS)}")
    )
    for col, width in zip("ABC", (14, 12, 52)):
        ws.column_dimensions[col].width = width

    ws["A21"] = "The equations (paper p. 69)"
    ws["A21"].font = Font(bold=True)
    equations = [
        "EQ(1) correct    P(Lt|obs=1) = P(Lt)(1-P(S)) / [ P(Lt)(1-P(S)) + (1-P(Lt))P(G) ]",
        "EQ(2) incorrect  P(Lt|obs=0) = P(Lt)P(S)     / [ P(Lt)P(S)     + (1-P(Lt))(1-P(G)) ]",
        "EQ(3) transition P(Lt+1)     = P(Lt|obs) + (1 - P(Lt|obs)) * P(T)",
        "EQ(4) document   m_doc       = mean of per-concept P(L) over ALL concepts,",
        "                               unassessed concepts entering at P(L0) = 0.10",
    ]
    for i, text in enumerate(equations, start=22):
        ws.cell(row=i, column=1, value=text).font = MONO

    # -- Observations ---------------------------------------------------------
    obs = wb.create_sheet("Observations")
    obs["A1"] = "Every BKT update, recomputed"
    obs["A1"].font = TITLE
    obs["A2"] = (
        "Green = what the platform stored in bkt_update_logs.  "
        "Yellow = recomputed here by Excel formula.  Click any yellow cell to see the arithmetic."
    )
    obs["A2"].font = Font(italic=True, size=9)
    head(
        obs, 4,
        ["student", "student name", "material", "concept", "t", "source", "context", "guess key",
         "P(G) expected", "P(G) applied", "P(G) check", "obs", "prior P(Lt)", "P(S)", "P(T)",
         "app evidence", "EXCEL evidence EQ(1)/(2)", "diff", "app posterior",
         "EXCEL posterior EQ(3)", "diff", "ICR +/-0.01", "exact", "key"],
        [16, 20, 26, 30, 5, 14, 15, 11, 13, 13, 11, 6, 14, 8, 8,
         18, 24, 11, 18, 24, 11, 12, 9, 30],
    )

    r = 5
    for row in logs:
        concept = con.get(row["concept_id"], {})
        person = pro.get(row["student_id"], {})
        material = mat.get(concept.get("material_id"), {})
        context = row.get("rating") or row.get("question_type") or ""
        gkey = (
            GUESS_BY_RATING.get(row.get("rating") or "")
            or GUESS_BY_FORMAT.get(row.get("question_type") or "")
            or ""
        )
        name = f"{person.get('first_name', '')} {person.get('last_name', '')}".strip()
        values = [
            person.get("username", ""), name, material.get("title", ""), concept.get("term", ""),
            row["_t"], row["source"], context, gkey,
            None, float(row["p_guess"]), None, int(row["observation"]),
            float(row["p_l_prior"]), float(row["p_slip"]), float(row["p_transit"]),
            float(row["p_l_evidence"]), None, None, float(row["p_l_posterior"]),
            None, None, None, None,
            f'{row["student_id"]}|{row["concept_id"]}|{row["_t"]}',
        ]
        for i, value in enumerate(values, start=1):
            obs.cell(row=r, column=i, value=value).border = THIN

        obs.cell(row=r, column=9, value=f'=IFERROR(VLOOKUP(H{r},ParamTable,2,FALSE),"")')
        obs.cell(
            row=r, column=11,
            value=f'=IF(H{r}="","n/a",IF(ABS(I{r}-J{r})<0.000000001,"OK","MISMATCH"))',
        )
        obs.cell(
            row=r, column=17,
            value=(
                f"=IF(L{r}=1,"
                f"M{r}*(1-N{r})/(M{r}*(1-N{r})+(1-M{r})*J{r}),"
                f"M{r}*N{r}/(M{r}*N{r}+(1-M{r})*(1-J{r})))"
            ),
        )
        obs.cell(row=r, column=18, value=f"=ABS(P{r}-Q{r})")
        obs.cell(row=r, column=20, value=f"=Q{r}+(1-Q{r})*O{r}")
        obs.cell(row=r, column=21, value=f"=ABS(S{r}-T{r})")
        obs.cell(row=r, column=22, value=f'=IF(AND(R{r}<=0.01,U{r}<=0.01),"PASS","FAIL")')
        obs.cell(
            row=r, column=23,
            value=f'=IF(AND(R{r}<=0.000000001,U{r}<=0.000000001),"EXACT","DIFF")',
        )
        for col in (9, 11, 17, 18, 20, 21, 22, 23):
            obs.cell(row=r, column=col).fill = CALC
            obs.cell(row=r, column=col).border = THIN
        for col in (10, 16, 19):
            obs.cell(row=r, column=col).fill = APP
        for col in (13, 16, 17, 19, 20):
            obs.cell(row=r, column=col).number_format = "0.0000000000"
        for col in (18, 21):
            obs.cell(row=r, column=col).number_format = "0.00E+00"
        r += 1

    obs_last = r - 1
    obs.auto_filter.ref = f"A4:W{obs_last}"
    for col in ("K", "V", "W"):
        ref = f"{col}5:{col}{obs_last}"
        for word in ("OK", "PASS", "EXACT"):
            flag(obs, ref, word, GOOD)
        for word in ("MISMATCH", "FAIL", "DIFF"):
            flag(obs, ref, word, BAD)

    # -- MasteryNow -----------------------------------------------------------
    mn = wb.create_sheet("MasteryNow")
    mn["A1"] = "bkt_mastery, with chain integrity check"
    mn["A1"].font = TITLE
    mn["A2"] = (
        "first / last posterior are pulled out of Observations by formula. "
        "'chain ok' proves the newest logged posterior equals the stored latent_mastery."
    )
    mn["A2"].font = Font(italic=True, size=9)
    head(
        mn, 4,
        ["student id", "student", "material id", "material", "concept id", "concept",
         "latent_mastery (app)", "opportunities", "log rows found", "first posterior",
         "last posterior", "chain ok"],
        [34, 16, 34, 26, 34, 30, 18, 13, 14, 16, 16, 10],
    )

    r = 5
    ordered = sorted(
        mastery,
        key=lambda x: (
            pro.get(x["student_id"], {}).get("username", ""),
            con.get(x["concept_id"], {}).get("term", ""),
        ),
    )
    for item in ordered:
        concept = con.get(item["concept_id"], {})
        person = pro.get(item["student_id"], {})
        material = mat.get(concept.get("material_id"), {})
        values = [
            item["student_id"], person.get("username", ""), concept.get("material_id", ""),
            material.get("title", ""), item["concept_id"], concept.get("term", ""),
            float(item["latent_mastery"]), int(item["opportunity_count"]),
        ]
        for i, value in enumerate(values, start=1):
            mn.cell(row=r, column=i, value=value).border = THIN
        mn.cell(row=r, column=7).fill = APP
        mn.cell(row=r, column=7).number_format = "0.0000000000"
        mn.cell(row=r, column=9, value=f'=COUNTIFS(Observations!$X:$X,$A{r}&"|"&$E{r}&"|*")')
        mn.cell(
            row=r, column=10,
            value=(
                f'=IFERROR(INDEX(Observations!$T:$T,'
                f'MATCH($A{r}&"|"&$E{r}&"|1",Observations!$X:$X,0)),"no trail")'
            ),
        )
        mn.cell(
            row=r, column=11,
            value=(
                f'=IFERROR(INDEX(Observations!$T:$T,'
                f'MATCH($A{r}&"|"&$E{r}&"|"&$H{r},Observations!$X:$X,0)),"no trail")'
            ),
        )
        mn.cell(
            row=r, column=12,
            value=(
                f'=IF(ISNUMBER($K{r}),'
                f'IF(ABS($K{r}-$G{r})<0.000000001,"OK","MISMATCH"),"no trail")'
            ),
        )
        for col in (9, 10, 11, 12):
            mn.cell(row=r, column=col).fill = CALC
            mn.cell(row=r, column=col).border = THIN
        for col in (10, 11):
            mn.cell(row=r, column=col).number_format = "0.0000000000"
        r += 1

    mn_last = r - 1
    mn.auto_filter.ref = f"A4:L{mn_last}"
    flag(mn, f"L5:L{mn_last}", "OK", GOOD)
    flag(mn, f"L5:L{mn_last}", "MISMATCH", BAD)

    # -- Concepts -------------------------------------------------------------
    cs = wb.create_sheet("Concepts")
    cs["A1"] = "Concept catalogue - the denominator of EQ(4)"
    cs["A1"].font = TITLE
    head(cs, 4, ["concept id", "material id", "material", "concept"], [34, 34, 30, 44])
    ordered_concepts = sorted(
        concepts, key=lambda x: (mat.get(x["material_id"], {}).get("title", ""), x["term"])
    )
    for i, concept in enumerate(ordered_concepts, start=5):
        values = [
            concept["id"], concept["material_id"],
            mat.get(concept["material_id"], {}).get("title", ""), concept["term"],
        ]
        for j, value in enumerate(values, start=1):
            cs.cell(row=i, column=j, value=value).border = THIN
    cs.auto_filter.ref = f"A4:D{4 + len(concepts)}"

    # -- Evidence -------------------------------------------------------------
    ev = wb.create_sheet("Evidence")
    ev["A1"] = "The exported figures, rebuilt from formulas"
    ev["A1"].font = TITLE
    ev["A2"] = (
        "Compare these against the CSV the app downloads. Every column here is an Excel formula "
        "over MasteryNow / Concepts - none of it is a pasted result."
    )
    ev["A2"].font = Font(italic=True, size=9)
    head(
        ev, 4,
        ["student id", "student", "last name", "first name", "grade", "material id", "material",
         "concept_count", "assessed", "opportunities", "start_mastery", "end_mastery",
         "growth", "m_doc", "tier"],
        [34, 16, 16, 16, 7, 34, 28, 14, 10, 13, 14, 14, 12, 12, 14],
    )

    pairs = sorted(
        {
            (item["student_id"], con.get(item["concept_id"], {}).get("material_id"))
            for item in mastery
            if con.get(item["concept_id"])
        },
        key=lambda x: (
            pro.get(x[0], {}).get("last_name", ""),
            pro.get(x[0], {}).get("first_name", ""),
            mat.get(x[1], {}).get("title", ""),
        ),
    )

    r = 5
    for student_id, material_id in pairs:
        person = pro.get(student_id, {})
        material = mat.get(material_id, {})
        values = [
            student_id, person.get("username", ""), person.get("last_name", ""),
            person.get("first_name", ""), person.get("grade_level", ""),
            material_id, material.get("title", ""),
        ]
        for i, value in enumerate(values, start=1):
            ev.cell(row=r, column=i, value=value).border = THIN

        ev.cell(row=r, column=8, value=f"=COUNTIFS(Concepts!$B:$B,$F{r})")
        ev.cell(
            row=r, column=9,
            value=f"=COUNTIFS(MasteryNow!$A:$A,$A{r},MasteryNow!$C:$C,$F{r})",
        )
        ev.cell(
            row=r, column=10,
            value=f"=SUMIFS(MasteryNow!$H:$H,MasteryNow!$A:$A,$A{r},MasteryNow!$C:$C,$F{r})",
        )
        ev.cell(
            row=r, column=11,
            value=(
                f'=IF($I{r}=0,"",'
                f"AVERAGEIFS(MasteryNow!$J:$J,MasteryNow!$A:$A,$A{r},MasteryNow!$C:$C,$F{r}))"
            ),
        )
        ev.cell(
            row=r, column=12,
            value=(
                f'=IF($I{r}=0,"",'
                f"AVERAGEIFS(MasteryNow!$G:$G,MasteryNow!$A:$A,$A{r},MasteryNow!$C:$C,$F{r}))"
            ),
        )
        ev.cell(row=r, column=13, value=f'=IF($I{r}=0,"",ROUND($L{r},4)-ROUND($K{r},4))')
        ev.cell(
            row=r, column=14,
            value=f'=IF($I{r}=0,"",($L{r}*$I{r}+P_L0*($H{r}-$I{r}))/$H{r})',
        )
        ev.cell(
            row=r, column=15,
            value=(
                f'=IF($N{r}="","",IF($N{r}>=0.85,"advanced",'
                f'IF($N{r}>=0.5,"intermediate","foundational")))'
            ),
        )
        for col in range(8, 16):
            ev.cell(row=r, column=col).fill = CALC
            ev.cell(row=r, column=col).border = THIN
        for col in (11, 12, 13, 14):
            ev.cell(row=r, column=col).number_format = "0.0000"
        r += 1

    ev_last = r - 1
    ev.auto_filter.ref = f"A4:O{ev_last}"

    # -- README (built last: it summarises the sheets above) -------------------
    rd = wb.create_sheet("README", 0)
    rd["A1"] = "Mastery-evidence verification workbook"
    rd["A1"].font = Font(bold=True, size=18, color="1F3864")
    rd["A2"] = f"LearnSync AI  -  generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC}"
    rd["A2"].font = Font(italic=True, size=10)
    rd.column_dimensions["A"].width = 34
    rd.column_dimensions["B"].width = 88

    n_obs = max(obs_last - 4, 1)
    lines = [
        ("", ""),
        ("VERDICT", ""),
        ("EQ(1)/(2)/(3) exact",
         f'=COUNTIF(Observations!W5:W{obs_last},"EXACT")&" of {obs_last - 4} observations"'),
        ("EQ(1)/(2)/(3) within +/-0.01",
         f'=COUNTIF(Observations!V5:V{obs_last},"PASS")&" of {obs_last - 4} observations"'),
        ("Implementation Correctness Rate",
         f'=TEXT(COUNTIF(Observations!V5:V{obs_last},"PASS")/{n_obs},"0.00%")'),
        ("P(G) selection correct",
         f'=COUNTIF(Observations!K5:K{obs_last},"OK")&" of {obs_last - 4}"'),
        ("Chain integrity (last log = stored)",
         f'=COUNTIF(MasteryNow!L5:L{mn_last},"OK")&" of {mn_last - 4} concept rows"'),
        ("Concepts with no audit trail", f'=COUNTIF(MasteryNow!L5:L{mn_last},"no trail")'),
        ("", ""),
        ("HOW TO READ IT", ""),
        ("Green cells", "What the platform computed and stored in the database."),
        ("Yellow cells", "Recomputed here by a live Excel formula. Click one to see the arithmetic."),
        ("", "If a green and a yellow cell disagree, the platform is wrong. That is the whole point."),
        ("", ""),
        ("SHEETS", ""),
        ("Parameters",
         "P(L0), P(T), P(S) and the eight P(G) values, as named cells. Edit one and everything recomputes."),
        ("Observations",
         "Every BKT update ever recorded, with EQ(1)/(2) and EQ(3) recomputed beside the stored values."),
        ("MasteryNow",
         "Current bkt_mastery, with the chain check: newest logged posterior vs stored latent_mastery."),
        ("Concepts", "The concept catalogue. Supplies the EQ(4) denominator."),
        ("Evidence",
         "start_mastery / end_mastery / growth / m_doc rebuilt by formula. Compare to the app's CSV."),
        ("", ""),
        ("WHAT EACH CHECK CATCHES", ""),
        ("EQ columns", "Arithmetic errors in the evidence and transition phases."),
        ("P(G) check",
         "A wrong guess-rate mapping - e.g. a true/false question scored at the multiple-choice rate."),
        ("", "An equation-only check cannot see this, because both sides would use the same wrong number."),
        ("Chain ok",
         "A dropped or out-of-order audit row. logWriteError is non-fatal by design, so this can happen."),
        ("", ""),
        ("READ THIS BEFORE QUOTING m_doc", ""),
        ("", "m_doc counts every concept in the lesson, with untouched ones entering at P(L0) = 0.10."),
        ("", "A student at 0.60 on the 13 concepts they studied, out of 63 in the lesson, shows m_doc = 0.20."),
        ("", "It measures coverage as much as mastery. It also cannot show growth: m_doc at t=0 is exactly"),
        ("", "0.10 for every student, always. Use the growth column, which is paired over the same concepts."),
        ("", ""),
        ("start_mastery IS NOT A PRE-TEST", ""),
        ("", "It is the mastery AFTER the student's first opportunity on each concept, so that answer's"),
        ("", "outcome is already inside it. Never label it 'baseline', 'pre-test' or 'before studying'."),
        ("", "A concept assessed exactly once has start = end and growth = 0. Correct, not a bug."),
    ]
    for i, (label, body) in enumerate(lines, start=4):
        left = rd.cell(row=i, column=1, value=label)
        right = rd.cell(row=i, column=2, value=body)
        if label in SECTIONS:
            left.font = Font(bold=True, size=11, color="1F3864")
            left.fill = SUB
            right.fill = SUB
        else:
            left.font = Font(bold=True, size=10)
        right.alignment = Alignment(wrap_text=True, vertical="top")

    wb.save(args.out)
    print(f"\nWrote {args.out}")
    print(
        f"  Observations {obs_last - 4} rows   MasteryNow {mn_last - 4}   "
        f"Evidence {ev_last - 4}   Concepts {len(concepts)}"
    )
    print("  Open it and read the README sheet first.")


if __name__ == "__main__":
    main()
