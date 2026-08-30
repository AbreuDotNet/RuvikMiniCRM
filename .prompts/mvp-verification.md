# MVP Verification Prompt - Ruvik Mini CRM

## Objetivo
Verificar que la lógica de negocio, arquitectura y funcionalidades estén completas y alineadas con el diseño del MVP de Ruvik.

---

## 1. VERIFICACIÓN DE FUNCIONALIDADES CORE

### Customer
- [ ] Búsqueda por keyword, categoría, ciudad, tipo de precio, rating
- [ ] Perfiles de proveedores con servicios, portafolio, horarios, reseñas
- [ ] Solicitud de cotizaciones
- [ ] Revisión y aceptación/rechazo de cotizaciones
- [ ] Seguimiento de solicitudes
- [ ] Visualización de facturas
- [ ] Calificación de trabajos completados
- [ ] Centro de notificaciones funcional
- [ ] Controles de consentimiento WhatsApp
- [ ] Exportación de datos y eliminación de cuenta

### Provider
- [ ] Dashboard con leads, trabajos próximos, dinero pendiente, actividad 6 meses
- [ ] CRM de clientes con búsqueda
- [ ] Pipeline de trabajos con 8 estados
- [ ] Transiciones de estado validadas
- [ ] Notas internas y comentarios para cliente
- [ ] Constructor de cotizaciones (< 2 minutos)
- [ ] PDF de cotizaciones y facturas personalizadas
- [ ] Registro de pagos con saldos
- [ ] Calendario integrado
- [ ] Listados de servicios
- [ ] Perfil de negocio y verificación

### Admin
- [ ] Métricas de plataforma (usuarios, ingresos, MRR, conversión, profundidad cola)
- [ ] Verificación de proveedores
- [ ] Suspensión de usuarios con revocación inmediata de sesión
- [ ] Moderación de reseñas y recálculo de ratings
- [ ] Auditoría tamper-evident con verificación de integridad
- [ ] Tickets de soporte

---

## 2. VERIFICACIÓN DE SEGURIDAD

- [ ] Contraseñas Argon2id implementadas
- [ ] TOTP MFA funcionando
- [ ] Rotación de refresh tokens con detección de robo
- [ ] RBAC con aislamiento strict de tenants
- [ ] Rate limits por endpoint
- [ ] Idempotencia en rutas de dinero
- [ ] Webhooks firmados con protección contra replay
- [ ] Object storage privado con URLs con expiración
- [ ] Audit log hash-chained
- [ ] Validación Zod en toda entrada de usuario
- [ ] Totales siempre calculados servidor-lado
- [ ] Cross-tenant reads retornan 404 (no 403)
- [ ] Solo webhooks firmados activan subscripciones

---

## 3. VERIFICACIÓN DE ARQUITECTURA

### Stack Validado
- [ ] Node 20 + Express + TypeScript en API
- [ ] PostgreSQL 15+ (PGlite en desarrollo)
- [ ] Job queue PostgreSQL-backed con SKIP LOCKED
- [ ] Redis opcional con fallback in-process
- [ ] React 18 + Vite + React Router 7
- [ ] PDFKit para documentos

### Request Lifecycle
- [ ] Middleware de validación aplicado consistentemente
- [ ] Context de request propagado
- [ ] Manejo de errores centralizado
- [ ] Logging estructurado

### Escalabilidad
- [ ] API stateless
- [ ] Workers como proceso separado
- [ ] Job queue durable
- [ ] Caché opcional

---

## 4. VERIFICACIÓN DE COBERTURA DE TESTS

- [ ] 141 tests pasando
- [ ] Tests unitarios para crypto, money, pagination, jobStatus
- [ ] Tests de integración infraestructura
- [ ] Tests E2E de flujos críticos
- [ ] Tests de seguridad (autenticación, autorización, ataques)
- [ ] Cobertura de rutas de dinero
- [ ] Cobertura de idempotencia
- [ ] SLOs verificados con load test

---

## 5. VERIFICACIÓN DE DATOS Y PERSISTENCIA

### Schema Database
- [ ] Migrations en `/db/migrations/` versionadas
- [ ] Índices optimizados
- [ ] Constraints definidas
- [ ] Foreign keys con cascade apropiado
- [ ] Audit log con hash-chain implementado

### Seed Data
- [ ] Dataset de demostración completo
- [ ] Usuarios por rol (Customer, Provider, Admin)
- [ ] Relaciones de datos realistas
- [ ] Datos para cargar test (provider con servicios, clientes, trabajos)

---

## 6. VERIFICACIÓN DE INTEGRACIÓN EXTERNA

### WhatsApp Business
- [ ] Contrato implementado
- [ ] Consentimiento verificado en send time (no queue time)
- [ ] Message log sin cuerpos ni números raw
- [ ] Simulación funcional

### Payment Gateway
- [ ] Contrato de webhook firmado implementado
- [ ] Tests del contrato
- [ ] Ready para conectar proveedor real

### Email
- [ ] Queued a través de worker contract
- [ ] Ready para configurar transporte

---

## 7. VERIFICACIÓN DE DOCUMENTACIÓN

- [ ] `architecture.md` - Forma, ciclo de request, path de escalado
- [ ] `data-model.md` - Schema, convenciones, índices
- [ ] `api.md` - Todos los endpoints, errores, paginación, límites
- [ ] `rbac.md` - Matriz de permisos, aislamiento de tenant
- [ ] `threat-model.md` - 12 threats con controls y tests
- [ ] `slo.md` - Disponibilidad, latencia, alertas
- [ ] `testing.md` - Estrategia y cobertura
- [ ] `deployment.md` - Config, topología, sizing
- [ ] `security-checklist.md` - Gate pre-release

---

## 8. CHECKLIST MVP FINAL

- [ ] `npm install` completa sin errores
- [ ] `npm run seed` genera dataset demo consistente
- [ ] `npm run dev` levanta API :4000 y web :5173
- [ ] `npm test` pasa 141 tests
- [ ] `npm run typecheck` limpio ambos workspaces
- [ ] `npm run test:security` pasa suites de seguridad
- [ ] `npm audit` limpio ambos workspaces
- [ ] `node loadtest/run.mjs` cumple SLOs
- [ ] `docker compose up --build` levanta stack production
- [ ] Web: 25 screens verificadas en 3 roles (customer, provider, admin)
- [ ] Todas las características documentadas funcionan end-to-end

---

## 9. VALIDACIÓN DE DECISIONES ARQUITECTÓNICAS

- [ ] Totales siempre calculados servidor-lado (no cliente)
- [ ] Cross-tenant reads retornan 404 sin confirmar existencia
- [ ] Solo webhooks firmados activan subscripciones
- [ ] Refresh tokens single-use con detección de robo
- [ ] Consentimiento WhatsApp en send time
- [ ] Audit log hash-chained y verificable

---

## Uso

Ejecutar este prompt como guidance para:
1. **Code Review**: Verificar que cambios mantengan cobertura y alineación
2. **Testing**: Asegurar que tests cubre todos los puntos
3. **Feature Completion**: Validar que nuevas features sigan patrones
4. **Pre-Release**: Gate final antes de deployment a producción

