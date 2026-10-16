"""조달청 나라장터 OpenAPI(공공데이터포털) 최소 클라이언트.

표준 라이브러리만 사용한다. 세 가지 '나라장터 검색조건(PPSSrch)' 용역 오퍼레이션을 감싼다.

- 입찰공고  : 나라장터 입찰공고정보서비스  getBidPblancListInfoServcPPSSrch
- 낙찰정보  : 나라장터 낙찰정보서비스      getScsbidListSttusServcPPSSrch
- 사전규격  : 나라장터 사전규격정보서비스  getPublicPrcureThngInfoServcPPSSrch

서비스키는 환경변수 NARA_SERVICE_KEY 또는 nara/.env 파일에서 읽는다.
공공데이터포털의 Encoding 키·Decoding 키 어느 쪽을 넣어도 된다.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
HERE = Path(__file__).resolve().parent

BASE = "https://apis.data.go.kr/1230000"
OPS = {
    "bid": f"{BASE}/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch",
    "award": f"{BASE}/as/ScsbidInfoService/getScsbidListSttusServcPPSSrch",
    "prespec": f"{BASE}/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServcPPSSrch",
}
# 사전규격 검색은 사업명 파라미터 이름이 다르다.
NAME_PARAM = {"bid": "bidNtceNm", "award": "bidNtceNm", "prespec": "prdctClsfcNoNm"}

# 조회기간이 길면 '입력범위값 초과'가 날 수 있어 30일 단위로 나눠 호출한다.
WINDOW_DAYS = 30
PAGE_SIZE = 100

ERRORS = {
    "10": "잘못된 요청 파라미터",
    "11": "필수 요청 파라미터 누락",
    "12": "해당 오픈API 서비스가 없거나 폐기됨",
    "20": "서비스 접근 거부 — 공공데이터포털에서 이 API의 활용신청 승인 여부를 확인하세요",
    "22": "일일 요청 한도 초과",
    "30": "등록되지 않은 서비스키 — 키 값을 확인하세요(승인 직후면 1~2시간 뒤 다시 시도)",
    "31": "기한이 만료된 서비스키",
    "32": "등록되지 않은 IP",
}
NO_DATA = {"03", "3"}


class G2BError(RuntimeError):
    pass


def load_service_key() -> str:
    key = os.environ.get("NARA_SERVICE_KEY", "").strip()
    env_file = HERE / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "NARA_SERVICE_KEY":
                key = value.strip().strip('"').strip("'")
    if not key:
        raise G2BError(
            "서비스키가 없습니다. NARA_SERVICE_KEY 환경변수나 nara/.env 파일에 "
            "공공데이터포털 인증키를 넣어주세요 (nara/README.md 참고)."
        )
    # Encoding 키가 들어오면 한 번 풀어서, urlencode가 다시 정확히 한 번 인코딩하게 한다.
    return urllib.parse.unquote(key) if "%" in key else key


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y%m%d%H%M")


def date_windows(days: int, end: datetime | None = None) -> list[tuple[str, str]]:
    """최근 days일을 WINDOW_DAYS 단위 (시작, 종료) 'YYYYMMDDHHMM' 쌍으로 나눈다. 최신 구간이 먼저."""
    end = end or datetime.now(KST)
    start = end - timedelta(days=days)
    out = []
    cur_end = end
    while cur_end > start:
        cur_start = max(start, cur_end - timedelta(days=WINDOW_DAYS))
        out.append((_fmt(cur_start), _fmt(cur_end)))
        cur_end = cur_start - timedelta(minutes=1)
    return out


def parse_response(raw: bytes) -> tuple[list[dict], int]:
    """응답 본문을 (items, totalCount)로 정규화한다. 오류 코드면 G2BError."""
    text = raw.decode("utf-8", errors="replace").strip()
    if text.startswith("<"):
        # 인증 실패 등은 type=json을 줘도 XML(OpenAPI_ServiceResponse)로 온다.
        try:
            root = ET.fromstring(text)
        except ET.ParseError as e:
            raise G2BError(f"응답 해석 실패(XML/HTML): {text[:200]}") from e
        code = (root.findtext(".//resultCode") or root.findtext(".//returnReasonCode") or "").strip()
        msg = (root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or "").strip()
        if code in NO_DATA:
            return [], 0
        if code and code not in ("00", "0"):
            raise G2BError(f"[{code}] {ERRORS.get(code, msg)} ({msg})")
        items = [{c.tag: (c.text or "") for c in it} for it in root.iter("item")]
        total = int(root.findtext(".//totalCount") or len(items))
        return items, total

    data = json.loads(text)
    resp = data.get("response", data)
    header = resp.get("header", {})
    code = str(header.get("resultCode", "00"))
    if code in NO_DATA:
        return [], 0
    if code not in ("00", "0"):
        msg = header.get("resultMsg", "")
        raise G2BError(f"[{code}] {ERRORS.get(code, msg)} ({msg})")
    body = resp.get("body", {}) or {}
    items = body.get("items") or []
    if isinstance(items, dict):  # {"item": [...]} 또는 {"item": {...}} 형태
        items = items.get("item", [])
    if isinstance(items, dict):
        items = [items]
    return items, int(body.get("totalCount") or 0)


def _get(url: str, params: dict, retries: int = 3) -> bytes:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(full, timeout=30) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(2 ** attempt)
    raise G2BError(f"네트워크 오류: {last}")


def fetch(kind: str, keyword: str | None = None, days: int = 7, extra: dict | None = None,
          max_pages: int = 20, getter=_get) -> list[dict]:
    """kind('bid'|'award'|'prespec')를 최근 days일 범위로 전 페이지 수집한다."""
    if kind not in OPS:
        raise ValueError(f"kind는 {list(OPS)} 중 하나여야 합니다: {kind}")
    key = load_service_key()
    rows: list[dict] = []
    for bgn, end in date_windows(days):
        page = 1
        while page <= max_pages:
            params = {
                "ServiceKey": key, "type": "json", "inqryDiv": "1",
                "inqryBgnDt": bgn, "inqryEndDt": end,
                "numOfRows": PAGE_SIZE, "pageNo": page,
            }
            if keyword:
                params[NAME_PARAM[kind]] = keyword
            params.update(extra or {})
            items, total = parse_response(getter(OPS[kind], params))
            rows.extend(items)
            if page * PAGE_SIZE >= total or not items:
                break
            page += 1
    return rows
