# 제3자 구성 요소

이 편집기는 다음 공개 소프트웨어를 포함합니다.

| 구성 요소 | 쓰는 곳 | 라이선스 | 위치 |
|---|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 (Mozilla) | PDF에서 글자 뽑기 | Apache-2.0 | `vendor/pdf.min.js`, `vendor/pdf.worker.min.js`, 전문 `vendor/LICENSE.pdfjs` |
| [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) 0.131.0 | AI 공문 작성(Claude API 호출) | MIT, Copyright 2023 Anthropic, PBC | `vendor/anthropic-sdk.min.js`, 전문 `vendor/LICENSE.anthropic-sdk` |
| [python-hwpx](https://pypi.org/project/python-hwpx/)의 `Skeleton.hwpx` (Copyright 2025-2026 airmang) | HWPX 내보내기의 바탕 서식(한컴 오피스로 만든 빈 문서) | Apache-2.0 | `src/hwpxTemplate.js` (scripts/gen_hwpx_template.py로 생성) |

Apache License 2.0 전문: https://www.apache.org/licenses/LICENSE-2.0
