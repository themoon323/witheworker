"""나라장터 MCP 서버 (stdio).

Claude Desktop / Claude Code에서 "이번 주 숙의 관련 용역 공고 찾아줘",
"리빙랩 용역 최근 1년 낙찰업체 분석해줘" 같은 요청을 처리할 수 있게 도구를 노출한다.

필요 패키지: pip install mcp
실행: python3 nara/mcp_server.py   (보통은 Claude 앱이 직접 실행한다. nara/README.md 참고)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import g2b  # noqa: E402
import monitor  # noqa: E402

try:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer as Server
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as Server

server = Server("naramarket")


def _keywords(keywords: list[str] | None) -> list[str]:
    return keywords or monitor.load_config()["keywords"]


def _exclude() -> list[str]:
    return monitor.load_config().get("exclude", [])


@server.tool()
def search_bids(keywords: list[str] | None = None, days: int = 7) -> str:
    """나라장터 용역 입찰공고를 공고명 키워드로 검색한다.

    keywords를 비우면 config.json의 기본 키워드(숙의, 공론화, 원탁토론, 리빙랩, 퍼실리테이션 등)를 쓴다.
    days는 공고게시일 기준 조회 기간(일).
    """
    try:
        rows = monitor.search_bids(_keywords(keywords), days, _exclude())
    except g2b.G2BError as e:
        return f"오류: {e}"
    return f"{len(rows)}건\n\n" + (monitor.bids_table(rows) if rows else "")


@server.tool()
def search_prespecs(keywords: list[str] | None = None, days: int = 14) -> str:
    """나라장터 용역 사전규격(본공고 전에 공개되는 규격)을 사업명 키워드로 검색한다."""
    try:
        rows = monitor.search_prespecs(_keywords(keywords), days, _exclude())
    except g2b.G2BError as e:
        return f"오류: {e}"
    return f"{len(rows)}건\n\n" + (monitor.prespecs_table(rows) if rows else "")


@server.tool()
def analyze_awards(keywords: list[str] | None = None, days: int = 365) -> str:
    """키워드 관련 용역의 낙찰 결과를 모아 낙찰업체별 수주 건수·총액·평균 낙찰률을 분석한다.

    경쟁사 수주 이력과 낙찰가 수준을 파악할 때 쓴다. days는 공고게시일 기준 조회 기간(일).
    """
    try:
        rows = monitor.search_awards(_keywords(keywords), days, _exclude())
    except g2b.G2BError as e:
        return f"오류: {e}"
    if not rows:
        return "해당 기간 낙찰 결과 없음"
    return f"{len(rows)}건\n\n" + monitor.awards_tables(rows, monitor.load_config().get("competitors", []))


@server.tool()
def company_awards(company: str, days: int = 730) -> str:
    """특정 업체(업체명 일부)의 키워드 관련 용역 낙찰 이력을 보여준다."""
    try:
        rows = monitor.search_awards(_keywords(None), days, _exclude())
    except g2b.G2BError as e:
        return f"오류: {e}"
    rows = [r for r in rows if company in (r.get("bidwinnrNm") or "")]
    if not rows:
        return f"'{company}' 낙찰 이력 없음 (키워드: {', '.join(_keywords(None))})"
    return f"{len(rows)}건\n\n" + monitor.awards_tables(rows)


if __name__ == "__main__":
    server.run()
