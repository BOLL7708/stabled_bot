import Config, {IConfig} from './Config.js'
import {ApplicationCommandOptionType, ButtonInteraction, ChannelType, Client, CommandInteraction, Events, GatewayIntentBits, ModalSubmitInteraction, TextChannel} from 'discord.js'
import Tasks from './Tasks.js'
import dns from 'node:dns';
import DB from './DB.js'
import Constants from './Constants.js'

export default class StabledBot {
    private _config: IConfig
    private _db: DB

    async start() {
        dns.setDefaultResultOrder('ipv4first');

        this._config = await Config.get()
        this._db = new DB(this._config)
        await Tasks.registerCommands(this._config)

        // Create Discord client
        const client: Client = new Client({
            intents: [
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.Guilds,
            ]
        })
        client.once(Events.ClientReady, c => {
            console.log(`Ready! Logged in as ${c.user.tag}`)
        })

        // Log in to Discord with your client's token
        if (!this._config?.token) throw new Error('No token found in config.json or config.local.json')
        else client.login(this._config.token).then()

        client.on(Events.MessageCreate, async message => {
            // console.log(message.content)
            return // TODO: Disabled for now
        })

        client.on(Events.InteractionCreate, async interaction => {
            if (interaction.isButton()) {
                console.log('Button clicked:', interaction.customId, ', by:', interaction.user.username)
                const [type, serial] = interaction.customId.split('#')
                switch (type) {
                    case Constants.BUTTON_DELETE: {
                        await interaction.deferReply({
                            ephemeral: true
                        })
                        const data = await this._db.getPrompt(serial)
                        if (data?.user && data.user == interaction.user.username) {
                            console.log('Delete this:', interaction.message.id)
                            if (!interaction.channel) {
                                // It's not a channel, so it's in a DM
                                const dmChannel = await interaction.user.createDM()
                                const message = await dmChannel.messages.fetch(data.message_id)
                                if (message) await message.delete()
                            } else {
                                // Channel message, just delete
                                await interaction.message.delete()
                            }
                            await interaction.editReply({
                                content: 'Post was deleted successfully!'
                            })
                        } else {
                            await interaction.editReply({
                                content: 'Only the original creator can delete a post!'
                            })
                        }
                        break
                    }
                    case Constants.BUTTON_REDO: {
                        const data = await this._db.getPrompt(serial)
                        await Tasks.promptUser(Constants.PROMPT_REDO, interaction, serial, data?.prompt ?? '')
                        break
                    }
                    case Constants.BUTTON_EDIT: {
                        const data = await this._db.getPrompt(serial)
                        await Tasks.promptUser(Constants.PROMPT_EDIT, interaction, serial, data?.prompt ?? '')
                    }
                }

            } else if (interaction.isCommand()) {
                switch (interaction.commandName) {
                    case Constants.COMMAND_GEN: {
                        const prompt = interaction.options.get('prompt')?.value?.toString() ?? 'random garbage'
                        const aspectRatio = interaction.options.get('aspect-ratio')?.value?.toString() ?? '1:1'
                        const countValue = interaction.options.get('count')?.value
                        const count = countValue ? Number(countValue) : 4
                        await runGen('Here you go', prompt, aspectRatio, count, interaction, this._db)
                        break
                    }
                    default: {
                        interaction.reply({
                            content: `Sorry ${interaction.user} but this command has been retired.`
                        })
                    }
                }
            } else if (interaction.isModalSubmit()) {
                console.log('Modal submitted:', interaction.customId, ', by:', interaction.user.username)
                const [type, serial] = interaction.customId.split('#')
                switch (type) {
                    case Constants.PROMPT_EDIT: {
                        const data = await this._db.getPrompt(serial)
                        const newPrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random dirt'
                        await runGen('Here is the remix', newPrompt, data.aspect_ratio, data.count, interaction, this._db, data.reference)
                        break
                    }
                    case Constants.PROMPT_REDO: {
                        const data = await this._db.getPrompt(serial)
                        const newPrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random waste'
                        await runGen('Here you go again', newPrompt, data.aspect_ratio, data.count, interaction, this._db)
                    }
                }
            }
        })

        async function runGen(
            messageStart: string,
            prompt: string,
            aspectRatio: string,
            count: number,
            interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction,
            db: DB,
            serialToSeed?: string
        ) {
            try {
                await interaction.deferReply()
                const seed = serialToSeed ? serialToSeed.split('-').pop() : undefined
                console.log(`Queuing up a batch of images for [${interaction.user.username}]: "${prompt}"` + (seed ? `, seed: ${seed}` : ''))
                const images = await Tasks.generateImages(prompt, aspectRatio, count, seed)
                if (Object.keys(images).length) {
                    console.log(`Generated ${Object.keys(images).length} image(s) for ${interaction.user.username}`)
                    const reply = await Tasks.sendImagesAsReply(prompt, aspectRatio, count, images, interaction, `${messageStart} ${interaction.user}!`)
                    if (reply) {
                        for (const [serial, imageData] of Object.entries(images)) await db.registerPrompt(
                            serial,
                            prompt,
                            aspectRatio,
                            count,
                            interaction.user.username,
                            reply.id.toString()
                        )
                    }
                } else {
                    await interaction.editReply({
                        content: `Sorry ${interaction.user} but I timed out :(`
                    })
                }
            } catch (e) {
                console.error(e)
            }
        }
    }
}