# Verificación del MVP — Ruvik

Estado real del producto, contrastado contra el código y contra la aplicación en
ejecución. Sustituye a la lista de casillas anterior, que llevaba cifras obsoletas y no
decía en qué estado estaba nada.

> **Verificado el 2026-09-05.** 309 tests en 17 ficheros · 33 pantallas en 3 roles.
> Al añadir tests o rutas, corrige las cifras aquí o el documento vuelve a mentir.

| | Significado |
|---|---|
| ✅ | Funciona de punta a punta y hay tests que lo sujetan. |
| ⚠️ | Existe, pero es un contrato o una simulación: hay que conectarle algo real. |
| ❌ | No existe. |

---

## 1. Estado por área

### Cliente

| | Funcionalidad | Evidencia |
|---|---|---|
| ✅ | Búsqueda por texto, categoría, ciudad, tipo de precio y valoración, con 5 ordenaciones | `discovery/service.ts:79` |
| ✅ | Perfil público con servicios, portafolio, horarios y reseñas en una sola consulta | `discovery/service.ts:203` |
| ✅ | Solicitud de cotización, y aceptación o rechazo con cancelación de las competidoras | `quotes/service.ts:356` |
| ✅ | Seguimiento de solicitudes y consulta de facturas | `customer/routes.ts:117` |
| ✅ | Valoración solo tras completar, una por trabajo, con recálculo del rating | `customer/routes.ts:236` |
| ✅ | Centro de notificaciones | `notifications/routes.ts` |
| ✅ | Consentimiento de WhatsApp con registro inmutable y palabra STOP | `whatsapp/service.ts:251` |
| ✅ | Exportación de datos | `account/routes.ts:139` |
| ⚠️ | Eliminación de cuenta: marca `pending_deletion` y **ningún proceso la completa** | `account/routes.ts:205` |

### Proveedor

| | Funcionalidad | Evidencia |
|---|---|---|
| ✅ | Panel con leads, trabajos próximos, dinero pendiente y actividad de 6 meses | `provider/routes.ts:478` |
| ✅ | CRM de clientes con búsqueda por texto | `crm/routes.ts:32` |
| ✅ | Pipeline de 8 estados con transiciones validadas en servidor (409 si es ilegal) | `crm/jobStatus.ts`, `crm/routes.ts:398` |
| ✅ | Notas internas frente a comentarios visibles, separados en SQL, no en la interfaz | `customer/routes.ts:190` |
| ✅ | Constructor de cotizaciones y PDF real con PDFKit, con hash SHA-256 | `lib/pdf.ts`, `workers/handlers.ts:15` |
| ✅ | Registro de pagos con bloqueo de fila, saldos y recibos numerados | `invoices/service.ts:328` |
| ✅ | Calendario (formato agenda) | `crm/routes.ts:511` |
| ✅ | Listados de servicios con límite de plan aplicado en servidor | `provider/routes.ts:372` |
| ✅ | Perfil de negocio | `provider/routes.ts:37` |
| ❌ | **Solicitar la verificación**: solo un admin puede poner a alguien en `pending` | `admin/providerService.ts:167` |

### Administración

| | Funcionalidad | Evidencia |
|---|---|---|
| ✅ | Métricas con cubos que cuadran con el total y enlaces a la lista que cuentan | `admin/routes.ts:44` |
| ✅ | Ciclo de vida del proveedor en dos ejes, con acciones según estado | `lib/providerLifecycle.ts`, `docs/admin-provider-lifecycle.md` |
| ✅ | Suspensión y bloqueo con revocación inmediata de sesiones | `admin/providerService.ts` |
| ✅ | Moderación de reseñas con recálculo del rating | `admin/routes.ts` |
| ✅ | Auditoría encadenada y verificable, con canonicalización de metadatos | `lib/audit.ts` |
| ⚠️ | Tickets de soporte: existe la API, **no existe la pantalla** | `admin/routes.ts` |

### Seguridad

Todo verificado: Argon2id, TOTP, rotación de refresh con detección de reutilización, RBAC
con aislamiento de inquilinos (lectura cruzada → 404, no 403), límites de tasa por
endpoint, idempotencia en rutas de dinero, webhooks firmados con ventana de 5 minutos y
deduplicación, almacenamiento privado con URLs firmadas, Zod en toda entrada, totales
siempre calculados en servidor. 51 tests de seguridad.

Corregido en esta revisión: el nivel de autenticación (`aal`) se perdía al refrescar el
token, así que un admin con 2FA caía a `aal1` a los 15 minutos y toda ruta `requireMfa`
empezaba a devolver 403.

### Diseño y frontend

| | | Evidencia |
|---|---|---|
| ✅ | Sistema de tokens: color, espaciado, radios, elevación, tipografía | `styles/theme.css` |
| ✅ | Tema claro/oscuro nativo con `light-dark()` y sin parpadeo inicial | `theme.css`, `index.html` |
| ✅ | Biblioteca de componentes compartida, no estilos sueltos | `components/ui.tsx` |
| ✅ | Estados de carga, vacío y error consistentes en todas las listas | `lib/useApi.ts` |
| ✅ | Accesibilidad: foco atrapado en modales, foco al navegar, `aria-invalid` conectado | `ui.tsx:64`, `App.tsx:102` |
| ✅ | PWA: manifiesto, service worker sin `skipWaiting`, áreas seguras, objetivos de 44px | `vite.config.ts:21` |
| ⚠️ | 157 usos de `style={{…}}` sueltos en pantallas: usan tokens, pero viven fuera del CSS | — |

---

## 2. Qué falta — Diseño

| Falta | Por qué importa |
|---|---|
| **Onboarding del proveedor** | Un proveedor nuevo aterriza en un panel vacío con dos avisos y tiene que descubrir solo el perfil, los servicios y el plan. Es el mayor agujero de activación. |
| **Pantalla para subir documentos y pedir verificación** | El propio panel de admin dice *"No documents uploaded. Confirm licence and insurance out of band"*. La confianza del marketplace depende de esto. |
| **Pantalla de soporte** | Ajustes dice "contacta con soporte" y no hay a dónde ir. |
| **Preferencias de notificación** | Solo hay un interruptor de WhatsApp. No se puede elegir canal ni categoría. |
| Calendario en rejilla mensual | Hoy es una agenda por días. Funciona; no es lo que se espera al leer "Calendario". |
| Aviso de instalación del PWA e indicador de sin conexión | El service worker ya sirve sin red, pero nada se lo dice al usuario. |
| Flechas del teclado en `role="tablist"` | Dos controles con pestañas solo responden al ratón. |

## 3. Qué falta — Lógica de negocio

| Falta | Estado real |
|---|---|
| **El proveedor no puede pedir su verificación** | Ninguna ruta de proveedor escribe `verification_status`. El seed lo falsea con un UPDATE directo, que es la prueba de que no hay camino real. |
| **Borrar la cuenta no termina nunca** | `pending_deletion` se marca y se promete un plazo de 30 días. No hay trabajo, cron ni proceso que lo complete. |
| **El correo no se envía** | `sendEmail` es un `logger.info`. No hay SMTP ni proveedor transaccional en las dependencias. |
| **El antivirus no es un antivirus** | Busca `<script`, `<?php` y similares en los primeros 2KB. Un fichero infectado real pasa. |
| **Notificaciones push** | `notification.push` es una función vacía. Solo llegan las de dentro de la app y WhatsApp. |
| El dinero cliente→proveedor no pasa por la plataforma | Correcto según el modelo elegido: el proveedor declara lo que ha cobrado. Conviene tenerlo escrito para que nadie espere otra cosa. |

## 4. Qué falta — Modelo de suscripción

**Reparado en esta revisión** (antes la suscripción era decorativa):

- El plan gratuito se queda atrapado en `pending_payment` esperando un cobro de $0 que nunca
  llega → ahora se activa al instante, sin apunte de pago fantasma.
- El límite de anuncios se saltaba justo a quien no tenía plan, así que el plan gratuito era
  ilimitado y mejor que el de pago → ahora, sin plan conocido, se aplican los límites del plan
  más básico.
- Cancelar no tenía ninguna consecuencia pese a que la app prometía ocultar los anuncios →
  la visibilidad pública se deriva ahora del estado de la suscripción.
- `past_due` era eterno: nada sacaba nunca de él → 7 días de gracia y después `expired`.
- El botón "Switch to this plan" siempre devolvía 409 → se retira y se explica qué hacer.

**Lo que sigue faltando:**

| Falta | Nota |
|---|---|
| **Conectar Stripe** | Andamiaje listo en `modules/billing/stripe/` (firma, mapeo de estados, enrutado de eventos, cliente REST, Checkout y Portal). Falta cablearlo: ruta de webhook, manejadores y enrutar `startSubscription`. Ver el README de esa carpeta. |
| **Método de pago guardado** | No hay dónde guardar un token de tarjeta, así que no hay renovación automática. |
| **Reintentos de cobro** | Un fallo abre la ventana de gracia y no se vuelve a intentar. Stripe lo hace por su cuenta — y ahí hay un choque que resolver: sus reintentos duran unas tres semanas y nuestra gracia siete días. Documentado en el README de `stripe/`. |
| **Prueba gratuita** | `trial_days` existe en la tabla y **nunca se usa**: ningún camino crea una suscripción `trialing`. |
| **Cambio de plan y prorrateo** | No hay endpoint. Hoy hay que cancelar y volver a elegir. |
| **Factura y recibo de la propia cuota** | Todo el modelo fiscal de EE.UU. aplica a las facturas del proveedor a su cliente, no a lo que el proveedor paga a Ruvik. |
| `max_quotes_per_month` | Está en los planes y en el texto de marketing. No se comprueba en ningún sitio. |
| Planes anuales | El esquema los admite; no hay ninguno. El MRR sumaría el precio anual como si fuera mensual. |

---

## 5. Prioridad

**Bloqueante para cobrar**
1. Conectar Stripe (cobro + webhook real). Andamiaje preparado.
2. Método de pago guardado y renovación automática.
3. Factura o recibo de la cuota para el proveedor.

**Bloqueante para lanzar**
4. Que el proveedor pueda pedir su verificación y subir documentos.
5. Transporte de correo real.
6. Onboarding guiado del proveedor.
7. Completar el borrado de cuenta (obligación legal, no funcionalidad).

**Después**
8. Antivirus real, push, cambio de plan, prueba gratuita, pantalla de soporte,
   preferencias de notificación, planes anuales, calendario en rejilla.

---

## 6. Decisiones tomadas

| | |
|---|---|
| Monetización | Solo suscripción del proveedor. El dinero del trabajo va directo cliente→proveedor y la plataforma solo lo registra. |
| Impago | 7 días de gracia con avisos; después la suscripción pasa a `expired` y los anuncios dejan de aparecer. |
| Visibilidad | Se deriva de `is_published` + cuenta activa + suscripción viva. No se escribe: volver a pagar restaura la visibilidad sin restaurar estado. |
| Sin plan elegido | No aparece en el catálogo. Hay que elegir plan, aunque sea el gratuito. |
| Pasarela | **Stripe** (decisión revisada el 2026-09-19; antes PayPal). Checkout y Billing Portal alojados por Stripe, para que los datos de tarjeta no pasen por este servidor. |

---

## 7. Comandos de verificación

```
npm install                    # sin errores
npm run migrate && npm run seed # dataset demo consistente
npm run dev                    # API :4000 · web :5173
npm test                       # 309 tests en 17 ficheros
npm run typecheck              # limpio en ambos workspaces
npm run test:security          # 51 tests de seguridad
npm audit                      # limpio en ambos workspaces
node loadtest/run.mjs          # cumple los SLO
docker compose up --build      # levanta el stack de producción
```

Documentación de apoyo en `docs/`: `architecture.md`, `data-model.md`, `api.md`, `rbac.md`,
`threat-model.md`, `slo.md`, `testing.md`, `deployment.md`, `security-checklist.md` y
`admin-provider-lifecycle.md`.
