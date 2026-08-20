# placapi-node

Cliente oficial de **[PlacApi](https://placapi.com)** para Node.js y TypeScript.

Consulta el **RUNT** por placa, las multas del **SIMIT**, el **SOAT**, la **revisión
tecnomecánica**, el impuesto vehicular, el avalúo **FASECOLDA** y el **pico y placa** de 30
ciudades de Colombia — desde tu backend, en JSON, sin captchas.

Sin dependencias. Requiere Node 18 o superior.

## Instalación

```bash
npm install @placapi/client
```

## Uso

```ts
import { PlacApi } from "@placapi/client";

const placapi = new PlacApi({ apiKey: process.env.PLACAPI_KEY! });

// Ficha del RUNT: marca, línea, modelo, motor, chasis, SOAT y tecnomecánica
const ficha = await placapi.consulta({
  placa: "ABC123",
  docType: "CC",
  docNumber: "1010111935",
});

// Multas del SIMIT: solo necesita la placa
const multas = await placapi.multas({ placa: "ABC123" });

// ¿Tiene pico y placa hoy?
const pyp = await placapi.picoYPlaca({ placa: "ABC123" });
```

La API key se genera en <https://placapi.com/integracion>. El registro trae una consulta de
cortesía para probar sin comprar.

### Por qué el RUNT pide el documento del propietario

No es un capricho nuestro: el portal oficial exige placa **más** documento del titular como
control de privacidad, y esta API respeta ese diseño. Los endpoints que sí funcionan solo con
placa (`multas`, `avaluo`, `picoYPlaca`) son los que la fuente oficial expone así.

## Manejo de errores

```ts
import { PlacApi, PlacApiError } from "@placapi/client";

try {
  await placapi.consulta({ placa: "ABC123", docType: "CC", docNumber: "1010111935" });
} catch (e) {
  if (e instanceof PlacApiError) {
    console.error(e.status, e.code, e.message);
    if (e.retriable) { /* 429 o 5xx: reintentar */ }
  }
}
```

| Código | Qué significa | ¿Reintentar? | ¿Cobra? |
|---|---|---|---|
| `200` | Hay datos | — | Sí, 1 crédito (`consulta-full` cuesta 2) |
| `404` | La fuente oficial no tiene ese registro | **No**, el resultado sería el mismo | 10 gratis al mes por tipo, después sí |
| `402` | Sin créditos | No, compra saldo | No |
| `429` | Pasaste el límite de 1.000 por minuto | Sí, respetando `Retry-After` | No |
| `502` | La fuente oficial falló (`source_error`) | **Sí**, suele pasar al segundo intento | **No** |

El cliente ya reintenta los 429 y 5xx respetando `Retry-After`, con espera exponencial y tope
de 8 segundos. Se configura con `maxRetries`.

## Barrer muchas placas

No hay endpoint de lote: se hace con llamadas concurrentes contra el endpoint unitario, y así
es como se factura. El límite es **1.000 consultas por minuto por API key**.

```ts
const placas = ["ABC123", "DEF456" /* … */];
const LIMITE = 12; // concurrencia; subir con cuidado y vigilar los 429

const resultados: unknown[] = [];
for (let i = 0; i < placas.length; i += LIMITE) {
  const lote = placas.slice(i, i + LIMITE);
  resultados.push(
    ...(await Promise.all(lote.map((placa) => placapi.multas({ placa }).catch((e) => e)))),
  );
}
```

## Opciones

```ts
new PlacApi({
  apiKey: "pk_live_…",
  timeoutMs: 60_000, // las fuentes oficiales son lentas; no bajarlo sin medir
  maxRetries: 2,
  baseUrl: "https://placapi.com/api",
  fetch: miFetch, // inyectable, útil para tests
});
```

## Endpoints con método propio

Vehículo (placa + documento): `consulta` · `consultaFull` · `vehiculoBasico` · `aptoTraspaso` ·
`impuestos` · `perdidaTotal` · `garantiasRgm`
Solo placa: `multas` · `avaluo` · `picoYPlaca`
Persona: `licencia` · `comparendos`

El catálogo completo son **35 endpoints** (antecedentes, RUES, SISBEN, RUAF, SECOP, rama
judicial, cédula, licencias, Perú y México). Para cualquiera de ellos:

```ts
await placapi.call("rues", { docType: "NIT", docNumber: "900123456" });
```

Especificación OpenAPI: **[placapi-openapi](https://github.com/pipe0919/placapi-openapi)** ·
<https://placapi.com/openapi.json>

## Precio

1 crédito por consulta con datos. El crédito baja por volumen, los créditos **no vencen** y no
hay mensualidad. Tarifas vigentes en <https://placapi.com/comprar>.

## Licencia

MIT. El servicio que consume tiene sus propios [términos](https://placapi.com/terminos).
