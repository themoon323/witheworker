# 나라장터 입찰 모니터링

"숙의", "원탁토론", "리빙랩", "퍼실리테이션" 같은 키워드로 나라장터 **용역** 공고를 정기적으로 훑고,
**낙찰정보**로 경쟁사 수주 이력과 낙찰률을 분석하는 도구입니다.

조달청 공식 OpenAPI(공공데이터포털)를 직접 호출하며, 두 가지 방식으로 쓸 수 있습니다.

| 방식 | 용도 |
|---|---|
| `monitor.py` (명령줄) | 주간 보고서(마크다운) 생성, CSV 추출. 새로 올라온 공고에 🆕 표시 |
| `mcp_server.py` (MCP 서버) | Claude 앱에서 "이번 주 숙의 관련 공고 찾아줘"처럼 대화로 조회 |

## 1. 서비스키 발급 (최초 1회)

1. [공공데이터포털](https://www.data.go.kr) 회원가입·로그인
2. 아래 **3개 API**를 각각 검색해 **활용신청** (개발계정은 보통 자동승인, 반영까지 1~2시간)
   - `조달청_나라장터 입찰공고정보서비스` — 입찰공고
   - `조달청_나라장터 낙찰정보서비스` — 낙찰업체·낙찰금액·낙찰률
   - `조달청_나라장터 사전규격정보서비스` — 본공고 전 사전규격 (선택이지만 추천)
3. 마이페이지 → 개발계정 → 인증키 복사 (Encoding/Decoding 어느 쪽이든 됩니다)
4. 키 저장 — 둘 중 하나:
   - `nara/.env` 파일에 `NARA_SERVICE_KEY=복사한키` 한 줄 (이 파일은 git에 올라가지 않습니다)
   - 또는 환경변수 `NARA_SERVICE_KEY`

> 개발계정 트래픽은 API별로 하루 1,000건 안팎입니다. 키워드 9개 × 낙찰 1년치(30일 단위 13구간)면
> 보고서 1회에 낙찰 API를 약 120회 부릅니다. 하루 여러 번 돌릴 거면 키워드나 `award_days`를 줄이세요.

## 2. 설정 — `config.json`

(아래 `//` 주석은 설명용입니다. 실제 파일에는 넣지 마세요.)

```json
{
  "keywords": ["숙의", "공론화", "원탁토론", "원탁회의", "리빙랩", "퍼실리테이션", ...],
  "exclude": [],          // 공고명에 이 단어가 있으면 제외 (예: "청소", "폐기물")
  "competitors": [],      // 낙찰 분석에서 ⭐로 강조할 업체명 일부
  "bid_days": 7,          // 입찰공고 조회 기간(일)
  "prespec_days": 14,     // 사전규격 조회 기간(일)
  "award_days": 365       // 낙찰 분석 기간(일)
}
```

공고명 검색은 조달청 서버에서 부분일치라 엉뚱한 공고가 섞일 수 있어, 공고명에 키워드가 실제로 들어간 건만 남깁니다.

## 3. 명령줄로 쓰기

```bash
python3 nara/monitor.py report                     # 공고+사전규격+낙찰 보고서 → nara/reports/
python3 nara/monitor.py bids --days 14             # 최근 14일 공고만
python3 nara/monitor.py awards -k 리빙랩 --days 730  # 리빙랩 2년치 낙찰 분석
python3 nara/monitor.py prespecs
python3 nara/monitor.py awards --csv 낙찰.csv       # 엑셀용 CSV (한글 안 깨짐)
```

보고서 구성: ① 입찰공고(공고일·수요기관·추정가격·마감, 공고 링크) ② 사전규격(의견마감일)
③ 낙찰 분석(업체별 수주 건수·총액·평균 낙찰률·평균 참가업체 수 순위 + 건별 내역).
`report`는 이미 본 공고를 `nara/state/seen.json`에 기록해 다음 실행부터 새 공고에만 🆕를 붙입니다.

## 4. Claude 앱에 MCP로 연결하기

```bash
pip install mcp
```

**Claude Desktop** — 설정 → 개발자 → 구성 편집(`claude_desktop_config.json`)에 추가 후 앱 재시작:

```json
{
  "mcpServers": {
    "naramarket": {
      "command": "python",
      "args": ["C:\\Users\\내이름\\witheworker\\nara\\mcp_server.py"],
      "env": { "NARA_SERVICE_KEY": "발급받은키" }
    }
  }
}
```
(macOS는 `"command": "python3"`, 경로는 `/Users/내이름/witheworker/nara/mcp_server.py` 형태)

**Claude Code** — 이 저장소 루트의 `.mcp.json`에 이미 등록되어 있습니다. 키만 `nara/.env`에 넣으면 됩니다.

연결되면 쓸 수 있는 도구:

| 도구 | 하는 일 |
|---|---|
| `search_bids` | 키워드로 용역 입찰공고 검색 (기본: config 키워드, 최근 7일) |
| `search_prespecs` | 사전규격 검색 (최근 14일) |
| `analyze_awards` | 낙찰업체별 수주·낙찰률 분석 (최근 365일) |
| `company_awards` | 특정 업체의 관련 용역 낙찰 이력 |

예: "이번 주 올라온 숙의·원탁토론 용역 공고 정리해줘", "리빙랩 용역 최근 2년 낙찰업체 순위와 평균 낙찰률 보여줘",
"○○협동조합이 따간 공고 목록 보여줘"

## 5. 테스트

```bash
python3 -m unittest nara/test_nara.py   # 네트워크·키 없이 동작 확인
```

## 오류 메시지

| 코드 | 뜻 | 조치 |
|---|---|---|
| 20 | 서비스 접근 거부 | 해당 API 활용신청 승인 여부 확인 |
| 22 | 일일 한도 초과 | 다음 날 재시도, 키워드·기간 축소 |
| 30 | 등록되지 않은 키 | 키 확인. 승인 직후면 1~2시간 대기 |
| 네트워크 오류 | `apis.data.go.kr` 접속 불가 | 사내망·클라우드 환경의 방화벽/허용 도메인 확인 |

API 명세: 입찰공고 `getBidPblancListInfoServcPPSSrch`, 낙찰 `getScsbidListSttusServcPPSSrch`,
사전규격 `getPublicPrcureThngInfoServcPPSSrch` (모두 용역, 나라장터 검색조건 오퍼레이션).
