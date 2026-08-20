/**
 * Cliente oficial de PlacApi para Node.js y TypeScript.
 *
 * Envoltorio delgado sobre `fetch`: sin dependencias, sin estado global y sin
 * magia. Lo único que aporta sobre un `fetch` a mano es lo que de verdad cuesta
 * acertar contra esta API — el manejo del 429 con `Retry-After`, distinguir el
 * 502 (que NO cobra y sí conviene reintentar) del 404 (que no se reintenta
 * porque el resultado sería el mismo), y tipar las 35 operaciones.
 *
 * Documentación: https://placapi.com/docs
 * Especificación: https://placapi.com/openapi.json
 */

export const DEFAULT_BASE_URL = "https://placapi.com/api";

/** Documentos que acepta el RUNT para identificar al propietario. */
export type DocType = "CC" | "CE" | "NIT" | "TI" | "PA" | "PEP" | "PPT" | "RC";

export type ConsultaVehiculo = {
  placa: string;
  docType: DocType;
  docNumber: string;
};

export type ConsultaSoloPlaca = { placa: string };

export type ConsultaPersona = {
  docType: DocType;
  docNumber: string;
};

export type PlacApiOptions = {
  /** API key `pk_live_…`, generada en https://placapi.com/integracion */
  apiKey: string;
  baseUrl?: string;
  /** Milisegundos antes de abortar una consulta. Por defecto 60.000: las
   *  fuentes oficiales son lentas y varias resuelven captcha del lado servidor. */
  timeoutMs?: number;
  /** Reintentos ante 429 y 5xx. No aplica al 404 ni al 402. Por defecto 2. */
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
};

/**
 * Error de la API con el código HTTP a la vista.
 *
 * `retriable` distingue lo que vale la pena reintentar de lo que no:
 * - 429 y 5xx → sí (el 502 `source_error` además NO consume crédito)
 * - 404 → no; la fuente oficial no tiene ese registro y reintentar da lo mismo
 * - 401 y 402 → no; falta clave o falta saldo
 */
export class PlacApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly retriable: boolean;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const code =
      typeof body === "object" && body !== null && "code" in body
        ? String((body as { code: unknown }).code)
        : undefined;
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `PlacApi respondió ${status}`;
    super(message);
    this.name = "PlacApiError";
    this.status = status;
    this.code = code;
    this.retriable = status === 429 || status >= 500;
    this.body = body;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PlacApi {
  #apiKey: string;
  #baseUrl: string;
  #timeoutMs: number;
  #maxRetries: number;
  #fetch: typeof globalThis.fetch;

  constructor(options: PlacApiOptions) {
    if (!options?.apiKey) {
      throw new Error("Falta la API key. Se genera en https://placapi.com/integracion");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /**
   * Llama un endpoint cualquiera del catálogo. Los métodos con nombre de abajo
   * son azúcar sobre este; si aparece un endpoint nuevo, esto ya lo cubre.
   */
  async call<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.#baseUrl}/${path.replace(/^\/+/, "")}`;
    let ultimo: unknown;

    for (let intento = 0; intento <= this.#maxRetries; intento++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.#timeoutMs);
      try {
        const res = await this.#fetch(url, {
          method: "POST",
          headers: {
            "x-api-key": this.#apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });

        if (res.ok) return (await res.json()) as T;

        const payload = await res.json().catch(() => ({}));
        const err = new PlacApiError(res.status, payload);
        if (!err.retriable || intento === this.#maxRetries) throw err;

        // El servidor manda `Retry-After` en el 429. Respetarlo es la diferencia
        // entre esperar lo justo y quedar baneado por insistir.
        const cabecera = Number(res.headers.get("retry-after"));
        const espera = Number.isFinite(cabecera) && cabecera > 0
          ? cabecera * 1000
          : Math.min(2 ** intento * 1000, 8000);
        ultimo = err;
        await sleep(espera);
      } catch (e) {
        if (e instanceof PlacApiError) throw e;
        if (intento === this.#maxRetries) throw e;
        ultimo = e;
        await sleep(Math.min(2 ** intento * 1000, 8000));
      } finally {
        clearTimeout(t);
      }
    }
    throw ultimo instanceof Error ? ultimo : new Error("PlacApi: fallo desconocido");
  }

  // --- Vehículo (placa + documento del propietario) ---

  /** Ficha del RUNT: marca, línea, modelo, motor, chasis, SOAT y tecnomecánica. */
  consulta = (p: ConsultaVehiculo) => this.call("consulta", { ...p });
  /** Todo lo anterior más multas del SIMIT. Cuesta 2 créditos. */
  consultaFull = (p: ConsultaVehiculo) => this.call("consulta-full", { ...p });
  /** Subconjunto reducido de la ficha, más barato de procesar. */
  vehiculoBasico = (p: ConsultaVehiculo) => this.call("vehiculo-basico", { ...p });
  /** ¿Se puede traspasar? Responde con los bloqueos que lo impiden. */
  aptoTraspaso = (p: ConsultaVehiculo) => this.call("apto-traspaso", { ...p });
  /** Impuesto vehicular pendiente por año. */
  impuestos = (p: ConsultaVehiculo) => this.call("impuestos", { ...p });
  /** Siniestros y pérdida total, distinguiendo mayor de menor cuantía. */
  perdidaTotal = (p: ConsultaVehiculo) => this.call("perdida-total", { ...p });
  /** Garantías mobiliarias del RGM. Cobertura parcial: ver la respuesta. */
  garantiasRgm = (p: ConsultaVehiculo) => this.call("garantias-rgm", { ...p });

  // --- Solo placa ---

  /** Multas y comparendos del SIMIT. No pide documento del propietario. */
  multas = (p: ConsultaSoloPlaca) => this.call("multas", { ...p });
  /** Avalúo comercial FASECOLDA por placa. */
  avaluo = (p: ConsultaSoloPlaca) => this.call("avaluo", { ...p });
  /** Restricción de pico y placa hoy y mañana, en 30 ciudades. */
  picoYPlaca = (p: ConsultaSoloPlaca) => this.call("pico-y-placa", { ...p });

  // --- Persona ---

  /** Licencias de conducción por documento. */
  licencia = (p: ConsultaPersona) => this.call("licencia", { ...p });
  /** Comparendos asociados a un documento. */
  comparendos = (p: ConsultaPersona) => this.call("comparendos", { ...p });
}

export default PlacApi;
