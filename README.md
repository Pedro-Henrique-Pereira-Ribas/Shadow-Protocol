# FPS 2D — Protocolo Sombra

Jogo de **FPS 2D com raycasting** (estilo Wolfenstein/Doom) rodando no navegador, com:

- **Modo Historia** — campanha单人 no estilo *Call of Duty*: briefing, cinemáticas com diálogo,
  5 missões, ondas de inimigos com IA, chefes, itens e avaliação por estrelas.
- **Modo Online** — multijogador no estilo *CS2*: salas por código, 3 modos de jogo
  (Free-for-All, Acove de Equipe, Competitivo com bomba), loja de armas, rounds, radar e ranking.
- **Conta obrigatória no Online** — e-mail válido (verificação de domínio MX) + senha forte
  (mínimo de 6 dígitos, maiúscula, minúscula e número), sessão por cookie `HttpOnly`.

Tema visual: **verde escuro, preto e branco**, com **modo claro e modo escuro** alternáveis
( botão no menu e na pausa, salvo no navegador ).

---

## Como rodar

```bash
npm install
npm start
```

Abra <http://localhost:3000> no navegador.

Requisito: **Node.js 22.5+** (usa o módulo nativo `node:sqlite`). Não há build step.

Variáveis de ambiente opcionais:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor HTTP/WebSocket |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `FPS2D_DB` | `data/fps2d.db` | Caminho do banco SQLite |

---

## No celular (mobile)

O jogo detecta automaticamente telas de toque e troca o mouse/teclado por controles
na tela — **não precisa instalar nada**:

| Controle | Ação |
|---|---|
| Joystick virtual (canto inferior esquerdo) | Mover (o knob aparece onde você tocar) |
| Arrastar na metade direita da tela | Olhar — **horizontal e vertical** |
| Botão **FOGO** | Atirar (segure para tiro automático) |
| Botão **RECARGA** | Recarregar |
| Botão **AGACHAR** | Alternar agachamento |
| Botão **ARMA** | Trocar de arma |
| Botão **PAUSA** | Abrir/fechar a pausa |

O HUD fica compacto em telas pequenas, o zoom por toque é bloqueado e a resolução
de renderização é reduzida automaticamente para manter o FPS.

> O **modo online exige uma conta** — e o mesmo vale no celular.
> Acesse pelo celular com o IP da máquina na rede local (ex.: `http://192.168.0.10:3000`).

---

## Controles

| Tecla | Ação |
|---|---|
| `W` `A` `S` `D` | Mover (frente / esquerda / trás / direita) |
| Mouse | Mirar — **horizontal e vertical** (inclinação limitada a ±22°) |
| Clique esquerdo | Atirar (automático em SMG/fuzis/metralhadora) |
| `R` | Recarregar |
| `Ctrl` / `C` | Agachar (agachado = protegido de cobertura baixa) |
| `Shift` | Andar devagar (mais preciso) |
| `1` `2` `3` `4` | Trocar arma |
| `Q` / roda do mouse | Trocar arma |
| `B` | Loja (modo Online) |
| `Esc` | Pausar |
| Botão **MENU** (canto superior direito) | Voltar ao menu principal |

### Mira vertical

A mira inclina para cima e para baixo de verdade, com física:

- o horizonte da cena desliza junto com a mira;
- **mirar de leve para cima** na cabeça do inimigo = **headshot** (4× dano);
- **mirar muito para cima** o tiro passa por cima da cabeça e erra;
- **mirar para baixo** faz o tiro bater na cobertura baixa (a cobertura de 1,15 m só deixa passar o tiro quando você está em pé);
- a IA também mira na vertical: mira no centro do seu corpo, então **agachar** reduz muito a chance de headshot.

---

## Modo Historia

| # | Missão | Mapa | Objetivo |
|---|---|---|---|
| 1 | Operação Poeira | Aldeia | Elimine todos os hostis |
| 2 | Fazenda Sangrenta | Fazenda | Limpe a fazenda e o depósito |
| 3 | Base Militar Fantasma | Base Militar | Infiltrar e destruir o radar |
| 4 | Refinaria em Chamas | Refinaria | Sabotar antes da explosão |
| 5 | A Fortaleza de Varga | Fortaleza | Derrotar o Comandante Varga |

Inimigos: `Guarda`, `Soldado`, `Assaltante`, `Atirador`, `Blindado` e o chefe `Comandante Varga`.
Eles **caçam** o jogador (com imprecisão), compartilham a posição do alvo com o esquadrão e
reagem a tiros (barulho atrai reforços).

O progresso é salvo no navegador; **criando uma conta** ele também é salvo no servidor.

---

## Modo Online

**Exige conta.** O servidor recusa a criação/entrada em salas e a conexão WebSocket sem sessão válida.

- **Free-for-All** — todos contra todos, 30 abates para vencer.
- **Acove de Equipe** (Terroristas x Contraterroristas) — 25 abates.
- **Competitivo (Bomba)** — rounds de 115 s, plantar/desarmar a bomba nos sites A e B, 16 rounds.

Cada sala tem um código de 5 letras para convidar amigos. O servidor é autoritativo:
valida velocidade e colisão da posição do cliente e calcula o dano dos tiros por *hitscan*,
reduzindo a margem de trapaça.

---

## Arquitetura

```
fps2d/
├── server/
│   ├── index.js     HTTP + WebSocket + API REST
│   ├── db.js        SQLite (node:sqlite): usuários, sessões, stats, progresso
│   ├── auth.js      validação de e-mail, força de senha, scrypt, cookies de sessão
│   └── rooms.js     salas, rounds, loja, bomba, snapshots, anti-cheat leve
├── shared/          código usado por servidor E cliente
│   ├── constants.js armas, modos, física, times
│   ├── maps.js      gerador determinístico de mapas + colisão + raycast
│   ├── mapdefs.js   catálogo de mapas (4 online + 5 de história)
│   └── story.js     definição da campanha
├── public/
│   ├── index.html   estrutura das telas
│   ├── css/style.css tema verde/preto/branco (claro e escuro)
│   └── js/          render.js (raycasting), game.js, ai.js, story.js, online.js, hud.js, ...
└── test/            suíte de testes automatizados
```

**Tecnologias:** JavaScript ES Modules puro, HTML5, CSS3, Canvas 2D, Node.js 24
(`node:http`, `node:crypto`, `node:dns`, `node:sqlite`) e WebSocket (`ws` — única dependência externa).

### Renderização

Raycasting DDA por colunas com texturas procedurais (sem arquivos de imagem),
sprites billboard desenhados por vetores, cobertura baixa que pode ser mirada por cima
quando em pé e protege quando agachado, neblina por distância e iluminação de tema.

**Para a parede ser fácil de localizar:**
- **1 coluna por pixel** (no desktop) — cada pixel amostra o ponto exato do mundo,
  sem borrão e sem a textura "escorregar" ao andar (`pixelStep = 2` no celular, por performance);
- **texturas de 128×128** de baixa frequência (sem ruído por pixel) + **cadeia de mipmaps**
  (4 níveis) — paredes distantes usam a versão borrada, eliminando o chuvisco ao andar;
- **linhas de profundidade no chão** (a cada 2 m, em perspectiva) — dão a referência
  de movimento e distância que faz a parede "parar de escorregar" na tela;
- **sombra de contato** na base de cada parede, ancorando-a no chão;
- **arma na tela** (viewmodel) com balanço ao andar e recuo ao atirar.

**Escala do mundo:** 1 unidade = 1 metro, célula do grid = 2 m, parede = 3 m,
olho a 1,5 m (0,9 m agachado). A projeção usa uma câmera pinhole com distância focal
`f = (largura/2) / tan(FOV/2)`, então um inimigo a 25 m tem ~62 px de altura — legível.

### Navegação da IA

A IA usa um **campo de fluxo** (BFS compartilhado, recalculado a cada 0,3 s) para
contornar paredes até o jogador, combinado com `hasLineOfSight` para escolher entre
ataque direto e perseguição. Sem isso os hostis travavam em quinas e a missão
ficava impossível de terminar.

---

## Testes

```bash
npm test
```

| Suíte | O que verifica |
|---|---|
| `test/boot.js` | Monta o DOM real do `index.html` e executa o `boot()` de verdade (menu, missões, briefing, tema) |
| `test/geometry.js` | **Geometria da cena**: a parede aparece na altura certa, não "escorrega" ao andar e o chão tem referência |
| `test/gameplay.js` | Simula as 5 missões com um bot (headless) e garante que são concluíveis |
| `test/client.js` | Carrega todos os módulos do cliente, renderiza frames e mede desempenho |
| `test/integration.js` | Cadastro/login, validações de e-mail e senha, bloqueio sem conta, API |
| `test/multiplayer.js` | Dois jogadores na mesma sala: dano real, movimento e bloqueio de teleporte |
| `test/client.js` | Módulos do cliente, renderização, **visibilidade dos personagens** e controles touch |

---

## Segurança

- Senhas com **scrypt** (N=16384) + salt por usuário; comparação em tempo constante.
- E-mail validado por formato, lista de domínios descartáveis e **consulta DNS MX**.
- Sessões em cookie `HttpOnly` + `SameSite=Strict`, com expiração de 30 dias.
- Rate limiting por IP e por e-mail no cadastro e no login.
- Servidor autoritativo: velocidade máxima, colisão e dano calculados no backend.

---

## Licença

MIT
