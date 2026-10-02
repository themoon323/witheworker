# ============================================================
# 02c. PROCESS Model 4 정확 재현 (전문가 .spv 대조 확정판)
#   전문가 최종 실행(.spv 마지막 Matrix 블록)과 동일 사양:
#   공변량 = @성별, @연령, @학력, 현직장근속년  ← "현직"의 실체
#   (주의: 전문가의 위계적 조절회귀는 @현직장근속통합 사용 — 분석 간 불일치)
#   부트스트랩 5,000회, 95% 백분위, seed=20260102
#   결과: 모든 OLS 계수가 전문가 출력과 소수 셋째 자리까지 일치
# ============================================================
suppressMessages({library(haven); library(boot)})
set.seed(20260102)
d <- haven::read_sav("data_private/final.sav")
dat <- data.frame(X=as.numeric(d$리더십합계), M1=as.numeric(d$일의의미합계),
  M2=as.numeric(d$주인의식합계), Y=as.numeric(d$혁신행동합계),
  성별=as.numeric(d$`@성별`), 연령=as.numeric(d$`@연령`),
  학력=as.numeric(d$`@학력`), 재직년=as.numeric(d$현직장근속년))
stopifnot(sum(complete.cases(dat)) == 318)
f_m1 <- M1 ~ X + 성별 + 연령 + 학력 + 재직년
f_m2 <- M2 ~ X + 성별 + 연령 + 학력 + 재직년
f_y  <- Y ~ X + M1 + M2 + 성별 + 연령 + 학력 + 재직년
f_t  <- Y ~ X + 성별 + 연령 + 학력 + 재직년

out <- data.frame()
for (nm in c("f_m1","f_m2","f_y","f_t")) {
  m <- lm(get(nm), dat); s <- summary(m)
  out <- rbind(out, data.frame(모형=nm, 변수=rownames(s$coefficients),
    B=round(s$coefficients[,1],4), SE=round(s$coefficients[,2],4),
    t=round(s$coefficients[,3],3), p=round(s$coefficients[,4],4),
    R2=round(s$r.squared,4)))
}
write.csv(out, "output/tables/02c_병렬매개_정확재현.csv", row.names=FALSE, fileEncoding="UTF-8")
print(out, row.names=FALSE)

bfn <- function(data, idx) {
  db <- data[idx,]
  a1 <- coef(lm(f_m1,db))["X"]; a2 <- coef(lm(f_m2,db))["X"]
  by <- coef(lm(f_y,db))
  c(a1*by["M1"], a2*by["M2"], a1*by["M1"]+a2*by["M2"], a1*by["M1"]-a2*by["M2"])
}
bt <- boot(dat, bfn, R=5000)
res <- data.frame(효과=c("간접: 일의의미","간접: 주인의식","총간접","차이(신규)"),
  추정치=round(bt$t0,4), BootSE=round(apply(bt$t,2,sd),4))
for (i in 1:4) { ci <- boot.ci(bt,type="perc",index=i)$percent[4:5]
  res$CI하한[i] <- round(ci[1],4); res$CI상한[i] <- round(ci[2],4) }
write.csv(res, "output/tables/02c_간접효과_정확재현.csv", row.names=FALSE, fileEncoding="UTF-8")
print(res, row.names=FALSE)
