# ============================================================
# 08. 판별타당도 결과 검증 (보고서 03 대조 전용)
#   목적: 기존 05/05b 산출값의 (1) 자료·문항 일치, (2) 모형·추정법·
#   계산방식 확인, (3) 적합도 지수 일반/척도보정/강건값 혼용 점검.
#   새 모형 탐색·문항 변경 없음. m5(MLR) 1회 재적합으로 전수 대조.
# ============================================================
suppressMessages({library(haven); library(lavaan); library(semTools)})
d <- haven::read_sav("data_private/final.sav")
dd <- as.data.frame(lapply(d, as.numeric)); names(dd) <- names(d)

# ---- (1) 자료·문항 확인 ----
EL  <- paste0("리더십", 1:12); MW <- paste0("일의의미", c(1,2,4:10))
PO  <- paste0("주인의식", 1:9); POS <- paste0("조직지원", c(1:5,7,8))
IB  <- paste0("혁신행동", 1:9)
items46 <- c(EL, MW, PO, POS, IB)
cat("N =", nrow(dd), "| 문항 수 =", length(items46),
    "| 완전사례 =", sum(complete.cases(dd[items46])), "\n")
cat("제외 문항 포함 여부: 일의의미3 =", "일의의미3" %in% items46,
    "/ 조직지원6 =", "조직지원6" %in% items46, "\n")
cat("문항값 = 원자료 그대로(재역채점 없음): 리더십1 처음 5값 =",
    head(dd$리더십1, 5), "\n\n")

mk <- function(f, it) paste(f, "=~", paste(it, collapse=" + "))
m5 <- paste(mk("EL",EL), mk("MW",MW), mk("PO",PO), mk("POS",POS), mk("IB",IB), sep="\n")

# ---- (2) 5요인 MLR 재적합, 적합도 3종 전부 출력 ----
f5 <- cfa(m5, data=dd, estimator="MLR", std.lv=TRUE)
cat("수렴 =", lavInspect(f5,"converged"),
    "| 음의 분산 =", any(parameterEstimates(f5)$op=="~~" &
      parameterEstimates(f5)$lhs==parameterEstimates(f5)$rhs &
      parameterEstimates(f5)$est<0), "| 사용 N =", lavInspect(f5,"nobs"), "\n\n")

fm <- fitMeasures(f5, c("chisq","df","chisq.scaled","df.scaled",
  "cfi","cfi.scaled","cfi.robust","tli","tli.scaled","tli.robust",
  "rmsea","rmsea.scaled","rmsea.robust",
  "rmsea.ci.lower.robust","rmsea.ci.upper.robust","srmr"))
cat("=== 적합도 3종 대조 (일반 / 척도보정 / 강건) ===\n")
print(round(fm, 4))

# ---- (3) 잠재상관·AVE·CR: 계산방식 확인 + 수동 재계산 대조 ----
std <- standardizedSolution(f5)
lat <- lavInspect(f5, "cor.lv")
cat("\n잠재상관 (완전표준화 해):\n"); print(round(lat, 3))

# AVE 수동 재계산: 표준화 적재치 제곱의 평균 (semTools::AVE 정의와 대조)
ave_pkg <- semTools::AVE(f5)
ave_man <- sapply(c("EL","MW","PO","POS","IB"), function(f) {
  l <- std$est.std[std$op=="=~" & std$lhs==f]; mean(l^2) })
cr <- unlist(compRelSEM(f5, return.total=FALSE))
cat("\nAVE 대조 (semTools vs 수동계산 mean(std.loading^2)):\n")
print(round(rbind(semTools=as.numeric(ave_pkg), 수동=ave_man), 4))
cat("CR(omega):", round(cr,3), "\n")

# ---- (4) Fornell-Larcker + HTMT 재계산 대조 ----
cat("\n=== Fornell-Larcker: 대각=sqrt(AVE), 비대각=잠재상관 ===\n")
FL <- lat; diag(FL) <- sqrt(as.numeric(ave_pkg))
print(round(FL, 3))

ht_pear <- as.matrix(semTools::htmt(m5, data=dd))               # 기존 보고 방식
cat("\nHTMT (Pearson 상관 기반, semTools 기본 = 기존 보고값):\n")
print(round(ht_pear, 3))

# 기존 저장값과 대조
old_ht <- as.matrix(read.csv("output/tables/05_HTMT_구성개념.csv", row.names=1, fileEncoding="UTF-8"))
cat("\n기존 저장값과 최대 절대차 =", max(abs(ht_pear - old_ht), na.rm=TRUE), "\n")
old_lat <- read.csv("output/tables/05_5요인_잠재상관.csv", fileEncoding="UTF-8")
cat("기존 잠재상관 저장값 수 =", nrow(old_lat), "(10쌍이면 정상)\n")
