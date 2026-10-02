# -*- coding: utf-8 -*-
"""<그림 2> 조직지원인식의 조절효과 양상 (심리적 주인의식) — 흑백 재작성.

값은 그림에서 읽은 것이 아니라, 전문가 .spv와 완전 일치 확인된
위계적 조절회귀 3단계 모형(DV=주인의식합계)의 계수로 직접 계산:
  예측값 = 절편 + b_ZX*ZX + b_ZW*ZW + b_ZXW*(ZX*ZW),  ZX, ZW ∈ {-1, +1}
(통제변수 기여분 제외 — 원 학위논문 그림과 동일한 관행.
 수준만 이동하고 기울기·상호작용 양상은 통제변수 처리와 무관.)
양식: 세로축 2.2~3.8(0.2 간격), 가로축 낮음/높음,
     조직지원인식 낮음 = 실선+원, 높음 = 점선+사각형, 흑백.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import pandas as pd
import statsmodels.formula.api as smf
import pyreadstat

font_manager.fontManager.addfont("/usr/share/fonts/truetype/nanum/NanumGothic.ttf")
plt.rcParams.update({"font.family": "NanumGothic", "axes.unicode_minus": False})

df, _ = pyreadstat.read_sav("data_private/final.sav")
dat = df.rename(columns={"주인의식합계": "M2", "Z리더십합계": "ZX",
    "Z조직지원합계": "ZW", "Z리더십x조직지원": "ZXW",
    "@성별": "성별", "@연령": "연령", "@학력": "학력",
    "@현직장근속통합": "재직"})
m = smf.ols("M2 ~ 성별 + 연령 + 학력 + 재직 + ZX + ZW + ZXW", dat).fit()
b = m.params
pred = {}
for zw, lab in [(-1, "낮음"), (1, "높음")]:
    pred[lab] = [b["Intercept"] + b["ZX"]*zx + b["ZW"]*zw + b["ZXW"]*zx*zw
                 for zx in (-1, 1)]
print("예측값:", {k: [round(v, 3) for v in vals] for k, vals in pred.items()})

# 한 단 폭 인쇄 시 글자 약 8pt: 폭 3.2in × 750dpi = 2400px
fig, ax = plt.subplots(figsize=(3.2, 2.7), dpi=750)
x = [0, 1]
ax.plot(x, pred["낮음"], "-", color="black", lw=1.4, marker="o", ms=4.5,
        markerfacecolor="black", label="조직지원인식 낮음")
ax.plot(x, pred["높음"], ":", color="black", lw=1.6, marker="s", ms=4.5,
        markerfacecolor="white", markeredgecolor="black",
        label="조직지원인식 높음")

ax.set_xlim(-0.35, 1.35)
ax.set_ylim(2.2, 3.8)
ax.set_yticks([round(2.2 + 0.2*i, 1) for i in range(9)])
ax.set_xticks(x)
ax.set_xticklabels(["낮음", "높음"], fontsize=8)
ax.tick_params(axis="y", labelsize=8)
ax.set_xlabel("임파워링 리더십", fontsize=8.5)
ax.set_ylabel("심리적 주인의식", fontsize=8.5)
ax.spines[["top", "right"]].set_visible(False)
ax.grid(axis="y", color="0.88", lw=0.5)
ax.set_axisbelow(True)
ax.legend(frameon=False, fontsize=8, loc="upper left", handlelength=2.6)
fig.tight_layout()
fig.savefig("output/figures/그림2_조절효과_주인의식.png", bbox_inches="tight")
fig.savefig("output/figures/그림2_조절효과_주인의식.pdf", bbox_inches="tight")
print("저장: output/figures/그림2_조절효과_주인의식.{png,pdf}")
