# ============================================================
# 01. 기술통계, Cronbach's alpha, 상관행렬 (재현)
# 자료: data_private/final.sav (N=318, 원본 변경 없음)
# ============================================================
suppressMessages({library(haven); library(psych)})
sessionInfo_file <- file("output/logs/01_sessioninfo.txt", "w")
writeLines(capture.output(sessionInfo()), sessionInfo_file); close(sessionInfo_file)

d <- haven::read_sav("data_private/final.sav")
stopifnot(nrow(d) == 318)

# ---- 최종 척도 문항 구성 (파일 합성점수 역산으로 확정) ----
items <- list(
  리더십   = paste0("리더십", 1:12),
  일의의미 = paste0("일의의미", c(1,2,4:10)),   # 3번 제외 (파일 합성점수 기준)
  주인의식 = paste0("주인의식", 1:9),
  조직지원 = paste0("조직지원", c(1:5,7,8)),    # 6번 제외 (파일 합성점수 기준)
  혁신행동 = paste0("혁신행동", 1:9)
)

# ---- Cronbach's alpha ----
alpha_tab <- data.frame(척도=character(), 문항수=integer(), N=integer(), alpha=numeric())
for (nm in names(items)) {
  a <- suppressWarnings(psych::alpha(d[items[[nm]]]))
  alpha_tab <- rbind(alpha_tab, data.frame(
    척도=nm, 문항수=length(items[[nm]]), N=nrow(d), alpha=round(a$total$raw_alpha, 3)))
}
write.csv(alpha_tab, "output/tables/01_신뢰도_alpha.csv", row.names=FALSE, fileEncoding="UTF-8")
print(alpha_tab)

# ---- 기술통계 + 상관 (합성점수: 파일에 저장된 값 그대로 사용) ----
comp <- c("리더십합계","일의의미합계","주인의식합계","조직지원합계","혁신행동합계")
desc <- data.frame(변수=comp,
                   M=round(sapply(d[comp], mean), 3),
                   SD=round(sapply(d[comp], sd), 3))
write.csv(desc, "output/tables/01_기술통계.csv", row.names=FALSE, fileEncoding="UTF-8")
print(desc)

ct <- psych::corr.test(as.data.frame(d[comp]), method="pearson")
r_mat <- round(ct$r, 3); p_mat <- round(ct$p, 4)
write.csv(r_mat, "output/tables/01_상관행렬_r.csv", fileEncoding="UTF-8")
write.csv(p_mat, "output/tables/01_상관행렬_p.csv", fileEncoding="UTF-8")
cat("\n상관행렬 r:\n"); print(r_mat)
cat("\n상관 p값(양측, 비보정):\n"); print(p_mat)
