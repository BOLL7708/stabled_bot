import {ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, CommandInteraction} from 'discord.js'
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
                    steps: 20,
                    width: 512,
                    height: 512,
                    // Try to figure out variations.
                })
            })
            if (response.ok) {
                const json: IStabledResponse = await response.json()
                const info = JSON.parse(json.info) as { seed: number, all_seeds: number[] } // TODO: Might want the full interface
                const imageDic: IStringDictionary = {}
                for (const image of json.images) {
                    const seed = info.all_seeds.shift()
                    if (seed) {
                        this._generatedImageCount++ // TODO: Switch this to a time-based value, or add a cron-job to reset this every day.
                        const serial = (this._generatedImageCount + 100000).toString().substring(1) + '-' + seed
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

    static async sendImagesAsReply(prompt: string, images: IStringDictionary, obj: ButtonInteraction | CommandInteraction, message: string) {
        const attachments = Object.entries(images).map(([fileName, imageData]) => {
            return new AttachmentBuilder(Buffer.from(imageData, 'base64'), {name: `${fileName}.png`})
        })
        const row = new ActionRowBuilder<ButtonBuilder>()
        let buttonIndex = 0
        // for(const serial of Object.keys(images)) {
        //     const newButton = new ButtonBuilder()
        //         .setCustomId(serial)
        //         .setLabel(`${++buttonIndex}🔁`)
        //         .setStyle(ButtonStyle.Secondary)
        //     row.addComponents(newButton)
        // }
        const deleteButton = new ButtonBuilder()
            .setCustomId('DELETE#' + Object.keys(images).pop())
            .setLabel('DELETE')
            .setStyle(ButtonStyle.Danger)
        const redoButton = new ButtonBuilder()
            .setCustomId('REDO#' + Object.keys(images).pop())
            .setLabel('REDO')
            .setStyle(ButtonStyle.Secondary)
        row.addComponents(deleteButton, redoButton)

        // TODO: InteractionCollector

        try {
            return await obj.editReply({
                content: message,
                files: attachments,
                components: [row],
                embeds: [{
                    description: prompt
                }]
            })
        } catch (e) {
            console.error(e)
        }
        return undefined
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