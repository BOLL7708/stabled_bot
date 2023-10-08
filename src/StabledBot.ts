import Config, {IConfig} from './Config.js'
import {Client, Events, GatewayIntentBits, TextChannel} from 'discord.js'
import Tasks from './Tasks.js'
import dns from 'node:dns';

export default class StabledBot {
    private _config: IConfig

    async start() {
        dns.setDefaultResultOrder('ipv4first');

        this._config = await Config.get()

        // Create Discord client
        const client: Client = new Client({
            intents: [
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.Guilds
            ]
        })
        client.once(Events.ClientReady, c => {
            console.log(`Ready! Logged in as ${c.user.tag}`)
        })

        // Log in to Discord with your client's token
        if (!this._config?.token) throw new Error('No token found in config.json or config.local.json')
        else client.login(this._config.token).then()

        client.on(Events.MessageCreate, async message => {
            let messageStr = message.content.toLowerCase()
            if (messageStr.includes('bingo')) {
                messageStr = messageStr.replace('bingo', '')
                const images = await Tasks.generateImagesFromMessage(messageStr)
                if (Object.keys(images).length) {
                    console.log(`Generated ${images.length} image(s).`)
                    await Tasks.sendImagesAsReply(images, message, 'Here you go!')
                }
            }
        })

        client.on(Events.InteractionCreate, async interaction => {
            if(!interaction.isButton()) return
            console.log('Interaction created', interaction.customId)
            switch(interaction.customId) {
                case 'redo':
                    // interaction.reply('Redoing...')
                    interaction.deferReply()
                    break
                case 'ok':
                    interaction.deferUpdate()
                    break
            }
        })
    }
}