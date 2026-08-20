// src/utils/v2.js
// Helpers de Components V2 (Container + TextDisplay + Separator + Section).
//
// NOTA: a API do Discord so aceita Button (type 2) e Thumbnail (type 11) como
// acessorio de Section (type 9). Menus dropdown devem ir em ActionRow dentro
// do container, e nao como acessorio de section.

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const V2_FLAGS = [MessageFlags.IsComponentsV2];

// Cria uma Section (type 9): texto à esquerda + acessório (select/botão) à direita.
function v2Section(label, accessory) {
  return new SectionBuilder({
    components: [new TextDisplayBuilder().setContent(label)],
    accessory
  });
}

// Monta o Container no visual de "embed":
// cor de destaque na lateral + título/descrição (markdown) + linha divisória +
// seções (texto com acessório à direita) e linhas de componentes internas.
function v2Container(store, { title, description, sections = [], rows = [] }) {
  const container = new ContainerBuilder()
    .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${title}**\n\n${description}`)
    )
    .addSeparatorComponents(new SeparatorBuilder());

  for (const sec of sections) {
    container.addSectionComponents(v2Section(sec.label, sec.accessory));
  }
  for (const row of rows) {
    container.addActionRowComponents(row);
  }
  return container;
}

// Container de produto com estrutura montável:
// titulo (obrigatorio) + divisorias e blocos de texto na ordem escolhida.
// Sempre termina com a linha do botao "Comprar".
function montarContainerProduto(store, produto, { titulo, info, divAcima, divAbaixo }) {
  const container = new ContainerBuilder()
    .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${titulo}**`));

  if (divAcima) container.addSeparatorComponents(new SeparatorBuilder());

  if (info) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(info));
  }

  if (divAbaixo) container.addSeparatorComponents(new SeparatorBuilder());

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`publico:comprar_produto:${produto.id}`)
        .setLabel('Comprar')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🛒')
    )
  );

  return container;
}

// Atualiza a mensagem V2 (flag obrigatoria, pois embeds/content nao funcionam em V2).
async function updateV2(interaction, container) {
  await interaction.update({ components: [container], flags: V2_FLAGS });
}

module.exports = { V2_FLAGS, v2Section, v2Container, montarContainerProduto, updateV2 };