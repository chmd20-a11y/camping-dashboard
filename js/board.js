/* ============================================================
   캠핑캐치 — board.js
   개발 요청 게시판 (Supabase REST + Auth, 순수 fetch · SDK 없음)

   - 누구나: 요청 작성 · 읽기 · 댓글 (로그인 불필요)
   - 관리자(로그인): 상태 변경(요청→진행중→완료) · 관리자 댓글
   - 설정(js/board-config.js)이 비어 있으면 버튼이 숨겨져 아무 영향 없음
   ============================================================ */
window.CC = window.CC || {};

(function (CC) {
  "use strict";

  var SB = CC.SB || { url: "", anon: "" };
  var TOKEN_KEY = "cc_admin_token";
  var NICK_KEY = "cc_board_nick";
  var STATUSES = ["요청", "진행중", "완료"];

  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY) || null; } catch (e) {}
  function configured() { return !!(SB.url && SB.anon); }
  function isAdmin() { return !!token; }

  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function nl2br(t) { return esc(t).replace(/\n/g, "<br>"); }
  function nick() { try { return localStorage.getItem(NICK_KEY) || ""; } catch (e) { return ""; } }
  function setNick(v) { try { localStorage.setItem(NICK_KEY, v || ""); } catch (e) {} }
  function fmtDate(s) {
    var d = new Date(s), n = new Date();
    var diff = Math.round((n - d) / 86400000);
    if (diff <= 0) return "오늘";
    if (diff === 1) return "어제";
    if (diff < 7) return diff + "일 전";
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  /* ---------- Supabase REST ---------- */
  function authHeader(admin) { return "Bearer " + (admin && token ? token : SB.anon); }
  function rest(path, opts) {
    opts = opts || {};
    var h = { "apikey": SB.anon, "Authorization": authHeader(opts.admin), "Content-Type": "application/json" };
    if (opts.prefer) h["Prefer"] = opts.prefer;
    return fetch(SB.url + "/rest/v1/" + path, {
      method: opts.method || "GET", headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 401 && opts.admin) { logout(); throw new Error("관리자 인증이 만료됐어요. 다시 로그인해 주세요."); }
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("HTTP " + r.status)); });
      return r.status === 204 ? null : r.json();
    });
  }
  function listRequests() { return rest("requests?select=*,comments(count)&order=created_at.desc"); }
  function addRequest(author, title, body) {
    return rest("requests", { method: "POST", prefer: "return=representation", body: { author: author || "익명", title: title, body: body || "" } });
  }
  function listComments(rid) { return rest("comments?request_id=eq." + rid + "&order=created_at.asc&select=*"); }
  function addComment(rid, author, body) {
    return rest("comments", { method: "POST", prefer: "return=representation", admin: isAdmin(), body: { request_id: rid, author: author || "익명", body: body } });
  }
  function setStatus(rid, status) {
    return rest("requests?id=eq." + rid, { method: "PATCH", admin: true, prefer: "return=representation", body: { status: status } });
  }
  function login(email, password) {
    return fetch(SB.url + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { "apikey": SB.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error_description || j.msg || j.error || "로그인 실패");
        token = j.access_token; try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
        return j;
      });
    });
  }
  function logout() { token = null; try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  /* ---------- 상태 ---------- */
  var items = [];        // 요청 목록
  var openId = null;     // 펼친 요청 id
  var commentsCache = {};// { rid: [comments] }
  var boardShown = false;// 게시판 열림 여부(뒤로가기 닫기용)

  /* ---------- 렌더 ---------- */
  function statusPill(s) { return '<span class="bd-status s' + STATUSES.indexOf(s) + '">' + esc(s) + '</span>'; }
  function commentCount(r) { return (r.comments && r.comments[0] && r.comments[0].count) || 0; }

  function renderBody() {
    var b = $("boardBody");
    var admin = isAdmin();
    var html =
      '<div class="bd-intro">필요한 기능·개선 요청을 남겨 주세요. 처리 상태와 답변을 함께 확인할 수 있어요.' +
        (admin ? ' <span class="bd-adminon">· 관리자 모드</span>' : '') + '</div>' +
      '<form class="bd-new" id="bdNew">' +
        '<div class="bd-row"><input class="bd-inp" id="bdNick" placeholder="닉네임(선택)" value="' + esc(nick()) + '" maxlength="20">' +
        '<input class="bd-inp grow" id="bdTitle" placeholder="요청 제목" maxlength="80" required></div>' +
        '<textarea class="bd-inp" id="bdBody" placeholder="내용을 적어 주세요 (원하는 기능, 불편한 점 등)" rows="2" maxlength="1000"></textarea>' +
        '<button class="bd-submit" type="submit">요청 등록</button>' +
      '</form>' +
      '<div class="bd-list" id="bdList"></div>';
    b.innerHTML = html;
    $("bdNew").addEventListener("submit", onNew);
    renderList();
  }

  function renderList() {
    var el = $("bdList"); if (!el) return;
    if (!items.length) { el.innerHTML = '<div class="bd-empty">아직 등록된 요청이 없어요. 첫 요청을 남겨 보세요!</div>'; return; }
    el.innerHTML = items.map(itemHtml).join("");
    Array.prototype.forEach.call(el.querySelectorAll(".bd-item"), function (node) {
      var rid = +node.getAttribute("data-id");
      node.querySelector(".bd-item-head").addEventListener("click", function () { toggle(rid); });
      Array.prototype.forEach.call(node.querySelectorAll("[data-status]"), function (btn) {
        btn.addEventListener("click", function (e) { e.stopPropagation(); onStatus(rid, btn.getAttribute("data-status")); });
      });
      var cf = node.querySelector(".bd-cform");
      if (cf) cf.addEventListener("submit", function (e) { onComment(e, rid); });
    });
  }

  function itemHtml(r) {
    var admin = isAdmin();
    var open = openId === r.id;
    var cs = commentsCache[r.id];
    var adminCtl = admin ? '<div class="bd-admin-ctl">' + STATUSES.map(function (s) {
      return '<button class="bd-sbtn' + (r.status === s ? ' on' : '') + '" data-status="' + s + '">' + s + '</button>';
    }).join("") + '</div>' : '';
    var comments = open ? (cs
      ? (cs.length ? cs.map(commentHtml).join("") : '<div class="bd-nocmt">아직 댓글이 없어요.</div>')
      : '<div class="bd-nocmt">불러오는 중…</div>') : "";
    return '<div class="bd-item' + (r.status === "완료" ? " done" : "") + '" data-id="' + r.id + '">' +
      '<div class="bd-item-head">' +
        statusPill(r.status) +
        '<div class="bd-item-main"><div class="bd-title">' + esc(r.title) + '</div>' +
        '<div class="bd-meta">' + esc(r.author || "익명") + ' · ' + fmtDate(r.created_at) +
        ' · 💬 ' + commentCount(r) + '</div></div>' +
        '<span class="bd-caret">' + (open ? "▲" : "▼") + '</span>' +
      '</div>' +
      (open ?
        '<div class="bd-item-body">' +
          (r.body ? '<div class="bd-text">' + nl2br(r.body) + '</div>' : '') +
          adminCtl +
          '<div class="bd-comments">' + comments + '</div>' +
          '<form class="bd-cform">' +
            '<input class="bd-inp" name="cnick" placeholder="닉네임(선택)" value="' + esc(nick()) + '" maxlength="20">' +
            '<div class="bd-row"><input class="bd-inp grow" name="cbody" placeholder="답글 남기기" maxlength="1000" required>' +
            '<button class="bd-submit sm" type="submit">등록</button></div>' +
          '</form>' +
        '</div>'
      : "") +
    '</div>';
  }

  function commentHtml(c) {
    return '<div class="bd-cmt' + (c.is_admin ? " admin" : "") + '">' +
      '<div class="bd-cmt-top">' + (c.is_admin ? '<span class="bd-tag">관리자</span>' : '') +
      '<b>' + esc(c.author || "익명") + '</b><span class="bd-cmt-date">' + fmtDate(c.created_at) + '</span></div>' +
      '<div class="bd-cmt-body">' + nl2br(c.body) + '</div></div>';
  }

  /* ---------- 이벤트 ---------- */
  function refresh() { return listRequests().then(function (rows) { items = rows || []; renderList(); }); }

  function onNew(e) {
    e.preventDefault();
    var t = $("bdTitle").value.trim(); if (!t) return;
    var nk = $("bdNick").value.trim(); setNick(nk);
    var body = $("bdBody").value.trim();
    var btn = e.target.querySelector(".bd-submit"); btn.disabled = true; btn.textContent = "등록 중…";
    addRequest(nk, t, body).then(function () {
      $("bdTitle").value = ""; $("bdBody").value = "";
      return refresh();
    }).then(function () { toast("요청을 등록했어요"); }).catch(function (err) { toast("등록 실패: " + err.message); })
      .then(function () { btn.disabled = false; btn.textContent = "요청 등록"; });
  }

  function toggle(rid) {
    if (openId === rid) { openId = null; renderList(); return; }
    openId = rid; renderList();
    if (!commentsCache[rid]) {
      listComments(rid).then(function (rows) { commentsCache[rid] = rows || []; if (openId === rid) renderList(); })
        .catch(function () { commentsCache[rid] = []; if (openId === rid) renderList(); });
    }
  }

  function onComment(e, rid) {
    e.preventDefault();
    var f = e.target, body = f.cbody.value.trim(); if (!body) return;
    var nk = f.cnick.value.trim(); setNick(nk);
    var btn = f.querySelector(".bd-submit"); btn.disabled = true;
    addComment(rid, nk, body).then(function () {
      return listComments(rid).then(function (rows) { commentsCache[rid] = rows || []; });
    }).then(function () { return refresh(); }).then(function () { toast("답글을 남겼어요"); })
      .catch(function (err) { toast("실패: " + err.message); btn.disabled = false; });
  }

  function onStatus(rid, status) {
    setStatus(rid, status).then(function () {
      var it = items.filter(function (x) { return x.id === rid; })[0]; if (it) it.status = status;
      renderList(); toast("상태를 '" + status + "'(으)로 변경했어요");
    }).catch(function (err) { toast("변경 실패: " + err.message); });
  }

  /* ---------- 관리자 로그인 ---------- */
  function adminPrompt() {
    if (isAdmin()) {
      logout(); renderBody(); refresh(); syncAdminBtn(); toast("관리자 로그아웃");
      return;
    }
    var email = window.prompt("관리자 이메일"); if (!email) return;
    var pw = window.prompt("비밀번호"); if (!pw) return;
    login(email.trim(), pw).then(function () {
      renderBody(); refresh(); syncAdminBtn(); toast("관리자로 로그인했어요");
    }).catch(function (err) { toast("로그인 실패: " + err.message); });
  }
  function syncAdminBtn() {
    var b = $("boardAdminBtn"); if (!b) return;
    b.textContent = isAdmin() ? "관리자 로그아웃" : "관리자";
    b.classList.toggle("on", isAdmin());
  }

  /* ---------- 열기/닫기 ---------- */
  function open() {
    $("board").hidden = false;
    requestAnimationFrame(function () { $("board").classList.add("show"); $("boardBackdrop").classList.add("show"); });
    document.body.style.overflow = "hidden";
    renderBody(); syncAdminBtn();
    refresh().catch(function (err) { $("bdList").innerHTML = '<div class="bd-empty">불러오지 못했어요: ' + esc(err.message) + '</div>'; });
    if (!boardShown) { boardShown = true; history.pushState({ cc: "board" }, ""); }  // 뒤로가기로 닫기
  }
  function close(fromPop) {
    if (!boardShown) return;
    boardShown = false;
    $("board").classList.remove("show"); $("boardBackdrop").classList.remove("show");
    document.body.style.overflow = "";
    setTimeout(function () { $("board").hidden = true; }, 220);
    if (fromPop !== true) history.back();
  }

  function toast(msg) {
    var t = $("toast"); if (!t) { return; }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------- 초기화 ---------- */
  function init() {
    var btn = $("openBoard");
    if (!configured()) { if (btn) btn.hidden = true; return; }   // 미설정 시 버튼 숨김
    if (btn) { btn.hidden = false; btn.addEventListener("click", open); }
    $("boardClose").addEventListener("click", close);
    $("boardBackdrop").addEventListener("click", close);
    $("boardAdminBtn").addEventListener("click", adminPrompt);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("board").hidden) close(); });
    window.addEventListener("popstate", function () { if (boardShown) close(true); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.CC);
