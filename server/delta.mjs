// Regras do servidor do Delta Green — Sistema de Agentes.
// Este arquivo não conecta em nada sozinho: recebe o banco e as ferramentas
// prontas ("deps"). Assim dá para testar tudo com um banco falso.
import crypto from "node:crypto";
import { signToken, verifyToken, parseDuration, safeEqual } from "./token.mjs";

export const ATTRIBUTES = ["STR", "CON", "DEX", "INT", "POW", "CHA"];
const VITAL_KEYS = ["hpCurrent", "hpMax", "wpCurrent", "wpMax", "sanCurrent", "sanMax", "breakingPoint"];
const ISSUER = "delta-green-netlify";
export const DEMO_CAMPAIGN = "DEMONSTRAÇÃO";
const DEMO_PROFISSOES = [
  ["Agente Especial", "FBI"], ["Epidemiologista", "CDC"], ["Analista de Inteligência", "NSA"],
  ["Oficial de Campo", "CIA"], ["Médica Legista", "Polícia Federal"], ["Fuzileiro", "Marinha dos EUA"]
];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };

// ---------- limpeza de dados vindos do navegador ----------
export function normalizeName(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}
const cleanText = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
const cleanName = value => cleanText(value, 60).replace(/[<>]/g, "");
const cleanCampaign = value => cleanText(value, 80).replace(/[<>]/g, "").toUpperCase();
function cleanInteger(value, min = -999, max = 999) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return Math.max(min, Math.min(max, 0));
  return Math.max(min, Math.min(max, number));
}
const newId = () => crypto.randomUUID();

// ---------- ficha nova ----------
export function defaultSections(skills = {}) {
  const item = (label, value) => ({ id: newId(), label, value });
  return {
    main: [{
      id: newId(), title: "HABILIDADES E TRAÇOS", dynamic: false,
      items: [item("Características Distintivas", "A definir"), item("Bonds", "A definir"), item("Motivações", "A definir")]
    }],
    skills: [{
      id: newId(), title: "PERÍCIAS", dynamic: false,
      items: Object.entries(skills).map(([label, value]) => ({
        id: newId(), label: cleanText(label, 100), value: String(cleanInteger(value, 0, 99)), checked: false
      }))
    }],
    inventory: [{ id: newId(), title: "INVENTÁRIO PESSOAL", dynamic: true, items: [] }],
    combat: [
      { id: newId(), title: "ARMAS E DEFESA", dynamic: true, items: [] },
      { id: newId(), title: "LESÕES E TRAUMAS", dynamic: true, items: [] }
    ],
    info: [
      { id: newId(), title: "DADOS PESSOAIS", dynamic: true,
        items: [item("Profissão", "Agente de Campo"), item("Empregador", "Delta Green"), item("Idade", "30"), item("Nacionalidade", "Brasil")] },
      { id: newId(), title: "DADOS PSICOLÓGICOS", dynamic: true,
        items: [item("Transtornos", "Nenhum registrado"), item("Adaptações", "Nenhuma registrada")] },
      { id: newId(), title: "HISTÓRICO", dynamic: true,
        items: [item("Incidente de Recrutamento", "A definir"), item("Anotações", "")] }
    ]
  };
}

export function createDeltaApi(deps) {
  const { db, toId, idStr, hashPassword, comparePassword, env = {} } = deps;
  const characters = () => db.collection("characters");
  const logs = () => db.collection("logs");

  const handlerName = () => env.GM_USERNAME || "MESTRE KONA";
  const defaultCampaigns = () => String(env.DEFAULT_CAMPAIGNS || "DELTA GREEN 0,LALUTH")
    .split(",").map(cleanCampaign).filter(Boolean);

  function jwtSecret() {
    const secret = env.JWT_SECRET;
    if (!secret || secret.length < 24) fail(500, "Configure JWT_SECRET (24+ caracteres) no Netlify.");
    return secret;
  }

  function sign(payload) {
    return signToken(payload, jwtSecret(), { expiresIn: parseDuration(env.SESSION_DURATION, 12 * 3600), issuer: ISSUER });
  }

  function readSession(authorization) {
    const match = String(authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) fail(401, "Sessão necessária.");
    try {
      return verifyToken(match[1], jwtSecret(), { issuer: ISSUER });
    } catch {
      fail(401, "Sessão inválida ou expirada.");
    }
  }

  async function verifyMasterPassword(password) {
    if (env.GM_PASSWORD_HASH) return comparePassword(password, env.GM_PASSWORD_HASH);
    if (env.GM_PASSWORD) return safeEqual(password, env.GM_PASSWORD);
    fail(500, "Configure GM_PASSWORD no Netlify.");
  }

  const masterQuery = session => ({
    demo: { $ne: true },
    ...(session.campaign && session.campaign !== "TODAS" ? { campaign: session.campaign } : {})
  });
  const agora = () => (deps.now ? deps.now() : new Date());
  const expirada = c => Boolean(c?.demo && c.expiresAt && new Date(c.expiresAt) <= agora());

  function canAccess(session, character) {
    if (session.role === "player") return String(session.sub) === idStr(character._id);
    if (session.role === "master") return !session.campaign || session.campaign === "TODAS" || session.campaign === character.campaign;
    return false;
  }

  const serialize = c => c && ({
    id: idStr(c._id), name: c.name, campaign: c.campaign, status: c.status || "VIVO", photo: c.photo || "",
    profile: c.profile || {}, attrs: c.attrs || {}, vitals: c.vitals || {}, sections: c.sections || {},
    version: c.version || 1, createdAt: c.createdAt, updatedAt: c.updatedAt,
    demo: Boolean(c.demo), expiresAt: c.expiresAt || null
  });

  const summary = c => ({
    id: idStr(c._id), name: c.name, campaign: c.campaign, status: c.status || "VIVO", photo: c.photo || "",
    profession: c.profile?.profession || "Agente de Campo", employer: c.profile?.employer || "Delta Green",
    age: c.profile?.age || "", updatedAt: c.updatedAt
  });

  function findSection(character, sectionId) {
    for (const [tab, list] of Object.entries(character.sections || {})) {
      const section = (list || []).find(s => s.id === sectionId);
      if (section) return { tab, section };
    }
    return null;
  }

  function syncProfile(character, item) {
    character.profile ||= {};
    const key = String(item.label || "").toLocaleLowerCase("pt-BR");
    if (key === "profissão" || key === "profissao") character.profile.profession = cleanText(item.value, 100);
    if (key === "empregador") character.profile.employer = cleanText(item.value, 100);
    if (key === "idade") character.profile.age = cleanText(item.value, 20);
    if (key === "nacionalidade") character.profile.nationality = cleanText(item.value, 80);
  }

  async function writeLog(session, character, message) {
    await logs().insertOne({
      actor: session.name || "SISTEMA", role: session.role || "system",
      characterId: character._id, characterName: character.name, campaign: character.campaign,
      message: cleanText(message, 500), createdAt: new Date(),
      ...(character.demo ? { demo: true, expiresAt: character.expiresAt } : {})
    });
  }

  // Altera a ficha com controle de versão: se duas pessoas salvarem ao mesmo
  // tempo, ninguém sobrescreve o outro sem querer.
  async function mutate(session, characterId, change) {
    const _id = toId(characterId);
    if (!_id) fail(400, "Identificador de agente inválido.");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const character = await characters().findOne({ _id });
      if (!character || expirada(character)) fail(404, "Agente não encontrado (fichas de teste expiram sozinhas).");
      if (!canAccess(session, character)) fail(403, "Acesso negado a esta ficha.");
      const message = await change(character);
      const result = await characters().updateOne(
        { _id, version: character.version || 1 },
        {
          $set: {
            status: character.status, photo: character.photo, profile: character.profile,
            attrs: character.attrs, vitals: character.vitals, sections: character.sections, updatedAt: new Date()
          },
          $inc: { version: 1 }
        }
      );
      if (result.modifiedCount === 1) {
        const saved = await characters().findOne({ _id });
        if (message) await writeLog(session, saved, message);
        return { character: serialize(saved) };
      }
    }
    fail(409, "A ficha mudou ao mesmo tempo em outro aparelho. Tente de novo.");
  }

  function requireEditable(session, section, message) {
    if (session.role !== "master" && !section.dynamic) fail(403, message);
  }

  const demoAtivo = () => String(env.DEMO_ENABLED ?? "true").toLowerCase() !== "false";

  async function montarAgente({ name, campaign, password, attrs: brutos, skills: pericias }) {
    const attrs = {};
    for (const key of ATTRIBUTES) {
      const value = Number.parseInt(brutos?.[key], 10);
      if (!Number.isFinite(value) || value < 3 || value > 18) fail(400, "Atributos inválidos.");
      attrs[key] = value;
    }
    const skills = {};
    for (const [key, value] of Object.entries(pericias || {}).slice(0, 80)) {
      skills[cleanText(key, 100)] = cleanInteger(value, 0, 80);
    }
    // Valores derivados são calculados aqui no servidor, não confiamos no navegador.
    const hp = Math.ceil((attrs.STR + attrs.CON) / 2);
    const san = attrs.POW * 5;
    const now = new Date();
    return {
      name, normalizedName: normalizeName(name), passwordHash: await hashPassword(password),
      campaign, status: "VIVO", photo: "",
      profile: { profession: "Agente de Campo", employer: "Delta Green", age: "30", nationality: "Brasil" },
      attrs,
      vitals: { hpCurrent: hp, hpMax: hp, wpCurrent: attrs.POW, wpMax: attrs.POW, sanCurrent: san, sanMax: san, breakingPoint: san - attrs.POW },
      sections: defaultSections(skills), version: 1, createdAt: now, updatedAt: now
    };
  }

  async function salvarNovo(character) {
    try {
      const inserted = await characters().insertOne(character);
      character._id = inserted.insertedId;
    } catch (error) {
      if (error?.code === 11000) fail(409, "Já existe um agente com esse nome.");
      throw error;
    }
  }

  // ---------- ações públicas ----------
  const publicActions = {
    async config() {
      const stored = await characters().distinct("campaign");
      const campanhas = [...new Set([...defaultCampaigns(), ...stored.filter(c => c && c !== DEMO_CAMPAIGN)])];
      return { config: { campaigns: campanhas, handlerName: handlerName(), demo: demoAtivo() } };
    },

    async list() {
      const docs = await characters()
        .find({ demo: { $ne: true } }, { projection: { name: 1, campaign: 1, status: 1, photo: 1, profile: 1, updatedAt: 1 } })
        .sort({ campaign: 1, name: 1 }).toArray();
      return { characters: docs.map(summary) };
    },

    async create(body) {
      const name = cleanName(body.name);
      const campaign = cleanCampaign(body.campaign);
      const password = String(body.password || "");
      if (!name || !campaign) fail(400, "Nome e operação são obrigatórios.");
      if (campaign === DEMO_CAMPAIGN) fail(400, "Essa operação é reservada para fichas de teste.");
      if (password.length < 4) fail(400, "A chave de acesso precisa ter pelo menos 4 caracteres.");
      const character = await montarAgente({ name, campaign, password, attrs: body.attrs, skills: body.skills });
      await salvarNovo(character);
      await writeLog({ name, role: "player" }, character, "agente registrado no sistema");
      return { character: summary(character) };
    },

    // Ficha de teste: qualquer visitante cria, entra direto e ela some sozinha.
    async demo(body) {
      if (!demoAtivo()) fail(403, "Fichas de teste estão desligadas.");
      const minutos = Math.max(5, Math.min(24 * 60, Number.parseInt(env.DEMO_MINUTES || "60", 10) || 60));
      const limite = Math.max(1, Number.parseInt(env.DEMO_MAX || "30", 10) || 30);
      await characters().deleteMany({ demo: true, expiresAt: { $lt: agora() } });
      if ((await characters().countDocuments({ demo: true })) >= limite) {
        fail(429, "Muitas fichas de teste abertas agora. Tente de novo em alguns minutos.");
      }
      const codigo = crypto.randomBytes(2).toString("hex").toUpperCase();
      const [profissao, empregador] = DEMO_PROFISSOES[crypto.randomInt(DEMO_PROFISSOES.length)];
      const expiresAt = new Date(agora().getTime() + minutos * 60_000);
      const character = await montarAgente({
        name: `Agente Teste ${codigo}`, campaign: DEMO_CAMPAIGN, password: crypto.randomBytes(18).toString("base64url"),
        attrs: body.attrs, skills: body.skills
      });
      Object.assign(character, { demo: true, expiresAt });
      character.profile = { ...character.profile, profession: profissao, employer: empregador, age: String(25 + crypto.randomInt(20)) };
      const info = character.sections.info[0].items;
      info.find(i => i.label === "Profissão").value = profissao;
      info.find(i => i.label === "Empregador").value = empregador;
      info.find(i => i.label === "Idade").value = character.profile.age;
      character.sections.main[0].items = [
        { id: newId(), label: "Características Distintivas", value: "Calmo sob pressão, observador" },
        { id: newId(), label: "Bonds", value: "Irmã mais nova; parceiro da academia" },
        { id: newId(), label: "Motivações", value: "Descobrir a verdade sobre o primeiro caso" }
      ];
      character.sections.inventory[0].items = [
        { id: newId(), label: "Distintivo e credencial", value: "1" },
        { id: newId(), label: "Lanterna tática", value: "1" },
        { id: newId(), label: "Kit de primeiros socorros", value: "1" }
      ];
      character.sections.combat[0].items = [
        { id: newId(), label: "Pistola 9mm", value: "1D10 | Pistola leve | 15 (15m)" }
      ];
      await salvarNovo(character);
      await writeLog({ name: character.name, role: "player" }, character, "ficha de teste criada");
      const session = { role: "player", name: character.name, campaign: character.campaign };
      const restante = Math.floor((expiresAt.getTime() - agora().getTime()) / 1000);
      const token = signToken({ sub: idStr(character._id), ...session }, jwtSecret(), { expiresIn: restante, issuer: ISSUER });
      return { token, session, data: serialize(character) };
    },

    async login(body) {
      if (body.mode === "master") {
        const ok = safeEqual(normalizeName(body.username), normalizeName(handlerName()))
          && await verifyMasterPassword(String(body.password || ""));
        if (!ok) fail(401, "Credenciais do Handler inválidas.");
        const session = { role: "master", name: handlerName(), campaign: env.GM_CAMPAIGN || "TODAS" };
        const docs = await characters().find(masterQuery(session)).sort({ campaign: 1, name: 1 }).toArray();
        return { token: sign({ sub: `master:${normalizeName(handlerName())}`, ...session }), session, data: docs.map(serialize) };
      }

      const _id = toId(body.characterId);
      if (!_id) fail(400, "Agente inválido.");
      const character = await characters().findOne({ _id });
      if (!character || expirada(character) || !(await comparePassword(String(body.password || ""), character.passwordHash))) {
        fail(401, "Chave de acesso inválida.");
      }
      const session = { role: "player", name: character.name, campaign: character.campaign };
      return { token: sign({ sub: idStr(character._id), ...session }), session, data: serialize(character) };
    }
  };

  // ---------- ações que exigem login ----------
  const privateActions = {
    async state(session) {
      const clean = { role: session.role, name: session.name, campaign: session.campaign };
      if (session.role === "master") {
        const docs = await characters().find(masterQuery(session)).sort({ campaign: 1, name: 1 }).toArray();
        return { session: clean, data: docs.map(serialize) };
      }
      const _id = toId(session.sub);
      if (!_id) fail(401, "Sessão inválida.");
      const character = await characters().findOne({ _id });
      if (!character || expirada(character)) fail(404, "Agente não encontrado (fichas de teste expiram sozinhas).");
      return { session: clean, data: serialize(character) };
    },

    updateAttribute(session, body) {
      if (session.role !== "master") fail(403, "Somente o Handler altera atributos.");
      const key = String(body.key || "").toUpperCase();
      if (!ATTRIBUTES.includes(key)) fail(400, "Atributo inválido.");
      return mutate(session, body.characterId, c => {
        c.attrs ||= {};
        const old = c.attrs[key];
        c.attrs[key] = cleanInteger(body.value, 1, 30);
        return `alterou ${key} de ${old} para ${c.attrs[key]}`;
      });
    },

    updateVital(session, body) {
      const key = String(body.key || "");
      if (!VITAL_KEYS.includes(key)) fail(400, "Valor inválido.");
      if (session.role !== "master" && (key.endsWith("Max") || key === "breakingPoint")) fail(403, "Somente o Handler altera valores máximos.");
      return mutate(session, body.characterId, c => {
        c.vitals ||= {};
        const old = c.vitals[key];
        c.vitals[key] = cleanInteger(body.value, key === "breakingPoint" ? -999 : 0, 999);
        return `alterou ${key} de ${old} para ${c.vitals[key]}`;
      });
    },

    updateItem(session, body) {
      return mutate(session, body.characterId, c => {
        const found = findSection(c, body.sectionId);
        if (!found) fail(404, "Seção não encontrada.");
        const isSkill = found.tab === "skills";
        if (isSkill && session.role !== "master") fail(403, "Somente o Handler altera o valor das perícias.");
        if (!isSkill) requireEditable(session, found.section, "Este campo só pode ser alterado pelo Handler.");
        const item = found.section.items.find(i => i.id === body.itemId);
        if (!item) fail(404, "Item não encontrado.");
        const old = item.value;
        item.value = cleanText(body.value, 5000);
        syncProfile(c, item);
        return `editou ${item.label}: ${cleanText(old, 120)} → ${cleanText(item.value, 120)}`;
      });
    },

    updateSkillCheck(session, body) {
      return mutate(session, body.characterId, c => {
        const found = findSection(c, body.sectionId);
        if (!found || found.tab !== "skills") fail(404, "Perícia não encontrada.");
        const item = found.section.items.find(i => i.id === body.itemId);
        if (!item) fail(404, "Perícia não encontrada.");
        item.checked = Boolean(body.checked);
        return `${item.checked ? "marcou" : "desmarcou"} evolução em ${item.label}`;
      });
    },

    addItem(session, body) {
      const label = cleanText(body.label, 100);
      if (!label) fail(400, "O item precisa de um nome.");
      return mutate(session, body.characterId, c => {
        const found = findSection(c, body.sectionId);
        if (!found) fail(404, "Seção não encontrada.");
        requireEditable(session, found.section, "Você não pode adicionar itens nesta seção.");
        if (found.section.items.length >= 200) fail(400, "Seção cheia.");
        const entry = { id: newId(), label, value: cleanText(body.value, 5000) };
        if (found.tab === "skills") entry.checked = false;
        found.section.items.push(entry);
        return `adicionou ${label} em ${found.section.title}`;
      });
    },

    deleteItem(session, body) {
      return mutate(session, body.characterId, c => {
        const found = findSection(c, body.sectionId);
        if (!found) fail(404, "Seção não encontrada.");
        requireEditable(session, found.section, "Você não pode excluir itens nesta seção.");
        const index = found.section.items.findIndex(i => i.id === body.itemId);
        if (index < 0) fail(404, "Item não encontrado.");
        const [removed] = found.section.items.splice(index, 1);
        return `excluiu ${removed.label} de ${found.section.title}`;
      });
    },

    uploadPhoto(session, body) {
      const photo = String(body.photo || "");
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(photo)) fail(400, "Formato de imagem inválido.");
      if (photo.length > 600_000) fail(413, "A imagem ficou grande demais.");
      return mutate(session, body.characterId, c => {
        c.photo = photo;
        return "atualizou a fotografia operacional";
      });
    },

    toggleStatus(session, body) {
      if (session.role !== "master") fail(403, "Somente o Handler altera o status vital.");
      return mutate(session, body.characterId, c => {
        c.status = c.status === "MORTO" ? "VIVO" : "MORTO";
        return `alterou o status vital para ${c.status}`;
      });
    },

    async logs(session) {
      if (session.role !== "master") fail(403, "Somente o Handler acessa os registros.");
      const docs = await logs().find(masterQuery(session)).sort({ createdAt: -1 }).limit(200).toArray();
      return {
        logs: docs.map(l => ({
          id: idStr(l._id), actor: l.actor, characterName: l.characterName,
          campaign: l.campaign, message: l.message, createdAt: l.createdAt
        }))
      };
    }
  };

  return async function handle(body = {}, authorization = "") {
    try {
      const action = String(body.action || "");
      if (Object.hasOwn(publicActions, action)) return { status: 200, body: { ok: true, ...(await publicActions[action](body)) } };
      if (!Object.hasOwn(privateActions, action)) fail(404, "Ação desconhecida.");
      const session = readSession(authorization);
      return { status: 200, body: { ok: true, ...(await privateActions[action](session, body)) } };
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, body: { ok: false, message: error.message } };
      console.error("Erro na API:", error);
      return { status: 500, body: { ok: false, message: "Erro interno do servidor." } };
    }
  };
}
