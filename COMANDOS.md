# 📋 Comandos e Interações — Innova Forn Bot

> Referência completa gerada a partir do código-fonte (26/08/2026).

## 🔘 Comandos de barra

### Públicos
| Comando | Opções | O que faz |
|---|---|---|
| `/comprar` | `produto` *(opcional)* | Abre ticket privado de compra; se informado, já sugere o produto |
| `/estoque` | — | Mostra jogos com estoque; selecionar abre lista detalhada |

### Staff (`Gerenciar Servidor` ou cargos em `STAFF_ROLE_IDS`)
| Comando | Opções | O que faz |
|---|---|---|
| `/cupom criar` | `tipo` (percent/fixed) · `valor` · `codigo` · `usos` · `expira DD/MM/AAAA` *(opcionais exceto tipo/valor)* | Cria cupom de desconto |
| `/cupom listar` | — | Lista cupons com usos/validade |
| `/cupom deletar` | `codigo` *(obrigatório)* | Remove um cupom |
| `/vendida` | — *(usar dentro do ticket)* | Envia ticket à seleção de produtos / confirma fluxo |
| `/backup criar` | — | Snapshot imediato dos dados da loja |
| `/backup listar` | — | Lista os snapshots salvos |
| `/backup enviar` | `arquivo` *(opcional; vazio = mais recente)* | Baixa um snapshot `.json` |
| `/restaurar snapshot` | `arquivo` · `confirmar` (Sim/Não) | Restaura dados de um snapshot salvo |
| `/restaurar arquivo` | `dados` (.json até 5 MB) · `confirmar` | Restaura a partir de arquivo enviado no chat |

## ⚙️ Painéis interativos (menus/botões, não são comandos)

### `/config` — categorias do menu raiz
- 💰 **Vendas**: produtos (add/editar/preço/estoque/remover), canais de envio, horários, chave Pix, card padrão
- 🎫 **Ticket**: canal do painel, categorias (Suporte/Compras), prazo pendente, janela de fechamento, FAQ (add/remover/listar)
- 📋 **Logs**: canais privado e público
- 🏷️ **Cargos Automáticos**: cargo de Novo Cliente (1º ticket) e Comprador (1ª compra)
- 🎨 **Personalização**: nome do bot/loja, cor (12 opções), imagens (produto/ticket/logs)

### Botões internos de compra (`tk:*` e derivados)
Prosseguir · Cancelar · Voltar · Continuar p/ Pagamento · Copiar chave Pix · Pagamento feito · Confirmar entrega (staff) · Finalizar atendimento (staff) · Referência · Comprar também · Avisar quando chegar

## 🏷️ Cargos Automáticos
- Configurados em `/config` > **Cargos Automáticos** (salvos por servidor em `store.roles`).
- **🎫 Novo Cliente**: concedido na primeira vez que o usuário abre um ticket (qualquer tipo; staff não conta).
- **🛒 Comprador**: concedido quando a primeira compra do usuário é aprovada (pagamento confirmado).
- Cada concessão registra `store.clientes[userId]` (primeiro ticket/primeira compra), aparece no **log privado** e avisa o cliente por **DM**.
- Requisitos no Discord: bot com permissão **Gerenciar Cargos** e seu cargo **acima** dos cargos configurados. Caso contrário, a concessão falha sem quebrar o fluxo da venda.
- Para limpar um cargo configurado, envie o seletor da categoria sem nenhum cargo selecionado.

## 🙋 Assumir Ticket (staff)
- A mensagem principal de todo ticket tem o botão **🙋 Assumir Ticket** enquanto ninguém assumiu (apenas staff pode usar).
- Ao assumir, o botão fica travado como "Assumido por @staff", a staff recebe um **resumo ephemeral do cliente** (compras anteriores, notas da staff, média de estrelas e ⚠️ alerta se o histórico for negativo) e o log privado registra a responsabilidade.

## ⭐ Avaliação de clientes (staff)
- Ao **Finalizar Atendimento** (ou fechar o ticket como staff), a staff recebe um prompt ephemeral para avaliar o cliente antes do canal fechar.
- **Notas escritas**: máximo **2 por cliente** (modal com estrelas 1–4 + texto de até 500 caracteres).
- **Estrelas**: sem limite de avaliações (seletor de 1 a 4 ⭐).
- Quando o cliente já tem as 2 notas, as estrelas viram voto: **3–4⭐ = CONCORDO** / **1–2⭐ = DISCORDO** com as notas existentes.
- Se ninguém avaliar, o canal fecha automaticamente após 10 minutos.
- Dados salvos em `store.avaliacoes` por servidor (`notas`, `estrelas {soma, votos}`, `votosNotas`) e alimentam o resumo do cliente ao assumir tickets.

## 🔄 Automação
| Rotina | Quando | O que faz |
|---|---|---|
| Sincronização de cards | Aos horários configurados (fuso SP) | Espelha preço/estoque nos canais de venda |
| Backup de dados | Diário às 03:00 (SP) | Snapshot persistente + `.json` na DM do dono |
| Expiração de pendências | A cada minuto | Cancela vendas Pix fora do prazo |

## 🔐 Segredos (Fly.io)
`DISCORD_TOKEN` · `CLIENT_ID` · `GUILD_ID` · `STAFF_ROLE_IDS` · `BOT_NAME` — opcionais: `BOT_TZ`, `PIX_CITY`, `PORT`