// Testes da API (rodar com: npm test). Usam um banco falso, sem internet.
import test from "node:test";
import assert from "node:assert/strict";
import { createDeltaApi } from "../server/delta.mjs";
import { signToken, verifyToken } from "../server/token.mjs";
import { fakeDb, fakeIds, fakeHash } from "./fake-db.mjs";

const env = { JWT_SECRET: "x".repeat(32), GM_USERNAME: "Mestre Kona", GM_PASSWORD: "segredo-mestre" };
const attrs = { STR: 12, CON: 14, DEX: 10, INT: 13, POW: 11, CHA: 9 };

function setup() {
  const db = fakeDb({ characters: ["normalizedName"] });
  const api = createDeltaApi({ db, ...fakeIds, ...fakeHash, env });
  return { db, api };
}

async function newAgent(api, name = "Agente Silva") {
  const r = await api({ action: "create", name, password: "1234", campaign: "laluth", attrs, skills: { Atletismo: 50, Esquiva: 30 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.character;
}

async function playerLogin(api, id) {
  const r = await api({ action: "login", characterId: id, password: "1234" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { auth: `Bearer ${r.body.token}`, data: r.body.data };
}

test("token: assina, verifica e recusa adulterado ou vencido", () => {
  const token = signToken({ sub: "a" }, "s".repeat(30), { issuer: "x" });
  assert.equal(verifyToken(token, "s".repeat(30), { issuer: "x" }).sub, "a");
  assert.throws(() => verifyToken(token + "a", "s".repeat(30)));
  assert.throws(() => verifyToken(token, "outra-chave-qualquer-123456"));
  const old = signToken({ sub: "a" }, "s".repeat(30), { expiresIn: -10 });
  assert.throws(() => verifyToken(old, "s".repeat(30)));
});

test("criar agente calcula PV, PE, SAN e Breaking Point no servidor", async () => {
  const { api, db } = setup();
  const agent = await newAgent(api);
  const saved = db.collections.characters.docs[0];
  assert.equal(agent.campaign, "LALUTH");
  assert.deepEqual(saved.vitals, { hpCurrent: 13, hpMax: 13, wpCurrent: 11, wpMax: 11, sanCurrent: 55, sanMax: 55, breakingPoint: 44 });
  assert.equal(saved.passwordHash, "hash:1234");
  assert.equal(saved.sections.skills[0].items.length, 2);
});

test("criação recusa atributos inválidos, senha curta e nome repetido", async () => {
  const { api } = setup();
  assert.equal((await api({ action: "create", name: "A", password: "1234", campaign: "X", attrs: { ...attrs, STR: 25 } })).status, 400);
  assert.equal((await api({ action: "create", name: "A", password: "12", campaign: "X", attrs })).status, 400);
  await newAgent(api, "Duplicado");
  assert.equal((await api({ action: "create", name: "  duplicado ", password: "1234", campaign: "X", attrs })).status, 409);
});

test("lista pública não expõe senha", async () => {
  const { api } = setup();
  await newAgent(api);
  const r = await api({ action: "list" });
  assert.equal(r.body.characters.length, 1);
  assert.ok(!JSON.stringify(r.body).includes("hash:"));
  const config = await api({ action: "config" });
  assert.deepEqual(config.body.config.campaigns, ["DELTA GREEN 0", "LALUTH"]);
});

test("login de jogador: senha certa entra, errada não", async () => {
  const { api } = setup();
  const agent = await newAgent(api);
  assert.equal((await api({ action: "login", characterId: agent.id, password: "errada" })).status, 401);
  const { data } = await playerLogin(api, agent.id);
  assert.equal(data.name, "Agente Silva");
  assert.ok(!("passwordHash" in data));
});

test("ações privadas sem sessão são recusadas", async () => {
  const { api } = setup();
  assert.equal((await api({ action: "state" })).status, 401);
  assert.equal((await api({ action: "state" }, "Bearer lixo")).status, 401);
  assert.equal((await api({ action: "naoexiste" })).status, 404);
});

test("jogador edita PV atual e inventário, mas não PV máximo, atributos nem perícias", async () => {
  const { api } = setup();
  const agent = await newAgent(api);
  const { auth, data } = await playerLogin(api, agent.id);

  const hp = await api({ action: "updateVital", characterId: agent.id, key: "hpCurrent", value: 7 }, auth);
  assert.equal(hp.body.character.vitals.hpCurrent, 7);
  assert.equal((await api({ action: "updateVital", characterId: agent.id, key: "hpMax", value: 99 }, auth)).status, 403);
  assert.equal((await api({ action: "updateAttribute", characterId: agent.id, key: "STR", value: 18 }, auth)).status, 403);

  const skills = data.sections.skills[0];
  assert.equal((await api({ action: "updateItem", characterId: agent.id, sectionId: skills.id, itemId: skills.items[0].id, value: "80" }, auth)).status, 403);
  const check = await api({ action: "updateSkillCheck", characterId: agent.id, sectionId: skills.id, itemId: skills.items[0].id, checked: true }, auth);
  assert.equal(check.body.character.sections.skills[0].items[0].checked, true);

  const inv = data.sections.inventory[0];
  const added = await api({ action: "addItem", characterId: agent.id, sectionId: inv.id, label: "Lanterna", value: "1" }, auth);
  const item = added.body.character.sections.inventory[0].items[0];
  assert.equal(item.label, "Lanterna");
  const removed = await api({ action: "deleteItem", characterId: agent.id, sectionId: inv.id, itemId: item.id }, auth);
  assert.equal(removed.body.character.sections.inventory[0].items.length, 0);

  const main = data.sections.main[0];
  assert.equal((await api({ action: "addItem", characterId: agent.id, sectionId: main.id, label: "X" }, auth)).status, 403);
});

test("jogador não acessa a ficha de outro agente", async () => {
  const { api } = setup();
  const a = await newAgent(api, "Agente A");
  const b = await newAgent(api, "Agente B");
  const { auth } = await playerLogin(api, a.id);
  assert.equal((await api({ action: "updateVital", characterId: b.id, key: "hpCurrent", value: 1 }, auth)).status, 403);
});

test("editar Profissão atualiza o perfil mostrado no lobby", async () => {
  const { api } = setup();
  const agent = await newAgent(api);
  const { auth, data } = await playerLogin(api, agent.id);
  const info = data.sections.info[0];
  const prof = info.items.find(i => i.label === "Profissão");
  await api({ action: "updateItem", characterId: agent.id, sectionId: info.id, itemId: prof.id, value: "Médica" }, auth);
  const list = await api({ action: "list" });
  assert.equal(list.body.characters[0].profession, "Médica");
});

test("Handler: login, edita atributos, muda status e lê registros", async () => {
  const { api } = setup();
  const agent = await newAgent(api);
  assert.equal((await api({ action: "login", mode: "master", username: "mestre kona", password: "errada" })).status, 401);
  const login = await api({ action: "login", mode: "master", username: "  MESTRE   KONA ", password: "segredo-mestre" });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.length, 1);
  const auth = `Bearer ${login.body.token}`;

  const attr = await api({ action: "updateAttribute", characterId: agent.id, key: "STR", value: 16 }, auth);
  assert.equal(attr.body.character.attrs.STR, 16);
  const dead = await api({ action: "toggleStatus", characterId: agent.id }, auth);
  assert.equal(dead.body.character.status, "MORTO");
  const logs = await api({ action: "logs" }, auth);
  assert.ok(logs.body.logs.length >= 3);
  assert.equal((await api({ action: "state" }, auth)).body.data[0].status, "MORTO");
});

test("foto: aceita imagem válida e recusa outros formatos", async () => {
  const { api } = setup();
  const agent = await newAgent(api);
  const { auth } = await playerLogin(api, agent.id);
  assert.equal((await api({ action: "uploadPhoto", characterId: agent.id, photo: "javascript:alert(1)" }, auth)).status, 400);
  const ok = await api({ action: "uploadPhoto", characterId: agent.id, photo: "data:image/jpeg;base64,AAAA" }, auth);
  assert.equal(ok.body.character.photo, "data:image/jpeg;base64,AAAA");
});

test("versão aumenta a cada alteração (proteção contra edição simultânea)", async () => {
  const { api } = setup();
  const agent = await newAgent(api);
  const { auth } = await playerLogin(api, agent.id);
  const r1 = await api({ action: "updateVital", characterId: agent.id, key: "sanCurrent", value: 50 }, auth);
  const r2 = await api({ action: "updateVital", characterId: agent.id, key: "sanCurrent", value: 45 }, auth);
  assert.equal(r2.body.character.version, r1.body.character.version + 1);
});

// ---------- fichas de teste ----------
function setupComRelogio(extraEnv = {}) {
  const db = fakeDb({ characters: ["normalizedName"] });
  const relogio = { agora: new Date("2026-11-19T12:00:00Z") };
  const api = createDeltaApi({ db, ...fakeIds, ...fakeHash, env: { ...env, ...extraEnv }, now: () => relogio.agora });
  return { db, api, relogio };
}

test("ficha de teste: cria, entra direto e não aparece no lobby nem para o Handler", async () => {
  const { api, db } = setupComRelogio();
  await newAgent(api, "Agente Real");
  const r = await api({ action: "demo", attrs, skills: { Atletismo: 50 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.equal(r.body.data.demo, true);
  assert.equal(r.body.data.campaign, "DEMONSTRAÇÃO");
  assert.match(r.body.data.name, /^Agente Teste [0-9A-F]{4}$/);
  assert.equal(r.body.data.sections.inventory[0].items.length, 3);
  assert.ok(new Date(r.body.data.expiresAt) > new Date("2026-11-19T12:59:00Z"));
  assert.ok(db.collections.characters.docs.find(d => d.demo).expiresAt instanceof Date);

  const lista = await api({ action: "list" });
  assert.deepEqual(lista.body.characters.map(c => c.name), ["Agente Real"]);
  assert.ok(!(await api({ action: "config" })).body.config.campaigns.includes("DEMONSTRAÇÃO"));

  const mestre = await api({ action: "login", mode: "master", username: "Mestre Kona", password: "segredo-mestre" });
  assert.deepEqual(mestre.body.data.map(c => c.name), ["Agente Real"]);

  const auth = `Bearer ${r.body.token}`;
  const hp = await api({ action: "updateVital", characterId: r.body.data.id, key: "hpCurrent", value: 2 }, auth);
  assert.equal(hp.body.character.vitals.hpCurrent, 2);
  const registros = await api({ action: "logs" }, `Bearer ${mestre.body.token}`);
  assert.ok(registros.body.logs.every(l => !l.characterName.startsWith("Agente Teste")));
});

test("ficha de teste vencida deixa de funcionar e é limpa", async () => {
  const { api, db, relogio } = setupComRelogio({ DEMO_MINUTES: "30" });
  const r = await api({ action: "demo", attrs, skills: {} });
  const auth = `Bearer ${r.body.token}`;
  relogio.agora = new Date("2026-11-19T12:31:00Z");
  assert.equal((await api({ action: "updateVital", characterId: r.body.data.id, key: "hpCurrent", value: 1 }, auth)).status, 404);
  await api({ action: "demo", attrs, skills: {} });
  assert.equal(db.collections.characters.docs.filter(d => d.demo).length, 1, "a vencida foi apagada");
});

test("ficha de teste: limite, desligar e nome reservado", async () => {
  const { api } = setupComRelogio({ DEMO_MAX: "2" });
  assert.equal((await api({ action: "demo", attrs: { ...attrs, STR: 40 } })).status, 400);
  assert.equal((await api({ action: "demo", attrs })).status, 200);
  assert.equal((await api({ action: "demo", attrs })).status, 200);
  assert.equal((await api({ action: "demo", attrs })).status, 429);
  assert.equal((await api({ action: "create", name: "X", password: "1234", campaign: "demonstração", attrs })).status, 400);
  const desligado = setupComRelogio({ DEMO_ENABLED: "false" });
  assert.equal((await desligado.api({ action: "demo", attrs })).status, 403);
  assert.equal((await desligado.api({ action: "config" })).body.config.demo, false);
});
