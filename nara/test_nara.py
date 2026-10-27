"""오프라인 테스트: python3 -m unittest nara/test_nara.py"""

import json
import os
import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import g2b  # noqa: E402
import monitor  # noqa: E402


def page(items, total, code="00"):
    return json.dumps({"response": {"header": {"resultCode": code, "resultMsg": "정상"},
                                    "body": {"items": items, "totalCount": total}}}).encode()


class ParseTest(unittest.TestCase):
    def test_json_list_and_item_wrapper(self):
        self.assertEqual(g2b.parse_response(page([{"a": 1}], 1)), ([{"a": 1}], 1))
        self.assertEqual(g2b.parse_response(page({"item": {"a": 1}}, 1)), ([{"a": 1}], 1))
        self.assertEqual(g2b.parse_response(page("", 0)), ([], 0))

    def test_no_data_code(self):
        self.assertEqual(g2b.parse_response(page([], 0, code="03")), ([], 0))

    def test_xml_auth_error(self):
        xml = (b"<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR"
               b"</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>")
        with self.assertRaisesRegex(g2b.G2BError, r"\[30\]"):
            g2b.parse_response(xml)

    def test_json_access_denied(self):
        with self.assertRaisesRegex(g2b.G2BError, "활용신청"):
            g2b.parse_response(page([], 0, code="20"))


class FetchTest(unittest.TestCase):
    def setUp(self):
        os.environ["NARA_SERVICE_KEY"] = "abc%2Bdef%3D%3D"

    def test_windows_cover_range(self):
        w = g2b.date_windows(65, end=datetime(2026, 10, 15, 12, 0, tzinfo=g2b.KST))
        self.assertEqual(len(w), 3)
        self.assertEqual(w[0][1], "202610151200")
        self.assertEqual(w[-1][0], "202608111200")

    def test_paging_and_key_decoding(self):
        calls = []

        def getter(url, params):
            calls.append(params)
            n = params["pageNo"]
            return page([{"i": n}] * (100 if n == 1 else 5), 105)

        rows = g2b.fetch("bid", keyword="숙의", days=7, getter=getter)
        self.assertEqual(len(rows), 105)
        self.assertEqual([c["pageNo"] for c in calls], [1, 2])
        self.assertEqual(calls[0]["ServiceKey"], "abc+def==")  # urlencode가 한 번만 인코딩
        self.assertEqual(calls[0]["bidNtceNm"], "숙의")

    def test_prespec_uses_item_name_param(self):
        seen = {}
        g2b.fetch("prespec", keyword="리빙랩", days=3,
                  getter=lambda u, p: seen.update(p) or page([], 0))
        self.assertEqual(seen["prdctClsfcNoNm"], "리빙랩")


BIDS = {
    "숙의": [
        {"bidNtceNo": "R26BK1", "bidNtceOrd": "000", "bidNtceNm": "시민 숙의 원탁토론 운영 용역", "bidNtceDt": "2026-10-10 10:00:00"},
        {"bidNtceNo": "R26BK1", "bidNtceOrd": "001", "bidNtceNm": "시민 숙의 원탁토론 운영 용역(정정)", "bidNtceDt": "2026-10-11 10:00:00"},
        {"bidNtceNo": "R26BK2", "bidNtceOrd": "000", "bidNtceNm": "숙의 무관 노이즈 청소용역", "bidNtceDt": "2026-10-12 10:00:00"},
    ],
    "원탁토론": [
        {"bidNtceNo": "R26BK1", "bidNtceOrd": "001", "bidNtceNm": "시민 숙의 원탁토론 운영 용역(정정)", "bidNtceDt": "2026-10-11 10:00:00"},
        {"bidNtceNo": "R26BK3", "bidNtceOrd": "000", "bidNtceNm": "재활용 홍보", "bidNtceDt": "2026-10-12 10:00:00"},
    ],
}
AWARDS = [
    {"bidNtceNo": "A1", "bidClsfcNo": "1", "bidNtceNm": "리빙랩 운영", "bidwinnrNm": "가나협동조합",
     "sucsfbidAmt": "50000000", "sucsfbidRate": "88.0", "prtcptCnum": "4", "dminsttNm": "서울시"},
    {"bidNtceNo": "A2", "bidClsfcNo": "1", "bidNtceNm": "리빙랩 2차", "bidwinnrNm": "가나협동조합",
     "sucsfbidAmt": "30000000", "sucsfbidRate": "90.0", "prtcptCnum": "2", "dminsttNm": "부산시"},
    {"bidNtceNo": "A3", "bidClsfcNo": "1", "bidNtceNm": "리빙랩 3차", "bidwinnrNm": "다라",
     "sucsfbidAmt": "120000000", "sucsfbidRate": "87.5", "prtcptCnum": "6", "dminsttNm": "세종시"},
    {"bidNtceNo": "A4", "bidClsfcNo": "1", "bidNtceNm": "리빙랩 유찰", "bidwinnrNm": ""},
]


def fake_fetch(kind, keyword=None, days=7):
    if kind == "bid":
        return BIDS.get(keyword, [])
    if kind == "award":
        return AWARDS if keyword == "리빙랩" else []
    return []


class MonitorTest(unittest.TestCase):
    def test_bids_merge_dedupe_filter(self):
        rows = monitor.search_bids(["숙의", "원탁토론"], 7, exclude=["청소"], fetch=fake_fetch)
        self.assertEqual([r["bidNtceNo"] for r in rows], ["R26BK1"])  # 노이즈·제외어 제거
        self.assertEqual(rows[0]["bidNtceOrd"], "001")                  # 정정 차수 반영
        self.assertEqual(rows[0]["_keywords"], ["숙의", "원탁토론"])

    def test_competitor_summary(self):
        rows = monitor.search_awards(["리빙랩"], 365, fetch=fake_fetch)
        self.assertEqual(len(rows), 3)  # 낙찰자 없는 건 제외
        s = monitor.competitor_summary(rows)
        self.assertEqual(s[0]["업체명"], "가나협동조합")
        self.assertEqual(s[0]["건수"], 2)
        self.assertAlmostEqual(s[0]["평균낙찰률"], 89.0)
        self.assertEqual(s[0]["총액"], 80000000)
        md = monitor.awards_tables(rows, competitors=["다라"])
        self.assertIn("다라 ⭐", md)
        self.assertIn("1.20억", md)

    def test_report_open_bids_and_new_marks(self):
        from datetime import timedelta
        now = datetime.now(g2b.KST)
        f = lambda d: (now + timedelta(days=d)).strftime("%Y-%m-%d %H:%M:%S")
        bids = [
            {"bidNtceNo": "NEW", "bidNtceOrd": "000", "bidNtceNm": "시민참여 토론회 운영", "bidNtceDt": f(-1), "bidClseDt": f(5)},
            {"bidNtceNo": "OLD", "bidNtceOrd": "000", "bidNtceNm": "시민참여 숙의 워크숍", "bidNtceDt": f(-10), "bidClseDt": f(2)},
            {"bidNtceNo": "CLOSED", "bidNtceOrd": "000", "bidNtceNm": "시민참여 공론화", "bidNtceDt": f(-20), "bidClseDt": f(-1)},
        ]
        calls = []

        def fetch(kind, keyword=None, days=7):
            calls.append((kind, keyword))
            if kind == "bid" and keyword == "시민참여":
                return bids
            return AWARDS if kind == "award" and keyword == "리빙랩" else []

        cfg = {"keywords": ["리빙랩"], "watch_keywords": ["시민참여"], "exclude": []}
        with mock.patch.object(monitor, "load_seen", return_value={"bid": [], "prespec": []}):
            md, _ = monitor.build_report(cfg, fetch=fetch)
        self.assertNotIn("시민참여 공론화", md)                              # 마감 지난 공고 제외
        self.assertLess(md.index("숙의 워크숍"), md.index("토론회 운영"))  # 마감 임박순
        self.assertEqual(md.count("🆕"), 1)                                # 최근 4일 공고만 신규
        self.assertIn("가나협동조합", md)
        self.assertNotIn(("award", "시민참여"), calls)                      # 낙찰은 핵심 키워드만

if __name__ == "__main__":
    unittest.main()
