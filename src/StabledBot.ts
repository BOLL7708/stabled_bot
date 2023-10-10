import Config, {IConfig} from './Config.js'
import {Client, Events, GatewayIntentBits, TextChannel, ChannelType, CommandInteraction, ApplicationCommandOptionType, ButtonInteraction, Message} from 'discord.js'
import Tasks, {IStringDictionary} from './Tasks.js'
import dns from 'node:dns';
import DB from './DB.js'

export default class StabledBot {
    private _config: IConfig
    private _db: DB
    private readonly COMMAND_GEN = 'gen'
    private readonly COMMAND_NSFW = 'nsfw'

    async start() {
        dns.setDefaultResultOrder('ipv4first');

        this._config = await Config.get()
        this._db = new DB(this._config)

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
            c.application.commands.create({
                name: this.COMMAND_GEN,
                description: 'Generate a batch of images from a prompt.',
                options: [{
                    name: 'prompt',
                    description: 'The prompt to generate images from.',
                    type: ApplicationCommandOptionType.String,
                    required: true
                }]
            })
            // c.application.commands.create({
            //     name: this.COMMAND_NSFW,
            //     description: 'Spawn a private thread for you and me to generate NSFW content.',
            //     nsfw: true,
            //     options: [{
            //         name: 'name',
            //         description: 'The name of the thread.',
            //         type: ApplicationCommandOptionType.String,
            //         required: false
            //     }]
            // })
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
                    case 'DELETE': {
                        interaction.deferReply()
                        const data = await this._db.getPrompt(serial)
                        if(data?.user && data.user == interaction.user.username) {
                            console.log('Delete this:', interaction.message.id)
                            if(!interaction.channel) {
                                const dmChannel = await interaction.user.createDM()
                                const message = await dmChannel.messages.fetch(data.message_id)
                                if(message) await message.delete()
                            } else {
                                await interaction.message.delete()
                            }
                        }
                        interaction.deleteReply()
                        break
                    }
                    case 'REDO': {
                        const prompt = (await this._db.getPrompt(serial))?.prompt ?? 'random garbage'
                        await runGen('Here you go again', prompt, interaction, this._db)
                        break
                    }
                }

            } else if (interaction.isCommand()) {
                switch (interaction.commandName) {
                    case this.COMMAND_GEN: {
                        const prompt = interaction.options.get('prompt')?.value?.toString() ?? 'random garbage'
                        await runGen('Here you go', prompt, interaction, this._db)
                        break
                    }
                    case 'storage_for_reuse': {
                        interaction.deferReply({
                            ephemeral: true
                        })
                        const channel = interaction.channel as TextChannel
                        const parent = interaction.channel.parent as TextChannel
                        if (channel?.isTextBased || parent?.isTextBased) {
                            const name = interaction.options.get('name')?.value?.toString() ?? 'Private NSFW'
                            const threads = parent.threads ?? channel.threads
                            const thread = await threads.create({
                                name,
                                autoArchiveDuration: 60,
                                type: ChannelType.PrivateThread,
                                invitable: true,
                                reason: 'Automatic thread for stabled message.'
                            })
                            thread.send({
                                content: `Welcome ${interaction.user}, this will be our naughty little thread!`
                            })
                        } else {
                            await interaction.editReply({
                                content: `Sorry ${interaction.user} but I can't create a thread here :(`
                            })
                        }
                        break
                    }
                    default: {
                        interaction.reply({
                            content: `Sorry ${interaction.user} but this command has been retired.`
                        })
                    }
                }
            }
        })

        async function runGen(messageStart: string, prompt: string, interaction: ButtonInteraction | CommandInteraction, db: DB) {
            try {
                await interaction.deferReply()
                console.log(`Queuing up a batch of images for ${interaction.user.username}: ${prompt}`)
                const images = await Tasks.generateImagesFromMessage(prompt)
                if (Object.keys(images).length) {
                    console.log(`Generated ${Object.keys(images).length} image(s) for ${interaction.user.username}`)
                    const reply = await Tasks.sendImagesAsReply(prompt, images, interaction, `${messageStart} ${interaction.user}!`)
                    if (reply) {
                        for (const [serial, imageData] of Object.entries(images)) await db.registerPrompt(
                            serial,
                            prompt,
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