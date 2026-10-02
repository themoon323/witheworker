# -*- coding: utf-8 -*-
"""논문 삽입용 조절효과(단순기울기) 그림.

03 위계적 조절회귀 3단계 모형과 동일한 계수로,
조직지원인식 평균±1SD에서 임파워링 리더십(±1SD)에 따른
예측값을 그린다. 통제변수는 표본 평균에 고정.
흑백 인쇄 대응: 실선/점선 + 마커 구분(색각 이상에도 안전).
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
import pyreadstat
import statsmodels.formula.api as smf

font_manager.fontManager.addfont("/usr/share/fonts/truetype/nanum/NanumGothic.ttf")
plt.rcParams.update({
    "font.family": "NanumGothic", "axes.unicode_minus": False,
    "font.size": 10, "axes.linewidth": 0.8,
})

df, _ = pyreadstat.read_sav("data_private/final.sav")
dat = df.rename(columns={
    "일의의미합계": "M1", "주인의식합계": "M2",
    "Z리더십합계": "ZX", "Z조직지원합계": "ZW", "Z리더십x조직지원": "ZXW",
    "@성별": "성별", "@연령": "연령", "@학력": "학력", "@현직장근속통합": "재직"})

X_m, X_sd = df["리더십합계"].mean(), df["리더십합계"].std(ddof=1)
W_m, W_sd = df["조직지원합계"].mean(), df["조직지원합계"].std(ddof=1)

panels = [("M1", "일의 의미"), ("M2", "심리적 주인의식")]
fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.2), dpi=300, sharey=False)

for ax, (dv, title) in zip(axes, panels):
    m = smf.ols(f"{dv} ~ 성별 + 연령 + 학력 + 재직 + ZX + ZW + ZXW", dat).fit()
    b = m.params
    ctrl = (b["Intercept"] + b["성별"]*dat["성별"].mean() + b["연령"]*dat["연령"].mean()
            + b["학력"]*dat["학력"].mean() + b["재직"]*dat["재직"].mean())
    zx = np.array([-1.0, 1.0])
    styles = [("저(-1SD)", "0.45", "--", "s"), ("고(+1SD)", "black", "-", "o")]
    for zw, (lab, color, ls, mk) in zip([-1.0, 1.0], styles):
        y = ctrl + b["ZX"]*zx + b["ZW"]*zw + b["ZXW"]*zx*zw
        ax.plot(zx, y, ls, color=color, lw=2, marker=mk, ms=5,
                label=f"조직지원인식 {lab}")
    ax.set_xticks([-1, 1])
    ax.set_xticklabels([f"저(-1SD)\n{X_m-X_sd:.2f}", f"고(+1SD)\n{X_m+X_sd:.2f}"])
    ax.set_xlabel("임파워링 리더십")
    ax.set_ylabel(title)
    ax.set_title(f"{title}", fontsize=11)
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", color="0.9", lw=0.6)
    ax.set_axisbelow(True)

axes[0].legend(frameon=False, fontsize=8.5, loc="upper left")
axes[0].text(0.98, 0.04, "상호작용 p = .091 (비유의)", transform=axes[0].transAxes,
             fontsize=8, color="0.3", ha="right")
axes[1].text(0.98, 0.04, "상호작용 p = .028", transform=axes[1].transAxes,
             fontsize=8, color="0.3", ha="right")
fig.tight_layout()
fig.savefig("output/figures/그림_조절효과_단순기울기.png", bbox_inches="tight")
fig.savefig("output/figures/그림_조절효과_단순기울기.pdf", bbox_inches="tight")
print("저장 완료: output/figures/그림_조절효과_단순기울기.{png,pdf}")
