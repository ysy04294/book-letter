/* =========================================================
   사진 업로드 프록시 (Vercel 서버리스 함수)

   사진을 링크(hash)에 직접 담으면 카카오톡 같은 메신저에서 잘려버린다.
   그래서 사진은 서버를 거쳐 저장소에 올리고, 짧은 URL만 링크에 담는다.
   (브라우저에서 직접 올리면 CORS에 막히고, 키 없이 쓰는 익명 호스팅은
    catbox처럼 서버 IP를 차단하거나 0x0.st처럼 서비스가 중단됐다.)

   아래 둘 중 아무거나 설정돼 있으면 동작한다.

   [방법 1] Vercel Blob — 가입 없이 대시보드 클릭만으로 끝
     Vercel 프로젝트 → Storage → Create Database → Blob
     연결하면 BLOB_READ_WRITE_TOKEN 이 자동으로 주입된다.

   [방법 2] imgbb — https://api.imgbb.com 에서 무료 키 발급 후
     환경변수 IMGBB_API_KEY 에 등록

   둘 다 없으면 501을 돌려주고, 클라이언트가 알아서 대체 동작한다.

   요청: POST /api/upload  (본문 = 이미지 바이너리, Content-Type: image/*)
   응답: { url: "https://..." }
   ========================================================= */

const MAX_BYTES = 4 * 1024 * 1024; // Vercel 요청 본문 한도(4.5MB) 안쪽으로
const BLOB_API_VERSION = "7";

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

// Vercel Blob 쓰기 토큰 찾기.
// 연결 방식에 따라 BLOB_READ_WRITE_TOKEN 이 아닌 이름으로 주입되기도 해서,
// 값 형태(vercel_blob_rw_...)로도 찾는다. 값은 로그에 남기지 않는다.
function findBlobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const value of Object.values(process.env)) {
    if (typeof value === "string" && value.startsWith("vercel_blob_rw_")) return value;
  }
  return null;
}

// --- 방법 1: Vercel Blob -------------------------------------------------
async function uploadToVercelBlob(buf, contentType, ext) {
  const token = findBlobToken();
  if (!token) return null;

  const pathname = `letter-photos/photo.${ext}`;
  const upstream = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": BLOB_API_VERSION,
      "x-content-type": contentType,
      "x-add-random-suffix": "1"
    },
    body: buf
  });

  const json = await upstream.json().catch(() => null);
  if (!upstream.ok || !json || !json.url) {
    return { failed: true, status: upstream.status, body: JSON.stringify(json).slice(0, 200) };
  }
  return { url: json.url };
}

// --- 방법 2: imgbb -------------------------------------------------------
async function uploadToImgbb(buf) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) return null;

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
    return { failed: true, status: upstream.status, body: JSON.stringify(json).slice(0, 200) };
  }
  return { url };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 지원해요" });
    return;
  }

  if (!findBlobToken() && !process.env.IMGBB_API_KEY) {
    // 어떤 이름으로 주입됐는지 확인용 (값은 절대 노출하지 않고 이름만)
    const related = Object.keys(process.env)
      .filter((k) => /BLOB|IMGBB|STORAGE|TOKEN/i.test(k))
      .sort();
    res.status(501).json({
      error: "이미지 저장소가 아직 설정되지 않았어요",
      seenEnvNames: related
    });
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

    const attempts = [];

    const viaBlob = await uploadToVercelBlob(buf, contentType, ext);
    if (viaBlob && viaBlob.url) { res.status(200).json({ url: viaBlob.url }); return; }
    if (viaBlob) attempts.push({ via: "vercel-blob", ...viaBlob });

    const viaImgbb = await uploadToImgbb(buf);
    if (viaImgbb && viaImgbb.url) { res.status(200).json({ url: viaImgbb.url }); return; }
    if (viaImgbb) attempts.push({ via: "imgbb", ...viaImgbb });

    res.status(502).json({ error: "업로드에 실패했어요", attempts });
  } catch (e) {
    if (e && e.message === "too-large") {
      res.status(413).json({ error: "사진이 너무 커요" });
      return;
    }
    res.status(500).json({ error: "업로드 중 문제가 생겼어요" });
  }
}
