/* ============================================================
   PASSE BOOYAH — TELA DE STATUS DO PEDIDO
   Consulta o status real e alimenta a animação 3D.
   ============================================================ */

import { PedidoAnimacao, STATUS_INFO } from "./animacao-pedido.js";
import { consultarStatus, normalizarStatus, traduzirErro } from "./passe-booyah.js";

// A compra foi concluída: limpa o estado salvo no fluxo de compra.
try {
  localStorage.removeItem("jk-shop:compra");
} catch {
  /* ignora */
}

const params = new URLSearchParams(window.location.search);
const pedido = params.get("pedido");
const uid = params.get("uid");

const container = document.getElementById("pedido-animacao");
const statusWrap = document.getElementById("pedido-status");
const tituloEl = document.getElementById("pedido-titulo");
const descricaoEl = document.getElementById("pedido-descricao");
const metaEl = document.getElementById("pedido-meta");

const INTERVALO_MS = 5000;

let animacao = null;
let estadoAtual = null;
let timer = null;

function renderStatus(estado) {
  statusWrap.dataset.status = estado;
  const info = STATUS_INFO[estado] || STATUS_INFO.pending;
  tituloEl.textContent = info.title;
  descricaoEl.textContent = info.description;
}

function renderMeta() {
  const partes = [];
  if (pedido) partes.push(`Pedido: ${pedido}`);
  if (uid) partes.push(`UID: ${uid}`);
  metaEl.textContent = partes.join(" · ");
}

function renderErro(message) {
  renderStatus("pending");
  descricaoEl.textContent = message;
}

function pararTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function agendar() {
  pararTimer();
  timer = setTimeout(atualizar, INTERVALO_MS);
}

async function atualizar() {
  if (!pedido) {
    renderErro("Nenhum pedido informado. Volte e tente novamente.");
    return;
  }

  try {
    const resposta = await consultarStatus(pedido);
    const estado = normalizarStatus(resposta);

    if (!animacao) {
      animacao = new PedidoAnimacao();
      animacao.iniciar(container, estado);
      renderStatus(estado);
    } else if (estado !== estadoAtual) {
      animacao.atualizarStatus(estado);
      renderStatus(estado);
    }

    estadoAtual = estado;
    renderMeta();

    // Continua consultando apenas enquanto estiver pendente.
    if (estado === "pending") {
      agendar();
    } else {
      pararTimer();
    }
  } catch (err) {
    renderErro(traduzirErro(err));

    // Pedido não encontrado (404) não faz sentido ficar consultando.
    if (err?.status === 404) {
      pararTimer();
      return;
    }
    agendar();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pararTimer();
  } else if (estadoAtual === "pending") {
    atualizar();
  }
});

window.addEventListener("beforeunload", () => {
  if (animacao) animacao.destruir();
});

renderMeta();
atualizar();
