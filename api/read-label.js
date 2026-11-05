// 한우도감 재고장부 — 사진(라벨·등급판정서·거래명세서) 읽기
// ANTHROPIC_API_KEY 환경변수가 있을 때만 동작. 없으면 501을 돌려주고, 화면은 바코드 읽기만 씀.
import crypto from "node:crypto";

export const config = { maxDuration: 60 };

function pinOk(req) {
  const want = String(process.env.STORE_PIN || "");
  const got = String(req.headers["x-pin"] || "");
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const prompt = (today) => `이 사진은 정육점에 들어온 고기(소·돼지·양·수입육)의 라벨, 등급판정서, 또는 도매 거래명세서입니다. 사진에 보이는 품목을 거래내역서 입고 항목으로 뽑아 JSON으로만 답하세요. 설명 문장 없이 JSON만.
형식: {"items":[{"species":"소|돼지|양|수입육 (수입 소고기·돼지고기는 수입육, 양고기는 원산지와 상관없이 양)","date":"YYYY-MM-DD 또는 null(포장일·거래일·도축일 중 거래일 우선)","kind":"식육|포장육","part":"부위명(적힌 그대로의 부위명)","kg":숫자(중량 kg, g이면 kg로 환산),"origin":"예: 국내산(한우), 미국산","grade":"1++|1+|1|2|3|등외|프라임|초이스|해당없음","traceNo":"국내산은 이력번호 12자리 숫자 또는 L로 시작하는 묶음번호, 수입육은 수입유통식별번호","slaughterhouse":"도축장명","supplier":"판매업소·가공업소명(보낸 곳)","price":kg당 단가 숫자 또는 null}]}
규칙: 사진에 없는 값은 null. 추측하지 말 것. 등급 1++는 마블링 숫자(9,8 등)가 아니라 등급 표기로. 오늘은 ${today}. 품목이 없으면 {"items":[]}.`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!pinOk(req)) return res.status(401).json({ error: "비밀번호가 맞지 않아요" });
  if (req.method !== "POST") return res.status(405).json({ error: "허용되지 않은 요청이에요" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: "사진 글자 읽기가 꺼져 있어요" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    const image = String(body.image || "");
    if (!image || image.length > 8_000_000) return res.status(400).json({ error: "사진이 너무 크거나 비어 있어요" });
    const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || "") ? body.today : new Date().toISOString().slice(0, 10);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: prompt(today) },
        ] }],
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.error("anthropic", r.status, j); return res.status(502).json({ error: "사진을 읽지 못했어요" }); }
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    let parsed = { items: [] };
    try { parsed = JSON.parse(m ? m[0] : text); } catch { /* 빈 결과 */ }
    return res.status(200).json({ items: Array.isArray(parsed.items) ? parsed.items : [] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "사진을 읽지 못했어요" });
  }
}
