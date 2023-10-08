import {AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Message, InteractionCollector} from 'discord.js'
import Config from './Config.js'

export default class Tasks {
    private static _generatedImageCount: number = 0
    static async generateImagesFromMessage(message: string): Promise<IStringDictionary> {
        const config = await Config.get()
        const baseUrl = config.apiUrl
        try {
            const response = await fetch(`${baseUrl}/txt2img`, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: message,
                    n_iter: 4,
                    steps: 20
                })
            })
            if (response.ok) {
                const json: IStabledResponse = await response.json()
                const info = JSON.parse(json.info) as { seed: number, all_seeds: number[] } // TODO: Might want the full interface
                const imageDic: IStringDictionary = {}
                for(const image of json.images) {
                    const seed = info.all_seeds.shift()
                    console.log(`Generated image with seed ${seed}`)
                    if(seed) {
                        this._generatedImageCount++
                        const serial = (this._generatedImageCount+100000).toString().substring(1)+'-'+seed
                        console.log(`Submitting image with serial ${serial}`)
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

    static async sendImagesAsReply(images: IStringDictionary, messageObj: Message<boolean>, message: string) {
        const attachments = Object.entries(images).map(([fileName, imageData]) => {
            return new AttachmentBuilder(Buffer.from(imageData, 'base64'), {name: `${fileName}.png`})
        })
        const confirm = new ButtonBuilder()
            .setCustomId('ok')
            .setLabel('🆗')
            .setStyle(ButtonStyle.Primary);

        const cancel = new ButtonBuilder()
            .setCustomId('redo')
            .setLabel('🔃')
            .setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(cancel, confirm)

        // InteractionCollector

        return messageObj.reply({
            content: message,
            files: attachments,
            components: [row]
        })
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

interface IStringDictionary {
    [key: string]: string
}