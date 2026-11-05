# Truco Argentino — mano a mano contra la IA

Truco argentino 1 vs 1 contra una inteligencia artificial que **no ve tus cartas**.
Motor de reglas puro y testeado, servidor autoritativo, y una interfaz con cartas
dibujadas en SVG propio.

---

## Arrancar

Requiere **Node 20+** y **pnpm 10+**.

```bash
pnpm install
pnpm dev          # levanta el server (:3000) y la web (:5173) juntos
```

Abrí http://localhost:5173. El cliente se conecta por WebSocket al server, que es el
único que conoce el estado real de la partida.

```bash
pnpm build        # compila la web y el bundle del server
pnpm check        # typecheck + lint + tests + cobertura del motor
pnpm test         # solo los tests unitarios y de integración
pnpm e2e          # Playwright: una mano completa, en desktop y en celular
pnpm bench:ai     # 500 partidas por enfrentamiento entre niveles de IA
```

### En Docker

```bash
docker build -t truco .
docker run --rm -p 3000:3000 truco
```

Un único proceso sirve la API, el WebSocket y la web estática. Imagen multi-stage
sobre `node:22-alpine`, corriendo como usuario sin privilegios.

### En Vercel

`vercel.json` define dos servicios sobre un mismo dominio:

| Servicio | Raíz       | Cómo se construye                                    | Rutas públicas   |
| -------- | ---------- | ---------------------------------------------------- | ---------------- |
| `web`    | `apps/web` | framework `vite`, estático en el CDN                 | `/(.*)`          |
| `server` | `.`        | `runtime: container`, usa el `Dockerfile` de la raíz | `/ws`, `/health` |

```bash
vercel dev     # levanta los dos servicios y enruta como en producción
```

**No hay bindings, y es a propósito.** Un binding inyecta la URL interna de un
servicio en el _runtime del que lo llama_, y acá ningún servicio llama a otro: el
único cruce es navegador → server por WebSocket, same-origin. `socketUrl()` arma
`wss://<host>/ws` a partir de `window.location`, que es exactamente lo que el rewrite
`/ws → server` resuelve, así que el cliente no necesita saber nada del despliegue.

Para `pnpm dev` —donde Vite y Fastify son dos procesos sueltos— el proxy de Vite
reenvía `/ws`, y su destino sale de `TRUCO_SERVER_URL` (por defecto
`http://localhost:3000`). Bajo `vercel dev` ese proxy ni se consulta.

Dos cosas que hay que verificar en la plataforma antes de confiarse, porque son
propiedades de la app y no de la configuración:

1. **Las partidas viven en memoria.** `SessionStore` guarda el `GameState` en el
   proceso, y la reconexión busca el `sessionId` ahí. Con más de una instancia de
   container, un jugador que reconecta puede caer en otra instancia y empezar una
   partida nueva sin aviso. Hay que fijar el servicio a una sola instancia, o mover
   las sesiones a un storage compartido.
2. **El upgrade WebSocket tiene que atravesar el rewrite** hasta el container, y las
   conexiones quedan abiertas minutos: la IA demora 600–1800 ms a propósito y hay
   pausas entre manos.

Si alguna de las dos no se sostiene, el `Dockerfile` de arriba corre la app completa
en un solo proceso en cualquier host que acepte procesos largos.

---

## La idea central: información oculta de verdad

El requisito que ordena toda la arquitectura es que **nadie vea las cartas del otro**,
ni el humano ni la IA. No es una convención de buena fe: está sostenido por tipos,
por los límites de los paquetes y por tests que lo verifican.

- El `GameState` completo vive **solo en el servidor**. La única salida es
  `getPlayerView(state, playerId)`, una función pura que arma lo que esa silla puede
  saber: sus propias cartas, las jugadas boca arriba, los cantos, los puntos
  declarados y las cartas que el ganador del envido muestra al final de la mano.
- **La IA recibe exactamente la misma `PlayerView` que un humano.** La firma lo
  garantiza: `decide(view: PlayerView, config: AIConfig): Action`. No hay un parámetro
  por el que pueda entrar el estado completo.
- El mazo se mezcla en el servidor con `crypto.randomInt` (Fisher-Yates), nunca con
  `Math.random` — hay una regla de lint que lo prohíbe en los paquetes puros.
- El cliente **no puede importar el motor**. Si lo hiciera tendría los tipos y la
  lógica de reglas en el bundle del navegador. La botonera dibuja `view.legalActions`
  y nada más.

### Cómo se verifica

| Qué se prueba                                                                                    | Dónde                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `getPlayerView` nunca incluye una carta tapada del rival, en miles de manos aleatorias           | `packages/engine/src/properties.test.ts`                         |
| El JSON que sale por el WebSocket no nombra ninguna carta que no sea pública                     | `apps/server/src/session.test.ts`, `apps/server/src/app.test.ts` |
| Dos partidas distintas que se ven iguales desde la silla de la IA producen la **misma decisión** | `packages/ai/src/decide.test.ts`                                 |
| Ni el DOM ni el tráfico WebSocket revelan cartas tapadas, jugando de verdad en el navegador      | `e2e/game.spec.ts`                                               |
| `ai` no puede importar nada de `apps/`; `web` no puede importar `engine`                         | `eslint.config.js`                                               |

El test de indistinguibilidad es el más fuerte de todos: se arman dos estados reales
con manos distintas para el humano pero idénticos desde el punto de vista de la IA, y
se verifica que la IA elija lo mismo con la misma semilla. Si alguna carta oculta
llegara a la IA, divergirían.

---

## Arquitectura

```
truco/
├── packages/
│   ├── shared/   tipos de dominio, esquemas zod del protocolo, RNG inyectable
│   ├── engine/   reglas puras: applyAction, getLegalActions, getPlayerView
│   └── ai/       decide(view, config) -> Action, por Monte Carlo
└── apps/
    ├── server/   Fastify + WebSocket, autoritativo, sesiones en memoria
    └── web/      Vite + React 18 + Zustand + Framer Motion
```

El grafo de dependencias es estrictamente unidireccional y está impuesto por lint:

```
shared  <-  engine  <-  ai
server  ->  { shared, engine, ai }
web     ->  shared                  (nunca engine, nunca ai)
```

`engine` y `ai` son paquetes puros: sin I/O, sin built-ins de Node, sin timers y sin
`Math.random`. Toda la aleatoriedad entra por un `Rng` inyectado, así que cualquier
test o simulación se puede reproducir exactamente con una semilla.

### El motor

Una máquina de estados inmutable. `applyAction(state, player, action, rng)` devuelve
un estado nuevo y nunca toca el que recibió; `getLegalActions(state, player)` es la
única fuente de verdad sobre qué se puede hacer. Si una acción no está en esa lista,
el motor la rechaza con `IllegalActionError` y el estado queda intacto.

Un detalle que vale la pena: `declarePoints` **no lleva el número**. El motor lee los
puntos de la mano real, así que un cliente no puede mentir sus puntos de envido ni
necesita conocer los del rival.

### La IA

Determinización Monte Carlo (_perfect information Monte Carlo_). Para decidir:

1. Muestrea manos que el rival podría tener, entre las cartas que no vio.
2. Descarta las imposibles según el registro público: si cantó 28, solo manos de 28
   exactos; si dijo "son buenas", solo manos por debajo del número al que se achicó;
   si cantó flor, solo manos con flor.
3. Pondera las que quedan según lo que el rival hizo — cantar truco inclina la
   muestra hacia manos fuertes, pero **sin asumir que no miente**, así que un farol
   sigue siendo posible y la IA no se deja pastorear por un mentiroso.
4. Juega cada acción candidata en cada uno de esos mundos y promedia el resultado.

La política rápida que usa en las simulaciones responde de forma **probabilística**,
no con un umbral fijo. Esto importa más de lo que parece: un rival simulado que se
achica siempre por debajo de cierto número es trivialmente explotable, y la búsqueda
lo descubriría — aprendería que resubir con nada es plata gratis.

**Los tres niveles son distintos en especie, no solo en prolijidad:**

| Nivel   | Cómo juega                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Fácil   | Adivina la mano del rival una sola vez y juega de memoria, sin promediar mundos. Se manda cualquiera seguido. |
| Normal  | Busca sobre 40 muestras, con bastante ruido en la decisión final.                                             |
| Difícil | 120 muestras, lee el marcador (los puntos valen más cerca del final) y farolea con intención.                 |

Además tiene comportamiento humano: faroles con mano mala, se calla con mano muy
buena para cazar, arriesga más cuando va perdiendo y cuida cuando está por ganar, y
demora entre 600 y 1800 ms según lo difícil que sea la decisión.

Resultados del benchmark (500 partidas por cruce, `pnpm bench:ai`):

```
Difícil vs aleatoria   88.4%   (requiere >=85%)
Difícil vs Fácil       82.4%   (requiere >=60%)
Difícil vs Normal      57.2%
Normal  vs Fácil       76.4%
Fácil   vs aleatoria   80.2%
```

### El protocolo

WebSocket, con todos los mensajes validados por zod **en los dos extremos**.

- Cliente → servidor: `action`, `newGame`, `resync`, `ping`.
- Servidor → cliente: `view` (la `PlayerView` completa), `events` (el feed de
  animación), `thinking`, `error`, `pong`.

El servidor nunca confía en el cliente: valida el esquema, y después valida la acción
contra las reglas. Las partidas viven en memoria con un id de sesión; si se corta la
conexión o se recarga la página, el cliente vuelve con su id y retoma la partida donde
estaba. Hay rate limit por conexión (token bucket) y las sesiones abandonadas se
limpian por TTL.

---

## Reglas implementadas

### El mazo y la jerarquía

Baraja española de 40 cartas (sin 8 ni 9). De mayor a menor:

1. 1 de espada · 2. 1 de basto · 3. 7 de espada · 4. 7 de oro · 5. los 3 ·
2. los 2 · 7. 1 de copa y 1 de oro · 8. los 12 · 9. los 11 · 10. los 10 ·
3. 7 de copa y 7 de basto · 12. los 6 · 13. los 5 · 14. los 4

Cartas del mismo nivel empatan: la baza es **parda**.

### Las bazas

Gana la mano quien gane 2 de 3. El ganador de una baza empieza la siguiente; si fue
parda, empieza quien era mano. Parda la 1ª, gana quien gane la 2ª; si también es
parda, la 3ª; las tres pardas van al mano. Gana la 1ª uno y la 2ª es parda, gana quien
ganó la 1ª. Una baza cada uno y la 3ª parda, gana quien ganó la 1ª. La mano termina en
cuanto el resultado está decidido.

### Truco

Truco (2) → Retruco (3) → Vale cuatro (4); sin canto vale 1. No querido paga el valor
anterior: 1, 2 y 3 respectivamente. Solo sube quien aceptó el último canto — tiene _la
palabra_ — y solo en su turno, antes de tirar la carta. "Quiero retruco" acepta y sube
en un solo movimiento.

### Envido

Solo en la primera baza, y solo antes de que el que canta haya tirado su carta.
**El envido está primero**: si te cantan truco y todavía no tiraste, podés contestar
con envido; se resuelve y después se vuelve a la respuesta del truco.

Cuenta: con dos o tres cartas del mismo palo, las dos más altas de ese palo más 20;
las figuras valen 0; máximo 33. Sin dos del mismo palo, la carta más alta.

| Secuencia                          | Querido  | No querido                        |
| ---------------------------------- | -------- | --------------------------------- |
| Envido                             | 2        | 1                                 |
| Envido + envido                    | 4        | 2                                 |
| Real envido                        | 3        | 1                                 |
| Envido + real envido               | 5        | 2                                 |
| Envido + envido + real envido      | 7        | 4                                 |
| Falta envido                       | la falta | lo acumulado querido antes, o 1   |
| Cualquier secuencia + falta envido | la falta | lo que valía la secuencia querida |

Primero canta sus puntos el mano; el otro dice los suyos o _son buenas_. Empate, gana
el mano. Al final de la mano el ganador muestra las cartas que justifican su cuenta;
las que no participaron quedan tapadas.

### Flor (opcional, apagada por defecto)

Tres cartas del mismo palo. Vale 3, se canta en la primera baza antes de tirar, y
anula el envido de esa mano. Si los dos tienen flor es una pelea: **contraflor** (6) o
**contraflor al resto** (la falta); quien no quiera dice _con flor me achico_ y paga lo
que valía la secuencia anterior. Gana la flor más alta; si empatan, el mano.

### Irse al mazo

En tu turno. El rival se lleva el valor actual del truco, más 1 punto extra si te vas
en la primera baza sin que se haya jugado el envido.

### La partida

A 30 (15 malas + 15 buenas) o a 15. Si alguien llega al objetivo en medio de una mano
—por envido o por flor— la partida termina ahí mismo.

---

## Decisiones de reglas

El truco tiene variantes regionales. Acá se eligió la versión más difundida en
Argentina, y lo discutible quedó configurable:

| Tema                                 | Por defecto                                                                        | Opción                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Objetivo                             | 30 puntos                                                                          | `target: 15 \| 30`                       |
| Falta envido                         | En las malas se lleva la partida; en las buenas, lo que le falta al que va ganando | `faltaEnvidoMode: 'classic' \| 'simple'` |
| Mazo en la 1ª baza sin envido jugado | +1 punto extra al rival                                                            | `mazoPrimeraPenalty`                     |
| Flor                                 | Desactivada                                                                        | `flor`                                   |

Tres decisiones que no son configurables, y por qué:

- **Empate de envido al mano.** Es unánime; no hay variante que valga la pena.
- **Los puntos los calcula el motor, no el jugador.** Mentir los puntos no es una
  variante regional, es hacer trampa, y además obligaría a mandar la cuenta del rival
  al cliente.
- **La flor se canta o se pierde.** Anunciarla es opcional: quien se queda callado
  simplemente resigna los puntos. Es más indulgente que penalizar el olvido, y evita
  que la interfaz tenga que forzar un canto.

---

## Calidad

```
259 tests unitarios y de integración    (engine, ai, server, web)
 14 tests end-to-end                    (Playwright, desktop y celular a 390px)
 99.9 % de líneas y 98.8 % de ramas cubiertas en el motor
```

El motor se prueba además con **property-based testing** (fast-check): cientos de
partidas completas jugadas al azar por acciones legales, verificando en cada
transición que las 40 cartas siguen existiendo, que nadie juega una carta ajena, que
el puntaje nunca baja, que la partida siempre termina y que la `PlayerView` nunca
filtra. El verificador de invariantes tiene sus propios tests que lo corrompen a
propósito: un chequeo que no puede fallar no prueba nada.

Accesibilidad: navegación completa por teclado con atajos para cada canto, foco
visible, `aria-label` en cada carta ("7 de espada"), el anotador resumido para
lectores de pantalla, y respeto por `prefers-reduced-motion`.

El sonido está sintetizado con WebAudio — osciladores y ruido filtrado — así que no
hay un solo archivo de audio en el repo. Las cartas son SVG dibujados acá, sin
imágenes ni diseños de terceros.

---

## Estructura

```
packages/engine/src/
  hierarchy.ts    la tabla de 14 niveles y la fuerza de una mano
  envido.ts       cuenta de envido y de flor
  tricks.ts       resolución de bazas y de la mano, incluidas las pardas
  betting.ts      valores de truco, envido y flor
  legal.ts        getLegalActions
  apply.ts        la máquina de estados
  playerView.ts   el único puente hacia afuera
  invariants.ts   lo que tiene que valer después de cada transición

packages/ai/src/
  determinize.ts  muestreo de manos del rival condicionado a lo público
  rollout.ts      política rápida de simulación
  decide.ts       la búsqueda, el marcador y los faroles
  match.ts        enfrentar dos políticas
  bench.ts        pnpm bench:ai
```
