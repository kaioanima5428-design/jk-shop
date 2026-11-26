/* ============================================================
   PASSE BOOYAH — FLUXO DE COMPRA (com retomada)
   1. Confirma o jogador (UID).
   2. Gera/reaproveita o Pix e exibe o QR Code.
   3. Ao pagar, envia o passe e redireciona para o status.

   Se o servidor cair no meio do fluxo, o estado é salvo no
   localStorage e retomado automaticamente quando o usuário voltar.
   ============================================================ */

import {
  confirmarJogador,
  comprarPasseBooyah,
  DEFAULT_REGION,
  traduzirErro,
} from "./passe-booyah.js";
import { criarPix, consultarPagamento } from "./pagamento.js";

const STORAGE_KEY = "jk-shop:compra";
const INTERVALO_MS = 4000;
const MSG_SERVIDOR_OFF =
  "Servidor temporariamente fora do ar. Seus dados foram salvos — volte mais tarde para continuar de onde parou.";

// DOM
const form = document.getElementById("fluxo-form");
const uidInput = document.getElementById("uid");
const regionInput = document.getElementById("region");
const emailInput = document.getElementById("email");
const confirmarBtn = document.getElementById("confirmar-btn");

const contaCard = document.getElementById("conta-card");
const contaNome = document.getElementById("conta-nome");
const contaMeta = document.getElementById("conta-meta");
const contaConfirm = document.getElementById("conta-confirm");

const pixSection = document.getElementById("pix-section");
const pixQr = document.getElementById("pix-qr");
const pixCopia = document.getElementById("pix-copia");
const pixCopiarBtn = document.getElementById("pix-copiar-btn");
const pixLink = document.getElementById("pix-link");
const pixStatus = document.getElementById("pix-status");

const statusEl = document.getElementById("fluxo-status");

let contaConfirmada = null;
let pagamentoId = null;
let situacao = null;
let timer = null;
let finalizando = false;

/* ------------------------------------------------------------
   Persistência (localStorage)
   ------------------------------------------------------------ */
function persistir(pedidoId = null) {
  const estado = {
    uid: uidInput.value.trim(),
    region: regionInput.value.trim() || DEFAULT_REGION,
    email: emailInput.value.trim(),
    pagamentoId,
    situacao,
    pedidoId,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
  } catch {
    /* armazenamento indisponível */
  }
}

function carregarEstado() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function limparEstado() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignora */
  }
}

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function ehServidorOff(err) {
  return Boolean(err?.isNetworkError);
}

function mensagemErro(err) {
  return ehServidorOff(err) ? MSG_SERVIDOR_OFF : traduzirErro(err);
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status${type ? ` status--${type}` : ""}`;
}

function limparStatus() {
  statusEl.textContent = "";
  statusEl.className = "status";
}

function mostrarConta(conta) {
  if (!conta) {
    contaCard.hidden = true;
    contaNome.textContent = "";
    contaMeta.textContent = "";
    contaConfirm.textContent = "";
    return;
  }

  contaNome.textContent = conta.nickname || conta.nome || "Jogador";
  contaMeta.replaceChildren();

  const tags = [
    conta.uid ?? conta.id,
    conta.nivel != null ? `Nível ${conta.nivel}` : null,
    conta.likes != null ? `${conta.likes} likes` : null,
    conta.regiao || conta.region || DEFAULT_REGION,
  ].filter(Boolean);

  for (const text of tags) {
    const tag = document.createElement("span");
    tag.className = "conta-card__tag";
    tag.textContent = text;
    contaMeta.appendChild(tag);
  }

  contaConfirm.textContent =
    conta.confirmar || conta.mensagem || "Confira se é a conta certa antes de pagar.";

  contaCard.hidden = false;
}

function exibirPix(pix) {
  if (pix.qrCodeBase64) {
    pixQr.src = `data:image/png;base64,${pix.qrCodeBase64}`;
  }
  if (pix.copiaECola) {
    pixCopia.value = pix.copiaECola;
  }
  if (pix.ticketUrl) {
    pixLink.href = pix.ticketUrl;
  }
  pixSection.hidden = false;
}

/* ------------------------------------------------------------
   Fluxo
   ------------------------------------------------------------ */
async function confirmar() {
  const uid = uidInput.value.trim();
  const email = emailInput.value.trim();

  if (!uid) {
    setStatus("Informe o UID do jogador.", "erro");
    return;
  }
  if (!email) {
    setStatus("Informe o e-mail para o Pix.", "erro");
    return;
  }

  confirmarBtn.disabled = true;
  limparStatus();
  setStatus("Consultando conta...", "info");

  try {
    const conta = await confirmarJogador(
      uid,
      regionInput.value.trim() || DEFAULT_REGION
    );
    contaConfirmada = conta;
    mostrarConta(conta);
    persistir();

    await gerarPix(uid, email);
  } catch (err) {
    contaConfirmada = null;
    mostrarConta(null);
    if (ehServidorOff(err)) persistir();
    setStatus(mensagemErro(err), "erro");
  } finally {
    confirmarBtn.disabled = false;
  }
}

async function gerarPix(uid, email) {
  limparStatus();
  setStatus("Gerando Pix...", "info");

  try {
    const pix = await criarPix({ uid, email });

    if (!pix.pagamentoId) {
      setStatus("Não foi possível gerar o Pix. Tente novamente.", "erro");
      return;
    }

    pagamentoId = pix.pagamentoId;
    situacao = pix.situacao;
    persistir();

    // Se já estava pago (pagamento reaproveitado), segue direto.
    if (pix.situacao === "pago") {
      setStatus("Pagamento já aprovado. Enviando seu passe...", "info");
      await finalizarCompra();
      return;
    }

    exibirPix(pix);

    if (pix.reutilizado) {
      setStatus("Pagamento pendente encontrado. Aguardando pagamento...", "info");
    } else {
      setStatus("Pix gerado. Aguardando pagamento...", "info");
    }

    agendarVerificacao();
  } catch (err) {
    if (ehServidorOff(err)) persistir();
    setStatus(mensagemErro(err), "erro");
  }
}

async function verificarPagamento() {
  if (!pagamentoId || finalizando) return;

  try {
    const resultado = await consultarPagamento(pagamentoId);
    situacao = resultado.situacao;

    if (situacao === "pago") {
      persistir();
      pixStatus.textContent = "Pagamento aprovado! Enviando seu passe...";
      pixStatus.className = "status status--ok pix__status";
      await finalizarCompra();
      return;
    }

    if (situacao === "recusado") {
      persistir();
      pixStatus.textContent = "Pagamento não aprovado. Tente novamente.";
      pixStatus.className = "status status--erro pix__status";
      pararTimer();
      return;
    }

    // pendente / desconhecido -> continua aguardando
    pixStatus.textContent = "Aguardando pagamento...";
    agendarVerificacao();
  } catch (err) {
    if (ehServidorOff(err)) {
      persistir();
      pixStatus.textContent = MSG_SERVIDOR_OFF;
      pixStatus.className = "status status--erro pix__status";
      pararTimer();
      return;
    }

    pixStatus.textContent = traduzirErro(err);
    pixStatus.className = "status status--erro pix__status";
    agendarVerificacao();
  }
}

async function finalizarCompra() {
  if (finalizando) return;
  finalizando = true;
  pararTimer();

  const uid = uidInput.value.trim();
  const region = regionInput.value.trim() || DEFAULT_REGION;

  try {
    const resultado = await comprarPasseBooyah(uid, region);

    if (resultado.pedido) {
      // Salva o pedido para o caso de o redirecionamento falhar.
      persistir(resultado.pedido);
      window.location.href = `pedido.html?pedido=${encodeURIComponent(
        resultado.pedido
      )}&uid=${encodeURIComponent(uid)}`;
      return;
    }

    setStatus("Passe enviado, mas não foi possível identificar o pedido.", "erro");
  } catch (err) {
    // Pagamento não está mais válido (já foi usado/consumido/expirado):
    // o estado antigo não serve mais — limpa e pede nova compra.
    if (err?.data?.erro === "PAGAMENTO_NAO_CONFIRMADO" || err?.status === 402) {
      limparEstado();
      contaConfirmada = null;
      pagamentoId = null;
      situacao = null;
      pixSection.hidden = true;
      setStatus(
        "Seu pagamento anterior já foi utilizado ou expirou. Inicie uma nova compra.",
        "erro"
      );
    } else if (ehServidorOff(err)) {
      // Pagamento confirmado, mas servidor caiu: preserva para retomar o envio.
      situacao = "pago";
      persistir();
      setStatus(mensagemErro(err), "erro");
    } else {
      setStatus(mensagemErro(err), "erro");
    }
  } finally {
    finalizando = false;
  }
}

function pararTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function agendarVerificacao() {
  pararTimer();
  timer = setTimeout(verificarPagamento, INTERVALO_MS);
}

/* ------------------------------------------------------------
   Retomada automática
   ------------------------------------------------------------ */
function restaurar() {
  const estado = carregarEstado();
  if (!estado || !estado.uid) return;

  uidInput.value = estado.uid || "";
  regionInput.value = estado.region || DEFAULT_REGION;
  emailInput.value = estado.email || "";
  pagamentoId = estado.pagamentoId || null;
  situacao = estado.situacao || null;

  setStatus("Retomando seu pedido...", "info");

  // 1. Pedido já enviado: só redireciona para o acompanhamento.
  if (estado.pedidoId) {
    window.location.href = `pedido.html?pedido=${encodeURIComponent(
      estado.pedidoId
    )}&uid=${encodeURIComponent(estado.uid)}`;
    return;
  }

  // 2. Pagamento confirmado, mas envio não terminou: retoma o envio.
  if (situacao === "pago" && pagamentoId) {
    finalizarCompra();
    return;
  }

  // 3. Já existe um Pix (pendente): reusa o QR e volta a checar o pagamento,
  //    sem reconfirmar o jogador — importante para celulares com pouca RAM,
  //    onde o navegador pode matar a aba enquanto o usuário abre o app do banco.
  if (pagamentoId) {
    gerarPix(uidInput.value.trim(), emailInput.value.trim());
    return;
  }

  // 4. Só a conta foi confirmada: reconfirma e gera o Pix.
  confirmar();
}

/* ------------------------------------------------------------
   Eventos
   ------------------------------------------------------------ */
confirmarBtn.addEventListener("click", confirmar);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  confirmar();
});

pixCopiarBtn.addEventListener("click", async () => {
  if (!pixCopia.value) return;
  try {
    await navigator.clipboard.writeText(pixCopia.value);
    pixCopiarBtn.textContent = "Copiado!";
    setTimeout(() => {
      pixCopiarBtn.textContent = "Copiar";
    }, 1500);
  } catch {
    pixCopia.select();
  }
});

// Se o UID mudar manualmente, descarta o progresso salvo.
uidInput.addEventListener("input", () => {
  if (contaConfirmada || pagamentoId) {
    contaConfirmada = null;
    pagamentoId = null;
    situacao = null;
    pararTimer();
    pixSection.hidden = true;
    mostrarConta(null);
    limparStatus();
    limparEstado();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pararTimer();
  } else if (pagamentoId && !finalizando) {
    // Usuário voltou (ex.: fechou o app do banco): checa o pagamento já.
    verificarPagamento();
  }
});

// Garante que o estado mais recente fique salvo antes de a página ser
// congelada/encerrada pelo navegador (comum em celulares com pouca RAM).
window.addEventListener("pagehide", () => {
  if (uidInput.value.trim() || pagamentoId) {
    persistir();
  }
});

/* Retoma o fluxo salvo, se existir. */
restaurar();
