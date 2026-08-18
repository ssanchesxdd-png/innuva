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
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const { loadStore, saveStore, generateId } = require('../storage');
const { productCardEmbed, productManageListEmbed, ticketPanelEmbed } = require('../utils/embeds');
const { abrirTicket, confirmarVenda, processarConfirmacaoVenda, pagarComSaldo, pagarComPix, cancelarSessao, fecharTicket } = require('./tickets');
const { pagamentoAprovado, cancelarPendente, handleReferencia, handleComprarTambem } = require('./sales');

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
    const payload = { content: 'Ocorreu um erro ao processar isso. Tente novamente.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

// ---------- HELPERS DE NAVEGACAO ----------

function botaoVoltar(destino) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`config:voltar:${destino}`)
      .setLabel('⬅️ Voltar')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function mostrarMenuRoot(interaction) {
  const store = loadStore(interaction.guildId);
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Configuração da Loja')
    .setDescription('Escolha uma categoria abaixo para configurar.')
    .setColor(store.color || '#5865F2');

  const menu = new StringSelectMenuBuilder()
    .setCustomId('config:menu:root')
    .setPlaceholder('Selecione uma categoria')
    .addOptions([
      { label: 'Configurações de Vendas', value: 'vendas', emoji: '💰', description: 'Preços, canais, horários, produtos e estoque' },
      { label: 'Configurações de Ticket', value: 'ticket', emoji: '🎫', description: 'Canal do painel de suporte/ticket' },
      { label: 'Configurações de Logs', value: 'logs', emoji: '📋', description: 'Canais de log privado e público' },
      { label: 'Personalização', value: 'personalizacao', emoji: '🎨', description: 'Nome do bot, cor da loja, imagens e logo' }
    ]);

  const row = new ActionRowBuilder().addComponents(menu);
  await interaction.update({ content: null, embeds: [embed], components: [row] });
}

async function mostrarMenuVendas(interaction) {
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
  const row = new ActionRowBuilder().addComponents(menu);
  const embed = new EmbedBuilder().setTitle('💰 Configurações de Vendas').setColor('#5865F2')
    .setDescription('Escolha o que deseja configurar.');
  await interaction.update({ content: null, embeds: [embed], components: [row, botaoVoltar('root')] });
}

// ---------- STRING SELECT MENUS ----------

async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);

  if (id === 'config:menu:root') {
    const escolha = interaction.values[0];
    if (escolha === 'vendas') return mostrarMenuVendas(interaction);
    if (escolha === 'ticket') return mostrarMenuTicket(interaction);
    if (escolha === 'logs') return mostrarMenuLogs(interaction);
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
      const embed = productManageListEmbed(store);
      return interaction.update({ content: null, embeds: [embed], components: [botaoVoltar('vendas')] });
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
      const embed = productCardEmbed(store, produto);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`publico:comprar_produto:${produto.id}`)
          .setLabel('Comprar')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🛒')
      );
      await interaction.channel.send({ embeds: [embed], components: [row] });
    }
  }
}

async function mostrarMenuTicket(interaction) {
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId('config:canal:ticket_panel')
    .setPlaceholder('Selecione o canal do painel de suporte')
    .setChannelTypes(ChannelType.GuildText);
  const row = new ActionRowBuilder().addComponents(channelMenu);
  const embed = new EmbedBuilder().setTitle('🎫 Configuração de Ticket').setColor('#5865F2')
    .setDescription('Selecione em qual canal o painel de "Abrir Ticket" será publicado.');
  await interaction.update({ content: null, embeds: [embed], components: [row, botaoVoltar('root')] });
}

async function mostrarMenuLogs(interaction) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('config:menu:logs')
    .setPlaceholder('Qual log deseja configurar?')
    .addOptions([
      { label: 'Log Privado (staff)', value: 'privado', emoji: '🔒' },
      { label: 'Log Público (todos)', value: 'publico', emoji: '📢' }
    ]);
  const row = new ActionRowBuilder().addComponents(menu);
  const embed = new EmbedBuilder().setTitle('📋 Configuração de Logs').setColor('#5865F2')
    .setDescription('Escolha qual tipo de log deseja configurar.');
  await interaction.update({ content: null, embeds: [embed], components: [row, botaoVoltar('root')] });
}

// Menu de personalizacao: cor (com emojis), imagens por categoria, nome/logo
async function mostrarMenuPersonalizacao(interaction, store) {
  const embed = new EmbedBuilder()
    .setTitle('🎨 Personalização')
    .setDescription(
      `**Cor atual:** ${CORES.find(c => c.hex === store.color)?.emoji || '🎨'} ${CORES.find(c => c.hex === store.color)?.nome || store.color}\n\n` +
      'Escolha abaixo o que deseja configurar:'
    )
    .setColor(store.color || '#5865F2');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('config:abrir_cores')
      .setLabel('Escolher Cor')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎨'),
    new ButtonBuilder()
      .setCustomId('config:abrir_imagens')
      .setLabel('Imagens das Embeds')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🖼️'),
    new ButtonBuilder()
      .setCustomId('config:abrir_infos')
      .setLabel('Nome, Logo e Info')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️')
  );

  await interaction.update({ content: null, embeds: [embed], components: [row, botaoVoltar('root')] });
}

// Grade de cores com emojis (12 cores, 3 linhas de 4)
async function mostrarGradeCores(interaction, store) {
  const embed = new EmbedBuilder()
    .setTitle('🎨 Escolha a cor da loja')
    .setDescription(
      `Cor atual: **${CORES.find(c => c.hex === store.color)?.emoji || '🎨'}** ${CORES.find(c => c.hex === store.color)?.nome || store.color}\n\n` +
      'Clique em uma cor para aplicar em **TODAS** as embeds do bot.'
    )
    .setColor(store.color || '#5865F2');

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

  await interaction.update({ content: null, embeds: [embed], components: [...rows, botaoVoltar('personalizacao')] });
}

// Categorias de imagem das embeds
async function mostrarMenuImagens(interaction, store) {
  const embed = new EmbedBuilder()
    .setTitle('🖼️ Imagens das Embeds')
    .setDescription('Escolha a categoria e defina a imagem (banner) dela:')
    .setColor(store.color || '#5865F2');

  const row = new ActionRowBuilder().addComponents(
    CATEGORIAS_IMAGEM.map(cat =>
      new ButtonBuilder()
        .setCustomId(`config:imagem:${cat.id}`)
        .setLabel(cat.nome)
        .setEmoji(cat.emoji)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const desc = new EmbedBuilder()
    .setTitle('🖼️ Categorias de imagem')
    .setDescription(
      CATEGORIAS_IMAGEM.map(cat =>
        `${cat.emoji} **${cat.nome}** — ${cat.descricao}` +
        (store.images?.[cat.id] ? `\n&nbsp;&nbsp;🔗 Atual: \`${store.images[cat.id]}\`` : '')
      ).join('\n\n')
    )
    .setColor(store.color || '#5865F2');

  await interaction.update({ content: null, embeds: [embed, desc], components: [row, botaoVoltar('personalizacao')] });
}

async function mostrarSelecaoCanalLog(interaction, tipo) {
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`config:canal:log_${tipo}`)
    .setPlaceholder(`Selecione o canal de log ${tipo}`)
    .setChannelTypes(ChannelType.GuildText);
  const row = new ActionRowBuilder().addComponents(channelMenu);
  const embed = new EmbedBuilder().setTitle(`📋 Log ${tipo}`).setColor('#5865F2')
    .setDescription(`Selecione o canal de texto para o log ${tipo}.`);
  await interaction.update({ content: null, embeds: [embed], components: [row, botaoVoltar('logs')] });
}

async function mostrarSelecaoCanaisEnvio(interaction, store) {
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId('config:canal:envio_vendas')
    .setPlaceholder('Selecione até 5 canais')
    .setMinValues(1)
    .setMaxValues(5)
    .setChannelTypes(ChannelType.GuildText);
  const row = new ActionRowBuilder().addComponents(channelMenu);
  const embed = new EmbedBuilder().setTitle('📢 Canais de Envio das Embeds').setColor('#5865F2')
    .setDescription('Selecione em quais canais os cards de produto serão publicados e reenviados diariamente.');
  await interaction.update({ content: null, embeds: [embed], components: [row, botaoVoltar('vendas')] });
}

async function mostrarSelecaoProduto(interaction, store, finalidade) {
  if (store.sales.products.length === 0) {
    return interaction.update({
      content: 'Nenhum produto cadastrado ainda. Use "Adicionar Produto" primeiro.',
      embeds: [], components: [botaoVoltar('vendas')]
    });
  }

  const descricaoPorFinalidade = {
    preco: p => `Preço atual: R$ ${p.price.toFixed(2)}`,
    estoque: p => `Estoque atual: ${p.stock}`,
    editar: p => `${p.game} · R$ ${p.price.toFixed(2)} · estoque ${p.stock}`,
    remover: p => `${p.game} · R$ ${p.price.toFixed(2)} · estoque ${p.stock}`
  };

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`config:selecionar_produto:${finalidade}`)
    .setPlaceholder('Selecione o produto')
    .addOptions(store.sales.products.slice(0, 25).map(p => ({
      label: `${p.name} (${p.game})`,
      value: p.id,
      description: descricaoPorFinalidade[finalidade](p)
    })));

  const row = new ActionRowBuilder().addComponents(menu);
  await interaction.update({ content: null, embeds: [], components: [row, botaoVoltar('vendas')] });
}

async function mostrarConfirmacaoRemover(interaction, store, produtoId) {
  const produto = store.sales.products.find(p => p.id === produtoId);
  if (!produto) {
    return interaction.update({ content: 'Produto não encontrado.', embeds: [], components: [botaoVoltar('vendas')] });
  }

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirmar remoção')
    .setDescription(`Tem certeza que deseja remover **${produto.name}** (${produto.game})? Essa ação não pode ser desfeita.`)
    .setColor('#ED4245');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`config:confirmar_remocao:${produtoId}`).setLabel('Sim, remover').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    new ButtonBuilder().setCustomId('config:voltar:vendas').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ content: null, embeds: [embed], components: [row] });
}

// ---------- CHANNEL SELECT MENUS ----------

async function handleChannelSelectMenu(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);
  const canal = interaction.values[0];

  if (id === 'config:canal:ticket_panel') {
    store.ticket.panelChannelId = canal;
    saveStore(interaction.guildId, store);

    const channelObj = await interaction.guild.channels.fetch(canal);
    const embed = ticketPanelEmbed(store);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:abrir').setLabel('Abrir Ticket').setStyle(ButtonStyle.Success).setEmoji('🎫')
    );
    const msg = await channelObj.send({ embeds: [embed], components: [row] });
    store.panelMessageId = msg.id;
    saveStore(interaction.guildId, store);

    return interaction.update({ content: `✅ Canal de ticket configurado: <#${canal}>`, embeds: [], components: [botaoVoltar('root')] });
  }

  if (id === 'config:canal:log_privado') {
    store.logs.privateChannelId = canal;
    saveStore(interaction.guildId, store);
    return interaction.update({ content: `✅ Log privado configurado: <#${canal}>`, embeds: [], components: [botaoVoltar('root')] });
  }

  if (id === 'config:canal:log_publico') {
    store.logs.publicChannelId = canal;
    saveStore(interaction.guildId, store);
    return interaction.update({ content: `✅ Log público configurado: <#${canal}>`, embeds: [], components: [botaoVoltar('root')] });
  }

  if (id === 'config:canal:envio_vendas') {
    const canais = interaction.values;
    store.sales.sendChannelIds = canais;
    saveStore(interaction.guildId, store);
    return interaction.update({
      content: `✅ Canais de envio configurados: ${canais.map(c => `<#${c}>`).join(', ')}`,
      embeds: [], components: [botaoVoltar('vendas')]
    });
  }
}

// ---------- BOTOES ----------

async function handleButton(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);

  // ---- Tickets ----
  if (id === 'ticket:abrir') return abrirTicket(interaction, store, null);
  if (id === 'ticket:confirmar_venda') return confirmarVenda(interaction);
  if (id === 'ticket:fechar') return fecharTicket(interaction);

  if (id.startsWith('ticket:pagar_saldo:')) {
    return pagarComSaldo(interaction, id.split(':')[2]);
  }
  if (id.startsWith('ticket:pagar_pix:')) {
    return pagarComPix(interaction, id.split(':')[2]);
  }
  if (id.startsWith('ticket:cancelar_sessao:')) {
    return cancelarSessao(interaction, id.split(':')[2]);
  }
  if (id.startsWith('ticket:pagamento_aprovado:')) {
    return pagamentoAprovado(interaction, id.split(':')[2]);
  }
  if (id.startsWith('ticket:cancelar_pendente:')) {
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
    return abrirTicket(interaction, store, produto ? produto.name : null);
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

  if (id === 'config:abrir_cores') return mostrarGradeCores(interaction, store);
  if (id === 'config:abrir_imagens') return mostrarMenuImagens(interaction, store);
  if (id === 'config:abrir_infos') return abrirModalPersonalizacao(interaction, store);

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
        await msg.edit({ embeds: [ticketPanelEmbed(store)] });
      } catch (err) {
        // painel antigo nao encontrado, ignora
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🎨 Cor alterada!')
      .setDescription(`${cor.emoji} **${cor.nome}** (${cor.hex}) aplicada em todas as embeds do bot.`)
      .setColor(cor.hex);
    return interaction.update({ content: null, embeds: [embed], components: [botaoVoltar('personalizacao')] });
  }

  // ---- Config: imagens por categoria ----
  if (id.startsWith('config:imagem:')) {
    const categoria = id.split(':')[2];
    const cat = CATEGORIAS_IMAGEM.find(c => c.id === categoria);
    if (!cat) return interaction.update({ content: 'Categoria não encontrada.', embeds: [], components: [] });

    return abrirModalImagem(interaction, cat);
  }

  if (id.startsWith('config:confirmar_remocao:')) {
    const produtoId = id.split(':')[2];
    const antes = store.sales.products.length;
    store.sales.products = store.sales.products.filter(p => p.id !== produtoId);
    saveStore(interaction.guildId, store);
    const removeu = store.sales.products.length < antes;
    return interaction.update({
      content: removeu ? '✅ Produto removido com sucesso.' : 'Produto não encontrado (já pode ter sido removido).',
      embeds: [], components: [botaoVoltar('vendas')]
    });
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

async function abrirModalImagem(interaction, cat) {
  const store = loadStore(interaction.guildId);
  const modal = new ModalBuilder().setCustomId(`modal:imagem:${cat.id}`).setTitle(`🖼️ Imagem — ${cat.nome}`);

  const urlInput = new TextInputBuilder()
    .setCustomId('url')
    .setLabel('URL da imagem (banner)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://i.imgur.com/... (deixe vazio para limpar)')
    .setValue(store.images?.[cat.id] || '')
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
  await interaction.showModal(modal);
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
    return interaction.update({ content: 'Produto não encontrado.', embeds: [], components: [botaoVoltar('vendas')] });
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

// ---------- MODAIS: PROCESSAR ENVIO ----------

async function handleModalSubmit(interaction) {
  const id = interaction.customId;
  const store = loadStore(interaction.guildId);

  if (id === 'modal:confirmar_venda') {
    return processarConfirmacaoVenda(interaction);
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

    return interaction.reply({ content: '✅ Personalização atualizada com sucesso.', ephemeral: true });
  }

  // Imagem por categoria
  if (id.startsWith('modal:imagem:')) {
    const categoria = id.split(':')[2];
    const cat = CATEGORIAS_IMAGEM.find(c => c.id === categoria);
    if (!cat) return interaction.reply({ content: 'Categoria não encontrada.', ephemeral: true });

    const url = interaction.fields.getTextInputValue('url')?.trim() || null;
    if (!store.images) store.images = { product: null, ticket: null, logs: null };
    store.images[cat.id] = url;
    saveStore(interaction.guildId, store);

    // Se a categoria for ticket, atualiza o painel publicado
    if (cat.id === 'ticket' && store.panelMessageId && store.ticket.panelChannelId) {
      try {
        const canal = await interaction.guild.channels.fetch(store.ticket.panelChannelId);
        const msg = await canal.messages.fetch(store.panelMessageId);
        await msg.edit({ embeds: [ticketPanelEmbed(store)] });
      } catch (err) {
        // ignora
      }
    }

    return interaction.reply({
      content: url ? `✅ Imagem de **${cat.nome}** definida.` : `🗑️ Imagem de **${cat.nome}** removida.`,
      ephemeral: true
    });
  }

  if (id === 'modal:horarios') {
    const texto = interaction.fields.getTextInputValue('horarios');
    const horarios = texto.split(',').map(h => h.trim()).filter(h => /^\d{1,2}:\d{2}$/.test(h));
    store.sales.sendTimes = horarios;
    saveStore(interaction.guildId, store);
    return interaction.reply({ content: `✅ Horários definidos: ${horarios.join(', ') || 'nenhum válido'}`, ephemeral: true });
  }

  if (id === 'modal:pix_key') {
    store.pixKey = interaction.fields.getTextInputValue('pixKey').trim();
    saveStore(interaction.guildId, store);
    return interaction.reply({ content: `✅ Chave Pix configurada: \`${store.pixKey}\``, ephemeral: true });
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

    return interaction.reply({
      content: `✅ Produto "${nome}" adicionado (${jogo}) — R$ ${preco.toFixed(2)}, estoque: ${estoque}.`,
      ephemeral: true
    });
  }

  if (id.startsWith('modal:editar_produto:')) {
    const produtoId = id.split(':')[2];
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (!produto) return interaction.reply({ content: 'Produto não encontrado.', ephemeral: true });

    produto.name = interaction.fields.getTextInputValue('nome').trim();
    produto.game = interaction.fields.getTextInputValue('jogo').trim();
    produto.price = parseFloat(interaction.fields.getTextInputValue('preco').replace(',', '.')) || produto.price;
    produto.stock = parseInt(interaction.fields.getTextInputValue('estoque'), 10) || 0;
    produto.imageUrl = interaction.fields.getTextInputValue('imagemUrl')?.trim() || null;

    saveStore(interaction.guildId, store);
    return interaction.reply({ content: `✅ Produto "${produto.name}" atualizado.`, ephemeral: true });
  }

  if (id.startsWith('modal:definir_preco:')) {
    const produtoId = id.split(':')[2];
    const preco = parseFloat(interaction.fields.getTextInputValue('preco').replace(',', '.')) || 0;
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (produto) {
      produto.price = preco;
      saveStore(interaction.guildId, store);
      return interaction.reply({ content: `✅ Preço de "${produto.name}" atualizado para R$ ${preco.toFixed(2)}.`, ephemeral: true });
    }
    return interaction.reply({ content: 'Produto não encontrado.', ephemeral: true });
  }

  if (id.startsWith('modal:definir_estoque:')) {
    const produtoId = id.split(':')[2];
    const estoque = parseInt(interaction.fields.getTextInputValue('estoque'), 10) || 0;
    const produto = store.sales.products.find(p => p.id === produtoId);
    if (produto) {
      produto.stock = estoque;
      saveStore(interaction.guildId, store);
      return interaction.reply({ content: `✅ Estoque de "${produto.name}" atualizado para ${estoque}.`, ephemeral: true });
    }
    return interaction.reply({ content: 'Produto não encontrado.', ephemeral: true });
  }
}

module.exports = { handleInteraction };