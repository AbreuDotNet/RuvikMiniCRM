# Auditoría de facturación para contratistas en EE. UU.

Revisión del flujo presupuesto → trabajo → factura → pago de Ruvik para oficios ejecutados
por personas individuales o proveedores pequeños: carpintería, drywall, pintura,
reparaciones, limpieza, mantenimiento y construcción ligera.

> **Esto no es asesoría fiscal ni legal.** Es una revisión de software. Las reglas
> definitivas dependen del estado, la localidad, el tipo de trabajo, los materiales y la
> situación del negocio, y cambian. Cada proveedor debe validar su configuración con un
> CPA o asesor fiscal antes de emitir facturas reales. Las secciones marcadas **[CPA]**
> son decisiones que el software no puede tomar.

---

## 1. Las reglas que importan aquí

### 1.1 Cuatro impuestos distintos que no deben mezclarse

El error más caro en un producto como este es tratarlos como uno solo. No lo son:

| | Qué grava | Quién lo cobra | ¿Aparece en la factura? |
|---|---|---|---|
| **Sales tax** | La transacción | El vendedor lo recauda del cliente y lo remite al estado | **Sí**, como línea separada |
| **Income tax** | El beneficio | El propio contribuyente, en su declaración | **No** |
| **Self-employment tax** | El rendimiento neto del trabajo por cuenta propia | El propio contribuyente | **No** |
| **Payroll withholding** | El salario de un empleado | El empleador, al pagar la nómina | **No** — no existe en este flujo |

Ruvik solo toca el primero. Es lo correcto, y conviene que quede escrito: **la aplicación
no debe retener nada de lo que factura el proveedor**. Verificado: no hay ningún concepto
de retención ni de nómina en el código.

### 1.2 W-2, 1099-NEC y negocio: tres situaciones diferentes

El IRS distingue al empleado del contratista independiente por el control: *"an individual
is an independent contractor if the person for whom the services are performed has the
right to control or direct only the result of the work and not what will be done and how
it will be done"*.

- **Empleado W-2** — normalmente **no factura** su salario al empleador. Su patrón retiene
  FICA e income tax. Si alguien en esta situación usa Ruvik para facturar a quien es de
  hecho su empleador, la clasificación puede ser incorrecta. **[CPA]**
- **Contratista independiente (1099-NEC)** — sí emite facturas. Quien le paga **no retiene
  nada**, y reporta los pagos en el Formulario 1099-NEC. El contratista declara en
  Schedule C y calcula el self-employment tax en Schedule SE.
- **Negocio / proveedor comercial** — además puede necesitar registro fiscal, permisos y
  recaudar sales tax, según estado, localidad, tipo de servicio y *nexus*.

**Ser trabajador independiente no significa no pagar impuestos.** El self-employment tax
es del **15,3 %** (12,4 % Social Security + 2,9 % Medicare) y se debe desde **$400** de
rendimiento neto. Hay una deducción de la porción equivalente al empleador y un 0,9 %
adicional de Medicare por encima de ciertos umbrales. El límite salarial de Social
Security cambia cada año: **no lo fijes en código**.

### 1.3 Sales tax: no hay tasa nacional

No existe sales tax federal. Hay tasas estatales, locales y de distrito que se combinan, y
varios estados no tienen sales tax general. Cualquier tasa por defecto en el producto sería
incorrecta para casi todos los usuarios.

Ruvik ya lo hace bien: la tasa es **por proveedor**, arranca en **0** y el campo queda en
blanco hasta que alguien lo configura. El tope de validación es 1500 bp (15 %), porque la
tasa combinada más alta de EE. UU. ronda el 12 % y cualquier cifra superior es un error de
tecleo o una tasa de IVA.

### 1.4 Obra sobre inmuebles: tres modelos estatales incompatibles

Aquí es donde un producto genérico se rompe. Tres estados, tres lógicas que no se parecen:

**Texas — residencial/no residencial × precio cerrado/desglosado**

La divergencia no es solo qué se grava, sino **quién paga el impuesto**:

| | Contrato *lump-sum* (precio cerrado) | Contrato *separated* (desglosado) |
|---|---|---|
| Residencial | El contratista paga el impuesto al comprar los materiales. **El cliente no paga sales tax.** | El contratista compra con certificado de reventa y **cobra el impuesto al cliente sobre los materiales**. *"The construction labor charge is not taxable."* |
| No residencial | Igual: el impuesto lo paga el contratista en la compra. | Cobra el impuesto al cliente sobre **materiales y mano de obra juntos**. |

**Esto tiene una consecuencia directa para el diseño del producto:** desglosar mano de obra
y materiales en líneas separadas **es en sí la elección** que convierte un contrato cerrado
en uno desglosado. Una aplicación que itemiza por defecto puede cambiar la posición fiscal
del contratista sin que él lo sepa. Ver el riesgo **C3**.

**Nueva York — mejora de capital frente a reparación**

El eje es otro. Una *capital improvement* está relevada; una reparación, mantenimiento o
instalación es gravable en mano de obra **y** materiales. Una mejora de capital debe
cumplir tres condiciones: añadir valor sustancial o prolongar apreciablemente la vida útil
del inmueble; quedar permanentemente incorporada de modo que retirarla causaría daño
material; y estar destinada a ser permanente.

Ejemplos oficiales: construir una terraza, instalar un calentador o montar armarios de
cocina son mejoras de capital. Reparar un escalón roto, sustituir un termostato o **pintar
armarios existentes** son trabajos gravables.

Y hay un requisito documental que el software debe soportar: el contratista solo queda
relevado si **el cliente le entrega el Formulario ST-124**, que debe conservar en sus
registros para justificar por qué no cobró el impuesto.

**Arizona — no es un sales tax, es un impuesto sobre el privilegio de operar**

El *transaction privilege tax* grava los ingresos brutos del contratista, no la venta al
cliente. En *prime contracting* (modificación) la base imponible es el **65 %** de los
ingresos brutos — una reducción del 35 % aplicada después de las demás deducciones. Las
actividades **MRRA** (mantenimiento, reparación, sustitución y alteración) quedan excluidas
del *prime contracting*, pero los materiales empleados siguen sujetos al TPT minorista.

### 1.5 Incertidumbres que el software no puede resolver **[CPA]**

- Si un trabajo concreto es reparación o mejora de capital. La frontera es de hecho, no de
  software: pintar armarios existentes y montar armarios nuevos se tratan al revés en NY.
- Si el inmueble es residencial o no residencial a efectos de Texas.
- Si el proveedor debe registrarse y en qué estados (*nexus*).
- Si conviene contratar a precio cerrado o desglosado.
- Qué certificados hay que exigir y cuánto tiempo conservarlos.
- La tasa combinada exacta de una dirección concreta.

---

## 2. Riesgos encontrados

### Críticos

**C1 — El PDF imprimía una tasa distinta de la cobrada.** `(taxRateBp / 100).toFixed(0)`
truncaba: una tasa del 8,25 % se imprimía como **"8 %"** en la copia del cliente mientras
se cobraba el 8,25 %. Un documento que se contradice a sí mismo en el importe es
exactamente lo que un cliente disputa y un auditor marca. **Corregido.**

**C2 — La justificación legal nunca llegaba al documento.** `taxTreatment` y `taxReason` se
declaraban en la interfaz del PDF, el worker los pasaba, y el renderizador **no los
imprimía nunca**. El comentario del código decía *"Printed beneath the line when no tax was
charged"* y era falso. Lo único que un auditor pide —por qué no se cobró— era lo único que
faltaba en el papel que lee. Peor: se imprimía la tasa almacenada junto a una línea exenta,
sugiriendo que la aritmética estaba mal. **Corregido.**

**C3 — Itemizar es una elección fiscal, y el producto la tomaba solo.** En Texas, desglosar
mano de obra y materiales convierte el contrato en *separated* y traslada la obligación de
recaudar al contratista. Ruvik itemiza por defecto y no registraba en ninguna parte bajo
qué tipo de contrato se había fijado el precio. **Mitigado**: `contract_type` se guarda en
presupuesto y factura y se imprime en el documento. **Sigue requiriendo que el proveedor
entienda la elección — [CPA].**

### Altos

**A1 — La jurisdicción salía del estado del proveedor, no del lugar del trabajo.** El
código tomaba `providers.tax_state` como jurisdicción del documento. La mayoría de estados
sitúan el impuesto donde se ejecuta o entrega el trabajo. Un contratista de Austin que
trabaja al otro lado de la frontera estatal emitía una factura que afirmaba una
jurisdicción equivocada. **Corregido**: la factura guarda dirección y fecha del servicio,
tomadas del trabajo y congeladas al emitir.

**A2 — El documento no podía sostener su propio tratamiento.** Se guardaba la conclusión
(`not_subject`) sin el hecho en que se apoya: no había ningún campo que dijera si la línea
era mano de obra o materiales. Sin eso no se puede reproducir ni defender la decisión.
**Corregido**: `line_kind` en presupuestos y facturas, y viaja del presupuesto a la factura.

**A3 — No había dónde anotar el certificado de exención.** Nueva York releva la mejora de
capital **solo** mientras el contratista conserve el ST-124 del cliente. No existía campo.
**Corregido**: `tax_exemption_certificate` por línea, impreso bajo la línea.

**A4 — `manual_adjustment` no existía.** Solo había tres tratamientos. Un ajuste hecho a
mano quedaba indistinguible de una exención, que es otra cosa y se audita distinto.
**Corregido**: cuarto tratamiento, cobra impuesto, exige motivo propio.

**A5 — `sent` y `viewed` eran lo mismo.** La columna `first_viewed_at` existía desde la
migración 002 y **nadie la escribía ni la leía**. El proveedor no podía distinguir "no lo
han abierto" de "no me están pagando". **Corregido** — y al añadir el estado aparecieron
**cinco filtros** que lo habrían dejado fuera: el total pendiente del panel, el del listado
de facturas, el guardián de borrado de cuenta, el filtro del listado y el barrido de
vencidas. Una factura vista habría desaparecido del dinero pendiente y **nunca se habría
marcado como vencida**. Los cinco ahora leen de una definición única.

### Medios

**M1 — El constructor de facturas de la app solo permite facturar un presupuesto
aceptado.** La API acepta líneas libres; la interfaz no. Consecuencia: en el camino directo
no hay forma de marcar una línea como exenta desde la app. Aceptable si el flujo siempre
pasa por presupuesto; hay que decidirlo explícitamente.

**M2 — Los depósitos no son un concepto de primera clase.** Un depósito *recibido* funciona
hoy como pago parcial, que es correcto. Un depósito *solicitado* en un presupuesto ahora
puede marcarse como `deposit`, pero no hay flujo dedicado ni se descuenta automáticamente
en la factura final. **[CPA]** en varios estados el momento del depósito puede adelantar el
devengo del impuesto.

**M3 — El descuento global se reparte también sobre las líneas exentas.** Es proporcional al
valor y reduce la base gravable en la parte correspondiente. Es defendible y está
documentado, pero un descuento pensado solo para la mano de obra reduciría indebidamente la
base de los materiales. Recomendación: un descuento dirigido a una línea debe modelarse
como cambio de precio de esa línea, no como descuento de documento.

**M4 — No hay historial de cambios por línea.** El log de auditoría registra eventos de
documento (creado, enviado, pagado, anulado) con hash encadenado, pero no el antes y el
después de una línea concreta.

**M5 — No hay campo para el identificador fiscal del negocio (EIN).** Esto es a la vez
seguro y limitante: no hay nada sensible que filtrar, pero algunos clientes comerciales
exigen el EIN en la factura. **Nunca añadir el SSN**: verificado que hoy no existe ningún
campo SSN/TIN en el sistema, y debe seguir así.

**M6 — El correo no se envía.** `sendEmail` es un `logger.info` sin transporte. La factura
se genera y se notifica dentro de la app, pero no sale por email.

**M7 — Tope de tasa incoherente.** Zod limita a 1500 bp; la restricción de la base de datos
permite 10000 bp. La validación protege, pero las dos cifras deberían coincidir.

### Bajos

- **B1** — El PDF no lleva bloque de instrucciones de pago ("Remit to").
- **B2** — `quantity numeric(12,3)`: tres decimales bastan para horas y metros, pero no
  para unidades que se vendan en milésimas.
- **B3** — Las notas fiscales del seed son ilustrativas; no deben leerse como asesoría.

---

## 3. Lo que ya estaba bien

Vale la pena decirlo, porque la base es sólida:

- **Toda la aritmética en centavos enteros.** Ni un `float` en el camino del dinero.
  Redondeo half-away-from-zero, **una sola vez por línea**.
- **El descuento reduce la base antes de calcular el impuesto**, de modo que no se cobra
  impuesto sobre dinero que el cliente no paga.
- **Reparto por resto mayor**: las partes suman exactamente el total, sin céntimos
  inventados ni perdidos.
- **Los totales se calculan siempre en el servidor.** Un total enviado por el cliente se
  ignora — hay test que lo prueba.
- **Numeración única y secuencial** por proveedor y año, con el contador bloqueado dentro
  de la transacción e índice único en base de datos.
- **Anular, no borrar.** Una factura con dinero cobrado no se puede anular.
- **Bloqueo de fila al registrar pagos**, con rechazo de sobrepagos.
- **Una factura por presupuesto**, con el número de la existente visible en el selector.
- **Lectura cruzada entre proveedores devuelve 404, no 403**, que no confirma la existencia.
- **El módulo de dinero está espejado en el frontend con test de paridad**, así que la vista
  previa no puede discrepar de lo que se factura.

---

## 4. Mejoras propuestas

### 4.1 Necesarias antes de producción

| | Estado |
|---|---|
| Corregir la tasa truncada en el PDF | **Hecho** |
| Imprimir el motivo y el certificado bajo la línea | **Hecho** |
| Guardar qué es cada línea (mano de obra / materiales) | **Hecho** |
| Guardar dirección y fecha del servicio en la factura | **Hecho** |
| Cuarto tratamiento `manual_adjustment` con motivo obligatorio | **Hecho** |
| Registrar e imprimir el tipo de contrato | **Hecho** |
| Estado `viewed` y los cinco filtros que dependían de él | **Hecho** |
| Transporte de correo real | Pendiente |
| Que cada proveedor confirme su configuración con un CPA | **[CPA]** |

### 4.2 Recomendadas para una fase siguiente

- **Conectar un proveedor de determinación fiscal** (Avalara, TaxJar o similar) detrás del
  `TaxProvider` que ya existe. El seam está hecho y declara `authoritative: false` para la
  implementación manual actual, que es honesta sobre ser la decisión del proveedor.
- **Constructor de factura libre** en la app, con la misma interfaz fiscal que el de
  presupuestos.
- **Depósitos como flujo propio**: solicitarlo en el presupuesto, cobrarlo, descontarlo.
- **Historial por línea**, no solo por documento.
- **EIN opcional** en el perfil, impreso solo si el proveedor lo activa.
- **Bloque de instrucciones de pago** en el PDF.
- **Aviso de umbral de $400** de self-employment tax, informativo y con enlace al IRS.

### 4.3 Lo que debe definir cada proveedor **[CPA]**

Campos que ya existen y hay que rellenar conscientemente:

| Campo | Qué decide |
|---|---|
| `tax_state` | Bajo qué reglas estatales factura |
| `default_tax_rate_bp` | Tasa combinada estatal + local. Arranca en 0 |
| `tax_jurisdiction_note` | Nota libre para dejar escrita la interpretación aplicada |
| `contract_type` por documento | Precio cerrado o desglosado — en Texas cambia quién paga |
| `line_kind` por línea | Mano de obra, materiales, equipo, tasa, reembolso |
| `tax_treatment` + `tax_reason` | Qué se aplicó y por qué |
| `tax_exemption_certificate` | Referencia del certificado que sostiene la exención |

Decisiones que no son campos: en qué estados hay que registrarse, si se compra con
certificado de reventa, cómo clasificar cada trabajo y cuánto conservar los certificados.

---

## 5. Cambios implementados

**Migración `005_invoice_tax_evidence.sql`**
- `line_kind` en `quote_items` e `invoice_items`
- `tax_treatment` amplía a `manual_adjustment`
- `tax_exemption_certificate` por línea
- `service_address_line`, `service_city`, `service_region`, `service_postal_code`,
  `service_date` en `invoices`
- `contract_type` en `quotes` e `invoices`
- `invoices.status` admite `viewed`

**Código**
- `lib/money.ts` y su espejo en el frontend: cuarto tratamiento, `LineKind`, y el impuesto
  se aplica bajo `taxable` **y** `manual_adjustment`.
- `lib/pdf.ts`: tasa sin truncar, importe del impuesto por línea, nota con motivo y
  certificado, bloque "work performed at", fecha de servicio, nota de tipo de contrato.
- `lib/invoiceStatus.ts` (nuevo): conjuntos de estados en un solo sitio.
- `middleware/validate.ts`: `LINE_KINDS`, `CONTRACT_TYPES`, motivo obligatorio también para
  el ajuste manual.
- Servicios de presupuesto y factura: persisten los campos nuevos y los transportan del
  presupuesto a la factura; la dirección del servicio se congela al emitir.
- `getInvoice`: transición a `viewed` la primera vez que la abre el cliente, sin retroceder
  desde `paid`.
- Constructor de presupuestos: selector de qué es la línea, campo de certificado y textos
  adaptados al ajuste manual.

**Pruebas — 42 nuevas, 351 en total**
- `tests/unit/invoiceDocument.test.ts` (21): formato de tasa, columna de impuesto, nota bajo
  la línea, `manual_adjustment` en los totales, reparto Texas materiales/mano de obra,
  invariante de bases, conjuntos de estados.
- `tests/integration/invoiceCompliance.test.ts` (21): el tipo de línea sobrevive del
  presupuesto a la factura; dirección del servicio registrada y congelada; motivo
  obligatorio; certificado guardado; total recalculado en servidor; factura duplicada
  rechazada; numeración única; sobrepago rechazado; pagos parciales sin deriva; `viewed` y
  su efecto en pendiente y vencidas; aislamiento entre proveedores con 404; borrador oculto
  al cliente; ningún identificador fiscal en la respuesta.

Un fallo real apareció durante el trabajo: al escribir `formatRateBp` con una expresión
regular, el script de parcheo se comió una barra invertida y `\.` quedó como `.` (cualquier
carácter), de modo que "6.50" se convertía en "6.". El test lo atrapó antes de salir. La
función se reescribió sin expresión regular.

---

## 6. Fuentes oficiales consultadas

- IRS — [Self-Employment Tax (Social Security and Medicare Taxes)](https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes)
- IRS — [Independent Contractor Defined](https://www.irs.gov/businesses/small-businesses-self-employed/independent-contractor-defined)
- Texas Comptroller of Public Accounts — [Publication 94-116, Real Property Repair and Remodeling](https://comptroller.texas.gov/taxes/publications/94-116.php)
- New York State Department of Taxation and Finance — [Capital Improvements (TB-ST-104)](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/capital_improvements.htm)
- New York State Department of Taxation and Finance — [Contractors: Repair, Maintenance, and Installation Services to Real Property](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/repair_maintenance.htm)
- New York State Department of Taxation and Finance — [Publication 862: Sales and Use Tax Classifications of Capital Improvements and Repairs to Real Property](https://www.tax.ny.gov/pdf/publications/sales/pub862.pdf)
- New York State Department of Taxation and Finance — [Form ST-124, Certificate of Capital Improvement](https://www.tax.ny.gov/pdf/current_forms/st/st124_fill_in.pdf)
- Arizona Department of Revenue — [Contracting Guidelines](https://azdor.gov/transaction-privilege-tax/contracting-guidelines), [MRRA Contracting](https://azdor.gov/transaction-privilege-tax/contracting-guidelines/mrra-contracting), [Modification Contracting](https://azdor.gov/transaction-privilege-tax/contracting-guidelines/modification-contracting)

Las cifras del IRS citadas (15,3 %, umbral de $400) son las publicadas en la página
consultada; **el límite salarial de Social Security cambia cada año** y debe comprobarse en
la fuente antes de usarlo en cualquier cálculo.

---

## 7. Nota final

Ruvik registra decisiones fiscales; no las toma. Esa es la postura correcta para un
producto que va a usarse en cincuenta jurisdicciones con reglas incompatibles, y los
cambios de esta revisión la refuerzan: ahora el documento guarda **los hechos** en los que
se apoya la decisión —qué se vendió, dónde se hizo el trabajo, bajo qué tipo de contrato y
con qué certificado— y no solo la conclusión.

Nada de esto sustituye la revisión de un CPA sobre la configuración de cada proveedor, ni
la validación de las reglas concretas del estado y la localidad donde opere.
