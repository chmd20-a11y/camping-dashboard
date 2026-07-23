#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
채널 파악(enrichment) 1차 스캔 — 고캠핑 API에서 우리 143곳의 '예약 관련' 필드를
한 번에 뽑아, 각 캠핑장이 어디서 예약을 받는지 무료로 분류한다.
(웹검색으로 빈칸 채우기 전, 공짜로 얻는 1차 그림)

사용:  GOCAMPING_KEY="발급받은_일반인증키" python3 tools/enrich_channels.py
결과:  화면에 분포 출력 + tools/channels.json 저장
"""
import os, sys, re, json, urllib.request, urllib.parse
from collections import Counter

KEY = os.environ.get("GOCAMPING_KEY")
if not KEY:
    sys.exit("환경변수 GOCAMPING_KEY 가 필요합니다.\n예: GOCAMPING_KEY=\"키값\" python3 tools/enrich_channels.py")

HERE = os.path.dirname(__file__)

# 1) 우리 143곳 로드 (js/sites.js 안의 CC.SITES 배열)
src = open(os.path.join(HERE, "..", "js", "sites.js"), encoding="utf-8").read()
mine = json.loads(re.search(r"CC\.SITES\s*=\s*(\[.*?\]);", src, re.S).group(1))
myids = {s["id"]: s for s in mine}

# 2) 고캠핑 API 전체 목록 fetch
q = urllib.parse.urlencode({
    "serviceKey": KEY, "numOfRows": 4000, "pageNo": 1,
    "MobileOS": "ETC", "MobileApp": "CampCatch", "_type": "json",
})
with urllib.request.urlopen("https://apis.data.go.kr/B551011/GoCamping/basedList?" + q, timeout=60) as r:
    items = json.load(r)["response"]["body"]["items"]["item"]
api = {it.get("contentId"): it for it in items}

# 3) 예약 관련 필드가 실제로 뭐가 오는지 눈으로 확인 (첫 매칭 캠핑장)
sample = next((api[i] for i in myids if i in api), None)
if sample:
    res_fields = {k: v for k, v in sample.items()
                  if any(w in k.lower() for w in ["resve", "homepage", "tel", "booking", "manage"])}
    print("== [참고] 예약관련 필드 예시(첫 캠핑장) ==")
    print(json.dumps(res_fields, ensure_ascii=False, indent=1))
    print("\n== [참고] API가 주는 전체 필드명 ==")
    print(", ".join(sample.keys()))
    print()

def classify(it):
    ru = (it.get("resveUrl") or "").lower()
    hp = (it.get("homepage") or "").lower()
    cl = it.get("resveCl") or ""
    blob = ru + " " + hp
    if "camfit" in blob:                                   return "Camfit(잠김-읽기불가)"
    if "naver" in blob:                                    return "네이버예약(그레이)"
    if any(k in blob for k in ["foresttrip", "knps", "or.kr", "go.kr", "gwd", "휴양림"]):
                                                           return "공공(읽기가능)"
    if ru:                                                 return "자체/독립(읽기가능성)"
    if "전화" in cl and "실시간" not in cl:                  return "전화전용"
    if hp:                                                 return "홈피만(예약불명)"
    return "정보없음(전화추정)"

rows, cl_cnt, ch_cnt = [], Counter(), Counter()
for cid, site in myids.items():
    it = {**site, **api.get(cid, {})}   # API 값이 있으면 우선
    cl = it.get("resveCl") or ""
    cl_cnt[cl or "(빈값)"] += 1
    ch = classify(it)
    ch_cnt[ch] += 1
    rows.append({
        "id": cid, "name": site["name"], "region": site["region"],
        "resveCl": cl,
        "resveUrl": it.get("resveUrl") or "",
        "homepage": it.get("homepage") or "",
        "tel": it.get("tel") or "",
        "channel": ch,
    })

total = len(rows)
print(f"== resveCl(예약구분) 분포 — 총 {total}곳 ==")
for k, v in cl_cnt.most_common():
    print(f"  {v:3d}  {k}")
print("\n== 채널 버킷 (읽기가능=진짜 자리정보 얻을 후보) ==")
for k, v in ch_cnt.most_common():
    print(f"  {v:3d}  ({v*100//total:2d}%)  {k}")

json.dump(rows, open(os.path.join(HERE, "channels.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print(f"\n저장 완료: tools/channels.json  ({total}곳 — 다음 단계(빈칸 웹검색)에서 사용)")
