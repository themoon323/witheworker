# 논문 통계분석 프로젝트

논문 통계분석을 위한 작업 공간입니다.

## 설치된 분석 환경

### Python 3.11 (주 분석 도구)
| 패키지 | 용도 |
|---|---|
| pandas, numpy | 데이터 정리·가공 |
| scipy | 기초 통계 검정 |
| statsmodels | 회귀분석, ANOVA, 고급 모형 |
| pingouin | 논문용 통계 (t-test, ANOVA, 상관, 신뢰도 Cronbach's α, 효과크기 자동 산출) |
| factor_analyzer | 탐색적 요인분석(EFA), KMO/Bartlett 검정 |
| scikit-learn | 머신러닝, 군집분석 |
| matplotlib, seaborn | 그래프·시각화 |
| openpyxl | 엑셀 파일 읽기/쓰기 |

### R 4.3.3 (보조 분석 도구)
| 패키지 | 용도 |
|---|---|
| psych | 신뢰도, 요인분석, 기술통계 |
| car | Type III ANOVA, 회귀 진단 |
| lavaan | 구조방정식모형(SEM), 확인적 요인분석(CFA) |

> 참고: 자모비(jamovi)는 GUI 프로그램이라 이 클라우드 환경에서 직접 실행할 수 없습니다.
> 자모비의 통계 엔진은 R 기반이므로, 위 환경에서 동일한 분석을 모두 재현할 수 있습니다.

## 폴더 구조

```
data/      # 원본 데이터 (CSV, 엑셀 등)를 여기에 넣으세요
analysis/  # 분석 스크립트
output/    # 분석 결과표, 그래프 저장
```

## 사용 방법

1. `data/` 폴더에 데이터 파일(CSV 또는 엑셀)을 업로드
2. `analysis/template_analysis.py`를 데이터에 맞게 수정하거나, Claude에게 분석을 요청
3. 결과는 `output/`에 저장됨

```bash
python3 analysis/template_analysis.py
```
