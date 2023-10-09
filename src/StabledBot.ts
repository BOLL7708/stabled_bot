import Config, {IConfig} from './Config.js'
import {Client, Events, GatewayIntentBits, TextChannel} from 'discord.js'
import Tasks, {IStringDictionary} from './Tasks.js'
import dns from 'node:dns';

export default class StabledBot {
    private _config: IConfig
    private _prompts: IStringDictionary = {}

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
            let prompt = message.content.toLowerCase()
            if (prompt.includes('bingo')) {
                prompt = prompt.replace('bingo', '')
                const images = await Tasks.generateImagesFromMessage(prompt)
                if (Object.keys(images).length) {
                    for(const [serial, imageData] of Object.entries(images)) this._prompts[serial] = prompt
                    console.log(`Generated ${images.length} image(s).`)
                    await Tasks.sendImagesAsReply(prompt, images, message, 'Here you go!')
                }
            }
        })

        client.on(Events.InteractionCreate, async interaction => {
            if(!interaction.isButton()) return
            interaction.deferUpdate()
            console.log('Interaction created', interaction.customId)
            const prompt = this._prompts[interaction.customId] ?? 'random garbage'
            const images = await Tasks.generateImagesFromMessage(prompt)
            if (Object.keys(images).length) {
                for(const [serial, imageData] of Object.entries(images)) this._prompts[serial] = prompt
                console.log(`Generated ${images.length} image(s).`)
                await Tasks.sendImagesAsReply(prompt, images, interaction.message, 'Here you go again!')
            }
        })
    }
}