/**
 * Integração com o pagamento Pix (backend via mp-facil).
 */

import { apiRequest } from "./api.js";

/** Cria um pagamento Pix e devolve QR Code + copia e cola. */
export function criarPix({ uid, email }) {
  return apiRequest("/api/pix/criar", {
    method: "POST",
    body: { uid, email },
  });
}

/** Consulta a situação de um pagamento Pix. */
export function consultarPagamento(pagamentoId) {
  return apiRequest(
    `/api/pix/status?pagamentoId=${encodeURIComponent(pagamentoId)}`
  );
}
