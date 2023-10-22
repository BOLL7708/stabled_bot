import Config, {IConfig} from './Config.js'
import {ApplicationCommandOptionType, ButtonInteraction, ChannelType, Client, CommandInteraction, DMChannel, Events, GatewayIntentBits, Message, ModalSubmitInteraction} from 'discord.js'
import Tasks, {MessageDerivedData} from './Tasks.js'
import dns from 'node:dns';
import Constants from './Constants.js'
import {CronJob} from 'cron'
import Utils, {Color} from './Utils.js'
import DiscordCom, {MessageReference, PromptUserOptions, SendImagesOptions} from './DiscordCom.js'
import StabledAPI, {GenerateImagesOptions} from './StabledAPI.js'
import DiscordUtils, {IAttachment, ISeed} from './DiscordUtils.js'

export default class StabledBot {
    private _config: IConfig
    private _dataCache = new Map<number, MessageDerivedData>()
    private _interactionIndex = 0

    private getNextInteractionIndex(): number {
        return ++this._interactionIndex
    }

    private getCachedData(index: number | string, deleteCache: boolean = true): MessageDerivedData | undefined {
        const data = this._dataCache.get(Number(index))
        if (data && deleteCache) this._dataCache.delete(Number(index))
        return data
    }

    async start() {
        dns.setDefaultResultOrder('ipv4first');

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
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.Guilds,
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
        })

        client.on(Events.InteractionCreate, async interaction => {
            if (interaction.isButton()) {
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
                        this._dataCache.set(nextIndex, data)
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
                        this._dataCache.set(nextIndex, data)
                        await DiscordCom.promptUser(new PromptUserOptions(
                            Constants.PROMPT_EDIT,
                            "Reused Seed",
                            interaction,
                            nextIndex.toString(),
                            data
                        ))
                        break
                    }
                    case Constants.BUTTON_VARY: {
                        if (data.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this._dataCache.set(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_VARY_CHOICE, 'Pick which image to make variations for:', nextIndex, data.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_VARY_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            await runGen(
                                'Here are the variations ',
                                useData.prompt,
                                useData.negativePrompt,
                                useData.size,
                                4,
                                useData.spoiler,
                                interaction,
                                useData.seeds[buttonData.buttonIndex],
                                true
                            )
                        } else {
                            await StabledBot.replyDataError(interaction)
                        }
                        break
                    }
                    case Constants.BUTTON_UPSCALE: {
                        if (data.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this._dataCache.set(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_UPSCALE_CHOICE, 'Pick which image to up-scale:', nextIndex, data.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_UPSCALE_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            const reference = await DiscordCom.replyQueuedAndGetReference(interaction)
                            try {
                                Tasks.updateQueues()
                                const images = await Tasks.getAttachmentAndUpscale(client, reference, useData.messageId, buttonData.buttonIndex)
                                Tasks.updateQueues()
                                const user = await reference.getUser(client)
                                if (Object.keys(images).length) {
                                    const options = new SendImagesOptions(
                                        '', '', '', 1,
                                        useData.spoiler,
                                        images,
                                        reference,
                                        `Here is the up-scaled image ${user}!`,
                                        false,
                                        true,
                                        false
                                    )
                                    await DiscordCom.sendImagesAsReply(client, options)
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
                        if (data.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this._dataCache.set(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_DETAIL_CHOICE, 'Pick which image to generate more details for:', nextIndex, data.count, interaction)
                            break
                        }
                    }
                    // @allowFallthrough
                    case Constants.BUTTON_DETAIL_CHOICE: {
                        const buttonData = this.getDataForButton(payload)
                        const useData = buttonData.data ?? data
                        if (useData) {
                            const seed = useData.seeds[buttonData.buttonIndex]
                            await runGen(
                                'Here are more details ',
                                useData.prompt,
                                useData.negativePrompt,
                                useData.size,
                                1,
                                useData.spoiler,
                                interaction,
                                seed,
                                false,
                                false,
                                true
                            )
                        } else {
                            await StabledBot.replyDataError(interaction)
                        }
                        break
                    }
                    case Constants.BUTTON_INFO: {
                        if (data.count > 1) {
                            const nextIndex = this.getNextInteractionIndex()
                            this._dataCache.set(nextIndex, data)
                            await DiscordCom.showButtons(Constants.BUTTON_INFO_CHOICE, 'Pick which image to get information for:', nextIndex, data.count, interaction)
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
                            const pngInfo = await Utils.parsePNGInfo(pngInfoResponse.info)
                            const content = [
                                '## Parsed and presented as JSON:',
                                '```json\n' + JSON.stringify(pngInfo, null, 2) + '```',
                                '## Raw response presented as plain text:',
                                '```' + pngInfoResponse.info + '```'
                            ]
                            await interaction.reply({
                                ephemeral: true,
                                content: content.join('\n')
                            })
                        } else {
                            await interaction.reply({
                                ephemeral: true,
                                content: 'Was unable to get attachment and load the data for it :('
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
                        const size = Utils.normalizeSize(aspectRatio)
                        await runGen('Here you go', prompt, promptNegative, size, count, spoiler, interaction)
                        break
                    }
                    case Constants.COMMAND_PROMPT: {
                        await DiscordCom.promptUser(new PromptUserOptions(
                            Constants.PROMPT_PROMPT,
                            'New Seed',
                            interaction,
                            '',
                            new MessageDerivedData()
                        ))
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
                        const promptData = getPromptValues(interaction)
                        await runGen(
                            'Here is the remix',
                            promptData.prompt,
                            promptData.promptNegative,
                            promptData.size,
                            promptData.count,
                            data?.spoiler ?? false,
                            interaction,
                            data.seeds.shift()
                        )
                        break
                    }
                    case Constants.PROMPT_REDO: {
                        const data = this.getCachedData(index)
                        const promptData = getPromptValues(interaction)
                        await runGen(
                            'Here you go again',
                            promptData.prompt,
                            promptData.promptNegative,
                            promptData.size,
                            promptData.count,
                            data?.spoiler ?? false,
                            interaction
                        )
                        break
                    }
                    case Constants.PROMPT_PROMPT: {
                        const promptData = getPromptValues(interaction)
                        await runGen(
                            'Here it is',
                            promptData.prompt,
                            promptData.promptNegative,
                            promptData.size,
                            promptData.count,
                            false,
                            interaction
                        )
                        break
                    }
                }
            }
        })

        function getPromptValues(interaction: ModalSubmitInteraction): IPromptData {
            const countValue = interaction.fields.getTextInputValue(Constants.INPUT_NEW_COUNT) ?? '4'
            let count = Number(countValue)
            if(isNaN(count)) count = 4
            count = Math.min(Math.max(count, 1), 10)

            const sizeValue = interaction.fields.getTextInputValue(Constants.INPUT_NEW_SIZE) ?? '1:1'
            const size = Utils.normalizeSize(sizeValue)

            return {
                prompt: interaction.fields.getTextInputValue(Constants.INPUT_NEW_PROMPT) ?? 'random trash',
                promptNegative: interaction.fields.getTextInputValue(Constants.INPUT_NEW_NEGATIVE_PROMPT) ?? '',
                size,
                count
            }

        }

        async function runGen(
            messageStart: string,
            prompt: string,
            negativePrompt: string,
            size: string,
            count: number,
            spoiler: boolean,
            interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction,
            seed?: ISeed,
            variations?: boolean,
            hires?: boolean,
            details?: boolean
        ) {
            try {
                const reference = await DiscordCom.replyQueuedAndGetReference(interaction)

                // Generate
                Utils.log('Adding to queue', `${count} image(s)`, reference.getConsoleLabel(), Color.FgYellow)
                Tasks.updateQueues()
                const images = await StabledAPI.generateImages(new GenerateImagesOptions(
                    reference,
                    prompt,
                    negativePrompt,
                    size,
                    count,
                    seed,
                    variations,
                    hires,
                    details
                ))
                Tasks.updateQueues()
                if (Object.keys(images).length) {
                    // Send to Discord
                    Utils.log('Finished generating', `${Object.keys(images).length} image(s)`, reference.getConsoleLabel(), Color.FgGreen)
                    const user = await reference.getUser(client)
                    const reply = await DiscordCom.sendImagesAsReply(client, new SendImagesOptions(
                        prompt,
                        negativePrompt,
                        size,
                        count,
                        spoiler,
                        images,
                        reference,
                        `${messageStart} ${user}!`,
                        variations,
                        hires,
                        details
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

    /**
     * If there was no cache to load we respond with this error message.
     * @param interaction
     * @private
     */
    private static async replyDataError(interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction) {
        await interaction.reply({
            ephemeral: true,
            content: 'The menu has expired, dismiss it and relaunch.'
        })
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
            const cachedData = this._dataCache.get(Number(cacheIndex))
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
}

interface IPromptData {
    prompt: string
    promptNegative: string
    size: string
    count: number
}