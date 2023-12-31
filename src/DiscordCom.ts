import {ActionRowBuilder, APIEmbed, ApplicationCommandType, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Client, CommandInteraction, DMChannel, Message, ModalBuilder, ModalSubmitInteraction, REST, Routes, SlashCommandBuilder, TextChannel, TextInputBuilder, TextInputStyle, User} from 'discord.js'
import Config from './Config.js'
import Constants from './Constants.js'
import DiscordUtils from './DiscordUtils.js'
import Utils, {Color, IStringDictionary} from './Utils.js'
import {MessageDerivedData} from './Tasks.js'
import {ImageGenerationOptions, QueueItem} from './StabledAPI.js'
import {ESource} from './StabledBot.js'

export default class DiscordCom {
    private static _rest: REST
    private static _spamBatchIndex = 0
    private static _spamBatchCache: Map<number, SpamThreadCache> = new Map<number, SpamThreadCache>()

    static async ensureREST() {
        const config = await Config.get()
        if (!this._rest) {
            this._rest = new REST({version: '10'}).setToken(config.token)
        }
    }

    // region Commands
    static async registerCommands() {
        const config = await Config.get()
        await this.ensureREST()
        const genCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_GEN)
            .setDescription('Generate an image from a prompt.')
            .addStringOption(option => {
                return DiscordUtils.buildPromptOption(option)
            })
            .addStringOption(option => {
                return DiscordUtils.buildNegativePromptOption(option)
            })
            .addIntegerOption(option => {
                return option
                    .setName(Constants.OPTION_COUNT)
                    .setDescription('The number of images to generate.')
                    .addChoices(
                        {name: '1', value: 1},
                        {name: '2', value: 2},
                        {name: '3', value: 3},
                        {name: '4', value: 4},
                        {name: '5', value: 5},
                        {name: '6', value: 6},
                        {name: '7', value: 7},
                        {name: '8', value: 8},
                        {name: '9', value: 9},
                        {name: '10', value: 10}
                    )
            })
            .addStringOption(option => {
                return DiscordUtils.buildAspectRatioOption(option)
            })
            .addBooleanOption(option => {
                return option
                    .setName(Constants.OPTION_SPOILER)
                    .setDescription('Censor the generated images.')
            })
            .addBooleanOption(option => {
                return option
                    .setName(Constants.OPTION_HIRES)
                    .setDescription('Generate a high resolution image.')
            })

        const helpCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_HELP)
            .setDescription('Show documentation about the bot and instructions on how to use it.')
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_HELP_SECTION)
                    .setDescription('Select a help topic.')
                    .setRequired(true)
                    .addChoices(
                        {name: '1. General Usage', value: Constants.OPTION_HELP_GENERAL},
                        {name: '2. Image Generation', value: Constants.OPTION_HELP_GEN},
                        {name: '3. Response Buttons', value: Constants.OPTION_HELP_BUTTONS},
                        {name: '4. Chat Message Prompts', value: Constants.OPTION_HELP_SPAM},
                        {name: '5. User Settings', value: Constants.OPTION_HELP_SETTINGS},
                        {name: '6. User Parameters', value: Constants.OPTION_HELP_PARAMS},
                        {name: '7. Text Generation', value: Constants.OPTION_HELP_TEXT},
                        {name: '8. Advanced Workflow Example', value: Constants.OPTION_HELP_WORKFLOW}
                    )
            })

        const spamCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_SPAM)
            .setDescription('Access spam feature alternatives.')
            .addSubcommand(subcommand => {
                return subcommand
                    .setName(Constants.SUBCOMMAND_SPAM_THREAD)
                    .setDescription('Launch a spam thread where each message is a prompt.')
                    .addStringOption(option => {
                        return option
                            .setName(Constants.OPTION_SPAM_TITLE)
                            .setDescription('The title of the spam thread.')
                    })
            })
            .addSubcommand(subcommand => {
                return subcommand
                    .setName(Constants.SUBCOMMAND_SPAM_ON)
                    .setDescription('Turn on spam mode in this channel.')
            })
            .addSubcommand(subcommand => {
                return subcommand
                    .setName(Constants.SUBCOMMAND_SPAM_OFF)
                    .setDescription('Turn off spam mode in this channel.')
            })

        const setCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_SET)
            .setDescription('Set personal values for the bot.')
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_PROMPT)
                    .setDescription('Set default prompt.')
            })
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_NEGATIVE_PROMPT)
                    .setDescription('She default negative prompt.')
            })
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_COUNT)
                    .setDescription('She default count.')
            })
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_SIZE)
                    .setDescription('Set default size.')
            })
            .addBooleanOption(option => {
                return option
                    .setName(Constants.OPTION_HIRES)
                    .setDescription('Set default hires state.')
            })

        const paramCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_PARAM)
            .setDescription('Add a parameter used with --param')
            .addSubcommand(subcommand => {
                return subcommand
                    .setName(Constants.SUBCOMMAND_PARAM_SET)
                    .setDescription('Set a parameter.')
                    .addStringOption(option => {
                        return option
                            .setName(Constants.OPTION_PARAM_NAME)
                            .setDescription('The name of the parameter.')
                            .setRequired(true)
                    })
                    .addStringOption(option => {
                        return option
                            .setName(Constants.OPTION_PARAM_VALUE)
                            .setDescription('The value of the parameter.')
                            .setRequired(true)
                    })
            })
            .addSubcommand(subcommand => {
                return subcommand
                    .setName(Constants.SUBCOMMAND_PARAM_UNSET)
                    .setDescription('Unset a parameter.')
                    .addStringOption(option => {
                        return option
                            .setName(Constants.OPTION_PARAM_NAME)
                            .setDescription('The name of the parameter.')
                            .setRequired(true)
                    })
            })

        const listCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_LIST)
            .setDescription('List your personal data.')
            .addSubcommand(subcommand => {
                return subcommand
                    .setName(Constants.SUBCOMMAND_LIST_PARAMS)
                    .setDescription('List your defined parameters.')
            })
            .addSubcommand(subcommand => {
                return subcommand
                    .setName(Constants.SUBCOMMAND_LIST_SETTINGS)
                    .setDescription('List your settings.')
            })
        const cancelCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_CANCEL)
            .setDescription('Cancel queued generations.')
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_CANCEL_SELECTION)
                    .setDescription('Single: #, range: #-#, all: *')
                    .setRequired(true)
            })
        const textCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_TEXT)
            .setDescription('Generate an image with text, leave the prompt out to preview.')
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_TEXT_INPUT)
                    .setDescription('The text to generate.')
                    .setRequired(true)
            })
            .addStringOption(option => {
                return DiscordUtils.buildFontOption(option)
            })
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_FONT_SIZE)
                    .setDescription('The font size in percent.')
                    .setRequired(false)
            })
            .addBooleanOption(option => {
                return option
                    .setName(Constants.OPTION_FONT_BOLD)
                    .setDescription('The text is bold.')
                    .setRequired(false)
            })
            .addBooleanOption(option => {
                return option
                    .setName(Constants.OPTION_FONT_ITALIC)
                    .setDescription('The text is italic.')
                    .setRequired(false)
            })
            .addStringOption(option => {
                return DiscordUtils.buildAspectRatioOption(option)
            })
            .addStringOption(option => {
                return DiscordUtils.buildPromptOption(option)
            })
            .addStringOption(option => {
                return DiscordUtils.buildNegativePromptOption(option)
            })
        // Submit the commands
        try {
            await this._rest.put(Routes.applicationCommands(config.clientId), {
                body: [
                    genCommand.toJSON(),
                    helpCommand.toJSON(),
                    spamCommand.toJSON(),
                    setCommand.toJSON(),
                    paramCommand.toJSON(),
                    listCommand.toJSON(),
                    cancelCommand.toJSON(),
                    textCommand.toJSON()
                ]
            })
        } catch (e) {
            console.error(e)
        }
    }

    // endregion

    // region Send
    static async replyQueuedAndGetReference(
        index: number,
        source: ESource,
        fromMention: boolean,
        stepCount: number,
        message?: Message,
        interaction?: ButtonInteraction | CommandInteraction | ModalSubmitInteraction
    ): Promise<MessageReference> {
        let sentMessage: Message | undefined
        try {
            const queuedMessage = `⏰ Queued: ${source}(${stepCount}), #${index}`
            if (interaction instanceof ButtonInteraction || interaction instanceof ModalSubmitInteraction) {
                // To these we respond as a separate message, as button menus are ephemeral and will create missing references.
                await interaction?.deferUpdate()
                const channel = interaction?.channel
                sentMessage = await channel?.send({content: queuedMessage})
            } else if (interaction instanceof CommandInteraction) {
                // Commands cannot be directly dismissed, so we reply directly to the interaction instead.
                await interaction.reply({content: queuedMessage})
                sentMessage = await interaction.fetchReply()
            } else if (message && fromMention) {
                // Re reply to mentions directly
                sentMessage = await message.reply({content: queuedMessage})
            } else if (message) {
                // To messages we simply post in the same channel.
                sentMessage = await message.channel.send({content: queuedMessage})
            }
        } catch (e) {
            console.error('Unable to initiate response.', e.message)
        }
        const reference = new MessageReference()
        reference.source = source ?? ESource.Unknown
        if (message) {
            reference.userId = message.author?.id?.toString()
            reference.channelId = message.channelId
            reference.guildId = message.guildId
            reference.messageId = sentMessage?.id ?? ''
            reference.userName = message.author?.username
        } else if (interaction) {
            reference.userId = interaction.user?.id
            reference.channelId = interaction.channelId
            reference.guildId = interaction.guildId
            reference.messageId = sentMessage?.id ?? ''
            reference.userName = interaction.user?.username
        }
        return reference
    }

    static async addImagesToResponse(
        client: Client,
        item: QueueItem
    ) {
        const config = await Config.get()
        const message = await item.reference.getMessage(client)
        if (!message) throw('Could not get message.')

        const attachments = Object.entries(item.postOptions.images).map(([fileName, imageData]) => {
            return new AttachmentBuilder(Buffer.from(imageData, 'base64'), {
                name: `${fileName}.png`
            }).setSpoiler(item.postOptions.spoiler)
        })
        const row1 = new ActionRowBuilder<ButtonBuilder>()
        const row2 = new ActionRowBuilder<ButtonBuilder>()
        const deleteButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_DELETE)
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary)
        const redoButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_REDO)
            .setEmoji('🎲')
            .setStyle(ButtonStyle.Secondary)
        const editButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_EDIT)
            .setEmoji('♻️')
            .setStyle(ButtonStyle.Secondary)
        const upscaleButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_UPSCALE)
            .setEmoji('🍄')
            .setStyle(ButtonStyle.Secondary)
        const varyButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_VARY)
            .setEmoji('🎛')
            .setStyle(ButtonStyle.Secondary)
        const detailButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_DETAIL)
            .setEmoji('🦚')
            .setStyle(ButtonStyle.Secondary)
        const infoButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_INFO)
            .setEmoji('ℹ')
            .setStyle(ButtonStyle.Secondary)
        const deadButton1 = DiscordUtils.buildDeadButton(1)
        const deadButton2 = DiscordUtils.buildDeadButton(2)

        // Components
        const components: ActionRowBuilder<ButtonBuilder>[] = []
        if (item.imageOptions.sourceImage.length > 0) {
            row1.addComponents(deleteButton, infoButton)
            components.push(row1)
        } else if (item.imageOptions.details) {
            row1.addComponents(deleteButton, infoButton)
            components.push(row1)
        } else if (item.imageOptions.variation) {
            row1.addComponents(deleteButton, infoButton, detailButton)
            components.push(row1)
        } else {
            row1.addComponents(deleteButton, editButton, redoButton)
            row2.addComponents(infoButton, detailButton, varyButton)
            components.push(row1, row2)
        }

        // Reply
        if(item.imageOptions.sourceImage.length > 0) attachments.pop() // Last image is the control net one.
        try {
            Utils.log('Updating', `${Object.keys(item.postOptions.images).length} image(s)`, `#${item.index} ` + item.reference.getConsoleLabel(), Color.FgGray)
            const max = config.maxPromptSizeInResponse
            const promptLength = item.imageOptions.prompt.length
            const hintCount = item.imageOptions.promptHints.length
            const promptHint = (promptLength > max && hintCount > 0)
                ? ' ` ' + item.imageOptions.promptHints.join(', ') + ' `'
                : ` \` ${item.imageOptions.prompt.slice(0, max).trim()}${promptLength > max ? '…' : ''} \``
            return await message.edit({
                content: item.postOptions.message + promptHint,
                files: attachments,
                components
            })
        } catch (e) {
            console.error(e)
        }
        return undefined
    }

    static async showButtons(type: string, description: string, cacheIndex: number, buttonCount: number, interaction: ButtonInteraction | ModalSubmitInteraction) {
        const row1 = new ActionRowBuilder<ButtonBuilder>()
        const row2 = new ActionRowBuilder<ButtonBuilder>()
        const row3 = new ActionRowBuilder<ButtonBuilder>()
        const row4 = new ActionRowBuilder<ButtonBuilder>()

        function buildButton(index: number, label: string) {
            return new ButtonBuilder()
                .setCustomId(`${type}#${cacheIndex}:${index}`)
                .setLabel(label)
                .setStyle(ButtonStyle.Secondary)
        }

        const button1 = buildButton(0, '1')
        const button2 = buildButton(1, '2')
        const button3 = buildButton(2, '3')
        const button4 = buildButton(3, '4')
        const button5 = buildButton(4, '5')
        const button6 = buildButton(5, '6')
        const button7 = buildButton(6, '7')
        const button8 = buildButton(7, '8')
        const button9 = buildButton(8, '9')
        const button10 = buildButton(9, '10')
        const deadButton1 = DiscordUtils.buildDeadButton(1)
        const deadButton2 = DiscordUtils.buildDeadButton(2)

        const components: ActionRowBuilder<ButtonBuilder>[] = []
        switch (buttonCount) {
            case 1:
                row1.addComponents(button1)
                components.push(row1)
                break
            case 2:
                row1.addComponents(button1, button2)
                components.push(row1)
                break
            case 3:
                row1.addComponents(button1, button2)
                row2.addComponents(deadButton1, button3)
                components.push(row1, row2)
                break
            case 4:
                row1.addComponents(button1, button2)
                row2.addComponents(button3, button4)
                components.push(row1, row2)
                break
            case 5:
                row1.addComponents(button1, deadButton1, button2)
                row2.addComponents(button3, button4, button5)
                components.push(row1, row2)
                break
            case 6:
                row1.addComponents(button1, button2, button3)
                row2.addComponents(button4, button5, button6)
                components.push(row1, row2)
                break
            case 7:
                row1.addComponents(deadButton1, button1, deadButton2)
                row2.addComponents(button2, button3, button4)
                row3.addComponents(button5, button6, button7)
                components.push(row1, row2, row3)
                break
            case 8:
                row1.addComponents(button1, deadButton1, button2)
                row2.addComponents(button3, button4, button5)
                row3.addComponents(button6, button7, button8)
                components.push(row1, row2, row3)
                break
            case 9:
                row1.addComponents(button1, button2, button3)
                row2.addComponents(button4, button5, button6)
                row3.addComponents(button7, button8, button9)
                components.push(row1, row2, row3)
                break
            case 10:
                row1.addComponents(deadButton1, button1, deadButton2)
                row2.addComponents(button2, button3, button4)
                row3.addComponents(button5, button6, button7)
                row4.addComponents(button8, button9, button10)
                components.push(row1, row2, row3, row4)
                break
        }
        try {
            await interaction.reply({
                content: description,
                ephemeral: true,
                components
            })
        } catch (e) {
            console.error('Unable to show submenu:', e.message)
        }
    }

    static async sendSpamThreadMessage(imageOptions: ImageGenerationOptions[], message: Message) {
        const config = await Config.get()
        const index = ++this._spamBatchIndex
        this._spamBatchCache.set(index, new SpamThreadCache(index, message.author.id, imageOptions))

        const row = new ActionRowBuilder<ButtonBuilder>()
        const buttonCancel = new ButtonBuilder()
            .setCustomId(`${Constants.BUTTON_SPAM_THREAD_CANCEL}#${index}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
        const buttonOK = new ButtonBuilder()
            .setCustomId(`${Constants.BUTTON_SPAM_THREAD_OK}#${index}`)
            .setLabel('OK')
            .setStyle(ButtonStyle.Success)
        row.addComponents(buttonCancel, buttonOK)
        const components: ActionRowBuilder<ButtonBuilder>[] = [row]
        try {
            message.channel.send({
                content: `This prompt totals ${imageOptions.length} variations, the maximum possible is ${config.spamMaxBatchSize}, anything over that will be ignored. ${message.author} press OK to start a thread where this will be generated, else press Cancel.`,
                components
            }).then()
        } catch (e) {
            console.error('Failed to send spam thread message:', e.message)
        }
    }

    static async sendImagePreviewMessage(message: string, imageData: string, interaction: CommandInteraction) {
        const attachment = new AttachmentBuilder(Buffer.from(imageData, 'base64'), {name: `debug.png`})
        try {
            await interaction.reply({content: message, ephemeral: true, files: [attachment]})
        } catch (e) {
            console.error('Failed to send debug message:', e.message)
        }
    }

    // endregion

    // region Prompts
    static async promptUserForImageOptions(options: PromptUserOptions) {
        const textInput = new TextInputBuilder()
            .setCustomId(Constants.INPUT_NEW_PROMPT)
            .setLabel("The positive prompt, include elements.")
            .setValue(options.data.imageOptions.prompt)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        const promptRow = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput)
        const textInput2 = new TextInputBuilder()
            .setCustomId(Constants.INPUT_NEW_NEGATIVE_PROMPT)
            .setLabel("The negative prompt, exclude elements.")
            .setValue(options.data.imageOptions.negativePrompt)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        const promptRow2 = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput2)
        const textInput3 = new TextInputBuilder()
            .setCustomId(Constants.INPUT_NEW_SIZE)
            .setLabel("The size of the generated images.")
            .setValue(options.data.imageOptions.size)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        const promptRow3 = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput3)
        const textInput4 = new TextInputBuilder()
            .setCustomId(Constants.INPUT_NEW_COUNT)
            .setLabel("The number of images to generate, 1-10.")
            .setValue(options.data.imageOptions.count.toString())
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        const promptRow4 = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput4)
        const textInput5 = new TextInputBuilder()
            .setCustomId(Constants.INPUT_NEW_HIRES)
            .setLabel("Generate a high resolution image.")
            .setValue(options.data.imageOptions.hires.toString())
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        const promptRow5 = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput5)

        const index = !!options.index ? `#${options.index}` : ''
        const modal = new ModalBuilder()
            .setCustomId(options.customIdPrefix + index)
            .setTitle(options.title)
            .addComponents(promptRow, promptRow2, promptRow3, promptRow4, promptRow5)
        await options.interaction.showModal(modal)
    }

    // endregion
    static async spamThreadCancelled(index: number, interaction: ButtonInteraction) {
        const cache = this.getSpamThreadCache(index)
        if (!cache || cache.userId !== interaction.user.id) {
            try {
                await interaction.reply({
                    content: 'Only the creator can use this button.',
                    ephemeral: true
                })
                return
            } catch (e) {
                console.error('Failed to reply to spam button press:', e.message)
            }
        }
        try {
            this.getSpamThreadCache(index, true)
            interaction.message?.delete().then()
        } catch (e) {
            console.error('Failed to delete spam thread message:', e.message)
        }
    }

    static async spamThreadOk(index: number | string, interaction: ButtonInteraction) {
        const cache = this.getSpamThreadCache(index)
        if (!cache || cache.userId !== interaction.user.id) {
            try {
                await interaction.reply({
                    content: 'Only the creator can use this button.',
                    ephemeral: true
                })
                return
            } catch (e) {
                console.error('Failed to reply to spam button press:', e.message)
            }
        }
        try {
            interaction.message.delete().then()
        } catch (e) {
            console.error('Failed to delete spam thread message:', e.message)
        }
        const textInput = new TextInputBuilder()
            .setCustomId(Constants.INPUT_THREAD_TITLE)
            .setLabel('A descriptive title for the spam thread.')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        const promptRow = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput)
        const modal = new ModalBuilder()
            .setCustomId(Constants.PROMPT_THREAD + '#' + index)
            .setTitle('Thread Title')
            .addComponents(promptRow)
        await interaction.showModal(modal)
    }

    static getSpamThreadCache(index: number | string, andDelete: boolean = false): SpamThreadCache | undefined {
        const cache = this._spamBatchCache.get(Number(index))
        if (andDelete) this._spamBatchCache.delete(Number(index))
        return cache
    }
}

// region Sub Classes
export class MessageReference {
    constructor(
        public userId: string = '',
        public channelId: string = '',
        public guildId: string = '',
        public messageId: string = '',
        public userName: string = '',
        public source: ESource = ESource.Unknown
    ) {
    }

    async getChannel(client: Client): Promise<TextChannel | DMChannel | undefined> {
        try {
            if (this.guildId) { // Server channel
                const guild = client.guilds.cache.get(this.guildId)
                const channel = guild?.channels.cache.get(this.channelId)
                return channel as TextChannel
            } else { // DM
                const user = await client.users.fetch(this.userId)
                return await user?.createDM()
            }
        } catch (e) {
            console.error('Failed to load message channel:', e.message)
        }
    }

    async getMessage(client: Client): Promise<Message | undefined> {
        if (!this.messageId || this.messageId.length == 0) return undefined
        try {
            const channel = await this.getChannel(client)
            if (!channel) return undefined
            return await channel.messages.fetch(this.messageId)
        } catch (e) {
            console.error('Failed to load message:', e.message)
        }
    }

    async getUser(client: Client): Promise<User | undefined> {
        try {
            return await client.users.fetch(this.userId)
        } catch (e) {
            console.error('Failed to load user:', e.message)
        }
        return undefined
    }

    getConsoleLabel(): string {
        return `${this.guildId ? this.guildId + ' > ' : 'DM > '}${this.channelId ? this.channelId + ' > ' : ''}${this.userName}`
    }
}

// endregion

// region Data Classes

export class PostOptions {
    public message: string = ''
    public spoiler: boolean = false
    public images: IStringDictionary = {}
}

export class PromptUserOptions {
    constructor(
        public customIdPrefix: string = '',
        public title: string = '',
        public interaction: ButtonInteraction | CommandInteraction | undefined,
        public index: string = '',
        public data: MessageDerivedData | undefined
    ) {
    }
}

export class SpamThreadCache {
    constructor(
        public index: number = 0,
        public userId: string = '',
        public options: ImageGenerationOptions[]
    ) {
    }
}

// endregion