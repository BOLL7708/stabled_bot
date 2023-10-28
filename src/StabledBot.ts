import Config, {IConfig} from './Config.js'
import {ApplicationCommandOptionType, AttachmentBuilder, ButtonInteraction, ChannelType, Client, CommandInteraction, DMChannel, EmbedBuilder, Events, GatewayIntentBits, Message, ModalSubmitInteraction, Partials} from 'discord.js'
import Tasks, {MessageDerivedData} from './Tasks.js'
import dns from 'node:dns';
import Constants from './Constants.js'
import {CronJob} from 'cron'
import Utils, {Color} from './Utils.js'
import DiscordCom, {ESource, MessageReference, PromptUserOptions} from './DiscordCom.js'
import StabledAPI, {ImageGenerationOptions} from './StabledAPI.js'
import DiscordUtils, {IAttachment} from './DiscordUtils.js'
import fs from 'fs/promises'
import DB from './DB.js'

export default class StabledBot {
    private _config: IConfig
    private _help: string
    private _dataCache = new Map<number, MessageDerivedData>()
    private _interactionIndex = 0
    private _spamTheadStates = new Map<string, boolean>() // Use methods to set this so it also updates the database.
    private _db: DB

    private getNextInteractionIndex(): number {
        return ++this._interactionIndex
    }

    private setCachedData(index: number | string, data: MessageDerivedData) {
        this._dataCache.set(Number(index), data)
    }

    private getCachedData(index: number | string, deleteCache: boolean = true): MessageDerivedData | undefined {
        const data = this._dataCache.get(Number(index))
        if (data && deleteCache) {
            this._dataCache.delete(Number(index))
        }
        return data
    }

    async start() {
        dns.setDefaultResultOrder('ipv4first');
        this._db = new DB()

        // Update bot status
        const loadProgressJob = new CronJob(
            '*/5 * * * * *',
            async () => {
                try {
                    await Tasks.updateProgressStatus(client)
                } catch (e) {
                    console.error('Progress failed to update:', e.message)
                }
            },
            null,
            false
        )

        await DiscordCom.registerCommands()
        this._config = await Config.get()

        // Create Discord client
        const client: Client = new Client({
            intents: [
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.Guilds
            ],
            partials: [
                Partials.Channel // Enables loading of DM channels on login, otherwise it is required that a command is used in one for it to exist and emit messages.
            ]
        })
        client.once(Events.ClientReady, async (c) => {
            Utils.log('Ready, logged in as', c.user.tag, c.user.username)
            loadProgressJob.start()
            try {
                if (client.user.username != this._config.botUserName) {
                    await c.user.setUsername(this._config.botUserName)
                }
            } catch (e) {
                console.error('Failed to update username:', e.message)
            }
        })

        // Log in to Discord with your client's token
        if (!this._config?.token) throw new Error('No token found in config.json or config.local.json')
        else client.login(this._config.token).then()

        client.on(Events.MessageCreate, async message => {
            const spamEnabled = await this.getSpamState(message.channelId)
            if (message.author.bot) return // Skip generating from bots
            if (!message.content.trim().length) return // Skip empty messages, like ones with just an image

            const reTags = /<@!?(\d*?)>/gm
            const allTags = [...message.content.matchAll(reTags)].map(match => match[1])
            const botTags = allTags.filter(group => {
                return group == client.user.id
            }) ?? []

            if (spamEnabled && allTags.length == 0) {
                await gen(message.content, 'Spam served', false)
            } else if (botTags.length > 0) {
                const prompt = message.content.replaceAll(reTags, '')
                await gen(prompt, 'A quickie', true)
            }

            async function gen(prompt: string, response: string, fromMention: boolean) {
                const genOptions = new ImageGenerationOptions()
                genOptions.prompt = prompt
                genOptions.count = 1
                await runGen(genOptions, response, false, message, undefined, fromMention)
            }
        })

        client.on(Events.InteractionCreate, async interaction => {
            if (interaction.isButton()) {
                // region Buttons
                Utils.log('Button triggered', interaction.customId, interaction.user.username, Color.Reset, Color.FgCyan)
                const [type, payload] = interaction.customId.split('#')
                const data = await Tasks.getDataForMessage(interaction.message)
                switch (type.toLowerCase()) {
                    case Constants.BUTTON_DELETE: {
                        const messageResult = await DiscordUtils.getMessageFromInteraction(interaction)
                        if (messageResult) {
                            if (
                                messageResult.channel instanceof DMChannel // DMs are always deletable
                                || data.userId == interaction.user.id // Limit to creator in public channels
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
                        this.setCachedData(nextIndex, data)
                        await DiscordCom.promptUser(new PromptUserOptions(
                            Constants.PROMPT_REDO,
                            "Random Seed",
                            interaction,
                            nextIndex.toString(),
                            data
                        ))
                        break
                    }
                    case Constants.BUTTON_EDIT: {
                        const nextIndex = this.getNextInteractionIndex()
                        this.setCachedData(nextIndex, data)
                        await DiscordCom.promptUser(new PromptUserOptions(
                            Constants.PROMPT_EDIT,
                            "Recycle Seed",
                            interaction,
                            nextIndex.toString(),
                            data
                        ))
                        break
                    }
                    case Constants.BUTTON_VARY: {
                        if (data.genOptions.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this.setCachedData(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_VARY_CHOICE, 'Pick which image to make variations for:', nextIndex, data.genOptions.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_VARY_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            const genOptions = ImageGenerationOptions.newFrom(useData.genOptions)
                            genOptions.count = 4
                            genOptions.predefinedSeed = useData.seeds[buttonData.buttonIndex]
                            genOptions.variation = true
                            await runGen(genOptions, 'Here are the variations', useData.spoiler, undefined, interaction)
                        } else {
                            await StabledBot.replyDataError(interaction)
                        }
                        break
                    }
                    case Constants.BUTTON_UPSCALE: {
                        if (data.genOptions.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this.setCachedData(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_UPSCALE_CHOICE, 'Pick which image to up-scale:', nextIndex, data.genOptions.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_UPSCALE_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            const reference = await DiscordCom.replyQueuedAndGetReference(undefined, interaction)
                            reference.source = ESource.Upscale
                            try {
                                const genOptions = new ImageGenerationOptions()
                                genOptions.count = 1
                                genOptions.hires = true
                                Tasks.updateQueues()
                                const images = await Tasks.getAttachmentAndUpscale(client, reference, genOptions, useData.messageId, buttonData.buttonIndex)
                                Tasks.updateQueues()
                                const user = await reference.getUser(client)
                                if (Object.keys(images).length) {
                                    await DiscordCom.addImagesToResponse(client, reference, genOptions, images, `Here is the up-scaled image ${user}!`, useData.spoiler)
                                } else {
                                    await StabledBot.nodeError(client, reference)
                                }
                            } catch (e) {
                                const message = await reference.getMessage(client)
                                await message?.delete()
                                console.error(e)
                            }
                        } else {
                            await StabledBot.replyDataError(interaction)
                        }
                        break
                    }
                    case Constants.BUTTON_DETAIL: {
                        if (data.genOptions.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this.setCachedData(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_DETAIL_CHOICE, 'Pick which image to generate more details for:', nextIndex, data.genOptions.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_DETAIL_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            const genOptions = ImageGenerationOptions.newFrom(useData.genOptions)
                            genOptions.count = 1
                            genOptions.predefinedSeed = useData.seeds[buttonData.buttonIndex]
                            genOptions.details = true
                            await runGen(genOptions, 'Here are more details', useData.spoiler, undefined, interaction)
                        } else {
                            await StabledBot.replyDataError(interaction)
                        }
                        break
                    }
                    case Constants.BUTTON_INFO: {
                        if (data.genOptions.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this.setCachedData(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_INFO_CHOICE, 'Pick which image to get information for:', nextIndex, data.genOptions.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_INFO_CHOICE: {
                        const messageData = await this.getMessageForButton(interaction, payload)
                        let attachment: IAttachment
                        try {
                            attachment = await DiscordUtils.getAttachmentFromMessage(messageData.message, messageData.buttonIndex)
                        } catch (e) {
                            console.error(e.message)
                        }
                        if (attachment) {
                            const pngInfoResponse = await StabledAPI.getPNGInfo(attachment.data)
                            const pngInfo = pngInfoResponse.info
                            const embeds: EmbedBuilder[] = []
                            const files: AttachmentBuilder[] = []
                            if (pngInfo.length <= 4096) {
                                const embed = new EmbedBuilder().setDescription(pngInfo)
                                embeds.push(embed)
                            } else {
                                const file = new AttachmentBuilder(
                                    Buffer.from(pngInfo), {
                                        name: attachment.name.replace('.png', '') + '.txt'
                                    })
                                files.push(file)
                            }
                            try {
                                await interaction.reply({
                                    ephemeral: true,
                                    content: `PNG info loaded for: \`${attachment.name}\``,
                                    embeds,
                                    files
                                })
                            } catch (e) {
                                console.error('Info post failure:', e.message)
                            }

                        } else {
                            await interaction.reply({
                                ephemeral: true,
                                content: 'Was unable to get attachment and load the data for it :('
                            })
                        }
                        break
                    }
                }
                // endregion
            } else if (interaction.isChatInputCommand()) {
                // region Commands
                const {commandName, options, user} = interaction
                switch (commandName) {
                    case Constants.COMMAND_GEN: {
                        const genOptions = new ImageGenerationOptions()
                        genOptions.prompt = options.get(Constants.OPTION_PROMPT)?.value?.toString() ?? ''
                        genOptions.negativePrompt = options.get(Constants.OPTION_NEGATIVE_PROMPT)?.value?.toString() ?? ''
                        const aspectRatio = options.get(Constants.OPTION_ASPECT_RATIO)?.value?.toString() ?? '1:1'
                        genOptions.size = Utils.normalizeSize(aspectRatio)
                        const countValue = options.get(Constants.OPTION_COUNT)?.value
                        genOptions.count = countValue ? Number(countValue) : 4
                        const spoiler = !!options.get(Constants.OPTION_SPOILER)?.value
                        if (genOptions.prompt.length > 0) {
                            await runGen(genOptions, 'Here you go', spoiler, undefined, interaction)
                        } else {
                            const messageData = new MessageDerivedData()
                            messageData.genOptions = genOptions
                            messageData.spoiler = spoiler
                            await DiscordCom.promptUser(new PromptUserOptions(
                                Constants.PROMPT_PROMPT,
                                'New Seed',
                                interaction,
                                '',
                                messageData
                            ))
                        }
                        break
                    }
                    case Constants.COMMAND_HELP: {
                        try {
                            if (!this._help) this._help = await fs.readFile('./help.md', 'utf8')
                            interaction.reply({
                                ephemeral: true,
                                content: this._help
                            })
                        } catch (e) {
                            console.error('Unable to load help:', e.message)
                        }
                        break
                    }
                    case Constants.COMMAND_SPAM: {
                        // Create new private thread in the current channel.
                        const channel = await DiscordUtils.getChannelFromInteraction(interaction)
                        const subcommand = options.getSubcommand()
                        switch (subcommand) {
                            case Constants.SUBCOMMAND_SPAM_THREAD: {
                                interaction.deferReply()
                                if (channel instanceof DMChannel) {
                                    try {
                                        await channel.send({
                                            content: 'Sorry, spam threads can only be created from public channels, you can still turn the feature on and off in a DM channel though.'
                                        })
                                        await interaction.deleteReply()
                                    } catch (e) {
                                        console.error('Spam thread cannot be created iN DM:', e.message)
                                    }
                                } else {
                                    const name = interaction.options.get(Constants.OPTION_SPAM_TITLE)?.value?.toString() ?? `Spam Thread for ${user.username}`
                                    const privateChannel = await channel.threads.create({
                                        name,
                                        type: ChannelType.PrivateThread
                                    })
                                    if (privateChannel) {
                                        const saved = await this._db.registerSpamThread(privateChannel.id)
                                        if (saved) {
                                            await this.setSpamState(privateChannel.id, true)
                                            try {
                                                await privateChannel.send({
                                                    content: `Welcome to your own spam channel ${user}, you can tag others in this thread to invite them!`
                                                })
                                                await interaction.deleteReply()
                                            } catch (e) {
                                                console.error('Failed to send welcome message:', e.message)
                                            }
                                        } else {
                                            try {
                                                interaction.deleteReply()
                                            } catch (e) {
                                                console.error('Failed to create spam thread:', e.message)
                                            }
                                        }
                                    }
                                }
                            }
                                break
                            case Constants.SUBCOMMAND_SPAM_ON: {
                                const channel = await DiscordUtils.getChannelFromInteraction(interaction)
                                await this.setSpamState(channel.id, true)
                                try {
                                    await interaction.reply({
                                        ephemeral: true,
                                        content: '✅ Spam mode was turned ON!'
                                    })
                                } catch (e) {
                                    console.error('Spam ON failed:', e.message)
                                }
                                break
                            }
                            case Constants.SUBCOMMAND_SPAM_OFF: {
                                const channel = await DiscordUtils.getChannelFromInteraction(interaction)
                                await this.setSpamState(channel.id, false)
                                try {
                                    await interaction.reply({
                                        ephemeral: true,
                                        content: '🛑 Spam mode was turned OFF!'
                                    })
                                } catch (e) {
                                    console.error('Spam OFF failed:', e.message)
                                }
                                break
                            }
                            default: {
                                try {
                                    await interaction.reply({
                                        ephemeral: true,
                                        content: 'This option does not exist.'
                                    })
                                } catch (e) {
                                    console.error('Spam option failed:', e.message)
                                }
                            }
                        }
                        break
                    }
                    default: {
                        try {
                            interaction.reply({
                                ephemeral: true,
                                content: `Sorry ${interaction.user} but command ${commandName} has been retired.`
                            })
                        } catch (e) {
                            console.error('Command default error response failed:', e.message)
                        }
                    }
                }
                // endregion
            } else if (interaction.isUserContextMenuCommand()) {
                // TODO: This appears to not get triggered, it goes into slash commands instead?
                console.log(interaction)
            } else if (interaction.isModalSubmit()) {
                // region Modals
                Utils.log('Modal result received', interaction.customId, interaction.user.username, Color.Reset, Color.FgCyan)
                const [type, index] = interaction.customId.split('#')
                switch (type) {
                    case Constants.PROMPT_EDIT: {
                        const data = this.getCachedData(index)
                        const genOptions = getPromptValues(interaction)
                        genOptions.predefinedSeed = data?.seeds.shift()
                        await runGen(
                            genOptions,
                            'Here is the remix',
                            data?.spoiler ?? false,
                            undefined,
                            interaction
                        )
                        break
                    }
                    case Constants.PROMPT_REDO: {
                        const data = this.getCachedData(index)
                        const genOptions = getPromptValues(interaction)
                        await runGen(
                            genOptions,
                            'Here you go again',
                            data?.spoiler ?? false,
                            undefined,
                            interaction
                        )
                        break
                    }
                    case Constants.PROMPT_PROMPT: {
                        const genOptions = getPromptValues(interaction)
                        await runGen(
                            genOptions,
                            'Here it is',
                            false,
                            undefined,
                            interaction
                        )
                        break
                    }
                }
                // endregion
            }
        })

        function getPromptValues(interaction: ModalSubmitInteraction): ImageGenerationOptions {
            const countValue = interaction.fields.getTextInputValue(Constants.INPUT_NEW_COUNT) ?? '4'
            let count = Number(countValue)
            if (isNaN(count)) count = 4
            count = Math.min(Math.max(count, 1), 10)

            const sizeValue = interaction.fields.getTextInputValue(Constants.INPUT_NEW_SIZE) ?? '1:1'
            const size = Utils.normalizeSize(sizeValue)

            const genOptions = new ImageGenerationOptions()
            genOptions.prompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? ''
            genOptions.negativePrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
            genOptions.size = size
            genOptions.count = count
            return genOptions
        }

        // TODO: Generalize this input as one data class that is instantiated with defaults, then provided as one parameter.
        //  Make other functions take that SAME object, instead of repeating all the parameters, and then some additional options for things that won't fit.
        async function runGen(
            genOptions: ImageGenerationOptions,
            messageStart: string,
            spoiler: boolean,
            message?: Message,
            interaction?: ButtonInteraction | CommandInteraction | ModalSubmitInteraction,
            fromMention?: boolean
        ) {
            try {
                const reference = await DiscordCom.replyQueuedAndGetReference(message, interaction, fromMention)

                // Generate
                Utils.log('Adding to queue', `${genOptions.count} image(s)`, reference.getConsoleLabel(), Color.FgYellow)
                Tasks.updateQueues()
                const images = await StabledAPI.generateImages(reference, genOptions)
                Tasks.updateQueues()
                if (Object.keys(images).length) {
                    // Send to Discord
                    Utils.log('Finished generating', `${Object.keys(images).length} image(s)`, reference.getConsoleLabel(), Color.FgGreen)
                    const user = await reference.getUser(client)
                    const reply = await DiscordCom.addImagesToResponse(
                        client,
                        reference,
                        genOptions,
                        images,
                        `${messageStart} ${user}!`,
                        spoiler
                    )
                } else {
                    await StabledBot.nodeError(client, reference)
                }
            } catch (e) {
                console.error(e)
            }
        }
    }

    private static async nodeError(client: Client, reference: MessageReference) {
        try {
            const message = await reference.getMessage(client)
            const user = await reference.getUser(client)
            await message?.edit({
                content: `Sorry ${user} but the node appears to be offline or the request timed out :(`
            })
        } catch (e) {
            console.error('Failed to post error message:', e.message)
        }
    }

    /**
     * If there was no cache to load we respond with this error message.
     * @param interaction
     * @private
     */
    private static async replyDataError(interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction) {
        try {
            await interaction.reply({
                ephemeral: true,
                content: 'The menu has expired, dismiss it and relaunch.'
            })
        } catch (e) {
            console.error('Failed to post error message:', e.message)
        }
    }

    /**
     * This will get a cached message if a submenu button was pressed, or the interaction message if a main button was pressed.
     * @param interaction
     * @param payload
     * @private
     */
    private async getMessageForButton(interaction: ButtonInteraction, payload: string): Promise<{ buttonIndex: number, message: Message | undefined }> {
        let messageId: string
        let buttonIndex: string
        let cacheIndex: string
        if (payload) {
            [cacheIndex, buttonIndex] = payload.split(':')
            const cachedData = this.getCachedData(cacheIndex, false)
            messageId = cachedData?.messageId
        } else {
            messageId = interaction.message.id
        }
        const numberButtonIndex = Number(buttonIndex)
        return {
            buttonIndex: isNaN(numberButtonIndex) ? 0 : numberButtonIndex,
            message: await DiscordUtils.getMessageWithIdFromInteraction(interaction, messageId)
        }
    }

    private getDataForButton(payload: string | undefined): { buttonIndex: number, data: MessageDerivedData | undefined } {
        const [cacheIndex, buttonIndex] = payload?.split(':') ?? []
        const numberButtonIndex = Number(buttonIndex)
        return {
            buttonIndex: isNaN(numberButtonIndex) ? 0 : numberButtonIndex,
            data: cacheIndex ? this.getCachedData(cacheIndex, false) : undefined
        }
    }

    private async getSpamState(channelId: string) {
        let state = this._spamTheadStates.get(channelId)
        if (state === undefined) {
            state = await this._db.isSpamThread(channelId)
            this._spamTheadStates.set(channelId, state)
        }
        return state
    }

    private async setSpamState(channelId: string, state: boolean) {
        this._spamTheadStates.set(channelId, state)
        state ? await this._db.registerSpamThread(channelId) : await this._db.unregisterSpamThread(channelId)
    }
}