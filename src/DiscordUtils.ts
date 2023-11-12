import {Attachment, ButtonBuilder, ButtonInteraction, ButtonStyle, CommandInteraction, DMChannel, Message, ModalSubmitInteraction, SlashCommandStringOption, TextChannel} from 'discord.js'
import Constants from './Constants.js'
import axios from 'axios'
import {IMessageForInteraction} from './Tasks.js'

export default class DiscordUtils {
    // region Builders
    static buildDeadButton(index: number) {
        return new ButtonBuilder()
            .setCustomId(`${Constants.BUTTON_DEAD}#${index}`)
            .setLabel('‎') // Invisible
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    }

    static buildPromptOption(option: SlashCommandStringOption) {
        return option
            .setName(Constants.OPTION_PROMPT)
            .setDescription('The positive prompt that includes elements.')
    }

    static buildNegativePromptOption(option: SlashCommandStringOption) {
        return option
            .setName(Constants.OPTION_NEGATIVE_PROMPT)
            .setDescription('The negative prompt that excludes elements.')
    }

    static buildAspectRatioOption(option: SlashCommandStringOption) {
        return option
            .setName(Constants.OPTION_ASPECT_RATIO)
            .setDescription('Aspect ratio of the generated images.')
            .addChoices(
                {name: 'Landscape Golden Ratio', value: '1.618:1'},
                {name: 'Landscape 32:9', value: '32:9'},
                {name: 'Landscape 21:9', value: '21:9'},
                {name: 'Landscape 2:1', value: '2:1'},
                {name: 'Landscape 16:9', value: '16:9'},
                {name: 'Landscape 3:2', value: '3:2'},
                {name: 'Landscape 4:3', value: '4:3'},
                {name: 'Square 1:1', value: '1:1'},
                {name: 'Portrait 3:4', value: '3:4'},
                {name: 'Portrait 2:3', value: '2:3'},
                {name: 'Portrait 9:16', value: '9:16'},
                {name: 'Portrait 1:2', value: '1:2'},
                {name: 'Portrait 9:21', value: '9:21'},
                {name: 'Portrait 9:32', value: '9:32'},
                {name: 'Portrait Golden Ratio', value: '1:1.618'}
            )
    }

    // endregion

    // region Getters
    /**
     * TODO: WORK IN PROGRESS
     * @param message
     */
    static getInfoFromMessage(message: Message): MessageInfo {
        const info = new MessageInfo()
        const mention = message.mentions.members.first()
        const count = message.attachments.size
        if (mention) info.userName = mention.user.username
        if (count) info.count = Number(count)
        return info
    }

    static async getAttachmentFromMessage(message: Message, index: number | string): Promise<IAttachment> {
        const attachments = Array.from(message.attachments.values())
        if (attachments.length == 0) throw('No attachments found.')
        const attachment = attachments.at(Number(index))
        if (!attachment) throw('Could not get attachment.')
        const attachmentResponse = await axios.get(attachment.url, {responseType: 'arraybuffer'})
        const base64 = Buffer.from(attachmentResponse.data, 'binary').toString('base64')
        if (base64.length == 0) throw('Could not download image data.')
        return {name: attachment.name, spoiler: attachment.spoiler, data: base64}
    }

    static async getAttachment(channel: TextChannel | DMChannel, messageId: string, index: number | string): Promise<IAttachment> {
        const message = await channel?.messages?.fetch(messageId)
        if (!message) throw('Could not get message.')
        const attachment = await this.getAttachmentFromMessage(message, index)
        if (!attachment) throw('Could not get attachment.')
        return attachment
    }

    static async getChannelFromInteraction(interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction): Promise<TextChannel | DMChannel | undefined> {
        let channel: undefined | DMChannel | TextChannel
        if (!interaction.channel || !interaction.guild) {
            channel = await interaction.user.createDM()
        } else {
            channel = interaction.channel as TextChannel
        }
        return channel
    }

    static async getMessageFromInteraction(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<IMessageForInteraction | undefined> {
        const channel = await this.getChannelFromInteraction(interaction)
        const message = await channel.messages.fetch(interaction.message.id)
        if (!message) return undefined
        else return {
            message,
            channel: channel
        }
    }

    static async getMessageWithIdFromInteraction(interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction, messageId: string): Promise<Message | undefined> {
        const channel = await this.getChannelFromInteraction(interaction)
        return await channel.messages.fetch(messageId)
    }

    static getAttachmentSeedData(attachments: Iterable<Attachment>): ISeed[] {
        const seeds: ISeed[] = []
        for (const attachment of attachments) {
            const [differentiator, seed, variantSeed] = attachment.name.replace('.png', '').split('-')
            seeds.push({seed: seed ?? '-1', variantSeed: variantSeed ?? '-1'})
        }
        return seeds
    }

    private static REGEX_USERTAGS = /<@!?(\d*?)>/gm

    static getTagsFromContent(content: string): string[] {
        return [...content.matchAll(this.REGEX_USERTAGS)].map(match => match[1])
    }

    static removeTagsFromContent(content: string): string {
        return content.replaceAll(this.REGEX_USERTAGS, '')
    }

    // endregion
}

// region Data Classes
export class MessageInfo {
    userName: string = ''
    count: number = 0
}

// endregion

// region Interfaces
export interface ISeed {
    seed: string
    variantSeed: string
}

export interface IAttachment {
    name: string
    spoiler: boolean
    data: string
}

// endregion