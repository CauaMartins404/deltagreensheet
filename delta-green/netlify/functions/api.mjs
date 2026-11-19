// Função do Netlify: recebe as chamadas do site em /api e conversa com o MongoDB.
// A senha do banco NUNCA fica no código: ela vem da variável MONGODB_URI,
// configurada no painel do Netlify (Site configuration → Environment variables).
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { createDeltaApi } from "../../server/delta.mjs";

let ready = null;

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI não configurada no Netlify.");
  const client = new MongoClient(uri, { maxPoolSize: 8, serverSelectionTimeoutMS: 7000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "delta_green");
  await Promise.all([
    db.collection("characters").createIndex({ normalizedName: 1 }, { unique: true }),
    db.collection("characters").createIndex({ campaign: 1, name: 1 }),
    db.collection("logs").createIndex({ campaign: 1, createdAt: -1 })
  ]);
  return createDeltaApi({
    db,
    toId: value => (ObjectId.isValid(String(value || "")) ? new ObjectId(String(value)) : null),
    idStr: value => String(value),
    hashPassword: password => bcrypt.hash(password, 10),
    comparePassword: (password, hash) => (hash ? bcrypt.compare(password, hash) : false),
    env: process.env
  });
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export default async request => {
  if (request.method !== "POST") return json(405, { ok: false, message: "Método não permitido." });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, message: "JSON inválido." });
  }

  try {
    ready ||= connect().catch(error => { ready = null; throw error; });
    const handle = await ready;
    const result = await handle(body, request.headers.get("authorization"));
    return json(result.status, result.body);
  } catch (error) {
    console.error("Falha ao conectar no MongoDB:", error);
    return json(503, { ok: false, message: "Sem conexão com o banco de dados." });
  }
};

export const config = { path: "/api" };
