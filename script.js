/* =========================================================
   독후감 답장 편지 — 공용 스크립트
   ========================================================= */
(function(){
  "use strict";

  /* ---------------------------------------------------------
     iOS Safari의 100svh 계산 버그 대응
     — 주소창/하단 툴바가 움직일 때 svh가 즉시 맞게 갱신되지 않아
       화면 아래쪽(날짜 스탬프 등)이 브라우저 UI에 가려지는 경우가 있다.
       실제 보이는 높이(innerHeight)를 재서 CSS 변수로 직접 넘겨준다.
  --------------------------------------------------------- */
  function setViewportHeightVar(){
    document.documentElement.style.setProperty("--vh", window.innerHeight + "px");
  }
  setViewportHeightVar();
  window.addEventListener("resize", setViewportHeightVar);
  window.addEventListener("orientationchange", setViewportHeightVar);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", setViewportHeightVar);
  }

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

  function loadImageEl(file){
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(objUrl); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error("이미지를 읽을 수 없어요")); };
      img.src = objUrl;
    });
  }

  function drawToDataUri(img, dim, quality){
    const w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, dim / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }

  // 업로드가 안 될 때의 최후 수단: 목표 글자수(budget) 아래로 내려갈 때까지
  // 품질 → 해상도를 단계적으로 낮춰서 리사이즈/압축한다.
  // (실사 사진은 단색 테스트 이미지보다 훨씬 안 압축되기 때문에 한 번에 맞는
  //  크기를 예측하기 어려워서, 결과를 직접 재보고 줄여나가는 방식으로 처리)
  async function fileToDataUri(file, maxDim, quality, budget){
    const img = await loadImageEl(file);
    let dim = maxDim;
    let q = quality;
    let uri = drawToDataUri(img, dim, q);

    for (let i = 0; i < 8 && uri.length > budget; i++) {
      if (q > 0.35) {
        q = Math.max(0.35, q - 0.12);
      } else {
        dim = Math.round(dim * 0.75);
      }
      if (dim < 80) break;
      uri = drawToDataUri(img, dim, q);
    }
    return { uri, oversized: uri.length > budget };
  }

  // 보관함에서 고른 파일을 짧은 URL로 변환 (업로드 우선, 실패 시 초소형 data URI)
  async function pickedFileToUrl(file, maxDim, quality, budget){
    const hosted = await uploadImage(file);
    if (hosted) return { url: hosted, embedded: false, oversized: false };
    const { uri, oversized } = await fileToDataUri(file, maxDim, quality, budget || 4000);
    return { url: uri, embedded: true, oversized };
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
