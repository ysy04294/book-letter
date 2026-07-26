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
     사진 보관함에서 고른 이미지 업로드
     — 링크에 사진을 그대로 박아넣으면(base64) 링크가 너무 길어져서
       카카오톡 등 메신저에서 잘려버린다. 그래서 익명 이미지 호스팅에
       올리고 짧은 URL만 링크에 담는다. 클라이언트 ID가 없거나 업로드가
       실패하면 마지막 수단으로만 base64를 아주 작게 압축해서 사용한다.
  --------------------------------------------------------- */
  const IMGUR_CLIENT_ID = "YOUR_IMGUR_CLIENT_ID"; // TODO: https://api.imgur.com/oauth2/addclient 에서 발급 (무료, 계정 로그인 불필요한 "익명" 앱)

  async function uploadImage(file){
    if (!IMGUR_CLIENT_ID || IMGUR_CLIENT_ID.indexOf("YOUR_") === 0) return null;
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
        body: form
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json && json.data && json.data.link) || null;
    } catch (e) {
      return null;
    }
  }

  // 업로드가 안 될 때의 최후 수단: 아주 작게 리사이즈/압축한 JPEG data URI
  function fileToDataUri(file, maxDim, quality){
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(objUrl);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error("이미지를 읽을 수 없어요")); };
      img.src = objUrl;
    });
  }

  // 보관함에서 고른 파일을 짧은 URL로 변환 (업로드 우선, 실패 시 초소형 data URI)
  async function pickedFileToUrl(file, maxDim, quality){
    const hosted = await uploadImage(file);
    if (hosted) return { url: hosted, embedded: false };
    const dataUri = await fileToDataUri(file, maxDim, quality);
    return { url: dataUri, embedded: true };
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
    pickedFileToUrl,
    fillLetter,
    fillBadge,
    fillPolaroid,
    formatStamp
  };
})();
