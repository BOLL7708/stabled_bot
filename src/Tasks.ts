import {ActivityType, APIEmbed, ApplicationCommandOptionType, ButtonStyle, Client, DMChannel, Message, TextChannel, TextInputStyle} from 'discord.js'
import Utils, {IStringDictionary} from './Utils.js'
import {MessageReference} from './DiscordCom.js'
import StabledAPI, {ImageGenerationOptions} from './StabledAPI.js'
import DiscordUtils, {IAttachment, ISeed} from './DiscordUtils.js'

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
    private static _lastQueueItemIndexStarted: number = 0

    static async updateProgressAndStartGenerations(client: Client | undefined) {
        const progress = await StabledAPI.getProgress()
        if (!progress) throw('Could not get progress.')

        const currentQueueItem = StabledAPI.currentQueueItem
        const isWorking = (progress.state?.job_count ?? 0) > 0
        const queueSize = StabledAPI.getQueueSize()
        const noMoreWork = !isWorking && queueSize <= 0

        // Presence
        const currentWorkIndex = currentQueueItem?.index ?? 0
        const newStatus = noMoreWork
            ? 'online'
            : 'dnd'
        const newActivity = noMoreWork
            ? 'Idle 💤'
            : (progress.progress > 0 && currentWorkIndex > 0)
                ? `Work ⏳${Math.round(100 * progress.progress)}% #️⃣${currentWorkIndex}`
                : `Work 💾`
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

        // Update progress message
        try {
            const message = await currentQueueItem?.reference?.getMessage(client as Client)
            if (message) {
                // Having a mention means the message has been edited to insert the result already.
                const hasMention = DiscordUtils.getTagsFromContent(message.content).length > 0
                if (!hasMention) {
                    await message.edit({
                        content: await Utils.progressBarMessage(currentQueueItem?.index, progress.progress)
                    })
                } else console.log('Avoided updating progress as result has already been posted.')
            }
        } catch (e) {
            console.error('Progress update failed:', e.message)
        }

        // Generate images if we have nothing to do
        if (!isWorking) {
            const item = StabledAPI.getNextInQueue()
            if (item) {
                this._lastQueueItemIndexStarted = item.index
                StabledAPI.startGenerationOfImages(item).then()
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