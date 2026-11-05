// 한우도감 재고장부 — 데이터 API
// 저장: Vercel Blob(비공개) 의 db.json 하나. 동시에 저장해도 덮어쓰지 않도록 ETag(ifMatch)로 확인 후 다시 시도.
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import crypto from "node:crypto";

const PATH = "hanwoo/db.json";
const COLS = ["lots", "outs"];

function pinOk(req) {
  const want = String(process.env.STORE_PIN || "");
  const got = String(req.headers["x-pin"] || "");
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function load() {
  const r = await get(PATH, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return { data: { lots: {}, outs: {} }, etag: null };
  const text = await new Response(r.stream).text();
  const data = JSON.parse(text || "{}");
  return { data: { lots: data.lots || {}, outs: data.outs || {} }, etag: r.blob.etag };
}

async function save(data, etag) {
  const body = JSON.stringify(data);
  const opts = { access: "private", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 0 };
  if (etag) opts.ifMatch = etag; // 다른 사람이 먼저 저장했으면 실패 → 다시 읽고 재시도
  await put(PATH, body, opts);
  // 하루 한 번 백업(같은 날은 덮어씀)
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  put(`hanwoo/backup/${day}.json`, body, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true }).catch(() => {});
}

const out = (d) => ({ lots: Object.entries(d.lots).map(([id, v]) => ({ id, ...v })), outs: Object.entries(d.outs).map(([id, v]) => ({ id, ...v })) });
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const str = (v, max = 200) => (v == null ? "" : String(v).slice(0, max));

class UserError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

function apply(data, body) {
  const { op, col } = body || {};
  if (!COLS.includes(col)) throw new UserError("잘못된 요청이에요");
  if (op === "add") {
    const d = body.doc || {};
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    if (col === "lots") {
      const kg = num(d.kg);
      if (!(kg > 0)) throw new UserError("물량(kg)을 확인해 주세요");
      if (!str(d.part).trim()) throw new UserError("부위를 골라 주세요");
      data.lots[id] = {
        species: str(d.species, 20) || "소", date: str(d.date, 10), kind: str(d.kind, 10), part: str(d.part, 40), kg: Math.round(kg * 100) / 100,
        origin: str(d.origin, 40), grade: str(d.grade, 20), traceNo: str(d.traceNo, 60), slaughterhouse: str(d.slaughterhouse, 60),
        supplier: str(d.supplier, 60), price: Number.isFinite(num(d.price)) && d.price !== null ? Math.round(num(d.price)) : null,
        memo: str(d.memo, 200), createdAt: Date.now(),
      };
    } else {
      const lot = data.lots[d.lotId];
      if (!lot) throw new UserError("재고 개체를 찾을 수 없어요. 새로고침해 주세요", 409);
      const kg = num(d.kg);
      if (!(kg > 0)) throw new UserError("물량(kg)을 확인해 주세요");
      const used = Object.values(data.outs).filter((o) => o.lotId === d.lotId).reduce((s, o) => s + (+o.kg || 0), 0);
      const remain = Math.round((lot.kg - used) * 100) / 100;
      if (kg > remain + 0.004) throw new UserError(`남은 재고는 ${remain.toFixed(2)}kg이에요`, 409);
      data.outs[id] = { date: str(d.date, 10), lotId: d.lotId, kg: Math.round(kg * 100) / 100, type: str(d.type, 20) || "판매", buyer: str(d.buyer, 60), memo: str(d.memo, 200), createdAt: Date.now() };
    }
    return;
  }
  if (op === "del") {
    const id = str(body.id, 40);
    if (!data[col][id]) return; // 이미 지워짐
    if (col === "lots" && Object.values(data.outs).some((o) => o.lotId === id)) throw new UserError("출고 기록이 있어서 지울 수 없어요. 출고 줄을 먼저 지우세요", 409);
    delete data[col][id];
    return;
  }
  throw new UserError("잘못된 요청이에요");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!pinOk(req)) return res.status(401).json({ error: "비밀번호가 맞지 않아요" });
  try {
    if (req.method === "GET") {
      const { data } = await load();
      return res.status(200).json(out(data));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "허용되지 않은 요청이에요" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, etag } = await load();
      apply(data, body);
      try {
        await save(data, etag);
        return res.status(200).json(out(data));
      } catch (e) {
        const conflict = e instanceof BlobPreconditionFailedError || /precondition|already exists/i.test(String(e && e.message));
        if (!conflict) throw e;
        await new Promise((r) => setTimeout(r, 80 + Math.random() * 220));
      }
    }
    return res.status(503).json({ error: "동시에 저장이 몰렸어요. 다시 눌러 주세요" });
  } catch (e) {
    if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: "서버 오류가 났어요. 잠시 후 다시 해 주세요" });
  }
}
