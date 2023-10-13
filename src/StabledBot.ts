import Config, {IConfig} from './Config.js'
import {ApplicationCommandOptionType, ButtonInteraction, ChannelType, Client, CommandInteraction, Events, GatewayIntentBits, ModalSubmitInteraction, TextChannel} from 'discord.js'
import Tasks, {GenerateImagesOptions, PromptUserOptions, SendImagesOptions} from './Tasks.js'
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
                const data = await this._db.getPrompt(serial)
                switch (type) {
                    case Constants.BUTTON_DELETE: {
                        await interaction.deferReply({
                            ephemeral: true
                        })
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
                                content: 'Sorry, only the original creator can delete a post!'
                            })
                        }
                        break
                    }
                    case Constants.BUTTON_REDO: {
                        await Tasks.promptUser(new PromptUserOptions(
                            Constants.PROMPT_REDO,
                            "Random Seed",
                            interaction,
                            serial,
                            data?.prompt ?? '',
                            data?.negative_prompt ?? ''
                        ))
                        break
                    }
                    case Constants.BUTTON_EDIT: {
                        await Tasks.promptUser(new PromptUserOptions(
                            Constants.PROMPT_EDIT,
                            "Reused Seed",
                            interaction,
                            serial,
                            data?.prompt ?? '',
                            data?.negative_prompt ?? ''
                        ))
                        break
                    }
                    case Constants.BUTTON_VARY: {
                        const dataEntries = await this._db.getPrompts(data?.message_id ?? '')
                        if(dataEntries.length) {
                            await Tasks.showButtons(Constants.BUTTON_VARIANT, 'Pick which image to make variations from:', dataEntries, interaction)
                        }
                        break
                    }
                    case Constants.BUTTON_VARIANT: {
                        await runGen(
                            'I tweaked a bit ',
                            data?.prompt ?? '',
                            data?.negative_prompt ?? '',
                            data?.aspect_ratio ?? '1:1',
                            data?.count ?? 4,
                            interaction,
                            this._db,
                            data?.reference,
                            true
                        )
                        break
                    }
                    case Constants.BUTTON_UPRES: {
                        console.log('Show upres buttons!')
                        const dataEntries = await this._db.getPrompts(data?.message_id ?? '')
                        if(dataEntries.length) {
                            await Tasks.showButtons(Constants.BUTTON_UPRESSING, 'Pick which image to upres:', dataEntries, interaction)
                        }
                        break
                    }
                    case Constants.BUTTON_UPRESSING: {
                        console.log('Upressing ordered!')
                        await runGen(
                            'I did it higher res ',
                            data?.prompt ?? '',
                            data?.negative_prompt ?? '',
                            data.aspect_ratio,
                            1,
                            interaction,
                            this._db,
                            data.reference,
                            false,
                            true
                        )
                        break
                    }
                }

            } else if (interaction.isCommand()) {
                switch (interaction.commandName) {
                    case Constants.COMMAND_GEN: {
                        const prompt = interaction.options.get(Constants.OPTION_PROMPT)?.value?.toString() ?? 'random garbage'
                        const promptNegative = interaction.options.get(Constants.OPTION_NEGATIVE_PROMPT)?.value?.toString() ?? ''
                        const aspectRatio = interaction.options.get(Constants.OPTION_ASPECT_RATIO)?.value?.toString() ?? '1:1'
                        const countValue = interaction.options.get(Constants.OPTION_COUNT)?.value
                        const count = countValue ? Number(countValue) : 4
                        await runGen('Here you go', prompt, promptNegative, aspectRatio, count, interaction, this._db)
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
                        const newPromptNegative = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
                        await runGen('Here is the remix', newPrompt, newPromptNegative, data.aspect_ratio, data.count, interaction, this._db, data.reference)
                        break
                    }
                    case Constants.PROMPT_REDO: {
                        const data = await this._db.getPrompt(serial)
                        const newPrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random waste'
                        const newPromptNegative = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
                        await runGen('Here you go again', newPrompt, newPromptNegative, data.aspect_ratio, data.count, interaction, this._db)
                    }
                }
            }
        })

        async function runGen(
            messageStart: string,
            prompt: string,
            negativePrompt: string,
            aspectRatio: string,
            count: number,
            interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction,
            db: DB,
            serialToSeed?: string,
            variations?: boolean,
            hires?: boolean
        ) {
            try {
                await interaction.deferReply()
                const seed = serialToSeed ? serialToSeed.split('-').pop() : undefined

                // Generate
                console.log(`Queuing up a batch of images for [${interaction.user.username}]: +"${prompt}" -"${negativePrompt}"` + (seed ? `, seed: ${seed}` : ''))
                const images = await Tasks.generateImages(new GenerateImagesOptions(
                    prompt,
                    negativePrompt,
                    aspectRatio,
                    count,
                    seed,
                    variations,
                    hires
                ))
                if (Object.keys(images).length) {
                    // Send to Discord
                    console.log(`Generated ${Object.keys(images).length} image(s) for ${interaction.user.username}`)
                    const reply = await Tasks.sendImagesAsReply(new SendImagesOptions(
                        prompt,
                        negativePrompt,
                        aspectRatio,
                        count,
                        images,
                        interaction,
                        `${messageStart} ${interaction.user}!`,
                        variations
                    ))
                    if (reply) {
                        // Store in DB
                        for (const [serial, imageData] of Object.entries(images)) await db.registerPrompt({
                            reference: serial,
                            prompt,
                            negative_prompt: negativePrompt,
                            aspect_ratio: aspectRatio,
                            count,
                            user: interaction.user.username,
                            message_id: reply.id.toString()
                        })
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