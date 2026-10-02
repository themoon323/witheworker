# ============================================================
# 03. 위계적 조절회귀 (재현)
#   DV별로: M1=일의의미, M2=주인의식
#   1단계: 통제변수 / 2단계: +Z리더십, Z조직지원 / 3단계: +상호작용항
#   Z변수와 상호작용항은 파일에 저장된 값(전문가 생성) 그대로 사용
# ============================================================
suppressMessages({library(haven)})
d <- haven::read_sav("data_private/final.sav")
dat <- data.frame(
  M1 = as.numeric(d$일의의미합계), M2 = as.numeric(d$주인의식합계),
  ZX = as.numeric(d$Z리더십합계), ZW = as.numeric(d$Z조직지원합계),
  ZXW = as.numeric(d$Z리더십x조직지원),
  성별 = as.numeric(d$`@성별`), 연령 = as.numeric(d$`@연령`),
  학력 = as.numeric(d$`@학력`), 재직 = as.numeric(d$`@현직장근속통합`)
)
stopifnot(sum(complete.cases(dat)) == 318)

run_hier <- function(dv) {
  f1 <- as.formula(paste(dv, "~ 성별 + 연령 + 학력 + 재직"))
  f2 <- update(f1, . ~ . + ZX + ZW)
  f3 <- update(f2, . ~ . + ZXW)
  m1 <- lm(f1, dat); m2 <- lm(f2, dat); m3 <- lm(f3, dat)
  cmp12 <- anova(m1, m2); cmp23 <- anova(m2, m3)
  steps <- data.frame(
    DV=dv, 단계=1:3,
    R2=round(c(summary(m1)$r.squared, summary(m2)$r.squared, summary(m3)$r.squared),4),
    adjR2=round(c(summary(m1)$adj.r.squared, summary(m2)$adj.r.squared, summary(m3)$adj.r.squared),4),
    dR2=round(c(NA, summary(m2)$r.squared-summary(m1)$r.squared,
                summary(m3)$r.squared-summary(m2)$r.squared),4),
    F_change=round(c(NA, cmp12$F[2], cmp23$F[2]),3),
    p_change=round(c(NA, cmp12$`Pr(>F)`[2], cmp23$`Pr(>F)`[2]),5))
  s3 <- summary(m3)$coefficients
  coefs <- data.frame(DV=dv, 변수=rownames(s3), B=round(s3[,1],4), SE=round(s3[,2],4),
                      t=round(s3[,3],3), p=round(s3[,4],4))
  list(steps=steps, coefs=coefs, m3=m3)
}

r1 <- run_hier("M1"); r2 <- run_hier("M2")
steps <- rbind(r1$steps, r2$steps); coefs <- rbind(r1$coefs, r2$coefs)
write.csv(steps, "output/tables/03_조절회귀_단계별R2.csv", row.names=FALSE, fileEncoding="UTF-8")
write.csv(coefs, "output/tables/03_조절회귀_3단계계수.csv", row.names=FALSE, fileEncoding="UTF-8")
cat("=== 단계별 R2/dR2 (M1=일의의미, M2=주인의식) ===\n"); print(steps, row.names=FALSE)
cat("\n=== 3단계(상호작용 포함) 계수 ===\n"); print(coefs, row.names=FALSE)
