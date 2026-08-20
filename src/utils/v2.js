// src/utils/v2.js
// Helpers de Components V2 (Container + TextDisplay + Separator + Section).
//
// NOTA: o discord.js 14.27 ainda so valida Button/Thumbnail como acessorio de
// Section, mas a API oficial do Discord aceita select menus (String/User/Role/
// Mentionable/Channel), TextInput e MediaGallery. Aplicamos um patch localizado
// no toJSON do SectionBuilder apenas para liberar isso.

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  MessageFlags
} = require('discord.js');

const V2_FLAGS = [MessageFlags.IsComponentsV2];

// Patch: serializa a Section sem o predicate que limita o accessory.
SectionBuilder.prototype.toJSON = function () {
  return {
    ...this.data,
    components: this.components.map((c) => c.toJSON()),
    accessory: this.accessory ? this.accessory.toJSON() : undefined
  };
};

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

// Atualiza a mensagem V2 (flag obrigatoria, pois embeds/content nao funcionam em V2).
async function updateV2(interaction, container) {
  await interaction.update({ components: [container], flags: V2_FLAGS });
}

module.exports = { V2_FLAGS, v2Section, v2Container, updateV2 };