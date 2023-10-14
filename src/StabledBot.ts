import Config, {IConfig} from './Config.js'
import {ApplicationCommandOptionType, ButtonInteraction, ChannelType, Client, CommandInteraction, Events, GatewayIntentBits, ModalSubmitInteraction, TextChannel} from 'discord.js'
import Tasks, {MessageDerivedData, GenerateImagesOptions, PromptUserOptions, SendImagesOptions} from './Tasks.js'
import dns from 'node:dns';
import Constants from './Constants.js'

export default class StabledBot {
    private _config: IConfig
    private _dataCache = new Map<number, MessageDerivedData>()
    private _interactionIndex = 0

    private getNextInteractionIndex(): number {
        return ++this._interactionIndex
    }
    private getCachedData(index: number|string): MessageDerivedData|undefined {
        const data = this._dataCache.get(Number(index))
        if(data) this._dataCache.delete(Number(index))
        return data
    }

    async start() {
        dns.setDefaultResultOrder('ipv4first');

        this._config = await Config.get()
        await Tasks.registerCommands()

        // Create Discord client
        const client: Client = new Client({
            intents: [
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.Guilds,
            ]
        })
        client.once(Events.ClientReady, async(c) => {
            console.log(`Ready! Logged in as ${c.user.tag}`)
        })

        // Log in to Discord with your client's token
        if (!this._config?.token) throw new Error('No token found in config.json or config.local.json')
        else client.login(this._config.token).then()

        client.on(Events.MessageCreate, async message => {})

        client.on(Events.InteractionCreate, async interaction => {
            if (interaction.isButton()) {
                console.log('Button clicked:', interaction.customId, 'by:', interaction.user.username)
                const [type, payload] = interaction.customId.split('#')
                const data = await Tasks.getDataFromMessage(interaction.message)
                switch (type.toLowerCase()) {
                    case Constants.BUTTON_DELETE: {
                        if(!interaction.channel || !interaction.guild) {
                            // It's not a channel or channel is not in a guild, so it's in a DM, delete without checking user.
                            const dmChannel = await interaction.user.createDM()
                            const message = await dmChannel.messages.fetch(interaction.message.id)
                            if (message) await message.delete()
                            await interaction.deferUpdate()
                        } else if (data?.user && data.user == interaction.user.username) {
                            // Channel message, delete if it's the same user that created it.
                            await interaction.message.delete()
                            await interaction.deferUpdate()
                        } else {
                            await interaction.reply({
                                ephemeral: true,
                                content: 'Sorry, only the original creator can delete a post!'
                            })
                        }
                        break
                    }
                    case Constants.BUTTON_REDO: {
                        const nextIndex = this.getNextInteractionIndex()
                        this._dataCache.set(nextIndex, data)
                        await Tasks.promptUser(new PromptUserOptions(
                            Constants.PROMPT_REDO,
                            "Random Seed",
                            interaction,
                            nextIndex.toString(),
                            data.prompt,
                            data.negativePrompt
                        ))
                        break
                    }
                    case Constants.BUTTON_EDIT: {
                        const nextIndex = this.getNextInteractionIndex()
                        this._dataCache.set(nextIndex, data)
                        await Tasks.promptUser(new PromptUserOptions(
                            Constants.PROMPT_EDIT,
                            "Reused Seed",
                            interaction,
                            nextIndex.toString(),
                            data.prompt,
                            data.negativePrompt
                        ))
                        break
                    }
                    case Constants.BUTTON_VARY: {
                        const nextIndex = this.getNextInteractionIndex()
                        this._dataCache.set(nextIndex, data)
                        await Tasks.showButtons(Constants.BUTTON_VARIANT, 'Pick which image to make variations from:', nextIndex, data.seeds.length, interaction)
                        break
                    }
                    case Constants.BUTTON_VARIANT: {
                        const [cacheIndex, buttonIndex] = payload.split(':')
                        const cachedData = this._dataCache.get(Number(cacheIndex))
                        if(cachedData) {
                            await runGen(
                                'Here are the variations ',
                                cachedData.prompt,
                                cachedData.negativePrompt,
                                cachedData.aspectRatio,
                                4,
                                cachedData.spoiler,
                                interaction,
                                cachedData.seeds[buttonIndex],
                                true
                            )
                        } else {
                            interaction.editReply({ content: 'Failed to get cached data :(' })
                        }
                        break
                    }
                    case Constants.BUTTON_UPRES: {
                        const nextIndex = this.getNextInteractionIndex()
                        this._dataCache.set(nextIndex, data)
                        await Tasks.showButtons(Constants.BUTTON_UPRESSING, 'Pick which image to upres:', nextIndex, data.seeds.length, interaction)
                        break
                    }
                    case Constants.BUTTON_UPRESSING: {
                        const [cacheIndex, buttonIndex] = payload.split(':')
                        const cachedData = this._dataCache.get(Number(cacheIndex))
                        if(cachedData) {
                            await runGen(
                                'I did it higher res ',
                                data.prompt,
                                data.negativePrompt,
                                data.aspectRatio,
                                1,
                                data.spoiler,
                                interaction,
                                data.seeds[buttonIndex],
                                false,
                                true
                            )
                        } else {
                            interaction.editReply({ content: 'Failed to get cached data :(' })
                        }
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
                        const spoiler = !!interaction.options.get(Constants.OPTION_SPOILER)?.value
                        await runGen('Here you go', prompt, promptNegative, aspectRatio, count, spoiler, interaction)
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
                const [type, index] = interaction.customId.split('#')
                switch (type) {
                    case Constants.PROMPT_EDIT: {
                        const data = this.getCachedData(index)
                        if(data) {
                            const newPrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random dirt'
                            const newPromptNegative = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
                            await runGen('Here is the remix', newPrompt, newPromptNegative, data.aspectRatio, data.count, data.spoiler, interaction, data.seeds.shift())
                        } else {
                            interaction.editReply({ content: 'Failed to get cached data :(' })
                        }
                        break
                    }
                    case Constants.PROMPT_REDO: {
                        const data = this.getCachedData(index)
                        if(data) {
                            const newPrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random waste'
                            const newPromptNegative = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
                            await runGen('Here you go again', newPrompt, newPromptNegative, data.aspectRatio, data.count, false, interaction)
                        } else {
                            interaction.editReply({ content: 'Failed to get cached data :(' })
                        }
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
            spoiler: boolean,
            interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction,
            seed?: string,
            variations?: boolean,
            hires?: boolean
        ) {
            try {
                await interaction.deferReply()

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
                        spoiler,
                        images,
                        interaction,
                        `${messageStart} ${interaction.user}!`,
                        variations,
                        hires
                    ))
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