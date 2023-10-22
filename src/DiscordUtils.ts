import {Attachment, ButtonBuilder, ButtonInteraction, ButtonStyle, CommandInteraction, DMChannel, Message, ModalSubmitInteraction, TextChannel} from 'discord.js'
import Constants from './Constants.js'
import axios from 'axios'
import {IMessageForInteraction} from './Tasks.js'

export default class DiscordUtils {
    // region Builders
    static buildDeadButton(index: number) {
        return new ButtonBuilder()
            .setCustomId(`${Constants.BUTTON_DEAD}#${index}`)
            .setLabel('‎ ') // Invisible
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
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