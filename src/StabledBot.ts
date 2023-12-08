import Config from './Config.js'
import {ApplicationCommandOptionType, AttachmentBuilder, ButtonInteraction, ButtonStyle, ChannelType, Client, CommandInteraction, DMChannel, EmbedBuilder, Events, GatewayIntentBits, Message, ModalSubmitInteraction, Partials} from 'discord.js'
import Tasks, {MessageDerivedData} from './Tasks.js'
import dns from 'node:dns';
import Constants from './Constants.js'
import {CronJob} from 'cron'
import Utils, {Color, IStringDictionary} from './Utils.js'
import DiscordCom, {MessageReference, PostOptions, PromptUserOptions} from './DiscordCom.js'
import StabledAPI, {ImageGenerationOptions, QueueItem} from './StabledAPI.js'
import DiscordUtils, {IAttachment} from './DiscordUtils.js'
import fs from 'fs/promises'
import DB from './DB.js'
import ImageUtils from './ImageUtils.js'

export default class StabledBot {
    private static helpCache: IStringDictionary = {}
    private _dataCache = new Map<number, MessageDerivedData>()
    private _interactionIndex = 0
    private _spamTheadStates = new Map<string, boolean>() // Use methods to set this so it also updates the database.
    private _db: DB

    private getNextInteractionIndex(): number {
        return ++this._interactionIndex
    }

    private setCachedData(data: MessageDerivedData) {
        const index = this.getNextInteractionIndex()
        this._dataCache.set(Number(index), data)
        return index
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
        const config = await Config.get()
        this._db = new DB()

        // Register Stabled result listener
        StabledAPI.registerResultListener(async (item) => {
            // Send to Discord
            try {
                await DiscordCom.addImagesToResponse(client, item)
            } catch (e) {
                console.error('Failed to send images:', e.message)
                await StabledBot.nodeError(client, item.reference)
            }
        })

        // Update bot status
        const loadProgressJob = new CronJob(
            '*/5 * * * * *',
            async () => {
                try {
                    await Tasks.updateProgressAndStartGenerations(client)
                } catch (e) {
                    console.error('Progress failed to update:', e.message)
                }
            },
            null,
            false
        )

        await DiscordCom.registerCommands()

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
                if (client.user.username != config.botUserName) {
                    await c.user.setUsername(config.botUserName)
                }
            } catch (e) {
                console.error('Failed to update username:', e.message)
            }
        })

        // Log in to Discord with your client's token
        if (!config?.token) throw new Error('No token found in config.json or config.local.json')
        else client.login(config.token).then()

        client.on(Events.MessageCreate, async message => {
            const spamEnabled = await this.getSpamState(message.channelId)
            if (message.author.bot) return // Skip generating from bots
            if (!message.content.trim().length) return // Skip empty messages, like ones with just an image

            const mentionCount = message.mentions?.members?.size ?? 0 // To detect replies to other people, no message tag but a mention, does not exist on DMs.
            const allTags = DiscordUtils.getTagsFromContent(message.content)
            const botTags = allTags.filter(group => {
                return group == client.user.id
            }) ?? []

            let prompt = message.content
            const userId = message.author.id
            if (spamEnabled && allTags.length == 0 && mentionCount == 0) {
                prompt = await Utils.applyUserParamsToPrompt(this._db, userId, prompt)
                gen(userId, this._db, prompt, 'Spam served', false, config.spamMaxBatchSize).then()
            } else if (botTags.length > 0) {
                prompt = await Utils.applyUserParamsToPrompt(this._db, userId, prompt)
                prompt = DiscordUtils.removeTagsFromContent(prompt)
                gen(userId, this._db, prompt, 'A quickie', true, config.spamMaxBatchSize).then()
            }

            async function gen(userId: string, db: DB, input: string, response: string, fromMention: boolean, maxEntries: number = 64) {
                const imageOptions = await Utils.getImageOptionsFromInput(input, userId, db)
                if (imageOptions.length > 1) Utils.log('Prompts generated from variation groups', imageOptions.length.toString(), message.author.username, Color.Reset, Color.FgCyan)
                if (imageOptions.length > config.spamThreadThreshold && !message.channel.isDMBased() && !message.channel.isThread()) {
                    DiscordCom.sendSpamThreadMessage(imageOptions, message).then()
                } else {
                    batchEnqueueGen(imageOptions, userId, response, message, fromMention).then()
                }
            }
        })

        client.on(Events.InteractionCreate, async interaction => {
            if (interaction.isButton()) {
                // region Buttons
                const [type, payload] = interaction.customId.split('#')
                const data = await Tasks.getDataForMessage(interaction.message)
                switch (type.toLowerCase()) {
                    case Constants.BUTTON_DELETE: {
                        Utils.log('Button pressed', interaction.customId, interaction.user.username, Color.Reset, Color.FgCyan)
                        const messageResult = await DiscordUtils.getMessageFromInteraction(interaction)
                        if (messageResult) {
                            if (
                                messageResult.channel instanceof DMChannel // DMs are always deletable
                                || data.userId == interaction.user.id // Limit to creator in public channels
                            ) {
                                Utils.log('Deletion', messageResult.message.id, interaction.user.username, Color.Reset, Color.FgRed)
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
                        const nextIndex = this.setCachedData(data)
                        await DiscordCom.promptUserForImageOptions(new PromptUserOptions(
                            Constants.PROMPT_REDO,
                            "Random Seed",
                            interaction,
                            nextIndex.toString(),
                            data
                        ))
                        break
                    }
                    case Constants.BUTTON_EDIT: {
                        const nextIndex = this.setCachedData(data)
                        await DiscordCom.promptUserForImageOptions(new PromptUserOptions(
                            Constants.PROMPT_EDIT,
                            "Recycle Seed",
                            interaction,
                            nextIndex.toString(),
                            data
                        ))
                        break
                    }
                    case Constants.BUTTON_VARY: {
                        if (data.imageOptions.count > 1) {
                            const nextIndex = this.setCachedData(data)
                            await DiscordCom.showButtons(Constants.BUTTON_VARY_CHOICE, 'Pick which image to make variations for:', nextIndex, data.imageOptions.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_VARY_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            const genOptions = ImageGenerationOptions.newFrom(useData.imageOptions)
                            genOptions.count = 4
                            genOptions.predefinedSeed = useData.seeds[buttonData.buttonIndex]
                            genOptions.variation = true
                            enqueueGen(genOptions, 'Here are the variations', useData.spoiler, undefined, interaction).then()
                        } else {
                            StabledBot.replyDataError(interaction).then()
                        }
                        break
                    }
                    case Constants.BUTTON_UPSCALE: {
                        if (data.imageOptions.count > 1) {
                            const nextIndex = this.setCachedData(data)
                            await DiscordCom.showButtons(Constants.BUTTON_UPSCALE_CHOICE, 'Pick which image to up-scale:', nextIndex, data.imageOptions.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_UPSCALE_CHOICE: {
                        // const buttonData = this.getDataForButton(payload)
                        // const useData = buttonData.data ?? data
                        // if (useData) {
                        //     const reference = await DiscordCom.replyQueuedAndGetReference(undefined, interaction)
                        //     reference.source = ESource.Upscale
                        //     try {
                        //         const imageOptions = new ImageGenerationOptions()
                        //         imageOptions.count = 1
                        //         imageOptions.hires = true
                        //         Tasks.updateQueues()
                        //         const images = await Tasks.getAttachmentAndUpscale(client, reference, imageOptions, useData.messageId, buttonData.buttonIndex)
                        //         Tasks.updateQueues()
                        //         const user = await reference.getUser(client)
                        //         if (Object.keys(images).length) {
                        //             await DiscordCom.addImagesToResponse(client, reference, imageOptions, images, `Here is the up-scaled image ${user}!`, useData.spoiler)
                        //         } else {
                        //             await StabledBot.nodeError(client, reference)
                        //         }
                        //     } catch (e) {
                        //         const message = await reference.getMessage(client)
                        //         await message?.delete()
                        //         console.error(e)
                        //     }
                        // } else {
                        //     await StabledBot.replyDataError(interaction)
                        // }
                        break
                    }
                    case Constants.BUTTON_DETAIL: {
                        if (data.imageOptions.count > 1) {
                            const nextIndex = this.setCachedData(data)
                            await DiscordCom.showButtons(Constants.BUTTON_DETAIL_CHOICE, 'Pick which image to generate more details for:', nextIndex, data.imageOptions.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_DETAIL_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            const genOptions = ImageGenerationOptions.newFrom(useData.imageOptions)
                            genOptions.count = 1
                            genOptions.predefinedSeed = useData.seeds[buttonData.buttonIndex]
                            genOptions.details = true
                            enqueueGen(genOptions, 'Here are more details', useData.spoiler, undefined, interaction).then()
                        } else {
                            StabledBot.replyDataError(interaction).then()
                        }
                        break
                    }
                    case Constants.BUTTON_INFO: {
                        if (data.imageOptions.count > 1) {
                            const nextIndex = this.setCachedData(data)
                            DiscordCom.showButtons(
                                Constants.BUTTON_INFO_CHOICE,
                                'Pick which image to get information for:',
                                nextIndex,
                                data.imageOptions.count,
                                interaction
                            ).then()
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
                                interaction.reply({
                                    ephemeral: true,
                                    content: `PNG info loaded for: \`${attachment.name}\``,
                                    embeds,
                                    files
                                }).then()
                            } catch (e) {
                                console.error('Info post failure:', e.message)
                            }

                        } else {
                            interaction.reply({
                                ephemeral: true,
                                content: 'Was unable to get attachment and load the data for it :('
                            }).then()
                        }
                        break
                    }
                    case Constants.BUTTON_SPAM_THREAD_CANCEL: {
                        if (interaction)
                            DiscordCom.spamThreadCancelled(Number(payload), interaction).then()
                        break
                    }
                    case Constants.BUTTON_SPAM_THREAD_OK: {
                        DiscordCom.spamThreadOk(Number(payload), interaction).then()
                        break
                    }
                }
                // endregion
            } else if (interaction.isChatInputCommand()) {
                // region Commands
                const {commandName, options, user} = interaction
                switch (commandName) {
                    case Constants.COMMAND_GEN: {
                        const imageOptions = new ImageGenerationOptions()
                        let prompt = options.get(Constants.OPTION_PROMPT)?.value?.toString() ?? await this._db.getUserSetting(interaction.user.id, Constants.OPTION_PROMPT) ?? ''
                        prompt = await Utils.applyUserParamsToPrompt(this._db, interaction.user.id, prompt)
                        imageOptions.prompt = prompt
                        imageOptions.negativePrompt = options.get(Constants.OPTION_NEGATIVE_PROMPT)?.value?.toString() ?? await this._db.getUserSetting(interaction.user.id, Constants.OPTION_NEGATIVE_PROMPT) ?? ''
                        const aspectRatio = options.get(Constants.OPTION_ASPECT_RATIO)?.value?.toString() ?? await this._db.getUserSetting(interaction.user.id, Constants.OPTION_SIZE) ?? '1:1'
                        imageOptions.size = Utils.normalizeSize(aspectRatio)
                        const countValue = options.get(Constants.OPTION_COUNT)?.value ?? await this._db.getUserSetting(interaction.user.id, Constants.OPTION_COUNT)
                        imageOptions.count = countValue ? Number(countValue) : 4
                        const hiresState = Utils.boolVal(options.get(Constants.OPTION_HIRES)?.value ?? await this._db.getUserSetting(interaction.user.id, Constants.OPTION_HIRES))
                        imageOptions.hires = !!hiresState
                        const spoiler = !!options.get(Constants.OPTION_SPOILER)?.value
                        if (imageOptions.prompt.length > 0) {
                            enqueueGen(imageOptions, 'Here you go', spoiler, undefined, interaction).then()
                        } else {
                            const messageData = new MessageDerivedData()
                            messageData.imageOptions = imageOptions
                            messageData.spoiler = spoiler
                            DiscordCom.promptUserForImageOptions(new PromptUserOptions(
                                Constants.PROMPT_PROMPT,
                                'New Seed',
                                interaction,
                                '',
                                messageData
                            )).then()
                        }
                        break
                    }
                    case Constants.COMMAND_HELP: {
                        const option = options.get(Constants.OPTION_HELP_SECTION)
                        const file = option?.value as string ?? Constants.OPTION_HELP_GENERAL
                        async function displayHelp(fileName: string, interaction: CommandInteraction) {
                            try {
                                if (!StabledBot.helpCache.hasOwnProperty(fileName)) StabledBot.helpCache[fileName] = await fs.readFile(`./help/${fileName}.md`, 'utf8')
                                interaction.reply({
                                    ephemeral: true,
                                    content: StabledBot.helpCache[fileName]
                                }).then()
                            } catch (e) {
                                console.error('Unable to load help:', e.message)
                            }
                        }

                        displayHelp(file, interaction).then()
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
                    case Constants.COMMAND_SET: {
                        const prompt = options.get(Constants.OPTION_PROMPT)?.value?.toString()
                        const negativePrompt = options.get(Constants.OPTION_NEGATIVE_PROMPT)?.value?.toString()
                        const size = options.get(Constants.OPTION_SIZE)?.value?.toString()
                        const count = options.get(Constants.OPTION_COUNT)?.value.toString()
                        const hires = options.get(Constants.OPTION_HIRES)?.value.toString()
                        let updateCount = 0
                        if (prompt !== undefined) await this._db.setUserSetting(interaction.user.id, Constants.OPTION_PROMPT, prompt) ? updateCount++ : undefined
                        if (negativePrompt !== undefined) await this._db.setUserSetting(interaction.user.id, Constants.OPTION_NEGATIVE_PROMPT, negativePrompt) ? updateCount++ : undefined
                        if (size !== undefined) await this._db.setUserSetting(interaction.user.id, Constants.OPTION_SIZE, size) ? updateCount++ : undefined
                        if (count !== undefined) await this._db.setUserSetting(interaction.user.id, Constants.OPTION_COUNT, count) ? updateCount++ : undefined
                        if (hires !== undefined) await this._db.setUserSetting(interaction.user.id, Constants.OPTION_HIRES, hires) ? updateCount++ : undefined
                        try {
                            interaction.reply({
                                ephemeral: true,
                                content: `Updated ${updateCount} user setting(s).`
                            })
                        } catch (e) {
                            console.error('Set reply failed:', e.message)
                        }
                        break
                    }
                    case Constants.COMMAND_PARAM: {
                        let name = options.get(Constants.OPTION_PARAM_NAME)?.value?.toString()
                        const value = options.get(Constants.OPTION_PARAM_VALUE)?.value?.toString()
                        const subcommand = options.getSubcommand()
                        switch (subcommand) {
                            case Constants.SUBCOMMAND_PARAM_SET: {
                                if (name && value) {
                                    name = name.toLowerCase().replaceAll(/\s/g, '')
                                    const updated = await this._db.setUserParam(interaction.user.id, name, value)
                                    try {
                                        interaction.reply({
                                            ephemeral: true,
                                            content: updated ? `Set parameter "${name}" to "${value}".` : `Failed to update parameter "${name}".`
                                        })
                                    } catch (e) {
                                        console.error('Set param reply failed:', e.message)
                                    }
                                }
                                break
                            }
                            case Constants.SUBCOMMAND_PARAM_UNSET: {
                                if (name) {
                                    const deleted = await this._db.deleteUserParam(interaction.user.id, name)
                                    try {
                                        interaction.reply({
                                            ephemeral: true,
                                            content: deleted ? `Deleted parameter "${name}".` : `Failed to delete parameter "${name}".`
                                        })
                                    } catch (e) {
                                        console.error('Unset param reply failed:', e.message)
                                    }
                                }
                                break
                            }
                        }
                        break
                    }
                    case Constants.COMMAND_LIST: {
                        const subcommand = options.getSubcommand()
                        const userId = interaction.user.id
                        switch (subcommand) {
                            case Constants.SUBCOMMAND_LIST_SETTINGS: {
                                const settings = await this._db.getAllUserSettings(userId)
                                try {
                                    interaction.reply({
                                        content: 'User settings: ```json\n' + JSON.stringify(settings, null, 2) + '```',
                                        ephemeral: true,
                                    })
                                } catch (e) {
                                    console.error('Failed to reply to list command.', e.message)
                                }
                                break
                            }
                            case Constants.SUBCOMMAND_LIST_PARAMS: {
                                const defines = await this._db.getAllUserParams(userId)
                                try {
                                    interaction.reply({
                                        content: 'User defined parameters: ```json\n' + JSON.stringify(defines, null, 2) + '```',
                                        ephemeral: true,
                                    })
                                } catch (e) {
                                    console.error('Failed to reply to list command.', e.message)
                                }
                                break
                            }
                        }
                        break
                    }
                    case Constants.COMMAND_CANCEL: {
                        const selection = options.get(Constants.OPTION_CANCEL_SELECTION)?.value?.toString()
                        if (selection) {
                            const all = selection.trim() == '*'
                            const [start, end] = selection.split('-')
                            const startIndex = Number(start)
                            const endIndex = Number(end)
                            const single = Number(selection)
                            const references = StabledAPI.unregisterQueueItemsForUser(interaction.user.id, single, startIndex, endIndex, all)
                            try {
                                interaction.reply({
                                    ephemeral: true,
                                    content: `Will attempt to cancel ${references.length} generation(s).`
                                })
                            } catch (e) {
                                console.error('Cancel reply failed:', e.message)
                            }
                            for (const reference of references) {
                                try {
                                    reference.getMessage(client).then(message => {
                                        if (message) message.delete().then()
                                    })
                                } catch (e) {
                                    console.error('Removing cancelled message failed:', e.message)
                                }
                            }
                        } else {
                            try {
                                await interaction.deferReply()
                                interaction.deleteReply().then()
                            } catch (e) {
                                console.error('Cancel cancellation failed:', e.message)
                            }
                        }
                        break
                    }
                    case Constants.COMMAND_TEXT: {
                        const text = options.get(Constants.OPTION_TEXT_INPUT)?.value?.toString() ?? ''
                        const font = options.get(Constants.OPTION_FONT)?.value?.toString() ?? 'Arial'
                        const fontSize = Number(options.get(Constants.OPTION_FONT_SIZE)?.value?.toString() ?? '25')
                        const aspectRatio = options.get(Constants.OPTION_ASPECT_RATIO)?.value?.toString() ?? '1:1'
                        const bold = !!options.get(Constants.OPTION_FONT_BOLD)?.value
                        const italic = !!options.get(Constants.OPTION_FONT_ITALIC)?.value
                        const size = Utils.normalizeSize(aspectRatio)
                        const prompt = options.get(Constants.OPTION_PROMPT)?.value?.toString() ?? ''
                        const negativePrompt = options.get(Constants.OPTION_NEGATIVE_PROMPT)?.value?.toString() ?? ''
                        try {
                            const imageStr = ImageUtils.getImageWithText(text, fontSize, font, bold, italic, size)
                            if(prompt.length) {
                                const imageOptions = new ImageGenerationOptions()
                                imageOptions.count = config.imageCountForTextGenerations
                                imageOptions.size = size
                                imageOptions.prompt = prompt
                                imageOptions.negativePrompt = negativePrompt
                                imageOptions.sourceImage = imageStr
                                const messageStart = 'Here is the text'
                                enqueueGen(
                                    imageOptions,
                                    messageStart,
                                    false,
                                    undefined,
                                    interaction
                                ).then()
                            } else {
                                DiscordCom.sendImagePreviewMessage('This is how the text will appear, fill in the `prompt` when you want to generate the full image.', imageStr, interaction).then()
                            }
                        } catch (e) {
                            try {
                                interaction.reply({
                                    ephemeral: true,
                                    content: `Failed to generate text image: ${e.message}`
                                })
                            } catch (e) {
                                console.error('Failed to reply to text image generation failure:', e.message)
                            }
                            console.error('Text image generation failed:', e.message)
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
            } else if (interaction.isModalSubmit()) {
                // region Modals
                Utils.log('Modal result received', interaction.customId, interaction.user.username, Color.Reset, Color.FgCyan)
                const [type, index] = interaction.customId.split('#')
                switch (type) {
                    case Constants.PROMPT_EDIT: {
                        const data = this.getCachedData(index)
                        const genOptions = await getPromptValues(this._db, interaction)
                        genOptions.predefinedSeed = data?.seeds.shift()
                        enqueueGen(
                            genOptions,
                            'Here is the remix',
                            data?.spoiler ?? false,
                            undefined,
                            interaction
                        ).then()
                        break
                    }
                    case Constants.PROMPT_REDO: {
                        const data = this.getCachedData(index)
                        const genOptions = await getPromptValues(this._db, interaction)
                        enqueueGen(
                            genOptions,
                            'Here you go again',
                            data?.spoiler ?? false,
                            undefined,
                            interaction
                        ).then()
                        break
                    }
                    case Constants.PROMPT_PROMPT: {
                        const genOptions = await getPromptValues(this._db, interaction)
                        enqueueGen(
                            genOptions,
                            'Here it is',
                            false,
                            undefined,
                            interaction
                        ).then()
                        break
                    }
                    case Constants.PROMPT_THREAD: {
                        interaction.deferUpdate().then()
                        const title = interaction.fields.getTextInputValue(Constants.INPUT_THREAD_TITLE) ?? ''
                        const cache = DiscordCom.getSpamThreadCache(Number(index), true)
                        const channel = await DiscordUtils.getChannelFromInteraction(interaction)
                        if (title.length && cache && channel && !(channel instanceof DMChannel)) {
                            const threadChannel = await channel.threads.create({
                                type: ChannelType.PublicThread,
                                name: title
                            })
                            if (threadChannel) {
                                const message = await threadChannel.send({
                                    content: `Welcome to the spam thread ${interaction.user}, here we go!`
                                })
                                if (message) {
                                    Utils.log('Spam thread created', threadChannel.id, interaction.user.username, Color.Reset, Color.FgCyan)
                                    batchEnqueueGen(cache.options, cache.userId, 'Batch spam served', message, false).then()
                                } else console.error('Failed to send welcome message in spam thread.')
                            } else console.error('Failed to create spam thread.')
                        }
                    }
                }
                // endregion
            }
        })

        async function getPromptValues(db: DB, interaction: ModalSubmitInteraction): Promise<ImageGenerationOptions> {
            const countValue = interaction.fields.getTextInputValue(Constants.INPUT_NEW_COUNT) ?? '4'
            let count = Number(countValue)
            if (isNaN(count)) count = 4
            count = Math.min(Math.max(count, 1), 10)

            const sizeValue = interaction.fields.getTextInputValue(Constants.INPUT_NEW_SIZE) ?? '1:1'
            const size = Utils.normalizeSize(sizeValue)
            const hires = Utils.boolVal(interaction.fields.getTextInputValue(Constants.INPUT_NEW_HIRES) ?? false)

            const genOptions = new ImageGenerationOptions()
            genOptions.prompt = await Utils.applyUserParamsToPrompt(db, interaction.user.id, interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? '')
            genOptions.negativePrompt = interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? ''
            genOptions.size = size
            genOptions.count = count
            genOptions.hires = hires
            return genOptions
        }

        async function batchEnqueueGen(imageOptions: ImageGenerationOptions[], userId: string, response: string, message?: Message, fromMention?: boolean) {
            const config = await Config.get()
            if (imageOptions?.length !== 1) Utils.log('Prompts in batch cache', imageOptions?.length.toString(), message?.author.username, Color.Reset, Color.FgCyan)
            for (const options of imageOptions?.slice(0, config.spamMaxBatchSize) ?? []) {
                options.count = 1
                if (options.prompt.trim().length > 0) enqueueGen(options, response, false, message, undefined, fromMention, userId, imageOptions.length > config.spamThreadThreshold).then()
            }
        }

        async function enqueueGen(
            imageOptions: ImageGenerationOptions,
            messageStart: string,
            spoiler: boolean,
            message?: Message,
            interaction?: ButtonInteraction | CommandInteraction | ModalSubmitInteraction,
            fromMention?: boolean,
            userIdOverride?: string,
            isBatch?: boolean
        ) {
            const config = await Config.get()
            try {
                const index = StabledAPI.getNextQueueIndex()
                let source: ESource = ESource.Generate
                if (imageOptions.predefinedSeed) source = ESource.Recycle
                if (imageOptions.variation) source = ESource.Variation
                if (imageOptions.details) source = ESource.Detail
                let stepCount = imageOptions.details
                    ? config.stepCountBase * config.stepCountDetailMultiplier
                    : imageOptions.sourceImage.length > 0
                        ? config.stepCountBase * config.stepCountTextMultiplier * config.imageCountForTextGenerations
                        : config.stepCountBase * imageOptions.count
                const reference = await DiscordCom.replyQueuedAndGetReference(index, source, fromMention, stepCount * (imageOptions.hires ? 2 : 1), message, interaction)
                if (userIdOverride) reference.userId = userIdOverride

                // Generate
                const postOptions = new PostOptions()
                const user = await reference.getUser(client)

                // We ignore tagging the user if it's the bot user, which now for some reason happens for batch posts, which is fine but I don't know why.
                postOptions.message = `${messageStart} ${user}!`

                postOptions.spoiler = spoiler
                const queueItem = new QueueItem(index, source, !!isBatch, reference, imageOptions, postOptions)
                StabledAPI.enqueueGeneration(queueItem)
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

export enum ESource {
    Unknown = 'unknown',
    Generate = 'generation',
    Recycle = 'recycling',
    Variation = 'variations',
    Detail = 'details',
    Upscale = 'up-scaling',
    Upres = 'up-ressing'
}