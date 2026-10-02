# ============================================================
# 06. 공통방법편의 보조 진단 (Harman 단일요인)
#   - 최종 분석 문항 46개 (통제변수 제외):
#     리더십 12 + 일의의미 9 + 주인의식 9 + 조직지원 7 + 혁신행동 9
#   - 방식 명시: Pearson 상관행렬, 무회전
#     (a) 주성분분석 PCA 첫 성분 설명분산
#     (b) 주축요인법 PAF 단일요인 설명분산
#   - 단일요인 CFA와 측정모형 비교는 05 스크립트의 결과 사용
#   - 이 진단은 공통방법편의의 부재를 입증하지 않음 (보조 자료)
# ============================================================
suppressMessages({library(haven); library(psych)})
d <- haven::read_sav("data_private/final.sav")
items <- c(paste0("리더십",1:12), paste0("일의의미",c(1,2,4:10)),
           paste0("주인의식",1:9), paste0("조직지원",c(1:5,7,8)), paste0("혁신행동",1:9))
X <- as.data.frame(lapply(d[items], as.numeric))
cat("문항 수:", ncol(X), "/ N =", nrow(X), "\n\n")

R <- cor(X, method="pearson")
# (a) PCA 무회전: 첫 성분
eig <- eigen(R)$values
cat("PCA(무회전, Pearson 상관): 첫 성분 설명분산 =",
    round(100*eig[1]/length(eig),2), "% (고유값", round(eig[1],3), ")\n")
cat("고유값>1 성분 수:", sum(eig>1), "\n")
# (b) PAF 단일요인
pa <- psych::fa(R, nfactors=1, fm="pa", rotate="none", n.obs=nrow(X))
cat("PAF(단일요인, 무회전): 설명분산 =", round(100*pa$Vaccounted[2,1],2), "%\n")

res <- data.frame(
  방법=c("PCA 무회전 첫 성분","PAF 단일요인 무회전"),
  상관행렬="Pearson", 문항수=ncol(X), N=nrow(X),
  설명분산_pct=round(c(100*eig[1]/length(eig), 100*pa$Vaccounted[2,1]),2))
write.csv(res, "output/tables/06_Harman.csv", row.names=FALSE, fileEncoding="UTF-8")
print(res, row.names=FALSE)
cat("\n주의: 이 결과는 보조 진단이며, 특정 비율 기준 통과·미달을 근거로\n공통방법편의의 존재·부재를 결론 내릴 수 없음.\n")
