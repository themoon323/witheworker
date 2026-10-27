"""나라장터 키워드 모니터링·낙찰 분석.

사용 예:
    python3 nara/monitor.py report                 # 공고+사전규격+낙찰 분석 보고서(마크다운) 생성
    python3 nara/monitor.py bids --days 14          # 최근 14일 입찰공고만 화면 출력
    python3 nara/monitor.py awards -k 리빙랩 --days 730
    python3 nara/monitor.py prespecs
    python3 nara/monitor.py bids --csv out.csv      # CSV로 저장

키워드·제외어·관심 경쟁사는 nara/config.json에서 바꾼다.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import g2b  # noqa: E402

HERE = Path(__file__).resolve().parent
STATE = HERE / "state" / "seen.json"
REPORTS = HERE / "reports"


def load_config() -> dict:
    return json.loads((HERE / "config.json").read_text(encoding="utf-8"))


def _num(v) -> float | None:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _won(v) -> str:
    n = _num(v)
    if n is None:
        return "-"
    if n >= 1e8:
        return f"{n / 1e8:,.2f}억"
    if n >= 1e4:
        return f"{n / 1e4:,.0f}만"
    return f"{n:,.0f}"


def _excluded(name: str, exclude: list[str]) -> bool:
    return any(x and x in name for x in exclude)


def _collect(kind: str, keywords: list[str], days: int, exclude: list[str], name_field: str,
             key_fn, fetch=g2b.fetch) -> list[dict]:
    """키워드별로 조회해 합치고, 같은 건은 하나로 묶어 매칭 키워드를 기록한다."""
    # 키워드별 조회는 서로 독립이라 병렬로 부르고, 합치는 건 키워드 순서대로 한다.
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda kw: fetch(kind, keyword=kw, days=days), keywords))
    merged: dict = {}
    for kw, found in zip(keywords, results):
        for row in found:
            name = row.get(name_field, "") or ""
            # 서버 검색은 부분일치라 노이즈가 있어 클라이언트에서 한 번 더 확인한다.
            if kw not in name.replace(" ", "") and kw not in name:
                continue
            if _excluded(name, exclude):
                continue
            k = key_fn(row)
            if k not in merged:
                merged[k] = dict(row, _keywords=[kw])
            else:
                if kw not in merged[k]["_keywords"]:
                    merged[k]["_keywords"].append(kw)
                # 같은 공고의 더 높은 차수(정정공고)가 오면 그것으로 갱신한다.
                if str(row.get("bidNtceOrd", "")) > str(merged[k].get("bidNtceOrd", "")):
                    merged[k] = dict(row, _keywords=merged[k]["_keywords"])
    return list(merged.values())


def search_bids(keywords, days, exclude=(), fetch=g2b.fetch) -> list[dict]:
    rows = _collect("bid", keywords, days, list(exclude), "bidNtceNm",
                    lambda r: r.get("bidNtceNo"), fetch)
    return sorted(rows, key=lambda r: r.get("bidNtceDt", ""), reverse=True)


def search_prespecs(keywords, days, exclude=(), fetch=g2b.fetch) -> list[dict]:
    rows = _collect("prespec", keywords, days, list(exclude), "prdctClsfcNoNm",
                    lambda r: r.get("bfSpecRgstNo"), fetch)
    return sorted(rows, key=lambda r: r.get("rcptDt", "") or r.get("rgstDt", ""), reverse=True)


def search_awards(keywords, days, exclude=(), fetch=g2b.fetch) -> list[dict]:
    rows = _collect("award", keywords, days, list(exclude), "bidNtceNm",
                    lambda r: (r.get("bidNtceNo"), r.get("bidClsfcNo")), fetch)
    rows = [r for r in rows if (r.get("bidwinnrNm") or "").strip()]
    return sorted(rows, key=lambda r: r.get("rlOpengDt", "") or r.get("fnlSucsfDate", ""), reverse=True)


def competitor_summary(awards: list[dict]) -> list[dict]:
    """낙찰업체별 수주 건수·총액·평균 낙찰률·평균 참가업체수."""
    g: dict = defaultdict(lambda: {"건수": 0, "총액": 0.0, "낙찰률": [], "참가업체수": [], "기관": set(), "사업": []})
    for r in awards:
        s = g[(r.get("bidwinnrNm") or "").strip()]
        s["사업자번호"] = r.get("bidwinnrBizno", "")
        s["건수"] += 1
        s["총액"] += _num(r.get("sucsfbidAmt")) or 0
        if (rate := _num(r.get("sucsfbidRate"))) is not None:
            s["낙찰률"].append(rate)
        if (n := _num(r.get("prtcptCnum"))) is not None:
            s["참가업체수"].append(n)
        if r.get("dminsttNm"):
            s["기관"].add(r["dminsttNm"])
        s["사업"].append(r.get("bidNtceNm", ""))
    out = []
    for name, s in g.items():
        out.append({
            "업체명": name, "사업자번호": s["사업자번호"], "건수": s["건수"], "총액": s["총액"],
            "평균낙찰률": sum(s["낙찰률"]) / len(s["낙찰률"]) if s["낙찰률"] else None,
            "평균참가업체수": sum(s["참가업체수"]) / len(s["참가업체수"]) if s["참가업체수"] else None,
            "기관": sorted(s["기관"]), "사업": s["사업"],
        })
    return sorted(out, key=lambda x: (-x["건수"], -x["총액"]))


# ---------- 신규 표시용 상태 ----------

def load_seen() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"bid": [], "prespec": []}


def save_seen(seen: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(seen, ensure_ascii=False, indent=0), encoding="utf-8")


# ---------- 출력 ----------

def _cell(s) -> str:
    return str(s or "").replace("|", "／").replace("\n", " ").strip()


def bids_table(rows: list[dict], new: set | None = None) -> str:
    lines = ["| | 공고일 | 공고명 | 수요기관 | 추정가격 | 마감 | 계약방법 | 키워드 |",
             "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        mark = "🆕" if new and r.get("bidNtceNo") in new else ""
        title = _cell(r.get("bidNtceNm"))
        if r.get("bidNtceDtlUrl"):
            title = f"[{title}]({r['bidNtceDtlUrl']})"
        lines.append(f"| {mark} | {_cell(r.get('bidNtceDt'))[:10]} | {title} | "
                     f"{_cell(r.get('dminsttNm') or r.get('ntceInsttNm'))} | {_won(r.get('presmptPrce') or r.get('asignBdgtAmt'))} | "
                     f"{_cell(r.get('bidClseDt'))[:16]} | {_cell(r.get('cntrctCnclsMthdNm'))} | {', '.join(r['_keywords'])} |")
    return "\n".join(lines)


def prespecs_table(rows: list[dict], new: set | None = None) -> str:
    lines = ["| | 접수일 | 사업명 | 수요기관 | 배정예산 | 의견마감 | 키워드 |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        mark = "🆕" if new and r.get("bfSpecRgstNo") in new else ""
        lines.append(f"| {mark} | {_cell(r.get('rcptDt'))[:10]} | {_cell(r.get('prdctClsfcNoNm'))} | "
                     f"{_cell(r.get('rlDminsttNm') or r.get('orderInsttNm'))} | {_won(r.get('asignBdgtAmt'))} | "
                     f"{_cell(r.get('opninRgstClseDt'))[:16]} | {', '.join(r['_keywords'])} |")
    return "\n".join(lines)


def awards_tables(rows: list[dict], competitors: list[str] = ()) -> str:
    summary = competitor_summary(rows)
    out = ["### 낙찰업체 순위", "",
           "| 순위 | 업체명 | 수주 | 총 낙찰액 | 평균 낙찰률 | 평균 참가업체 | 주요 발주기관 |",
           "|---|---|---|---|---|---|---|"]
    for i, s in enumerate(summary, 1):
        star = " ⭐" if any(c and c in s["업체명"] for c in competitors) else ""
        rate = f"{s['평균낙찰률']:.2f}%" if s["평균낙찰률"] is not None else "-"
        cnum = f"{s['평균참가업체수']:.1f}" if s["평균참가업체수"] is not None else "-"
        out.append(f"| {i} | {_cell(s['업체명'])}{star} | {s['건수']} | {_won(s['총액'])} | {rate} | {cnum} | "
                   f"{_cell(', '.join(s['기관'][:3]))} |")
    out += ["", "### 낙찰 내역", "",
            "| 개찰일 | 공고명 | 수요기관 | 낙찰업체 | 낙찰금액 | 낙찰률 | 참가 |",
            "|---|---|---|---|---|---|---|"]
    for r in rows:
        rate = _num(r.get("sucsfbidRate"))
        out.append(f"| {_cell(r.get('rlOpengDt'))[:10]} | {_cell(r.get('bidNtceNm'))} | {_cell(r.get('dminsttNm'))} | "
                   f"{_cell(r.get('bidwinnrNm'))} | {_won(r.get('sucsfbidAmt'))} | "
                   f"{f'{rate:.2f}%' if rate is not None else '-'} | {_cell(r.get('prtcptCnum'))} |")
    return "\n".join(out)


def write_csv(rows: list[dict], path: str) -> None:
    fields = sorted({k for r in rows for k in r})
    with open(path, "w", newline="", encoding="utf-8-sig") as f:  # 엑셀에서 한글 안 깨지게 BOM
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: (", ".join(v) if isinstance(v, list) else v) for k, v in r.items()})


def build_report(cfg: dict, fetch=g2b.fetch) -> tuple[str, dict]:
    """공고·사전규격은 keywords+watch_keywords로, 낙찰 분석은 핵심 keywords로만 조회한다.
    입찰공고는 아직 마감 전인 것만 마감 임박순으로 보여주고, 최근 new_days일 안에
    올라온 건에 🆕를 붙인다(클라우드 예약 실행은 매번 새 환경이라 날짜 기준으로 판단)."""
    kws, exc = cfg["keywords"], cfg.get("exclude", [])
    watch = kws + [k for k in cfg.get("watch_keywords", []) if k not in kws]
    now_dt = datetime.now(g2b.KST)
    now = now_dt.strftime("%Y-%m-%d %H:%M")
    since = (now_dt - timedelta(days=cfg.get("new_days", 4))).strftime("%Y-%m-%d %H:%M")

    bids = search_bids(watch, cfg.get("bid_days", 30), exc, fetch)
    bids = sorted((b for b in bids if (b.get("bidClseDt") or "") >= now), key=lambda b: b.get("bidClseDt", ""))
    pres = search_prespecs(watch, cfg.get("prespec_days", 14), exc, fetch)
    awards = search_awards(kws, cfg.get("award_days", 365), exc, fetch)
    new_bids = {b.get("bidNtceNo") for b in bids if (b.get("bidNtceDt") or "") >= since}
    new_pres = {p.get("bfSpecRgstNo") for p in pres if (p.get("rcptDt") or p.get("rgstDt") or "") >= since}

    md = [f"# 나라장터 모니터링 보고서 ({now} KST)", "",
          f"공고·사전규격 키워드: {', '.join(watch)}  ", f"낙찰 분석 키워드: {', '.join(kws)}", "",
          f"- 마감 전 입찰공고: **{len(bids)}건** (최근 {cfg.get('new_days', 4)}일 신규 {len(new_bids)})",
          f"- 사전규격(최근 {cfg.get('prespec_days', 14)}일): **{len(pres)}건** (신규 {len(new_pres)})",
          f"- 낙찰(최근 {cfg.get('award_days', 365)}일): **{len(awards)}건**", "",
          "## 1. 입찰공고 (마감 전, 마감 임박순)", "", bids_table(bids, new_bids) if bids else "_마감 전 공고 없음_", "",
          "## 2. 사전규격 (본공고 전 단계)", "", prespecs_table(pres, new_pres) if pres else "_해당 기간 사전규격 없음_", "",
          "## 3. 낙찰 분석", "", awards_tables(awards, cfg.get("competitors", [])) if awards else "_해당 기간 낙찰 없음_", ""]
    seen = load_seen()
    seen["bid"] = sorted(set(seen.get("bid", [])) | {b.get("bidNtceNo") for b in bids if b.get("bidNtceNo")})
    seen["prespec"] = sorted(set(seen.get("prespec", [])) | {p.get("bfSpecRgstNo") for p in pres if p.get("bfSpecRgstNo")})
    return "\n".join(md), seen


def main(argv=None) -> int:
    cfg = load_config()
    p = argparse.ArgumentParser(description="나라장터 키워드 모니터링")
    p.add_argument("command", choices=["report", "bids", "prespecs", "awards"])
    p.add_argument("-k", "--keyword", action="append", help="config.json 대신 쓸 키워드(여러 번 가능)")
    p.add_argument("--days", type=int, help="조회 기간(일)")
    p.add_argument("--csv", help="결과를 CSV로 저장할 경로")
    a = p.parse_args(argv)
    if a.keyword:
        cfg["keywords"] = a.keyword

    try:
        if a.command == "report":
            if a.days:
                cfg["bid_days"] = a.days
            md, seen = build_report(cfg)
            REPORTS.mkdir(exist_ok=True)
            path = REPORTS / f"report_{datetime.now(g2b.KST):%Y%m%d_%H%M}.md"
            path.write_text(md, encoding="utf-8")
            save_seen(seen)
            print(md)
            print(f"\n저장: {path}", file=sys.stderr)
            return 0

        kind = {"bids": "bid", "prespecs": "prespec", "awards": "award"}[a.command]
        days = a.days or cfg.get(f"{kind}_days", 7)
        fn = {"bid": search_bids, "prespec": search_prespecs, "award": search_awards}[kind]
        rows = fn(cfg["keywords"], days, cfg.get("exclude", []))
        table = {"bid": bids_table, "prespec": prespecs_table}.get(kind)
        print(table(rows) if table else awards_tables(rows, cfg.get("competitors", [])))
        print(f"\n{len(rows)}건", file=sys.stderr)
        if a.csv:
            write_csv(rows, a.csv)
            print(f"CSV 저장: {a.csv}", file=sys.stderr)
        return 0
    except g2b.G2BError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
