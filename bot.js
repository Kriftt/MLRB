require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  Partials,
  MessageFlags
} = require('discord.js');
const http = require('http');  // Add the http module for listening on a port

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const teams = ["Vikings", "Bears", "Aces", "Tigers", "Spartans", "Mariners"];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// Register slash command
const commands = [
  new SlashCommandBuilder()
    .setName('sign')
    .setDescription('Send a team offer to a player.')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The player to sign')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('team')
        .setDescription('The team to offer')
        .setRequired(true)
        .addChoices(...teams.map(t => ({ name: t, value: t })))),
];

const commandData = commands.map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Registering /sign command...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commandData
    });
    console.log('/sign command registered.');
  } catch (err) {
    console.error('Command registration error:', err);
  }
})();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Add an HTTP server that listens on a port (required for Render)
const port = process.env.PORT || 3000;  // Use the port provided by Render or fallback to 3000
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
}).listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'sign') {
    const player = interaction.options.getUser('player');
    const teamName = interaction.options.getString('team');
    const guild = interaction.guild;

    const teamRole = guild.roles.cache.find(role => role.name === teamName);
    if (!teamRole) {
      return interaction.reply({ content: '❌ Team role not found!', flags: MessageFlags.Ephemeral });
    }

    await guild.members.fetch();
    const teamCount = guild.members.cache.filter(m => m.roles.cache.has(teamRole.id)).size;

    const expirationTime = Date.now() + 4 * 60 * 60 * 1000;

    const offerEmbed = new EmbedBuilder()
      .setTitle(`${teamName} | Offer Received`)
      .setDescription(`You have received an offer to join **${teamName}**.\nDo you accept?`)
      .addFields(
        { name: '⌛ Expires', value: new Date(expirationTime).toLocaleString(), inline: true },
        { name: '🔋 Roster', value: `${teamCount}/20`, inline: true },
        { name: '🧢 Sent By', value: interaction.user.toString(), inline: true }
      )
      .setColor(0xFFD700)
      .setFooter({ text: `MLRB Bot • ${new Date().toLocaleString()}` });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('accept').setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('decline').setLabel('Decline').setStyle(ButtonStyle.Danger)
    );

    const dmChannel = await player.createDM().catch(() => null);
    if (!dmChannel) {
      return interaction.reply({ content: `Couldn't DM ${player.tag}. They may have DMs disabled.`, flags: MessageFlags.Ephemeral });
    }

    await dmChannel.send({ embeds: [offerEmbed], components: [buttons] });
    await interaction.reply({ content: `✅ Offer sent to ${player.tag}.`, flags: MessageFlags.Ephemeral });

    const collector = dmChannel.createMessageComponentCollector({
      filter: i => i.user.id === player.id,
      time: expirationTime - Date.now()
    });

    collector.on('collect', async i => {
      if (i.customId === 'accept') {
        try {
          const member = await guild.members.fetch(player.id);
          await member.roles.add(teamRole);

          const newCount = guild.members.cache.filter(m => m.roles.cache.has(teamRole.id)).size;

          const signedEmbed = new EmbedBuilder()
            .setTitle('MLRB | Player Signing')
            .setDescription(`**${player}** has accepted an offer from **${teamName}**.\n\n📋 **Roster:** ${newCount}/20\n👤 **Signed By:** ${interaction.user}`)
            .setColor(0xFFD700)
            .setFooter({ text: `MLRB Bot • ${new Date().toLocaleString()}` });

          const channel = interaction.channel;
          await channel.send({ embeds: [signedEmbed] });
          await dmChannel.send(`✅ You have successfully joined the **${teamName}**!`);
        } catch (err) {
          console.error("Error adding role:", err);
          dmChannel.send('Something went wrong adding you to the team.');
        }
      } else if (i.customId === 'decline') {
        await dmChannel.send('❌ You declined the offer.');
      }

      collector.stop();
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        dmChannel.send('⏰ The offer expired.');
      }
    });
  }
});

client.login(TOKEN);
