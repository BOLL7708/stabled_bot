import {ActivityType, APIEmbed, ApplicationCommandOptionType, Attachment, ButtonInteraction, ButtonStyle, Client, CommandInteraction, DMChannel, Message, ModalSubmitInteraction, TextChannel, TextInputStyle} from 'discord.js'
import Constants from './Constants.js'
import Utils, {IStringDictionary} from './Utils.js'
import {MessageReference} from './DiscordCom.js'
import StabledAPI from './StabledAPI.js'
import DiscordUtils from './DiscordUtils.js'

export default class Tasks {
    static async getAttachmentAndUpscale(client: Client, reference: MessageReference, messageId: string, buttonIndex: number | string): Promise<IStringDictionary> {
        const channel = await reference.getChannel(client)
        if (!channel) throw('Could not get channel.')
        const attachment = await DiscordUtils.getAttachment(channel, messageId, buttonIndex)
        const fileName = attachment.name.replace('.png', '')
        const upscaleFactor = 4 // TODO: Make this configurable
        return await StabledAPI.upscaleImageData(reference, attachment.data, upscaleFactor, fileName)
    }

    /**
     * @deprecated Should be replaced with getting data from the message properties and PNGInfo
     * @param message
     */
    static async getDataFromMessage(message: Message<boolean>): Promise<MessageDerivedData> {
        const data = new MessageDerivedData()
        data.messageId = message.id
        for (const embed of message.embeds) {
            if (embed.fields.length) {
                const fields = embed.fields
                if (fields) {
                    for (const field of fields) {
                        switch (field.name) {
                            case Constants.FIELD_USER:
                                data.user = field.value;
                                break
                            case Constants.FIELD_PROMPT:
                                data.prompt = field.value;
                                break
                            case Constants.FIELD_NEGATIVE_PROMPT:
                                data.negativePrompt = field.value;
                                break
                            case Constants.FIELD_COUNT:
                                data.count = parseInt(field.value);
                                break
                            case Constants.FIELD_ASPECT_RATIO:
                                data.aspectRatio = field.value;
                                break
                            case Constants.FIELD_SPOILER:
                                data.spoiler = field.value.toLowerCase() == 'true';
                                break
                        }
                    }
                }
            }
        }
        for (const attachment of message.attachments) {
            const attachmentData = attachment.pop() as Attachment
            if (attachmentData.name.endsWith('.png')) {
                const fileName = attachmentData.name.replace('.png', '')
                data.seeds.push(fileName.split('-').pop()) // TODO: Possible support more parts here later
            }
        }
        return data
    }

    private static _currentStatus: string = ''
    private static _currentActivity: string = ''
    private static _currentTick: boolean = false
    private static _updateQueues: boolean = false

    static updateQueues() {
        this._updateQueues = true
    }

    static async updateProgressStatus(client: Client | undefined) {
        const progress = await StabledAPI.getProgress()
        if (!progress) throw('Could not get progress.')
        if (progress.state.job_count <= 0) {
            StabledAPI.clearQueue()
        }

        const queueCount = StabledAPI.getQueueSize()
        this._currentTick = !this._currentTick
        const idle = progress.state.job_count <= 0
        const newStatus = idle ? 'online' : 'dnd'
        const newActivity = idle
            ? '/gen 💤'
            : `/gen ${this._currentTick ? '⌛' : '⏳'}:${Math.round(100 * progress.progress)}% 📋:${queueCount}`
        if (progress && client && (this._currentStatus !== newStatus || this._currentActivity !== newActivity)) {
            this._currentStatus = newStatus
            this._currentActivity = newActivity
            try {
                await client.user.setPresence({
                    status: newStatus,
                    activities: [{
                        name: newActivity,
                        type: ActivityType.Custom
                    }]
                })
            } catch (e) {
                console.error('Presence update failed.', e.message)
            }
        }
        const queueEntries = StabledAPI.getQueueEntries()
        let currentItem = queueEntries.next()
        const reference = currentItem?.value?.length == 2 ? currentItem.value[1] : undefined

        const message = await reference?.getMessage(client as Client) // This will throw, which is fine.
        message?.edit({
            content: await Utils.progressBarMessage(progress.progress)
        })

        let placeInQueue = 0
        if (this._updateQueues) {
            this._updateQueues = false
            while (currentItem?.value && !currentItem?.value?.done) {
                currentItem = queueEntries.next()
                if (currentItem.value) {
                    const reference = currentItem.value.length == 2 ? currentItem.value[1] : undefined
                    try {
                        const message = await reference.getMessage(client)
                        message?.edit({
                            content: `Queued... \`${++placeInQueue}/${queueCount - 1}\``
                        })
                    } catch (e) {
                        console.error('Queue update failed:', e.message)
                    }
                }
            }
        }
    }
}

export class MessageDerivedData {
    public messageId: string = ''
    public user: string = ''
    public prompt: string = ''
    public negativePrompt: string = ''
    public count: number = 0
    public aspectRatio: string = ''
    public spoiler: boolean = false
    public seeds: string[] = []
    public subSeeds: string[] = []
}

export type TChannelType = TextChannel | DMChannel

export interface IMessageForInteraction {
    message: Message
    channel: TChannelType
}



