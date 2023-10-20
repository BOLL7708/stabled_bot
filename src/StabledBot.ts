import Config, {IConfig} from './Config.js'
import {ApplicationCommandOptionType, ButtonInteraction, ChannelType, Client, CommandInteraction, DMChannel, Events, GatewayIntentBits, Message, ModalSubmitInteraction, TextChannel} from 'discord.js'
import Tasks, {MessageDerivedData, GenerateImagesOptions, PromptUserOptions, SendImagesOptions, MessageReference} from './Tasks.js'
import dns from 'node:dns';
import Constants from './Constants.js'
import {CronJob} from 'cron'
import Utils, {Color} from './Utils.js'

export default class StabledBot {
    private _config: IConfig
    private _dataCache = new Map<number, MessageDerivedData>()
    private _interactionIndex = 0

    private getNextInteractionIndex(): number {
        return ++this._interactionIndex
    }

    private getCachedData(index: number | string): MessageDerivedData | undefined {
        const data = this._dataCache.get(Number(index))
        if (data) this._dataCache.delete(Number(index))
        return data
    }

    async start() {
        dns.setDefaultResultOrder('ipv4first');

        // Update bot status
        const loadProgressJob = new CronJob(
            '*/5 * * * * *',
            async () => {
                await Tasks.updateProgressStatus(client)
            },
            null,
            false
        )

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
        client.once(Events.ClientReady, async (c) => {
            Utils.log('Ready, logged in as', c.user.tag, c.user.username)
            loadProgressJob.start()
            try {
                await c.user.setUsername('Stabled')
            } catch (e) {
                console.error('Failed to update username:', e.message)
            }
        })

        // Log in to Discord with your client's token
        if (!this._config?.token) throw new Error('No token found in config.json or config.local.json')
        else client.login(this._config.token).then()

        client.on(Events.MessageCreate, async message => {
        })

        client.on(Events.InteractionCreate, async interaction => {
            if (interaction.isButton()) {
                Utils.log('Button triggered', interaction.customId, interaction.user.username, Color.Reset, Color.FgCyan)
                const [type, payload] = interaction.customId.split('#')
                const data = await Tasks.getDataFromMessage(interaction.message)
                switch (type.toLowerCase()) {
                    case Constants.BUTTON_DELETE: {
                        const messageResult = await Tasks.getMessageForInteraction(interaction)
                        if (messageResult) {
                            if (
                                messageResult.channel instanceof DMChannel // DMs are always deletable
                                || data.user == interaction.user.username // Limit to creator in public channels
                            ) {
                                await messageResult.message.delete()
                                await interaction.deferUpdate()
                            } else {
                                await interaction.reply({
                                    ephemeral: true,
                                    content: 'Sorry, only the original creator can delete a post!'
                                })
                            }
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
                        await Tasks.showButtons(Constants.BUTTON_VARIANT, 'Pick which image to make variations for:', nextIndex, data.seeds.length, interaction)
                        break
                    }
                    case Constants.BUTTON_VARIANT: {
                        const [cacheIndex, buttonIndex] = payload.split(':')
                        const cachedData = this._dataCache.get(Number(cacheIndex))
                        if (cachedData) {
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
                            await interaction.reply({
                                ephemeral: true,
                                content: 'The menu has expired, dismiss it and relaunch.'
                            })
                        }
                        break
                    }
                    case Constants.BUTTON_UPSCALE: {
                        const nextIndex = this.getNextInteractionIndex()
                        this._dataCache.set(nextIndex, data)
                        await Tasks.showButtons(Constants.BUTTON_UPSCALING, 'Pick which image to up-scale:', nextIndex, data.seeds.length, interaction)
                        break
                    }
                    case Constants.BUTTON_UPSCALING: {
                        const [cacheIndex, buttonIndex] = payload.split(':')
                        const cachedData = this._dataCache.get(Number(cacheIndex))
                        if (cachedData) {
                            const reference = await StabledBot.replyQueuedAndGetReference(interaction)
                            try {
                                const images = await Tasks.getAttachmentAndUpscale(client, reference, cachedData.messageId, buttonIndex)
                                const user = await reference.getUser(client)
                                if (Object.keys(images).length) {
                                    const options = new SendImagesOptions(
                                        '', '', '', 1,
                                        cachedData.spoiler, images, reference,
                                        `Here is the up-scaled image ${user}!`,
                                        false, true
                                    )
                                    await Tasks.sendImagesAsReply(client, options)
                                } else {
                                    await StabledBot.nodeError(client, reference)
                                }
                            } catch (e) {
                                const message = await reference.getMessage(client)
                                await message?.delete()
                                console.error(e)
                            }
                        } else {
                            await interaction.reply({
                                ephemeral: true,
                                content: 'The menu has expired, dismiss it and relaunch.'
                            })
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
                Utils.log('Modal result received', interaction.customId, interaction.user.username, Color.Reset, Color.FgCyan)
                const [type, index] = interaction.customId.split('#')
                switch (type) {
                    case Constants.PROMPT_EDIT: {
                        const data = this.getCachedData(index)
                        if (data) {
                            const newPrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random dirt'
                            const newPromptNegative = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
                            await runGen('Here is the remix', newPrompt, newPromptNegative, data.aspectRatio, data.count, data.spoiler, interaction, data.seeds.shift())
                        } else {
                            try {
                                interaction.editReply({content: 'Failed to get cached data :('})
                            } catch (e) {
                                console.error(e)
                            }
                        }
                        break
                    }
                    case Constants.PROMPT_REDO: {
                        const data = this.getCachedData(index)
                        if (data) {
                            const newPrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random waste'
                            const newPromptNegative = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
                            await runGen('Here you go again', newPrompt, newPromptNegative, data.aspectRatio, data.count, false, interaction)
                        } else {
                            try {
                                interaction.editReply({content: 'Failed to get cached data :('})
                            } catch (e) {
                                console.error(e)
                            }
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
                const reference = await StabledBot.replyQueuedAndGetReference(interaction)

                // Generate
                Utils.log('Adding to queue', `${count} image(s)`, reference.getConsoleLabel(), Color.FgYellow)
                const images = await Tasks.generateImages(new GenerateImagesOptions(
                    reference,
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
                    Utils.log('Finished generating', `${Object.keys(images).length} image(s)`, reference.getConsoleLabel(), Color.FgGreen)
                    const user = await reference.getUser(client)
                    const reply = await Tasks.sendImagesAsReply(client, new SendImagesOptions(
                        prompt,
                        negativePrompt,
                        aspectRatio,
                        count,
                        spoiler,
                        images,
                        reference,
                        `${messageStart} ${user}!`,
                        variations,
                        hires
                    ))
                } else {
                    await StabledBot.nodeError(client, reference)
                }
            } catch (e) {
                console.error(e)
            }
        }
    }

    private static async nodeError(client: Client, reference: MessageReference) {
        const message = await reference.getMessage(client)
        const user = await reference.getUser(client)
        try {
            await message?.edit({
                content: `Sorry ${user} but the node appears to be offline or the request timed out :(`
            })
        } catch (e) {
            console.error(e)
        }
    }

    private static async replyQueuedAndGetReference(interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction): Promise<MessageReference> {
        await interaction.reply({
            content: `Queued...`
        })

        let replyMessage: Message | undefined
        try {
            replyMessage = await interaction.fetchReply()
        } catch (e) {
            console.error(e)
        }
        return new MessageReference(
            interaction?.user?.id,
            interaction?.channelId,
            interaction?.guildId,
            replyMessage?.id ?? '',
            interaction?.user?.username,
            interaction?.channel?.name,
            interaction?.guild?.name
        )
    }
}