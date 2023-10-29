import {ActivityType, APIEmbed, ApplicationCommandOptionType, ButtonStyle, Client, DMChannel, Message, TextChannel, TextInputStyle} from 'discord.js'
import Constants from './Constants.js'
import Utils, {IStringDictionary} from './Utils.js'
import {MessageReference} from './DiscordCom.js'
import StabledAPI, {ImageGenerationOptions, QueueItem} from './StabledAPI.js'
import DiscordUtils, {IAttachment, ISeed} from './DiscordUtils.js'
import StabledBot from './StabledBot.js'

export default class Tasks {
    static async getAttachmentAndUpscale(
        client: Client,
        reference: MessageReference,
        options: ImageGenerationOptions,
        messageId: string,
        buttonIndex: number | string
    ): Promise<IStringDictionary> {
        // const channel = await reference.getChannel(client)
        // if (!channel) throw('Could not get channel.')
        // const attachment = await DiscordUtils.getAttachment(channel, messageId, buttonIndex)
        // const fileName = attachment.name.replace('.png', '')
        // const upscaleFactor = 4 // TODO: Make this configurable
        // return await StabledAPI.upscaleImageData(reference, options, attachment.data, upscaleFactor, fileName)
        return {}
    }

    static async getDataForMessage(message: Message): Promise<MessageDerivedData> {
        const data = new MessageDerivedData()
        data.messageId = message.id
        try { // It throws an exception if we try to access this in a DM.
            data.userId = message.mentions.members.first()?.user?.id ?? ''
        } catch (e) {
            // console.error('Could not get user id:', e.message)
        }
        data.genOptions.count = message.attachments.size
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
            if (pngInfo) {
                data.genOptions.prompt = pngInfo.prompt
                data.genOptions.negativePrompt = pngInfo.negativePrompt
                data.genOptions.size = pngInfo.size
            }
        }
        return data
    }

    private static _currentStatus: string = ''
    private static _currentActivity: string = ''
    private static _updateQueues: boolean = false
    private static _lastQueueItemIndex: number = 0

    static updateQueues() {
        this._updateQueues = true
    }

    static async updateProgressAndStartGenerations(client: Client | undefined) {
        const progress = await StabledAPI.getProgress()
        if (!progress) throw('Could not get progress.')

        // Update progress message
        try {
            const message = await StabledAPI.currentQueueItem?.reference?.getMessage(client as Client)
            await message?.edit({
                content: await Utils.progressBarMessage(progress.progress)
            })
        } catch (e) {
            console.error('Progress update failed:', e.message)
        }

        // Progress
        const queueEntries = StabledAPI.getQueueEntries()
        let currentItem = queueEntries.next()
        const itemFirstInQueue = currentItem?.value as QueueItem|undefined

        // Update queue messages
        let placeInQueue = 0
        while (currentItem?.value && !currentItem?.value?.done) {
            if (this._updateQueues) {
                this._updateQueues = false
                const item = currentItem.value as QueueItem
                try {
                    ++placeInQueue
                    if(item.index > this._lastQueueItemIndex) {
                        const message = await item.reference.getMessage(client)
                        await message?.edit({
                            content: `${Constants.CONTENT_QUEUED} ${item.reference.source}... \`#${placeInQueue}\``
                        })
                    }
                } catch (e) {
                    console.error('Queue update failed:', e.message)
                }
            }
            currentItem = queueEntries.next()
        }

        // Generate images if we have a new queue item, is using the first item in the queue.
        const jobCount = progress?.state?.job_count ?? 0
        const queueItemIndex = itemFirstInQueue?.index ?? Infinity
        let idle = jobCount <= 0
        if (idle && itemFirstInQueue) {
            this._lastQueueItemIndex = itemFirstInQueue.index
            StabledAPI.startGenerationOfImages(itemFirstInQueue).then()
        }

        // Presence
        const newStatus = idle ? 'online' : 'dnd'
        const newActivity = idle
            ? 'Idle 💤'
            : `Work ⏳:${Math.round(100 * progress.progress)}% 📋:${placeInQueue}`
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
    }
}

export class MessageDerivedData {
    public messageId: string = ''
    public userId: string = ''
    public seeds: ISeed[] = []
    public genOptions: ImageGenerationOptions = new ImageGenerationOptions()
    public spoiler: boolean = false
}

export type TChannelType = TextChannel | DMChannel

export interface IMessageForInteraction {
    message: Message
    channel: TChannelType
}