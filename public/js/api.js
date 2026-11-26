/**
 * Configuração central da API e cliente HTTP.
 *
 * ARQUITETURA:
 *   Front (Vercel)  ->  Backend local (tunnel)  ->  Tokito APIs
 *
 * A chave privada (pbk_live_...) NUNCA fica no navegador. O front fala apenas
 * com o backend (que injeta a chave e faz o proxy para a Tokito). Por isso a
 * base abaixo aponta para o backend, e não para a Tokito diretamente.
 *
 * Para trocar o destino (tunnel, por exemplo), altere apenas API_URL.
 */

export const API_URL = "http://jk.caiomultiversando.com.br";

/**
 * Junta a URL base com um caminho, removendo barras duplicadas.
 *
 * Ex.: apiUrl("/api/v1/pass") => "http://localhost:3000/api/v1/pass"
 */
export function apiUrl(path = "") {
  const base = API_URL.replace(/\/+$/, "");
  const cleanPath = String(path).replace(/^\/+/, "");
  return cleanPath ? `${base}/${cleanPath}` : base;
}

/**
 * Envolve fetch com JSON e tratamento de erro.
 *
 * @param {string} path Caminho relativo à API_URL.
 * @param {object} [options]
 * @param {string} [options.method="GET"]
 * @param {object} [options.body] Serializado como JSON quando presente.
 * @param {object} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<any>} Corpo da resposta já parseado (JSON ou texto).
 */
export async function apiRequest(
  path,
  { method = "GET", body, headers = {}, signal } = {}
) {
  // Timeout: se o backend estiver fora, não deixa o fetch pendurar indefinidamente.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const config = {
    method,
    headers: { Accept: "application/json", ...headers },
    signal: signal || controller.signal,
  };

  if (body !== undefined) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(apiUrl(path), config);
  } catch (err) {
    // Falha de rede/timeout (servidor fora do ar): marca para o front tratar.
    err.isNetworkError = true;
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const error = new Error(
      extrairMensagemErro(data) || `Erro ${response.status}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function extrairMensagemErro(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  return (
    data.message ||
    data.mensagem ||
    data.error ||
    data.erro ||
    data.msg ||
    ""
  );
}
