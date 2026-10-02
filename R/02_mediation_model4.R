# ============================================================
# 02. PROCESS Model 4 동등 분석: 병렬매개 (일의의미, 주인의식)
#   X=리더십합계, M1=일의의미합계, M2=주인의식합계, Y=혁신행동합계
#   통제: 성별, 연령(연속), 학력, 재직기간(현직장근속통합)
#   부트스트랩 5,000회, 95% 백분위 신뢰구간, seed=20260102
#   * 통제변수 코딩은 전문가 명령문 미확보 상태의 1차 설정임
#     (연령=연속 @연령; 민감도: 연령대 사용 버전은 02b 참조)
# ============================================================
suppressMessages({library(haven); library(boot)})
set.seed(20260102)
NBOOT <- 5000

d <- haven::read_sav("data_private/final.sav")
dat <- data.frame(
  X  = as.numeric(d$리더십합계),
  M1 = as.numeric(d$일의의미합계),
  M2 = as.numeric(d$주인의식합계),
  Y  = as.numeric(d$혁신행동합계),
  성별 = as.numeric(d$`@성별`),
  연령 = as.numeric(d$`@연령`),
  학력 = as.numeric(d$`@학력`),
  재직 = as.numeric(d$`@현직장근속통합`)
)
stopifnot(sum(complete.cases(dat)) == 318)
cat("분석 유효 N =", sum(complete.cases(dat)), "\n\n")

ctrl <- "성별 + 연령 + 학력 + 재직"
f_tot <- as.formula(paste("Y ~ X +", ctrl))
f_m1  <- as.formula(paste("M1 ~ X +", ctrl))
f_m2  <- as.formula(paste("M2 ~ X +", ctrl))
f_y   <- as.formula(paste("Y ~ X + M1 + M2 +", ctrl))

fit_tot <- lm(f_tot, dat); fit_m1 <- lm(f_m1, dat)
fit_m2  <- lm(f_m2, dat);  fit_y  <- lm(f_y, dat)

coef_table <- function(fit, label) {
  s <- summary(fit)
  out <- data.frame(모형=label, 변수=rownames(s$coefficients),
                    B=round(s$coefficients[,1],4), SE=round(s$coefficients[,2],4),
                    t=round(s$coefficients[,3],3), p=round(s$coefficients[,4],4))
  ci <- round(confint(fit),4); out$CI하한 <- ci[,1]; out$CI상한 <- ci[,2]
  out$R2 <- round(s$r.squared,4); out$F <- round(s$fstatistic[1],3)
  out$모형p <- round(pf(s$fstatistic[1], s$fstatistic[2], s$fstatistic[3], lower.tail=FALSE),5)
  out
}
all_coefs <- rbind(
  coef_table(fit_tot, "총효과모형 Y~X+C"),
  coef_table(fit_m1,  "M1모형 일의의미~X+C"),
  coef_table(fit_m2,  "M2모형 주인의식~X+C"),
  coef_table(fit_y,   "Y모형 Y~X+M1+M2+C"))
write.csv(all_coefs, "output/tables/02_병렬매개_회귀계수.csv", row.names=FALSE, fileEncoding="UTF-8")
print(all_coefs, row.names=FALSE)

# ---- 부트스트랩 간접효과 (백분위 CI) ----
boot_fn <- function(data, idx) {
  db <- data[idx, ]
  a1 <- coef(lm(f_m1, db))["X"]; a2 <- coef(lm(f_m2, db))["X"]
  by <- coef(lm(f_y, db)); b1 <- by["M1"]; b2 <- by["M2"]
  c(a1*b1, a2*b2, a1*b1 + a2*b2, a1*b1 - a2*b2)
}
bt <- boot(dat, boot_fn, R = NBOOT)
eff_names <- c("간접효과1: X->일의의미->Y", "간접효과2: X->주인의식->Y",
               "총간접효과", "간접효과차이(1-2) [신규 검정]")
res <- data.frame(효과=eff_names, 추정치=round(bt$t0,4),
                  BootSE=round(apply(bt$t,2,sd),4),
                  CI하한=NA, CI상한=NA)
for (i in 1:4) {
  ci <- boot.ci(bt, type="perc", index=i)$percent[4:5]
  res$CI하한[i] <- round(ci[1],4); res$CI상한[i] <- round(ci[2],4)
}
res$유의 <- ifelse(res$CI하한*res$CI상한 > 0, "유의(CI가 0 미포함)", "비유의")
write.csv(res, "output/tables/02_병렬매개_간접효과_부트스트랩.csv", row.names=FALSE, fileEncoding="UTF-8")
cat("\n부트스트랩", NBOOT, "회, 95% 백분위 CI, seed=20260102\n")
print(res, row.names=FALSE)

# 총효과/직접효과 요약
cat("\n총효과 c  =", round(coef(fit_tot)["X"],4),
    " / 직접효과 c' =", round(coef(fit_y)["X"],4), "\n")
