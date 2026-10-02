# -*- coding: utf-8 -*-
"""논문 통계분석 템플릿

data/ 폴더의 데이터 파일을 읽어 기술통계, 신뢰도, 집단 비교, 상관, 회귀분석을
수행하고 결과를 output/ 폴더에 저장합니다.

사용 전 아래 '설정' 부분의 파일명과 변수명을 본인 데이터에 맞게 수정하세요.
"""
from pathlib import Path

import pandas as pd
import pingouin as pg

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ──────────────────────────── 설정 ────────────────────────────
DATA_FILE = DATA_DIR / "example.csv"   # 분석할 데이터 파일명으로 변경
GROUP_VAR = "group"                    # 집단 변수 (예: 성별, 실험/통제집단)
DV = "score"                           # 종속변수
SCALE_ITEMS = ["q1", "q2", "q3"]       # 신뢰도 분석할 척도 문항들
# ──────────────────────────────────────────────────────────────


def load_data(path: Path) -> pd.DataFrame:
    if path.suffix in (".xlsx", ".xls"):
        return pd.read_excel(path)
    return pd.read_csv(path)


def main() -> None:
    df = load_data(DATA_FILE)
    print(f"데이터: {DATA_FILE.name} ({len(df)}행, {len(df.columns)}열)\n")

    # 1. 기술통계
    desc = df.describe().T.round(3)
    desc.to_csv(OUTPUT_DIR / "1_기술통계.csv", encoding="utf-8-sig")
    print("── 기술통계 ──")
    print(desc, "\n")

    # 2. 신뢰도 (Cronbach's alpha)
    items = [c for c in SCALE_ITEMS if c in df.columns]
    if len(items) >= 2:
        alpha, ci = pg.cronbach_alpha(df[items].dropna())
        print(f"── 신뢰도 ──\nCronbach's α = {alpha:.3f} (95% CI {ci[0]:.3f}–{ci[1]:.3f})\n")

    if GROUP_VAR in df.columns and DV in df.columns:
        groups = df[GROUP_VAR].dropna().unique()

        # 3. 정규성·등분산 검정
        norm = pg.normality(df, dv=DV, group=GROUP_VAR).round(4)
        levene = pg.homoscedasticity(df, dv=DV, group=GROUP_VAR).round(4)
        print("── 정규성(Shapiro-Wilk) ──")
        print(norm, "\n")
        print("── 등분산(Levene) ──")
        print(levene, "\n")

        # 4. 집단 비교: 2집단이면 t-test, 3집단 이상이면 ANOVA
        if len(groups) == 2:
            g1 = df.loc[df[GROUP_VAR] == groups[0], DV].dropna()
            g2 = df.loc[df[GROUP_VAR] == groups[1], DV].dropna()
            res = pg.ttest(g1, g2).round(4)
            res.to_csv(OUTPUT_DIR / "2_집단비교_ttest.csv", encoding="utf-8-sig")
            print("── 독립표본 t-검정 ──")
            print(res, "\n")
        elif len(groups) >= 3:
            res = pg.anova(data=df, dv=DV, between=GROUP_VAR).round(4)
            posthoc = pg.pairwise_tukey(data=df, dv=DV, between=GROUP_VAR).round(4)
            res.to_csv(OUTPUT_DIR / "2_집단비교_ANOVA.csv", encoding="utf-8-sig")
            posthoc.to_csv(OUTPUT_DIR / "2_사후검정_Tukey.csv", encoding="utf-8-sig")
            print("── 일원배치 ANOVA ──")
            print(res, "\n")
            print("── 사후검정(Tukey HSD) ──")
            print(posthoc, "\n")

    # 5. 상관분석 (수치형 변수 전체)
    num_cols = df.select_dtypes("number").columns
    if len(num_cols) >= 2:
        corr = df[num_cols].corr().round(3)
        corr.to_csv(OUTPUT_DIR / "3_상관행렬.csv", encoding="utf-8-sig")
        print("── 상관행렬(Pearson) ──")
        print(corr, "\n")

    print(f"결과 저장 위치: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
