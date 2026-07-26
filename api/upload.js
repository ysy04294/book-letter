/* =========================================================
   사진 업로드 프록시 (Vercel 서버리스 함수)

   브라우저에서 이미지 호스팅에 직접 올리면 CORS에 막히고,
   키 없이 쓰는 익명 호스팅(catbox 등)은 서버 IP를 차단한다.
   그래서 정식 API(imgbb)를 서버에서 호출한다.

   설정: Vercel 프로젝트 환경변수에 IMGBB_API_KEY 추가
        (https://api.imgbb.com 에서 무료 발급)
   설정이 없으면 501을 돌려주고, 클라이언트가 알아서
   "링크에 직접 담기" 방식으로 대체한다.

   요청: POST /api/upload  (본문 = 이미지 바이너리, Content-Type: image/*)
   응답: { url: "https://i.ibb.co/xxxx/photo.jpg" }
   ========================================================= */

const MAX_BYTES = 4 * 1024 * 1024; // Vercel 요청 본문 한도(4.5MB) 안쪽으로

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error("too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 지원해요" });
    return;
  }

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    res.status(501).json({ error: "이미지 호스팅이 아직 설정되지 않았어요" });
    return;
  }

  try {
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.startsWith("image/")) {
      res.status(400).json({ error: "이미지가 아니에요" });
      return;
    }

    const buf = await readBody(req);
    if (!buf.length) {
      res.status(400).json({ error: "빈 파일이에요" });
      return;
    }

    const body = new URLSearchParams();
    body.set("key", apiKey);
    body.set("image", buf.toString("base64"));

    const upstream = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const json = await upstream.json().catch(() => null);
    const url = json && json.data && (json.data.url || json.data.display_url);

    if (!upstream.ok || !url) {
      res.status(502).json({
        error: "업로드에 실패했어요",
        upstreamStatus: upstream.status,
        upstreamBody: JSON.stringify(json).slice(0, 200)
      });
      return;
    }

    res.status(200).json({ url });
  } catch (e) {
    if (e && e.message === "too-large") {
      res.status(413).json({ error: "사진이 너무 커요" });
      return;
    }
    res.status(500).json({ error: "업로드 중 문제가 생겼어요" });
  }
}
