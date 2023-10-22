import {ActivityType, APIEmbed, ApplicationCommandOptionType, Attachment, ButtonInteraction, ButtonStyle, Client, CommandInteraction, DMChannel, Message, ModalSubmitInteraction, TextChannel, TextInputStyle, User} from 'discord.js'
import Constants from './Constants.js'
import Utils, {IStringDictionary} from './Utils.js'
import {MessageReference} from './DiscordCom.js'
import StabledAPI from './StabledAPI.js'
import DiscordUtils, {IAttachment, ISeed} from './DiscordUtils.js'

export default class Tasks {
    static async getAttachmentAndUpscale(client: Client, reference: MessageReference, messageId: string, buttonIndex: number | string): Promise<IStringDictionary> {
        const channel = await reference.getChannel(client)
        if (!channel) throw('Could not get channel.')
        const attachment = await DiscordUtils.getAttachment(channel, messageId, buttonIndex)
        const fileName = attachment.name.replace('.png', '')
        const upscaleFactor = 4 // TODO: Make this configurable
        return await StabledAPI.upscaleImageData(reference, attachment.data, upscaleFactor, fileName)
    }

    static async getDataForMessage(message: Message): Promise<MessageDerivedData> {
        const data = new MessageDerivedData()
        data.messageId = message.id
        try { // It throws an exception if we try to access this in a DM.
            data.userId = message.mentions.members.first()?.user?.id ?? ''
        } catch (e) {
            // console.error('Could not get user id:', e.message)
        }
        data.count = message.attachments.size
        data.seeds = DiscordUtils.getAttachmentSeedData(message.attachments.values())
        let attachment: IAttachment
        try {
            attachment = await DiscordUtils.getAttachmentFromMessage(message, 0)
        } catch (e) {
            // console.error('Attachment error:', e.message)
        }
        if (attachment) {
            data.spoiler = attachment.spoiler
            const pngInfoResponse = await StabledAPI.getPNGInfo(attachment.data)
            const pngInfo = await Utils.parsePNGInfo(pngInfoResponse.info)
            if(pngInfo) {
                data.prompt = pngInfo.prompt
                data.negativePrompt = pngInfo.negativePrompt
                data.size = pngInfo.size
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
            ? 'Idle 💤'
            : `Work ${this._currentTick ? '⌛' : '⏳'}:${Math.round(100 * progress.progress)}% 📋:${queueCount}`
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
    public userId: string = ''
    public prompt: string = ''
    public negativePrompt: string = ''
    public count: number = 4
    public size: string = '512x512'
    public spoiler: boolean = false
    public seeds: ISeed[] = []
}

export type TChannelType = TextChannel | DMChannel

export interface IMessageForInteraction {
    message: Message
    channel: TChannelType
}



