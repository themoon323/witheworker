# ============================================================
# 02b. 민감도: 통제변수 코딩 대안 (연령대 범주변수 사용)
#   전문가 명령문 미확보로 연령의 투입 형태가 불명확하여,
#   주요 결과(간접효과, 상호작용)가 코딩에 민감한지 점검
#   A안(주 분석): @연령 연속 / B안: 연령대(1-4) 연속 투입
#   C안: 연령대 더미 투입
# ============================================================
suppressMessages({library(haven); library(boot)})
set.seed(20260102); NBOOT <- 5000
d <- haven::read_sav("data_private/final.sav")
base <- data.frame(
  X=as.numeric(d$리더십합계), M1=as.numeric(d$일의의미합계),
  M2=as.numeric(d$주인의식합계), Y=as.numeric(d$혁신행동합계),
  ZX=as.numeric(d$Z리더십합계), ZW=as.numeric(d$Z조직지원합계),
  ZXW=as.numeric(d$Z리더십x조직지원),
  성별=as.numeric(d$`@성별`), 연령=as.numeric(d$`@연령`),
  연령대=as.numeric(d$연령대), 학력=as.numeric(d$`@학력`),
  재직=as.numeric(d$`@현직장근속통합`))

run_version <- function(ctrl_terms, label) {
  f_m1 <- as.formula(paste("M1 ~ X +", ctrl_terms))
  f_m2 <- as.formula(paste("M2 ~ X +", ctrl_terms))
  f_y  <- as.formula(paste("Y ~ X + M1 + M2 +", ctrl_terms))
  bfn <- function(data, idx) {
    db <- data[idx,]
    a1 <- coef(lm(f_m1,db))["X"]; a2 <- coef(lm(f_m2,db))["X"]
    by <- coef(lm(f_y,db)); c(a1*by["M1"], a2*by["M2"])
  }
  bt <- boot(base, bfn, R=NBOOT)
  ci1 <- boot.ci(bt,type="perc",index=1)$percent[4:5]
  ci2 <- boot.ci(bt,type="perc",index=2)$percent[4:5]
  g1 <- summary(lm(as.formula(paste("M1 ~ 성별+ZX+ZW+ZXW+",
        sub("성별 \\+ ","",ctrl_terms))), base))$coefficients
  g2 <- summary(lm(as.formula(paste("M2 ~ 성별+ZX+ZW+ZXW+",
        sub("성별 \\+ ","",ctrl_terms))), base))$coefficients
  data.frame(버전=label,
    간접1=round(bt$t0[1],4), 간접1_CI=sprintf("[%.4f, %.4f]",ci1[1],ci1[2]),
    간접2=round(bt$t0[2],4), 간접2_CI=sprintf("[%.4f, %.4f]",ci2[1],ci2[2]),
    상호작용_M1_p=round(g1["ZXW",4],4), 상호작용_M2_p=round(g2["ZXW",4],4))
}

out <- rbind(
  run_version("성별 + 연령 + 학력 + 재직", "A안: 연령 연속(주 분석)"),
  run_version("성별 + 연령대 + 학력 + 재직", "B안: 연령대 연속"),
  run_version("성별 + factor(연령대) + 학력 + 재직", "C안: 연령대 더미"))
write.csv(out, "output/tables/02b_통제변수_민감도.csv", row.names=FALSE, fileEncoding="UTF-8")
print(out, row.names=FALSE)
