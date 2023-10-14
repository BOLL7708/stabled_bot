import {REST, Routes, APIEmbed, ActionRowBuilder, ApplicationCommandOptionType, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, CommandInteraction, ModalBuilder, ModalSubmitInteraction, SlashCommandBuilder, TextInputBuilder, TextInputStyle, JSONEncodable, Message, Embed, Attachment} from 'discord.js'
import Config, {IConfig} from './Config.js'
import Constants from './Constants.js'
import Utils from './Utils.js'

export default class Tasks {
    private static _generatedImageCount: number = 0

    static async registerCommands(config: IConfig) {
        const rest = new REST({version: '10'}).setToken(config.token)
        const genCommand = new SlashCommandBuilder()
            .setName(Constants.COMMAND_GEN)
            .setDescription('Generate an image from a prompt.')
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_PROMPT)
                    .setDescription('The positive prompt that includes elements.')
                    .setRequired(true)
            })
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_NEGATIVE_PROMPT)
                    .setDescription('The negative prompt that excludes elements.')
                    .setRequired(false)
            })
            .addIntegerOption(option => {
                return option
                    .setName(Constants.OPTION_COUNT)
                    .setDescription('The number of images to generate.')
                    .setRequired(false)
                    .addChoices(
                        {name: '1', value: 1},
                        {name: '2', value: 2},
                        {name: '3', value: 3},
                        {name: '4', value: 4},
                        {name: '5', value: 5}
                    )
            })
            .addStringOption(option => {
                return option
                    .setName(Constants.OPTION_ASPECT_RATIO)
                    .setDescription('Aspect ratio of the generated images.')
                    .setRequired(false)
                    .addChoices(
                        {name: 'Landscape Golden Ratio', value: '1.618:1'},
                        {name: 'Landscape 32:9', value: '32:9'},
                        {name: 'Landscape 21:9', value: '21:9'},
                        {name: 'Landscape 16:9', value: '16:9'},
                        {name: 'Landscape 4:3', value: '4:3'},
                        {name: 'Landscape 3:2', value: '3:2'},
                        {name: 'Landscape 2:1', value: '2:1'},
                        {name: 'Square 1:1', value: '1:1'},
                        {name: 'Portrait 1:2', value: '1:2'},
                        {name: 'Portrait 2:3', value: '2:3'},
                        {name: 'Portrait 3:4', value: '3:4'},
                        {name: 'Portrait 9:16', value: '9:16'},
                        {name: 'Portrait 9:21', value: '9:21'},
                        {name: 'Portrait 9:32', value: '9:32'},
                        {name: 'Portrait Golden Ratio', value: '1:1.618'}
                    )
            })
        try {
            await rest.put(Routes.applicationCommands(config.clientId), {
                body: [
                    genCommand.toJSON()
                ]
            })
        } catch (e) {
            console.error(e)
        }
    }

    static async generateImages(options: GenerateImagesOptions): Promise<IStringDictionary> {
        const config = await Config.get()
        const baseUrl = config.apiUrl
        const {width, height} = Utils.calculateWidthHeightForAspectRatio(options.aspectRatio)

        const body = {
            prompt: options.prompt,
            negative_prompt: options.negativePrompt,
            n_iter: options.count,
            steps: 20,
            width,
            height,
            seed: options.predefinedSeed ?? -1
            // TODO: Try to figure out variations.
        }
        if (options.variation) {
            body['subseed'] = -1
            body['subseed_strength'] = 0.1
        }
        if (options.hires) {
            body['enable_hr'] = true
            body['hr_scale'] = 2
            body['hr_upscaler'] = 'Latent'
            body['denoising_strength'] = 0.7
        }

        try {
            const response = await fetch(`${baseUrl}/txt2img`, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            })
            if (response.ok) {
                const json: IStabledResponse = await response.json()
                const info = JSON.parse(json.info) as { seed: number, all_seeds: number[] } // TODO: Might want the full interface
                const imageDic: IStringDictionary = {}
                for (const image of json.images) {
                    const seed = info.all_seeds.shift()
                    if (seed) {
                        const serial = Utils.getSerial(seed, ++this._generatedImageCount)
                        imageDic[serial] = image
                    }
                }
                return imageDic
            } else {
                return {}
            }
        } catch (e) {
            console.error(e)
            return {}
        }
    }

    static async sendImagesAsReply(options: SendImagesOptions) {
        const attachments = Object.entries(options.images).map(([fileName, imageData]) => {
            return new AttachmentBuilder(Buffer.from(imageData, 'base64'), {name: `${fileName}.png`})
        })
        const row = new ActionRowBuilder<ButtonBuilder>()
        const deleteButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_DELETE + '#' + Object.keys(options.images).shift())
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary)
        const redoButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_REDO + '#' + Object.keys(options.images).shift())
            .setEmoji('🔀')
            .setStyle(ButtonStyle.Secondary)
        const editButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_EDIT + '#' + Object.keys(options.images).shift())
            .setEmoji('🔁')
            .setStyle(ButtonStyle.Secondary)
        const varyButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_VARY + '#' + Object.keys(options.images).shift())
            .setEmoji('🎛')
            .setStyle(ButtonStyle.Secondary)
        const upresButton = new ButtonBuilder()
            .setCustomId(Constants.BUTTON_UPRES + '#' + Object.keys(options.images).shift())
            .setEmoji('🍄')
            .setStyle(ButtonStyle.Secondary)

        const embeds: (APIEmbed | JSONEncodable<APIEmbed>)[] = []
        if (options.variations || options.hires) {
            row.addComponents(deleteButton)
        } else {
            row.addComponents(deleteButton, redoButton, editButton, varyButton /* , upresButton */)
            embeds.push({
                fields: [
                    {name: Constants.FIELD_PROMPT, value: options.prompt, inline: false},
                    {name: Constants.FIELD_NEGATIVE_PROMPT, value: options.negativePrompt, inline: true},
                    {name: Constants.FIELD_USER, value: options.obj.user.username ?? 'unknown', inline: true},
                    {name: Constants.FIELD_COUNT, value: options.count.toString(), inline: true},
                    {name: Constants.FIELD_ASPECT_RATIO, value: options.aspectRatio, inline: true}
                ]
            })
        }

        try {
            return await options.obj.editReply({
                content: options.message,
                files: attachments,
                components: [row],
                embeds
            })
        } catch (e) {
            console.error(e)
        }
        return undefined
    }

    static async promptUser(options: PromptUserOptions) {
        const textInput = new TextInputBuilder()
            .setCustomId(Constants.INPUT_NEW_PROMPT)
            .setLabel("The positive prompt, include elements.")
            .setValue(options.prompt)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        const promptRow = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput)
        const textInput2 = new TextInputBuilder()
            .setCustomId(Constants.INPUT_NEW_NEGATIVE_PROMPT)
            .setLabel("The negative prompt, exclude elements.")
            .setValue(options.negativePrompt)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        const promptRow2 = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(textInput2)
        const modal = new ModalBuilder()
            .setCustomId(`${options.customIdPrefix}#${options.reference}`)
            .setTitle(options.title)
            .addComponents(promptRow, promptRow2)
        await options.obj.showModal(modal)
    }

    static async showButtons(type: string, description: string, dataEntries: EmbedFieldData[], interaction: ButtonInteraction | ModalSubmitInteraction) {
        const row = new ActionRowBuilder<ButtonBuilder>()
        let buttonIndex = 0
        for (const data of dataEntries) {
            const button = new ButtonBuilder()
                .setCustomId(type + '#' + data.seeds.shift()) // TODO
                .setLabel(`Image #${++buttonIndex}`)
                .setStyle(ButtonStyle.Secondary)
            row.addComponents(button)
        }
        await interaction.reply({
            content: description,
            ephemeral: true,
            components: [row]
        })
    }

    static async getDataFromMessage(message: Message<boolean>): Promise<EmbedFieldData> {
        const data = new EmbedFieldData()
        data.messageId = message.id
        for(const embed of message.embeds) {
            if(embed.fields.length) {
                const fields = embed.fields
                if(fields) {
                    for(const field of fields) {
                        switch(field.name) {
                            case Constants.FIELD_USER: data.user = field.value; break
                            case Constants.FIELD_PROMPT: data.prompt = field.value; break
                            case Constants.FIELD_NEGATIVE_PROMPT: data.negativePrompt = field.value; break
                            case Constants.FIELD_COUNT: data.count = parseInt(field.value); break
                            case Constants.FIELD_ASPECT_RATIO: data.aspectRatio = field.value; break
                        }
                    }
                }
            }
        }
        for(const attachment of message.attachments) {
            const attachmentData = attachment.pop() as Attachment
            if(attachmentData.name.endsWith('.png')) {
                const fileName = attachmentData.name.replace('.png', '')
                data.seeds.push(fileName.split('-').pop()) // TODO: Possible support more parts here later
            }
        }
        return data
    }
}

interface IStabledResponse {
    images: string[]
    parameters: {
        prompt: string
        negative_prompt: string
        styles: any
        seed: number
        subseed: number
        subseed_strength: number
        seed_resize_from_h: number
        seed_resize_from_w: number
        sampler_name: any,
        batch_size: number
        n_iter: number
        steps: number
        cfg_scale: number
        width: number
        height: number
        restore_faces: any
        tiling: any
        do_not_save_samples: boolean
        do_not_save_grid: boolean
        eta: any
        denoising_strength: number
        s_min_uncond: any
        s_churn: any
        s_tmax: any
        s_tmin: any
        s_noise: any
        override_settings: any
        override_settings_restore_afterwards: boolean
        refiner_checkpoint: any
        refiner_switch_at: any
        disable_extra_networks: boolean
        comments: any
        enable_hr: boolean
        firstphase_width: number
        firstphase_height: number
        hr_scale: number
        hr_upscaler: any
        hr_second_pass_steps: number
        hr_resize_x: number
        hr_resize_y: number
        hr_checkpoint_name: any
        hr_sampler_name: any
        hr_prompt: string
        hr_negative_prompt: string
        sampler_index: string
        script_name: any
        script_args: []
        send_images: boolean
        save_images: boolean
        alwayson_scripts: any
    },
    info: string
}

export interface IStringDictionary {
    [key: string]: string
}

export class EmbedFieldData {
    public messageId: string = ''
    public user: string = ''
    public prompt: string = ''
    public negativePrompt: string = ''
    public count: number = 0
    public aspectRatio: string = ''
    public seeds: string[] = []
    public subSeeds: string[] = []
}

export class GenerateImagesOptions {
    constructor(
        public prompt: string = 'random garbage',
        public negativePrompt: string = '',
        public aspectRatio: string = '1:1',
        public count: number = 4,
        public predefinedSeed: string | undefined,
        public variation: boolean | undefined,
        public hires: boolean | undefined
    ) {
    }
}

export class SendImagesOptions {
    constructor(
        public prompt: string = 'random waste',
        public negativePrompt: string = '',
        public aspectRatio: string = '1:1',
        public count: number = 4,
        public images: IStringDictionary = {},
        public obj: ButtonInteraction | CommandInteraction | ModalSubmitInteraction | undefined,
        public message: string = '',
        public variations: boolean | undefined,
        public hires: boolean | undefined
    ) {
    }
}

export class PromptUserOptions {
    constructor(
        public customIdPrefix: string = '',
        public title: string = '',
        public obj: ButtonInteraction | CommandInteraction | undefined,
        public reference: string = '',
        public prompt: string = 'random dirt',
        public negativePrompt: string = ''
    ) {
    }
}