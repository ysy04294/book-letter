/* =========================================================
   사진 업로드 프록시 (Vercel 서버리스 함수)

   브라우저에서 이미지 호스팅에 직접 올리면 CORS에 막히기 때문에
   서버를 한 번 경유한다. 사진은 catbox.moe에 올리고 짧은 URL만
   돌려줘서, 편지 링크에 사진 데이터가 통째로 들어가지 않도록 한다.

   요청: POST /api/upload  (본문 = 이미지 바이너리, Content-Type: image/*)
   응답: { url: "https://files.catbox.moe/xxxx.jpg" }
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

    const ext = contentType.includes("png") ? "png"
      : contentType.includes("webp") ? "webp"
      : "jpg";

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", new Blob([buf], { type: contentType }), `photo.${ext}`);

    const upstream = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: form,
      headers: {
        // 기본 UA로는 거부당하는 경우가 있어 일반 브라우저처럼 보낸다
        "User-Agent": "Mozilla/5.0 (compatible; book-letter/1.0)"
      }
    });

    const text = (await upstream.text()).trim();
    if (!upstream.ok || !/^https?:\/\//.test(text)) {
      res.status(502).json({
        error: "업로드에 실패했어요",
        upstreamStatus: upstream.status,
        upstreamBody: text.slice(0, 200)
      });
      return;
    }

    res.status(200).json({ url: text });
  } catch (e) {
    if (e && e.message === "too-large") {
      res.status(413).json({ error: "사진이 너무 커요" });
      return;
    }
    res.status(500).json({ error: "업로드 중 문제가 생겼어요" });
  }
}
