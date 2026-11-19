// Delta Green — Sistema de Agentes (front-end)
import { DB_ARSENAL, DB_REGRAS, SKILLS_BASE } from "./dados.js";

const API = "/api";
const PONTOS_TREINO = 250;
const ATRIBUTOS = ["STR", "CON", "DEX", "INT", "POW", "CHA"];
const NOME_ATRIBUTO = { STR: "Força", CON: "Constituição", DEX: "Destreza", INT: "Inteligência", POW: "Poder", CHA: "Carisma" };
const VITAIS = [
  { rotulo: "PV", atual: "hpCurrent", max: "hpMax", classe: "pv", glossario: "Dano Grave" },
  { rotulo: "SAN", atual: "sanCurrent", max: "sanMax", classe: "san", glossario: "Breaking Point" },
  { rotulo: "PE", atual: "wpCurrent", max: "wpMax", classe: "pe", glossario: "Poder" }
];
const ABAS = ["main", "skills", "inventory", "combat", "info"];

const estado = {
  config: { campaigns: ["DELTA GREEN 0", "LALUTH"], handlerName: "HANDLER" },
  agentes: [],
  filtro: "TODAS",
  filtroMestre: "TODAS",
  token: lerSessao(),
  sessao: null,
  ficha: null,
  agentesMestre: [],
  abertaPeloMestre: false,
  aba: "main",
  alvoLogin: null,
  modoLogin: "player",
  contextoItem: null,
  categoriaArsenal: "Tudo",
  recrutamento: null,
  salvando: 0,
  timer: null
};

// ---------- utilitários ----------
const $ = id => document.getElementById(id);

function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) el.append(f instanceof Node ? f : String(f));
  return el;
}

function lerSessao() {
  try { return sessionStorage.getItem("dg.token") || ""; } catch { return ""; }
}
function gravarSessao(token) {
  try { token ? sessionStorage.setItem("dg.token", token) : sessionStorage.removeItem("dg.token"); } catch { /* sem armazenamento */ }
}

const numero = (v, padrao = 0) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : padrao);
const porcentagem = (a, m) => (numero(m) > 0 ? Math.max(0, Math.min(100, (numero(a) / numero(m)) * 100)) : 0);
const iniciais = nome => String(nome || "DG").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "DG";
const ehMestre = () => estado.sessao?.role === "master";
const secaoEditavel = secao => ehMestre() || Boolean(secao.dynamic);

function aviso(texto, tipo = "ok", tempo = 3400) {
  const el = h("div", { class: `aviso ${tipo === "ok" ? "" : tipo}`, role: "status", text: texto });
  const caixa = $("avisos");
  caixa.append(el);
  while (caixa.children.length > 3) caixa.firstElementChild.remove();
  // Fica por cima até das janelas abertas (camada superior do navegador).
  try { if (caixa.showPopover) { if (caixa.matches(":popover-open")) caixa.hidePopover(); caixa.showPopover(); } } catch { /* navegador antigo */ }
  setTimeout(() => el.remove(), tempo);
}

function ocupado(botao, sim, texto = "Aguarde...") {
  if (!botao) return;
  if (sim) { botao.dataset.textoOriginal = botao.textContent; botao.textContent = texto; botao.disabled = true; }
  else { botao.textContent = botao.dataset.textoOriginal || botao.textContent; botao.disabled = false; }
}

async function api(action, dados = {}, { auth = true, tempo = 15000 } = {}) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempo);
  const headers = { "Content-Type": "application/json" };
  if (auth && estado.token) headers.Authorization = `Bearer ${estado.token}`;
  try {
    const resp = await fetch(API, { method: "POST", headers, body: JSON.stringify({ action, ...dados }), signal: controle.signal, cache: "no-store" });
    let corpo;
    try { corpo = await resp.json(); } catch { throw Object.assign(new Error("O servidor respondeu de um jeito inesperado."), { status: resp.status }); }
    if (!resp.ok || !corpo.ok) {
      if (resp.status === 401 && auth && estado.token) encerrarSessao(false);
      throw Object.assign(new Error(corpo.message || `Erro ${resp.status}`), { status: resp.status });
    }
    return corpo;
  } catch (erro) {
    if (erro.name === "AbortError") throw new Error("A operação demorou demais. Tente de novo.");
    if (erro instanceof TypeError) throw new Error("Sem conexão com o comando.");
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

function abrir(id) {
  const d = $(id);
  if (!d.open) d.showModal();
}
function fechar(id) {
  const d = $(id);
  if (d.open) d.close();
}

// ---------- telas ----------
function mostrarTela(nome) {
  for (const t of ["lobby", "ficha", "mestre"]) $(`tela-${t}`).classList.toggle("hidden", t !== nome);
  window.scrollTo({ top: 0 });
  atualizarTopo();
}

function atualizarTopo() {
  $("sessao").classList.toggle("hidden", !estado.sessao);
  $("sessao-nome").textContent = estado.sessao ? `${ehMestre() ? "Handler" : "Agente"}: ${estado.sessao.name}` : "";
}

// ---------- lobby ----------
function desenharFiltros(alvo, atual, aoEscolher) {
  const lista = ["TODAS", ...estado.config.campaigns];
  alvo.replaceChildren(...lista.map(c => h("button", {
    type: "button", role: "tab", "aria-selected": String(c === atual), text: c,
    onclick: () => aoEscolher(c)
  })));
}

function desenharLobby() {
  desenharFiltros($("filtros"), estado.filtro, c => { estado.filtro = c; desenharLobby(); });
  const grade = $("grade-agentes");
  const lista = estado.agentes.filter(a => estado.filtro === "TODAS" || a.campaign === estado.filtro);
  if (!lista.length) {
    grade.replaceChildren(h("div", { class: "estado" },
      h("strong", { text: "Nenhum agente nesta operação" }),
      "Use “Novo recrutamento” para registrar o primeiro."));
    return;
  }
  grade.replaceChildren(...lista.map(a => {
    const morto = a.status === "MORTO";
    return h("button", { type: "button", class: `cartao-agente ${morto ? "morto" : ""}`, onclick: () => abrirLogin(a), "aria-label": `Entrar como ${a.name}` },
      h("div", { class: "cartao-capa" },
        avatar(a.photo, a.name),
        morto && h("span", { class: "selo-kia", text: "K.I.A." })),
      h("div", { class: "cartao-corpo" },
        h("div", { class: "cartao-nome", text: a.name }),
        h("div", { class: "cartao-prof", text: a.profession || "Agente de campo" }),
        h("div", { class: "cartao-meta" },
          h("div", {}, h("span", { text: "Operação" }), h("strong", { text: a.campaign })),
          h("div", {}, h("span", { text: "Status" }), h("strong", { text: a.status || "VIVO" })))));
  }));
}

function avatar(foto, nome) {
  if (foto && foto.startsWith("data:image/")) return h("img", { class: "avatar", src: foto, alt: "" });
  return h("div", { class: "avatar", "aria-hidden": "true", text: iniciais(nome) });
}

async function carregarLobby() {
  const grade = $("grade-agentes");
  grade.replaceChildren(...Array.from({ length: 4 }, () => h("div", { class: "esqueleto" })));
  try {
    const [config, lista] = await Promise.all([api("config", {}, { auth: false }), api("list", {}, { auth: false })]);
    estado.config = config.config;
    estado.agentes = lista.characters;
    desenharLobby();
  } catch (erro) {
    grade.replaceChildren(h("div", { class: "estado erro" },
      h("strong", { text: "Conexão com o comando indisponível" }), erro.message,
      h("br"), h("button", { class: "btn btn-fantasma", type: "button", text: "Tentar de novo", onclick: carregarLobby })));
  }
}

// ---------- login ----------
function abrirLogin(agente) {
  estado.modoLogin = "player";
  estado.alvoLogin = agente;
  $("login-titulo").textContent = agente.name;
  $("login-sub").textContent = `Operação ${agente.campaign} — digite a chave de acesso do agente.`;
  $("campo-usuario").classList.add("hidden");
  $("login-usuario").required = false;
  $("login-senha").value = "";
  abrir("dlg-login");
  $("login-senha").focus();
}

function abrirLoginMestre() {
  estado.modoLogin = "master";
  estado.alvoLogin = null;
  $("login-titulo").textContent = "Acesso do Handler";
  $("login-sub").textContent = "Somente o mestre da mesa.";
  $("campo-usuario").classList.remove("hidden");
  $("login-usuario").required = true;
  $("login-usuario").value = "";
  $("login-senha").value = "";
  abrir("dlg-login");
  $("login-usuario").focus();
}

async function entrar(evento) {
  evento.preventDefault();
  const botao = $("btn-entrar");
  const senha = $("login-senha").value;
  if (!senha) return aviso("Digite a chave de acesso.", "alerta");
  const dados = estado.modoLogin === "master"
    ? { mode: "master", username: $("login-usuario").value, password: senha }
    : { mode: "player", characterId: estado.alvoLogin?.id, password: senha };
  ocupado(botao, true, "Verificando...");
  try {
    const r = await api("login", dados, { auth: false });
    estado.token = r.token;
    gravarSessao(r.token);
    fechar("dlg-login");
    aplicarEstado(r.session, r.data);
    iniciarAtualizacao();
    aviso(estado.modoLogin === "master" ? "Handler autenticado." : "Acesso liberado.");
  } catch (erro) {
    aviso(erro.message, "erro");
    $("login-senha").select();
  } finally {
    ocupado(botao, false);
  }
}

function aplicarEstado(sessao, dados) {
  estado.sessao = sessao;
  if (sessao.role === "master") {
    estado.agentesMestre = dados || [];
    estado.abertaPeloMestre = false;
    desenharMestre();
    mostrarTela("mestre");
  } else {
    estado.abertaPeloMestre = false;
    desenharFicha(dados);
    mostrarTela("ficha");
  }
}

async function restaurarSessao() {
  if (!estado.token) return;
  try {
    const r = await api("state");
    aplicarEstado(r.session, r.data);
    iniciarAtualizacao();
  } catch {
    encerrarSessao(false);
  }
}

function encerrarSessao(recarregar = true) {
  estado.token = "";
  estado.sessao = null;
  estado.ficha = null;
  estado.agentesMestre = [];
  gravarSessao("");
  pararAtualizacao();
  mostrarTela("lobby");
  if (recarregar) carregarLobby();
}

// ---------- recrutamento ----------
const d6 = () => 1 + Math.floor(Math.random() * 6);

function rolarAtributo(i) {
  const dados = [d6(), d6(), d6(), d6()].sort((a, b) => a - b);
  return { id: `r${i}`, dados, valor: dados[1] + dados[2] + dados[3], usadoEm: null };
}

function novoRecrutamento() {
  estado.recrutamento = {
    rolagens: Array.from({ length: 6 }, (_, i) => rolarAtributo(i)),
    escolhida: null,
    atribuicoes: Object.fromEntries(ATRIBUTOS.map(a => [a, null])),
    pericias: { ...SKILLS_BASE }
  };
}

function valoresRecrutamento() {
  const r = estado.recrutamento;
  return Object.fromEntries(ATRIBUTOS.map(a => [a, r.rolagens.find(x => x.id === r.atribuicoes[a])?.valor ?? null]));
}

function desenharRecrutamento() {
  const r = estado.recrutamento;
  $("rec-dados").replaceChildren(...r.rolagens.map(rol => h("button", {
    type: "button", class: `dado ${r.escolhida === rol.id ? "escolhido" : ""}`, disabled: Boolean(rol.usadoEm),
    text: rol.valor, title: `${rol.dados.join(" + ")} (descartado ${rol.dados[0]})`,
    "aria-label": `Resultado ${rol.valor}`,
    onclick: () => { r.escolhida = r.escolhida === rol.id ? null : rol.id; desenharRecrutamento(); }
  })));

  const valores = valoresRecrutamento();
  $("rec-atributos").replaceChildren(...ATRIBUTOS.map(a => h("button", {
    type: "button", class: `rec-attr ${valores[a] ? "cheio" : ""}`,
    onclick: () => atribuir(a)
  }, h("span", { text: a }), h("strong", { text: valores[a] ?? "—" }), h("small", { text: valores[a] ? "devolver" : NOME_ATRIBUTO[a] }))));

  const completo = Object.values(valores).every(Number.isFinite);
  const pv = completo ? Math.ceil((valores.STR + valores.CON) / 2) : "—";
  const san = completo ? valores.POW * 5 : "—";
  const bp = completo ? san - valores.POW : "—";
  $("rec-derivados").replaceChildren(
    ...[["PV", pv], ["PE", completo ? valores.POW : "—"], ["SAN", san], ["BREAKING POINT", bp]]
      .map(([rot, val]) => h("div", {}, h("span", { text: rot }), h("strong", { text: val }))));
}

function atribuir(atributo) {
  const r = estado.recrutamento;
  const atual = r.atribuicoes[atributo];
  if (atual) {
    r.rolagens.find(x => x.id === atual).usadoEm = null;
    r.atribuicoes[atributo] = null;
  } else {
    const rol = r.rolagens.find(x => x.id === r.escolhida);
    if (!rol) return aviso("Escolha um resultado primeiro.", "alerta");
    rol.usadoEm = atributo;
    r.atribuicoes[atributo] = rol.id;
    r.escolhida = null;
  }
  desenharRecrutamento();
}

const pontosGastos = () => Object.entries(estado.recrutamento.pericias)
  .reduce((soma, [nome, valor]) => soma + Math.max(0, valor - SKILLS_BASE[nome]), 0);

function desenharPericiasRecrutamento() {
  $("rec-pericias").replaceChildren(...Object.entries(SKILLS_BASE).map(([nome, base]) => {
    const entrada = h("input", {
      type: "number", min: base, max: 80, value: estado.recrutamento.pericias[nome],
      "aria-label": `${nome}, base ${base}%`,
      onchange: e => {
        const valor = Math.max(base, Math.min(80, numero(e.target.value, base)));
        const anterior = estado.recrutamento.pericias[nome];
        estado.recrutamento.pericias[nome] = valor;
        if (pontosGastos() > PONTOS_TREINO) {
          estado.recrutamento.pericias[nome] = anterior;
          aviso(`Limite de ${PONTOS_TREINO} pontos atingido.`, "alerta");
        }
        e.target.value = estado.recrutamento.pericias[nome];
        e.target.classList.toggle("mexido", estado.recrutamento.pericias[nome] > base);
        $("rec-pontos").textContent = PONTOS_TREINO - pontosGastos();
      }
    });
    return h("label", { class: "rec-pericia" }, h("span", {}, nome, " ", h("small", { text: `${base}%` })), entrada);
  }));
  $("rec-pontos").textContent = PONTOS_TREINO - pontosGastos();
}

function abrirRecrutamento() {
  novoRecrutamento();
  $("rec-operacao").replaceChildren(h("option", { value: "", text: "Escolha..." }),
    ...estado.config.campaigns.map(c => h("option", { value: c, text: c })));
  $("form-recrutar").reset();
  desenharRecrutamento();
  desenharPericiasRecrutamento();
  abrir("dlg-recrutar");
  $("rec-nome").focus();
}

async function criarAgente(evento) {
  evento.preventDefault();
  const nome = $("rec-nome").value.trim();
  const senha = $("rec-senha").value;
  const operacao = $("rec-operacao").value;
  const attrs = valoresRecrutamento();
  if (!nome || !operacao) return aviso("Preencha nome e operação.", "alerta");
  if (senha.length < 4) return aviso("A chave precisa de pelo menos 4 caracteres.", "alerta");
  if (!Object.values(attrs).every(Number.isFinite)) return aviso("Distribua os seis resultados nos atributos.", "alerta");
  const botao = $("btn-criar");
  ocupado(botao, true, "Registrando...");
  try {
    await api("create", { name: nome, password: senha, campaign: operacao, attrs, skills: estado.recrutamento.pericias }, { auth: false, tempo: 20000 });
    fechar("dlg-recrutar");
    aviso(`${nome} registrado. Agora é só entrar com a sua chave.`);
    await carregarLobby();
  } catch (erro) {
    aviso(erro.message, "erro", 5000);
  } finally {
    ocupado(botao, false);
  }
}

// ---------- ficha ----------
function desenharFicha(ficha) {
  if (!ficha) return;
  estado.ficha = ficha;
  const morto = ficha.status === "MORTO";
  $("tela-ficha").classList.toggle("ficha-morto", morto);
  $("ficha-nome").textContent = ficha.name;
  $("ficha-operacao").textContent = `Operação // ${ficha.campaign}`;
  $("ficha-status").textContent = ficha.status || "VIVO";
  $("ficha-status").classList.toggle("morto", morto);
  $("ficha-kia").classList.toggle("hidden", !morto);
  $("ficha-profissao").textContent = ficha.profile?.profession || "";
  $("btn-voltar-mestre").classList.toggle("hidden", !estado.abertaPeloMestre);

  const temFoto = ficha.photo?.startsWith("data:image/");
  $("ficha-foto").classList.toggle("hidden", !temFoto);
  if (temFoto) $("ficha-foto").src = ficha.photo; else $("ficha-foto").removeAttribute("src");
  $("ficha-iniciais").classList.toggle("hidden", temFoto);
  $("ficha-iniciais").textContent = iniciais(ficha.name);

  $("atributos").replaceChildren(...ATRIBUTOS.map(a => h("div", { class: "atributo" },
    h("button", { type: "button", class: "rotulo-glo", dataset: { glossario: NOME_ATRIBUTO[a] }, text: a }),
    h("input", {
      type: "number", value: ficha.attrs?.[a] ?? 0, readOnly: !ehMestre(), "aria-label": NOME_ATRIBUTO[a],
      dataset: { salvar: "atributo", chave: a, antigo: ficha.attrs?.[a] ?? 0 }
    }),
    h("small", { text: `×5 = ${numero(ficha.attrs?.[a]) * 5}%` }))));

  const v = ficha.vitals || {};
  $("vitais").replaceChildren(
    ...VITAIS.map(vit => h("div", { class: "vital" },
      h("div", { class: "vital-topo" },
        h("button", { type: "button", class: "rotulo-glo", dataset: { glossario: vit.glossario }, text: vit.rotulo }),
        h("div", { class: "vital-valores" },
          campoVital(vit.atual, v[vit.atual], false, `${vit.rotulo} atual`),
          "/",
          campoVital(vit.max, v[vit.max], !ehMestre(), `${vit.rotulo} máximo`))),
      h("div", { class: "trilho" }, h("div", { class: `preenche ${vit.classe}`, style: `width:${porcentagem(v[vit.atual], v[vit.max])}%` })))),
    h("div", { class: "bp" },
      h("button", { type: "button", class: "rotulo-glo", dataset: { glossario: "Breaking Point" }, text: "Breaking Point" }),
      h("div", { class: "vital-valores" }, campoVital("breakingPoint", v.breakingPoint, !ehMestre(), "Breaking Point"))));

  desenharAba();
}

function campoVital(chave, valor, somenteLeitura, rotulo) {
  return h("input", {
    type: "number", value: valor ?? 0, readOnly: somenteLeitura, "aria-label": rotulo,
    dataset: { salvar: "vital", chave, antigo: valor ?? 0 }
  });
}

function trocarAba(aba) {
  estado.aba = aba;
  for (const b of document.querySelectorAll("#abas button")) b.setAttribute("aria-selected", String(b.dataset.aba === aba));
  desenharAba();
}

function desenharAba() {
  const f = estado.ficha;
  const alvo = $("aba-conteudo");
  const secoes = f.sections?.[estado.aba] || [];
  const blocos = [];
  if (estado.aba === "info" && f.status === "MORTO") blocos.push(h("div", { class: "aviso-morte", text: "⚠ Agente declarado morto em operação ⚠" }));
  if (!secoes.length) blocos.push(h("div", { class: "painel vazio", text: "Nenhuma informação registrada." }));
  for (const s of secoes) blocos.push(desenharSecao(s));
  alvo.replaceChildren(...blocos);
}

function desenharSecao(secao) {
  const ehArma = String(secao.title).toUpperCase().includes("ARMA");
  const ehPericia = estado.aba === "skills";
  const acoes = h("div", { class: "secao-acoes" },
    ehArma && secaoEditavel(secao) && h("button", { type: "button", class: "btn btn-fantasma btn-mini", text: "Arsenal", onclick: () => abrirArsenal(secao) }),
    (secaoEditavel(secao) && (!ehPericia || ehMestre())) && h("button", { type: "button", class: "btn btn-verde btn-mini", text: "+ Adicionar", onclick: () => abrirNovoItem(secao) }));

  let itens;
  if (!secao.items?.length) itens = h("div", { class: "vazio", text: "Seção vazia." });
  else if (ehPericia) itens = h("div", { class: "pericias" }, secao.items.map(i => linhaPericia(secao, i)));
  else itens = h("div", { class: "itens" }, secao.items.map(i => linhaItem(secao, i, ehArma)));

  return h("section", { class: "painel" }, h("div", { class: "secao-topo" }, h("h3", { text: secao.title }), acoes), itens);
}

function linhaItem(secao, item, ehArma) {
  const editavel = secaoEditavel(secao);
  let valor;
  if (ehArma) {
    const [dano = "", tipo = "", municao = ""] = String(item.value || "").split("|").map(p => p.trim());
    valor = h("div", { class: "arma" }, ...[["dano", dano, "Dano"], ["tipo", tipo, "Tipo"], ["municao", municao, "Munição / alcance"]]
      .map(([campo, v, dica]) => h("input", {
        class: "campo-valor", value: v, placeholder: dica, readOnly: !editavel, "aria-label": `${item.label}: ${dica}`,
        dataset: { salvar: "arma", campo, secao: secao.id, item: item.id, antigo: item.value || "" }
      })));
  } else {
    const longo = estado.aba === "info" || String(item.value || "").length > 50;
    valor = h(longo ? "textarea" : "input", {
      class: "campo-valor", value: item.value ?? "", readOnly: !editavel, rows: longo ? 2 : undefined,
      "aria-label": item.label, dataset: { salvar: "item", secao: secao.id, item: item.id, antigo: item.value ?? "" }
    });
  }
  return h("div", { class: "linha-item" },
    h("button", { type: "button", class: "rotulo-glo", dataset: { glossario: item.label }, text: item.label }),
    valor,
    editavel ? h("button", { type: "button", class: "btn-x", text: "×", "aria-label": `Excluir ${item.label}`, onclick: () => excluirItem(secao, item) }) : h("span"));
}

function linhaPericia(secao, item) {
  const valor = String(item.value ?? "0").replace("%", "");
  return h("div", { class: "pericia" },
    h("input", {
      type: "checkbox", checked: Boolean(item.checked), title: "Marcar para evolução",
      "aria-label": `Marcar evolução de ${item.label}`,
      onchange: e => salvarMarcacao(secao, item, e.target)
    }),
    h("button", { type: "button", class: "rotulo-glo", dataset: { glossario: item.label }, text: item.label }),
    h("input", {
      class: "campo-valor", value: valor, readOnly: !ehMestre(), inputMode: "numeric", "aria-label": `${item.label} (%)`,
      dataset: { salvar: "item", secao: secao.id, item: item.id, antigo: valor }
    }),
    h("button", { type: "button", class: "btn-dado", text: "🎲", title: `Rolar ${item.label}`, "aria-label": `Rolar ${item.label}`, onclick: () => rolarPericia(item.label, numero(valor)) }));
}

// Regra do Delta Green: D100 ≤ perícia é sucesso. 01 e dígitos iguais com sucesso = crítico;
// 00 (100) e dígitos iguais com falha = desastre.
function rolarPericia(nome, alvo) {
  const r = 1 + Math.floor(Math.random() * 100);
  const iguais = r === 100 || (r % 11 === 0 && r < 100);
  const sucesso = r <= alvo;
  let resultado = sucesso ? "SUCESSO" : "FALHA";
  if (r === 1 || (sucesso && iguais)) resultado = "SUCESSO CRÍTICO";
  if (r === 100 || (!sucesso && iguais)) resultado = "DESASTRE";
  aviso(`${nome}: rolou ${String(r).padStart(2, "0")} contra ${alvo}% — ${resultado}`, sucesso ? "ok" : "erro", 5000);
}

async function salvarCampo(entrada) {
  const f = estado.ficha;
  if (!f || entrada.readOnly) return;
  const tipo = entrada.dataset.salvar;
  let valor = entrada.value;
  let antigo = entrada.dataset.antigo ?? "";
  let dados = { characterId: f.id };
  let acao;

  if (tipo === "atributo") { acao = "updateAttribute"; valor = numero(valor); dados = { ...dados, key: entrada.dataset.chave, value: valor }; }
  else if (tipo === "vital") { acao = "updateVital"; valor = numero(valor); dados = { ...dados, key: entrada.dataset.chave, value: valor }; }
  else if (tipo === "item") { acao = "updateItem"; dados = { ...dados, sectionId: entrada.dataset.secao, itemId: entrada.dataset.item, value: valor }; }
  else if (tipo === "arma") {
    const caixa = entrada.closest(".arma");
    valor = ["dano", "tipo", "municao"].map(c => caixa.querySelector(`[data-campo="${c}"]`).value.trim()).join(" | ");
    acao = "updateItem";
    dados = { ...dados, sectionId: entrada.dataset.secao, itemId: entrada.dataset.item, value: valor };
  } else return;

  if (String(valor) === String(antigo)) return;
  estado.salvando += 1;
  entrada.classList.add("salvando");
  try {
    const r = await api(acao, dados);
    atualizarFicha(r.character);
  } catch (erro) {
    aviso(erro.message, "erro");
    if (tipo !== "arma") entrada.value = antigo;
  } finally {
    entrada.classList.remove("salvando");
    estado.salvando -= 1;
  }
}

async function salvarMarcacao(secao, item, caixa) {
  try {
    const r = await api("updateSkillCheck", { characterId: estado.ficha.id, sectionId: secao.id, itemId: item.id, checked: caixa.checked });
    atualizarFicha(r.character, false);
  } catch (erro) {
    caixa.checked = !caixa.checked;
    aviso(erro.message, "erro");
  }
}

function atualizarFicha(ficha, redesenhar = true) {
  if (!ficha) return;
  estado.ficha = ficha;
  if (ehMestre()) {
    const i = estado.agentesMestre.findIndex(a => a.id === ficha.id);
    if (i >= 0) estado.agentesMestre[i] = ficha;
  }
  if (redesenhar) desenharFicha(ficha);
}

function abrirNovoItem(secao) {
  estado.contextoItem = secao;
  $("item-titulo").textContent = `Adicionar em ${secao.title.toLowerCase()}`;
  $("form-item").reset();
  abrir("dlg-item");
  $("item-nome").focus();
}

async function adicionarItem(evento) {
  evento.preventDefault();
  const secao = estado.contextoItem;
  const nome = $("item-nome").value.trim();
  if (!secao || !nome) return aviso("Dê um nome ao item.", "alerta");
  try {
    const r = await api("addItem", { characterId: estado.ficha.id, sectionId: secao.id, label: nome, value: $("item-valor").value.trim() });
    fechar("dlg-item");
    atualizarFicha(r.character);
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}

async function excluirItem(secao, item) {
  if (!confirm(`Excluir “${item.label}”?`)) return;
  try {
    const r = await api("deleteItem", { characterId: estado.ficha.id, sectionId: secao.id, itemId: item.id });
    atualizarFicha(r.character);
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}

// ---------- glossário ----------
function buscarGlossario(chave) {
  const bruto = String(chave || "").trim();
  const limpo = bruto.replace(/\s*\(\d+%?\)\s*/g, "").trim();
  const apelidos = { Montaria: "Cavalgar" };
  for (const k of [bruto, limpo, apelidos[limpo]]) if (k && DB_REGRAS[k]) return [k, DB_REGRAS[k]];
  const parcial = Object.keys(DB_REGRAS).find(k => limpo && (limpo.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(limpo.toLowerCase())));
  return parcial ? [parcial, DB_REGRAS[parcial]] : [bruto || "Informação", "Nenhuma descrição cadastrada para este campo."];
}

function mostrarGlossario(chave) {
  const [titulo, texto] = buscarGlossario(chave);
  $("glo-titulo").textContent = titulo;
  $("glo-texto").textContent = texto;
  abrir("dlg-glossario");
}

// ---------- arsenal ----------
function abrirArsenal(secao) {
  estado.contextoItem = secao;
  estado.categoriaArsenal = "Tudo";
  $("ars-busca").value = "";
  desenharArsenal();
  abrir("dlg-arsenal");
}

function desenharArsenal() {
  const cats = ["Tudo", ...new Set(DB_ARSENAL.map(a => a.cat))];
  $("ars-categorias").replaceChildren(...cats.map(c => h("button", {
    type: "button", "aria-selected": String(c === estado.categoriaArsenal), text: c,
    onclick: () => { estado.categoriaArsenal = c; desenharArsenal(); }
  })));
  const busca = $("ars-busca").value.trim().toLowerCase();
  const lista = DB_ARSENAL.filter(a => (estado.categoriaArsenal === "Tudo" || a.cat === estado.categoriaArsenal)
    && (!busca || `${a.nome} ${a.tipo} ${a.cat}`.toLowerCase().includes(busca)));
  $("ars-lista").replaceChildren(...(lista.length ? lista.map(a => h("button", { type: "button", class: "item-arsenal", onclick: () => adicionarArma(a) },
    h("span", { class: "tag", text: a.cat }), h("strong", { text: a.nome }),
    h("div", { class: "det" }, h("span", { text: a.tipo }), h("span", { class: "dano", text: a.dano })),
    h("div", { class: "det" }, h("span", { text: `Alcance ${a.range}` }), h("span", { text: `Cap. ${a.ammo}` })))) : [h("div", { class: "vazio", text: "Nada encontrado." })]));
}

async function adicionarArma(arma) {
  try {
    const r = await api("addItem", { characterId: estado.ficha.id, sectionId: estado.contextoItem.id, label: arma.nome, value: `${arma.dano} | ${arma.tipo} | ${arma.ammo} (${arma.range})` });
    fechar("dlg-arsenal");
    atualizarFicha(r.character);
    aviso(`${arma.nome} adicionada.`);
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}

// ---------- foto (recorte quadrado feito à mão, sem biblioteca) ----------
const recorte = { img: null, zoom: 1, x: 0, y: 0, arrastando: null };

function carregarFoto(arquivo) {
  if (!arquivo) return;
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) return aviso("Use uma imagem JPG, PNG ou WEBP.", "alerta");
  if (arquivo.size > 12 * 1024 * 1024) return aviso("A imagem pode ter no máximo 12 MB.", "alerta");
  const url = URL.createObjectURL(arquivo);
  const img = new Image();
  img.onload = () => {
    recorte.img = img; recorte.zoom = 1; recorte.x = 0; recorte.y = 0;
    $("recorte-zoom").value = 1;
    desenharRecorte();
    abrir("dlg-foto");
  };
  img.onerror = () => aviso("Não consegui abrir essa imagem.", "erro");
  img.src = url;
}

function desenharRecorte() {
  const c = $("recorte-canvas");
  const ctx = c.getContext("2d");
  const { img, zoom } = recorte;
  if (!img) return;
  const base = Math.max(c.width / img.width, c.height / img.height) * zoom;
  const w = img.width * base, hgt = img.height * base;
  const limX = Math.max(0, (w - c.width) / 2), limY = Math.max(0, (hgt - c.height) / 2);
  recorte.x = Math.max(-limX, Math.min(limX, recorte.x));
  recorte.y = Math.max(-limY, Math.min(limY, recorte.y));
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, (c.width - w) / 2 + recorte.x, (c.height - hgt) / 2 + recorte.y, w, hgt);
}

function ligarRecorte() {
  const area = $("recorte");
  const escala = () => $("recorte-canvas").width / area.clientWidth;
  area.addEventListener("pointerdown", e => { recorte.arrastando = { x: e.clientX, y: e.clientY }; area.setPointerCapture(e.pointerId); });
  area.addEventListener("pointermove", e => {
    if (!recorte.arrastando) return;
    recorte.x += (e.clientX - recorte.arrastando.x) * escala();
    recorte.y += (e.clientY - recorte.arrastando.y) * escala();
    recorte.arrastando = { x: e.clientX, y: e.clientY };
    desenharRecorte();
  });
  area.addEventListener("pointerup", () => { recorte.arrastando = null; });
  area.addEventListener("pointercancel", () => { recorte.arrastando = null; });
  $("recorte-zoom").addEventListener("input", e => { recorte.zoom = Number(e.target.value); desenharRecorte(); });
}

async function salvarFoto() {
  const botao = $("btn-salvar-foto");
  const dataUrl = $("recorte-canvas").toDataURL("image/jpeg", 0.82);
  ocupado(botao, true, "Enviando...");
  try {
    const r = await api("uploadPhoto", { characterId: estado.ficha.id, photo: dataUrl }, { tempo: 25000 });
    fechar("dlg-foto");
    atualizarFicha(r.character);
    aviso("Foto atualizada.");
  } catch (erro) {
    aviso(erro.message, "erro", 5000);
  } finally {
    ocupado(botao, false);
    $("entrada-foto").value = "";
  }
}

// ---------- handler ----------
function desenharMestre() {
  desenharFiltros($("filtros-mestre"), estado.filtroMestre, c => { estado.filtroMestre = c; desenharMestre(); });
  const lista = estado.agentesMestre.filter(a => estado.filtroMestre === "TODAS" || a.campaign === estado.filtroMestre);
  const grade = $("grade-mestre");
  if (!lista.length) {
    grade.replaceChildren(h("div", { class: "estado" }, h("strong", { text: "Nenhum agente aqui" }), "Os agentes aparecem assim que forem recrutados."));
    return;
  }
  grade.replaceChildren(...lista.map(a => {
    const v = a.vitals || {};
    const pv = porcentagem(v.hpCurrent, v.hpMax), san = porcentagem(v.sanCurrent, v.sanMax);
    const classe = a.status === "MORTO" ? "morto" : pv <= 25 || san <= 20 ? "perigo" : pv <= 50 || san <= 45 ? "alerta" : "";
    const barra = (rot, at, mx, cl) => h("div", { class: "cm-barra" },
      h("span", { text: rot }), h("div", { class: "trilho" }, h("div", { class: `preenche ${cl}`, style: `width:${porcentagem(at, mx)}%` })),
      h("span", { text: `${at ?? 0}/${mx ?? 0}` }));
    return h("article", { class: `cartao-mestre ${classe}` },
      h("div", { class: "cm-topo" }, avatar(a.photo, a.name),
        h("div", {}, h("div", { class: "cm-nome", text: a.name }), h("div", { class: "cm-sub", text: `${a.profile?.profession || "Agente"} // ${a.campaign}` }))),
      barra("PV", v.hpCurrent, v.hpMax, "pv"), barra("SAN", v.sanCurrent, v.sanMax, "san"), barra("PE", v.wpCurrent, v.wpMax, "pe"),
      h("div", { class: "cm-attrs" }, ATRIBUTOS.map(k => h("div", {}, h("span", { text: k }), h("strong", { text: a.attrs?.[k] ?? 0 })))),
      h("div", { class: "cm-acoes" },
        h("button", { type: "button", class: "btn btn-verde", text: "Abrir ficha", onclick: () => abrirFichaDoMestre(a.id) }),
        h("button", { type: "button", class: a.status === "MORTO" ? "btn btn-fantasma" : "btn btn-perigo", text: a.status === "MORTO" ? "Reativar" : "K.I.A.", title: "Alternar status vital", onclick: () => alternarStatus(a) })));
  }));
}

function abrirFichaDoMestre(id) {
  const ficha = estado.agentesMestre.find(a => a.id === id);
  if (!ficha) return;
  estado.abertaPeloMestre = true;
  desenharFicha(ficha);
  mostrarTela("ficha");
}

function voltarAoMestre() {
  estado.abertaPeloMestre = false;
  estado.ficha = null;
  desenharMestre();
  mostrarTela("mestre");
}

async function alternarStatus(agente) {
  const novo = agente.status === "MORTO" ? "VIVO" : "MORTO";
  if (!confirm(`Marcar ${agente.name} como ${novo}?`)) return;
  try {
    const r = await api("toggleStatus", { characterId: agente.id });
    atualizarFicha(r.character, false);
    desenharMestre();
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}

async function abrirRegistros() {
  abrir("dlg-registros");
  const alvo = $("reg-lista");
  alvo.textContent = "Carregando registros...";
  try {
    const r = await api("logs");
    alvo.replaceChildren(...(r.logs.length ? r.logs.map(l => h("div", { class: "log" },
      h("span", { class: "log-hora", text: new Date(l.createdAt).toLocaleString("pt-BR") }),
      h("span", { class: "log-ator", text: l.actor || "SISTEMA" }),
      h("span", { text: `${l.characterName || "—"}: ${l.message}` }))) : [h("span", { text: "Nenhum registro ainda." })]));
  } catch (erro) {
    alvo.textContent = erro.message;
  }
}

// ---------- atualização automática ----------
function iniciarAtualizacao() {
  pararAtualizacao();
  estado.timer = setInterval(() => atualizar(false), 8000);
}
function pararAtualizacao() {
  clearInterval(estado.timer);
  estado.timer = null;
}

async function atualizar(forcar) {
  if (!estado.sessao || document.hidden || estado.salvando) return;
  if (!forcar && document.activeElement?.matches("input, textarea, select")) return;
  if (document.querySelector("dialog[open]") && !forcar) return;
  try {
    const r = await api("state", {}, { tempo: 10000 });
    if (ehMestre()) {
      const antes = JSON.stringify(estado.agentesMestre.map(a => [a.id, a.version]));
      estado.agentesMestre = r.data || [];
      const mudou = antes !== JSON.stringify(estado.agentesMestre.map(a => [a.id, a.version]));
      if (mudou || forcar) {
        if (!$("tela-mestre").classList.contains("hidden")) desenharMestre();
        if (estado.ficha) {
          const nova = estado.agentesMestre.find(a => a.id === estado.ficha.id);
          if (nova && nova.version !== estado.ficha.version) desenharFicha(nova);
        }
      }
      if (forcar) aviso("Monitor atualizado.");
    } else if (r.data && r.data.version !== estado.ficha?.version) {
      desenharFicha(r.data);
    }
  } catch { /* tenta de novo no próximo ciclo */ }
}

// ---------- eventos ----------
function ligarEventos() {
  $("btn-inicio").addEventListener("click", () => {
    if (ehMestre()) voltarAoMestre();
    else if (estado.sessao && estado.ficha) mostrarTela("ficha");
    else mostrarTela("lobby");
  });
  $("btn-sair").addEventListener("click", () => encerrarSessao(true));
  $("btn-handler").addEventListener("click", abrirLoginMestre);
  $("btn-recrutar").addEventListener("click", abrirRecrutamento);
  $("form-login").addEventListener("submit", entrar);
  $("form-recrutar").addEventListener("submit", criarAgente);
  $("btn-rerrolar").addEventListener("click", () => { novoRecrutamento(); desenharRecrutamento(); desenharPericiasRecrutamento(); });
  $("form-item").addEventListener("submit", adicionarItem);
  $("btn-voltar-mestre").addEventListener("click", voltarAoMestre);
  $("btn-atualizar").addEventListener("click", () => atualizar(true));
  $("btn-registros").addEventListener("click", abrirRegistros);
  $("btn-foto").addEventListener("click", () => $("entrada-foto").click());
  $("entrada-foto").addEventListener("change", e => carregarFoto(e.target.files?.[0]));
  $("btn-salvar-foto").addEventListener("click", salvarFoto);
  $("ars-busca").addEventListener("input", desenharArsenal);
  $("abas").addEventListener("click", e => { const b = e.target.closest("button[data-aba]"); if (b) trocarAba(b.dataset.aba); });
  $("abas").addEventListener("keydown", e => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const i = ABAS.indexOf(estado.aba) + (e.key === "ArrowRight" ? 1 : -1);
    trocarAba(ABAS[(i + ABAS.length) % ABAS.length]);
    document.querySelector(`#abas [data-aba="${estado.aba}"]`).focus();
  });

  // Salva quando o campo perde o foco depois de mudar.
  $("tela-ficha").addEventListener("change", e => { if (e.target.dataset.salvar) salvarCampo(e.target); });
  $("tela-ficha").addEventListener("input", e => {
    if (e.target.dataset.salvar !== "vital") return;
    const vital = e.target.closest(".vital");
    if (!vital) return;
    const [at, mx] = vital.querySelectorAll("input");
    vital.querySelector(".preenche").style.width = `${porcentagem(at.value, mx.value)}%`;
  });
  document.addEventListener("click", e => {
    const glo = e.target.closest("[data-glossario]");
    if (glo) return mostrarGlossario(glo.dataset.glossario);
    if (e.target.closest("[data-fechar]")) e.target.closest("dialog")?.close();
    if (e.target.tagName === "DIALOG") e.target.close();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizar(false); });
  ligarRecorte();
}

async function iniciar() {
  ligarEventos();
  atualizarTopo();
  await carregarLobby();
  await restaurarSessao();
}

iniciar();
