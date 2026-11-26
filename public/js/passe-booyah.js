/**
 * Integração com a API de Passe Booyah (via backend local/tunnel).
 *
 * Estes helpers chamam o backend (API_URL em ./api.js), que faz o proxy para a
 * Tokito e injeta a chave privada. Nenhuma chave é exposta no navegador.
 *
 * Referência da Tokito: https://tokito-apis.com.br/painel/apis/passe-booyah/documentacao
 */

import { apiRequest } from "./api.js";

export const PASS_TYPES = {
  ELITE: "elite", // elite e booyah são o mesmo passe
  BOOYAH: "booyah",
};

export const DEFAULT_REGION = "BR";

/* ------------------------------------------------------------
   Endpoints
   ------------------------------------------------------------ */

/** Valida o UID e retorna a conta encontrada. Não envia passe nem desconta. */
export function confirmarJogador(uid, region = DEFAULT_REGION) {
  return apiRequest(
    `/api/v1/passe/confirmar?uid=${encodeURIComponent(uid)}&region=${encodeURIComponent(region)}`
  );
}

/** Solicita o envio imediato do passe. */
export function enviarPasse({
  uid,
  region = DEFAULT_REGION,
  tipo = PASS_TYPES.BOOYAH,
}) {
  return apiRequest("/api/v1/pass", {
    method: "POST",
    body: { uid, region, tipo },
  });
}

/** Consulta o status/entrega de um pedido. */
export function consultarStatus(pedido) {
  return apiRequest(
    `/api/v1/passe/status?pedido=${encodeURIComponent(pedido)}`
  );
}

/** Lista os pedidos da chave. */
export function listarPedidos() {
  return apiRequest("/api/v1/passe/list");
}

/** Retorna os tipos disponíveis (apenas "elite"/"booyah"). */
export function consultarTipos() {
  return apiRequest("/api/v1/passe/tipos");
}

/** Retorna saldo e capacidade de envio. */
export function consultarSaldo() {
  return apiRequest("/api/v1/passe/quota");
}

/** Consulta os passes disponíveis para a chave. */
export function consultarEstoque() {
  return apiRequest("/api/v1/passe/estoque");
}

/** Agenda o envio para o próximo mês (gerenciado pelo painel Tokito). */
export function reservarPasse({ uid, date, time, region = DEFAULT_REGION }) {
  return apiRequest("/api/v1/passe/reservar", {
    method: "POST",
    body: { uid, region, date, time },
  });
}

/** Lista as reservas agendadas. */
export function listarReservas() {
  return apiRequest("/api/v1/passe/reservas");
}

/** Cancela uma reserva ainda agendada. */
export function cancelarReserva(id) {
  return apiRequest(`/api/v1/passe/reservas/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * Fluxo completo de compra: confirma a conta, envia o passe e devolve o
 * pedido + status já normalizado para o PedidoAnimacao.
 */
export async function comprarPasseBooyah(uid, region = DEFAULT_REGION) {
  const conta = await confirmarJogador(uid, region);
  const envio = await enviarPasse({ uid, region });

  return {
    conta,
    envio,
    pedido:
      envio?.data?.order?.externalOrderId ?? envio?.pedido ?? envio?.order_id ?? null,
    status: normalizarStatus(envio),
  };
}

/* ------------------------------------------------------------
   Camada de adaptação: status da Tokito -> estados visuais
   (estados aceitos pelo PedidoAnimacao)
   ------------------------------------------------------------ */

export const ESTADOS = {
  PENDENTE: "pending",
  ENTREGUE: "delivered",
  CANCELADO: "cancelled",
};

const STATUS_TOKITO = {
  // entregue / enviado
  entregue: "delivered",
  sent: "delivered",
  delivered: "delivered",
  concluido: "delivered",
  success: "delivered",
  // pendente / em andamento
  pendente: "pending",
  pending: "pending",
  processing: "pending",
  processando: "pending",
  scheduled: "pending",
  agendado: "pending",
  executing: "pending",
  enviando: "pending",
  needs_review: "pending",
  // cancelado / falha
  cancelado: "cancelled",
  cancelled: "cancelled",
  cancelada: "cancelled",
  failed: "cancelled",
  falhou: "cancelled",
  falha: "cancelled",
};

/**
 * Converte o status da Tokito (string ou objeto de resposta) em um estado
 * visual do PedidoAnimacao: "pending" | "delivered" | "cancelled".
 *
 * Valor padrão "pending": nunca comemora sem confirmação de entrega.
 */
export function normalizarStatus(input) {
  const raw = extrairStatus(input);
  const key = String(raw ?? "").toLowerCase().trim();
  return STATUS_TOKITO[key] || STATUS_TOKITO[raw] || ESTADOS.PENDENTE;
}

function extrairStatus(input) {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";

  const d = input;

  // POST /api/v1/pass
  if (d.data?.order?.providerStatus) return d.data.order.providerStatus;
  if (d.data?.order?.status) return d.data.order.status;
  if (d.delivery_confirmed === true || d.entrega_confirmada === true) {
    return "entregue";
  }

  // GET /api/v1/send-passe
  if (typeof d.status_pedido === "string") return d.status_pedido;

  // GET /api/v1/passe/status
  if (typeof d.status === "string") return d.status;

  return "";
}

/* ------------------------------------------------------------
   Tradução de erros para mensagens amigáveis (sem detalhes técnicos)
   ------------------------------------------------------------ */

// Somente erros que fazem sentido para o cliente final. Erros internos
// (token/chave/provedor) viram "SERVICO_INDISPONIVEL" no backend e nunca
// chegam aqui com detalhe técnico.
const ERROS_AMIGAVEIS = {
  INVALID_UID: "UID inválido ou ausente.",
  SEM_ESTOQUE_PASSE: "Sem estoque de passe no momento.",
  PASS_ORDER_NOT_FOUND: "Pedido não encontrado.",
  RESERVATION_NOT_NEXT_MONTH: "A reserva deve ser para o próximo mês.",
  PASS_RESERVATION_EXISTS: "Já existe uma reserva ativa para este UID.",
  USE_RESERVATION_ENDPOINT: "Use o endpoint de reserva para agendar.",
  // Validações do próprio backend (visíveis ao usuário)
  UID_AUSENTE: "Informe o UID do jogador.",
  EMAIL_AUSENTE: "Informe o e-mail para o Pix.",
  PAGAMENTO_AUSENTE: "Pagamento não informado.",
  PAGAMENTO_NAO_CONFIRMADO: "Pagamento ainda não confirmado. Conclua o pagamento antes de continuar.",
  // Erro interno genérico (sem expor o motivo técnico)
  SERVICO_INDISPONIVEL: "Serviço temporariamente indisponível. Tente novamente em instantes.",
};

/**
 * Converte um erro em uma mensagem amigável. Nunca expõe detalhes técnicos
 * (mensagens brutas, códigos internos ou stack) ao usuário final — isso fica
 * registrado apenas no backend.
 */
export function traduzirErro(err) {
  const code = err?.data?.error || err?.data?.code || err?.data?.erro || "";
  if (code && ERROS_AMIGAVEIS[code]) return ERROS_AMIGAVEIS[code];
  return "Algo deu errado. Tente novamente em instantes.";
}
