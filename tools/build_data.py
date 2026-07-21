#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
캠핑캐치 데이터 빌더 — 고캠핑(한국관광공사) 공개 API → js/sites.js 생성

- 김포 집 기준 3시간 이내 · 자동차야영장(오토캠핑)만 추림
- 좌표로 예상 이동시간 계산, 테마환경/시설을 태그로 매핑
- API 키는 환경변수 GOCAMPING_KEY 로만 받음 (저장소에 커밋하지 않음)

사용:
    GOCAMPING_KEY="발급받은_일반인증키" python3 tools/build_data.py
"""
import os, sys, json, math, urllib.request, urllib.parse

KEY = os.environ.get("GOCAMPING_KEY")
if not KEY:
    sys.exit("환경변수 GOCAMPING_KEY 가 필요합니다. 예: GOCAMPING_KEY=... python3 tools/build_data.py")

HOME = (37.6435, 126.6206)   # 김포한강5로 인근(집 기준점)
MAX_MIN = 180                # 3시간 이내
ROAD_FACTOR = 1.35           # 직선거리 → 도로거리 보정
AVG_KMH = 60                 # 평균 주행속도(예상 시간용)

# 대상 지역: 경기 파주/연천/포천 + 강원 전역
GG_TARGET = {"파주시", "연천군", "포천시"}

# 테마환경(themaEnvrnCl) → 계절/특성 태그
THEMA = {
    "여름물놀이": "물놀이", "봄꽃여행": "벚꽃", "가을단풍명소": "단풍",
    "겨울눈꽃명소": "눈", "일몰명소": "조망", "걷기길": "산책",
}
# 입지(lctCl) → 태그
LCT = {"계곡": "계곡", "숲": "숲", "호수": "호수", "섬": "섬", "산": "산", "해변": "바다", "도심": "도심"}
# 부대/주변시설 키워드 → 태그
FACIL = ["전기", "온수", "마트", "편의점", "무선인터넷", "물놀이장", "놀이터", "계곡", "낚시", "수영장", "샤워장", "개수대"]


def haversine(a, b):
    R = 6371.0
    dlat = math.radians(b[0] - a[0]); dlon = math.radians(b[1] - a[1])
    x = math.sin(dlat/2)**2 + math.cos(math.radians(a[0]))*math.cos(math.radians(b[0]))*math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(x))


def fetch():
    q = urllib.parse.urlencode({
        "serviceKey": KEY, "numOfRows": 4000, "pageNo": 1,
        "MobileOS": "ETC", "MobileApp": "CampCatch", "_type": "json",
    })
    url = "https://apis.data.go.kr/B551011/GoCamping/basedList?" + q
    with urllib.request.urlopen(url, timeout=60) as r:
        data = json.load(r)
    return data["response"]["body"]["items"]["item"]


def group_of(do, sg):
    if "강원" in do: return "강원"
    if "파주" in sg: return "파주"
    if "연천" in sg: return "연천"
    if "포천" in sg: return "포천"
    return None


def tags_of(it):
    t = []
    def add(x):
        if x and x not in t: t.append(x)
    for k in (it.get("themaEnvrnCl") or "").split(","):
        add(THEMA.get(k.strip()))
    lct = it.get("lctCl") or ""
    for w, tag in LCT.items():
        if w in lct: add(tag)
    blob = " ".join([it.get("sbrsCl") or "", it.get("sbrsEtc") or "",
                     it.get("posblFcltyCl") or "", it.get("posblFcltyEtc") or ""])
    for w in FACIL:
        if w in blob: add(w)
    if (it.get("brazierCl") or "").strip():
        add("불멍")
    return t


def region_disp(do, sg):
    return ("강원 " + sg) if "강원" in do else sg


def main():
    items = fetch()
    seen, out = set(), []
    for it in items:
        do = it.get("doNm") or ""; sg = it.get("sigunguNm") or ""
        induty = it.get("induty") or ""
        auto_raw = (it.get("autoSiteCo") or "0").strip() or "0"
        try: auto = int(float(auto_raw))
        except: auto = 0
        is_auto = ("자동차야영장" in induty) or auto > 0
        if not is_auto:
            continue
        if not ((("경기" in do) and sg in GG_TARGET) or ("강원" in do)):
            continue
        try:
            lat = float(it["mapY"]); lng = float(it["mapX"])
        except (TypeError, ValueError, KeyError):
            continue
        km = haversine(HOME, (lat, lng))
        drive = round(km * ROAD_FACTOR / AVG_KMH * 60)
        if drive > MAX_MIN:
            continue
        cid = it.get("contentId")
        if cid in seen:
            continue
        seen.add(cid)
        img = (it.get("firstImageUrl") or "").replace("http://", "https://")
        intro = (it.get("lineIntro") or it.get("intro") or "").strip().replace("\n", " ")
        if len(intro) > 70:
            intro = intro[:70] + "…"
        out.append({
            "id": cid,
            "name": it.get("facltNm") or "",
            "region": region_disp(do, sg),
            "group": group_of(do, sg),
            "addr": it.get("addr1") or "",
            "lat": round(lat, 6), "lng": round(lng, 6),
            "drive": drive,
            "autoSite": auto,
            "tags": tags_of(it),
            "resveUrl": it.get("resveUrl") or "",
            "homepage": it.get("homepage") or "",
            "tel": it.get("tel") or "",
            "img": img,
            "intro": intro,
        })

    out.sort(key=lambda s: s["drive"])
    header = (
        "/* ============================================================\n"
        "   캠핑캐치 — sites.js  (자동 생성 · 직접 수정 금지)\n"
        "   출처: 고캠핑(한국관광공사) 공개 API · 이용허락범위 제한 없음\n"
        "   생성: tools/build_data.py  (GOCAMPING_KEY 필요)\n"
        f"   김포 3시간 이내 · 자동차야영장 · {len(out)}곳\n"
        "   ※ 가격·실시간 자리·후기는 API 미제공 → 예약처에서 확인\n"
        "   ============================================================ */\n"
    )
    body = "window.CC = window.CC || {};\n(function (CC) {\n  \"use strict\";\n  CC.SITES = " \
           + json.dumps(out, ensure_ascii=False, separators=(",", ":")) \
           + ";\n})(window.CC);\n"
    dst = os.path.join(os.path.dirname(__file__), "..", "js", "sites.js")
    with open(dst, "w", encoding="utf-8") as f:
        f.write(header + body)
    print(f"생성 완료: js/sites.js · {len(out)}곳")
    withres = sum(1 for s in out if s["resveUrl"])
    withimg = sum(1 for s in out if s["img"])
    print(f"예약URL {withres}곳 · 사진 {withimg}곳")


if __name__ == "__main__":
    main()
