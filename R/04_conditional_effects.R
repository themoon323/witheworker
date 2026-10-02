# ============================================================
# 04. 조건부 효과 보강 (03과 동일 표본·통제·코딩)
#   - 조절변수 평균 및 ±1SD에서 리더십의 조건부 효과 (SE, t, p, 95% CI)
#   - Johnson-Neyman 구간 (관측 범위 명시)
#   - 강건성: HC3 강건 SE, 제곱항 포함 모형
#   * Z척도 기준: 파일의 Z리더십/Z조직지원은 전체표본 표준화이므로
#     ±1SD는 Z단위로 ±1에 해당. 원점수 환산값도 병기.
# ============================================================
suppressMessages({library(haven); library(sandwich); library(lmtest)})
d <- haven::read_sav("data_private/final.sav")
dat <- data.frame(
  M1 = as.numeric(d$일의의미합계), M2 = as.numeric(d$주인의식합계),
  ZX = as.numeric(d$Z리더십합계), ZW = as.numeric(d$Z조직지원합계),
  ZXW = as.numeric(d$Z리더십x조직지원),
  성별 = as.numeric(d$`@성별`), 연령 = as.numeric(d$`@연령`),
  학력 = as.numeric(d$`@학력`), 재직 = as.numeric(d$`@현직장근속통합`)
)
X_mean <- mean(d$리더십합계); X_sd <- sd(d$리더십합계)
W_mean <- mean(d$조직지원합계); W_sd <- sd(d$조직지원합계)
cat(sprintf("리더십 원점수 M=%.3f SD=%.3f / 조직지원 원점수 M=%.3f SD=%.3f\n",
            X_mean, X_sd, W_mean, W_sd))
cat(sprintf("ZW 관측 범위: [%.3f, %.3f]\n\n", min(dat$ZW), max(dat$ZW)))

cond_eff <- function(dv) {
  f <- as.formula(paste(dv, "~ 성별+연령+학력+재직+ZX+ZW+ZXW"))
  m <- lm(f, dat); V <- vcov(m); b <- coef(m)
  out <- data.frame()
  for (w in c(-1, 0, 1)) {
    est <- b["ZX"] + w*b["ZXW"]
    se  <- sqrt(V["ZX","ZX"] + w^2*V["ZXW","ZXW"] + 2*w*V["ZX","ZXW"])
    tval <- est/se; df <- m$df.residual
    p <- 2*pt(-abs(tval), df)
    out <- rbind(out, data.frame(
      DV=dv, W수준=c("-1SD","Mean","+1SD")[w+2],
      W원점수=round(W_mean + w*W_sd,3),
      효과=round(est,4), SE=round(se,4), t=round(tval,3), p=round(p,4),
      CI하한=round(est - qt(.975,df)*se,4), CI상한=round(est + qt(.975,df)*se,4)))
  }
  # Johnson-Neyman: ZX 효과가 유의/비유의로 바뀌는 ZW 값
  df <- m$df.residual; tc <- qt(.975, df)
  A <- b["ZXW"]^2 - tc^2*V["ZXW","ZXW"]
  B <- 2*(b["ZX"]*b["ZXW"] - tc^2*V["ZX","ZXW"])
  C <- b["ZX"]^2 - tc^2*V["ZX","ZX"]
  disc <- B^2 - 4*A*C
  jn <- if (disc >= 0) sort(c((-B-sqrt(disc))/(2*A), (-B+sqrt(disc))/(2*A))) else NULL
  list(table=out, jn=jn, model=m)
}

res1 <- cond_eff("M1"); res2 <- cond_eff("M2")
tab <- rbind(res1$table, res2$table)
write.csv(tab, "output/tables/04_조건부효과.csv", row.names=FALSE, fileEncoding="UTF-8")
print(tab, row.names=FALSE)
for (nm_res in list(c("M1(일의의미)"), c("M2(주인의식)"))) {}
cat("\nJohnson-Neyman 경계값 (ZW 단위):\n")
cat("  M1(일의의미):", if(is.null(res1$jn)) "해 없음" else sprintf("%.3f, %.3f (원점수 %.3f, %.3f)",
    res1$jn[1], res1$jn[2], W_mean+res1$jn[1]*W_sd, W_mean+res1$jn[2]*W_sd), "\n")
cat("  M2(주인의식):", if(is.null(res2$jn)) "해 없음" else sprintf("%.3f, %.3f (원점수 %.3f, %.3f)",
    res2$jn[1], res2$jn[2], W_mean+res2$jn[1]*W_sd, W_mean+res2$jn[2]*W_sd), "\n")
cat("  * ZW 관측 범위 밖 경계값은 외삽이므로 해석하지 않음\n")

# ---- 강건성 1: HC3 강건 표준오차 ----
cat("\n=== 강건성: HC3 강건 SE (상호작용항만 발췌) ===\n")
for (dv in c("M1","M2")) {
  f <- as.formula(paste(dv, "~ 성별+연령+학력+재직+ZX+ZW+ZXW"))
  m <- lm(f, dat)
  ct <- coeftest(m, vcov=vcovHC(m, type="HC3"))
  cat(sprintf("%s: ZXW B=%.4f, HC3 SE=%.4f, t=%.3f, p=%.4f\n",
              dv, ct["ZXW",1], ct["ZXW",2], ct["ZXW",3], ct["ZXW",4]))
}

# ---- 강건성 2: 제곱항 포함 (비선형성과 상호작용 혼동 점검) ----
cat("\n=== 강건성: ZX^2, ZW^2 포함 모형 (상호작용항 발췌) ===\n")
dat$ZX2 <- dat$ZX^2; dat$ZW2 <- dat$ZW^2
rob2 <- data.frame()
for (dv in c("M1","M2")) {
  f <- as.formula(paste(dv, "~ 성별+연령+학력+재직+ZX+ZW+ZX2+ZW2+ZXW"))
  m <- lm(f, dat); s <- summary(m)$coefficients
  cat(sprintf("%s: ZXW B=%.4f, SE=%.4f, p=%.4f | ZX2 p=%.4f, ZW2 p=%.4f\n",
      dv, s["ZXW",1], s["ZXW",2], s["ZXW",4], s["ZX2",4], s["ZW2",4]))
  rob2 <- rbind(rob2, data.frame(DV=dv, 변수=rownames(s), B=round(s[,1],4),
                                 SE=round(s[,2],4), t=round(s[,3],3), p=round(s[,4],4)))
}
write.csv(rob2, "output/tables/04_강건성_제곱항모형.csv", row.names=FALSE, fileEncoding="UTF-8")
