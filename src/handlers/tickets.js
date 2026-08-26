// src/handlers/tickets.js
// Toda a logica de abrir um ticket (thread), finalizar venda (modal com cupom,
// saldo e foto de referencia) e escolher a forma de pagamento.

const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder
} = require('discord.js');
const { loadStore, saveStore, generateId } = require('../storage');
const { privateLogContainer } = require('../utils/embeds');
const { aplicarCupom, calcularDesconto, registrarUso } = require('./coupons');
const { criarPendencia, pagamentoAprovado } = require('./sales');

// Tipos de ticket disponíveis no seletor do painel
const TIPOS_TICKET = {
  suporte: {
    id: 'suporte',
    emoji: '🎧',
    nome: 'Suporte & Dúvidas',
    descricao: 'Clique para receber suporte e tirar dúvidas',
    prefacio: 'suporte'
  },
  compras: {
    id: 'compras',
    emoji: '🛒',
    nome: 'Compras',
    descricao: 'Clique para obter ajuda a resgatar ou usar seu produto',
    prefacio: 'compras'
  }
};

// Guarda a sessao da venda em andamento: threadId -> dados do modal
const sessaoVendaMap = new Map();

// Monta o seletor de tipos de ticket para o painel (substitui o botão único)
function ticketPanelSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket:tipo')
      .setPlaceholder('Selecione o tipo de atendimento')
      .addOptions(
        Object.values(TIPOS_TICKET).map(t => ({
          label: `${t.emoji} ${t.nome}`,
          value: t.id,
          description: t.descricao
        }))
      )
  );
}

// ---------- FLUXO DO TICKET ----------
// Uma unica mensagem que se transforma por estagios:
// Verifica se o autor da interacao e staff (cargo configurado ou ManageGuild)
function ehStaff(interaction) {
  const staffRoleIds = (process.env.STAFF_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const member = interaction.member;
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    staffRoleIds.some(r => member.roles?.cache?.has(r));
}

async function abrirTicket(interaction, store, tipoOuProduto, tipoId) {
  // Impede mais de um ticket aberto por usuario (validando que o canal ainda existe)
  const ticketExistente = Object.entries(store.ticket.open || {}).find(([, t]) => t.userId === interaction.user.id);
  if (ticketExistente) {
    const [canalIdAntigo] = ticketExistente;
    const canalAntigo = await interaction.guild.channels.fetch(canalIdAntigo).catch(() => null);

    if (canalAntigo && interaction.member.permissionsIn(canalAntigo).has(PermissionFlagsBits.ViewChannel)) {
      return interaction.reply({
        content: `❌ Você já tem um ticket aberto: <#${canalIdAntigo}>. Encerre ele antes de abrir outro.`,
        flags: MessageFlags.Ephemeral
      });
    }

    delete store.ticket.open[canalIdAntigo];
    saveStore(interaction.guildId, store);
  }

  const panelChannel = await interaction.guild.channels.fetch(store.ticket.panelChannelId).catch(() => null);
  if (!panelChannel) {
    return interaction.reply({
      content: 'O canal de tickets configurado nao foi encontrado. Avise a staff.',
      flags: MessageFlags.Ephemeral
    });
  }

  const tipo = tipoId ? TIPOS_TICKET[tipoId] : TIPOS_TICKET.compras;
  const produtoNomeSugerido = typeof tipoOuProduto === 'string' ? tipoOuProduto : null;

  const categoriaId = store.ticket.categories?.[tipo.id];
  if (!categoriaId) {
    return interaction.reply({
      content: `A categoria para tickets de **${tipo.nome}** ainda não foi configurada. Avise a staff (/config > Ticket).`,
      flags: MessageFlags.Ephemeral
    });
  }

  // Permissões: staff (env STAFF_ROLE_IDS) + autor veem; @everyone nao ve
  const staffRoleIds = (process.env.STAFF_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    }
  ];
  for (const roleId of staffRoleIds) {
    if (interaction.guild.roles.cache.has(roleId)) {
      overwrites.push({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
      });
    }
  }

  const nomeBase = `${tipo.prefacio}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 90);

  const canal = await interaction.guild.channels.create({
    name: nomeBase,
    type: ChannelType.GuildText,
    parent: categoriaId,
    topic: `Ticket de ${tipo.nome} | Aberto por ${interaction.user.tag} (${interaction.user.id})`,
    reason: `Ticket de ${tipo.nome} aberto por ${interaction.user.tag}`,
    permissionOverwrites: overwrites
  });

  // Registro do ticket com estagio inicial:
  // carrinho se veio de um botao Comprar (produto valido), senao boas-vindas
  const registro = {
    userId: interaction.user.id,
    tipoId: tipo.id,
    openedAt: Date.now(),
    stage: 'welcome',
    cart: null,
    couponCode: null,
    cartMessageId: null,
    pendingId: null
  };

  if (tipo.id === 'compras') {
    const produto = resolverProduto(store, produtoNomeSugerido);
    if (produto && produto.stock > 0) {
      registro.cart = { produtoId: produto.id, quantity: 1 };
      registro.stage = 'carrinho';
    }
  }

  store.ticket.open[canal.id] = registro;
  saveStore(interaction.guildId, store);

  // Mensagem UNICA do ticket (se transforma por estagios)
  const principal = await canal.send(renderEstagio(store, registro)).catch(err => {
    console.error('[ticket] erro ao enviar mensagem principal:', err);
    return null;
  });
  if (principal) {
    registro.cartMessageId = principal.id;
    saveStore(interaction.guildId, store);
  }

  // Notifica o log privado (staff) sobre o novo ticket
  if (store.logs.privateChannelId) {
    const logChannel = await interaction.guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logContainer = privateLogContainer(
        store,
        '🎫 Novo ticket aberto',
        `**Usuário:** ${interaction.user.tag}\n**Tipo:** ${tipo.nome}\n**Canal:** ${canal}\n` +
        (produtoNomeSugerido ? `**Produto:** ${produtoNomeSugerido}` : '')
      );
      await logChannel.send({ components: [logContainer], flags: [MessageFlags.IsComponentsV2] });
    }
  }

  await interaction.reply({ content: `Ticket de ${tipo.nome} criado: ${canal}`, flags: MessageFlags.Ephemeral });
}

// Usado pelo comando /vendida: coloca o ticket no estagio de escolher produto
async function confirmarVenda(interaction) {
  const store = loadStore(interaction.guildId);
  const registro = store.ticket.open?.[interaction.channel.id];

  if (!registro) {
    return interaction.reply({
      content: 'Este comando/botão só pode ser usado dentro de um ticket.',
      flags: MessageFlags.Ephemeral
    });
  }

  registro.stage = 'select_produto';
  saveStore(interaction.guildId, store);
  await editarEstagio(interaction.channel, store, registro);
  return interaction.reply({ content: '🛒 Escolha o produto na mensagem acima.', flags: MessageFlags.Ephemeral });
}
// welcome -> select_produto -> carrinho -> pagamento -> comprovante -> staff_review -> entregue

function resolverProduto(store, identificador) {
  if (!identificador) return null;
  const porId = store.sales.products.find(p => p.id === identificador);
  if (porId) return porId;
  return store.sales.products.find(p => p.name.toLowerCase() === String(identificador).toLowerCase()) || null;
}

// Monta o payload da mensagem principal conforme o estagio atual
function renderEstagio(store, registro) {
  const stage = registro.stage || 'welcome';
  const container = new ContainerBuilder()
    .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16));

  if (stage === 'welcome') {
    const tipo = TIPOS_TICKET[registro.tipoId] || TIPOS_TICKET.compras;
    let descricaoTipo;
    if (tipo.id === 'suporte') {
      descricaoTipo = 'Descreva sua dúvida ou problema com detalhes que nossa equipe irá te atender.\nSe precisar, envie prints ou imagens aqui mesmo no canal.';
    } else {
      descricaoTipo = 'Clique em **Prosseguir** para escolher seu produto e finalizar a compra.\nForma de pagamento: **Pix**.';
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${tipo.emoji} ${tipo.nome} — ${store.storeName}**\n\n` +
        `Olá <@${registro.userId}>, seja bem-vindo(a)!\n\n${descricaoTipo}`
      )
    );
    const row = new ActionRowBuilder();
    if (tipo.id === 'compras') {
      row.addComponents(new ButtonBuilder().setCustomId('tk:prosseguir').setLabel('Prosseguir').setStyle(ButtonStyle.Success).setEmoji('➡️'));
    }
    row.addComponents(new ButtonBuilder().setCustomId('ticket:fechar').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'));
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(row);
  }

  else if (stage === 'select_produto') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**🛒 Escolha o produto**\n\nSelecione abaixo qual produto deseja comprar:')
    );
    const produtos = store.sales.products.filter(p => p.stock > 0).slice(0, 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId('tk:produto')
      .setPlaceholder('Escolha o produto')
      .addOptions(produtos.map(p => ({
        label: p.name.slice(0, 100),
        value: p.id,
        description: `R$ ${p.price.toFixed(2)} | estoque: ${p.stock}`
      })));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk:cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji('✖️')
      )
    );
  }

  else if (stage === 'carrinho') {
    const produto = store.sales.products.find(p => p.id === registro.cart?.produtoId);
    if (!produto) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('⚠️ Produto indisponível. Use **Prosseguir** para escolher outro.'));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tk:prosseguir').setLabel('Escolher produto').setStyle(ButtonStyle.Primary)
        )
      );
      return { components: [container], flags: [MessageFlags.IsComponentsV2] };
    }

    const qty = registro.cart.quantity;
    const subtotal = Math.round(produto.price * qty * 100) / 100;
    let desconto = 0;
    if (registro.couponCode) {
      const cupom = store.coupons.find(c => c.code === registro.couponCode);
      if (cupom) desconto = Math.round(calcularDesconto(cupom, subtotal) * 100) / 100;
    }
    const total = Math.max(0, Math.round((subtotal - desconto) * 100) / 100);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**🛒 Seu pedido**\n\n` +
        `🎮 **${produto.name}**\n` +
        `💰 R$ ${produto.price.toFixed(2)} x ${qty} = **R$ ${subtotal.toFixed(2)}**\n` +
        (registro.couponCode ? `🎟️ Cupom: \`${registro.couponCode}\` −R$ ${desconto.toFixed(2)}\n` : '') +
        `\n💵 **Total: R$ ${total.toFixed(2)}**`
      )
    );

    // Seletor de quantidade
    const maxQty = Math.min(10, Math.max(1, produto.stock));
    const qtyMenu = new StringSelectMenuBuilder()
      .setCustomId('tk:qty')
      .setPlaceholder('Definir quantidade')
      .addOptions(
        Array.from({ length: maxQty }, (_, i) => i + 1).map(n => ({
          label: `${n} unidade${n > 1 ? 's' : ''}`,
          value: String(n),
          default: n === qty
        }))
      );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(qtyMenu));

    // Seletor de cupom
    const cupomOptions = [{ label: 'Sem cupom', value: 'nenhum', emoji: '🚫' }];
    for (const c of store.coupons.slice(0, 24)) {
      const valido = !c.expiresAt || c.expiresAt > Date.now();
      if (!valido) continue;
      const desc = c.type === 'percent' ? `${c.value}% OFF` : `R$ ${c.value.toFixed(2)} OFF`;
      cupomOptions.push({ label: c.code.slice(0, 100), value: c.code, description: desc, default: registro.couponCode === c.code });
    }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('tk:cupom').setPlaceholder('Cupom de desconto').addOptions(cupomOptions)
    ));

    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk:continuar').setLabel('Continuar para Pagamento').setStyle(ButtonStyle.Success).setEmoji('💳'),
        new ButtonBuilder().setCustomId('tk:cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji('✖️')
      )
    );
  }

  else if (stage === 'pagamento') {
    const produto = store.sales.products.find(p => p.id === registro.cart?.produtoId);
    const qty = registro.cart?.quantity || 1;
    const subtotal = produto ? Math.round(produto.price * qty * 100) / 100 : 0;
    let desconto = 0;
    if (registro.couponCode && produto) {
      const cupom = store.coupons.find(c => c.code === registro.couponCode);
      if (cupom) desconto = Math.round(calcularDesconto(cupom, subtotal) * 100) / 100;
    }
    const total = Math.max(0, Math.round((subtotal - desconto) * 100) / 100);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**💳 Pagamento via Pix**\n\n` +
        `💵 **Total: R$ ${total.toFixed(2)}**\n` +
        (store.pixKey ? `🏦 **Chave Pix:**\n\`${store.pixKey}\`` : '⚠️ **Chave Pix não configurada!** Avise a staff.')
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk:pixcopiar').setLabel('Copiar chave Pix').setStyle(ButtonStyle.Primary).setEmoji('📋'),
        new ButtonBuilder().setCustomId('tk:voltar').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setEmoji('⬅️'),
        new ButtonBuilder().setCustomId('tk:pagfeito').setLabel('Pagamento feito').setStyle(ButtonStyle.Success).setEmoji('✅')
      )
    );
  }

  else if (stage === 'comprovante') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**🧾 Falta só o comprovante!**\n\n` +
        `<@${registro.userId}>, para finalizar:\n\n` +
        `1️⃣ Tire um print do comprovante do Pix\n` +
        `2️⃣ **Responda ESTA mensagem anexando o print** — segure/clique com o botão direito nesta mensagem → *Responder* → anexe a imagem → envie\n\n` +
        `Assim que a imagem chegar, avisamos a staff automaticamente. ⏳`
      )
    );
  }
  else if (stage === 'staff_review') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**🧾 Comprovante recebido**\n\n` +
        `<@${registro.userId}>, seu comprovante foi encaminhado para a staff.\n` +
        `Aguarde a confirmação e a entrega da sua conta. ⏳`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk:confirmar').setLabel('Confirmar Entrega').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('tk:finalizar').setLabel('Finalizar Atendimento').setStyle(ButtonStyle.Danger).setEmoji('🏁')
      )
    );
  }

  else if (stage === 'entregue') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**✅ Entrega confirmada!**\n\n` +
        `<@${registro.userId}>, obrigado pela compra! ❤️\n` +
        `Staff: clique em **Finalizar Atendimento** para encerrar o ticket.`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk:finalizar').setLabel('Finalizar Atendimento').setStyle(ButtonStyle.Danger).setEmoji('🏁')
      )
    );
  }

  return { components: [container], flags: [MessageFlags.IsComponentsV2] };
}

// Edita a mensagem principal do ticket para o estagio atual
async function editarEstagio(channel, store, registro) {
  if (!registro.cartMessageId) return;
  const msg = await channel.messages.fetch(registro.cartMessageId).catch(() => null);
  if (!msg) return;
  await msg.edit(renderEstagio(store, registro)).catch(err => console.error('[ticket] erro ao editar estagio:', err));
}

// Monta o objeto de sessao a partir do carrinho persistido
function montarSessaoDeCarrinho(store, registro, channelId) {
  const produto = store.sales.products.find(p => p.id === registro.cart.produtoId);
  if (!produto || produto.stock < registro.cart.quantity) return null;

  const initialValue = Math.round(produto.price * registro.cart.quantity * 100) / 100;
  let discount = 0;
  if (registro.couponCode) {
    const cupom = store.coupons.find(c => c.code === registro.couponCode);
    if (cupom) discount = Math.round(calcularDesconto(cupom, initialValue) * 100) / 100;
  }
  const finalValue = Math.max(0, Math.round((initialValue - discount) * 100) / 100);

  return {
    userId: registro.userId,
    threadId: channelId,
    produtoId: produto.id,
    produtoName: produto.name,
    quantidade: registro.cart.quantity,
    initialValue,
    discount,
    finalValue,
    couponCode: registro.couponCode,
    usuarioConta: null
  };
}

// Dispatcher dos botoes tk:* da mensagem principal
async function handleTicketButton(interaction) {
  const store = loadStore(interaction.guildId);
  const registro = store.ticket.open?.[interaction.channel.id];
  const acao = interaction.customId.split(':')[1];

  if (!registro) {
    return interaction.reply({ content: '❌ Ticket não encontrado.', flags: MessageFlags.Ephemeral });
  }

  // ---- Acoes do cliente ----
  if (acao === 'prosseguir') {
    if (registro.stage !== 'welcome') return interaction.deferUpdate();
    registro.stage = registro.cart ? 'carrinho' : 'select_produto';
    saveStore(interaction.guildId, store);
    return interaction.update(renderEstagio(store, registro));
  }

  if (acao === 'cancelar') {
    delete store.ticket.open[interaction.channel.id];
    saveStore(interaction.guildId, store);
    await interaction.reply({ content: '✖️ Compra cancelada. Fechando o ticket em 5 segundos...' });
    setTimeout(() => interaction.channel.delete('Ticket cancelado pelo cliente').catch(() => {}), 5000);
    return;
  }

  if (acao === 'continuar') {
    if (registro.stage !== 'carrinho' || !registro.cart) return interaction.deferUpdate();
    const produto = store.sales.products.find(p => p.id === registro.cart.produtoId);
    if (!produto || produto.stock < registro.cart.quantity) {
      return interaction.reply({ content: '❌ Estoque insuficiente para este pedido.', flags: MessageFlags.Ephemeral });
    }
    registro.stage = 'pagamento';
    saveStore(interaction.guildId, store);
    return interaction.update(renderEstagio(store, registro));
  }

  if (acao === 'voltar') {
    registro.stage = 'carrinho';
    saveStore(interaction.guildId, store);
    return interaction.update(renderEstagio(store, registro));
  }

  if (acao === 'pixcopiar') {
    const chave = store.pixKey || 'Chave Pix não configurada';
    return interaction.reply({ content: `📋 **Copie a chave Pix:**\n\`${chave}\``, flags: MessageFlags.Ephemeral });
  }

  if (acao === 'pagfeito') {
    if (registro.stage !== 'pagamento' || !registro.cart) return interaction.deferUpdate();
    const sessao = montarSessaoDeCarrinho(store, registro, interaction.channel.id);
    if (!sessao) return interaction.reply({ content: '❌ Estoque insuficiente para este pedido.', flags: MessageFlags.Ephemeral });

    // Ack imediato: criarPendencia (DM + logs) pode demorar mais que 3s
    await interaction.deferUpdate();
    const pending = await criarPendencia(store, interaction.guild, sessao);
    registro.pendingId = pending.id;
    registro.stage = 'comprovante';
    registro.cart = null;
    registro.couponCode = null;
    saveStore(interaction.guildId, store);
    return interaction.editReply(renderEstagio(store, registro));
  }

  // ---- Acoes da staff ----
  if (acao === 'confirmar') {
    if (!ehStaff(interaction)) {
      return interaction.reply({ content: '🔒 Apenas a staff pode confirmar a entrega.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    const pendingId = registro.pendingId;
    registro.stage = 'entregue';
    registro.pendingId = null;
    saveStore(interaction.guildId, store);
    await pagamentoAprovado(interaction, pendingId);
    await editarEstagio(interaction.channel, store, registro);
    return;
  }

  if (acao === 'finalizar') {
    if (!ehStaff(interaction)) {
      return interaction.reply({ content: '🔒 Apenas a staff pode encerrar o atendimento.', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ content: '🏁 Atendimento finalizado. Fechando o ticket em 5 segundos...' });
    delete store.ticket.open[interaction.channel.id];
    saveStore(interaction.guildId, store);
    setTimeout(() => interaction.channel.delete('Atendimento finalizado pela staff').catch(() => {}), 5000);
    return;
  }

  return interaction.deferUpdate();
}

// Dispatcher dos seletores tk:*
async function handleTicketSelect(interaction) {
  const store = loadStore(interaction.guildId);
  const registro = store.ticket.open?.[interaction.channel.id];
  const acao = interaction.customId.split(':')[1];

  if (!registro) {
    return interaction.reply({ content: '❌ Ticket não encontrado.', flags: MessageFlags.Ephemeral });
  }

  if (acao === 'produto') {
    const produto = store.sales.products.find(p => p.id === interaction.values[0]);
    if (!produto || produto.stock < 1) {
      return interaction.reply({ content: '❌ Produto sem estoque. Escolha outro.', flags: MessageFlags.Ephemeral });
    }
    registro.cart = { produtoId: produto.id, quantity: 1 };
    registro.stage = 'carrinho';
    saveStore(interaction.guildId, store);
    return interaction.update(renderEstagio(store, registro));
  }

  if (acao === 'qty') {
    if (!registro.cart) return interaction.deferUpdate();
    const produto = store.sales.products.find(p => p.id === registro.cart.produtoId);
    const n = parseInt(interaction.values[0], 10);
    registro.cart.quantity = Math.min(produto ? produto.stock : n, Math.max(1, n));
    saveStore(interaction.guildId, store);
    return interaction.update(renderEstagio(store, registro));
  }

  if (acao === 'cupom') {
    const escolha = interaction.values[0];
    if (escolha === 'nenhum') {
      registro.couponCode = null;
    } else {
      const resultado = aplicarCupom(store, escolha);
      if (!resultado.ok) {
        return interaction.reply({ content: `❌ Cupom: ${resultado.error}`, flags: MessageFlags.Ephemeral });
      }
      registro.couponCode = resultado.cupom.code;
    }
    saveStore(interaction.guildId, store);
    return interaction.update(renderEstagio(store, registro));
  }

  return interaction.deferUpdate();
}

// Detecta o comprovante: cliente envia imagem no ticket durante o estagio 'comprovante'
async function ticketMessageHook(message) {
  if (message.author.bot || !message.guildId) return;
  const store = loadStore(message.guildId);
  const registro = store.ticket.open?.[message.channel.id];
  console.log(`[comprovante] msg canal=${message.channel.id} autor=${message.author.id} anexos=${message.attachments.size} embeds=${message.embeds?.length || 0} stickers=${message.stickers?.size || 0} snaps=${message.messageSnapshots?.size || 0} conteudo="${(message.content || "").slice(0, 40)}" stage=${registro?.stage || "sem-ticket"}`);
  if (!registro || registro.stage !== 'comprovante') return;

  // Anexo direto OU dentro de mensagem encaminhada (snapshot)
  let att = message.attachments.first() || null;
  if (!att && message.messageSnapshots?.size > 0) {
    for (const snap of message.messageSnapshots.values()) {
      const snapAtt = snap.attachments?.first?.();
      if (snapAtt) { att = snapAtt; break; }
    }
  }
  // Fallback: imagem dentro de embed (link com preview) ou URL de imagem no texto
  if (!att) {
    const embedComImagem = message.embeds?.find(e => e.image || e.thumbnail);
    if (embedComImagem) {
      const url = embedComImagem.image?.url || embedComImagem.thumbnail?.url;
      if (url) att = { url, name: 'comprovante.png', contentType: 'image/png' };
    }
  }
  if (!att) {
    const urlNoTexto = (message.content || '').match(/https:\/\/\S+\.(?:png|jpe?g|webp|gif)/i);
    if (urlNoTexto) att = { url: urlNoTexto[0], name: 'comprovante.png', contentType: 'image/png' };
  }


  const imageExtensions = /\.(jpg|jpeg|png|gif|webp)$/i;
  const isImage = att.contentType?.startsWith('image/') || imageExtensions.test(att.name || '');
  if (!isImage) return;

  const pending = store.pendings.find(p => p.id === registro.pendingId);
  if (pending) pending.comprovanteUrl = att.url;
  registro.stage = 'staff_review';
  registro.stage = 'staff_review';
  saveStore(message.guildId, store);

  await editarEstagio(message.channel, store, registro);

  // Notifica a staff
  if (store.logs.privateChannelId) {
    const logChannel = await message.guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logContainer = privateLogContainer(
        store,
        '🧾 Comprovante recebido — entrega pendente',
        `**Cliente:** <@${registro.userId}>\n` +
        `**Produto:** ${pending ? pending.productName : '?'}\n` +
        `**Valor:** R$ ${pending ? pending.finalValue.toFixed(2) : '?'}\n` +
        `**Comprovante:** ${att.url}\n` +
        `**Ticket:** <#${message.channel.id}>`
      );
      await logChannel.send({ components: [logContainer], flags: [MessageFlags.IsComponentsV2] }).catch(() => {});
    }
  }
}
async function fecharTicket(interaction) {
  const store = loadStore(interaction.guildId);
  const registro = store.ticket.open?.[interaction.channel.id];
  if (!registro) {
    return interaction.reply({ content: 'Isso só funciona dentro de um ticket.', flags: MessageFlags.Ephemeral });
  }

  // Verifica se quem clicou é staff (cargo configurado ou permissao ManageGuild)
  const isStaff = ehStaff(interaction);

  // Cliente so pode encerrar o proprio ticket dentro da janela de tempo
  if (!isStaff) {
    const janelaMs = (store.ticket.closeWindowMinutes || 10) * 60 * 1000;
    const dentroDaJanela = registro.openedAt && (Date.now() - registro.openedAt) <= janelaMs;
    if (!dentroDaJanela) {
      return interaction.reply({
        content: '🔒 O prazo para encerrar seu próprio ticket expirou. Aguarde um membro da equipe para finalizar o atendimento.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  delete store.ticket.open[interaction.channel.id];
  saveStore(interaction.guildId, store);

  await interaction.reply({ content: 'Fechando ticket em 5 segundos...' });
  setTimeout(() => {
    interaction.channel.delete(`Ticket fechado por ${interaction.user.tag}`).catch(() => {});
  }, 5000);
}

// Encerra o canal de um ticket (usado no fim da venda e no cancelamento).
// Remove do registro e deleta o canal.
async function encerrarCanalTicket(guild, guildId, channelId, motivo) {
  const store = loadStore(guildId);
  if (!store.ticket.open || !store.ticket.open[channelId]) return;
  delete store.ticket.open[channelId];
  saveStore(guildId, store);
  const canal = await guild.channels.fetch(channelId).catch(() => null);
  if (canal) {
    setTimeout(() => canal.delete(motivo).catch(() => {}), 10000);
  }
}

module.exports = {
  abrirTicket,
  confirmarVenda,
  handleTicketButton,
  handleTicketSelect,
  ticketMessageHook,
  fecharTicket,
  ehStaff,
  encerrarCanalTicket,
  ticketPanelSelectRow
};
