# FPS 2D — Shadow Protocol (Protocolo Sombra)

> *Shadow Protocol é um FPS inspirado em Counter-Strike 2 e Call of Duty, com modos história e competitivo, focado em ação e estratégia.*

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

## Controles

| Tecla | Ação |
|---|---|
| `W` `A` `S` `D` | Mover |
| Mouse | Mirar (o clique captura o cursor) |
| Clique esquerdo | Atirar (automático em SMG/fuzis/metralhadora) |
| `R` | Recarregar |
| `Ctrl` / `C` | Agachar (agachado = protege de cobertura baixa) |
| `Shift` | Andar devagar (mais preciso) |
| `1` `2` `3` `4` | Trocar arma |
| `Q` / roda do mouse | Trocar arma |
| `B` | Loja (modo Online) |
| `Esc` | Pausar |

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

---

## Testes

```bash
npm test
```

| Suíte | O que verifica |
|---|---|
| `test/gameplay.js` | Simula as 5 missões com um bot (headless) e garante que são concluíveis |
| `test/client.js` | Carrega todos os módulos do cliente, renderiza frames e mede desempenho |
| `test/integration.js` | Cadastro/login, validações de e-mail e senha, bloqueio sem conta, API |
| `test/multiplayer.js` | Dois jogadores na mesma sala: dano real, movimento e bloqueio de teleporte |

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
