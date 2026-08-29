// src/handlers/interactions.js
// Ponto central que recebe TODAS as interacoes que nao sao comandos de barra
// (cliques em botao, selecao de menu, envio de modal) e decide o que fazer
// com base no customId de cada componente.
//
// Convencao de customId: "namespace:acao:extra"

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} = require('discord.js');

const { loadStore, saveStore, generateId } = require('../storage');
const { ticketPanelContainer } = require('../utils/embeds');
const { v2Container, updateV2, montarContainerProduto } = require('../utils/v2');
const { publicarCards } = require('./publicar');
const { waitForAttachment, cancelPending } = require('../utils/attachmentCollector');
const { abrirTicket, confirmarVenda, handleTicketButton, handleTicketSelect, fecharTicket, ehStaff, ticketPanelSelectRow } = require('./tickets');
const { handleAvaliacaoButton, handleAvaliacaoSelect, handleAvaliacaoModal } = require('./avaliacoes');
const { pagamentoAprovado, cancelarPendente, handleReferencia, handleComprarTambem, abrirModalEntrega, processarEntrega, enviarFotoReferencia } = require('./sales');

// Paleta de cores disponivel no /config > Personalizacao
const CORES = [
  { emoji: '🔵', nome: 'Azul', hex: '#5865F2' },
  { emoji: '🔴', nome: 'Vermelho', hex: '#ED4245' },
  { emoji: '🟠', nome: 'Laranja', hex: '#F26522' },
  { emoji: '🟡', nome: 'Amarelo', hex: '#F0B232' },
  { emoji: '🟢', nome: 'Verde', hex: '#23A55A' },
  { emoji: '🟣', nome: 'Roxo', hex: '#B256F0' },
  { emoji: '🩷', nome: 'Rosa', hex: '#EB459E' },
  { emoji: '🔷', nome: 'Ciano', hex: '#00A8FC' },
  { emoji: '🟤', nome: 'Marrom', hex: '#A05A2C' },
  { emoji: '⚫', nome: 'Preto', hex: '#2B2D31' },
  { emoji: '⚪', nome: 'Branco', hex: '#F2F3F5' },
  { emoji: '🔘', nome: 'Cinza', hex: '#949BA4' }
];

const CATEGORIAS_IMAGEM = [
  { id: 'product', emoji: '🎮', nome: 'Cards de Produto', descricao: 'Imagem padrão dos cards (cada produto pode ter a sua)' },
  { id: 'ticket', emoji: '🎫', nome: 'Painel de Ticket', descricao: 'Imagem do painel de suporte' },
  { id: 'logs', emoji: '🔒', nome: 'Logs Privados', descricao: 'Imagem dos logs da staff' }
];

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
      return;
    }

    if (interaction.isChannelSelectMenu()) {
      await handleChannelSelectMenu(interaction);
      return;
    }

    if (interaction.isRoleSelectMenu()) {
      await handleRoleSelectMenu(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
      return;
    }
  } catch (err) {
    console.error('Erro ao processar interacao:', err);
    const payload = { content: 'Ocorreu um erro ao processar isso. Tente novamente.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

// ---------- HELPERS DE NAVEGACAO ----------

// Section "Voltar" com o botão colado à direita da linha.
function secaoVoltar(destino) {
  const botao = new ButtonBuilder()
    .setCustomId(`config:voltar:${destino}`)
    .setLabel('⬅️ Voltar')
    .setStyle(ButtonStyle.Secondary);
  return { label: 'Navegação', accessory: botao };
}

async function mostrarMenuRoot(interaction) {
  const store = loadStore(interaction.guildId);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('config:menu:root')
    .setPlaceholder('Selecione uma categoria')
    .addOptions([
      { label: 'Configurações de Vendas', value: 'vendas', emoji: '💰', description: 'Produtos, preços, estoque, canais e horários' },
      { label: 'Configurações de Ticket', value: 'ticket', emoji: '🎫', description: 'Canal do painel de suporte/ticket' },
      { label: 'Configurações de Logs', value: 'logs', emoji: '📋', description: 'Canais de log privado e público' },
      { label: 'Cargos Automáticos', value: 'cargos', emoji: '🏷️', description: 'Cargo de Comprador (1ª compra) e Novo Membro (entrada no servidor)' },
      { label: 'Boas-vindas', value: 'welcome', emoji: '👋', description: 'Mensagem automática quando um novo membro entrar' },
      { label: 'Personalização', value: 'personalizacao', emoji: '🎨', description: 'Nome do bot, nome da loja, cor e imagens' }
    ]);

  const container = v2Container(store, {
    title: '⚙️ Configuração da Loja',
    description:
      `- **Configuração de vendas:** adicione produtos, preços e estoque.\n` +
      `- **Configuração de tickets:** setar o canal de suporte.\n` +
      `- **Configuração de logs:** setar os canais de log públicos e privados.\n` +
      `- **Cargos automáticos:** cargo de Comprador e Novo Membro.\n` +
      `- **Personalização:** personalize o nome do bot, da loja e escolha a cor.`,
    rows: [new ActionRowBuilder().addComponents(menu)]
  });

  await updateV2(interaction, container);
}

async function mostrarMenuVendas(interaction) {
  const store = loadStore(interaction.guildId);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('config:menu:vendas')
    .setPlaceholder('O que deseja configurar em Vendas?')
    .addOptions([
      { label: 'Adicionar Produto', value: 'produtos', emoji: '📦' },
      { label: 'Editar Produto', value: 'editar_produto', emoji: '✏️' },
      { label: 'Remover Produto', value: 'remover_produto', emoji: '🗑️' },
      { label: 'Listar Produtos', value: 'listar_produtos', emoji: '📋' },
      { label: 'Definir Preço', value: 'definir_preco', emoji: '💵' },
      { label: 'Colocar Estoque', value: 'estoque', emoji: '🧮' },
      { label: 'Canais de Envio das Embeds', value: 'canais_envio', emoji: '📢' },
      { label: 'Horários de Reenvio Diário', value: 'horarios_envio', emoji: '⏰' },
      { label: 'Chave Pix (pagamentos pendentes)', value: 'pix_key', emoji: '🏦' }
    ]);

  const container = v2Container(store, {
    title: '💰 Configurações de Vendas',
    description: 'Escolha o que deseja configurar.',
    rows: [new ActionRowBuilder().addComponents(menu)],
    sections: [
      {
        label: '🛠️ Construir Container de Produto (título, divisórias e info do jeito que você quiser)',
        accessory: new ButtonBuilder()
          .setCustomId('config:construir')
          .setLabel('Construir')
          .setStyle(ButtonStyle.Primary)
      },
      {
        label: '📤 Publicar/atualizar os cards de produto nos canais de envio',
        accessory: new ButtonBuilder()
          .setCustomId('config:publicar')
          .setLabel('Publicar')
          .setStyle(ButtonStyle.Primary)
      },
      secaoVoltar('root')
    ]
  });

  await updateV2(interaction, container);
}

// ---------- STRING SELECT MENUS ----------

async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);

  // ---- Tickets: seletor de tipo no painel publico ----
  if (id === 'ticket:tipo') {
    const tipoId = interaction.values[0];
    return abrirTicket(interaction, store, null, tipoId);
  }

  if (id === 'faq:remover') {
    store.ticket.faq = (store.ticket.faq || []).filter(f => f.id !== interaction.values[0]);
    saveStore(interaction.guildId, store);
    return mostrarMenuTicket(interaction);
  }
  // ---- FAQ: resposta ephemeral + botao de escape ----
  if (id === 'faq:ver') {
    const faq = (store.ticket.faq || []).find(f => f.id === interaction.values[0]);
    if (!faq) {
      return interaction.update({
        components: [new ContainerBuilder()
          .setAccentColor(0xED4245)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Pergunta não encontrada.'))],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      });
    }
    const c = new ContainerBuilder()
      .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**❓ ${faq.pergunta}**\n\n${faq.resposta}`)
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('faq:abrir_ticket')
            .setLabel('Não resolveu meu problema')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🎫')
        )
      );
    return interaction.update({ components: [c], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }
  // ---- Avaliacao de clientes (staff) ----
  if (id.startsWith('aval:')) return handleAvaliacaoSelect(interaction);
  // ---- Fluxo do ticket: seletores (produto/qty/cupom) ----
  if (id.startsWith('tk:')) return handleTicketSelect(interaction);

  if (id === 'config:menu:root') {
    const escolha = interaction.values[0];
    if (escolha === 'vendas') return mostrarMenuVendas(interaction);
    if (escolha === 'ticket') return mostrarMenuTicket(interaction);
    if (escolha === 'logs') return mostrarMenuLogs(interaction);
    if (escolha === 'cargos') return mostrarMenuCargos(interaction, store);
    if (escolha === 'welcome') return mostrarMenuWelcome(interaction, store);
    if (escolha === 'personalizacao') return mostrarMenuPersonalizacao(interaction, store);
  }

  if (id === 'config:menu:vendas') {
    const escolha = interaction.values[0];
    if (escolha === 'definir_preco') return mostrarSelecaoProduto(interaction, store, 'preco');
    if (escolha === 'canais_envio') return mostrarSelecaoCanaisEnvio(interaction, store);
    if (escolha === 'horarios_envio') return abrirModalHorarios(interaction, store);
    if (escolha === 'produtos') return abrirModalNovoProduto(interaction);
    if (escolha === 'estoque') return mostrarSelecaoProduto(interaction, store, 'estoque');
    if (escolha === 'editar_produto') return mostrarSelecaoProduto(interaction, store, 'editar');
    if (escolha === 'remover_produto') return mostrarSelecaoProduto(interaction, store, 'remover');
    if (escolha === 'pix_key') return abrirModalPixKey(interaction, store);
    if (escolha === 'listar_produtos') {
      const lista = store.sales.products.length > 0
        ? store.sales.products.map(p =>
            `📦 **${p.name}** (${p.game})\n` +
            `&nbsp;&nbsp;💰 R$ ${p.price.toFixed(2)} · 📦 Estoque: ${p.stock} · ID: \`${p.id}\``
          ).join('\n\n')
        : 'Nenhum produto cadastrado ainda.';
      const container = v2Container(store, {
        title: '📋 Produtos Cadastrados',
        description: lista,
        sections: [secaoVoltar('vendas')]
      });
      return updateV2(interaction, container);
    }
  }

  if (id === 'config:menu:logs') {
    const tipo = interaction.values[0];
    return mostrarSelecaoCanalLog(interaction, tipo);
  }

  if (id === 'config:selecionar_produto:preco') {
    return abrirModalDefinirPreco(interaction, interaction.values[0]);
  }

  if (id === 'config:selecionar_produto:estoque') {
    return abrirModalDefinirEstoque(interaction, interaction.values[0]);
  }

  if (id === 'config:selecionar_produto:editar') {
    return abrirModalEditarProduto(interaction, store, interaction.values[0]);
  }

  if (id === 'config:selecionar_produto:remover') {
    return mostrarConfirmacaoRemover(interaction, store, interaction.values[0]);
  }

  if (id === 'config:selecionar_produto:construir') {
    return abrirModalConstruirCard(interaction, store, interaction.values[0]);
  }

  // /estoque: selecionar jogo -> posta um card por produto no canal
  if (id === 'estoque:selecionar_jogo') {
    const jogo = interaction.values[0];
    const produtos = store.sales.products.filter(p => p.game === jogo && p.stock > 0);

    if (produtos.length === 0) {
      return interaction.update({
        content: `Nenhuma conta disponível em **${jogo}** no momento.`,
        embeds: [], components: []
      });
    }

    await interaction.update({
      content: `Mostrando contas disponíveis de **${jogo}** abaixo ⬇️`,
      embeds: [], components: []
    });

    for (const produto of produtos) {
      const cardContainer = montarContainerProduto(store, produto, {
        titulo: `🎮 ${produto.name}`,
        info:
          (produto.description ? `${produto.description}\n\n` : '') +
          `💰 **Valor à vista:** R$ ${produto.price.toFixed(2)}\n` +
          `📦 **Restam:** ${produto.stock} unidade(s)`,
        divAcima: true,
        divAbaixo: true
      });
      await interaction.channel.send({ components: [cardContainer], flags: [MessageFlags.IsComponentsV2] });
    }
  }
}

async function mostrarMenuTicket(interaction) {
  const store = loadStore(interaction.guildId);
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId('config:canal:ticket_panel')
    .setPlaceholder('Selecione o canal do painel de suporte')
    .setChannelTypes(ChannelType.GuildText);

  const categoriaSuporte = new ChannelSelectMenuBuilder()
    .setCustomId('config:categoria:suporte')
    .setPlaceholder('Categoria dos tickets de Suporte & Dúvidas')
    .setChannelTypes(ChannelType.GuildCategory);

  const categoriaCompras = new ChannelSelectMenuBuilder()
    .setCustomId('config:categoria:compras')
    .setPlaceholder('Categoria dos tickets de Compras')
    .setChannelTypes(ChannelType.GuildCategory);

  const catSuporte = store.ticket.categories?.suporte;
  const catCompras = store.ticket.categories?.compras;
  const faqs = store.ticket.faq || [];

  const faqRows = [];
  faqRows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('config:faq_add').setLabel('Adicionar pergunta ao FAQ').setStyle(ButtonStyle.Primary).setEmoji('➕')
  ));
  if (faqs.length > 0) {
    faqRows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('faq:remover')
        .setPlaceholder('Remover pergunta do FAQ')
        .addOptions(faqs.slice(0, 25).map(f => ({ label: f.pergunta.slice(0, 100), value: f.id })))
    ));
  }

  const container = v2Container(store, {
    title: '🎫 Configuração de Ticket',
    description:
      'Configure o painel e as categorias de cada tipo de ticket.\n\n' +
      `**Canal do painel:** ${store.ticket.panelChannelId ? `<#${store.ticket.panelChannelId}>` : 'não configurado'}\n` +
      `**Categoria Suporte:** ${catSuporte ? `<#${catSuporte}>` : '⚠️ não configurada'}\n` +
      `**Categoria Compras:** ${catCompras ? `<#${catCompras}>` : '⚠️ não configurada'}\n\n` +
      `**❓ FAQ:** ${faqs.length} pergunta(s) cadastrada(s)\n` +
      'Cada tipo de ticket abre um canal de texto dentro da sua categoria, visível só para o cliente e a staff.',
    rows: [
      new ActionRowBuilder().addComponents(channelMenu),
      new ActionRowBuilder().addComponents(categoriaSuporte),
      new ActionRowBuilder().addComponents(categoriaCompras),
      ...faqRows
    ],
    sections: [secaoVoltar('root')]
  });

  await updateV2(interaction, container);
}
async function mostrarMenuLogs(interaction) {
  const store = loadStore(interaction.guildId);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('config:menu:logs')
    .setPlaceholder('Qual log deseja configurar?')
    .addOptions([
      { label: 'Log Privado (staff)', value: 'privado', emoji: '🔒' },
      { label: 'Log Público (todos)', value: 'publico', emoji: '📢' }
    ]);

  const container = v2Container(store, {
    title: '📋 Configuração de Logs',
    description: 'Escolha qual tipo de log deseja configurar.',
    rows: [new ActionRowBuilder().addComponents(menu)],
    sections: [secaoVoltar('root')]
  });

  await updateV2(interaction, container);
}

// Menu de personalizacao: cor (com emojis), imagens por categoria, nome/logo
async function mostrarMenuPersonalizacao(interaction, store) {
  const corAtual = CORES.find(c => c.hex === store.color);

  const container = v2Container(store, {
    title: '🎨 Personalização',
    description:
      `**Cor atual:** ${corAtual ? corAtual.emoji + ' ' + corAtual.nome : store.color}\n\n` +
      'Escolha abaixo o que deseja configurar:',
    sections: [
      {
        label: '🎨 Cor da loja',
        accessory: new ButtonBuilder().setCustomId('config:abrir_cores').setLabel('Escolher').setStyle(ButtonStyle.Primary)
      },
      {
        label: '🖼️ Imagens das embeds',
        accessory: new ButtonBuilder().setCustomId('config:abrir_imagens').setLabel('Editar').setStyle(ButtonStyle.Primary)
      },
      {
        label: '✏️ Nome, logo e info',
        accessory: new ButtonBuilder().setCustomId('config:abrir_infos').setLabel('Editar').setStyle(ButtonStyle.Primary)
      },
      secaoVoltar('root')
    ]
  });

  await updateV2(interaction, container);
}

// Grade de cores com emojis (12 cores, 3 linhas de 4)
async function mostrarGradeCores(interaction, store) {
  const corAtual = CORES.find(c => c.hex === store.color);

  const rows = [];
  for (let i = 0; i < CORES.length; i += 4) {
    const bloco = CORES.slice(i, i + 4);
    const row = new ActionRowBuilder().addComponents(
      bloco.map(cor =>
        new ButtonBuilder()
          .setCustomId(`config:cor:${cor.hex}`)
          .setLabel(cor.nome)
          .setEmoji(cor.emoji)
          .setStyle(ButtonStyle.Secondary)
      )
    );
    rows.push(row);
  }

  const container = v2Container(store, {
    title: '🎨 Escolha a cor da loja',
    description:
      `Cor atual: **${corAtual ? corAtual.emoji + ' ' + corAtual.nome : store.color}**\n\n` +
      'Clique em uma cor para aplicar em **TODAS** as embeds do bot.',
    rows,
    sections: [secaoVoltar('personalizacao')]
  });

  await updateV2(interaction, container);
}

// Categorias de imagem das embeds
async function mostrarMenuImagens(interaction, store) {
  const sections = CATEGORIAS_IMAGEM.map(cat => ({
    label:
      `${cat.emoji} **${cat.nome}** — ${cat.descricao}` +
      (store.images?.[cat.id] ? `\n🔗 Atual: \`${store.images[cat.id]}\`` : ''),
    accessory: new ButtonBuilder()
      .setCustomId(`config:imagem:${cat.id}`)
      .setLabel('Definir')
      .setStyle(ButtonStyle.Secondary)
  }));

  const container = v2Container(store, {
    title: '🖼️ Imagens das Embeds',
    description: 'Escolha a categoria e defina a imagem (banner) dela:',
    sections: [...sections, secaoVoltar('personalizacao')]
  });

  await updateV2(interaction, container);
}

async function mostrarSelecaoCanalLog(interaction, tipo) {
  const store = loadStore(interaction.guildId);
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`config:canal:log_${tipo}`)
    .setPlaceholder(`Selecione o canal de log ${tipo}`)
    .setChannelTypes(ChannelType.GuildText);

  const container = v2Container(store, {
    title: `📋 Log ${tipo}`,
    description: `Selecione o canal de texto para o log ${tipo}.`,
    rows: [new ActionRowBuilder().addComponents(channelMenu)],
    sections: [secaoVoltar('logs')]
  });

  await updateV2(interaction, container);
}

async function mostrarSelecaoCanaisEnvio(interaction, store) {
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId('config:canal:envio_vendas')
    .setPlaceholder('Selecione até 5 canais')
    .setMinValues(1)
    .setMaxValues(5)
    .setChannelTypes(ChannelType.GuildText);

  const container = v2Container(store, {
    title: '📢 Canais de Envio das Embeds',
    description: 'Selecione em quais canais os cards de produto serão publicados e reenviados diariamente.',
    rows: [new ActionRowBuilder().addComponents(channelMenu)],
    sections: [secaoVoltar('vendas')]
  });

  await updateV2(interaction, container);
}

async function mostrarSelecaoProduto(interaction, store, finalidade) {
  if (store.sales.products.length === 0) {
    const container = v2Container(store, {
      title: '📦 Produtos',
      description: 'Nenhum produto cadastrado ainda. Use "Adicionar Produto" primeiro.',
      sections: [secaoVoltar('vendas')]
    });
    return updateV2(interaction, container);
  }

  const descricaoPorFinalidade = {
    preco: p => `Preço atual: R$ ${p.price.toFixed(2)}`,
    estoque: p => `Estoque atual: ${p.stock}`,
    editar: p => `${p.game} · R$ ${p.price.toFixed(2)} · estoque ${p.stock}`,
    remover: p => `${p.game} · R$ ${p.price.toFixed(2)} · estoque ${p.stock}`,
    construir: p => `${p.game} · R$ ${p.price.toFixed(2)} · estoque ${p.stock}`
  };

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`config:selecionar_produto:${finalidade}`)
    .setPlaceholder('Selecione o produto')
    .addOptions(store.sales.products.slice(0, 25).map(p => ({
      label: `${p.name} (${p.game})`,
      value: p.id,
      description: descricaoPorFinalidade[finalidade](p)
    })));

  const container = v2Container(store, {
    title: '📦 Selecione o produto',
    description: 'Escolha o produto na lista abaixo:',
    rows: [new ActionRowBuilder().addComponents(menu)],
    sections: [secaoVoltar('vendas')]
  });

  await updateV2(interaction, container);
}

async function mostrarConfirmacaoRemover(interaction, store, produtoId) {
  const produto = store.sales.products.find(p => p.id === produtoId);
  if (!produto) {
    const container = v2Container(store, {
      title: '⚠️ Remoção',
      description: 'Produto não encontrado.',
      sections: [secaoVoltar('vendas')]
    });
    return updateV2(interaction, container);
  }

  const container = v2Container(store, {
    title: '⚠️ Confirmar remoção',
    description: `Tem certeza que deseja remover **${produto.name}** (${produto.game})? Essa ação não pode ser desfeita.`,
    sections: [
      {
        label: '🗑️ Excluir o produto',
        accessory: new ButtonBuilder()
          .setCustomId(`config:confirmar_remocao:${produtoId}`)
          .setLabel('Sim, remover')
          .setStyle(ButtonStyle.Danger)
      },
      {
        label: 'Mudou de ideia?',
        accessory: new ButtonBuilder()
          .setCustomId('config:voltar:vendas')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Secondary)
      }
    ]
  });

  await updateV2(interaction, container);
}

// ---------- ROLE SELECT MENUS (Cargos Automaticos) ----------

// Painel /config > Cargos Automaticos: cargo de Novo Cliente (1º ticket)
// e cargo de Comprador (1ª compra aprovada)
async function mostrarMenuCargos(interaction, store) {
  if (!store.roles) store.roles = { novoCliente: null, comprador: null };

  const cargoPrimeiraCompra = new RoleSelectMenuBuilder()
    .setCustomId('config:cargo:primeiraCompra')
    .setPlaceholder('Cargo para quem comprar pela 1ª vez (Comprador)')
    .setMinValues(0)
    .setMaxValues(1);

  const cargoNovoMembro = new RoleSelectMenuBuilder()
    .setCustomId('config:cargo:novoMembro')
    .setPlaceholder('Cargo para quem entrar no servidor (Novo Membro)')
    .setMinValues(0)
    .setMaxValues(1);

  const container = v2Container(store, {
    title: '🏷️ Cargos Automáticos',
    description:
      'O bot concede cargos automaticamente:\n\n' +
      `**🛒 Comprador** — concedido quando alguém conclui a primeira compra (pagamento aprovado).\n` +
      `Cargo atual: ${store.roles.primeiraCompra ? `<@&${store.roles.primeiraCompra}>` : '⚠️ não configurado'}\n\n` +
      `**👋 Novo Membro** — concedido automaticamente quando alguém entra no servidor.\n` +
      `Cargo atual: ${store.roles.novoMembro ? `<@&${store.roles.novoMembro}>` : '⚠️ não configurado'}\n\n` +
      '⚠️ O cargo do bot precisa estar **acima** dos cargos escolhidos e o bot precisa da permissão **Gerenciar Cargos**.\n' +
      '⚠️ Para o cargo de Novo Membro, o **Server Members Intent** precisa estar ativado no Discord Developer Portal.\n' +
      'Para limpar uma configuração, envie o seletor sem nenhum cargo selecionado.',
    rows: [
      new ActionRowBuilder().addComponents(cargoPrimeiraCompra),
      new ActionRowBuilder().addComponents(cargoNovoMembro)
    ],
    sections: [secaoVoltar('root')]
  });

  await updateV2(interaction, container);
}

// ---------- PAINEL BOAS-VINDAS ----------

// Painel /config > Boas-vindas: canal + mensagem enviada a novos membros
async function mostrarMenuWelcome(interaction, store) {
  if (!store.welcome) store.welcome = { channelId: null, message: null };

  const canalMenu = new ChannelSelectMenuBuilder()
    .setCustomId('config:canal:welcome')
    .setPlaceholder('Canal da mensagem de boas-vindas (vazio = desativar)')
    .setMinValues(0)
    .setMaxValues(1)
    .setChannelTypes(ChannelType.GuildText);

  const container = v2Container(store, {
    title: '👋 Boas-vindas',
    description:
      'Quando alguém entrar no servidor, o bot envia a mensagem no canal escolhido.\n\n' +
      `**Canal atual:** ${store.welcome.channelId ? `<#${store.welcome.channelId}>` : '⚠️ não configurado (recurso desativado)'}\n` +
      `**Mensagem atual:** ${store.welcome.message ? `\n> ${store.welcome.message}` : "'👋 Bem-vindo(a) {user} ao **{server}**!' (padrão)"}\n\n` +
      '**Placeholders:** `{user}` menção ao novo membro · `{server}` nome do servidor · `{tag}` usuário · `{membros}` total de membros.\n' +
      'Para desativar, envie o seletor sem nenhum canal selecionado.',
    rows: [
      new ActionRowBuilder().addComponents(canalMenu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('config:editar_boasvindas')
          .setLabel('✏️ Editar mensagem')
          .setStyle(ButtonStyle.Secondary)
      )
    ],
    sections: [secaoVoltar('root')]
  });

  await updateV2(interaction, container);
}

async function handleRoleSelectMenu(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);

  if (id.startsWith('config:cargo:')) {
    const tipo = id.split(':')[2];
    if (!store.roles) store.roles = { primeiraCompra: null, novoMembro: null };
    store.roles[tipo] = interaction.values[0] || null;
    saveStore(interaction.guildId, store);
    return mostrarMenuCargos(interaction, store);
  }
}

// ---------- CHANNEL SELECT MENUS ----------

async function handleChannelSelectMenu(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);
  const canal = interaction.values[0];

  if (id === 'config:categoria:suporte' || id === 'config:categoria:compras') {
    const tipoId = id.split(':')[2];
    if (!store.ticket.categories) store.ticket.categories = { suporte: null, compras: null };
    store.ticket.categories[tipoId] = canal;
    saveStore(interaction.guildId, store);
    return mostrarMenuTicket(interaction);
  }

  if (id === 'config:canal:ticket_panel') {
    store.ticket.panelChannelId = canal;
    saveStore(interaction.guildId, store);

    const channelObj = await interaction.guild.channels.fetch(canal);

    const msg = await channelObj.send({
      components: [ticketPanelContainer(store, ticketPanelSelectRow())],
      flags: MessageFlags.IsComponentsV2
    });
    store.panelMessageId = msg.id;
    saveStore(interaction.guildId, store);

    const container = v2Container(store, {
      title: '✅ Canal de ticket configurado',
      description: `Painel "Abrir Ticket" publicado em <#${canal}>.`,
      sections: [secaoVoltar('root')]
    });
    return updateV2(interaction, container);
  }

  if (id === 'config:canal:log_privado') {
    store.logs.privateChannelId = canal;
    saveStore(interaction.guildId, store);
    const container = v2Container(store, {
      title: '✅ Log privado configurado',
      description: `Canal de log privado: <#${canal}>.`,
      sections: [secaoVoltar('root')]
    });
    return updateV2(interaction, container);
  }

  if (id === 'config:canal:log_publico') {
    store.logs.publicChannelId = canal;
    saveStore(interaction.guildId, store);
    const container = v2Container(store, {
      title: '✅ Log público configurado',
      description: `Canal de log público: <#${canal}>.`,
      sections: [secaoVoltar('root')]
    });
    return updateV2(interaction, container);
  }

  if (id === 'config:canal:welcome') {
    if (!store.welcome) store.welcome = { channelId: null, message: null };
    store.welcome.channelId = interaction.values[0] || null;
    saveStore(interaction.guildId, store);
    return mostrarMenuWelcome(interaction, store);
  }

  if (id === 'config:canal:envio_vendas') {
    const canais = interaction.values;
    store.sales.sendChannelIds = canais;
    saveStore(interaction.guildId, store);
    await publicarCards(interaction.guild).catch(() => {});
    const container = v2Container(store, {
      title: '✅ Canais de envio configurados',
      description: `Canais: ${canais.map(c => `<#${c}>`).join(', ')}. Os cards de produto já foram sincronizados.`,
      sections: [secaoVoltar('vendas')]
    });
    return updateV2(interaction, container);
  }
}

// ---------- BOTOES ----------

async function handleButton(interaction) {
  const id = interaction.customId;
  console.log(`[botao] recebido: ${id}`);
  const store = loadStore(interaction.guildId);

  // ---- Tickets ----
  // "Prosseguir" é para TODOS (cliente monta o carrinho e paga sozinho);
  // a staff usa o mesmo caminho para vendas manuais.
  if (id === 'ticket:confirmar_venda') return confirmarVenda(interaction);
  if (id === 'ticket:fechar') return fecharTicket(interaction);

  // ---- FAQ publico (painel de suporte) ----
  if (id === 'faq:abrir') {
    const faqs = store.ticket.faq || [];
    if (faqs.length === 0) {
      return interaction.reply({ content: 'Nenhuma dúvida frequente cadastrada ainda.', flags: MessageFlags.Ephemeral });
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId('faq:ver')
      .setPlaceholder('Escolha sua dúvida')
      .addOptions(faqs.slice(0, 25).map(f => ({ label: f.pergunta.slice(0, 100), value: f.id })));
    const c = new ContainerBuilder()
      .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('**❓ Dúvidas Frequentes**\n\nSelecione sua dúvida abaixo:'))
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    return interaction.reply({ components: [c], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }

  if (id === 'faq:abrir_ticket') {
    return abrirTicket(interaction, store, null, 'suporte');
  }
  // ---- Avaliacao de clientes (staff) ----
  if (id.startsWith('aval:')) return handleAvaliacaoButton(interaction);
  // ---- Fluxo do ticket (estagios) ----
  if (id.startsWith('tk:')) return handleTicketButton(interaction);

  // ---- Registrar conta entregue (log privado) ----
  if (id.startsWith('entrega:modal:')) {
    if (!ehStaff(interaction)) {
      return interaction.reply({ content: '🔒 Apenas a staff pode fazer isso.', flags: MessageFlags.Ephemeral });
    }
    const compraId = id.split(':')[2];
    return abrirModalEntrega(interaction, compraId);
  }

  // ---- Enviar foto de referencia (log privado) ----
  if (id.startsWith('foto:')) {
    if (!ehStaff(interaction)) {
      return interaction.reply({ content: '🔒 Apenas a staff pode fazer isso.', flags: MessageFlags.Ephemeral });
    }
    return enviarFotoReferencia(interaction, id.split(':')[1]);
  }


  // ---- Aprovacao/cancelamento de pendencia: SOMENTE STAFF ----
  if (id.startsWith('ticket:pagamento_aprovado:')) {
    if (!ehStaff(interaction)) {
      return interaction.reply({
        content: '🔒 Apenas a staff pode aprovar pagamentos. Envie o comprovante aqui no ticket e aguarde.',
        flags: MessageFlags.Ephemeral
      });
    }
    return pagamentoAprovado(interaction, id.split(':')[2]);
  }
  if (id.startsWith('ticket:cancelar_pendente:')) {
    if (!ehStaff(interaction)) {
      return interaction.reply({ content: '🔒 Apenas a staff pode cancelar uma pendência.', flags: MessageFlags.Ephemeral });
    }
    return cancelarPendente(interaction, id.split(':')[2]);
  }

  // ---- Publico ----
  if (id.startsWith('publico:referencia:')) {
    return handleReferencia(interaction, id.split(':')[2]);
  }
  if (id.startsWith('publico:comprar_tambem:')) {
    return handleComprarTambem(interaction, id.split(':')[2]);
  }

  if (id.startsWith('publico:comprar_produto:')) {
    const produtoId = id.split(':')[2];
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (produto && produto.stock <= 0) {
      const semEstoque = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**❌ Sem estoque**\n\n` +
            `Infelizmente **${produto.name}** está esgotado no momento.\n` +
            `Clique no botão abaixo e te aviso na DM assim que chegar!`
          )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`publico:avisar:${produto.id}`)
              .setLabel('Avise-me quando chegar')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('🔔')
          )
        );
      return interaction.reply({ components: [semEstoque], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }
    return abrirTicket(interaction, store, produto ? produto.name : null);
  }
  if (id.startsWith('publico:avisar:')) {
    const produtoId = id.split(':')[2];
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (!produto) return interaction.reply({ content: '❌ Produto não encontrado.', flags: MessageFlags.Ephemeral });
    if (produto.stock > 0) {
      return interaction.reply({ content: `✅ Boa notícia: **${produto.name}** já está disponível de novo! Clique em Comprar no card.`, flags: MessageFlags.Ephemeral });
    }
    if (!produto.notifyList) produto.notifyList = [];
    if (produto.notifyList.includes(interaction.user.id)) {
      return interaction.reply({ content: `🔔 Você já está na lista de aviso de **${produto.name}**. Assim que chegar, te aviso na DM!`, flags: MessageFlags.Ephemeral });
    }
    produto.notifyList.push(interaction.user.id);
    saveStore(interaction.guildId, store);
    return interaction.reply({ content: `🔔 Feito! Vou te avisar na DM quando **${produto.name}** voltar ao estoque.`, flags: MessageFlags.Ephemeral });
  }
  // ---- Config: navegacao ----
  if (id.startsWith('config:voltar:')) {
    const destino = id.split(':')[2];
    if (destino === 'root') return mostrarMenuRoot(interaction);
    if (destino === 'vendas') return mostrarMenuVendas(interaction);
    if (destino === 'logs') return mostrarMenuLogs(interaction);
    if (destino === 'personalizacao') return mostrarMenuPersonalizacao(interaction, store);
    return mostrarMenuRoot(interaction);
  }

  if (id === 'config:faq_add') {
    const modal = new ModalBuilder()
      .setCustomId('modal:faq_add')
      .setTitle('Adicionar pergunta ao FAQ');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('pergunta').setLabel('Pergunta').setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('resposta').setLabel('Resposta').setStyle(TextInputStyle.Paragraph).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }
  if (id === 'config:abrir_cores') return mostrarGradeCores(interaction, store);
  if (id === 'config:abrir_imagens') return mostrarMenuImagens(interaction, store);
  if (id === 'config:abrir_infos') return abrirModalPersonalizacao(interaction, store);

  // ---- Config: boas-vindas ----
  if (id === 'config:editar_boasvindas') {
    const modal = new ModalBuilder()
      .setCustomId('modal:boasvindas')
      .setTitle('Mensagem de Boas-vindas');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mensagem')
          .setLabel('Mensagem ({user}, {server}, {tag}, {membros})')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(store.welcome?.message || '👋 Bem-vindo(a) {user} ao **{server}**!')
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  // ---- Config: publicar/atualizar os cards de produto nos canais ----
  if (id === 'config:publicar') {
    const res = await publicarCards(interaction.guild);
    const container = v2Container(store, {
      title: '📤 Embeds publicadas!',
      description:
        res === null
          ? '⚠️ Nenhum canal de envio configurado. Configure em **Vendas → Canais de Envio das Embeds** primeiro.'
          : `✅ **${res.enviados}** card(s) novo(s) enviado(s) · **${res.editados}** atualizado(s) · **${res.removidos}** removido(s).\n\nOs clientes podem clicar em 🛒 **Comprar** direto no canal, sem digitar comando.`,
      sections: [secaoVoltar('vendas')]
    });
    return updateV2(interaction, container);
  }

  // ---- Config: construir container de produto ----
  if (id === 'config:construir') {
    return mostrarSelecaoProduto(interaction, store, 'construir');
  }

  // ---- Config: escolha de cor (clique em um dos botões de cor) ----
  if (id.startsWith('config:cor:')) {
    const hex = id.split(':')[2];
    const cor = CORES.find(c => c.hex === hex);
    if (!cor) return interaction.update({ content: 'Cor não encontrada.', embeds: [], components: [] });

    store.color = cor.hex;
    saveStore(interaction.guildId, store);

    // Atualiza o painel de ticket já publicado, se existir
    if (store.panelMessageId && store.ticket.panelChannelId) {
      try {
        const canal = await interaction.guild.channels.fetch(store.ticket.panelChannelId);
        const msg = await canal.messages.fetch(store.panelMessageId);
        await msg.edit({ components: [ticketPanelContainer(store, ticketPanelSelectRow())] });
      } catch (err) {
        // painel antigo nao encontrado, ignora
      }
    }

    const container = v2Container(store, {
      title: '🎨 Cor alterada!',
      description: `${cor.emoji} **${cor.nome}** (${cor.hex}) aplicada em todas as embeds do bot.`,
      sections: [secaoVoltar('personalizacao')]
    });
    await publicarCards(interaction.guild).catch(() => {});
    return updateV2(interaction, container);
  }

  // ---- Config: imagens por categoria ----
if (id.startsWith('config:imagem:')) {
    const categoria = id.split(':')[2];
    const cat = CATEGORIAS_IMAGEM.find(c => c.id === categoria);
    if (!cat) return interaction.update({ content: 'Categoria não encontrada.', embeds: [], components: [] });
    
    return solicitarUploadImagem(interaction, cat);
  }

  if (id.startsWith('config:cancelar_upload:')) {
    const catId = id.split(':')[2];
    const cat = CATEGORIAS_IMAGEM.find(c => c.id === catId);
    cancelPending(interaction.user.id, interaction.channel.id);
    
    const container = v2Container(store, {
      title: '❌ Upload cancelado',
      description: 'Operação cancelada.',
      sections: [secaoVoltar('personalizacao')]
    });
    return updateV2(interaction, container);
  }

  if (id.startsWith('config:confirmar_remocao:')) {
    const produtoId = id.split(':')[2];
    const antes = store.sales.products.length;
    store.sales.products = store.sales.products.filter(p => p.id !== produtoId);
    saveStore(interaction.guildId, store);
    const removeu = store.sales.products.length < antes;
    const container = v2Container(store, {
      title: removeu ? '🗑️ Produto removido' : '⚠️ Produto não encontrado',
      description: removeu ? 'O produto foi removido com sucesso. O card dele foi removido dos canais de venda.' : 'O produto já pode ter sido removido.',
      sections: [secaoVoltar('vendas')]
    });
    await publicarCards(interaction.guild).catch(() => {});
    return updateV2(interaction, container);
  }
}

// ---------- MODAIS: ABRIR ----------

async function abrirModalPersonalizacao(interaction, store) {
  const modal = new ModalBuilder().setCustomId('modal:personalizacao').setTitle('Personalização da Loja');

  const nomeBotInput = new TextInputBuilder()
    .setCustomId('nomeBot').setLabel('Nome do bot').setStyle(TextInputStyle.Short)
    .setValue(store.botName).setRequired(true);

  const nomeLojaInput = new TextInputBuilder()
    .setCustomId('nomeLoja').setLabel('Nome da loja').setStyle(TextInputStyle.Short)
    .setValue(store.storeName).setRequired(true);

  const logoInput = new TextInputBuilder()
    .setCustomId('logoUrl').setLabel('URL do logo da loja (opcional)').setStyle(TextInputStyle.Short)
    .setValue(store.logoUrl || '').setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nomeBotInput),
    new ActionRowBuilder().addComponents(nomeLojaInput),
    new ActionRowBuilder().addComponents(logoInput)
  );

  await interaction.showModal(modal);
}

// Upload de imagem via anexo no chat (substitui o modal de URL)
async function solicitarUploadImagem(interaction, cat) {
  const store = loadStore(interaction.guildId);
  const atual = store.images?.[cat.id] ? `\nAtual: ${store.images[cat.id]}` : '';
  
  const container = v2Container(store, {
    title: `🖼️ Upload — ${cat.nome}`,
    description:
      `Envie a imagem no chat (anexo) para definir como **${cat.nome}**.${atual}\n\n` +
      `*Tem 2 minutos para enviar. Cancele enviando "cancelar".*`,
    sections: [{
      label: 'Cancelar',
      accessory: new ButtonBuilder()
        .setCustomId(`config:cancelar_upload:${cat.id}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary)
    }]
  });
  
  await updateV2(interaction, container);
  
  // Aguarda o anexo
  try {
    const attachment = await waitForAttachment(interaction, { catId: cat.id });
    
    const store = loadStore(interaction.guildId);
    if (!store.images) store.images = { product: null, ticket: null, logs: null };
    store.images[cat.id] = attachment.url;
    saveStore(interaction.guildId, store);
    
    // Atualiza painel de ticket se for categoria ticket
    if (cat.id === 'ticket' && store.panelMessageId && store.ticket.panelChannelId) {
      try {
        const canal = await interaction.guild.channels.fetch(store.ticket.panelChannelId);
        const msg = await canal.messages.fetch(store.panelMessageId);
        await msg.edit({ components: [ticketPanelContainer(store, ticketPanelSelectRow())] });
      } catch (err) { /* ignora */ }
    }
    
    // Atualiza cards se for categoria product
    if (cat.id === 'product') {
      await publicarCards(interaction.guild).catch(() => {});
    }
    
    const containerSucesso = v2Container(store, {
      title: '✅ Imagem definida!',
      description: `Imagem de **${cat.nome}** atualizada com sucesso.`,
      sections: [secaoVoltar('personalizacao')]
    });
    return interaction.followUp({ components: [containerSucesso], flags: MessageFlags.Ephemeral });
    
  } catch (err) {
    const containerErro = v2Container(store, {
      title: '⏱️ Tempo esgotado',
      description: 'Nenhuma imagem foi enviada a tempo. Tente novamente.',
      sections: [secaoVoltar('personalizacao')]
    });
    return interaction.followUp({ components: [containerErro], flags: MessageFlags.Ephemeral });
  }
}

async function abrirModalHorarios(interaction, store) {
  const modal = new ModalBuilder().setCustomId('modal:horarios').setTitle('Horários de Reenvio Diário');

  const horariosInput = new TextInputBuilder()
    .setCustomId('horarios')
    .setLabel('Horários (HH:MM, separados por vírgula)')
    .setPlaceholder('09:00, 18:00')
    .setStyle(TextInputStyle.Short)
    .setValue((store.sales.sendTimes || []).join(', '))
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(horariosInput));
  await interaction.showModal(modal);
}

async function abrirModalPixKey(interaction, store) {
  const modal = new ModalBuilder().setCustomId('modal:pix_key').setTitle('🏦 Chave Pix');

  const pixInput = new TextInputBuilder()
    .setCustomId('pixKey')
    .setLabel('Chave Pix para pagamentos pendentes')
    .setStyle(TextInputStyle.Short)
    .setValue(store.pixKey || '')
    .setPlaceholder('ex: pix@innova.com')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(pixInput));
  await interaction.showModal(modal);
}

async function abrirModalNovoProduto(interaction) {
  const modal = new ModalBuilder().setCustomId('modal:novo_produto').setTitle('Adicionar Produto');

  const nomeInput = new TextInputBuilder()
    .setCustomId('nome').setLabel('Nome do produto (ex: Conta Blox Fruits #1)')
    .setStyle(TextInputStyle.Short).setRequired(true);

  const jogoInput = new TextInputBuilder()
    .setCustomId('jogo').setLabel('Jogo (ex: Blox Fruits, King Legacy, GPO, MM2)')
    .setStyle(TextInputStyle.Short).setRequired(true);

  const precoInput = new TextInputBuilder()
    .setCustomId('preco').setLabel('Preço (ex: 25.00)')
    .setStyle(TextInputStyle.Short).setRequired(true);

  const estoqueInput = new TextInputBuilder()
    .setCustomId('estoque').setLabel('Estoque inicial (quantidade)')
    .setStyle(TextInputStyle.Short).setValue('1').setRequired(true);

  const imagemInput = new TextInputBuilder()
    .setCustomId('imagemUrl').setLabel('URL da imagem/banner (opcional)')
    .setStyle(TextInputStyle.Short).setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nomeInput),
    new ActionRowBuilder().addComponents(jogoInput),
    new ActionRowBuilder().addComponents(precoInput),
    new ActionRowBuilder().addComponents(estoqueInput),
    new ActionRowBuilder().addComponents(imagemInput)
  );

  await interaction.showModal(modal);
}

async function abrirModalEditarProduto(interaction, store, produtoId) {
  const produto = store.sales.products.find(p => p.id === produtoId);
  if (!produto) {
    const container = v2Container(store, {
      title: '⚠️ Produto',
      description: 'Produto não encontrado.',
      sections: [secaoVoltar('vendas')]
    });
    return updateV2(interaction, container);
  }

  const modal = new ModalBuilder().setCustomId(`modal:editar_produto:${produtoId}`).setTitle('Editar Produto');

  const nomeInput = new TextInputBuilder()
    .setCustomId('nome').setLabel('Nome do produto').setStyle(TextInputStyle.Short)
    .setValue(produto.name).setRequired(true);

  const jogoInput = new TextInputBuilder()
    .setCustomId('jogo').setLabel('Jogo').setStyle(TextInputStyle.Short)
    .setValue(produto.game).setRequired(true);

  const precoInput = new TextInputBuilder()
    .setCustomId('preco').setLabel('Preço (ex: 25.00)').setStyle(TextInputStyle.Short)
    .setValue(String(produto.price)).setRequired(true);

  const estoqueInput = new TextInputBuilder()
    .setCustomId('estoque').setLabel('Estoque').setStyle(TextInputStyle.Short)
    .setValue(String(produto.stock)).setRequired(true);

  const imagemInput = new TextInputBuilder()
    .setCustomId('imagemUrl').setLabel('URL da imagem/banner (opcional)').setStyle(TextInputStyle.Short)
    .setValue(produto.imageUrl || '').setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nomeInput),
    new ActionRowBuilder().addComponents(jogoInput),
    new ActionRowBuilder().addComponents(precoInput),
    new ActionRowBuilder().addComponents(estoqueInput),
    new ActionRowBuilder().addComponents(imagemInput)
  );

  await interaction.showModal(modal);
}

async function abrirModalDefinirPreco(interaction, produtoId) {
  const modal = new ModalBuilder().setCustomId(`modal:definir_preco:${produtoId}`).setTitle('Definir Preço');
  const precoInput = new TextInputBuilder()
    .setCustomId('preco').setLabel('Novo preço (ex: 25.00)').setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(precoInput));
  await interaction.showModal(modal);
}

async function abrirModalDefinirEstoque(interaction, produtoId) {
  const modal = new ModalBuilder().setCustomId(`modal:definir_estoque:${produtoId}`).setTitle('Definir Estoque');
  const estoqueInput = new TextInputBuilder()
    .setCustomId('estoque').setLabel('Quantidade em estoque').setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(estoqueInput));
  await interaction.showModal(modal);
}

// Construtor de container de produto: titulo + divisorias + info livre
async function abrirModalConstruirCard(interaction, store, produtoId) {
  const produto = store.sales.products.find(p => p.id === produtoId);
  if (!produto) {
    const container = v2Container(store, {
      title: '⚠️ Produto',
      description: 'Produto não encontrado.',
      sections: [secaoVoltar('vendas')]
    });
    return updateV2(interaction, container);
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal:construir_card:${produtoId}`)
    .setTitle(`🛠️ Construir Card — ${produto.name.slice(0, 28)}`);

  const tituloInput = new TextInputBuilder()
    .setCustomId('titulo')
    .setLabel('Título do card')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: 🎮 V-Bucks 10.000 (Fortnite)')
    .setValue(produto.name)
    .setRequired(true);

  const divAcimaInput = new TextInputBuilder()
    .setCustomId('divAcima')
    .setLabel('Divisória antes da info? (sim/nao)')
    .setStyle(TextInputStyle.Short)
    .setValue('sim')
    .setRequired(true);

  const infoInput = new TextInputBuilder()
    .setCustomId('info')
    .setLabel('Info sobre o produto (o que quiser)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Ex: 💰 Valor à vista: R$ 40,00\n📦 Restam: 5 unidades\n⚡ Entrega em até 30 min')
    .setRequired(true);

  const divAbaixoInput = new TextInputBuilder()
    .setCustomId('divAbaixo')
    .setLabel('Divisória depois da info? (sim/nao)')
    .setStyle(TextInputStyle.Short)
    .setValue('sim')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(tituloInput),
    new ActionRowBuilder().addComponents(divAcimaInput),
    new ActionRowBuilder().addComponents(infoInput),
    new ActionRowBuilder().addComponents(divAbaixoInput)
  );

  await interaction.showModal(modal);
}

// ---------- MODAIS: PROCESSAR ENVIO ----------

async function handleModalSubmit(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);

  // ---- Avaliacao de clientes (staff): modal de nota ----
  if (id.startsWith('aval:modal:')) return handleAvaliacaoModal(interaction);

  if (id.startsWith('modal:entrega:')) {
    return processarEntrega(interaction);
  }

  if (id === 'modal:faq_add') {
    const pergunta = interaction.fields.getTextInputValue('pergunta').trim();
    const resposta = interaction.fields.getTextInputValue('resposta').trim();
    if (!store.ticket.faq) store.ticket.faq = [];
    store.ticket.faq.push({ id: generateId('faq_'), pergunta, resposta });
    saveStore(interaction.guildId, store);
    return mostrarMenuTicket(interaction);
  }

  if (id === 'modal:boasvindas') {
    if (!store.welcome) store.welcome = { channelId: null, message: null };
    store.welcome.message = interaction.fields.getTextInputValue('mensagem').trim();
    saveStore(interaction.guildId, store);
    return mostrarMenuWelcome(interaction, store);
  }

  if (id === 'modal:personalizacao') {
    store.botName = interaction.fields.getTextInputValue('nomeBot').trim();
    store.storeName = interaction.fields.getTextInputValue('nomeLoja').trim();
    const logoUrl = interaction.fields.getTextInputValue('logoUrl')?.trim();
    store.logoUrl = logoUrl || null;
    saveStore(interaction.guildId, store);

    try {
      await interaction.guild.members.me.setNickname(store.botName);
    } catch (err) {
      console.warn('Não foi possível alterar o apelido do bot:', err.message);
    }

    return interaction.reply({ content: '✅ Personalização atualizada com sucesso.', flags: MessageFlags.Ephemeral });
  }

  if (id === 'modal:horarios') {
    const texto = interaction.fields.getTextInputValue('horarios');
    const horarios = texto.split(',').map(h => h.trim()).filter(h => /^\d{1,2}:\d{2}$/.test(h));
    store.sales.sendTimes = horarios;
    saveStore(interaction.guildId, store);
    return interaction.reply({ content: `✅ Horários definidos: ${horarios.join(', ') || 'nenhum válido'}`, flags: MessageFlags.Ephemeral });
  }

  if (id === 'modal:pix_key') {
    store.pixKey = interaction.fields.getTextInputValue('pixKey').trim();
    saveStore(interaction.guildId, store);
    return interaction.reply({ content: `✅ Chave Pix configurada: \`${store.pixKey}\``, flags: MessageFlags.Ephemeral });
  }

  if (id === 'modal:novo_produto') {
    const nome = interaction.fields.getTextInputValue('nome').trim();
    const jogo = interaction.fields.getTextInputValue('jogo').trim();
    const preco = parseFloat(interaction.fields.getTextInputValue('preco').replace(',', '.')) || 0;
    const estoque = parseInt(interaction.fields.getTextInputValue('estoque'), 10) || 0;
    const imagemUrl = interaction.fields.getTextInputValue('imagemUrl')?.trim() || null;

    store.sales.products.push({
      id: generateId('prod_'),
      name: nome,
      game: jogo,
      price: preco,
      stock: estoque,
      channelId: null,
      imageUrl: imagemUrl,
      description: null
    });
    saveStore(interaction.guildId, store);

    await publicarCards(interaction.guild).catch(() => {});

    return interaction.reply({
      content: `✅ Produto "${nome}" adicionado (${jogo}) — R$ ${preco.toFixed(2)}, estoque: ${estoque}. Os cards foram atualizados nos canais de venda.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (id.startsWith('modal:editar_produto:')) {
    const produtoId = id.split(':')[2];
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (!produto) return interaction.reply({ content: 'Produto não encontrado.', flags: MessageFlags.Ephemeral });

    produto.name = interaction.fields.getTextInputValue('nome').trim();
    produto.game = interaction.fields.getTextInputValue('jogo').trim();
    produto.price = parseFloat(interaction.fields.getTextInputValue('preco').replace(',', '.')) || produto.price;
    produto.stock = parseInt(interaction.fields.getTextInputValue('estoque'), 10) || 0;
    produto.imageUrl = interaction.fields.getTextInputValue('imagemUrl')?.trim() || null;

    saveStore(interaction.guildId, store);
    await publicarCards(interaction.guild).catch(() => {});
    return interaction.reply({ content: `✅ Produto "${produto.name}" atualizado. Os cards foram atualizados nos canais de venda.`, flags: MessageFlags.Ephemeral });
  }

  if (id.startsWith('modal:definir_preco:')) {
    const produtoId = id.split(':')[2];
    const preco = parseFloat(interaction.fields.getTextInputValue('preco').replace(',', '.')) || 0;
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (produto) {
      produto.price = preco;
      saveStore(interaction.guildId, store);
      await publicarCards(interaction.guild).catch(() => {});
      return interaction.reply({ content: `✅ Preço de "${produto.name}" atualizado para R$ ${preco.toFixed(2)}. Os cards foram atualizados nos canais de venda.`, flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ content: 'Produto não encontrado.', flags: MessageFlags.Ephemeral });
  }

  if (id.startsWith('modal:definir_estoque:')) {
    const produtoId = id.split(':')[2];
    const estoque = parseInt(interaction.fields.getTextInputValue('estoque'), 10) || 0;
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (produto) {
      produto.stock = estoque;
      if (estoque > 2) produto.alertaEnviado = false; // rearma o alerta de estoque baixo

      // Avisa na DM todos que pediram para ser notificados da reposicao
      if (estoque > 0 && produto.notifyList?.length > 0) {
        const lista = [...produto.notifyList];
        produto.notifyList = [];
        saveStore(interaction.guildId, store);
        for (const uid of lista) {
          const u = await interaction.client.users.fetch(uid).catch(() => null);
          if (u) {
            await u.send({
              content: `🎉 **Boas notícias!** O produto **${produto.name}** voltou ao estoque por **R$ ${produto.price.toFixed(2)}**! Corre pro card antes de esgotar de novo. 🏃`
            }).catch(() => {});
          }
        }
      } else {
        saveStore(interaction.guildId, store);
      }
      await publicarCards(interaction.guild).catch(() => {});
      return interaction.reply({ content: `✅ Estoque de "${produto.name}" atualizado para ${estoque}. Os cards foram atualizados nos canais de venda.`, flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ content: 'Produto não encontrado.', flags: MessageFlags.Ephemeral });
  }

  // Construtor de container: monta o container V2 e publica nos canais de envio
  if (id.startsWith('modal:construir_card:')) {
    const produtoId = id.split(':')[2];
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (!produto) return interaction.reply({ content: 'Produto não encontrado.', flags: MessageFlags.Ephemeral });

    const titulo = interaction.fields.getTextInputValue('titulo').trim() || produto.name;
    const divAcima = interaction.fields.getTextInputValue('divAcima').trim().toLowerCase().startsWith('s');
    const info = interaction.fields.getTextInputValue('info').trim();
    const divAbaixo = interaction.fields.getTextInputValue('divAbaixo').trim().toLowerCase().startsWith('s');

    const container = montarContainerProduto(store, produto, { titulo, info, divAcima, divAbaixo });

    const canais = store.sales.sendChannelIds || [];
    let enviados = 0;
    if (canais.length > 0) {
      for (const canalId of canais) {
        const canal = await interaction.guild.channels.fetch(canalId).catch(() => null);
        if (!canal) continue;
        const msg = await canal.send({ components: [container], flags: [MessageFlags.IsComponentsV2] }).catch(err => {
          console.log('[construir] falha ao enviar em ' + canalId + ': ' + (err.code || '') + ' ' + (err.message || ''));
          return null;
        });
        if (msg) enviados++;
      }
    } else {
      const msg = await interaction.channel.send({ components: [container], flags: [MessageFlags.IsComponentsV2] }).catch(() => null);
      if (msg) enviados++;
    }

    const resumo =
      `**Título:** ${titulo}\n` +
      `**Divisória acima:** ${divAcima ? 'sim' : 'não'}\n` +
      `**Info:** ${info.slice(0, 80)}${info.length > 80 ? '…' : ''}\n` +
      `**Divisória abaixo:** ${divAbaixo ? 'sim' : 'não'}\n\n` +
      (enviados > 0
        ? `✅ Card publicado em **${enviados}** canal(ais) com o botão 🛒 Comprar.`
        : '⚠️ Não foi possível publicar (nenhum canal de envio configurado ou sem permissão).');

    return interaction.reply({ content: `🛠️ **Card construído!**\n\n${resumo}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { handleInteraction, handleMessage: require('../utils/attachmentCollector').handleMessage };
