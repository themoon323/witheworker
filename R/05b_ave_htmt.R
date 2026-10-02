# ============================================================
# 05b. AVE, Fornell-Larcker, HTMT (05 후반부 재실행; 출력버그 수정)
# ============================================================
suppressMessages({library(haven); library(lavaan); library(semTools)})
d <- haven::read_sav("data_private/final.sav")
dd <- as.data.frame(lapply(d, as.numeric)); names(dd) <- names(d)
EL  <- paste0("리더십", 1:12); MW <- paste0("일의의미", c(1,2,4:10))
PO  <- paste0("주인의식", 1:9); POS <- paste0("조직지원", c(1:5,7,8))
IB  <- paste0("혁신행동", 1:9)
mk <- function(f, it) paste(f, "=~", paste(it, collapse=" + "))
m5 <- paste(mk("EL",EL), mk("MW",MW), mk("PO",PO), mk("POS",POS), mk("IB",IB), sep="\n")
m10 <- paste(mk("EL직무",EL[1:3]), mk("EL의사",EL[4:6]), mk("EL자율",EL[7:9]),
  mk("EL성과",EL[10:12]), mk("MW",MW), mk("PO책임",PO[1:3]), mk("PO소속",PO[4:9]),
  mk("POS",POS), mk("IB창출",IB[1:3]), mk("IB전파구현",IB[4:9]), sep="\n")

f5 <- cfa(m5, data=dd, estimator="MLR", std.lv=TRUE)
f10 <- cfa(m10, data=dd, estimator="MLR", std.lv=TRUE)

ave5 <- semTools::AVE(f5); cr5 <- unlist(compRelSEM(f5, return.total=FALSE))
cat("구성개념 수준 CR / AVE / sqrt(AVE):\n")
tab5 <- data.frame(요인=names(ave5), CR=round(cr5,3), AVE=round(as.numeric(ave5),3),
                   sqrtAVE=round(sqrt(as.numeric(ave5)),3))
print(tab5, row.names=FALSE)
write.csv(tab5, "output/tables/05_CR_AVE_구성개념.csv", row.names=FALSE, fileEncoding="UTF-8")

lat <- lavInspect(f5, "cor.lv")
cat("\nFornell-Larcker 위반 쌍 (잠재상관 > sqrt(AVE) 중 하나라도):\n")
viol <- data.frame()
for (i in 1:4) for (j in (i+1):5) {
  r <- lat[i,j]
  if (abs(r) > min(sqrt(ave5[i]), sqrt(ave5[j])))
    viol <- rbind(viol, data.frame(쌍=paste(rownames(lat)[i], colnames(lat)[j], sep="-"),
      잠재상관=round(r,3), sqrtAVE_i=round(sqrt(ave5[i]),3), sqrtAVE_j=round(sqrt(ave5[j]),3)))
}
if (nrow(viol)) print(viol, row.names=FALSE) else cat("없음\n")
write.csv(viol, "output/tables/05_FornellLarcker_위반.csv", row.names=FALSE, fileEncoding="UTF-8")

ave10 <- semTools::AVE(f10); cr10 <- unlist(compRelSEM(f10, return.total=FALSE))
tab10 <- data.frame(요인=names(ave10), CR=round(cr10,3), AVE=round(as.numeric(ave10),3),
                    sqrtAVE=round(sqrt(as.numeric(ave10)),3))
cat("\n하위차원 수준(10요인) CR/AVE:\n"); print(tab10, row.names=FALSE)
write.csv(tab10, "output/tables/05_CR_AVE_하위차원.csv", row.names=FALSE, fileEncoding="UTF-8")
lat10 <- lavInspect(f10, "cor.lv")
write.csv(round(lat10,3), "output/tables/05_10요인_잠재상관.csv", fileEncoding="UTF-8")
cat("\n10요인 잠재상관 .85 이상 쌍:\n")
hi <- data.frame()
for (i in 1:9) for (j in (i+1):10) if (abs(lat10[i,j])>=.85)
  hi <- rbind(hi, data.frame(쌍=paste(rownames(lat10)[i],colnames(lat10)[j],sep="-"), r=round(lat10[i,j],3)))
if (nrow(hi)) print(hi, row.names=FALSE) else cat("없음\n")

# ---- HTMT 구성개념 수준 + 부트스트랩 CI ----
set.seed(20260102)
ht <- as.matrix(semTools::htmt(m5, data=dd))
cat("\nHTMT (구성개념 수준):\n"); print(round(ht,3))
write.csv(round(ht,3), "output/tables/05_HTMT_구성개념.csv", fileEncoding="UTF-8")
NB <- 1000
pi_ <- which(lower.tri(ht), arr.ind=TRUE)
bm <- matrix(NA, NB, nrow(pi_))
for (b in 1:NB) {
  db <- dd[sample(nrow(dd), replace=TRUE), ]
  hb <- tryCatch(as.matrix(semTools::htmt(m5, data=db)), error=function(e) NULL)
  if (!is.null(hb)) bm[b,] <- hb[pi_]
}
ci <- data.frame(쌍=paste(rownames(ht)[pi_[,1]], colnames(ht)[pi_[,2]], sep="-"),
  HTMT=round(ht[pi_],3),
  CI하한=round(apply(bm,2,quantile,.025,na.rm=TRUE),3),
  CI상한=round(apply(bm,2,quantile,.975,na.rm=TRUE),3),
  실패반복=sum(is.na(bm[,1])))
cat("\nHTMT 부트스트랩 95% CI (", NB, "회, seed=20260102):\n")
print(ci, row.names=FALSE)
write.csv(ci, "output/tables/05_HTMT_부트스트랩CI.csv", row.names=FALSE, fileEncoding="UTF-8")

# HTMT 하위차원 수준 (POS와 각 하위차원)
ht10 <- as.matrix(semTools::htmt(m10, data=dd))
write.csv(round(ht10,3), "output/tables/05_HTMT_하위차원.csv", fileEncoding="UTF-8")
cat("\nHTMT(하위차원 수준) POS 행:\n"); print(round(ht10["POS",],3))
