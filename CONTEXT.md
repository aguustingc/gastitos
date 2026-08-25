# Gastitos — Contexto de la aplicación

> Este archivo describe qué es Gastitos, para qué sirve, cómo está construida y su arquitectura técnica. Debe actualizarse cada vez que se implementen cambios relevantes, para mantenerse sincronizado con el estado real del proyecto.
>
> Última actualización: 2026-08-25 — sesión de correcciones post-auditoría UX (ver §9)

## 1. Qué es y para qué sirve

Gastitos es una PWA (Progressive Web App) personal de finanzas: permite registrar gastos diarios, definir un plan mensual (salario, % destinado a ahorro e inversión, límites de gasto por categoría), llevar aportes de ahorro/inversión, y visualizar insights (gráficos de gasto por categoría, ritmo diario, histórico de 6 meses, progreso de metas de ahorro).

Está pensada para uso individual, 100% offline y local: no hay backend, no hay red, no hay cuentas de usuario. Todos los datos viven en el navegador del usuario (IndexedDB). El respaldo y la portabilidad de datos se resuelven con export/import manual de un JSON.

Idioma de la interfaz: español (es-AR por defecto, configurable vía `locale` en config).

## 2. Stack técnico

- **Sin frameworks ni dependencias externas.** JavaScript vanilla (ES modules), HTML y CSS puro.
- **Persistencia:** IndexedDB, con un wrapper propio (`DB` en `app.js`) sobre la API nativa.
- **Renderizado:** manual, vía `innerHTML` + manipulación del DOM. No hay virtual DOM ni sistema de templates de terceros.
- **Gráficos:** dibujados a mano con Canvas 2D (sin librerías tipo Chart.js).
- **PWA:** `manifest.webmanifest` + `sw.js` (service worker) para instalación e uso offline.
- **Sin build step:** no hay bundler, transpilador ni gestor de paquetes (no hay `package.json`). Se sirve directamente el HTML/CSS/JS.

## 3. Estructura de archivos

```
Gastitos/
├── index.html            # Shell único de la SPA (nav, sheet modal, contenedor #app)
├── app.js                # Toda la lógica: DB, estado, router, vistas, modales, charts
├── styles.css             # Estilos (paleta, layout, componentes)
├── manifest.webmanifest  # Metadata PWA (íconos, nombre, colores, display standalone)
├── sw.js                 # Service worker (estrategia network-first con fallback a cache)
├── icon.svg              # Ícono de la app
└── .claude/launch.json   # Config de lanzamiento para Claude Code (no afecta runtime)
```

No hay carpeta `src/`, `components/` ni tests automatizados.

## 4. Arquitectura de la app (app.js)

`app.js` es un único archivo (~1500 líneas) organizado en secciones comentadas:

### 4.1 Capa de datos — `DB` (IndexedDB wrapper)
- Base de datos `gastitos`, versión 1.
- Object stores:
  - `config` (keyPath `key`): pares clave/valor — `currency`, `locale`, `reminder`.
  - `categorias` (autoIncrement `id`): categorías de gasto (`nombre`, `color`, `icono`, `orden`).
  - `gastos` (autoIncrement `id`, índices `fecha` y `mes`): cada gasto individual.
  - `planes` (keyPath `mes`, formato `YYYY-MM`): un plan por mes (`salario`, `pctAhorro`, `pctInversion`, `limites` por categoría).
  - `movimientos` (autoIncrement `id`, índice `mes`): aportes de ahorro/inversión.
  - `recurrentes` (autoIncrement `id`): gastos recurrentes (nombre, monto, categoría, día del mes) que se pueden "aplicar" a un mes.
- Métodos genéricos: `open`, `tx`, `getAll`, `get`, `put`, `add`, `del`, `clear`.

### 4.2 Seed / datos por defecto
- `ensureSeed()`: si no hay categorías, crea 9 por defecto (Supermercado, Comer afuera, Transporte, Servicios, Salud, Entretenimiento, Compras, Educación, Otros). También setea `currency: '$'` y `locale: 'es-AR'` si faltan.

### 4.3 Estado global — `state`
Objeto mutable en memoria que no persiste directamente (se deriva de la DB en cada render): vista actual, mes seleccionado, filtro de categoría, búsqueda, cache de categorías, plan actual, moneda/locale, config de recordatorio, tab de insights, flag de onboarding.

### 4.4 Router / render
- `nav(view)` cambia `state.view`, actualiza el nav inferior y llama a `render()`.
- `render()` limpia `#app`, refresca categorías y plan, y monta la vista correspondiente según `state.view`: `hoy`, `plan`, `gastos`, `insights`.
- Todas las vistas son funciones async que devuelven un `HTMLElement` construido con `innerHTML` + wiring manual de event handlers (`onclick`, `addEventListener`).

### 4.5 Vistas principales
1. **Hoy** (`viewHoy`): pantalla principal. Muestra disponible del mes, gastado/ahorro/inversión, barra de progreso del mes, una **proyección de cierre de mes** ("A este ritmo vas a terminar gastando $X"), alertas de límites superados/cerca del límite, un chip de recurrentes pendientes de aplicar (si hay alguno, con botón "Aplicar" de un toque), botón grande "Registrar gasto", accesos rápidos a categorías top, últimos movimientos. Si no hay plan cargado, muestra `viewOnboarding()` (pantalla de bienvenida para ingresar el salario inicial); sin plan, la card principal muestra "Gastado este mes" en tono normal (no un saldo negativo, que confundía).
   - `projectSpend(totalGastado, dayOfMonth, dim, disponible)`: proyecta el total de fin de mes a partir del promedio diario de gasto hasta hoy (`totalGastado / dayOfMonth * diasDelMes`). Sólo se calcula/muestra si hay plan, es el mes en curso, hay algo gastado y todavía quedan días por delante — no tiene sentido en un mes ya cerrado o recién empezado sin datos. Si la proyección supera el disponible, se resalta en tono de advertencia (`.projection.over`).
2. **Plan** (`viewPlan`): configuración del mes — salario, % ahorro/inversión (con cálculo en vivo del disponible), límites de gasto opcionales por categoría, guardar/borrar plan. Si no hay plan para el mes, se copia automáticamente el del mes anterior (`_fromPrev`).
   - **Límites por categoría**: se ingresan como **monto directo** (`plan.limites[catId]` = pesos), no como porcentaje del disponible como antes — pedirle al usuario "% de un % del sueldo" era una cuenta de tres pasos para algo que en cualquier app de presupuesto es escribir un número. Cada fila muestra, como referencia secundaria y no editable, a cuánto % del disponible equivale ese monto (`≈N% del disponible`, calculado en el momento del render, no en vivo mientras se tipea). `catStatus()` y `computeAlerts()` comparan `gastado / limite` directamente contra ese monto, sin pasar por `disponible` en el camino.
3. **Gastos** (`viewGastos`): listado de gastos del mes agrupados por día, con buscador (por nota, debounced), filtro por categoría, edición inline del monto y navegación mes a mes.
4. **Insights** (`viewInsights`): dos sub-tabs:
   - *Gastos*: total del mes vs. mes anterior; gráfico de barras horizontal-scrolleable "Por categoría" (HTML/CSS, no canvas — ver nota abajo); gráfico de barras de ritmo diario (`<canvas>`); histórico de 6 meses (`<canvas>`).
   - *Ahorro*: total acumulado histórico, progreso de metas de ahorro/inversión del mes, listado de movimientos.

   > El gráfico "Por categoría" **no** usa torta/donut: con muchas categorías un donut deja de ser legible (todas las porciones compiten por poco espacio angular) y no asocia bien color↔categoría. Se reemplazó por `catBarItemHtml()`: barras verticales ordenadas de mayor a menor gasto, coloreadas con el color de cada categoría y con su ícono+nombre debajo (para que el color sí identifique la categoría). Van dentro de `.cat-bars-scroll` (flex + `overflow-x:auto`), con `flex-basis` calculado para que se vean exactamente 5 columnas sin scrollear y el resto aparezca deslizando hacia la derecha.

### 4.6 Modales ("sheets")
Sistema propio de modal (`#sheet` en `index.html`, controlado por `openSheet()`/`closeSheet()`), usado para:
- `openAddGasto()` — alta/edición/borrado de gasto (con teclado numérico propio, `keypadHtml`/`wireKeypad`).
- `openAddMov()` — alta/edición/borrado de aporte de ahorro/inversión.
- `openCatsEditor()` — alta/edición/borrado de categorías (color, ícono, nombre, orden).
- `openSettings()` — recordatorio diario (con Notification API opcional), acceso a categorías y recurrentes, exportar/importar backup JSON, borrar todos los datos.
- `openRecurrentes()` / `openRecEditor()` — gestión de gastos recurrentes. `getPendingRecurrentes(mes)` calcula cuáles todavía no se cargaron ese mes (comparando notas `rec:<id>` contra los gastos existentes); `applyRecurrentes(mes)` los carga y devuelve cuántos agregó — función compartida entre el botón "Aplicar al mes actual" de este sheet y el chip de Hoy (ver §4.5).

Además existe un segundo overlay, independiente del sheet: `#confirm` (`openConfirm(message, opts)` en `app.js`), un diálogo de confirmación propio que reemplaza a los `confirm()` nativos del navegador — devuelve una `Promise<boolean>`. Se usa para todo borrado (gasto, aporte, recurrente, plan) y para el borrado total de datos (con dos confirmaciones en cadena). Vive fuera de `#sheet` a propósito: si el usuario abre la confirmación desde dentro de otro sheet ya abierto (ej. borrar un gasto desde el sheet de edición), el sheet de fondo no se pierde — el confirm es una capa aparte con su propio z-index, no un reemplazo del contenido del sheet.

### 4.7 Export/Import
- `doExport()`: descarga un JSON con todos los object stores (`_app: 'gastitos'`, `_version: 1`).
- `doImport(file)`: valida el JSON y muestra un sheet de **preview** (cantidad de gastos/aportes/categorías/recurrentes y rango de fechas) antes de tocar nada. Al confirmar, `mergeImport(data)` **suma** el contenido al histórico actual — nunca reemplaza ni limpia stores:
  - `categorias`: se emparejan por `nombre` (case-insensitive), no por `id` (dos exports en momentos distintos pueden traer ids que ya no corresponden a la misma categoría acá). Si no hay match, se crea una categoría nueva. Se arma un `idMap` (id viejo del JSON → id real en esta DB) para remapear `categoriaId` en gastos y recurrentes importados.
  - `gastos`: se deduplican por `fecha + categoriaId (ya remapeado) + monto` — si ya existe un gasto con esa combinación exacta, se omite (no se agrega ni se pisa).
  - `movimientos`: dedup por `fecha + tipo + monto`.
  - `recurrentes`: dedup por `nombre + monto + dia`.
  - `planes`: sólo se agrega el plan importado de un mes si ese mes **no** tiene plan ya guardado (nunca se pisa un plan existente).
  - `config` (moneda/locale/recordatorio) no se toca en el import — son preferencias locales del dispositivo, no "datos" a fusionar.
  - Reemplaza los antiguos `confirm()`/`alert()` nativos: los errores de parseo van por `toast()`, la confirmación es el propio sheet de preview con botón "Importar".

### 4.8 Gráficos
- `setupCanvas()`: ajusta el canvas a devicePixelRatio.
- `drawBars()` (ritmo diario) y `drawHist()` (histórico 6 meses): dibujado manual en `<canvas>`, sin librerías, coherente con la paleta de la app.
  - `drawBars(canvas, values, dim, { selectedIdx })`: `dim` es dinámico, no siempre `daysInMonth`. Si el mes mostrado es el mes en curso, `insightsGastosBlock` calcula `renderDim = min(diasDelMes, díaDeHoy)` y le pasa un `values` recortado (`perDayRender`) — así el gráfico no deja un hueco vacío para los días que todavía no pasaron. En un mes ya cerrado se muestra completo.
  - Dibuja el valor del día de mayor gasto arriba de esa barra como referencia (el resto del eje vertical sigue sin valores, a propósito, por simplicidad), y devuelve `{ padL, bw, dim, padT, ch }` — la geometría para mapear un click a un día.
  - `opts.selectedIdx` (default `-1`): si hay un día seleccionado, esa barra mantiene su color normal y todas las demás se pintan atenuadas (`#17332A22`) para que quede claro cuál se está mirando. El label del máximo también se atenúa si no es el seleccionado.
  - El click sobre el canvas de `ch-bars` (wireado en `insightsGastosBlock`, no dentro de `drawBars`) calcula el día clickeado con esa geometría, guarda `selectedIdx` en un closure local, vuelve a llamar `drawBars(...)` con esa selección, y escribe el detalle (`día → monto`) en `#daybar-info` debajo del canvas. Click de nuevo sobre la misma barra deselecciona. Es un estado local a ese gráfico: no toca `state.filterCat` ni ningún otro filtro de la app.
  - `drawHist(canvas, hist, { selectedIdx })` tiene el mismo mecanismo de selección/atenuado que `drawBars` (antes sólo `drawBars` era clickeable) y también devuelve `{ padL, bw }` para mapear clicks a un mes — wireado igual que `ch-bars`, con su propio `#hist-info` debajo del canvas.
  - **Accesibilidad**: como el canvas no expone nada a un lector de pantalla por sí solo, ambos `<canvas>` (`ch-bars`, `ch-hist`) llevan `role="img"` + un `aria-label` dinámico calculado por `ritmoDiarioSummary()` / `historicoSummary()` (total, pico, o el detalle de los 6 meses en una frase). Además, cada uno tiene al lado una `<ul class="sr-only">` con el valor de cada día/mes como texto real en el DOM — no sólo un resumen, sino el detalle completo, para quien navegue con lector de pantalla sin depender del tap-to-read. `.sr-only` es el patrón estándar de "visualmente oculto pero accesible" (no `display:none`, que también lo oculta de la accessibility tree).
- `catBarItemHtml()` (categorías): no usa canvas, es HTML/CSS puro (ver §4.5) para poder scrollear y clickear con más naturalidad que un canvas dibujado a mano.
- `goalBarHtml({ label, icon, actual, meta, maxScale, colorClass })` (Insights → Ahorro): barra horizontal HTML/CSS (`.goal-track` + `.goal-fill`) con una línea de objetivo (`.goal-line`) posicionada según `meta / maxScale`. `maxScale` es una escala compartida entre la barra de Ahorro y la de Inversión (`max(metaAh, metaInv, ahorroMes, invMes, 1) * 1.15`, calculada en `insightsAhorroBlock`) para que ambas sean comparables entre sí y quede aire para que la barra supere la línea si se aportó más de lo planeado — en ese caso `fillPct` simplemente queda mayor que `goalPct`, no hay ningún cap ni caso especial adicional.

### 4.9 Alertas y notificaciones
- `computeAlerts()` / `catStatus()`: calculan uso (%) de cada categoría contra su límite (basado en el "disponible" del plan).
- `shouldShowReminder()` / `tryNotify()`: recordatorio diario en la vista Hoy (chip in-app + `Notification` nativa opcional si el usuario da permiso).

### 4.10 Bootstrap (`init()`)
Carga seed, config (moneda/locale), recordatorio; delega clicks globales para `data-open`/`data-nav`; registra el service worker (si no es `file://`); llama a `render()` inicial.

## 5. PWA / Service Worker

- `manifest.webmanifest`: nombre "Gastitos", `display: standalone`, `start_url: ./index.html`, ícono SVG único (any + maskable), tema `#F4F7F2`.
- `sw.js` (cache `gastitos-v5`): estrategia **network-first** — intenta red primero y cachea la respuesta; si falla (sin conexión), sirve desde caché, con fallback final a `index.html`. En `activate`, limpia cachés de versiones anteriores.
- **Importante:** al cambiar `app.js`/`styles.css`/`index.html`, conviene bumpear la constante `CACHE` en `sw.js` (ej. `gastitos-v4`) para forzar invalidación de caché en usuarios existentes.

## 6. Estilo visual

`styles.css` (~30KB) define una paleta cálida/verde-oliva ("mint", "teal", "navy", "ink") con tipografía mixta (sans para UI, Georgia serif para números grandes). Mobile-first, pensada para uso como PWA instalada en el celular (bottom nav, sheets tipo modal deslizable).

## 7. Convenciones y detalles a tener en cuenta

- Los montos se guardan como números; el mes se deriva siempre como `YYYY-MM` (string) tanto en gastos como en movimientos y planes.
- Los gastos recurrentes aplicados se identifican por la nota especial `rec:<id>` para evitar duplicarse si se aplica el recurrente más de una vez en el mes.
- No hay autenticación, sincronización remota ni multiusuario — el proyecto es intencionalmente local-first.
- No hay suite de tests. Cambios se validan manualmente en el navegador.
- Versionado visible al usuario: string hardcodeado "Gastitos · versión 1.1" en la vista de Ajustes (`openSettings`) — actualizar manualmente si se quiere reflejar una nueva versión.
- El teclado numérico propio (`keypadHtml`/`wireKeypad`) guarda el monto internamente como `raw`: dígitos "limpios" + una coma opcional como separador decimal (ej. `"235000"`, `"1500,5"`), sin puntos de miles. `formatRawForDisplay(raw)` es la única responsable de agregar los puntos de miles para mostrarlo en pantalla mientras se tipea — la lógica de parseo (`Number(raw.replace(',', '.'))`) sigue trabajando siempre sobre el `raw` sin formatear. Si se toca el teclado numérico, hay que mantener esta separación entre "valor interno" y "valor mostrado".

## 8. Flujo de trabajo / deploy

- El proyecto vive en GitHub: `https://github.com/aguustingc/gastitos`.
- Los cambios pedidos en una sesión de Claude (Cowork, incluso desde el celular) se editan en un clon del repo dentro del entorno en la nube de esa sesión, y se guardan directo en la carpeta local del proyecto (`D:\Datos\Escritorio\LEMANS\Gastitos`) vía el puente con el dispositivo — no hace falta que abras el archivo vos.
- El commit + push a GitHub no lo hace Claude directamente (el proxy de git del entorno en la nube no tiene autorizado este repo todavía). En su lugar, una **tarea programada de Windows** (`auto-push.ps1`, configurada según `CONFIGURAR-AUTO-PUSH.md`) revisa la carpeta cada 5 minutos y commitea/pushea sola cualquier cambio pendiente. Requisito: la PC tiene que estar encendida y con `git push` ya autenticado una vez (Git Credential Manager).
- Cada cambio que toque `app.js`, `styles.css`, `index.html`, `sw.js` o `manifest.webmanifest` debe bumpear la constante `CACHE` en `sw.js` (ya se volvió convención, ver §5) para que el service worker invalide la caché vieja en los dispositivos donde la PWA ya está instalada.
- Si en el futuro se autoriza el repo en el proxy de git de la sesión, se puede pasar a push directo desde la sesión de Claude (sin depender de la PC ni de la tarea programada).

## 9. Historial de cambios de este documento

- **2026-08-25**: creación inicial del archivo de contexto, basado en una revisión completa de `app.js`, `index.html`, `styles.css`, `sw.js` y `manifest.webmanifest`.
- **2026-08-25**: se documentó el flujo de deploy (auto-push vía tarea programada de Windows, §8) y los cambios de esta sesión: separador de miles en el teclado numérico (§7), reemplazo del gráfico de torta por barras horizontal-scrolleables en "Por categoría", y valor de referencia + detalle por día al click en el gráfico de "Ritmo diario" (§4.5, §4.8). Bump de `sw.js` a `gastitos-v4`.
- **2026-08-25**: "Ritmo diario" ahora tiene rango dinámico (solo hasta hoy en el mes en curso) y al clickear un día se resalta esa barra atenuando las demás (§4.8). Insights → Ahorro: se unificó Ahorro e Inversión en un único gráfico de barras horizontales con línea de objetivo (`goalBarHtml`, §4.8), con íconos 💵 y 📈. Bump de `sw.js` a `gastitos-v5`.
- **2026-08-25**: sesión de correcciones a partir de una auditoría UX/producto completa de la app. Cambios:
  - Copy de "Gastos recurrentes" corregido (ya no dice "automático" cuando requiere un toque) + chip real de "recurrentes pendientes" con botón "Aplicar" en Hoy (§4.5, §4.6).
  - Hoy sin plan cargado: ya no muestra un saldo negativo confuso, muestra "Gastado este mes" en tono normal (§4.5).
  - Todos los `confirm()`/`alert()` nativos reemplazados por `openConfirm()`, un diálogo propio coherente con el resto del sistema de sheets (§4.6).
  - Límites por categoría: de "% del disponible" a monto directo en pesos, con el % como referencia secundaria (§4.5).
  - Los dos gráficos de canvas (`ch-bars`, `ch-hist`) ahora tienen `aria-label` dinámico + lista `.sr-only` con el detalle completo; "Últimos 6 meses" ganó la misma interacción de tap-to-read que ya tenía "Ritmo diario" (§4.8).
  - Import de backup: ahora muestra un preview (cantidades + rango de fechas) antes de importar, y **suma** al histórico en vez de reemplazarlo — con deduplicación por store (gastos por fecha+categoría+monto, movimientos por fecha+tipo+monto, recurrentes por nombre+monto+día, categorías emparejadas por nombre, planes sin pisar los existentes) (§4.7).
  - Proyección de cierre de mes ("A este ritmo vas a terminar gastando $X") en Hoy, a partir del promedio diario de gasto (§4.5).
  - Versión visible bumpeada a 1.2. Bump de `sw.js` a `gastitos-v6`.
