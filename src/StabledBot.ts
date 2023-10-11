import Config, {IConfig} from './Config.js'
import {ApplicationCommandOptionType, ButtonInteraction, ChannelType, Client, CommandInteraction, Events, GatewayIntentBits, TextChannel} from 'discord.js'
import Tasks from './Tasks.js'
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
                },{
                    name: 'count',
                    description: 'The number of images to generate.',
                    type: ApplicationCommandOptionType.Integer,
                    required: false,
                    choices: [
                        { name: '1', value: 1 },
                        { name: '2', value: 2 },
                        { name: '3', value: 3 },
                        { name: '4', value: 4 },
                        { name: '5', value: 5 },
                        { name: '6', value: 6 }
                    ]
                },{
                    name: 'aspect-ratio',
                    description: 'Aspect ratio of the generated images.',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: 'Square 1:1', value: '1:1' },
                        { name: 'Landscape 2:1', value: '2:1' },
                        { name: 'Landscape 3:2', value: '3:2'},
                        { name: 'Landscape 4:3', value: '4:3' },
                        { name: 'Landscape 16:9', value: '16:9' },
                        { name: 'Landscape 21:9', value: '21:9' },
                        { name: 'Landscape 32:9', value: '32:9' },
                        { name: 'Landscape Golden Ratio', value: '1.618:1' },
                        { name: 'Portrait 1:2', value: '1:2' },
                        { name: 'Portrait 2:3', value: '2:3'},
                        { name: 'Portrait 3:4', value: '3:4' },
                        { name: 'Portrait 9:16', value: '9:16' },
                        { name: 'Portrait 9:32', value: '9:32' },
                        { name: 'Portrait Golden Ratio', value: '1:1.618' },
                    ]
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
                        if (data?.user && data.user == interaction.user.username) {
                            console.log('Delete this:', interaction.message.id)
                            if (!interaction.channel) {
                                const dmChannel = await interaction.user.createDM()
                                const message = await dmChannel.messages.fetch(data.message_id)
                                if (message) await message.delete()
                            } else {
                                await interaction.message.delete()
                            }
                        }
                        interaction.deleteReply()
                        break
                    }
                    case 'REDO': {
                        const data = await this._db.getPrompt(serial)
                        const prompt = data?.prompt ?? 'random garbage'
                        const aspectRatio = data?.aspect_ratio ?? '1:1'
                        const count = data?.count ?? 4
                        await runGen('Here you go again', prompt, aspectRatio, count, interaction, this._db)
                        break
                    }
                }

            } else if (interaction.isCommand()) {
                switch (interaction.commandName) {
                    case this.COMMAND_GEN: {
                        const prompt = interaction.options.get('prompt')?.value?.toString() ?? 'random garbage'
                        const aspectRatio = interaction.options.get('aspect-ratio')?.value?.toString() ?? '1:1'
                        const countValue = interaction.options.get('count')?.value
                        const count = countValue ? Number(countValue) : 4
                        await runGen('Here you go', prompt, aspectRatio, count, interaction, this._db)
                        break

                        // TODO: Launch into a graphical flow before runGen, this should also be reusable by an edit command.
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

        async function runGen(messageStart: string, prompt: string, aspectRatio: string, count: number, interaction: ButtonInteraction | CommandInteraction, db: DB) {
            try {
                await interaction.deferReply()
                console.log(`Queuing up a batch of images for ${interaction.user.username}: ${prompt}`)
                const images = await Tasks.generateImages(prompt, aspectRatio, count)
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