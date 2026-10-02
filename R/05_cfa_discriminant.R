# ============================================================
# 05. 측정모형 및 판별타당도
#   사전 지정:
#   - 주 분석: MLR (5점 리커트 46문항의 연속형 근사; 합성점수 기반
#     주 분석과의 정합성, 표본 N=318 고려). 강건 적합도 지수 보고.
#   - 민감도 분석: WLSMV (순서형 자료 특성 반영; 주요 모형만)
#   - 자동 문항삭제·수정지수 기반 수정 없음. 최초 지정 모형 그대로 보고.
#   모형:
#     m5  : 5요인 (구성개념 수준, 최종 문항)
#     m10 : 하위차원 수준 10요인 (리더십4 + 일의의미 + 주인의식2 + 조직지원 + 혁신행동2)
#     대안: EL+POS 통합 / PO+POS 통합 / MW+PO 통합 / 단일요인
#   판별타당도: 잠재상관, CR/AVE(두 수준), HTMT(부트스트랩 CI, seed=20260102)
# ============================================================
suppressMessages({library(haven); library(lavaan); library(semTools)})
d <- haven::read_sav("data_private/final.sav")
dd <- as.data.frame(lapply(d, as.numeric))
names(dd) <- names(d)

EL  <- paste0("리더십", 1:12)
MW  <- paste0("일의의미", c(1,2,4:10))
PO  <- paste0("주인의식", 1:9)
POS <- paste0("조직지원", c(1:5,7,8))
IB  <- paste0("혁신행동", 1:9)
mk <- function(f, it) paste(f, "=~", paste(it, collapse=" + "))

m5_syntax <- paste(mk("EL",EL), mk("MW",MW), mk("PO",PO), mk("POS",POS), mk("IB",IB), sep="\n")
m10_syntax <- paste(
  mk("EL직무", EL[1:3]), mk("EL의사", EL[4:6]), mk("EL자율", EL[7:9]), mk("EL성과", EL[10:12]),
  mk("MW", MW), mk("PO책임", PO[1:3]), mk("PO소속", PO[4:9]),
  mk("POS", POS), mk("IB창출", IB[1:3]), mk("IB전파구현", IB[4:9]), sep="\n")
alt_ELPOS <- paste(mk("ELPOS", c(EL,POS)), mk("MW",MW), mk("PO",PO), mk("IB",IB), sep="\n")
alt_POPOS <- paste(mk("EL",EL), mk("MW",MW), mk("POPOS", c(PO,POS)), mk("IB",IB), sep="\n")
alt_MWPO  <- paste(mk("EL",EL), mk("MWPO", c(MW,PO)), mk("POS",POS), mk("IB",IB), sep="\n")
m1_syntax <- mk("G", c(EL,MW,PO,POS,IB))

fits <- list()
fit_row <- function(name, fit, est) {
  conv <- lavInspect(fit, "converged")
  pe <- parameterEstimates(fit, standardized=TRUE)
  heywood <- any(pe$op=="~~" & pe$lhs==pe$rhs & pe$est < 0)
  idx <- tryCatch(fitMeasures(fit, c("chisq.scaled","df.scaled","pvalue.scaled",
    "cfi.robust","tli.robust","rmsea.robust","rmsea.ci.lower.robust",
    "rmsea.ci.upper.robust","srmr")), error=function(e)
    fitMeasures(fit, c("chisq.scaled","df.scaled","pvalue.scaled",
    "cfi.scaled","tli.scaled","rmsea.scaled","rmsea.ci.lower.scaled",
    "rmsea.ci.upper.scaled","srmr")))
  data.frame(모형=name, 추정법=est, 수렴=conv, 부적절해=heywood,
             chisq=round(idx[1],2), df=idx[2], CFI=round(idx[4],3), TLI=round(idx[5],3),
             RMSEA=round(idx[6],3), RMSEA_CI=sprintf("[%.3f, %.3f]", idx[7], idx[8]),
             SRMR=round(idx[9],3))
}

cat("=== MLR 추정 ===\n")
specs <- list(`5요인`=m5_syntax, `10요인(하위차원)`=m10_syntax,
              `대안: EL+POS 통합(4요인)`=alt_ELPOS, `대안: PO+POS 통합(4요인)`=alt_POPOS,
              `대안: MW+PO 통합(4요인)`=alt_MWPO, `단일요인`=m1_syntax)
fit_tab <- data.frame()
for (nm in names(specs)) {
  f <- cfa(specs[[nm]], data=dd, estimator="MLR", std.lv=TRUE)
  fits[[nm]] <- f
  fit_tab <- rbind(fit_tab, fit_row(nm, f, "MLR"))
}
print(fit_tab, row.names=FALSE)

# 카이제곱 차이검정 (5요인 대비, 강건 보정)
cat("\n=== 5요인 대비 척도보정 카이제곱 차이검정 ===\n")
for (nm in c("대안: EL+POS 통합(4요인)","대안: PO+POS 통합(4요인)","대안: MW+PO 통합(4요인)","단일요인")) {
  lrt <- lavTestLRT(fits[["5요인"]], fits[[nm]])
  cat(sprintf("%s: Δχ²(Δdf=%d)=%.2f, p=%.5f\n", nm, lrt$`Df diff`[2], lrt$`Chisq diff`[2], lrt$`Pr(>Chisq)`[2]))
}

# WLSMV 민감도 (5요인, 단일요인)
cat("\n=== WLSMV 민감도 ===\n")
for (nm in c("5요인","단일요인")) {
  f <- cfa(specs[[nm]], data=dd, estimator="WLSMV", ordered=TRUE, std.lv=TRUE)
  fit_tab <- rbind(fit_tab, fit_row(paste0(nm," [WLSMV]"), f, "WLSMV"))
  fits[[paste0(nm,"_wlsmv")]] <- f
}
print(tail(fit_tab,2), row.names=FALSE)
write.csv(fit_tab, "output/tables/05_CFA_적합도.csv", row.names=FALSE, fileEncoding="UTF-8")

# ---- 5요인(MLR): 표준화 적재치, 잠재상관, CR/AVE ----
f5 <- fits[["5요인"]]
std <- standardizedSolution(f5)
load5 <- std[std$op=="=~", c("lhs","rhs","est.std","se","pvalue")]
load5$est.std <- round(load5$est.std,3)
write.csv(load5, "output/tables/05_5요인_표준화적재치.csv", row.names=FALSE, fileEncoding="UTF-8")
cat("\n적재치 범위(5요인):\n")
print(aggregate(est.std ~ lhs, load5, function(x) paste0(round(min(x),3),"–",round(max(x),3))))

lat5 <- std[std$op=="~~" & std$lhs!=std$rhs, c("lhs","rhs","est.std","se","pvalue")]
lat5$est.std <- round(lat5$est.std,3)
write.csv(lat5, "output/tables/05_5요인_잠재상관.csv", row.names=FALSE, fileEncoding="UTF-8")
cat("\n잠재요인 상관(5요인 MLR):\n"); print(lat5, row.names=FALSE)

rel5 <- as.data.frame(compRelSEM(f5, return.total=FALSE))
ave5 <- as.data.frame(t(semTools::AVE(f5)))
cat("\nCR(omega, 구성개념 수준):\n"); print(round(rel5,3))
cat("AVE(구성개념 수준):\n"); print(round(ave5,3))
write.csv(cbind(수준="구성개념(5요인)", CR=round(t(rel5),3), AVE=round(t(ave5),3)),
          "output/tables/05_CR_AVE_구성개념.csv", fileEncoding="UTF-8")

# Fornell-Larcker: AVE 제곱근 vs 잠재상관
cat("\nFornell-Larcker: sqrt(AVE) =", paste(names(ave5), round(sqrt(as.numeric(ave5)),3), collapse=", "), "\n")

# 10요인 모형의 CR/AVE (하위차원 수준)
f10 <- fits[["10요인(하위차원)"]]
rel10 <- as.data.frame(compRelSEM(f10, return.total=FALSE))
ave10 <- as.data.frame(t(semTools::AVE(f10)))
write.csv(cbind(수준="하위차원(10요인)", CR=round(t(rel10),3), AVE=round(t(ave10),3)),
          "output/tables/05_CR_AVE_하위차원.csv", fileEncoding="UTF-8")
lat10 <- standardizedSolution(f10)
lat10 <- lat10[lat10$op=="~~" & lat10$lhs!=lat10$rhs & lat10$lhs!=lat10$rhs, c("lhs","rhs","est.std")]
lat10$est.std <- round(lat10$est.std,3)
write.csv(lat10, "output/tables/05_10요인_잠재상관.csv", row.names=FALSE, fileEncoding="UTF-8")
cat("\n10요인(하위차원) 잠재상관 중 POS 관련 및 .85 이상:\n")
print(lat10[grepl("POS", paste(lat10$lhs, lat10$rhs)) | abs(lat10$est.std) >= .85, ], row.names=FALSE)

# ---- HTMT (구성개념 수준, 부트스트랩 CI) ----
set.seed(20260102)
ht <- semTools::htmt(m5_syntax, data=dd)
cat("\nHTMT (구성개념 수준):\n"); print(round(ht,3))
write.csv(round(as.matrix(ht),3), "output/tables/05_HTMT_구성개념.csv", fileEncoding="UTF-8")

# 부트스트랩 CI (1000회)
NB <- 1000
pairs_idx <- which(lower.tri(as.matrix(ht)), arr.ind=TRUE)
boot_ht <- matrix(NA, NB, nrow(pairs_idx))
for (b in 1:NB) {
  db <- dd[sample(nrow(dd), replace=TRUE), ]
  hb <- tryCatch(as.matrix(semTools::htmt(m5_syntax, data=db)), error=function(e) NULL)
  if (!is.null(hb)) boot_ht[b,] <- hb[pairs_idx]
}
ht_m <- as.matrix(ht)
ht_ci <- data.frame(
  쌍 = paste(rownames(ht_m)[pairs_idx[,1]], colnames(ht_m)[pairs_idx[,2]], sep="-"),
  HTMT = round(ht_m[pairs_idx],3),
  CI하한 = round(apply(boot_ht,2,quantile,.025,na.rm=TRUE),3),
  CI상한 = round(apply(boot_ht,2,quantile,.975,na.rm=TRUE),3))
cat("\nHTMT 부트스트랩 95% CI (", NB, "회, seed=20260102):\n")
print(ht_ci, row.names=FALSE)
write.csv(ht_ci, "output/tables/05_HTMT_부트스트랩CI.csv", row.names=FALSE, fileEncoding="UTF-8")
