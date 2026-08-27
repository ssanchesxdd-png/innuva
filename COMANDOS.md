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
- 🎨 **Personalização**: nome do bot/loja, cor (12 opções), imagens (produto/ticket/logs)

### Botões internos de compra (`tk:*` e derivados)
Prosseguir · Cancelar · Voltar · Continuar p/ Pagamento · Copiar chave Pix · Pagamento feito · Confirmar entrega (staff) · Finalizar atendimento (staff) · Referência · Comprar também · Avisar quando chegar

## 🔄 Automação
| Rotina | Quando | O que faz |
|---|---|---|
| Sincronização de cards | Aos horários configurados (fuso SP) | Espelha preço/estoque nos canais de venda |
| Backup de dados | Diário às 03:00 (SP) | Snapshot persistente + `.json` na DM do dono |
| Expiração de pendências | A cada minuto | Cancela vendas Pix fora do prazo |

## 🔐 Segredos (Fly.io)
`DISCORD_TOKEN` · `CLIENT_ID` · `GUILD_ID` · `STAFF_ROLE_IDS` · `BOT_NAME` — opcionais: `BOT_TZ`, `PIX_CITY`, `PORT`