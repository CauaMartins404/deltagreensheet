// Modo demonstração: roda o site no seu computador com um banco de mentira,
// sem precisar de MongoDB nem de internet.
//   npm run demo   →   abra http://localhost:8888
// Handler da demonstração: usuário "MESTRE KONA", senha "demo1234".
// Agentes de exemplo: chave "1234".
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeltaApi } from "../server/delta.mjs";
import { fakeDb, fakeIds, fakeHash } from "../tests/fake-db.mjs";

const raiz = fileURLToPath(new URL("../public/", import.meta.url));
const porta = Number(process.env.PORT || 8888);
const tipos = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };

const db = fakeDb({ characters: ["normalizedName"] });
const api = createDeltaApi({
  db, ...fakeIds, ...fakeHash,
  env: { JWT_SECRET: "demo-".repeat(8), GM_USERNAME: "MESTRE KONA", GM_PASSWORD: "demo1234" }
});

const exemplos = [
  ["Agente Exemplo 1", "DELTA GREEN 0", { STR: 13, CON: 12, DEX: 14, INT: 15, POW: 11, CHA: 10 }],
  ["Agente Exemplo 2", "DELTA GREEN 0", { STR: 9, CON: 11, DEX: 12, INT: 17, POW: 14, CHA: 13 }],
  ["Agente Exemplo 3", "LALUTH", { STR: 15, CON: 16, DEX: 11, INT: 10, POW: 9, CHA: 8 }]
];
for (const [name, campaign, attrs] of exemplos) {
  await api({ action: "create", name, password: "1234", campaign, attrs, skills: { Atletismo: 40, "Armas de Fogo": 50, Prontidão: 45, Esquiva: 30 } });
}

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api")) {
      let corpo = "";
      for await (const parte of req) corpo += parte;
      const r = await api(JSON.parse(corpo || "{}"), req.headers.authorization);
      res.writeHead(r.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(r.body));
    }
    const caminho = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const arquivo = join(raiz, caminho || "index.html");
    if (!arquivo.startsWith(raiz)) throw new Error("fora da pasta");
    const conteudo = await readFile(arquivo);
    res.writeHead(200, { "Content-Type": tipos[extname(arquivo)] || "application/octet-stream" });
    res.end(conteudo);
  } catch {
    res.writeHead(404);
    res.end("Não encontrado");
  }
}).listen(porta, () => console.log(`Demonstração rodando em http://localhost:${porta}`));
