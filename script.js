/* =========================================================
   독후감 답장 편지 — 공용 스크립트
   ========================================================= */
(function(){
  "use strict";

  /* ---------------------------------------------------------
     링크 payload: JSON <-> lz-string
  --------------------------------------------------------- */
  const Payload = {
    encode(data){
      return LZString.compressToEncodedURIComponent(JSON.stringify(data));
    },
    decode(hash){
      if (!hash) return null;
      try {
        const json = LZString.decompressFromEncodedURIComponent(hash);
        if (!json) return null;
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }
  };

  /* ---------------------------------------------------------
     카카오 책 검색 API — 책 표지 자동 로드
  --------------------------------------------------------- */
  const KAKAO_REST_API_KEY = "YOUR_KAKAO_REST_API_KEY"; // TODO: 실제 REST API 키로 교체

  function norm(s){
    return (s || "").replace(/\s/g, "").toLowerCase();
  }

  async function fetchBookCover(title, author){
    if (!title || !KAKAO_REST_API_KEY || KAKAO_REST_API_KEY.indexOf("YOUR_") === 0) return null;
    try {
      const url = `https://dapi.kakao.com/v3/search/book?query=${encodeURIComponent(title)}`;
      const res = await fetch(url, {
        headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      const docs = data.documents || [];
      if (!docs.length) return null;
      let match = docs[0];
      if (author) {
        const target = norm(author);
        const found = docs.find((d) =>
          (d.authors || []).some((a) => {
            const na = norm(a);
            return na && (na.includes(target) || target.includes(na));
          })
        );
        if (found) match = found;
      }
      return match.thumbnail || null;
    } catch (e) {
      return null;
    }
  }

  /* ---------------------------------------------------------
     공용 렌더 헬퍼
  --------------------------------------------------------- */
  function fillLetter({ toEl, bodyEl, to, message }){
    if (toEl) toEl.textContent = `to. ${to || "***"}에게`;
    if (bodyEl) bodyEl.textContent = message || "";
  }

  function fillBadge({ titleEl, authorEl, bookTitle, author }){
    if (titleEl) titleEl.textContent = bookTitle || "";
    if (authorEl) authorEl.textContent = author ? `저자/${author}` : "";
  }

  function fillPolaroid({ photoEl, captionEl, photoUrl, caption }){
    if (photoEl) {
      photoEl.style.backgroundImage = photoUrl ? `url("${photoUrl}")` : "none";
      photoEl.style.backgroundColor = photoUrl ? "transparent" : "#cfd6da";
    }
    if (captionEl) captionEl.textContent = caption || "";
  }

  function formatStamp(date){
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  window.LetterApp = {
    Payload,
    fetchBookCover,
    fillLetter,
    fillBadge,
    fillPolaroid,
    formatStamp
  };
})();
