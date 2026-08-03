/* =========================================================
   사진 읽기 프록시 (Vercel 서버리스 함수)

   Blob 저장소가 Private 이면 사진 URL을 그대로 열 수 없다.
   (받는 사람 브라우저에는 토큰이 없으니 403이 난다.)
   그래서 서버가 토큰으로 대신 읽어서 내려준다.

   요청: GET /api/photo?u=<blob URL>
   응답: 이미지 바이너리

   u 파라미터는 링크에 실려 오는 값이라 그대로 믿으면 안 된다.
   Vercel Blob 도메인만 허용해서 서버가 임의 주소를 대신 호출하는
   일(SSRF)이 없도록 막는다.
   ========================================================= */

function findBlobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const value of Object.values(process.env)) {
    if (typeof value === "string" && value.startsWith("vercel_blob_rw_")) return value;
  }
  return null;
}

function isAllowedBlobUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "blob.vercel-storage.com" || host.endsWith(".blob.vercel-storage.com");
}

export default async function handler(req, res) {
  const raw = req.query && req.query.u;
  const target = Array.isArray(raw) ? raw[0] : raw;

  if (!target || !isAllowedBlobUrl(target)) {
    res.status(400).json({ error: "잘못된 사진 주소예요" });
    return;
  }

  const token = findBlobToken();

  try {
    const upstream = await fetch(target, {
      headers: token ? { authorization: `Bearer ${token}` } : {}
    });

    if (!upstream.ok) {
      res.status(upstream.status === 404 ? 404 : 502).json({ error: "사진을 불러오지 못했어요" });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      res.status(415).json({ error: "이미지가 아니에요" });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    // 사진은 바뀌지 않으니 오래 캐시해서 함수 호출을 줄인다
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: "사진을 불러오는 중 문제가 생겼어요" });
  }
}
