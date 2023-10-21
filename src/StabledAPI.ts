import axios, {AxiosInstance, AxiosResponse} from 'axios'
import {MessageReference} from './DiscordCom.js'
import Config from './Config.js'
import Utils, {IStringDictionary} from './Utils.js'

export default class StabledAPI {
    private static _api: AxiosInstance
    private static _generatedImageCount: number = 0
    private static _queueIndex = 0
    private static _queue: Map<number, MessageReference> = new Map()

    // region Init
    private static async ensureAPI() {
        const config = await Config.get()
        if (!this._api) {
            this._api = axios.create({
                baseURL: config.serverAddress + '/sdapi/v1',
                timeout: config.timeoutMins * 60 * 1000,
                headers: {'Content-Type': 'application/json'},
                method: 'post'
            })
        }
    }
    // endregion

    // region Queued Methods
    static async generateImages(options: GenerateImagesOptions): Promise<IStringDictionary> {
        await this.ensureAPI()
        const {width, height} = Utils.calculateWidthHeightForAspectRatio(options.aspectRatio)

        const body = {
            prompt: options.prompt,
            negative_prompt: options.negativePrompt,
            n_iter: options.count,
            steps: options.details ? 80 : 20,
            width,
            height,
            seed: options.predefinedSeed ?? -1
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

        const queueIndex = this.registerQueueItem(options.reference)
        let response: AxiosResponse<IStabledResponse>
        try {
            response = await this._api.post(`txt2img`, body)
        } catch (e) {
            console.error('Error queueing up image generation:', e.message)
        }
        this.unregisterQueueItem(queueIndex)

        if (response?.data) {
            const data = response.data
            const info = JSON.parse(data.info) as { seed: number, all_seeds: number[] } // TODO: Might want the full interface
            const imageDic: IStringDictionary = {}
            for (const image of data.images) {
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
    }

    // endregion
    static async upscaleImageData(reference: MessageReference, data: string, upscaleFactor: number, fileName: string) {
        const body = {
            upscaling_resize: upscaleFactor,
            upscaler_1: 'Lanczos',
            upscaler_2: 'None',
            extras_upscaler_2_visibility: 0,
            upscale_first: false,
            image: data
        }

        const queueIndex = this.registerQueueItem(reference)
        let response: IStringDictionary = {}
        try {
            const upscaleResponse = await this._api.post(`extra-single-image`, body)
            if (upscaleResponse.data) {
                response = {[`${fileName}_${upscaleFactor}x`]: upscaleResponse.data.image}
            }
        } catch (e) {
            console.error('Up-scaling failed', e.message)
        }
        this.unregisterQueueItem(queueIndex)
        return response
    }

    // region Non-queued Methods
    static async getProgress(): Promise<IProgressResponse|undefined> {
        await this.ensureAPI()
        let progressResponse: AxiosResponse<IProgressResponse>
        try {
            progressResponse = await this._api.get('progress')
        } catch (e) {
            console.error(e)
        }
        return progressResponse?.data
    }

    static async getPNGInfo(base64ImageData: string): Promise<IPNGInfoResponse | undefined> {
        await this.ensureAPI()
        const body = {
            image: base64ImageData
        }
        try {
            const response: AxiosResponse<IPNGInfoResponse> = await this._api.post(`png-info`, body)
            return response.data
        } catch (e) {
            console.error(e)
        }
    }
    // endregion

    // region Queue Handling
    static registerQueueItem(reference: MessageReference) {
        const index = ++this._queueIndex
        this._queue.set(index, reference)
        return index
    }

    static unregisterQueueItem(index: number) {
        this._queue.delete(index)
    }

    static getQueueEntries() {
        return this._queue.entries()
    }

    static getQueueSize(): number {
        return this._queue.size
    }

    static clearQueue() {
        this._queue.clear()
        this._queueIndex = 0
    }
    // endregion
}

// region Data Classes
export class GenerateImagesOptions {
    constructor(
        public reference: MessageReference,
        public prompt: string = 'random garbage',
        public negativePrompt: string = '',
        public aspectRatio: string = '1:1',
        public count: number = 4,
        public predefinedSeed: string | undefined,
        public variation: boolean | undefined,
        public hires: boolean | undefined,
        public details: boolean | undefined
    ) {
    }
}
// endregion

// region Interfaces
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

interface IProgressResponse {
    progress: number
    eta_relative: number
    state: {
        skipped: boolean
        interrupted: boolean
        job: string
        job_count: number
        job_timestamp: string
        job_no: number
        sampling_step: number
        sampling_steps: number
    },
    current_image: string,
    textinfo: any
}

export interface IPNGInfoResponse {
    info: string
    items: {
        parameters: string
    }
}
// endregion